/**
 * E9 revocation & fail-open repros — the CI defence for five behaviours that
 * were fixed, hand-verified, and then left with nothing pinning them.
 *
 * Each `describe` below replays the ORIGINAL failing sequence of one defect and
 * asserts the behaviour that replaced it. Every one of the five is a revocation
 * or fail-open failure that had already regressed at least once on this branch,
 * and every one was confirmed correct only by a human running the sequence by
 * hand — which is a proof that expires the moment the next commit lands.
 *
 * These are ABSENCE and REFUSAL assertions, the easiest kind to write vacuously
 * (this branch has already shipped a tamper test that tampered with nothing). So
 * every case here also asserts its own PRECONDITION — that the artifact was
 * really delivered, that the command really succeeds on a healthy tree — so a
 * change that makes the whole sequence a no-op fails here instead of passing
 * quietly.
 *
 * Ledger rows L7, L8, L10, L11, L12 (docs/plans/ga-cut-list). The neighbouring
 * suites (dist-pruning, dist-freshness, dist-freshness-consumers, managed-merge,
 * capability-*, scope-projection) pin the units and the individual branches;
 * what was missing, and what this file adds, is the end-to-end sequence as the
 * operator ran it when the defect was found.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { mergeHooks } from "../scripts/lib/managed-merge.js";
import { inspectScope } from "../scripts/lib/scope-projection.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Run the real CLI. Status is read WITHOUT a pipe — a piped `$?` is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scaffoldHub(tag: string): { base: string; hub: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `agentboot-e9-${tag}-`));
  const hub = path.join(base, "hub");
  const r = spawnSync(
    "node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 180_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);
  return { base, hub };
}

function mkSpoke(base: string, name = "spoke"): string {
  const spoke = path.join(base, name);
  fs.mkdirSync(spoke, { recursive: true });
  fs.writeFileSync(path.join(spoke, ".keep"), "");
  spawnSync("git", ["init", "-q", "."], { cwd: spoke });
  return spoke;
}

function editConfig(hub: string, fn: (c: Record<string, any>) => void): void {
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  fn(c);
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

function findAll(root: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pattern.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// L7 — `dist/` was never pruned, so revocation did not reach the spoke
// ---------------------------------------------------------------------------

describe("L7 — a revoked control is withdrawn from dist/ AND from the spoke", () => {
  /**
   * The original: `compile` only ever WROTE into `dist/` and `sync` only ever
   * wrote into a spoke, so withdrawing an artifact at the hub left it shipping
   * from both — behind a green build, a green sync, a green `drift-check` and a
   * signed manifest that correctly attested the stale bytes had arrived intact.
   *
   * Two withdrawals in one sequence, because the two are separate code paths and
   * each shipped its own regression: a RETIRED PLATFORM (a whole tree) and a
   * REVOKED ARTIFACT (one file inside a live tree).
   */
  it("narrowing outputFormats, then revoking an instruction, reaches the spoke both times", () => {
    const { base, hub } = scaffoldHub("l7");
    const spoke = mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude", scope: "core" }], null, 2),
    );

    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);

    // PRECONDITIONS. Without these the absence assertions below are satisfied by
    // a sync that delivered nothing at all.
    const agentsMd = path.join(spoke, "AGENTS.md");
    expect(fs.existsSync(agentsMd)).toBe(true);
    expect(findAll(spoke, /^security\.instructions/).length).toBeGreaterThan(0);
    expect(findAll(path.join(hub, "dist"), /^security\.instructions/).length).toBeGreaterThan(0);

    // ---- withdrawal 1: retire three platforms -----------------------------
    editConfig(hub, (c) => { c.personas.outputFormats = ["claude"]; });

    const build1 = ab(["build"], hub);
    expect(build1.status).toBe(0);
    expect(build1.out).toMatch(/Pruned \d+ retired platform tree\(s\)/);
    for (const gone of ["agents", "copilot", "skill"]) {
      expect(fs.existsSync(path.join(hub, "dist", gone))).toBe(false);
    }

    const sync1 = ab(["sync"], hub);
    expect(sync1.status).toBe(0);
    expect(sync1.out).toMatch(/removed/);
    // The spoke stops carrying the retired platform's artifact. This is the half
    // the hub-side prune tests cannot see.
    expect(fs.existsSync(agentsMd)).toBe(false);

    // ---- withdrawal 2: revoke one instruction -----------------------------
    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });

    const build2 = ab(["build"], hub);
    expect(build2.status).toBe(0);
    // The report must NAME what it withdrew — a count is not a record.
    expect(build2.out).toContain("security.instructions");
    expect(findAll(path.join(hub, "dist"), /^security\.instructions/)).toEqual([]);

    const sync2 = ab(["sync"], hub);
    expect(sync2.status).toBe(0);
    expect(findAll(spoke, /^security\.instructions/)).toEqual([]);
    // …and the control that was NOT revoked is still there, so this is a
    // withdrawal and not a wipe.
    expect(findAll(spoke, /^baseline\.instructions/).length).toBeGreaterThan(0);

    // Nothing is outstanding, so the honesty surface is green — the gate is a
    // detector, not a permanent alarm.
    expect(ab(["drift-check"], hub).status).toBe(0);
  }, 300_000);

  /**
   * The other half of the acceptance: `drift-check` must NOT report clean while
   * a withdrawn control is still live in a spoke. A `retain` rule is the case
   * that makes this reachable at exit 0 on the sync itself — sync deliberately
   * honours the operator's "never delete this", which means the residue is
   * expected and the REPORT is the only thing standing between the operator and
   * a revoked rule that is still running.
   */
  it("a revoked-but-retained artifact keeps drift-check from reporting clean", () => {
    const { base, hub } = scaffoldHub("l7-retain");
    const spoke = mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify(
        [{
          name: "spoke", path: "../spoke", platform: "claude", scope: "core",
          retain: ["\\.claude/rules/security\\.instructions\\.md"],
        }],
        null, 2,
      ),
    );
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);

    const victim = path.join(spoke, ".claude", "rules", "security.instructions.md");
    expect(fs.existsSync(victim)).toBe(true);
    // PRECONDITION: clean before the revocation, or "not clean" proves nothing.
    expect(ab(["drift-check"], hub).status).toBe(0);

    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });
    expect(ab(["build"], hub).status).toBe(0);

    const sync = ab(["sync"], hub);
    expect(sync.status).toBe(0);                     // the retain rule is honoured…
    expect(sync.out).toMatch(/retained/i);           // …but never silently
    expect(fs.existsSync(victim)).toBe(true);

    const drift = ab(["drift-check"], hub);
    expect(drift.status).toBe(1);
    expect(drift.out).toMatch(/retired-but-present/);
    expect(drift.out).not.toMatch(/1\/1 clean/);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// L8 (N1) — a FAILED build left a stale dist/ and sync shipped it
// ---------------------------------------------------------------------------

describe("L8 — after a failed build, every reporting surface refuses", () => {
  /**
   * The original sequence, in one edit: revoke a control, retire a platform, and
   * trip a build gate. The build exits 1 and — correctly, by design — leaves the
   * previous `dist/` byte-identical. What was missing is that the tree then
   * stopped CLAIMING to be current: `sync` printed "skipped (no changes)" at
   * exit 0 and shipped the superseded policy, and `drift-check`/`audit` reported
   * green over it.
   *
   * The forbidden string is asserted literally. "skipped (no changes)" is what
   * the operator read while the withdrawn control was still being delivered.
   */
  it("sync, drift-check and audit each refuse, citing the failed build", () => {
    const { base, hub } = scaffoldHub("l8");
    mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude", scope: "core" }], null, 2),
    );

    expect(ab(["build"], hub).status).toBe(0);
    // PRECONDITIONS: all three work against a fresh tree. Without this the
    // refusals below cannot be told apart from three broken commands.
    expect(ab(["sync"], hub).status).toBe(0);
    expect(ab(["drift-check"], hub).status).toBe(0);
    expect(ab(["audit"], hub).status).toBe(0);

    // ONE edit: a control revoked, a platform retired, and a malformed hook
    // fragment that trips the managed-merge gate.
    editConfig(hub, (c) => {
      c.instructions.enabled = ["baseline.instructions"];
      c.personas.outputFormats = ["claude", "skill"];
      c.claude = { hooks: { PreToolUse: "not-an-array" } };
    });

    const build = ab(["build"], hub);
    expect(build.status).toBe(1);
    expect(build.out).toMatch(/expected an array/);

    // The tree survived (F-1) — and that is exactly why the stamp matters.
    const stamp = JSON.parse(
      fs.readFileSync(path.join(hub, "dist", ".agentboot-build.json"), "utf-8"),
    );
    expect(stamp.status).toBe("failed");
    expect(findAll(path.join(hub, "dist"), /^security\.instructions/).length).toBeGreaterThan(0);

    for (const cmd of ["sync", "drift-check", "audit"]) {
      const r = ab([cmd], hub);
      expect(r.status, `${cmd} must refuse a failed tree`).toBe(1);
      expect(r.out).toContain(`refusing to run \`${cmd}\` against a stale dist/`);
      expect(r.out).toMatch(/failed/);
      // The verbatim shape of the original defect.
      expect(r.out).not.toContain("skipped (no changes)");
    }

    // NON-VACUITY: repair the fragment, rebuild, and all three come back. A gate
    // that never lifts is an outage, and would pass the assertions above.
    editConfig(hub, (c) => { delete c.claude; });
    expect(ab(["build"], hub).status).toBe(0);
    for (const cmd of ["sync", "drift-check", "audit"]) {
      expect(ab([cmd], hub).status, `${cmd} must recover after a good build`).toBe(0);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// L10 — a test PINNED a fail-open as intended behaviour
// ---------------------------------------------------------------------------

describe("L10 — the two fail-opens a passing test used to protect", () => {
  /**
   * Half 1. A non-array hook event value became `[]` — the event was DESTROYED
   * and the empty bucket still created the key, so the build log then reported
   * that event as "unioned" into `managed-settings.json`, the file a developer
   * cannot override. A positive claim about a control that had been deleted.
   */
  it("mergeHooks reports a non-array event as malformed and never as an empty bucket", () => {
    const cases: Array<[unknown, string]> = [
      ["not-an-array", "string"],
      [null, "null"],
      [7, "number"],
      [{ nested: true }, "object"],
    ];
    for (const [value, found] of cases) {
      const r = mergeHooks([{ hooks: { X: value } }], ["00-org"]);
      expect(r.malformed, `${found} must be reported`).toEqual([
        { event: "X", source: "00-org", found },
      ]);
      // The empty bucket is the defect: `{X: []}` is the ABSENCE of the control
      // written into the non-overridable artifact.
      expect(r.hooks).toBeUndefined();
    }

    // NON-VACUITY: a well-formed event still merges, and reports nothing.
    const ok = mergeHooks(
      [{ hooks: { X: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo" }] }] } }],
      ["00-org"],
    );
    expect(ok.malformed).toEqual([]);
    expect(ok.hooks?.X).toHaveLength(1);
  });

  /**
   * Half 2. A CRLF and/or BOM artifact carrying a NARROW `applyTo:` read as
   * having no frontmatter at all, and the unreadable-scope path resolves to
   * `{globs: [], alwaysOn: true}` — so a rule scoped to one directory inverted
   * into a rule that applies everywhere, which is the widest possible reading of
   * the author's narrowest possible instruction.
   */
  it("a CRLF+BOM artifact yields its declared globs, never alwaysOn", () => {
    const BOM = "\uFEFF";
    const variants: Array<[string, string, string[]]> = [
      ["LF (control)", `---\napplyTo: "src/api/**"\n---\n# x\n`, ["src/api/**"]],
      ["CRLF+BOM", `${BOM}---\r\napplyTo: "src/api/**"\r\n---\r\n# x\r\n`, ["src/api/**"]],
      ["lone CR+BOM", `${BOM}---\rapplyTo: "src/api/**"\r---\r# x\r`, ["src/api/**"]],
      [
        "CRLF+BOM flow sequence",
        `${BOM}---\r\napplyTo:\r\n  - "src/api/**"\r\n  - "src/db/**"\r\n---\r\n# x\r\n`,
        ["src/api/**", "src/db/**"],
      ],
    ];
    for (const [label, content, globs] of variants) {
      const r = inspectScope(content);
      expect(r.globs, label).toEqual(globs);
      expect(r.alwaysOn, label).toBe(false);
    }

    // NON-VACUITY: a genuinely unscoped artifact must still read alwaysOn, in
    // both line endings. If it did not, this check would pass on a projection
    // that had stopped reporting always-on at all.
    expect(inspectScope(`---\ndescription: x\n---\n# x\n`).alwaysOn).toBe(true);
    expect(inspectScope(`\uFEFF---\r\ndescription: x\r\n---\r\n# x\r\n`).alwaysOn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// L11 — eight configured capabilities dropped with nothing said
// ---------------------------------------------------------------------------

describe("L11 — configured capabilities no output format can honour fail the build", () => {
  /**
   * The original: emission was decided by eleven independent
   * `outputFormats.includes(...)` tests scattered across the compiler, each with
   * an empty `else`. A capability whose gate was false produced no file, no log
   * line and no record that it had ever been requested — eight of them passed
   * `build`, `validate --strict` AND `doctor` with zero mention.
   *
   * All eight are configured here at once against `outputFormats: ["skill"]`,
   * which can honour none of them, because the defect was a per-key blind spot:
   * a gate that catches seven and drops the eighth reproduces it exactly.
   */
  const EIGHT = [
    "claude.hooks",
    "claude.permissions.deny",
    "claude.permissions.allow",
    "claude.mcpServers",
    "claude.settings",
    "mcp.enforceApproved",
    "managed.guardrails.disableBypassPermissions",
    "managed.guardrails.forcePlugins",
  ];

  function configureEight(hub: string): void {
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["skill"];
      c.claude = {
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
        permissions: { deny: ["Bash(rm -rf *)"], allow: ["Read"] },
        mcpServers: { demo: { command: "demo" } },
        settings: { model: "opus" },
      };
      c.mcp = { enforceApproved: true, approved: ["demo"] };
      c.managed = { guardrails: { disableBypassPermissions: true, forcePlugins: ["some-plugin"] } };
    });
  }

  const errorCount = (out: string): number => {
    const m = /Build failed: (\d+) configured capability/.exec(out);
    return m ? Number(m[1]) : -1;
  };

  it("all eight are named with an `emitted by:` line and the build exits non-zero", () => {
    const { hub } = scaffoldHub("l11");
    // PRECONDITION: the default hub builds green, so the failure below is the
    // capability gate and not a broken scaffold.
    expect(ab(["build"], hub).status).toBe(0);

    configureEight(hub);
    const build = ab(["build"], hub);
    expect(build.status).toBe(1);

    for (const id of EIGHT) {
      // Named AND accompanied by where it would have been emitted — the id
      // alone does not tell the operator which platform to add.
      expect(build.out, id).toMatch(
        new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+emitted by: \\S`),
      );
    }
    // The key that is implemented nowhere must say so, rather than naming a
    // platform the operator could add.
    expect(build.out).toMatch(/managed\.guardrails\.forcePlugins\s+emitted by: NOTHING/);
    expect(errorCount(build.out)).toBe(5);
  }, 300_000);

  it("an exception downgrades EXACTLY one, naming owner and expiry, and the expiry is real", () => {
    const { hub } = scaffoldHub("l11-ex");
    configureEight(hub);
    expect(errorCount(ab(["build"], hub).out)).toBe(5);

    const exceptions = path.join(hub, "agentboot-exceptions.json");
    const entry = (expires: string) => ([{
      id: "EX-2026-014",
      policy: "capability:claude.hooks",
      reason: "pilot platform lands next sprint",
      approver: "A. Approver",
      owner: "P. Owner",
      created: "2026-08-01",
      expires,
    }]);

    fs.writeFileSync(exceptions, JSON.stringify(entry("2099-12-31"), null, 2));
    const waived = ab(["build"], hub);
    expect(waived.out).toMatch(/1 capability gap\(s\) accepted under an active exception/);
    expect(waived.out).toMatch(/claude\.hooks — EX-2026-014 \(owner: P\. Owner, expires 2099-12-31\)/);
    // EXACTLY one: 5 → 4. A waiver that silenced the neighbouring rows would be
    // the same defect wearing a badge.
    expect(errorCount(waived.out)).toBe(4);
    expect(waived.status).toBe(1);

    // The expiry is load-bearing, not decorative: an expired waiver is ABSENT.
    fs.writeFileSync(exceptions, JSON.stringify(entry("2020-01-01"), null, 2));
    const expired = ab(["build"], hub);
    expect(expired.out).not.toMatch(/accepted under an active exception/);
    expect(errorCount(expired.out)).toBe(5);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// L12 — a HARD guardrail declared in frontmatter, silently downgraded
// ---------------------------------------------------------------------------

describe("L12 — a HARD guardrail declared only in artifact frontmatter is visible", () => {
  const HARD_ARTIFACT = [
    "---",
    "description: Sensitive data handling",
    'applyTo: "**/*"',
    "guardrail: hard",
    "---",
    "",
    "# Data handling",
    "",
    "Never write sensitive records to logs.",
    "",
  ].join("\n");

  function hubWithHardArtifact(tag: string): string {
    const { hub } = scaffoldHub(tag);
    fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
    fs.writeFileSync(
      path.join(hub, "core", "instructions", "data-handling.instructions.md"),
      HARD_ARTIFACT,
    );
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["claude", "cursor"];
      c.instructions.enabled = ["baseline.instructions", "data-handling.instructions"];
      // NO `managed.guardrails` anywhere. The original split brain was exactly
      // this: `compile` read artifact frontmatter, `doctor` derived its honesty
      // trigger from four CONFIG keys, so a hub whose only HARD declaration was
      // in an artifact got a green doctor over an unenforceable HARD policy.
    });
    return hub;
  }

  it("the build refuses, naming the artifact and the target that cannot enforce it", () => {
    const hub = hubWithHardArtifact("l12-gate");
    const build = ab(["build"], hub);
    expect(build.status).toBe(1);
    expect(build.out).toMatch(/HARD guardrails cannot be enforced on: cursor/);
    expect(build.out).toContain("data-handling.instructions");
  }, 300_000);

  it("once acknowledged, doctor reports the artifact COUNT and which platforms can enforce it", () => {
    const hub = hubWithHardArtifact("l12-doctor");
    const artifact = path.join(hub, "core", "instructions", "data-handling.instructions.md");
    fs.writeFileSync(
      artifact,
      HARD_ARTIFACT.replace("guardrail: hard\n", "guardrail: hard\nadvisory-on-unenforceable: acknowledged\n"),
    );
    expect(ab(["build"], hub).status).toBe(0);

    const doctor = ab(["doctor"], hub);
    // The count is the line that did not exist: without it the operator reads
    // only the two generic per-platform lines, learns "cursor is advisory" —
    // which they already knew — and learns nothing about a HARD artifact being
    // delivered to it.
    expect(doctor.out).toMatch(/1 artifact\(s\) declare `guardrail: hard`/);
    expect(doctor.out).toMatch(/1 acknowledged as advisory-only on unenforceable targets/);
    // …and both configured platforms are classified by name.
    expect(doctor.out).toMatch(/claude: org policy is enforceable/);
    expect(doctor.out).toMatch(/cursor: org policy is ADVISORY on this platform/);
  }, 300_000);

  it("validate --strict's HARD-guardrail label claims only what that check tests", () => {
    const hub = hubWithHardArtifact("l12-validate");
    const validate = ab(["validate", "--strict"], hub);
    const label = validate.out
      .split("\n")
      .find((l) => l.includes("HARD guardrail override protection"));
    expect(label).toBeDefined();
    // A label reading "HARD guardrail protection ✓" over a check that only
    // looks for scope shadows is the green surface this row exists to remove.
    expect(label!).toContain("does NOT test whether any target can enforce it");
    expect(label!).toContain("doctor");
  }, 300_000);
});
