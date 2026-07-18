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
    const blockScanner = path.join(hub, "block-scanner.sh");
    fs.writeFileSync(blockScanner, "#!/bin/bash\ncat >/dev/null\necho policy-phi-042\nexit 2\n", { mode: 0o755 });
    const brokenScanner = path.join(hub, "broken-scanner.sh");
    fs.writeFileSync(brokenScanner, "#!/bin/bash\ncat >/dev/null\nexit 1\n", { mode: 0o755 });
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
      const blocked = runHook(hook, { response: `the key is ${cred}` });
      expect(blocked.status).toBe(2);
      expect(blocked.stdout).toContain('"decision":"block"');
      const clean = runHook(hook, { response: "nothing sensitive here" });
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
      const warned = runHook(hook, { response: `the key is ${cred}` });
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
      expect(output).toContain("All 9 checks passed");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});
