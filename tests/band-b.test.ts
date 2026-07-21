/**
 * Band B enterprise-hardening tests.
 *
 * Covers the customer-adoption batch: managed-settings pass-through (B1),
 * pluggable scanners + output blocking (B2/B3), MCP profiles + identity
 * pinning (B4/B5), telemetry inspect (B6), exception workflow (B7), fragment
 * composition + merged artifact (B8), import-first sync safety (B9), audit
 * detectors (B10), prompt-size budgets (B11), doctor enforcement honesty (B12).
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 60_000,
  }).toString();
}

function mkHub(config: Record<string, unknown>): string {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-bandb-"));
  fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
  fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify(config, null, 2));
  return hub;
}

const BASE_CONFIG = {
  org: "acme",
  personas: { enabled: [], outputFormats: ["claude"] },
  traits: { enabled: [] },
  validation: { secretPatterns: [] },
};

// ---------------------------------------------------------------------------
// B1: claude.settings pass-through — full managed-settings key expressiveness
// ---------------------------------------------------------------------------

describe("B1: managed-settings key expressiveness (claude.settings pass-through)", () => {
  const SETTINGS = {
    enableAllProjectMcpServers: false,
    enabledMcpjsonServers: ["memory"],
    disabledMcpjsonServers: ["fetch"],
    env: { CLAUDE_CODE_ENABLE_TELEMETRY: "1" },
    cleanupPeriodDays: 30,
    includeCoAuthoredBy: false,
  };

  it("reproduces pass-through keys verbatim in the org fragment AND dist/managed", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      claude: { settings: SETTINGS, permissions: { deny: ["WebFetch"] } },
      managed: { enabled: true, guardrails: { disableBypassPermissions: true } },
    });
    try {
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);

      const fragment = JSON.parse(
        fs.readFileSync(path.join(hub, "dist", "claude", "core", "managed-settings.d", "00-org.json"), "utf-8")
      );
      for (const [k, v] of Object.entries(SETTINGS)) {
        expect(fragment[k], `fragment key ${k}`).toEqual(v);
      }
      expect(fragment.permissions).toEqual({ deny: ["WebFetch"] });
      expect(fragment.disableBypassPermissionsMode).toBe("disable");

      const managed = JSON.parse(
        fs.readFileSync(path.join(hub, "dist", "managed", "managed-settings.json"), "utf-8")
      );
      for (const [k, v] of Object.entries(SETTINGS)) {
        expect(managed[k], `managed key ${k}`).toEqual(v);
      }
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("validate fails when claude.settings collides with a dedicated key", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      claude: { settings: { permissions: { deny: ["*"] } } },
    });
    try {
      let output = "";
      try {
        output = run(`scripts/validate.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(output).toContain("claude.settings.permissions collides");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B2/B3: pluggable scanners + output-scan blocking
// ---------------------------------------------------------------------------

/** Run a generated hook script with a JSON payload on stdin; returns {status, stdout, stderr}. */
function runHook(hookPath: string, payload: object): { status: number; stdout: string; stderr: string } {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const r = spawnSync("bash", [hookPath], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 15_000,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("B2/B3: pluggable scanners + output blocking", () => {
  it("input hook: org scanner exit 2 blocks; scanner failure honors failMode closed", () => {
    const hub = mkHub(BASE_CONFIG);
    // Invoke via "bash <posix-path>" so the embedded command works in git-bash
    // on Windows too (a backslashed C:\ path would be mangled by bash).
    const posix = (p: string) => p.replace(/\\/g, "/");
    const blockScannerFile = path.join(hub, "block-scanner.sh");
    fs.writeFileSync(blockScannerFile, "#!/bin/bash\ncat >/dev/null\necho policy-phi-042\nexit 2\n", { mode: 0o755 });
    const blockScanner = `bash ${posix(blockScannerFile)}`;
    const brokenScannerFile = path.join(hub, "broken-scanner.sh");
    fs.writeFileSync(brokenScannerFile, "#!/bin/bash\ncat >/dev/null\nexit 1\n", { mode: 0o755 });
    const brokenScanner = `bash ${posix(brokenScannerFile)}`;
    try {
      // Scanner that blocks
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        ...BASE_CONFIG,
        compliance: { inputScan: { scannerCommand: blockScanner } },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const hook = path.join(hub, "dist", "claude", "core", "hooks", "agentboot-input-scan.sh");

      const blocked = runHook(hook, { prompt: "benign text the regexes will not flag" });
      expect(blocked.status).toBe(2);
      expect(blocked.stdout).toContain('"decision":"block"');
      expect(blocked.stderr).toContain("policy-phi-042");

      // Broken scanner + failMode closed → block
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        ...BASE_CONFIG,
        compliance: { inputScan: { scannerCommand: brokenScanner, failMode: "closed" } },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const closed = runHook(hook, { prompt: "benign text" });
      expect(closed.status).toBe(2);
      expect(closed.stdout).toContain("failMode is closed");

      // Broken scanner + default failMode open → allow with stderr notice
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        ...BASE_CONFIG,
        compliance: { inputScan: { scannerCommand: brokenScanner } },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const open = runHook(hook, { prompt: "benign text" });
      expect(open.status).toBe(0);
      expect(open.stderr).toContain("failMode: open");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("output hook: blocking promotes credential match from warn to exit-2 block", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      compliance: { outputScan: { blocking: true } },
    });
    try {
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const hook = path.join(hub, "dist", "claude", "core", "hooks", "agentboot-output-scan.sh");
      const cred = ["AKIA", "IOSFODNN7EXAMPLE"].join(""); // assembled — see secret-parity.test.ts
      const blocked = runHook(hook, { hook_event_name: "Stop", last_assistant_message: `the key is ${cred}` });
      expect(blocked.status).toBe(2);
      expect(blocked.stdout).toContain('"decision":"block"');
      const clean = runHook(hook, { hook_event_name: "Stop", last_assistant_message: "nothing sensitive here" });
      expect(clean.status).toBe(0);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("output hook default remains warn-only (exit 0 + stderr)", () => {
    const hub = mkHub(BASE_CONFIG);
    try {
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const hook = path.join(hub, "dist", "claude", "core", "hooks", "agentboot-output-scan.sh");
      const cred = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
      const warned = runHook(hook, { hook_event_name: "Stop", last_assistant_message: `the key is ${cred}` });
      expect(warned.status).toBe(0);
      expect(warned.stderr).toContain("AgentBoot WARNING");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("compile rejects scanner commands with shell metacharacters", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      compliance: { inputScan: { scannerCommand: "scanner.sh; rm -rf /" } },
    });
    try {
      let output = "";
      try {
        output = run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "") + err.message;
      }
      expect(output).toContain("shell metacharacters");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B4: MCP profiles — read-only by default, maintainer opt-in
// ---------------------------------------------------------------------------

import { handleMessage, setMcpProfile, resolveMcpProfile } from "../scripts/mcp-server.js";

const MUTATING = ["agentboot_build", "agentboot_sync", "agentboot_propose_change"];

function listTools(): Array<{ name: string; annotations?: Record<string, unknown> }> {
  const res = handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" } as any) as any;
  return res.result.tools;
}

describe("B4: MCP profiles", () => {
  it("read-only (default) hides mutating tools and annotates the rest", () => {
    setMcpProfile("read-only");
    const tools = listTools();
    const names = tools.map((t) => t.name);
    for (const m of MUTATING) expect(names).not.toContain(m);
    expect(names).toContain("agentboot_status");
    expect(tools.find((t) => t.name === "agentboot_status")?.annotations?.["readOnlyHint"]).toBe(true);
  });

  it("read-only rejects a mutating call even if the client ignores tools/list", () => {
    setMcpProfile("read-only");
    const res = handleMessage({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "agentboot_build", arguments: {} },
    } as any) as any;
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain("read-only profile");
  });

  it("maintainer profile exposes mutating tools with honest annotations", () => {
    setMcpProfile("maintainer");
    try {
      const tools = listTools();
      const names = tools.map((t) => t.name);
      for (const m of MUTATING) expect(names).toContain(m);
      const propose = tools.find((t) => t.name === "agentboot_propose_change");
      expect(propose?.annotations?.["readOnlyHint"]).toBe(false);
      expect(propose?.annotations?.["openWorldHint"]).toBe(true);
    } finally {
      setMcpProfile("read-only");
    }
  });

  it("resolveMcpProfile parses --profile and falls back to read-only on junk", () => {
    expect(resolveMcpProfile(["--profile", "maintainer"])).toBe("maintainer");
    expect(resolveMcpProfile(["--profile", "yolo"])).toBe("read-only");
    expect(resolveMcpProfile([])).toBe("read-only");
  });
});

// ---------------------------------------------------------------------------
// B5: MCP identity pinning — approved name must match approved implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// B6: telemetry contract — generated hook emits EXACTLY the documented schema
// ---------------------------------------------------------------------------

import { TELEMETRY_EVENTS, PROHIBITED_TELEMETRY_FIELDS, TELEMETRY_SCHEMA_VERSION } from "../scripts/lib/telemetry-schema.js";

// ---------------------------------------------------------------------------
// B8: fragment composition end-to-end + single merged deployable artifact
// ---------------------------------------------------------------------------

describe("B8: merged managed artifacts per scope", () => {
  it("merges guardrails + 00-org + 10-group with org-wins and deny-union semantics", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      groups: {
        platform: { teams: ["api"], permissions: { deny: ["WebSearch"], allow: ["Bash(npm test:*)"] } },
      },
      claude: {
        permissions: { deny: ["WebFetch"] },
        settings: { cleanupPeriodDays: 30 },
      },
      managed: { enabled: true, guardrails: { denyTools: ["curl*"], disableBypassPermissions: true } },
    });
    try {
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);

      // Core merged artifact: guardrail deny + org fragment deny UNIONed; settings pass-through present
      const core = JSON.parse(fs.readFileSync(
        path.join(hub, "dist", "managed", "scopes", "core", "managed-settings.json"), "utf-8"));
      expect(core.permissions.deny).toEqual(expect.arrayContaining(["curl*", "WebFetch"]));
      expect(core.cleanupPeriodDays).toBe(30);
      expect(core.disableBypassPermissionsMode).toBe("disable");

      // Group merged artifact: adds the group's deny to the union, keeps org keys
      const group = JSON.parse(fs.readFileSync(
        path.join(hub, "dist", "managed", "scopes", "nodes", "platform", "managed-settings.json"), "utf-8"));
      expect(group.permissions.deny).toEqual(expect.arrayContaining(["curl*", "WebFetch", "WebSearch"]));
      expect(group.permissions.allow).toEqual(expect.arrayContaining(["Bash(npm test:*)"]));
      expect(group.cleanupPeriodDays).toBe(30);
      // No comment keys leak into the deployable
      expect(Object.keys(group).some((k) => k.startsWith("//"))).toBe(false);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B12: enforcement honesty — doctor warns when a platform cannot enforce policy
// ---------------------------------------------------------------------------

describe("B12: doctor enforcement honesty", () => {
  it("warns per-platform when hard org policy meets advisory/fail-open platforms", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      personas: { enabled: [], outputFormats: ["claude", "copilot", "cursor"] },
      managed: { enabled: true, guardrails: { denyTools: ["curl*"] } },
    });
    try {
      let output = "";
      try {
        output = run(`${path.join(ROOT, "scripts", "cli.ts")} doctor`, hub);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(output).toContain("Enforcement");
      expect(output).toContain("claude: org policy is enforceable");
      expect(output).toContain("copilot: org policy is FAIL-OPEN");
      expect(output).toContain("cursor: org policy is ADVISORY");
      expect(output).toContain("not a security boundary");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B11: prompt-size discipline — failAt gate + persona-sizes.json report
// ---------------------------------------------------------------------------

describe("B11: prompt-size budgets", () => {
  function mkPersonaHub(failAt?: number): string {
    const hub = mkHub({
      ...BASE_CONFIG,
      personas: { enabled: ["chatty"], outputFormats: ["skill"] },
      output: failAt !== undefined ? { tokenBudget: { failAt } } : {},
    });
    const pDir = path.join(hub, "core", "personas", "chatty");
    fs.mkdirSync(pDir, { recursive: true });
    fs.writeFileSync(path.join(pDir, "persona.config.json"), JSON.stringify({
      name: "Chatty", description: "long-winded", invocation: "/chatty", traits: {},
    }));
    fs.writeFileSync(path.join(pDir, "SKILL.md"),
      "---\nname: chatty\ndescription: long\n---\n" + "wordy instruction line\n".repeat(200));
    return hub;
  }

  it("build FAILS when a persona exceeds tokenBudget.failAt", () => {
    const hub = mkPersonaHub(10);
    try {
      let output = "";
      let failed = false;
      try {
        output = run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        failed = true;
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(failed).toBe(true);
      expect(output).toContain("failAt");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("writes dist/persona-sizes.json for PR diffing", () => {
    const hub = mkPersonaHub();
    try {
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const report = JSON.parse(fs.readFileSync(path.join(hub, "dist", "persona-sizes.json"), "utf-8"));
      expect(report.personas.chatty).toBeGreaterThan(100);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B10: audit detectors — scope shadows + dead gotchas
// ---------------------------------------------------------------------------

import { runAudit } from "../scripts/lib/audit.js";

describe("B10: audit detectors", () => {
  it("detects a team artifact shadowing an org RULE as error, preference shadow as warn", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-b10-"));
    try {
      // Core rule-type artifact (gotchas infer rule by path) + a preference trait
      fs.mkdirSync(path.join(hub, "core", "gotchas"), { recursive: true });
      fs.mkdirSync(path.join(hub, "core", "traits"), { recursive: true });
      fs.writeFileSync(path.join(hub, "core", "gotchas", "no-prod-deploy.md"), "---\ndescription: d\n---\nrule");
      fs.writeFileSync(path.join(hub, "core", "traits", "tone.md"), "---\ndescription: d\n---\npref");
      // Team scope shadows both
      fs.mkdirSync(path.join(hub, "teams", "platform", "api", "gotchas"), { recursive: true });
      fs.mkdirSync(path.join(hub, "teams", "platform", "api", "traits"), { recursive: true });
      fs.writeFileSync(path.join(hub, "teams", "platform", "api", "gotchas", "no-prod-deploy.md"), "shadowed!");
      fs.writeFileSync(path.join(hub, "teams", "platform", "api", "traits", "tone.md"), "shadowed!");

      const report = runAudit(hub);
      const shadows = report.findings.filter((f) => f.type === "scope-shadow");
      expect(shadows).toHaveLength(2);
      expect(shadows.find((f) => f.file?.includes("no-prod-deploy"))?.severity).toBe("error");
      expect(shadows.find((f) => f.file?.includes("tone"))?.severity).toBe("warn");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("detects a dead gotcha (glob matches nothing in registered repos) and passes a live one", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-b10d-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-b10d-repo-"));
    try {
      fs.mkdirSync(path.join(repo, "src", "jobs"), { recursive: true });
      fs.writeFileSync(path.join(repo, "src", "jobs", "reconcile.ts"), "code");
      fs.mkdirSync(path.join(hub, "core", "gotchas"), { recursive: true });
      fs.writeFileSync(path.join(hub, "core", "gotchas", "live.md"),
        '---\ndescription: d\npaths: ["src/**/*.ts"]\n---\nbody');
      fs.writeFileSync(path.join(hub, "core", "gotchas", "dead.md"),
        '---\ndescription: d\npaths: ["legacy/cobol/**/*.cbl"]\n---\nbody');
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme", sync: { repos: "./repos.json" },
      }));
      fs.writeFileSync(path.join(hub, "repos.json"), JSON.stringify([{ path: repo }]));

      const report = runAudit(hub);
      const dead = report.findings.filter((f) => f.type === "dead-gotcha");
      expect(dead).toHaveLength(1);
      expect(dead[0]?.file).toContain("dead.md");
      expect(dead[0]?.message).toContain("never activates");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B9: import-first sync safety — first sync onto bespoke files needs opt-in
// ---------------------------------------------------------------------------

describe("B9: import-first sync safety", () => {
  it("first sync onto a bespoke CLAUDE.md stops with import guidance; --adopt-existing proceeds and archives", () => {
    const hub = mkHub(BASE_CONFIG);
    const spoke = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-b9-spoke-"));
    try {
      fs.writeFileSync(path.join(spoke, "CLAUDE.md"), "# Hand-curated repo knowledge\nyears of hard-won context\n");
      fs.writeFileSync(path.join(hub, "repos.json"), JSON.stringify([{ path: spoke, platform: "claude" }]));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);

      // Without the flag: sync reports the guard and does NOT touch the file
      let output = "";
      try {
        output = run(`scripts/sync.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(output).toContain("REPLACE pre-existing instruction file");
      expect(output).toContain("agentboot import");
      expect(fs.readFileSync(path.join(spoke, "CLAUDE.md"), "utf-8")).toContain("Hand-curated");
      expect(fs.existsSync(path.join(spoke, ".claude", ".agentboot-manifest.json"))).toBe(false);

      // With the flag: sync proceeds and the original is archived
      let output2 = "";
      try {
        output2 = run(`scripts/sync.ts --config ${path.join(hub, "agentboot.config.json")} --adopt-existing`);
      } catch (err: any) {
        output2 = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(fs.existsSync(path.join(spoke, ".claude", ".agentboot-archive", "__root__", "CLAUDE.md"))).toBe(true);
      expect(fs.readFileSync(path.join(spoke, ".claude", ".agentboot-archive", "__root__", "CLAUDE.md"), "utf-8")).toContain("Hand-curated");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B7: policy exceptions — owner/TTL/expiry; drift distinguishes approved drift
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { checkDrift } from "../scripts/lib/drift.js";
import { validateExceptions, type PolicyException } from "../scripts/lib/exceptions.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function mkSpokeWithDrift(exceptions?: object[]): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-b7-"));
  fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude", "settings.json"), "TAMPERED");
  fs.writeFileSync(path.join(repo, ".claude", "rules.md"), "intact");
  fs.writeFileSync(path.join(repo, ".claude", ".agentboot-manifest.json"), JSON.stringify({
    managed_by: "agentboot", version: "0.0.0", synced_at: "2026-01-01",
    files: [
      { path: ".claude/settings.json", hash: sha("original") },
      { path: ".claude/rules.md", hash: sha("intact") },
    ],
  }));
  if (exceptions) {
    fs.writeFileSync(path.join(repo, ".agentboot-exceptions.json"), JSON.stringify({ exceptions }));
  }
  return repo;
}

const FULL_EXCEPTION = {
  id: "EX-001", policy: "drift:.claude/settings.json", reason: "vendor pilot needs a temporary override",
  approver: "security-lead", owner: "platform-lead", created: "2026-07-01", expires: "2099-01-01",
  compensatingControl: "weekly manual review",
};

describe("B7: policy exceptions", () => {
  it("unexpired exception converts drift to excepted and keeps the repo passing, visibly", () => {
    const repo = mkSpokeWithDrift([FULL_EXCEPTION]);
    try {
      const report = checkDrift(repo);
      const entry = report.entries.find((e) => e.file === ".claude/settings.json");
      expect(entry?.status).toBe("excepted");
      expect(entry?.exceptionId).toBe("EX-001");
      expect(report.summary.exceptedCount).toBe(1);
      expect(report.summary.modifiedCount).toBe(0);
      expect(report.clean).toBe(true); // approved drift does not fail the repo
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("EXPIRED exception is not honored — drift resurfaces and the issue is reported", () => {
    const repo = mkSpokeWithDrift([{ ...FULL_EXCEPTION, expires: "2026-01-01" }]);
    try {
      const report = checkDrift(repo);
      expect(report.entries.find((e) => e.file === ".claude/settings.json")?.status).toBe("modified");
      expect(report.clean).toBe(false);
      expect(report.exceptionIssues?.join(" ")).toContain("EXPIRED");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("no exception at all → plain modified (control)", () => {
    const repo = mkSpokeWithDrift();
    try {
      const report = checkDrift(repo);
      expect(report.entries.find((e) => e.file === ".claude/settings.json")?.status).toBe("modified");
      expect(report.summary.exceptedCount).toBe(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("validateExceptions: missing fields error; near-expiry warns; duplicate ids error", () => {
    const now = Date.parse("2026-07-18T12:00:00Z");
    const v = validateExceptions([
      { id: "EX-1", policy: "drift:x", reason: "r", approver: "a", owner: "o", created: "2026-07-01", expires: "2026-07-25" },
      { id: "EX-1", policy: "drift:y", reason: "r", approver: "a", owner: "o", created: "2026-07-01", expires: "2099-01-01" },
      { id: "EX-2", policy: "drift:z", reason: "", approver: "a", owner: "o", created: "2026-07-01", expires: "2099-01-01" },
    ] as PolicyException[], now);
    expect(v.errors.join(" ")).toContain("duplicate id");
    expect(v.errors.join(" ")).toContain('missing required field "reason"');
    expect(v.warnings.join(" ")).toContain("within 14 days");
    expect(v.active.map((e) => e.id)).toContain("EX-1");
  });

  it("hub validate fails on an expired hub exception", () => {
    const hub = mkHub(BASE_CONFIG);
    try {
      fs.writeFileSync(path.join(hub, "agentboot-exceptions.json"), JSON.stringify({
        exceptions: [{ ...FULL_EXCEPTION, id: "EX-HUB-1", expires: "2026-01-01" }],
      }));
      let output = "";
      try {
        output = run(`scripts/validate.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(output).toContain("EXPIRED");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

describe("B6: telemetry schema conformance", () => {
  it("generated hook output matches the canonical schema key-for-key", () => {
    const hub = mkHub(BASE_CONFIG);
    const logFile = path.join(hub, "telemetry-test.ndjson");
    try {
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const hook = path.join(hub, "dist", "claude", "core", "hooks", "agentboot-telemetry.sh");
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      const payloads = [
        { hook_event_name: "SubagentStart", agent_type: "code-reviewer", prompt: "MUST NOT LEAK" },
        { hook_event_name: "PostToolUse", agent_type: "code-reviewer", tool_name: "Edit", tool_input: { file_path: "/secret/path" } },
        { hook_event_name: "SessionEnd" },
      ];
      for (const p of payloads) {
        const r = spawnSync("bash", [hook], {
          input: JSON.stringify(p),
          encoding: "utf-8",
          env: { ...process.env, AGENTBOOT_TELEMETRY_LOG: logFile },
          timeout: 15_000,
        });
        expect(r.status).toBe(0);
      }
      const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(3);
      const expectedTypes = ["persona_invocation", "hook_execution", "session_summary"];
      lines.forEach((line, i) => {
        const entry = JSON.parse(line) as Record<string, unknown>;
        expect(entry["event"]).toBe(expectedTypes[i]);
        expect(entry["schema"]).toBe(TELEMETRY_SCHEMA_VERSION);
        // Key-for-key match with the canonical schema — no extra, no missing
        const schemaKeys = Object.keys(TELEMETRY_EVENTS[expectedTypes[i]!]!.fields).sort();
        expect(Object.keys(entry).sort()).toEqual(schemaKeys);
        // Content-bearing fields prohibited by schema
        for (const banned of PROHIBITED_TELEMETRY_FIELDS) {
          expect(entry, `field ${banned} must never be emitted`).not.toHaveProperty(banned);
        }
        // includeDevId not configured → dev_id must be empty
        expect(entry["dev_id"]).toBe("");
        // Raw payload content must not appear anywhere in the line
        expect(line).not.toContain("MUST NOT LEAK");
        expect(line).not.toContain("/secret/path");
      });
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("telemetry-inspect prints schema + samples without touching any log", () => {
    const hub = mkHub(BASE_CONFIG);
    try {
      const out = run(`scripts/cli.ts telemetry-inspect --config ${path.join(hub, "agentboot.config.json")}`);
      expect(out).toContain("persona_invocation");
      expect(out).toContain("PSEUDONYMOUS");
      expect(out).toContain(`Schema version: ${TELEMETRY_SCHEMA_VERSION}`);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

describe("B5: MCP identity pinning", () => {
  it("validate fails when a configured server's command/args differ from the approved pin", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      mcp: {
        enforceApproved: true,
        approved: [
          { name: "approved-company-tools", command: "npx", args: ["company-tools@1.2.3", "serve"] },
        ],
      },
      claude: {
        mcpServers: {
          "approved-company-tools": { command: "npx", args: ["evil-package", "serve"] },
        },
      },
    });
    try {
      let output = "";
      try {
        output = run(`scripts/validate.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(output).toContain("do not match");
      expect(output).toContain("approved-company-tools");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("validate passes when the configured server matches the pin exactly", () => {
    const hub = mkHub({
      ...BASE_CONFIG,
      mcp: {
        enforceApproved: true,
        approved: [
          { name: "approved-company-tools", command: "npx", args: ["company-tools@1.2.3", "serve"] },
        ],
      },
      claude: {
        mcpServers: {
          "approved-company-tools": { command: "npx", args: ["company-tools@1.2.3", "serve"] },
        },
      },
    });
    try {
      const output = run(`scripts/validate.ts --config ${path.join(hub, "agentboot.config.json")}`);
      expect(output).toMatch(/All \d+ checks passed/);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});
