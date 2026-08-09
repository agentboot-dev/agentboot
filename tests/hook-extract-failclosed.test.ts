/**
 * R4V-1 — the blocking hook gates failed OPEN on a payload they could not read.
 *
 * `process.stdout.write(j.prompt||'')` never throws, so the extractor's own
 * try/catch could never fire. A payload with no `prompt` field — `{}`, or a
 * renamed/misspelled field, which is what a wrongly-framed payload actually
 * looks like — was scanned as an EMPTY STRING and exited 0. On a blocking DLP
 * gate. The object-shape guard added one round earlier stopped `42`/`"x"`/`[]`
 * but not `{}`, so the hole survived a fix aimed at it.
 *
 * The distinction the fix encodes: an ABSENT field is a payload we do not
 * understand (fail closed); an EMPTY STRING is a genuinely empty prompt (pass).
 * Losing that distinction in either direction is a defect — hence the negative
 * cases below, which matter as much as the positive ones.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(__dirname, "..");

function buildHooks(): { inputScan: string; preToolUse: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-failclosed-"));
  execFileSync("node", [path.join(REPO, "bin", "agentboot.js"), "install",
    "--hub", "--org", "acme", "--path", path.join(dir, "hub"),
    "--non-interactive", "--skip-sync"], { stdio: "ignore" });
  const hub = path.join(dir, "hub");
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.compliance = { inputScan: { blocking: true }, outputScan: { blocking: true } };
  cfg.managed = { enabled: true, guardrails: { denyTools: ["Bash"] } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  execFileSync("node", [path.join(REPO, "bin", "agentboot.js"), "build"], { cwd: hub, stdio: "ignore" });
  const hooks = path.join(hub, "dist", "plugin", "hooks");
  return {
    inputScan: path.join(hooks, "agentboot-input-scan.sh"),
    preToolUse: path.join(hooks, "agentboot-pretooluse.sh"),
  };
}

/** Run a hook with `payload` on stdin; return its exit code. */
function run(hook: string, payload: string): number {
  try {
    execFileSync("bash", [hook], { input: payload, stdio: ["pipe", "ignore", "ignore"] });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

describe("blocking hook gates fail CLOSED on an unreadable payload", () => {
  const hooks = buildHooks();

  it("input-scan blocks an object with no prompt field", () => {
    // The exact payload that used to exit 0 while scanning nothing.
    expect(run(hooks.inputScan, "{}")).toBe(2);
  });

  it("input-scan blocks a misspelled/renamed field", () => {
    // Carries a credential the gate exists to catch, under the wrong key.
    expect(run(hooks.inputScan, '{"promt":"password: hunter2"}')).toBe(2);
  });

  it("input-scan blocks a non-string prompt", () => {
    expect(run(hooks.inputScan, '{"prompt":42}')).toBe(2);
    expect(run(hooks.inputScan, '{"prompt":null}')).toBe(2);
  });

  it("pretooluse blocks an object with no tool_name", () => {
    expect(run(hooks.preToolUse, "{}")).toBe(2);
  });

  it("pretooluse blocks an EMPTY tool name", () => {
    // Stricter than the prompt case deliberately: an empty tool name matches no
    // DENY_PATTERNS entry, so every deny rule would silently pass.
    expect(run(hooks.preToolUse, '{"tool_name":""}')).toBe(2);
  });

  // --- the negative cases: over-blocking is also a defect -------------------

  it("input-scan PASSES a legitimately empty prompt", () => {
    // Empty is not unreadable. If this ever returns 2, the fix has become an
    // outage rather than a gate.
    expect(run(hooks.inputScan, '{"prompt":""}')).toBe(0);
  });

  it("input-scan PASSES a clean prompt", () => {
    expect(run(hooks.inputScan, '{"prompt":"hello world"}')).toBe(0);
  });

  it("pretooluse PASSES a tool that is not denied", () => {
    expect(run(hooks.preToolUse, '{"tool_name":"Read"}')).toBe(0);
  });
});

/**
 * R4N-1 — the fix for the applyTo inversion (F-6) reintroduced F-6.
 *
 * Anchoring the key at column 0 is correct: matching at any indent lets a
 * `description: |` whose prose mentions applyTo be read as the glob. But the
 * consequence was that an INDENTED applyTo produced `raw === null`, which means
 * "no scope declared", which means ALWAYS-ON — a narrowing directive delivered
 * as its opposite, at build exit 0, with no diagnostic. That is F-6 exactly.
 *
 * The fix keeps the anchor and removes the silence.
 */
describe("R4N-1: an indented applyTo is refused, not silently inverted", () => {
  it("flags an indented key instead of returning always-on", async () => {
    const { inspectScope } = await import("../scripts/lib/scope-projection.js");
    const r = inspectScope('---\n  description: x\n  applyTo: "src/**"\n---\n# b\n');
    expect(r.malformed).not.toBeNull();
    expect(r.alwaysOn).toBe(false); // fail closed — the degradation gate must fire
  });

  it("does NOT flag applyTo appearing inside a block scalar", async () => {
    // The false positive the column-0 anchor exists to prevent. If this ever
    // fails, the fix has traded one silent inversion for a noisy one.
    const { inspectScope } = await import("../scripts/lib/scope-projection.js");
    const r = inspectScope('---\ndescription: |\n  set applyTo: "src/**" to scope it\n---\n# b\n');
    expect(r.malformed).toBeNull();
    expect(r.alwaysOn).toBe(true);
  });

  it("leaves a genuinely unscoped artifact always-on and unflagged", async () => {
    const { inspectScope } = await import("../scripts/lib/scope-projection.js");
    const r = inspectScope("---\ndescription: x\n---\n# b\n");
    expect(r.malformed).toBeNull();
    expect(r.alwaysOn).toBe(true);
  });

  it("still reads a normal column-0 scope", async () => {
    const { inspectScope } = await import("../scripts/lib/scope-projection.js");
    const r = inspectScope('---\ndescription: x\napplyTo: "src/**"\n---\n# b\n');
    expect(r.malformed).toBeNull();
    expect(r.alwaysOn).toBe(false);
    expect(r.globs).toContain("src/**");
  });
});

/**
 * NEW4-1 — the read side learned to span a wrapped flow sequence; the write side
 * did not, so it emitted INVALID YAML.
 *
 *     applyTo: [
 *       "src/**",
 *     ]          <- closes at the KEY's indent, so the indent-based consume
 *                   loop stopped short and left this `]` behind
 *
 * The orphan reached Copilot and JetBrains — both v1.0 GA platforms. A reader
 * and a writer that disagree about where a value ends is the same class of split
 * that produced F-6.
 */
describe("NEW4-1: the rewriter consumes wrapped flow sequences", () => {
  const orphaned = (fm: string) => /^\s*[[\]]\s*$/m.test(fm);
  const frontmatter = (s: string) => /^---\n([\s\S]*?)\n---/.exec(s)?.[1] ?? "";

  async function rewrite(doc: string): Promise<string> {
    const { rewriteFrontmatterKeyBlock } = await import("../scripts/lib/scope-projection.js");
    return frontmatter(rewriteFrontmatterKeyBlock(doc, "applyTo", null));
  }

  it("leaves no orphaned bracket for a wrapped flow sequence", async () => {
    const fm = await rewrite('---\ndescription: x\napplyTo: [\n  "src/**",\n  "lib/**"\n]\nother: keep\n---\n# b\n');
    expect(orphaned(fm)).toBe(false);
    expect(fm).toContain("other: keep"); // and it did not eat the next key
  });

  it("does not miscount brackets inside a glob character class", async () => {
    // `src/[abc]*.ts` is a legitimate glob. Counting its brackets would run the
    // depth negative and stop consuming early.
    const fm = await rewrite('---\ndescription: x\napplyTo: [\n  "src/[abc]*.ts"\n]\nother: keep\n---\n# b\n');
    expect(orphaned(fm)).toBe(false);
    expect(fm).toContain("other: keep");
  });

  it("still handles the inline, block-sequence and plain forms", async () => {
    for (const doc of [
      '---\ndescription: x\napplyTo: ["src/**"]\nother: keep\n---\n# b\n',
      '---\ndescription: x\napplyTo:\n  - "src/**"\n  - "lib/**"\nother: keep\n---\n# b\n',
      '---\ndescription: x\napplyTo: "src/**"\nother: keep\n---\n# b\n',
    ]) {
      const fm = await rewrite(doc);
      expect(orphaned(fm)).toBe(false);
      expect(fm).toContain("other: keep");
      expect(fm).not.toContain("applyTo");
    }
  });
});
