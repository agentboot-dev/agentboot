/**
 * NF2-3 — a malformed policy value crashed the build with a raw TypeError.
 *
 * `managed.guardrails.denyTools: "WebFetch"` (a string where an array belongs)
 * produced, on a scaffolded hub:
 *
 *     node bin/agentboot.js build >b.txt 2>&1; echo $?   -> 1
 *     ...
 *     Unexpected error: TypeError: denyTools.map is not a function
 *       at buildComplianceHookScripts (scripts/compile.ts:2858:32)
 *       at main (scripts/compile.ts:3974:33)
 *
 * — after most of dist/ had already been written. It DID fail closed (the stamp
 * records `status: "failed"` and every gated command refuses afterwards), so
 * this is not a safety hole; it is V4's malformed-policy-value class in a
 * sibling key, reaching the operator as a stack frame instead of a diagnostic.
 *
 * The comparison that makes it a defect: the ADJACENT `permissions` key with the
 * same mistake already produced
 *   "✗ scopes/core: permissions is string, expected an object — from 00-org"
 * One key names itself and its expected type; its neighbour prints a stack
 * frame. From a stack frame in the compiler the operator cannot tell WHICH of
 * their keys is wrong.
 *
 * Two fixes: a TABLE of policy-bearing keys and their shapes (per-key checks are
 * how `permissions` got one and `denyTools` did not), and one place that turns
 * ANY loadConfig failure into a named refusal — because every config error,
 * including the ones loadConfig already checked for, was reaching the operator
 * as a stack trace. Deleting `org` from a hub config produced
 * `at main (…/scripts/compile.ts:3536:18)` before this.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { configShapeErrors, CONFIG_SHAPE } from "../scripts/lib/config.js";
import { CAPABILITY_SUPPORT } from "../scripts/lib/conformance.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
let hub = "";

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-shape-"));
  hub = path.join(base, "hub");
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

function withConfig(
  mutate: (c: Record<string, any>) => void,
  cmd = "build",
  timeoutMs = 300_000,
): { status: number; out: string; timedOut: boolean } {
  const cfgPath = path.join(hub, "agentboot.config.json");
  const original = fs.readFileSync(cfgPath, "utf-8");
  const cfg = JSON.parse(original);
  mutate(cfg);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  try {
    const r = spawnSync(process.execPath, [CLI, cmd], {
      cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: timeoutMs,
    });
    return {
      status: r.status ?? -1,
      out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
      // A command killed by the timeout produced no verdict. Reported, not
      // silently counted as a pass.
      timedOut: r.signal === "SIGTERM" || (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    };
  } finally {
    fs.writeFileSync(cfgPath, original);
  }
}

describe("NF2-3 — configShapeErrors names the key and the expected type", () => {
  it("the table is non-trivial and covers the key that crashed the build", () => {
    expect(CONFIG_SHAPE.length).toBeGreaterThan(20);
    expect(CONFIG_SHAPE.some((r) => r.path === "managed.guardrails.denyTools")).toBe(true);
  });

  it("a string where an array of strings belongs", () => {
    const e = configShapeErrors({ org: "a", managed: { guardrails: { denyTools: "WebFetch" } } });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("managed.guardrails.denyTools");
    expect(e[0]).toContain("expected an array of strings");
  });

  it("an array of NON-strings is caught too — Array.isArray is not enough", () => {
    const e = configShapeErrors({ org: "a", managed: { guardrails: { denyTools: [{ tool: "x" }] } } });
    expect(e[0]).toContain("expected an array of strings");
  });

  it("wildcards reach into per-group config, and name the group", () => {
    const e = configShapeErrors({ org: "a", groups: { platform: { permissions: "deny-everything" } } });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("groups.platform.permissions");
    expect(e[0]).toContain("expected an object");
  });

  it("EVERY wrong value is reported, not just the first", () => {
    const e = configShapeErrors({
      org: 7,
      personas: { outputFormats: "claude" },
      managed: { enabled: "yes", guardrails: { denyTools: "WebFetch" } },
    });
    expect(e.length).toBeGreaterThanOrEqual(4);
  });

  it("NEGATIVE: a well-formed config produces NOTHING", () => {
    // A checker that flags a correct config is worse than none: it teaches the
    // operator to ignore the channel.
    expect(
      configShapeErrors({
        org: "acme",
        personas: { enabled: ["a"], outputFormats: ["claude", "cursor"] },
        instructions: { enabled: [] },
        claude: { permissions: { deny: ["Bash(rm -rf *)"] }, settings: { anything: 1 } },
        managed: { enabled: true, guardrails: { denyTools: ["WebFetch"], requireAuditLog: false } },
        groups: { platform: { teams: ["api"], permissions: { allow: ["Read(x)"] } } },
      }),
    ).toEqual([]);
  });

  it("NEGATIVE: an ABSENT key is not a wrong key", () => {
    expect(configShapeErrors({ org: "acme" })).toEqual([]);
  });
});

describe("NF2-3 — the operator gets a diagnostic, never a stack frame", () => {
  const STACK_FRAME = /^\s+at [A-Za-z_$][\w$.]* \(/m;

  it("malformed denyTools: named key, named type, no stack trace", () => {
    const r = withConfig((c) => { c.managed = { enabled: true, guardrails: { denyTools: "WebFetch" } }; });
    expect(r.status).toBe(1);
    expect(r.out).toContain("managed.guardrails.denyTools");
    expect(r.out).toContain("expected an array of strings");
    expect(r.out, "the operator got a stack frame").not.toMatch(STACK_FRAME);
    expect(r.out).not.toContain("denyTools.map is not a function");
  }, 300_000);

  it("a config error loadConfig ALREADY checked for is no longer a stack trace either", () => {
    // Deleting `org` hit an existing loadConfig throw with no handler. The
    // class was never denyTools-specific.
    const r = withConfig((c) => { delete c.org; }, "validate");
    expect(r.status).toBe(1);
    expect(r.out).toContain("org");
    expect(r.out).not.toMatch(STACK_FRAME);
  }, 300_000);

  it("sync refuses the same way — one helper, three scripts", () => {
    const r = withConfig((c) => { c.managed = { enabled: true, guardrails: { denyTools: "WebFetch" } }; }, "sync");
    expect(r.status).toBe(1);
    expect(r.out).not.toMatch(STACK_FRAME);
  }, 300_000);

  it("NEGATIVE: a well-formed hub still builds", () => {
    const r = withConfig(() => { /* unchanged */ });
    expect(r.status, r.out).toBe(0);
  }, 300_000);

  /**
   * NF4-3 — the previous commit claimed "one helper, and a test that runs every
   * command ... so a fourth cannot word it differently", and covered three
   * commands by name.
   *
   * `drift-check`, `conformance` and `baseline` still delivered a config error
   * as an uncaught throw. Measured on a hub with
   * `managed.guardrails.denyTools: "WebFetch"`:
   *
   *     drift-check=7  conformance=7  baseline=7   (stack trace, `throw err;`,
   *                                                 "Node.js v25.8.1")
   *     build/doctor/status/audit/validate/sync/lint/cost-estimate/
   *     evidence-pack/export/mcp-pin/verify-manifest/install-user/test = 1
   *
   * `baseline` is the instructive one: it HAD a guard —
   * `fs.existsSync(path) ? loadConfig(path) : null` — which answers "is there a
   * hub" and not "is the hub readable". A guard for the adjacent question reads
   * as a guard.
   *
   * Naming three more commands would repeat the mistake, so this iterates every
   * command the CLI declares. A command added later is covered by DEFAULT rather
   * than exempt by default, which is the only form of this test that keeps the
   * claim true.
   */
  it("NF4-3: NO command turns a config error into a stack trace", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");
    const names = [...src.matchAll(/^\s*\.command\("([a-z][a-z-]*)"/gm)].map((m) => m[1]!);
    expect(names.length, "the command enumeration found nothing — a vacuous check").toBeGreaterThan(10);

    // `install`/`uninstall` mutate the machine; `mcp-server` blocks on stdio;
    // `test`, `optimize` and `judge` drive an LLM. Excluded BY NAME so the
    // exclusion is visible and has to be extended deliberately, rather than by a
    // filter that could quietly grow to cover the next offender.
    // `import` is excluded for a DIFFERENT reason and it is worth naming: it
    // drives an LLM extraction pass and does not terminate inside a bounded
    // window even with stdin closed. Verified by hand on the same malformed hub
    // that it does not reach a config load before that point.
    const MANUAL = ["install", "uninstall", "mcp-server", "test", "optimize", "judge", "import"];
    const offenders: string[] = [];
    const unverified: string[] = [];
    for (const cmd of names) {
      if (MANUAL.includes(cmd)) continue;
      const r = withConfig((c) => {
        c.managed = { enabled: true, guardrails: { denyTools: "WebFetch" } };
      }, cmd, 60_000);
      // A command that never returned produced no verdict. Silence is not
      // success: it is reported rather than counted as a pass.
      if (r.timedOut) { unverified.push(cmd); continue; }
      // The contract is about HOW it fails, not whether: some commands
      // legitimately succeed without reading the hub config.
      if (STACK_FRAME.test(r.out) || r.status === 7) {
        offenders.push(`${cmd} (exit ${r.status})`);
      }
    }
    expect(
      offenders,
      "these commands report a config error as an uncaught throw — raw stack trace, exit 7",
    ).toEqual([]);
    expect(
      unverified,
      "these commands did not return inside the timeout, so nothing was proven about them — " +
        "add them to MANUAL with a reason, or make them terminate",
    ).toEqual([]);
  }, 900_000);
});


/**
 * NEW-3 — the table was the second hand-maintained list it says it is avoiding.
 *
 * CONFIG_SHAPE listed policy-bearing LEAVES for managed.guardrails.* and
 * claude.permissions.* and only the CONTAINERS for compliance.*, so the exact
 * defect it was written to close was live one key over, inside the table
 * itself: `compliance.inputScan.scannerCommand: ["/bin/scan"]` reached the
 * operator as a raw Node stack trace —
 *
 *     TypeError: cmd.trim is not a function
 *         at sanitizeScanner (scripts/compile.ts:2676:16)
 *         at buildComplianceHookScripts (scripts/compile.ts:2678:24)
 *
 * — while the sibling `managed.guardrails.denyTools: "WebFetch"` in the same hub
 * gave a named refusal. And the only structural assertion here was
 * `CONFIG_SHAPE.length > 20` plus the presence of denyTools, so nothing could
 * notice.
 *
 * The commit that added the table argued for "a table, not a check per key, for
 * the standing reason: per-key checks are how permissions got one and denyTools
 * did not". That argument holds only if the table is COMPLETE. Completeness is
 * now derived from CAPABILITY_SUPPORT — the other list that enumerates
 * policy-bearing config — rather than maintained by hand, because two lists that
 * must agree will drift.
 */
describe("NEW-3 — CONFIG_SHAPE is complete against the capability table", () => {
  /** `groups[].permissions.deny` is written `groups.*.permissions.deny` here. */
  const toShapePath = (row: { id: string; configPath?: string | null }): string | null =>
    row.configPath === undefined ? row.id.replace(/\[\]/g, ".*").replace(/\.\.+/g, ".") : row.configPath;

  it("every capability row that names a config key has a CONFIG_SHAPE rule", () => {
    const missing = CAPABILITY_SUPPORT
      .map((r) => ({ id: r.id, p: toShapePath(r) }))
      .filter((x) => x.p !== null && !CONFIG_SHAPE.some((s) => s.path === x.p))
      .map((x) => `${x.id} (expected CONFIG_SHAPE path "${x.p}")`);
    expect(
      missing,
      "these keys are policy-bearing enough to have a capability row and are NOT type-checked, " +
        "so the wrong type reaches the operator as a stack trace out of the emitter",
    ).toEqual([]);
  });

  it("every declared configPath resolves — a typo would exempt the row silently", () => {
    // The failure one level up: `configPath: "complaince.inputScan"` would make
    // the check above vacuous for that row rather than failing.
    for (const row of CAPABILITY_SUPPORT) {
      if (row.configPath === undefined || row.configPath === null) continue;
      expect(
        CONFIG_SHAPE.some((s) => s.path === row.configPath),
        `${row.id} declares configPath "${row.configPath}", which is not in CONFIG_SHAPE`,
      ).toBe(true);
    }
  });

  it("the exclusions are exactly the non-hub-config scopes, named", () => {
    // `configPath: null` is an escape hatch, so it is enumerated rather than
    // trusted: anything new that opts out has to be added here deliberately.
    const excluded = CAPABILITY_SUPPORT.filter((r) => r.configPath === null).map((r) => r.id).sort();
    expect(excluded).toEqual([
      "gotchas[].paths",              // artifact frontmatter
      "instructions[].applyTo",       // artifact frontmatter
      "personas[*].disallowedTools",  // persona.config.json
      "personas[*].hooks",            // persona.config.json
      "personas[*].mcpServers",       // persona.config.json
      "personas[*].tools",            // persona.config.json
    ]);
  });

  it("every compliance LEAF is typed, not just its container", () => {
    // The specific gap, named, so a future prune of the completeness check
    // cannot quietly take these with it.
    for (const leaf of [
      "compliance.inputScan.scannerCommand",
      "compliance.inputScan.failMode",
      "compliance.outputScan.scannerCommand",
      "compliance.outputScan.failMode",
      "compliance.outputScan.blocking",
    ]) {
      expect(CONFIG_SHAPE.some((r) => r.path === leaf), `${leaf} is untyped`).toBe(true);
    }
  });
});

/**
 * R4-1 — the completeness invariant is derived from CAPABILITY_SUPPORT, and one
 * class of policy key is structurally invisible to it.
 *
 * CAPABILITY_SUPPORT answers "which PLATFORM emits this key". `output
 * .tokenBudget` is platform-independent — it is a gate over the composed
 * persona — so it can never have a row, so the derived check can never require
 * it to be typed. It was not, and the consequence is the same one CONFIG_SHAPE
 * exists to prevent, on the one key in the config that FAILS A BUILD:
 *
 *     failAt: 200            BUILD_EXIT=1, all four over-budget personas named
 *     failAt: "200 tokens"   BUILD_EXIT=0, zero mentions of failAt
 *     failAt: {"nope":1}     BUILD_EXIT=0, zero mentions of failAt
 *     tokenBudget: 200       BUILD_EXIT=0, and warnAt silently reverts to 8000
 *
 * `estimatedTokens > tokenFailAt` against a non-number is NaN, and NaN
 * comparisons are false — so an operator's opt-in CI gate is off and nothing
 * says so. Fail-open on unknown data, in the shape the branch is named for.
 *
 * Enumerated by hand HERE and nowhere else, because the alternative is a second
 * derived list that would have the same blind spot as the first.
 */
describe("R4-1 — the build-failing budget gate is type-checked", () => {
  it("every output.tokenBudget leaf is typed", () => {
    for (const leaf of ["output.tokenBudget", "output.tokenBudget.warnAt", "output.tokenBudget.failAt"]) {
      expect(CONFIG_SHAPE.some((r) => r.path === leaf), `${leaf} is untyped`).toBe(true);
    }
  });

  it("a non-numeric failAt is REFUSED by name, not silently coerced to no gate", () => {
    for (const bad of ["200 tokens", { nope: 1 }, ["200"], true]) {
      const errors = configShapeErrors({ org: "acme", output: { tokenBudget: { failAt: bad } } });
      expect(
        errors.some((e) => e.includes("output.tokenBudget.failAt")),
        `failAt: ${JSON.stringify(bad)} produced no named error — the gate is off and silent`,
      ).toBe(true);
    }
  });

  it("a non-numeric warnAt is refused too — four over-budget personas warned zero times", () => {
    const errors = configShapeErrors({ org: "acme", output: { tokenBudget: { warnAt: "tiny" } } });
    expect(errors.some((e) => e.includes("output.tokenBudget.warnAt"))).toBe(true);
  });

  it("tokenBudget as a scalar is refused — it silently reverted warnAt to the default", () => {
    const errors = configShapeErrors({ org: "acme", output: { tokenBudget: 200 } });
    expect(errors.some((e) => e.includes("output.tokenBudget"))).toBe(true);
  });

  it("a well-formed budget still passes — the gate must not become noise", () => {
    const errors = configShapeErrors({ org: "acme", output: { tokenBudget: { warnAt: 8000, failAt: 12000 } } });
    expect(errors).toEqual([]);
  });
});
