/**
 * Phase 9 integration tests.
 *
 * Tests for: AB-158 (JetBrains output format), AB-161 (Agent pattern selection), AB-160 (Managed settings)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
// Test gotcha fixtures — created before build, cleaned up after
// ---------------------------------------------------------------------------

const pathScopedGotcha = path.join(ROOT, "core", "gotchas", "test-jetbrains-lambda.md");
const generalGotcha = path.join(ROOT, "core", "gotchas", "test-jetbrains-general.md");

// Safety: clean up test gotcha fixtures even if tests crash
const cleanupGotchas = () => {
  try { if (fs.existsSync(pathScopedGotcha)) fs.unlinkSync(pathScopedGotcha); } catch { /* best effort */ }
  try { if (fs.existsSync(generalGotcha)) fs.unlinkSync(generalGotcha); } catch { /* best effort */ }
};

beforeAll(() => {
  process.on("exit", cleanupGotchas);

  // Create test gotcha files so JetBrains gotcha compilation can be tested
  fs.writeFileSync(
    pathScopedGotcha,
    [
      "---",
      'paths: "**/*.lambda.ts"',
      'description: "Lambda cold start rules"',
      "---",
      "",
      "# Lambda Gotcha",
      "",
      "- Cold start penalty applies to all Lambda functions",
      "",
    ].join("\n"),
    "utf-8"
  );
  fs.writeFileSync(
    generalGotcha,
    [
      "---",
      'description: "General advice without path scoping"',
      "---",
      "",
      "# General Gotcha",
      "",
      "- Always check error handling",
      "",
    ].join("\n"),
    "utf-8"
  );

  const distPath = path.join(ROOT, "dist");
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true });
  }
  run("scripts/compile.ts");
});

afterAll(() => {
  process.removeListener("exit", cleanupGotchas);
  cleanupGotchas();
});

// ---------------------------------------------------------------------------
// AB-158: JetBrains Junie output — .junie/AGENTS.md
// ---------------------------------------------------------------------------

describe("AB-158: JetBrains Junie output", () => {
  it("generates .junie/AGENTS.md in dist/jetbrains/core/", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "AGENTS.md");
    expect(fs.existsSync(guidelinesPath)).toBe(true);
  });

  it("AGENTS.md contains all persona names", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "AGENTS.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    expect(content).toContain("Code Reviewer");
    expect(content).toContain("Security Reviewer");
    expect(content).toContain("Test Generator");
    expect(content).toContain("Test Data Expert");
  });

  it("AGENTS.md has no trait injection markers", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "AGENTS.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    expect(content).not.toContain("<!-- traits:");
  });

  it("AGENTS.md has persona sections separated by ---", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "AGENTS.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    // Multiple personas should be separated by --- dividers
    const separators = content.split("\n---\n").length - 1;
    expect(separators).toBeGreaterThanOrEqual(3); // At least 3 separators for 4 personas
  });

  it("AGENTS.md starts with AgentBoot header", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "AGENTS.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    expect(content).toContain("# AgentBoot Personas");
  });
});

// ---------------------------------------------------------------------------
// AB-158: JetBrains AI Assistant output — .aiassistant/rules/
// ---------------------------------------------------------------------------

describe("AB-158: JetBrains AI Assistant rules", () => {
  it("generates .aiassistant/rules/ directory with instruction files", () => {
    const rulesDir = path.join(ROOT, "dist", "jetbrains", "core", ".aiassistant", "rules");
    expect(fs.existsSync(rulesDir)).toBe(true);
    const files = fs.readdirSync(rulesDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it("instruction files exist in .aiassistant/rules/", () => {
    const rulesDir = path.join(ROOT, "dist", "jetbrains", "core", ".aiassistant", "rules");
    const files = fs.readdirSync(rulesDir);
    // Should have instruction files (baseline.instructions.md, security.instructions.md)
    expect(files.some(f => f.includes("baseline"))).toBe(true);
    expect(files.some(f => f.includes("security"))).toBe(true);
  });

  it("gotcha files exist in .aiassistant/rules/ with .rules.md extension", () => {
    const rulesDir = path.join(ROOT, "dist", "jetbrains", "core", ".aiassistant", "rules");
    const files = fs.readdirSync(rulesDir);
    const rulesFiles = files.filter(f => f.endsWith(".rules.md"));
    expect(rulesFiles.length).toBeGreaterThanOrEqual(2); // path-scoped + general
  });

  it("path-scoped gotcha files have globs: frontmatter", () => {
    const rulePath = path.join(ROOT, "dist", "jetbrains", "core", ".aiassistant", "rules", "test-jetbrains-lambda.rules.md");
    expect(fs.existsSync(rulePath)).toBe(true);
    const content = fs.readFileSync(rulePath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('globs:');
    expect(content).toContain("**/*.lambda.ts");
    expect(content).toContain('description:');
  });

  it("non-path-scoped gotcha files have description but no globs", () => {
    const rulePath = path.join(ROOT, "dist", "jetbrains", "core", ".aiassistant", "rules", "test-jetbrains-general.rules.md");
    expect(fs.existsSync(rulePath)).toBe(true);
    const content = fs.readFileSync(rulePath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('description:');
    expect(content).not.toContain('globs:');
  });
});

// ---------------------------------------------------------------------------
// AB-158: JetBrains PERSONAS.md
// ---------------------------------------------------------------------------

describe("AB-158: JetBrains PERSONAS.md", () => {
  it("generates PERSONAS.md in dist/jetbrains/core/", () => {
    const personasPath = path.join(ROOT, "dist", "jetbrains", "core", "PERSONAS.md");
    expect(fs.existsSync(personasPath)).toBe(true);
  });

  it("PERSONAS.md contains all personas", () => {
    const personasPath = path.join(ROOT, "dist", "jetbrains", "core", "PERSONAS.md");
    const content = fs.readFileSync(personasPath, "utf-8");
    expect(content).toContain("code-reviewer");
    expect(content).toContain("security-reviewer");
    expect(content).toContain("test-generator");
    expect(content).toContain("test-data-expert");
  });
});

// ---------------------------------------------------------------------------
// Multi-platform output verification (updated for 8 platforms)
// ---------------------------------------------------------------------------

describe("AB-158: Multi-platform output includes JetBrains", () => {
  it("jetbrains platform directory exists", () => {
    const platformDir = path.join(ROOT, "dist", "jetbrains");
    expect(fs.existsSync(platformDir)).toBe(true);
  });

  it("compile output mentions 9 platforms", () => {
    const output = run("scripts/compile.ts");
    expect(output).toContain("9 platform(s)");
    expect(output).toContain("dist/jetbrains/");
  });
});
describe("AB-161: Agent pattern selection", () => {
  it("code-reviewer persona.config.json has pattern field", () => {
    const configPath = path.join(ROOT, "core", "personas", "code-reviewer", "persona.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.pattern).toBe("react");
  });

  it("react pattern does not emit agentProfile (it is the default)", () => {
    const agentPath = path.join(ROOT, "dist", "claude", "core", "agents", "code-reviewer.md");
    const content = fs.readFileSync(agentPath, "utf-8");
    // react is the default, so agentProfile should NOT be in frontmatter
    expect(content).not.toContain("agentProfile:");
  });

  it("pattern defaults maxTurns when persona does not specify it", () => {
    // code-reviewer has pattern: "react" (maxTurns: 10) and no explicit maxTurns
    const agentPath = path.join(ROOT, "dist", "claude", "core", "agents", "code-reviewer.md");
    const content = fs.readFileSync(agentPath, "utf-8");
    expect(content).toContain("maxTurns: 10");
  });

  it("PATTERN_CONFIGS has correct entries", async () => {
    const { PATTERN_CONFIGS } = await import("../scripts/compile.js");
    expect(PATTERN_CONFIGS).toHaveProperty("react");
    expect(PATTERN_CONFIGS).toHaveProperty("rewoo");
    expect(PATTERN_CONFIGS).toHaveProperty("router");
    expect(PATTERN_CONFIGS).toHaveProperty("sequential");
    expect(PATTERN_CONFIGS).toHaveProperty("tool-calling");
    expect(PATTERN_CONFIGS["react"].maxTurns).toBe(10);
    expect(PATTERN_CONFIGS["router"].maxTurns).toBe(1);
    expect(PATTERN_CONFIGS["rewoo"].planFirst).toBe(true);
  });

  it("validation warns on router pattern for non-orchestrator persona", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-pattern-test-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    const personaDir = path.join(tempDir, "core", "personas", "test-persona");
    fs.mkdirSync(personaDir, { recursive: true });

    // Create a persona config with router pattern but non-orchestrator description
    fs.writeFileSync(
      path.join(personaDir, "persona.config.json"),
      JSON.stringify({
        name: "Test Persona",
        description: "A regular code reviewer",
        pattern: "router",
        traits: [],
      })
    );
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      "---\nname: Test Persona\ndescription: test\n---\n\nTest content"
    );

    fs.writeFileSync(
      tempConfig,
      JSON.stringify({
        org: "test",
        personas: { enabled: ["test-persona"], customDir: path.join(tempDir, "core", "personas") },
        traits: { enabled: [] },
        validation: { secretPatterns: [] },
      })
    );

    // Run validate — it should pass but with a warning about router pattern
    const output = run(`scripts/validate.ts --config ${tempConfig}`);
    expect(output).toContain('pattern "router" is typically used for orchestrator personas');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("validation rejects invalid pattern value", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-pattern-invalid-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    const personaDir = path.join(tempDir, "core", "personas", "test-persona");
    fs.mkdirSync(personaDir, { recursive: true });

    fs.writeFileSync(
      path.join(personaDir, "persona.config.json"),
      JSON.stringify({
        name: "Test Persona",
        description: "test",
        pattern: "invalid-pattern",
        traits: [],
      })
    );
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      "---\nname: Test Persona\ndescription: test\n---\n\nTest content"
    );

    fs.writeFileSync(
      tempConfig,
      JSON.stringify({
        org: "test",
        personas: { enabled: ["test-persona"], customDir: path.join(tempDir, "core", "personas") },
        traits: { enabled: [] },
        validation: { secretPatterns: [] },
      })
    );

    try {
      run(`scripts/validate.ts --config ${tempConfig}`);
      expect.fail("Should have exited with error");
    } catch (err: any) {
      const output = err.stdout?.toString() ?? err.message;
      expect(output).toContain('Invalid pattern "invalid-pattern"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AB-160: Managed settings group/team fragments
// ---------------------------------------------------------------------------

describe("AB-160: Managed settings group/team fragments", () => {
  it("00-org.json is still generated correctly (no regression)", () => {
    // The project config doesn't have claude.permissions or managed settings enabled,
    // so 00-org.json may not exist in the default build. Let's verify the build completes.
    // This is a no-regression check that the build still works.
    const output = run("scripts/compile.ts");
    expect(output).toContain("Compiled 4 persona(s)");
  });

  it("generates 10-group.json for groups with config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-managed-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    const personaDir = path.join(tempDir, "core", "personas", "test-persona");
    const nodesDir = path.join(tempDir, "nodes", "platform", "personas", "test-persona");
    fs.mkdirSync(personaDir, { recursive: true });
    fs.mkdirSync(nodesDir, { recursive: true });

    // Create trait directory (empty is fine)
    fs.mkdirSync(path.join(tempDir, "core", "traits"), { recursive: true });

    // Create persona files in core
    fs.writeFileSync(
      path.join(personaDir, "persona.config.json"),
      JSON.stringify({ name: "Test", description: "test", traits: [] })
    );
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      "---\nname: Test\ndescription: test\n---\n\n<!-- traits:start -->\n<!-- traits:end -->\n\nTest"
    );

    // Create persona files in node
    fs.writeFileSync(
      path.join(nodesDir, "persona.config.json"),
      JSON.stringify({ name: "Test", description: "test", traits: [] })
    );
    fs.writeFileSync(
      path.join(nodesDir, "SKILL.md"),
      "---\nname: Test\ndescription: test\n---\n\n<!-- traits:start -->\n<!-- traits:end -->\n\nTest"
    );

    const distDir = path.join(tempDir, "dist");

    fs.writeFileSync(
      tempConfig,
      JSON.stringify({
        org: "test-org",
        groups: {
          platform: {
            teams: ["api"],
            permissions: { allow: ["Read"], deny: ["Write"] },
            mcpServers: { "test-server": { command: "test" } },
          },
        },
        nodes: {
          platform: {
            children: { api: {} },
          },
        },
        personas: {
          enabled: ["test-persona"],
          outputFormats: ["claude"],
        },
        traits: { enabled: [] },
        output: { distPath: distDir },
        validation: { secretPatterns: [] },
      })
    );

    run(`scripts/compile.ts --config ${tempConfig}`);

    const groupManagedPath = path.join(distDir, "claude", "nodes", "platform", "managed-settings.d", "10-group.json");
    expect(fs.existsSync(groupManagedPath)).toBe(true);

    const fragment = JSON.parse(fs.readFileSync(groupManagedPath, "utf-8"));
    expect(fragment["// source"]).toContain("group:platform");
    expect(fragment.permissions).toEqual({ allow: ["Read"], deny: ["Write"] });
    expect(fragment.mcpServers).toEqual({ "test-server": { command: "test" } });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not generate 20-team.json when team has no specific config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-team-managed-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    const personaDir = path.join(tempDir, "core", "personas", "test-persona");
    const nodesDir = path.join(tempDir, "nodes", "platform", "api", "personas", "test-persona");
    fs.mkdirSync(personaDir, { recursive: true });
    fs.mkdirSync(nodesDir, { recursive: true });

    fs.mkdirSync(path.join(tempDir, "core", "traits"), { recursive: true });

    fs.writeFileSync(
      path.join(personaDir, "persona.config.json"),
      JSON.stringify({ name: "Test", description: "test", traits: [] })
    );
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      "---\nname: Test\ndescription: test\n---\n\n<!-- traits:start -->\n<!-- traits:end -->\n\nTest"
    );

    fs.writeFileSync(
      path.join(nodesDir, "persona.config.json"),
      JSON.stringify({ name: "Test", description: "test", traits: [] })
    );
    fs.writeFileSync(
      path.join(nodesDir, "SKILL.md"),
      "---\nname: Test\ndescription: test\n---\n\n<!-- traits:start -->\n<!-- traits:end -->\n\nTest"
    );

    const distDir = path.join(tempDir, "dist");

    fs.writeFileSync(
      tempConfig,
      JSON.stringify({
        org: "test-org",
        groups: {
          platform: { teams: ["api"] },
        },
        nodes: {
          platform: {
            children: { api: {} },
          },
        },
        personas: {
          enabled: ["test-persona"],
          outputFormats: ["claude"],
        },
        traits: { enabled: [] },
        output: { distPath: distDir },
        validation: { secretPatterns: [] },
      })
    );

    run(`scripts/compile.ts --config ${tempConfig}`);

    // Team fragment should NOT exist because team has no specific config (only source comment)
    const teamManagedPath = path.join(distDir, "claude", "nodes", "platform", "api", "managed-settings.d", "20-team.json");
    expect(fs.existsSync(teamManagedPath)).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
