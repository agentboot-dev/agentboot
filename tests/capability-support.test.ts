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
  type CapabilityContext,
} from "../scripts/lib/conformance.js";
import {
  capabilityViolations, countNarrowlyScopedInstructions, countScopedGotchas,
} from "../scripts/lib/guardrail-scan.js";
import { capabilityExceptionFor, validateExceptions, type PolicyException } from "../scripts/lib/exceptions.js";
import type { AgentBootConfig } from "../scripts/lib/config.js";

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

  it("U3 (NEGATIVE): one honouring target is enough — partial coverage is the other axis", () => {
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
