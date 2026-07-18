/**
 * Phase 8 integration tests.
 *
 * Tests for: AB-144 (Gemini), AB-145 (AGENTS.md scope), AB-146 (Windsurf),
 * AB-147 (compliance hooks), AB-143 (MCP governance).
 */

import { describe, it, expect, beforeAll } from "vitest";
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
    timeout: 30_000,
  }).toString();
}

// ---------------------------------------------------------------------------
// Ensure dist/ is built before tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  const distPath = path.join(ROOT, "dist");
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true });
  }
  run("scripts/compile.ts");
});

// ---------------------------------------------------------------------------
// AB-146: Windsurf output format
// ---------------------------------------------------------------------------

describe("AB-146: Windsurf output", () => {
  it("generates .windsurfrules in dist/windsurf/core/", () => {
    const rulesPath = path.join(ROOT, "dist", "windsurf", "core", ".windsurfrules");
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it(".windsurfrules contains all persona content", () => {
    const rulesPath = path.join(ROOT, "dist", "windsurf", "core", ".windsurfrules");
    const content = fs.readFileSync(rulesPath, "utf-8");
    expect(content).toContain("Code Reviewer");
    expect(content).toContain("Security Reviewer");
    expect(content).toContain("Test Generator");
    expect(content).toContain("Test Data Expert");
  });

  it(".windsurfrules has no HTML comments (clean output)", () => {
    const rulesPath = path.join(ROOT, "dist", "windsurf", "core", ".windsurfrules");
    const content = fs.readFileSync(rulesPath, "utf-8");
    expect(content).not.toContain("<!--");
  });

  it(".windsurfrules has persona sections separated by ---", () => {
    const rulesPath = path.join(ROOT, "dist", "windsurf", "core", ".windsurfrules");
    const content = fs.readFileSync(rulesPath, "utf-8");
    // Multiple personas should be separated by --- dividers
    const separators = content.split("---").length - 1;
    expect(separators).toBeGreaterThanOrEqual(3); // At least 3 separators for 4 personas
  });
});

// ---------------------------------------------------------------------------
// AB-144: Gemini output format
// ---------------------------------------------------------------------------

describe("AB-144: Gemini output", () => {
  it("generates GEMINI.md in dist/gemini/core/", () => {
    const geminiPath = path.join(ROOT, "dist", "gemini", "core", "GEMINI.md");
    expect(fs.existsSync(geminiPath)).toBe(true);
  });

  it("GEMINI.md contains org name and structure", () => {
    const geminiPath = path.join(ROOT, "dist", "gemini", "core", "GEMINI.md");
    const content = fs.readFileSync(geminiPath, "utf-8");
    expect(content).toContain("Agent Configuration");
    expect(content).toContain("## Lexicon");
    expect(content).toContain("## Instructions");
    expect(content).toContain("## Available Personas");
  });

  it("GEMINI.md has inlined trait content (no @imports)", () => {
    const geminiPath = path.join(ROOT, "dist", "gemini", "core", "GEMINI.md");
    const content = fs.readFileSync(geminiPath, "utf-8");
    expect(content).not.toContain("@.claude/");
    expect(content).toContain("## Behavioral Traits");
  });

  it("generates per-persona files in dist/gemini/core/{persona}/", () => {
    const personas = ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"];
    for (const persona of personas) {
      const personaPath = path.join(ROOT, "dist", "gemini", "core", persona, "persona.md");
      expect(fs.existsSync(personaPath), `dist/gemini/core/${persona}/persona.md should exist`).toBe(true);
    }
  });

  it("inlines instructions in GEMINI.md (no separate rules for instructions)", () => {
    const geminiPath = path.join(ROOT, "dist", "gemini", "core", "GEMINI.md");
    const content = fs.readFileSync(geminiPath, "utf-8");
    // Instructions are inlined in GEMINI.md since Gemini doesn't support @imports
    expect(content).toContain("## Instructions");
    expect(content).toContain("Code Quality Principles");
  });
});

// ---------------------------------------------------------------------------
// AB-145: AGENTS.md scope awareness
// ---------------------------------------------------------------------------

describe("AB-145: AGENTS.md scope awareness", () => {
  it("generates global AGENTS.md in dist/agents/", () => {
    const agentsPath = path.join(ROOT, "dist", "agents", "AGENTS.md");
    expect(fs.existsSync(agentsPath)).toBe(true);
  });

  it("global AGENTS.md contains all 4 personas", () => {
    const agentsPath = path.join(ROOT, "dist", "agents", "AGENTS.md");
    const content = fs.readFileSync(agentsPath, "utf-8");
    expect(content).toContain("code-reviewer");
    expect(content).toContain("security-reviewer");
    expect(content).toContain("test-generator");
    expect(content).toContain("test-data-expert");
  });

  it("AGENTS.md contains agent metadata", () => {
    const agentsPath = path.join(ROOT, "dist", "agents", "AGENTS.md");
    const content = fs.readFileSync(agentsPath, "utf-8");
    expect(content).toContain("## Agents");
    expect(content).toContain("**Description**");
    expect(content).toContain("**Invocation**");
    expect(content).toContain("**Traits**");
  });

  it("scope-specific AGENTS.md with custom config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-agents-scope-"));
    // Create a node-level persona directory inside the temp hub (next to the
    // config), not inside the agentboot package. Hub content must be resolved
    // relative to the config file's directory.
    const nodePersonaDir = path.join(tempDir, "nodes", "test-group", "personas", "code-reviewer");
    fs.mkdirSync(nodePersonaDir, { recursive: true });
    fs.writeFileSync(path.join(nodePersonaDir, "persona.config.json"), JSON.stringify({
      name: "Code Reviewer (Test Group)",
      description: "Group-specific code reviewer",
      invocation: "/review-code",
      traits: ["critical-thinking"],
    }));
    fs.copyFileSync(
      path.join(ROOT, "core", "personas", "code-reviewer", "SKILL.md"),
      path.join(nodePersonaDir, "SKILL.md")
    );

    try {
      const tempConfig = path.join(tempDir, "agentboot.config.json");
      fs.writeFileSync(tempConfig, JSON.stringify({
        org: "test",
        nodes: { "test-group": {} },
        personas: {
          enabled: ["code-reviewer"],
          outputFormats: ["agents"],
        },
        traits: { enabled: ["critical-thinking"] },
        instructions: { enabled: [] },
      }));
      run(`scripts/compile.ts --config ${tempConfig}`);

      // Check scope-specific AGENTS.md was generated
      const scopeAgentsPath = path.join(tempDir, "dist", "agents", "nodes", "test-group", "AGENTS.md");
      expect(fs.existsSync(scopeAgentsPath)).toBe(true);
      const content = fs.readFileSync(scopeAgentsPath, "utf-8");
      expect(content).toContain("test-group");
      expect(content).toContain("code-reviewer");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AB-147: Compliance hook compilation
// ---------------------------------------------------------------------------

describe("AB-147: Compliance hook compilation", () => {
  it("generates compliance hooks in dist/claude/core/hooks/", () => {
    const hooksDir = path.join(ROOT, "dist", "claude", "core", "hooks");
    expect(fs.existsSync(hooksDir)).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, "agentboot-input-scan.sh"))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, "agentboot-output-scan.sh"))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, "agentboot-telemetry.sh"))).toBe(true);
  });

  it("settings.json contains hook registrations", () => {
    const settingsPath = path.join(ROOT, "dist", "claude", "core", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
  });

  it("repeated builds do not duplicate compliance hooks in settings.json", () => {
    // Run compile a second time on top of the already-built dist — hooks must not double up.
    run("scripts/compile.ts");
    const settingsPath = path.join(ROOT, "dist", "claude", "core", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // Each compliance event should have exactly one entry after multiple builds.
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  // The execute bit (mode & 0o111) is a POSIX concept — Windows has no exec permission.
  it.skipIf(process.platform === "win32")("sync writes shell hook scripts with execute permission", () => {
    // Set up a temp target repo and sync to it.
    const syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-chmod-"));
    const originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    try {
      fs.writeFileSync(
        path.join(ROOT, "repos.json"),
        JSON.stringify([{ path: syncTarget, label: "chmod-test", platform: "claude" }])
      );
      run("scripts/sync.ts");
      const inputScan = path.join(syncTarget, ".claude", "hooks", "agentboot-input-scan.sh");
      expect(fs.existsSync(inputScan)).toBe(true);
      expect(fs.statSync(inputScan).mode & 0o111).toBeGreaterThan(0);
    } finally {
      fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  // The execute bit (mode & 0o111) is a POSIX concept — Windows has no exec permission,
  // so there is nothing to strip or restore there.
  it.skipIf(process.platform === "win32")("sync restores execute permission even when file content is unchanged", () => {
    // Simulates a fresh clone or manual chmod 644 — the next sync must fix the perms.
    const syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-chmod-rerun-"));
    const originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    try {
      fs.writeFileSync(
        path.join(ROOT, "repos.json"),
        JSON.stringify([{ path: syncTarget, label: "chmod-rerun-test", platform: "claude" }])
      );
      // First sync: file written and chmod'd.
      run("scripts/sync.ts");
      const inputScan = path.join(syncTarget, ".claude", "hooks", "agentboot-input-scan.sh");
      expect(fs.existsSync(inputScan)).toBe(true);
      // Strip execute bit to simulate the problem (fresh clone / manual chmod 644).
      fs.chmodSync(inputScan, 0o644);
      expect(fs.statSync(inputScan).mode & 0o111).toBe(0);
      // Second sync: content unchanged → writeFile takes the early-return path.
      run("scripts/sync.ts");
      // Execute bit must be restored even though the file was "skipped".
      expect(fs.statSync(inputScan).mode & 0o111).toBeGreaterThan(0);
    } finally {
      fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  it("persona-specific hooks compile when persona has hooks config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hooks-"));
    const customPersonaDir = path.join(tempDir, "custom-personas", "hook-test");
    fs.mkdirSync(customPersonaDir, { recursive: true });
    fs.writeFileSync(path.join(customPersonaDir, "persona.config.json"), JSON.stringify({
      name: "Hook Test",
      description: "Test persona hooks",
      hooks: {
        PostToolUse: {
          hooks: [{ type: "command", command: "echo 'test'" }],
        },
      },
    }));
    fs.copyFileSync(
      path.join(ROOT, "core", "personas", "code-reviewer", "SKILL.md"),
      path.join(customPersonaDir, "SKILL.md")
    );

    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(tempConfig, JSON.stringify({
      org: "test",
      personas: {
        enabled: ["hook-test"],
        outputFormats: ["claude"],
        customDir: path.join(tempDir, "custom-personas"),
      },
      traits: { enabled: [] },
      instructions: { enabled: [] },
    }));

    try {
      run(`scripts/compile.ts --config ${tempConfig}`);
      const settingsPath = path.join(tempDir, "dist", "claude", "core", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks.PostToolUse).toBeDefined();
      // Should have the persona-specific hook with matcher
      const postToolHooks = settings.hooks.PostToolUse;
      const personaHook = postToolHooks.find((h: any) => h.matcher === "hook-test");
      expect(personaHook).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AB-143: MCP connection governance
// ---------------------------------------------------------------------------

describe("AB-143: MCP governance validation", () => {
  it("passes when no MCP config defined", () => {
    const output = run("scripts/validate.ts");
    expect(output).toContain("MCP governance");
    expect(output).toContain("All 9 checks passed");
  });

  it("rejects required server not in approved list", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-mcp-gov-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(tempConfig, JSON.stringify({
      org: "test",
      personas: { enabled: [] },
      traits: { enabled: [] },
      mcp: {
        approved: [{ name: "server-a", description: "test" }],
        required: ["server-b"],
      },
    }));

    try {
      run(`scripts/validate.ts --config ${tempConfig}`);
      expect.fail("Should have exited with error");
    } catch (err: any) {
      const output = err.stdout?.toString() ?? err.message;
      expect(output).toContain("not in the approved servers list");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unapproved MCP server when enforceApproved is true", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-mcp-enforce-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(tempConfig, JSON.stringify({
      org: "test",
      personas: { enabled: [] },
      traits: { enabled: [] },
      claude: {
        mcpServers: {
          "unapproved-server": { command: "echo" },
        },
      },
      mcp: {
        approved: [{ name: "approved-server" }],
        enforceApproved: true,
      },
    }));

    try {
      run(`scripts/validate.ts --config ${tempConfig}`);
      expect.fail("Should have exited with error");
    } catch (err: any) {
      const output = err.stdout?.toString() ?? err.message;
      expect(output).toContain("not in the approved list");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-platform output verification
// ---------------------------------------------------------------------------

describe("Multi-platform output completeness", () => {
  it("all 9 platforms produce output", () => {
    for (const platform of ["skill", "claude", "copilot", "cursor", "agents", "windsurf", "gemini", "jetbrains", "codex"]) {
      const platformDir = path.join(ROOT, "dist", platform);
      expect(fs.existsSync(platformDir), `dist/${platform}/ should exist`).toBe(true);
    }
  });

  it("compile output mentions all 9 platforms", () => {
    const output = run("scripts/compile.ts");
    expect(output).toContain("9 platform(s)");
    expect(output).toContain("dist/windsurf/");
    expect(output).toContain("dist/gemini/");
    expect(output).toContain("dist/jetbrains/");
    expect(output).toContain("dist/codex/");
  });
});

// ===========================================================================
// Gemini: no @ import lines (per-line pattern check)
// Addresses gap: "Gemini no @imports — existing check uses toContain('@.claude/')
//   but does not assert the ^@ per-line pattern that catches ALL @-import forms"
// (human-in-the-loop-priority.md HIGH section)
//
// The existing test in phase8.test.ts checks:
//   expect(content).not.toContain("@.claude/");
// That only catches the specific CC-native @.claude/ import prefix. A Gemini output
// that contained "@some-other-import" would pass the existing test but still violate
// the Gemini format (which prohibits ALL @ import syntax).
// ===========================================================================

describe("Gemini: no @ import syntax anywhere in output (per-line pattern)", () => {
  // Prove GEMINI.md has no lines starting with @ (catches all @-import forms)
  it("dist/gemini/core/GEMINI.md has no lines starting with @", () => {
    const geminiPath = path.join(ROOT, "dist", "gemini", "core", "GEMINI.md");
    const content = fs.readFileSync(geminiPath, "utf-8");
    // Per-line multiline assertion: any line whose first non-whitespace is @
    expect(content).not.toMatch(/^@/m);
  });

  // Prove per-persona Gemini files also have no @ import lines
  it("dist/gemini/core/{persona}/persona.md files have no lines starting with @", () => {
    const personas = ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"];
    for (const persona of personas) {
      const personaPath = path.join(ROOT, "dist", "gemini", "core", persona, "persona.md");
      expect(fs.existsSync(personaPath), `${persona}/persona.md must exist`).toBe(true);
      const content = fs.readFileSync(personaPath, "utf-8");
      expect(
        content,
        `${persona}/persona.md must not contain any lines starting with @ (Gemini does not support @imports)`
      ).not.toMatch(/^@/m);
    }
  });
});
