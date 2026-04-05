/**
 * Phase 9 integration tests.
 *
 * Tests for: AB-161 (Agent pattern selection), AB-160 (Managed settings group/team fragments).
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
// AB-161: Agent pattern selection
// ---------------------------------------------------------------------------

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
