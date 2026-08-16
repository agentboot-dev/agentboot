/**
 * Phase 11 A1.7: Codex platform + agents broadening
 *
 * Tests for Codex compilation output, sync routing, TOML generation,
 * hooks format, and .agents/skills/ cross-tool emission.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ensureRootDist } from "./setup.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
  }).toString();
}

beforeAll(() => {
  // R4-6: existence read as freshness — and worse here, `dist/codex` is absent
  // whenever another file built a codex-less config, so this rebuilt on a tree
  // that was current and skipped on one that was not.
  ensureRootDist();
});

// ---------------------------------------------------------------------------
// Codex compilation output
// ---------------------------------------------------------------------------

describe("A1.7: Codex compilation", () => {
  const codexCore = path.join(ROOT, "dist", "codex", "core");

  it("dist/codex/ directory exists", () => {
    expect(fs.existsSync(codexCore)).toBe(true);
  });

  it("AGENTS.md exists at dist/codex/core/", () => {
    expect(fs.existsSync(path.join(codexCore, "AGENTS.md"))).toBe(true);
    const content = fs.readFileSync(path.join(codexCore, "AGENTS.md"), "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });

  it(".codex/config.toml exists with MCP server entry", () => {
    const tomlPath = path.join(codexCore, ".codex", "config.toml");
    expect(fs.existsSync(tomlPath)).toBe(true);
    const content = fs.readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[mcp_servers.agentboot]");
    expect(content).toContain('command = "npx"');
    expect(content).toContain("agentboot");
    expect(content).toContain("enabled = true");
  });

  it(".codex/hooks.json exists with compliance hook events", () => {
    const hooksPath = path.join(codexCore, ".codex", "hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    expect(content.hooks).toBeDefined();
    // Should have at least UserPromptSubmit (input scan) and Stop (output scan)
    expect(content.hooks["UserPromptSubmit"]).toBeDefined();
  });

  it(".codex/hooks/ directory has bash scripts", () => {
    const hooksDir = path.join(codexCore, ".codex", "hooks");
    expect(fs.existsSync(hooksDir)).toBe(true);
    const scripts = fs.readdirSync(hooksDir).filter(f => f.endsWith(".sh"));
    expect(scripts.length).toBeGreaterThanOrEqual(2); // input-scan + output-scan + telemetry
  });

  it(".agents/skills/ has SKILL.md per enabled persona", () => {
    const skillsDir = path.join(codexCore, ".agents", "skills");
    expect(fs.existsSync(skillsDir)).toBe(true);
    const personas = fs.readdirSync(skillsDir);
    expect(personas).toContain("code-reviewer");
    expect(personas).toContain("security-reviewer");
    const skillMd = path.join(skillsDir, "code-reviewer", "SKILL.md");
    expect(fs.existsSync(skillMd)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Codex sync routing
// ---------------------------------------------------------------------------

describe("A1.7: Codex sync routing", () => {
  let syncTarget: string;
  let originalRepos: string;

  const restoreRepos = () => {
    if (originalRepos) {
      try { fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos); } catch { /* best effort */ }
    }
  };

  beforeAll(() => {
    originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    process.on("exit", restoreRepos);
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sync-codex-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "test-codex", platform: "codex" }])
    );
    run("scripts/sync.ts");
  });

  afterAll(() => {
    process.removeListener("exit", restoreRepos);
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("AGENTS.md at repo root", () => {
    expect(fs.existsSync(path.join(syncTarget, "AGENTS.md"))).toBe(true);
  });

  it(".codex/config.toml synced", () => {
    expect(fs.existsSync(path.join(syncTarget, ".codex", "config.toml"))).toBe(true);
  });

  it(".codex/hooks.json synced", () => {
    expect(fs.existsSync(path.join(syncTarget, ".codex", "hooks.json"))).toBe(true);
  });

  it(".agents/skills/ synced with SKILL.md files", () => {
    const skillsDir = path.join(syncTarget, ".agents", "skills");
    expect(fs.existsSync(skillsDir)).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "code-reviewer", "SKILL.md"))).toBe(true);
  });

  it("does NOT write to .claude/ (Codex uses .codex/)", () => {
    expect(fs.existsSync(path.join(syncTarget, ".claude"))).toBe(false);
  });

  it("codex accepted as valid platform (no validation error)", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-codex-valid-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: target, label: "test-codex-valid", platform: "codex" }])
    );
    try {
      const output = run("scripts/sync.ts");
      expect(output).not.toContain('Platform "codex" is not supported');
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Agents platform broadening
// ---------------------------------------------------------------------------

describe("A1.7-3: agents platform .agents/skills/ emission", () => {
  it("dist/agents/ includes .agents/skills/ with personas", () => {
    const skillsDir = path.join(ROOT, "dist", "agents", "core", ".agents", "skills");
    expect(fs.existsSync(skillsDir)).toBe(true);
    const personas = fs.readdirSync(skillsDir);
    expect(personas.length).toBeGreaterThan(0);
  });

  it("agents platform sync includes .agents/skills/", () => {
    const syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-agents-skills-"));
    const originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "test-agents-skills", platform: "agents" }])
    );
    try {
      run("scripts/sync.ts");
      expect(fs.existsSync(path.join(syncTarget, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(syncTarget, ".agents", "skills"))).toBe(true);
    } finally {
      fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// TOML validation
// ---------------------------------------------------------------------------

describe("A1.7-4: Codex TOML generation", () => {
  it("config.toml has valid TOML structure (no syntax errors)", () => {
    const tomlPath = path.join(ROOT, "dist", "codex", "core", ".codex", "config.toml");
    const content = fs.readFileSync(tomlPath, "utf-8");
    // Basic TOML validation: has table header, key=value pairs
    expect(content).toMatch(/^\[mcp_servers\.\w+\]$/m);
    expect(content).toMatch(/^command = ".+"$/m);
    expect(content).toMatch(/^args = \[.+\]$/m);
    // No unescaped special chars that would break TOML
    expect(content).not.toContain("undefined");
    expect(content).not.toContain("[object Object]");
  });
});
