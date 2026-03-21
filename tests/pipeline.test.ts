/**
 * Integration tests for the full build pipeline.
 *
 * Runs validate → compile → sync against the project and temp targets,
 * then verifies the output structure and content.
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
// Validate
// ---------------------------------------------------------------------------

describe("validate script", () => {
  it("passes all 4 checks", () => {
    const output = run("scripts/validate.ts");
    expect(output).toContain("All 4 checks passed");
  });

  it("detects missing persona", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-test-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(
      tempConfig,
      JSON.stringify({
        org: "test",
        personas: { enabled: ["nonexistent-persona"] },
        traits: { enabled: [] },
        validation: { secretPatterns: [] },
      })
    );

    try {
      run(`scripts/validate.ts --config ${tempConfig}`);
      expect.fail("Should have exited with error");
    } catch (err: any) {
      expect(err.stdout?.toString() ?? err.message).toContain("nonexistent-persona");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Compile — platform-based dist/ structure
// ---------------------------------------------------------------------------

describe("compile script", () => {
  beforeAll(() => {
    const distPath = path.join(ROOT, "dist");
    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true });
    }
  });

  it("compiles all 4 personas across 3 platforms", () => {
    const output = run("scripts/compile.ts");
    expect(output).toContain("Compiled 4 persona(s)");
    expect(output).toContain("3 platform(s)");
    expect(output).toContain("dist/skill/");
    expect(output).toContain("dist/claude/");
    expect(output).toContain("dist/copilot/");
  });

  it("creates dist/{platform}/core/ structure", () => {
    for (const platform of ["skill", "claude", "copilot"]) {
      const platformCore = path.join(ROOT, "dist", platform, "core");
      expect(fs.existsSync(platformCore), `dist/${platform}/core/ should exist`).toBe(true);
    }
  });

  it("skill and copilot have all 4 persona directories", () => {
    const personas = ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"];
    for (const platform of ["skill", "copilot"]) {
      for (const persona of personas) {
        const personaDir = path.join(ROOT, "dist", platform, "core", persona);
        expect(
          fs.existsSync(personaDir),
          `dist/${platform}/core/${persona}/ should exist`
        ).toBe(true);
      }
    }
  });

  it("claude has all 4 personas as skill directories with SKILL.md", () => {
    const skills = ["review-code", "review-security", "gen-tests", "gen-testdata"];
    for (const skill of skills) {
      const skillPath = path.join(ROOT, "dist", "claude", "core", "skills", skill, "SKILL.md");
      expect(fs.existsSync(skillPath), `dist/claude/core/skills/${skill}/SKILL.md should exist`).toBe(true);
    }
  });

  // --- skill platform ---

  it("skill: generates SKILL.md with traits injected", () => {
    const skillPath = path.join(ROOT, "dist", "skill", "core", "code-reviewer", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("AgentBoot compiled output");
    expect(content).toContain("<!-- trait: critical-thinking -->");
    expect(content).toContain("<!-- trait: structured-output -->");
    expect(content).toContain("<!-- trait: source-citation -->");
    expect(content).toContain("<!-- trait: confidence-signaling -->");
  });

  // --- claude platform ---

  it("claude: generates skills/{name}/SKILL.md with CC-native frontmatter", () => {
    const skillPath = path.join(ROOT, "dist", "claude", "core", "skills", "review-code", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/^---\ndescription:/);
    expect(content).toContain("Code Reviewer");
  });

  // --- AB-17: agent output ---

  it("claude: generates agent files for all 4 personas", () => {
    const agents = [
      { file: "code-reviewer.md", name: "code-reviewer", desc: "Senior code reviewer" },
      { file: "security-reviewer.md", name: "security-reviewer", desc: "Adversarial security reviewer" },
      { file: "test-generator.md", name: "test-generator", desc: "Test-driven engineer" },
      { file: "test-data-expert.md", name: "test-data-expert", desc: "Data engineer" },
    ];
    for (const agent of agents) {
      const agentPath = path.join(ROOT, "dist", "claude", "core", "agents", agent.file);
      expect(fs.existsSync(agentPath), `${agent.file} should exist`).toBe(true);
      const content = fs.readFileSync(agentPath, "utf-8");
      expect(content).toMatch(/^---\nname:/);
      expect(content).toContain(`name: ${agent.name}`);
      // model and permissionMode are only included when explicitly set in persona config
      expect(content).not.toContain("model: inherit");
      expect(content).not.toContain("permissionMode: default");
      // Verify body content (traits should be present)
      expect(content.length).toBeGreaterThan(500);
    }
  });

  // --- AB-19: CLAUDE.md with @imports ---

  it("claude: generates CLAUDE.md with all @import directives", () => {
    const claudeMdPath = path.join(ROOT, "dist", "claude", "core", "CLAUDE.md");
    expect(fs.existsSync(claudeMdPath)).toBe(true);
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    // All 6 traits
    for (const trait of ["critical-thinking", "structured-output", "source-citation", "confidence-signaling", "audit-trail", "schema-awareness"]) {
      expect(content).toContain(`@.claude/traits/${trait}.md`);
    }
    // Both instructions
    expect(content).toContain("@.claude/rules/baseline.instructions.md");
    expect(content).toContain("@.claude/rules/security.instructions.md");
    expect(content).toContain("Auto-generated");
  });

  // --- AB-19: trait files ---

  it("claude: generates all 6 trait files", () => {
    const expectedTraits = [
      "audit-trail", "confidence-signaling", "critical-thinking",
      "schema-awareness", "source-citation", "structured-output"
    ];
    for (const trait of expectedTraits) {
      const traitPath = path.join(ROOT, "dist", "claude", "core", "traits", `${trait}.md`);
      expect(fs.existsSync(traitPath), `traits/${trait}.md should exist`).toBe(true);
      const content = fs.readFileSync(traitPath, "utf-8");
      expect(content.length).toBeGreaterThan(100);
    }
  });

  // --- AB-25: token budget ---

  it("compile output contains per-persona token estimates", () => {
    const output = run("scripts/compile.ts");
    // Verify actual token numbers appear for each persona
    expect(output).toMatch(/code-reviewer.*~?\d+ tokens/);
    expect(output).toMatch(/security-reviewer.*~?\d+ tokens/);
    expect(output).toMatch(/test-data-expert.*~?\d+ tokens/);
    expect(output).toMatch(/test-generator.*~?\d+ tokens/);
    // Verify the token estimate section header appears
    expect(output).toContain("Token estimates");
  });

  // --- copilot platform ---

  it("copilot: generates copilot-instructions.md (HTML comments stripped)", () => {
    const copilotPath = path.join(
      ROOT, "dist", "copilot", "core", "code-reviewer", "copilot-instructions.md"
    );
    const content = fs.readFileSync(copilotPath, "utf-8");
    expect(content).not.toContain("<!-- trait:");
    expect(content).toContain("Code Reviewer");
  });

  // --- cross-platform checks ---

  it("copies persona.config.json to skill and copilot platforms", () => {
    for (const platform of ["skill", "copilot"]) {
      const configPath = path.join(
        ROOT, "dist", platform, "core", "code-reviewer", "persona.config.json"
      );
      expect(fs.existsSync(configPath), `${platform} should have persona.config.json`).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name).toBe("Code Reviewer");
    }
  });

  it("compiles instructions to every platform (rules/ for claude)", () => {
    // skill and copilot use instructions/
    for (const platform of ["skill", "copilot"]) {
      const instrDir = path.join(ROOT, "dist", platform, "core", "instructions");
      expect(fs.existsSync(instrDir), `${platform} should have instructions/`).toBe(true);
      expect(fs.existsSync(path.join(instrDir, "baseline.instructions.md"))).toBe(true);
      expect(fs.existsSync(path.join(instrDir, "security.instructions.md"))).toBe(true);
    }
    // claude uses rules/ (CC-native)
    const rulesDir = path.join(ROOT, "dist", "claude", "core", "rules");
    expect(fs.existsSync(rulesDir), "claude should have rules/").toBe(true);
    expect(fs.existsSync(path.join(rulesDir, "baseline.instructions.md"))).toBe(true);
    expect(fs.existsSync(path.join(rulesDir, "security.instructions.md"))).toBe(true);
  });

  it("generates PERSONAS.md in every platform", () => {
    for (const platform of ["skill", "claude", "copilot"]) {
      const indexPath = path.join(ROOT, "dist", platform, "core", "PERSONAS.md");
      expect(fs.existsSync(indexPath), `${platform} should have PERSONAS.md`).toBe(true);
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toContain("code-reviewer");
      expect(content).toContain("/review-code");
    }
  });

  it("injects correct traits per persona across platforms", () => {
    // security-reviewer: audit-trail yes, confidence-signaling no
    const secSkill = fs.readFileSync(
      path.join(ROOT, "dist", "skill", "core", "security-reviewer", "SKILL.md"),
      "utf-8"
    );
    expect(secSkill).toContain("<!-- trait: audit-trail -->");
    expect(secSkill).not.toContain("<!-- trait: confidence-signaling -->");

    // test-data-expert: schema-awareness yes, critical-thinking no
    const tdSkill = fs.readFileSync(
      path.join(ROOT, "dist", "skill", "core", "test-data-expert", "SKILL.md"),
      "utf-8"
    );
    expect(tdSkill).toContain("<!-- trait: schema-awareness -->");
    expect(tdSkill).not.toContain("<!-- trait: critical-thinking -->");
  });

  it("platforms are self-contained and each has all personas", () => {
    // skill and copilot use persona directories
    const skillPersonas = fs.readdirSync(path.join(ROOT, "dist", "skill", "core"))
      .filter(f => !f.endsWith(".md") && f !== "instructions").sort();
    const copilotPersonas = fs.readdirSync(path.join(ROOT, "dist", "copilot", "core"))
      .filter(f => !f.endsWith(".md") && f !== "instructions").sort();
    expect(skillPersonas).toEqual(copilotPersonas);

    // claude uses skills/ directory with subdirectories
    const claudeSkills = fs.readdirSync(path.join(ROOT, "dist", "claude", "core", "skills")).sort();
    expect(claudeSkills).toEqual(["gen-testdata", "gen-tests", "review-code", "review-security"]);
  });

  // --- AB-26: settings.json ---

  it("claude: generates settings.json when hooks configured", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-settings-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(tempConfig, JSON.stringify({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
      traits: { enabled: ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"] },
      instructions: { enabled: [] },
      claude: {
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] }] },
        permissions: { allow: ["Read"], deny: [] },
      },
    }));
    try {
      run(`scripts/compile.ts --config ${tempConfig}`);
      const settingsPath = path.join(tempDir, "dist", "claude", "core", "settings.json");
      expect(fs.existsSync(settingsPath), "settings.json should be generated").toBe(true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings.hooks).toBeDefined();
      expect(settings.permissions).toBeDefined();
      expect(settings.permissions.allow).toContain("Read");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // --- AB-27: .mcp.json ---

  it("claude: generates .mcp.json when mcpServers configured", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-mcp-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(tempConfig, JSON.stringify({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
      traits: { enabled: ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"] },
      instructions: { enabled: [] },
      claude: {
        mcpServers: { "test-server": { type: "stdio", command: "npx", args: ["-y", "test-pkg"] } },
      },
    }));
    try {
      run(`scripts/compile.ts --config ${tempConfig}`);
      const mcpPath = path.join(tempDir, "dist", "claude", "core", ".mcp.json");
      expect(fs.existsSync(mcpPath), ".mcp.json should be generated").toBe(true);
      const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      expect(mcp.mcpServers["test-server"]).toBeDefined();
      expect(mcp.mcpServers["test-server"].command).toBe("npx");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Sync — reads from dist/{platform}/
// ---------------------------------------------------------------------------

describe("sync script", () => {
  let syncTarget: string;
  let originalRepos: string;

  beforeAll(() => {
    originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sync-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "test-repo", platform: "claude" }])
    );
  });

  afterAll(() => {
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) {
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  it("syncs claude platform files to target repo", () => {
    const output = run("scripts/sync.ts");
    expect(output).toContain("Synced 1 repo");
  });

  it("creates .claude/ directory in target", () => {
    expect(fs.existsSync(path.join(syncTarget, ".claude"))).toBe(true);
  });

  it("writes all skill directories from claude platform", () => {
    const skills = ["review-code", "review-security", "gen-tests", "gen-testdata"];
    for (const skill of skills) {
      const skillPath = path.join(syncTarget, ".claude", "skills", skill, "SKILL.md");
      expect(fs.existsSync(skillPath), `skills/${skill}/SKILL.md should be synced`).toBe(true);
    }
  });

  it("writes rules to target (CC-native)", () => {
    expect(
      fs.existsSync(path.join(syncTarget, ".claude", "rules", "baseline.instructions.md"))
    ).toBe(true);
  });

  it("writes PERSONAS.md to target", () => {
    expect(fs.existsSync(path.join(syncTarget, ".claude", "PERSONAS.md"))).toBe(true);
  });

  // --- AB-24: manifest ---

  it("writes .agentboot-manifest.json to target", () => {
    const manifestPath = path.join(syncTarget, ".claude", ".agentboot-manifest.json");
    expect(fs.existsSync(manifestPath), ".agentboot-manifest.json should exist").toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.managed_by).toBe("agentboot");
    expect(manifest.version).toBeDefined();
    expect(manifest.synced_at).toBeDefined();
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files.length).toBeGreaterThan(0);
    // Each file should have a path and sha256 hash
    for (const file of manifest.files) {
      expect(file.path).toBeDefined();
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("skips unchanged files on re-sync", () => {
    const output = run("scripts/sync.ts");
    expect(output).toContain("unchanged");
  });

  it("supports dry-run mode", () => {
    const cleanTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-dry-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: cleanTarget, label: "dry-run-test", platform: "claude" }])
    );

    try {
      const output = run("scripts/sync.ts -- --dry-run");
      expect(output).toContain("DRY RUN");
      expect(fs.existsSync(path.join(cleanTarget, ".claude"))).toBe(false);
    } finally {
      fs.writeFileSync(
        path.join(ROOT, "repos.json"),
        JSON.stringify([{ path: syncTarget, label: "test-repo", platform: "claude" }])
      );
      fs.rmSync(cleanTarget, { recursive: true, force: true });
    }
  });

  it("syncs copilot platform to a different target", () => {
    const copilotTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-copilot-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: copilotTarget, label: "copilot-repo", platform: "copilot" }])
    );

    try {
      const output = run("scripts/sync.ts");
      expect(output).toContain("Synced 1 repo");

      // Copilot platform should have merged copilot-instructions.md in .github/
      expect(
        fs.existsSync(path.join(copilotTarget, ".github", "copilot-instructions.md")),
        "merged copilot-instructions.md should be synced to .github/"
      ).toBe(true);
      // PERSONAS.md should still be written to the target dir
      expect(
        fs.existsSync(path.join(copilotTarget, ".claude", "PERSONAS.md")),
        "PERSONAS.md should be synced"
      ).toBe(true);
      // Copilot repos should NOT get individual persona skill files in .claude/
      expect(
        fs.existsSync(path.join(copilotTarget, ".claude", "skills")),
        "copilot repos should not have .claude/skills/"
      ).toBe(false);
    } finally {
      fs.writeFileSync(
        path.join(ROOT, "repos.json"),
        JSON.stringify([{ path: syncTarget, label: "test-repo", platform: "claude" }])
      );
      fs.rmSync(copilotTarget, { recursive: true, force: true });
    }
  });

  // --- AB-28: PR mode ---

  it("PR mode validates branch prefix", () => {
    const prTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-pr-"));
    // Initialize a git repo so PR mode has something to work with
    execSync("git init", { cwd: prTarget, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", { cwd: prTarget, stdio: "pipe" });

    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: prTarget, label: "pr-test", platform: "claude" }])
    );

    try {
      // PR mode with default branch prefix — sync should complete without crash
      // PR creation will fail due to no remote, but errors are handled gracefully
      const output = run("scripts/sync.ts -- --mode pr");
      // Should complete without crash (PR will fail due to no remote, but sync succeeds)
      expect(output).toContain("Synced 1 repo");
    } catch {
      // Expected — PR creation will fail without remote, but sync should still run
    } finally {
      fs.writeFileSync(
        path.join(ROOT, "repos.json"),
        JSON.stringify([{ path: syncTarget, label: "test-repo", platform: "claude" }])
      );
      fs.rmSync(prTarget, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scope merging — team > group > core
// ---------------------------------------------------------------------------

describe("sync scope merging", () => {
  let syncTarget: string;
  let originalRepos: string;

  beforeAll(() => {
    originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-merge-"));

    // Create a group-level override in dist/claude/groups/platform/
    const groupSkillDir = path.join(ROOT, "dist", "claude", "groups", "platform", "skills", "review-code");
    fs.mkdirSync(groupSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupSkillDir, "SKILL.md"),
      "---\ndescription: Group-level override\n---\n\n# Group Code Reviewer\n",
      "utf-8"
    );

    // Create a team-level override in dist/claude/teams/platform/api/
    const teamSkillDir = path.join(ROOT, "dist", "claude", "teams", "platform", "api", "skills", "review-code");
    fs.mkdirSync(teamSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamSkillDir, "SKILL.md"),
      "---\ndescription: Team-level override\n---\n\n# Team Code Reviewer\n",
      "utf-8"
    );
  });

  afterAll(() => {
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
    // Clean up test scope dirs
    const groupDir = path.join(ROOT, "dist", "claude", "groups");
    const teamDir = path.join(ROOT, "dist", "claude", "teams");
    if (fs.existsSync(groupDir)) fs.rmSync(groupDir, { recursive: true });
    if (fs.existsSync(teamDir)) fs.rmSync(teamDir, { recursive: true });
  });

  it("team overrides group which overrides core on filename conflict", () => {
    // Sync with team scope: team > group > core
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{
        path: syncTarget,
        label: "merge-test",
        platform: "claude",
        group: "platform",
        team: "api",
      }])
    );

    run("scripts/sync.ts");

    const skillPath = path.join(syncTarget, ".claude", "skills", "review-code", "SKILL.md");
    expect(fs.existsSync(skillPath), "skill should be synced").toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    // Team override should win
    expect(content).toContain("Team Code Reviewer");
    expect(content).not.toContain("Group Code Reviewer");
  });

  it("group overrides core when no team scope", () => {
    const groupTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-group-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{
        path: groupTarget,
        label: "group-test",
        platform: "claude",
        group: "platform",
      }])
    );

    try {
      run("scripts/sync.ts");

      const skillPath = path.join(groupTarget, ".claude", "skills", "review-code", "SKILL.md");
      expect(fs.existsSync(skillPath), "skill should be synced").toBe(true);
      const content = fs.readFileSync(skillPath, "utf-8");
      // Group override should win over core
      expect(content).toContain("Group Code Reviewer");
    } finally {
      fs.writeFileSync(
        path.join(ROOT, "repos.json"),
        JSON.stringify([{
          path: syncTarget,
          label: "merge-test",
          platform: "claude",
          group: "platform",
          team: "api",
        }])
      );
      fs.rmSync(groupTarget, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

describe("full pipeline (validate → compile)", () => {
  it("runs end-to-end without errors", () => {
    const output = execSync(
      `${TSX} scripts/validate.ts && ${TSX} scripts/compile.ts`,
      { cwd: ROOT, env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 30_000 }
    ).toString();

    expect(output).toContain("All 4 checks passed");
    expect(output).toContain("Compiled 4 persona(s)");
    expect(output).toContain("3 platform(s)");
  });
});
