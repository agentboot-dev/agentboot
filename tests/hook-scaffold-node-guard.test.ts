/**
 * L41 (second half) — the `agentboot add hook` scaffold must guard `node` before it
 * uses it, exactly as every compiled hook does.
 *
 * `docs/troubleshooting.md` now tells adopters two things: that `jq` is never a
 * requirement, and that what hooks DO require is `node` on `PATH` — "every compiled
 * hook guards on it with `command -v node` and, depending on the hook, either blocks
 * or exits quietly when it is missing." The scaffold handed to adopters by
 * `agentboot add hook` is the template every hand-written compliance hook starts
 * from, and it ships neither guard.
 *
 * That is this project's recurring defect class rather than a cosmetic omission: on a
 * shell without `node` — the Windows/git-bash case the whole jq removal existed to
 * serve — the unguarded `node -e` fails, `EVENT_NAME` comes back empty, every
 * downstream `if [ "$EVENT_NAME" = ... ]` misses, and the hook exits 0. It reports
 * success having enforced nothing, and the adopter's only signal is a line of stderr
 * the agent harness discards. A hook that cannot parse its input must say so, not
 * pass.
 *
 * The jq half of L41 is pinned in `doc-claims-measured.test.ts`; it is asserted here
 * too so that a single file answers "is the scaffold portable?" without a reader
 * having to know both files exist.
 *
 * The detector itself is exercised against known-good and known-bad scripts below.
 * A guard-detector that cannot report a violation is worth as little as the missing
 * guard — this branch has already shipped one tamper test that passed without
 * tampering with anything.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

/**
 * `node` used as a command word: at the start of a line, or after a pipe, semicolon,
 * `&&`/`||`, a subshell/backtick open, or `$(`. Deliberately NOT a bare /\bnode\b/ —
 * that matches `node_modules`, "node" in prose, and `--node-flag`.
 */
const NODE_INVOCATION = /(?:^|[|;&(`{]|\$\()\s*(?:command\s+|exec\s+)?node(?:\s|$)/;

/** The guard every compiled hook carries (compile.ts emits this literal form). */
const NODE_GUARD = /command\s+-v\s+node\b/;

/** Executable lines only — a `#` comment naming node or jq is documentation. */
function executableLines(script: string): string[] {
  return script
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

/**
 * Returns the offending line when a shell script reaches `node` without having
 * checked for it first, or `null` when the script is safe (guarded, or never uses
 * node at all).
 */
function unguardedNodeInvocation(script: string): string | null {
  const lines = executableLines(script);
  for (const line of lines) {
    if (NODE_GUARD.test(line)) return null; // guarded before any use
    if (NODE_INVOCATION.test(line)) return line;
  }
  return null;
}

function jqInvocations(script: string): string[] {
  return executableLines(script).filter((l) => /(?:^|[|;&(`{]|\$\()\s*jq(?:\s|$)/.test(l));
}

// ---------------------------------------------------------------------------
// The detector, proven able to fail before it is trusted on the real artifact
// ---------------------------------------------------------------------------

describe("L41: the node-guard detector reports what it claims to report", () => {
  it("flags a script that pipes into node with no guard", () => {
    const bad = [
      "#!/bin/bash",
      "# a comment mentioning node and jq proves nothing",
      "INPUT=$(cat)",
      `EVENT=$(printf '%s' "$INPUT" | node -e "process.stdout.write('')")`,
      "exit 0",
    ].join("\n");
    expect(unguardedNodeInvocation(bad)).toContain("node -e");
  });

  it("flags a command-substitution invocation, not just a pipe", () => {
    const bad = `#!/bin/bash\nHOME_DIR=$(node -e "console.log(1)")\n`;
    expect(unguardedNodeInvocation(bad)).not.toBeNull();
  });

  it("passes a script that guards before invoking", () => {
    const good = [
      "#!/bin/bash",
      "INPUT=$(cat)",
      `command -v node >/dev/null 2>&1 || { echo '{"decision":"block"}'; exit 2; }`,
      `EVENT=$(printf '%s' "$INPUT" | node -e "process.stdout.write('')")`,
    ].join("\n");
    expect(unguardedNodeInvocation(good)).toBeNull();
  });

  it("passes a script that never invokes node", () => {
    expect(unguardedNodeInvocation("#!/bin/bash\ncat >/dev/null\nexit 0\n")).toBeNull();
  });

  it("does not mistake node_modules or prose for an invocation", () => {
    const fine = `#!/bin/bash\nPATH="$PWD/node_modules/.bin:$PATH"\nexit 0\n`;
    expect(unguardedNodeInvocation(fine)).toBeNull();
  });

  it("flags a jq invocation but not a comment explaining jq's absence", () => {
    expect(jqInvocations("#!/bin/bash\n# we do not use jq here\nexit 0\n")).toEqual([]);
    expect(jqInvocations(`#!/bin/bash\nE=$(echo "$I" | jq -r .x)\n`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The real artifact
// ---------------------------------------------------------------------------

describe("L41: the `agentboot add hook` scaffold is portable", () => {
  let tmpDir: string;
  let scaffold: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hook-scaffold-"));
    execFileSync(TSX, [CLI, "add", "hook", "portability-probe"], {
      cwd: tmpDir,
      env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
      timeout: 60_000,
    });
    scaffold = fs.readFileSync(path.join(tmpDir, "hooks", "portability-probe.sh"), "utf-8");
  }, 60_000);

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("invokes jq nowhere", () => {
    expect(
      jqInvocations(scaffold),
      "troubleshooting.md promises adopters that jq is not a requirement. A scaffold " +
      "that shells out to jq breaks that promise on Windows/git-bash, where jq is absent.",
    ).toEqual([]);
  });

  it("guards `command -v node` before the first node invocation", () => {
    expect(
      unguardedNodeInvocation(scaffold),
      "troubleshooting.md states that every hook guards node with `command -v node`. " +
      "Without the guard, a machine with no node produces an empty parse and the hook " +
      "exits 0 having enforced nothing — a green surface over a dead control, which is " +
      "worse than a hook that refuses to run. Add the guard to the scaffold emitted by " +
      "`agentboot add hook` in scripts/cli.ts, before the first `node -e`.",
    ).toBeNull();
  });
});
