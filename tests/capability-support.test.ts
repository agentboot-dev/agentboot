/**
 * Regression guards for the silent capability drop (confirmed 2026-08-08, v0.20.2).
 *
 * The defect: `compile` decided emission with eleven independent
 * `outputFormats.includes(...)` string tests scattered across 3,000 lines. Each
 * `if` was individually defensible; the `else` was empty everywhere. A
 * capability whose gate was false produced no file, no log line, and no record
 * that it had ever been requested. Eight of them — an org PreToolUse gate, a
 * fail-closed DLP scanner, a digest-pinned approved-MCP allowlist, and more —
 * passed `build`, `validate --strict` AND `doctor` with zero mention, and
 * `doctor` printed "no hard org policy configured" against a config that
 * declared one.
 *
 * `PLATFORM_ENFORCEMENT` answered "how strongly does P enforce?" but nothing
 * answered "which platforms EMIT capability C?", so the intersection of
 * configured capabilities with configured platforms was never computed — and an
 * empty intersection was indistinguishable from a correct build.
 *
 * Per the standing norm — a check that cannot fail is not a check — every rule
 * below asserts BOTH the firing case and the silent case.
 *
 * See docs/research/capability-platform-matrix-2026-08-08.md §3.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  CAPABILITY_SUPPORT,
  PLATFORM_ENFORCEMENT,
  effectiveEmitters,
  type CapabilityContext,
} from "../scripts/lib/conformance.js";
import {
  capabilityViolations, capabilityShortfalls, countNarrowlyScopedInstructions, countScopedGotchas,
} from "../scripts/lib/guardrail-scan.js";
import { capabilityExceptionFor, validateExceptions, type PolicyException } from "../scripts/lib/exceptions.js";
import { PLATFORM_REQUIRES, type AgentBootConfig } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

const VALID_FORMATS = [
  "skill", "claude", "copilot", "cursor", "agents",
  "plugin", "windsurf", "gemini", "jetbrains", "codex",
];

function ctx(config: Partial<AgentBootConfig>, extra: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    config: { org: "t", ...config } as AgentBootConfig,
    narrowlyScopedInstructions: 0,
    scopedGotchas: 0,
    ...extra,
  };
}

function ex(over: Partial<PolicyException> = {}): PolicyException {
  const yr = new Date().getUTCFullYear() + 1;
  return {
    id: "EX-TEST-1", policy: "capability:claude.hooks", reason: "pilot",
    approver: "a", owner: "mike", created: "2026-01-01", expires: `${yr}-01-01`,
    ...over,
  };
}

const HOOKS = { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/x.sh" }] }] };

// ---------------------------------------------------------------------------
// Unit — capabilityViolations
// ---------------------------------------------------------------------------

describe("capabilityViolations — the gate", () => {
  it("U1: claude.hooks with no claude target fires at error severity", () => {
    const v = capabilityViolations(ctx({ claude: { hooks: HOOKS } }), ["cursor", "agents"]);
    expect(v.map((x) => x.row.id)).toEqual(["claude.hooks"]);
    expect(v[0]!.row.severity).toBe("error");
  });

  it("U2 (NEGATIVE): claude.hooks with claude configured is exactly empty", () => {
    expect(capabilityViolations(ctx({ claude: { hooks: HOOKS } }), ["claude"])).toEqual([]);
  });

  it("U3 (NEGATIVE): one honouring target is enough — partial coverage is capabilityShortfalls'", () => {
    // H5: this gate's silence here is correct and deliberate. What was wrong is
    // that NOTHING covered the other axis — see the capabilityShortfalls block
    // below. The two must never both fire for one row, or the operator gets one
    // problem reported twice with different verdicts.
    expect(capabilityViolations(ctx({ claude: { hooks: HOOKS } }), ["cursor", "claude"])).toEqual([]);
  });

  it("U4 (NEGATIVE): an empty config produces no findings at all", () => {
    expect(capabilityViolations(ctx({}), ["cursor"])).toEqual([]);
  });

  it("U5: inputScan fires when none of its FOUR platforms is configured", () => {
    const v = capabilityViolations(
      ctx({ compliance: { inputScan: { scannerCommand: "/opt/dlp" } } }), ["cursor"],
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.row.emittedBy).toEqual(["claude", "codex", "copilot", "plugin"]);
  });

  it("U6 (NEGATIVE): the same capability is silent on copilot — the multi-platform set is really consulted", () => {
    expect(capabilityViolations(
      ctx({ compliance: { inputScan: { scannerCommand: "/opt/dlp" } } }), ["copilot"],
    )).toEqual([]);
  });

  it("U7: forcePlugins fires even on a fully-configured hub — emittedBy is empty", () => {
    // The purest instance of the class: typed, documented, accepted, and read by
    // no code path. It can never be resolved by adding a platform.
    const v = capabilityViolations(
      ctx({ managed: { guardrails: { forcePlugins: ["x"] } } }), VALID_FORMATS,
    );
    expect(v.map((x) => x.row.id)).toEqual(["managed.guardrails.forcePlugins"]);
  });

  it("U8 (NEGATIVE): forcePlugins absent is silent", () => {
    expect(capabilityViolations(ctx({ managed: { guardrails: {} } }), ["claude"])).toEqual([]);
  });

  it("U9: an active exception is returned WITH waivedBy, not swallowed", () => {
    // Still returned, so the caller can print the waiver. A silent waiver is the
    // same defect wearing a badge.
    const v = capabilityViolations(ctx({ claude: { hooks: HOOKS } }), ["cursor"], [ex()]);
    expect(v).toHaveLength(1);
    expect(v[0]!.waivedBy?.id).toBe("EX-TEST-1");
  });

  it("U10: an EXPIRED exception is absent — expiry is the whole feature", () => {
    const active = validateExceptions([ex({ expires: "2020-01-01" })]).active;
    expect(active).toHaveLength(0);
    const v = capabilityViolations(ctx({ claude: { hooks: HOOKS } }), ["cursor"], active);
    expect(v[0]!.waivedBy).toBeUndefined();
  });

  it("U11: multiple capabilities are returned in CAPABILITY_SUPPORT declaration order", () => {
    const v = capabilityViolations(ctx({
      claude: { hooks: HOOKS, permissions: { allow: ["Read"], deny: ["WebFetch"] } },
      compliance: { inputScan: { scannerCommand: "/opt/dlp" } },
      managed: { guardrails: { forcePlugins: ["x"] } },
    }), ["cursor", "agents"]);
    const ids = v.map((x) => x.row.id);
    const declOrder = CAPABILITY_SUPPORT.map((r) => r.id).filter((id) => ids.includes(id));
    expect(ids).toEqual(declOrder);
    expect(ids).toContain("claude.permissions.deny");
    expect(ids).toContain("managed.guardrails.forcePlugins");
  });

  it("U12: a narrowly-scoped instruction fires row 14 at warn severity", () => {
    const v = capabilityViolations(ctx({}, { narrowlyScopedInstructions: 1 }), ["cursor"]);
    expect(v.map((x) => x.row.id)).toEqual(["instructions[].applyTo"]);
    expect(v[0]!.row.severity).toBe("warn");
  });

  it("U13 (NEGATIVE): a universal applyTo is not narrowing, so nothing fires", () => {
    // The highest-value negative: every default hub is this shape.
    expect(capabilityViolations(ctx({}, { narrowlyScopedInstructions: 0 }), ["cursor"])).toEqual([]);
  });

  it("U14 (NEGATIVE): copilot honours applyTo natively", () => {
    expect(capabilityViolations(ctx({}, { narrowlyScopedInstructions: 1 }), ["copilot"])).toEqual([]);
  });

  it("capabilityExceptionFor matches only the exact capability: key", () => {
    const list = [ex({ policy: "capability:claude.hooks" })];
    expect(capabilityExceptionFor("claude.hooks", list)?.id).toBe("EX-TEST-1");
    expect(capabilityExceptionFor("claude.settings", list)).toBeUndefined();
    // A glob here would let `capability:*` waive the whole gate in one line.
    expect(capabilityExceptionFor("claude.hooks", [ex({ policy: "capability:*" })])).toBeUndefined();
    expect(capabilityExceptionFor("claude.hooks", [ex({ policy: "drift:claude.hooks" })])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unit — the ARTIFACT plane (shared with doctor)
// ---------------------------------------------------------------------------

describe("countNarrowlyScopedInstructions — narrowing vs universal", () => {
  function mkInstructions(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scopecount-"));
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
  }
  const fm = (applyTo?: string) =>
    `---\ndescription: x\n${applyTo === undefined ? "" : `applyTo: "${applyTo}"\n`}---\n\n# body\n`;

  it("counts a narrowing glob", () => {
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm("src/api/**") })])).toBe(1);
  });

  it('NEGATIVE: "**" is the documented always-on sentinel, not a narrowing', () => {
    // Load-bearing: the shipped baseline.instructions.md is exactly this shape.
    // Without this filter EVERY default install warns, and a check that fires on
    // every install is noise inside a week.
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm("**") })])).toBe(0);
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm("**/*") })])).toBe(0);
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm("*") })])).toBe(0);
  });

  it("NEGATIVE: no applyTo key, and no frontmatter, are not narrowing", () => {
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm() })])).toBe(0);
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": "# just a heading\n" })])).toBe(0);
  });

  it("a multi-glob list counts once, and mixed universal+narrow still counts", () => {
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm("src/api/**, src/db/**") })])).toBe(1);
    expect(countNarrowlyScopedInstructions([mkInstructions({ "a.md": fm("**, src/api/**") })])).toBe(1);
  });

  it("honours the enabled filter — a disabled instruction is not configured", () => {
    const dir = mkInstructions({ "a.md": fm("src/api/**"), "b.md": fm("src/db/**") });
    expect(countNarrowlyScopedInstructions([dir], ["a"])).toBe(1);
    expect(countNarrowlyScopedInstructions([dir], [])).toBe(0);
  });

  it("later dirs win on name, matching compile's package-then-hub merge", () => {
    const pkg = mkInstructions({ "a.md": fm("src/api/**") });
    const hub = mkInstructions({ "a.md": fm("**") });
    expect(countNarrowlyScopedInstructions([pkg, hub])).toBe(0);
    expect(countNarrowlyScopedInstructions([hub, pkg])).toBe(1);
  });
});

describe("countScopedGotchas", () => {
  function mkGotchas(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-gotchacount-"));
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
  }
  it("counts a paths-scoped gotcha and ignores an unscoped one and README", () => {
    const dir = mkGotchas({
      "s.md": `---\npaths: "src/**"\n---\nbody\n`,
      "u.md": `---\ndescription: x\n---\nbody\n`,
      "README.md": `---\npaths: "src/**"\n---\nbody\n`,
    });
    expect(countScopedGotchas(dir)).toBe(1);
  });
  it("NEGATIVE: a missing directory is zero, not a crash", () => {
    expect(countScopedGotchas("/definitely/not/here")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Table integrity — makes the `plugin` class of failure structurally impossible
// ---------------------------------------------------------------------------

describe("CAPABILITY_SUPPORT — anti-drift", () => {
  it("T1: every emittedBy entry is a real output format", () => {
    const bad = CAPABILITY_SUPPORT.flatMap((r) =>
      r.emittedBy.filter((f) => !VALID_FORMATS.includes(f)).map((f) => `${r.id} → ${f}`));
    expect(bad).toEqual([]);
  });

  it("T2: every row carries a file:line warrant, except the not-implemented row", () => {
    // An unverified row here is the same class of error as an unsourced claim.
    for (const r of CAPABILITY_SUPPORT) {
      if (r.emittedBy.length === 0) {
        expect(r.warrant).toMatch(/NOT IMPLEMENTED/);
      } else {
        expect(r.warrant, `row ${r.id}`).toMatch(/^[\w./-]+:\d+$/);
      }
    }
  });

  it("T3: row ids are unique", () => {
    const ids = CAPABILITY_SUPPORT.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("T4: every row has a non-empty consequence", () => {
    for (const r of CAPABILITY_SUPPORT) {
      expect(r.consequence.length, `row ${r.id}`).toBeGreaterThan(10);
    }
  });

  it("T5: each detect() actually fires on a config that sets its key", () => {
    // Catches a renamed config key silently disabling a row — the row would then
    // never fire and the gate would be vacuous for it.
    const probes: Record<string, Partial<AgentBootConfig>> = {
      "claude.hooks": { claude: { hooks: HOOKS } },
      "claude.permissions.deny": { claude: { permissions: { deny: ["x"] } } },
      "claude.permissions.allow": { claude: { permissions: { allow: ["x"] } } },
      "claude.mcpServers": { claude: { mcpServers: { a: {} } } },
      "claude.settings": { claude: { settings: { cleanupPeriodDays: 7 } } },
      "mcp.enforceApproved": { mcp: { enforceApproved: true, approved: [{ name: "a", command: "x", args: [], toolsDigest: "sha256:1" }] } },
      "ab.modelOverrides": { ab: { modelOverrides: { "ab-query": "opus" } } },
      "managed.guardrails.disableBypassPermissions": { managed: { guardrails: { disableBypassPermissions: true } } },
      "compliance.inputScan.scannerCommand": { compliance: { inputScan: { scannerCommand: "/x" } } },
      "compliance.outputScan.blocking": { compliance: { outputScan: { blocking: true } } },
      "managed.guardrails.denyTools": { managed: { guardrails: { denyTools: ["Bash"] } } },
      "managed.guardrails.requireAuditLog": { managed: { guardrails: { requireAuditLog: true } } },
      "managed.guardrails.forcePlugins": { managed: { guardrails: { forcePlugins: ["p"] } } },
      // R2-3: group-scope twins of the four claude.* rows.
      "groups[].permissions.deny": { groups: { g: { permissions: { deny: ["x"] } } } },
      "groups[].permissions.allow": { groups: { g: { permissions: { allow: ["x"] } } } },
      "groups[].mcpServers": { groups: { g: { mcpServers: { a: {} } } } },
      "groups[].enabledPlugins": { groups: { g: { enabledPlugins: [{ url: "https://x.invalid" }] } } },
    };
    for (const row of CAPABILITY_SUPPORT) {
      if (row.id.startsWith("instructions[") || row.id.startsWith("gotchas[")) continue;
      const probe = probes[row.id];
      expect(probe, `no probe for row ${row.id} — add one`).toBeDefined();
      expect(row.detect(ctx(probe!)), `detect() for ${row.id}`).toBe(true);
      expect(row.detect(ctx({})), `detect() for ${row.id} on an empty config`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration — exit codes measured WITHOUT a pipe
// ---------------------------------------------------------------------------

function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scaffoldHub(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cap-"));
  const hub = path.join(base, "hub");
  const r = spawnSync("node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 180_000 });
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
  return hub;
}

function editConfig(hub: string, fn: (c: Record<string, any>) => void): void {
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  fn(c);
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

/** The literal §3 matrix config that produced the false-green sentence. */
function applyMatrixConfig(c: Record<string, any>, formats: string[]): void {
  c.personas.outputFormats = formats;
  c.claude = {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/opt/org/block-dangerous.sh", timeout: 5000 }] }] },
    permissions: { allow: ["Read(src/**)"] },
    mcpServers: { orgdb: { command: "npx", args: ["orgdb-mcp"] } },
    settings: { cleanupPeriodDays: 7 },
  };
  c.compliance = { inputScan: { scannerCommand: "/opt/org/dlp-scan", failMode: "closed" } };
  c.mcp = { approved: [{ name: "orgdb", command: "npx", args: ["orgdb-mcp"], toolsDigest: "sha256:abc" }], enforceApproved: true };
  c.ab = { modelOverrides: { "ab-query": "opus" } };
  c.managed = { guardrails: { forcePlugins: ["org-security-plugin"] } };
}

const ERROR_IDS = ["claude.hooks", "mcp.enforceApproved", "compliance.inputScan.scannerCommand", "managed.guardrails.forcePlugins"];

describe("capability gate — integration", () => {
  it("I1/R1: the matrix config fails the build and doctor drops the false-green line", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => applyMatrixConfig(c, ["cursor", "agents"]));
    const build = ab(["build"], hub);
    expect(build.status).toBe(1);
    for (const id of ERROR_IDS) expect(build.out).toContain(id);
    expect(build.out).toContain("Build failed");

    // The tightest possible pin on the sentence actually observed: a false
    // statement, not a hedge.
    const doc = ab(["doctor"], hub);
    expect(doc.out).not.toContain("no hard org policy configured");
    expect(doc.out).toContain("Coverage");
  }, 300_000);

  it("I2 (NEGATIVE): adding claude makes the gate completely silent", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => {
      applyMatrixConfig(c, ["claude", "cursor", "agents"]);
      // forcePlugins is deliberately EXCLUDED here: emittedBy is empty, so it can
      // never be resolved by adding a platform. Leaving it in would make this
      // "negative" case untestable and would hide whether the other twelve rows
      // really go silent. Its own unresolvability is pinned by U7.
      delete c.managed;
    });
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    // The ERROR block must be entirely absent. A warn line for
    // `instructions[].applyTo` legitimately remains — copilot is not configured
    // and the shipped security.instructions.md carries a narrowing applyTo, so
    // that scope really is lost. Asserting its absence would be asserting the
    // gate lies.
    expect(build.out).not.toContain("that NO configured output format can honour");
    expect(build.out).not.toContain("Build failed");
    // Match the gate's own line shape, not the bare id — an unrelated
    // pre-existing warning ("Review claude.hooks in agentboot.config.json…")
    // mentions the key by name, and asserting on that would make this test
    // pass or fail for the wrong reason.
    for (const id of ["claude.hooks", "mcp.enforceApproved", "compliance.inputScan.scannerCommand"]) {
      const line = new RegExp(`^\\s+${id.replace(/[.[\]]/g, "\\$&")}\\s+emitted by:`, "m");
      expect(line.test(build.out), `${id} must be silent`).toBe(false);
    }
  }, 300_000);

  it("I3 (NEGATIVE): the default install config builds clean with no capability block", () => {
    // Guards the out-of-box experience. If this fails, the gate is over-broad.
    const hub = scaffoldHub();
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(build.out).not.toContain("Configured capabilities");
  }, 300_000);

  it("I4: unexpired capability: exceptions turn the failure into a named waiver, exit 0", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => applyMatrixConfig(c, ["cursor", "agents"]));
    const yr = new Date().getUTCFullYear() + 1;
    fs.writeFileSync(
      path.join(hub, "agentboot-exceptions.json"),
      JSON.stringify(ERROR_IDS.map((id, i) => ({
        id: `EX-2026-0${i + 1}`, policy: `capability:${id}`,
        reason: "cursor-only pilot", approver: "mike", owner: "mike",
        created: "2026-08-08", expires: `${yr}-01-01`,
      })), null, 2),
    );
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(build.out).toContain("accepted under an active exception");
    expect(build.out).toContain("EX-2026-01");
    expect(build.out).toContain("expires");
  }, 300_000);

  it("I5: an EXPIRED exception fails the build again", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => applyMatrixConfig(c, ["cursor", "agents"]));
    fs.writeFileSync(
      path.join(hub, "agentboot-exceptions.json"),
      JSON.stringify(ERROR_IDS.map((id, i) => ({
        id: `EX-2026-0${i + 1}`, policy: `capability:${id}`,
        reason: "cursor-only pilot", approver: "mike", owner: "mike",
        created: "2020-01-01", expires: "2020-06-01",
      })), null, 2),
    );
    expect(ab(["build"], hub).status).toBe(1);
  }, 300_000);

  it("I6 (NEGATIVE): a warn-only hub still exits 0 — a warning must not become an error", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["cursor"];
      c.claude = { permissions: { allow: ["Read(src/**)"] } };
      c.ab = { modelOverrides: { "ab-query": "opus" } };
    });
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(build.out).toContain("claude.permissions.allow");
    expect(build.out).toContain("ab.modelOverrides");
    expect(build.out).not.toContain("Build failed");
  }, 300_000);

  it("I7/I8: doctor --format json reports fail entries for error rows, and none when covered", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => applyMatrixConfig(c, ["cursor", "agents"]));
    const bad = ab(["doctor", "--format", "json"], hub);
    const badJson = JSON.parse(bad.out.slice(bad.out.indexOf("{")));
    const failed = badJson.checks.filter((c: { status: string; name: string }) =>
      c.status === "fail" && ERROR_IDS.some((id) => c.name.startsWith(id)));
    expect(failed.length).toBe(ERROR_IDS.length);

    editConfig(hub, (c) => { applyMatrixConfig(c, ["claude", "cursor", "agents"]); delete c.managed; });
    const good = ab(["doctor", "--format", "json"], hub);
    const goodJson = JSON.parse(good.out.slice(good.out.indexOf("{")));
    expect(goodJson.checks.filter((c: { status: string; name: string }) =>
      c.status === "fail" && ERROR_IDS.some((id) => c.name.startsWith(id)))).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// B1 — `emittedBy` could not express that plugin emission is conditional
// ---------------------------------------------------------------------------

/**
 * `emittedBy` is a flat list, so four ERROR-severity rows claimed `plugin`
 * unconditionally. But the plugin tree is assembled by copying out of
 * `dist/claude/`, and both `generatePluginOutput` and `generateComplianceHooks`
 * sit inside `if (outputFormats.includes("claude"))`. On a `plugin`-only hub
 * those emitters never run — so the gate went silent about a control that
 * reached nothing at all, which is the exact fail-open shape this table exists
 * to close, three rows down from where it was closed the first time.
 */
describe("B1 — conditional emitters", () => {
  const rowsClaimingPlugin = CAPABILITY_SUPPORT.filter((r) => r.emittedBy.includes("plugin"));

  it("B1-U1: every row claiming `plugin` records that it depends on `claude`", () => {
    // Guards the drift directly: a fifth row added later that claims plugin
    // without the dependency reintroduces the defect.
    expect(rowsClaimingPlugin.length).toBeGreaterThan(0);
    for (const r of rowsClaimingPlugin) {
      expect(r.conditionalOn?.plugin, `${r.id} claims plugin unconditionally`).toEqual(["claude"]);
    }
  });

  it("B1-U2: effectiveEmitters drops plugin when claude is not built", () => {
    const row = rowsClaimingPlugin[0]!;
    expect(effectiveEmitters(row, ["plugin"])).not.toContain("plugin");
    expect(effectiveEmitters(row, ["plugin", "claude"])).toContain("plugin");
  });

  it("B1-U3 (NEGATIVE): an unconditional row is untouched by the filter", () => {
    const plain = CAPABILITY_SUPPORT.find((r) => r.id === "claude.hooks")!;
    expect(effectiveEmitters(plain, ["claude"])).toEqual(["claude"]);
    expect(effectiveEmitters(plain, ["cursor"])).toEqual(["claude"]);
  });

  it("B1-U4: the gate FIRES on a plugin-only hub — it used to stay silent", () => {
    const v = capabilityViolations(
      ctx({ managed: { guardrails: { denyTools: ["WebFetch"] } } }), ["plugin"],
    );
    expect(v.map((x) => x.row.id)).toContain("managed.guardrails.denyTools");
  });

  it("B1-U5 (NEGATIVE): plugin + claude honours it — the dependency, not the platform, is the gate", () => {
    expect(capabilityViolations(
      ctx({ managed: { guardrails: { denyTools: ["WebFetch"] } } }), ["plugin", "claude"],
    )).toEqual([]);
  });

  it("B1-U6: the DECLARED set is unchanged — this is not a capability-claim change", () => {
    // Option 2 (drop `plugin` from the rows) would be a public claim change on
    // an honesty product. This fix is mechanical: plugin really does carry these
    // hooks, when it is built at all.
    for (const r of rowsClaimingPlugin) {
      expect(r.emittedBy).toContain("plugin");
    }
  });

  it("B1-U7: every conditionalOn key is a platform the row already claims", () => {
    // A dependency on a platform not in emittedBy is dead configuration: it can
    // never filter anything, so the row silently behaves as unconditional.
    for (const r of CAPABILITY_SUPPORT) {
      for (const k of Object.keys(r.conditionalOn ?? {})) {
        expect(r.emittedBy, `${r.id}: conditionalOn["${k}"] not in emittedBy`).toContain(k);
      }
    }
  });

  it("B1-U8: every conditionalOn dependency is a real output format", () => {
    for (const r of CAPABILITY_SUPPORT) {
      for (const dep of Object.values(r.conditionalOn ?? {}).flat()) {
        expect(VALID_FORMATS, `${r.id}: unknown dependency "${dep}"`).toContain(dep);
      }
    }
  });
});

describe("B1 integration — a plugin-only hub with a deny list", () => {
  it("B1-I1: build FAILS instead of reporting `Compiled … × 1 platform(s)`", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["plugin"];
      c.managed = { guardrails: { denyTools: ["WebFetch"] } };
    });
    const bad = ab(["build"], hub);
    expect(bad.status).not.toBe(0);
    // H1 landed after B1 and stops this config EARLIER, at config load, with the
    // dependency named directly — a better diagnostic for the same defect, and
    // the reason this assertion changed. The capability gate's own behaviour on
    // a plugin-only format set stays pinned by B1-U4/B1-U5, which call
    // capabilityViolations directly rather than through the CLI.
    expect(bad.out).toContain("`plugin` requires `claude`");
    expect(bad.out).not.toMatch(/✓ Compiled \d+ persona\(s\) × 1 platform\(s\)/);

    // ...and adding claude — the dependency the row actually needs — fixes it.
    editConfig(hub, (c) => { c.personas.outputFormats = ["plugin", "claude"]; });
    const good = ab(["build"], hub);
    expect(good.status).toBe(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// B2 — doctor positively asserted `plugin` was enforceable
// ---------------------------------------------------------------------------

describe("B2 integration — doctor on a plugin-only hub", () => {
  it("B2-I1: reports NOT enforced, where it used to report ✓ enforceable", () => {
    const hub = scaffoldHub();
    type Check = { status: string; message: string };
    const checks = (): Check[] =>
      JSON.parse(ab(["doctor", "--format", "json"], hub).out).checks as Check[];

    // plugin WITH claude: the claim is true, and doctor must still make it —
    // otherwise this is an outage, not a gate.
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["plugin", "claude"];
      c.managed = { enabled: true, guardrails: {} };
    });
    expect(checks().some((c) => c.status === "ok" && c.message.startsWith("plugin: org policy is enforceable"))).toBe(true);

    // plugin WITHOUT claude: dist/plugin/ has no hooks.json at all.
    editConfig(hub, (c) => { c.personas.outputFormats = ["plugin"]; });
    const bad = checks().filter((c) => c.message.startsWith("plugin:"));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.status).toBe("fail");
    expect(bad[0]!.message).toContain("NOT enforced");
    expect(bad[0]!.message).toContain("claude is not in personas.outputFormats");
  }, 300_000);
});

// ---------------------------------------------------------------------------
// H1 (F-3) — a plugin-only build reported success over a near-empty tree
// ---------------------------------------------------------------------------

describe("H1 — output formats with build-order dependencies", () => {
  it("H1-U1: PLATFORM_REQUIRES is the ONE declaration, and the other two tables use it", () => {
    // Three copies of "plugin needs claude" is how the plugin fail-open happened
    // three separate times. Assert the identity, not just the values.
    expect(PLATFORM_REQUIRES["plugin"]).toEqual(["claude"]);
    expect(PLATFORM_ENFORCEMENT["plugin"]!.requires).toBe(PLATFORM_REQUIRES["plugin"]);
    for (const r of CAPABILITY_SUPPORT.filter((x) => x.emittedBy.includes("plugin"))) {
      expect(r.conditionalOn?.plugin).toBe(PLATFORM_REQUIRES["plugin"]);
    }
  });

  it("H1-U2: every dependency names a real output format", () => {
    for (const [fmt, deps] of Object.entries(PLATFORM_REQUIRES)) {
      expect(VALID_FORMATS, `${fmt} is not a valid format`).toContain(fmt);
      for (const d of deps) expect(VALID_FORMATS, `${fmt} → ${d}`).toContain(d);
    }
  });

  it("H1-I1: a plugin-only build FAILS; adding claude makes it pass", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => { c.personas.outputFormats = ["plugin"]; });
    const bad = ab(["build"], hub);
    expect(bad.status).not.toBe(0);
    expect(bad.out).toContain("`plugin` requires `claude`");
    // The old output, verbatim, is what must NOT appear.
    expect(bad.out).not.toMatch(/✓ Compiled \d+ persona\(s\) × 1 platform\(s\)/);

    editConfig(hub, (c) => { c.personas.outputFormats = ["plugin", "claude"]; });
    expect(ab(["build"], hub).status).toBe(0);
  }, 300_000);

  it("H1-I2 (NEGATIVE): a claude-only build is unaffected — the gate is directional", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => { c.personas.outputFormats = ["claude"]; });
    expect(ab(["build"], hub).status).toBe(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// H2 (F-4) — cross-platform MCP config was gated on `claude`
// ---------------------------------------------------------------------------

describe("H2 — MCP config for non-Claude platforms", () => {
  it("H2-I1: a hub with no `claude` target still gets cursor/codex/gemini MCP config", () => {
    // `generateCrossPlatformMcpConfigs` gates each platform internally, but the
    // CALL sat inside `if (outputFormats.includes("claude"))`. So the entire
    // cross-platform MCP surface was conditional on Claude Code being a target —
    // and the Codex emitter's own comment ("already generated by
    // generateCrossPlatformMcpConfigs") was false for exactly that build.
    const hub = scaffoldHub();
    editConfig(hub, (c) => { c.personas.outputFormats = ["cursor", "codex", "gemini"]; });
    expect(ab(["build"], hub).status).toBe(0);

    const dist = path.join(hub, "dist");
    for (const rel of [
      path.join("cursor", "core", ".cursor", "mcp.json"),
      path.join("codex", "core", ".codex", "config.toml"),
      path.join("gemini", "core", ".gemini", "settings.json"),
    ]) {
      expect(fs.existsSync(path.join(dist, rel)), rel).toBe(true);
    }
  }, 300_000);

  it("H2-I2 (NEGATIVE): a claude-only hub does not gain stray non-claude trees", () => {
    // Hoisting a call out of a gate risks emitting for platforms that were never
    // requested. The function's internal per-platform gates must still hold.
    const hub = scaffoldHub();
    editConfig(hub, (c) => { c.personas.outputFormats = ["claude"]; });
    expect(ab(["build"], hub).status).toBe(0);
    const dist = path.join(hub, "dist");
    for (const p of ["cursor", "codex", "gemini"]) {
      expect(fs.existsSync(path.join(dist, p)), p).toBe(false);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// B4 / H4 — dist/managed/ was emitted, and logged as a success, to non-consumers
// ---------------------------------------------------------------------------

describe("B4/H4 — the managed-settings MDM channel", () => {
  it("B4-I1: managed.enabled without `claude` fails instead of emitting a dead artifact", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["codex"];
      c.managed = { enabled: true, guardrails: { requireAuditLog: true } };
    });
    const bad = ab(["build"], hub);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("managed.enabled is set, but `claude` is not");
    // The reassurance that used to be printed over the dead artifact.
    expect(bad.out).not.toContain("Managed settings written to dist/managed/");
    expect(bad.out).not.toContain("Target MDM path");
    expect(fs.existsSync(path.join(hub, "dist", "managed"))).toBe(false);
  }, 300_000);

  it("B4-I2 (NEGATIVE): with claude built, the artifact is emitted as before", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["claude", "codex"];
      c.managed = { enabled: true, guardrails: { requireAuditLog: true } };
    });
    const good = ab(["build"], hub);
    expect(good.status).toBe(0);
    expect(good.out).toContain("Managed settings written to dist/managed/");
    const settings = JSON.parse(
      fs.readFileSync(path.join(hub, "dist", "managed", "managed-settings.json"), "utf-8"),
    );
    // The hook it references must actually exist in this build — that was the defect.
    expect(JSON.stringify(settings)).toContain("agentboot-telemetry.sh");
    expect(fs.existsSync(path.join(hub, "dist", "claude", "core", "hooks", "agentboot-telemetry.sh"))).toBe(true);
  }, 300_000);

  it("B4-I3 (NEGATIVE): no managed config at all is still silent", () => {
    const hub = scaffoldHub();
    editConfig(hub, (c) => { c.personas.outputFormats = ["codex"]; delete c.managed; });
    expect(ab(["build"], hub).status).toBe(0);
  }, 300_000);
});

/**
 * H5 — a configured capability that reaches SOME configured platforms.
 *
 * Reproduced on a hub with outputFormats [claude, cursor, gemini] and
 * managed.guardrails.denyTools + requireAuditLog: BUILD_EXIT 0, no
 * per-capability warning anywhere. The only signal was doctor's pre-existing
 * platform-level Enforcement advisory, which says the hub has advisory targets
 * but not WHICH configured control fails to reach them. The gap was not merely
 * unimplemented — U3 above pinned it as out of scope by name, and nothing else
 * covered it.
 */
describe("H5 — capabilityShortfalls: the partial-coverage axis", () => {
  it("H5-1: a control reaching claude but not cursor/gemini is named, with both lists", () => {
    const sf = capabilityShortfalls(ctx({ claude: { hooks: HOOKS } }), ["claude", "cursor", "gemini"]);
    expect(sf).toHaveLength(1);
    expect(sf[0]!.row.id).toBe("claude.hooks");
    expect(sf[0]!.honoured).toEqual(["claude"]);
    expect(sf[0]!.missing).toEqual(["cursor", "gemini"]);
  });

  it("H5-2 (NEGATIVE): full coverage produces nothing", () => {
    expect(capabilityShortfalls(ctx({ claude: { hooks: HOOKS } }), ["claude"])).toEqual([]);
  });

  it("H5-3 (NEGATIVE): ZERO coverage is capabilityViolations' case, not this one", () => {
    // If both fired, the operator would see one problem twice with two verdicts.
    const formats = ["cursor", "gemini"];
    const c = ctx({ claude: { hooks: HOOKS } });
    expect(capabilityViolations(c, formats)).toHaveLength(1);
    expect(capabilityShortfalls(c, formats)).toEqual([]);
  });

  it("H5-4 (NEGATIVE): an unconfigured capability is silent — detect() still gates it", () => {
    expect(capabilityShortfalls(ctx({}), ["claude", "cursor"])).toEqual([]);
  });

  it("H5-5: a multi-emitter capability counts every honouring platform", () => {
    const sf = capabilityShortfalls(
      ctx({ compliance: { inputScan: { scannerCommand: "/opt/dlp" } } }),
      ["claude", "copilot", "cursor"],
    );
    expect(sf).toHaveLength(1);
    expect(sf[0]!.honoured.sort()).toEqual(["claude", "copilot"]);
    expect(sf[0]!.missing).toEqual(["cursor"]);
  });

  it("H5-6: B1's conditionalOn is honoured — a gated emitter does not count as coverage", () => {
    // `plugin` emits inputScan only when `claude` is built. With cursor+plugin
    // configured and no claude, plugin must NOT be counted as honouring, or the
    // shortfall would understate the gap.
    const sf = capabilityShortfalls(
      ctx({ compliance: { inputScan: { scannerCommand: "/opt/dlp" } } }),
      ["claude", "cursor", "plugin"],
    );
    expect(sf[0]!.missing).toContain("cursor");
    expect(sf[0]!.honoured).toContain("plugin"); // claude IS built here
  });
});

/**
 * R1-6 — `conditionalOn` is a no-op in the BUILD path, and load-bearing outside it.
 *
 * H1's PLATFORM_REQUIRES gate hard-exits any build where `plugin` is configured
 * without `claude`, and it runs ~500 lines before the capability gate — so on
 * the compile path `effectiveEmitters` can never see the state `conditionalOn`
 * exists to describe. It is real in `doctor` and `capabilityShortfalls`, which
 * read DECLARED formats with no build gate in front of them.
 *
 * Recorded as a test rather than a comment alone so that if the build gate is
 * ever removed, the reasoning is attached to something that can fail.
 */
describe("R1-6 — where conditionalOn actually applies", () => {
  it("R1-6-1: with plugin but no claude, the emitter is filtered out", () => {
    const row = CAPABILITY_SUPPORT.find((r) => r.id === "managed.guardrails.denyTools")!;
    expect(row.conditionalOn).toBeDefined();
    expect(effectiveEmitters(row, ["cursor", "plugin"])).not.toContain("plugin");
  });

  it("R1-6-2 (NEGATIVE): with claude present it is not filtered", () => {
    const row = CAPABILITY_SUPPORT.find((r) => r.id === "managed.guardrails.denyTools")!;
    expect(effectiveEmitters(row, ["claude", "plugin"])).toContain("plugin");
  });

  it("R1-6-3: the build gate makes the filtered state unreachable from a build", () => {
    // If this ever stops holding, conditionalOn becomes the build's only
    // defence and its coverage stops being subsumed — which is a different
    // risk profile and should be a deliberate decision, not a drift.
    expect(PLATFORM_REQUIRES["plugin"]).toEqual(["claude"]);
  });
});
