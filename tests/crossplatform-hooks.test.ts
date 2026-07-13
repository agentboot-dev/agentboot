/**
 * A1.5: Cross-platform compliance-hook emission.
 *
 * Every platform emitter (Claude Code settings.json, Codex .codex/hooks.json,
 * Copilot .github/hooks/agentboot.json) derives from one canonical source — the
 * portable hook scripts + COMPLIANCE_HOOK_BINDINGS. Each `run()` compiles into a
 * fresh temp dir, so these tests exercise a genuine CLEAN build (no stale dist).
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string): string {
  return execSync(`${TSX} ${script}`, {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
  }).toString();
}

function compileInto(config: Record<string, unknown>): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-xplat-hooks-"));
  const tempConfig = path.join(tempDir, "agentboot.config.json");
  fs.writeFileSync(tempConfig, JSON.stringify(config));
  run(`scripts/compile.ts --config ${tempConfig}`);
  return tempDir;
}

const BASE_TRAITS = ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"];

describe("A1.5 cross-platform compliance hooks", () => {
  it("Codex hooks.json is populated on a CLEAN build (no dependency on the CC emitter)", () => {
    // Regression guard: generateCodexHooks used to copy scripts from dist/claude,
    // which is written LATER in the pipeline — so a clean build produced an empty
    // Codex hooks.json. It now generates its own copy from the shared scripts.
    const tempDir = compileInto({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["codex"] },
      traits: { enabled: BASE_TRAITS },
      instructions: { enabled: [] },
    });
    try {
      const hooksPath = path.join(tempDir, "dist", "codex", "core", ".codex", "hooks.json");
      expect(fs.existsSync(hooksPath), "codex hooks.json should exist on a clean build").toBe(true);
      const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf-8")).hooks as Record<string, unknown>;
      expect(Object.keys(hooks).length).toBeGreaterThan(0);
      expect(hooks["UserPromptSubmit"]).toBeDefined();
      expect(hooks["Stop"]).toBeDefined();
      // SessionEnd is NOT a Codex-supported event — must be filtered out.
      expect(hooks["SessionEnd"]).toBeUndefined();
      // Scripts are written independently of the Claude Code tree.
      const scriptsDir = path.join(tempDir, "dist", "codex", "core", ".codex", "hooks");
      expect(fs.existsSync(path.join(scriptsDir, "agentboot-input-scan.sh"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("Copilot emits .github/hooks/agentboot.json with camelCase events + portable scripts", () => {
    const tempDir = compileInto({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["copilot"] },
      traits: { enabled: BASE_TRAITS },
      instructions: { enabled: [] },
    });
    try {
      const hooksDir = path.join(tempDir, "dist", "copilot", "core", ".github", "hooks");
      const jsonPath = path.join(hooksDir, "agentboot.json");
      expect(fs.existsSync(jsonPath), "copilot hooks json should exist").toBe(true);
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(parsed.version).toBe(1);
      const hooks = parsed.hooks as Record<string, unknown>;
      // Copilot lifecycle event names (camelCase), translated from the CC bindings.
      expect(hooks["userPromptSubmitted"]).toBeDefined();
      expect(hooks["agentStop"]).toBeDefined();
      // CC PascalCase names must NOT leak into Copilot output.
      expect(hooks["UserPromptSubmit"]).toBeUndefined();
      expect(hooks["Stop"]).toBeUndefined();
      // Scripts colocated for the committed-file (CLI + cloud agent) model.
      expect(fs.existsSync(path.join(hooksDir, "agentboot-input-scan.sh"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("PreToolUse deny hook is emitted across all three platforms ONLY when denyTools is set", () => {
    const withDeny = compileInto({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude", "codex", "copilot"] },
      traits: { enabled: BASE_TRAITS },
      instructions: { enabled: [] },
      managed: { guardrails: { denyTools: ["WebSearch"] } },
    });
    try {
      const cc = JSON.parse(fs.readFileSync(
        path.join(withDeny, "dist", "claude", "core", "settings.json"), "utf-8")).hooks;
      const codex = JSON.parse(fs.readFileSync(
        path.join(withDeny, "dist", "codex", "core", ".codex", "hooks.json"), "utf-8")).hooks;
      const copilot = JSON.parse(fs.readFileSync(
        path.join(withDeny, "dist", "copilot", "core", ".github", "hooks", "agentboot.json"), "utf-8")).hooks;
      expect(cc["PreToolUse"]).toBeDefined();
      expect(codex["PreToolUse"]).toBeDefined();
      expect(copilot["preToolUse"]).toBeDefined();
    } finally {
      fs.rmSync(withDeny, { recursive: true, force: true });
    }

    const noDeny = compileInto({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude", "codex", "copilot"] },
      traits: { enabled: BASE_TRAITS },
      instructions: { enabled: [] },
    });
    try {
      const cc = JSON.parse(fs.readFileSync(
        path.join(noDeny, "dist", "claude", "core", "settings.json"), "utf-8")).hooks;
      const copilot = JSON.parse(fs.readFileSync(
        path.join(noDeny, "dist", "copilot", "core", ".github", "hooks", "agentboot.json"), "utf-8")).hooks;
      expect(cc["PreToolUse"]).toBeUndefined();
      expect(copilot["preToolUse"]).toBeUndefined();
    } finally {
      fs.rmSync(noDeny, { recursive: true, force: true });
    }
  });

  it("denyTools glob patterns compile to a glob-capable match, not a literal one (H1)", () => {
    // Regression: the deny hook quoted the RHS ([[ "$TOOL_NAME" == "$pattern" ]]),
    // forcing literal comparison — so a glob like "mcp__*" (which validation allows)
    // matched nothing and the guardrail failed OPEN. The RHS must be unquoted.
    const tempDir = compileInto({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
      traits: { enabled: BASE_TRAITS },
      instructions: { enabled: [] },
      managed: { guardrails: { denyTools: ["mcp__*", "Bash*"] } },
    });
    try {
      const hook = fs.readFileSync(
        path.join(tempDir, "dist", "claude", "core", "hooks", "agentboot-pretooluse.sh"), "utf-8");
      // The glob patterns must reach the script...
      expect(hook).toContain("mcp__*");
      expect(hook).toContain("Bash*");
      // ...and the comparison must be glob-enabled (unquoted RHS), not literal.
      expect(hook).toContain("== $pattern");
      expect(hook).not.toContain('== "$pattern"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
