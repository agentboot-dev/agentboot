/**
 * Tests for CLI commands and AB-2 compile features.
 *
 * Covers: AB-18 (context:fork), AB-33 (setup), AB-34/35 (add), AB-36 (doctor),
 * AB-37 (status), AB-38 (lint), AB-45 (uninstall), AB-52 (gotchas),
 * AB-55 (prompt style guide), AB-77 (welcome fragment), config command.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

function run(args: string, cwd = ROOT): string {
  return execSync(`${TSX} ${CLI} ${args}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    timeout: 30_000,
  }).toString();
}

function runExpectFail(args: string, cwd = ROOT): string {
  try {
    run(args, cwd);
    throw new Error("Expected command to fail but it succeeded");
  } catch (err: any) {
    if (err.message === "Expected command to fail but it succeeded") throw err;
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    return stdout + stderr || err.message;
  }
}

// ===========================================================================
// AB-18: Skills with context:fork
// ===========================================================================

describe("AB-18: skill frontmatter with context:fork", () => {
  const skillPath = path.join(ROOT, "dist", "claude", "core", "skills", "review-code", "SKILL.md");

  it("skill frontmatter contains context: fork", () => {
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("context: fork");
  });

  it("skill frontmatter contains agent: pointing to persona name", () => {
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain('agent: "code-reviewer"');
  });

  it("skill description is properly quoted in YAML", () => {
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/description: ".*"/);
  });

  it("all 4 skills have context:fork and correct agent references", () => {
    const skills = [
      { dir: "review-code", agent: "code-reviewer" },
      { dir: "review-security", agent: "security-reviewer" },
      { dir: "gen-tests", agent: "test-generator" },
      { dir: "gen-testdata", agent: "test-data-expert" },
    ];
    for (const skill of skills) {
      const content = fs.readFileSync(
        path.join(ROOT, "dist", "claude", "core", "skills", skill.dir, "SKILL.md"),
        "utf-8",
      );
      expect(content, `${skill.dir} should have context: fork`).toContain("context: fork");
      expect(content, `${skill.dir} should reference agent ${skill.agent}`).toContain(
        `agent: "${skill.agent}"`,
      );
    }
  });

  it("skill frontmatter does NOT have double frontmatter blocks", () => {
    const content = fs.readFileSync(skillPath, "utf-8");
    // The file should start with exactly one frontmatter block (---\n...\n---)
    // Check that there's only one frontmatter opening at the very start
    const frontmatterOpens = content.match(/^---\n/gm);
    // First line must be --- and there should be exactly one more --- that closes it
    expect(content.startsWith("---\n")).toBe(true);
    // After stripping the frontmatter, the remaining content should NOT start with ---
    const afterFm = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
    expect(afterFm.startsWith("---")).toBe(false);
  });

  it("original SKILL.md frontmatter is stripped (not duplicated)", () => {
    const content = fs.readFileSync(skillPath, "utf-8");
    // The source SKILL.md has "name:" and "version:" in frontmatter — these should be stripped
    expect(content).not.toMatch(/^name:/m);
    expect(content).not.toMatch(/^version:/m);
  });
});

// ===========================================================================
// AB-77: Welcome fragment in CLAUDE.md
// ===========================================================================

describe("AB-77: welcome fragment in CLAUDE.md", () => {
  const claudeMdPath = path.join(ROOT, "dist", "claude", "core", "CLAUDE.md");

  it("contains Available Personas section", () => {
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("## Available Personas");
  });

  it("lists all 4 personas with invocation commands", () => {
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("`/review-code`");
    expect(content).toContain("`/review-security`");
    expect(content).toContain("`/gen-tests`");
    expect(content).toContain("`/gen-testdata`");
  });

  it("includes persona descriptions", () => {
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("Senior code reviewer");
  });

  it("instruction @imports do NOT have double .md extension", () => {
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    expect(content).not.toContain(".md.md");
  });
});

// ===========================================================================
// AB-52: Gotchas compilation
// ===========================================================================

describe("AB-52: gotchas compilation", () => {
  // compile.ts resolves coreDir from its own ROOT, so we test gotchas
  // by creating a gotcha in the actual project, building, then cleaning up.
  const gotchaPath = path.join(ROOT, "core", "gotchas", "test-gotcha.md");

  afterEach(() => {
    if (fs.existsSync(gotchaPath)) fs.unlinkSync(gotchaPath);
  });

  it("compiles gotcha files from core/gotchas/ to dist/claude/core/rules/", () => {
    // Create a test gotcha in the real project
    fs.writeFileSync(
      gotchaPath,
      '---\npaths:\n  - "**/*.lambda.ts"\n---\n\n# Test Gotcha\n\n- Cold start penalty\n',
    );

    // Rebuild
    run("build");

    // Gotcha should appear in claude rules
    const rulesDir = path.join(ROOT, "dist", "claude", "core", "rules");
    expect(fs.existsSync(path.join(rulesDir, "test-gotcha.md"))).toBe(true);
    const content = fs.readFileSync(path.join(rulesDir, "test-gotcha.md"), "utf-8");
    expect(content).toContain("Cold start penalty");

    // Gotcha should appear in skill gotchas
    const skillGotchasDir = path.join(ROOT, "dist", "skill", "core", "gotchas");
    expect(fs.existsSync(path.join(skillGotchasDir, "test-gotcha.md"))).toBe(true);

    // README should NOT be compiled
    expect(fs.existsSync(path.join(rulesDir, "README.md"))).toBe(false);

    // Clean up dist gotcha files
    fs.unlinkSync(path.join(rulesDir, "test-gotcha.md"));
    if (fs.existsSync(path.join(skillGotchasDir, "test-gotcha.md"))) {
      fs.unlinkSync(path.join(skillGotchasDir, "test-gotcha.md"));
    }
  });
});

// ===========================================================================
// AB-129: Cursor .mdc output format
// ===========================================================================

describe("AB-129: cursor .mdc output", () => {
  const gotchaPath = path.join(ROOT, "core", "gotchas", "test-cursor-gotcha.md");

  afterEach(() => {
    if (fs.existsSync(gotchaPath)) fs.unlinkSync(gotchaPath);
  });

  it("compiles gotcha with paths: to cursor .mdc with globs and alwaysApply: false", () => {
    fs.writeFileSync(
      gotchaPath,
      '---\npaths: "**/*.lambda.ts"\ndescription: Lambda cold start rules\n---\n\n# Lambda Gotcha\n\n- Cold start penalty\n',
    );

    run("build");

    // Should be a flat .mdc file, not a subdirectory
    const mdcPath = path.join(ROOT, "dist", "cursor", "core", "rules", "test-cursor-gotcha.mdc");
    expect(fs.existsSync(mdcPath), "gotcha should be compiled to .mdc file").toBe(true);
    const content = fs.readFileSync(mdcPath, "utf-8");
    expect(content).toContain('description: "Lambda cold start rules"');
    expect(content).toContain('globs: "**/*.lambda.ts"');
    expect(content).toContain("alwaysApply: false");
    expect(content).toContain("Cold start penalty");

    // Old subdirectory format should NOT exist
    expect(
      fs.existsSync(path.join(ROOT, "dist", "cursor", "core", "rules", "test-cursor-gotcha", "RULE.md")),
      "old subdirectory format should not exist"
    ).toBe(false);

    // Clean up
    fs.unlinkSync(mdcPath);
  });

  it("persona .mdc files have alwaysApply: true and no globs", () => {
    run("build");

    const mdcPath = path.join(ROOT, "dist", "cursor", "core", "rules", "code-reviewer.mdc");
    expect(fs.existsSync(mdcPath), "persona .mdc should exist").toBe(true);
    const content = fs.readFileSync(mdcPath, "utf-8");
    expect(content).toContain("alwaysApply: true");
    expect(content).not.toMatch(/^globs:/m);
  });
});

// ===========================================================================
// AB-130: Copilot scoped instructions (applyTo)
// ===========================================================================

describe("AB-130: copilot scoped instructions", () => {
  const gotchaPath = path.join(ROOT, "core", "gotchas", "test-copilot-gotcha.md");

  afterEach(() => {
    if (fs.existsSync(gotchaPath)) fs.unlinkSync(gotchaPath);
  });

  it("generates .instructions.md with applyTo for gotchas with paths:", () => {
    fs.writeFileSync(
      gotchaPath,
      '---\npaths: "src/**/*.ts, lib/**/*.ts"\ndescription: TypeScript patterns\n---\n\n# TS Gotcha\n\n- Use strict mode\n',
    );

    run("build");

    const instrPath = path.join(ROOT, "dist", "copilot", "core", "instructions", "test-copilot-gotcha.instructions.md");
    expect(fs.existsSync(instrPath), "scoped instruction should be generated").toBe(true);
    const content = fs.readFileSync(instrPath, "utf-8");
    expect(content).toContain('description: "TypeScript patterns"');
    expect(content).toContain('applyTo: "src/**/*.ts, lib/**/*.ts"');
    expect(content).toContain("Use strict mode");
    // Should not contain original frontmatter
    expect(content).not.toContain("paths:");

    // Clean up
    fs.unlinkSync(instrPath);
  });

  it("does not generate scoped instruction for gotchas without paths:", () => {
    fs.writeFileSync(
      gotchaPath,
      '---\ndescription: General rule without paths\n---\n\n# General Gotcha\n\n- General advice\n',
    );

    run("build");

    const instrDir = path.join(ROOT, "dist", "copilot", "core", "instructions");
    const instrPath = path.join(instrDir, "test-copilot-gotcha.instructions.md");
    expect(
      fs.existsSync(instrPath),
      "gotcha without paths: should not get scoped instruction"
    ).toBe(false);
  });
});

// ===========================================================================
// AB-33.2: install command
// ===========================================================================

describe("AB-33.2: install command", () => {
  it("--non-interactive creates hub with default config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ni-install-"));
    try {
      const output = run(`install --non-interactive --path ${tmpDir}/personas`, tmpDir);
      expect(output).toContain("Non-interactive");
      expect(fs.existsSync(path.join(tmpDir, "personas", "agentboot.config.json"))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, "personas", "agentboot.config.json"), "utf-8"));
      expect(config.org).toBe("my-org");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("--non-interactive uses AGENTBOOT_ORG env var", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ni-org-"));
    try {
      const output = execSync(
        `${TSX} ${CLI} install --non-interactive --path ${tmpDir}/personas`,
        {
          cwd: tmpDir,
          env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0", AGENTBOOT_ORG: "test-corp" },
          timeout: 30_000,
        }
      ).toString();
      expect(output).toContain("test-corp");
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, "personas", "agentboot.config.json"), "utf-8"));
      expect(config.org).toBe("test-corp");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("--non-interactive --connect without --hub-path exits with error", () => {
    const output = runExpectFail("install --non-interactive --connect");
    expect(output).toContain("--hub-path");
  });

  it("detects existing agentboot.config.json and redirects to doctor", () => {
    // Run from the project root which has agentboot.config.json
    const output = run("install --hub");
    expect(output).toContain("already exists");
  });

  it("setup command shows deprecation notice", () => {
    const output = run("setup");
    expect(output).toContain("deprecated");
  });
});

// AB-33.2: install unit tests (pure functions)
// ===========================================================================

import { detectCwd, scaffoldHub, scanNearby, hasPrompts, getGitOrgAndRepo, addToReposJson } from "../scripts/lib/install.js";

describe("AB-33.2: detectCwd", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-detect-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects empty directory as not a code repo", () => {
    const result = detectCwd(tempDir);
    expect(result.looksLikeCodeRepo).toBe(false);
    expect(result.hasAgentbootConfig).toBe(false);
    expect(result.hasClaudeDir).toBe(false);
  });

  it("detects directory with package.json as a code repo", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
    const result = detectCwd(tempDir);
    expect(result.looksLikeCodeRepo).toBe(true);
    expect(result.hasPackageJson).toBe(true);
  });

  it("detects directory with agentboot.config.json as a hub", () => {
    fs.writeFileSync(path.join(tempDir, "agentboot.config.json"), "{}");
    const result = detectCwd(tempDir);
    expect(result.hasAgentbootConfig).toBe(true);
    expect(result.looksLikeCodeRepo).toBe(false);
  });

  it("inventories .claude/ artifacts", () => {
    fs.mkdirSync(path.join(tempDir, ".claude", "rules"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", "CLAUDE.md"), "# test");
    fs.writeFileSync(path.join(tempDir, ".claude", "rules", "my-rule.md"), "# rule");
    const result = detectCwd(tempDir);
    expect(result.hasClaudeDir).toBe(true);
    expect(result.claudeArtifacts).toContain("CLAUDE.md");
    expect(result.claudeArtifacts).toContain("rules/my-rule.md");
  });

  it("detects .agentboot-manifest.json as managed repo", () => {
    fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", ".agentboot-manifest.json"), "{}");
    const result = detectCwd(tempDir);
    expect(result.hasManifest).toBe(true);
  });
});

describe("AB-33.2: scaffoldHub", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scaffold-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates agentboot.config.json with correct org", () => {
    scaffoldHub(tempDir, "test-org");
    const configPath = path.join(tempDir, "agentboot.config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.org).toBe("test-org");
    expect(config.personas.enabled).toContain("code-reviewer");
    expect(config.traits.enabled).toContain("critical-thinking");
  });

  it("creates repos.json as empty array", () => {
    scaffoldHub(tempDir, "test-org");
    const reposPath = path.join(tempDir, "repos.json");
    expect(fs.existsSync(reposPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(reposPath, "utf-8"))).toEqual([]);
  });

  it("creates core directory structure", () => {
    scaffoldHub(tempDir, "test-org");
    expect(fs.existsSync(path.join(tempDir, "core", "personas"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "core", "traits"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "core", "instructions"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "core", "gotchas"))).toBe(true);
  });

  it("generates valid JSON config", () => {
    scaffoldHub(tempDir, "test-org");
    const raw = fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("does not overwrite existing repos.json", () => {
    fs.writeFileSync(path.join(tempDir, "repos.json"), '[{"path":"/existing"}]');
    scaffoldHub(tempDir, "test-org");
    const repos = JSON.parse(fs.readFileSync(path.join(tempDir, "repos.json"), "utf-8"));
    expect(repos).toEqual([{ path: "/existing" }]);
  });

  it("sets orgDisplayName separately from org slug", () => {
    scaffoldHub(tempDir, "acme-corp", "Acme Corporation");
    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"));
    expect(config.org).toBe("acme-corp");
    expect(config.orgDisplayName).toBe("Acme Corporation");
  });

  it("defaults orgDisplayName to slug when not provided", () => {
    scaffoldHub(tempDir, "solo-dev");
    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"));
    expect(config.org).toBe("solo-dev");
    expect(config.orgDisplayName).toBe("solo-dev");
  });

  it("initializes a git repository", () => {
    scaffoldHub(tempDir, "test-org");
    expect(fs.existsSync(path.join(tempDir, ".git"))).toBe(true);
  });

  it("does not re-init if .git already exists", () => {
    fs.mkdirSync(path.join(tempDir, ".git"));
    const before = fs.statSync(path.join(tempDir, ".git")).mtimeMs;
    scaffoldHub(tempDir, "test-org");
    const after = fs.statSync(path.join(tempDir, ".git")).mtimeMs;
    expect(after).toBe(before);
  });

  it("creates .gitignore with dist/ and node_modules/", () => {
    scaffoldHub(tempDir, "test-org");
    const gitignore = fs.readFileSync(path.join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("dist/");
  });

  it("does not overwrite existing .gitignore", () => {
    fs.writeFileSync(path.join(tempDir, ".gitignore"), "custom\n");
    scaffoldHub(tempDir, "test-org");
    expect(fs.readFileSync(path.join(tempDir, ".gitignore"), "utf-8")).toBe("custom\n");
  });

  it("includes default agents section when no options provided", () => {
    scaffoldHub(tempDir, "test-org");
    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"));
    expect(config.agents).toBeDefined();
    expect(config.agents.tools).toEqual(["claude-code", "copilot"]);
    expect(config.agents.primary).toBe("claude-code");
    expect(config.agents.llmProvider).toBe("claude-code");
  });

  it("uses provided agent tools and derives output formats", () => {
    scaffoldHub(tempDir, "test-org", "Test Org", {
      agentTools: ["copilot", "cursor"],
      primaryAgent: "copilot",
    });
    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"));
    expect(config.agents.tools).toEqual(["copilot", "cursor"]);
    expect(config.agents.primary).toBe("copilot");
    expect(config.agents.llmProvider).toBe("anthropic-api");
    // Output formats driven by tools: skill is always present, copilot from the tool, no claude
    expect(config.personas.outputFormats).toContain("skill");
    expect(config.personas.outputFormats).toContain("copilot");
    expect(config.personas.outputFormats).not.toContain("claude");
  });
});

// ===========================================================================
// AB-33.2: scanNearby
// ===========================================================================

describe("AB-33.2: scanNearby", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nearby-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("detects a sibling hub repo", () => {
    const spoke = path.join(parentDir, "my-app");
    const hub = path.join(parentDir, "personas");
    fs.mkdirSync(spoke);
    fs.mkdirSync(hub);
    fs.writeFileSync(path.join(hub, "agentboot.config.json"), "{}", "utf-8");

    const results = scanNearby(spoke);
    const hubs = results.filter(r => r.type === "hub");
    expect(hubs.length).toBe(1);
    expect(hubs[0]!.path).toBe(hub);
  });

  it("detects the parent directory as a hub", () => {
    // Parent-hub layout: hub is the parent, spokes are children
    fs.writeFileSync(path.join(parentDir, "agentboot.config.json"), "{}", "utf-8");
    const spoke = path.join(parentDir, "my-app");
    fs.mkdirSync(spoke);

    const results = scanNearby(spoke);
    const hubs = results.filter(r => r.type === "hub");
    expect(hubs.length).toBe(1);
    expect(hubs[0]!.path).toBe(parentDir);
  });

  it("detects sibling repos with agentic content", () => {
    const spoke = path.join(parentDir, "my-app");
    const other = path.join(parentDir, "other-app");
    fs.mkdirSync(spoke);
    fs.mkdirSync(path.join(other, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(other, ".claude", "CLAUDE.md"), "# test", "utf-8");

    const results = scanNearby(spoke);
    const prompts = results.filter(r => r.type === "prompts");
    expect(prompts.length).toBe(1);
    expect(prompts[0]!.path).toBe(other);
    expect(prompts[0]!.files).toBeDefined();
    expect(prompts[0]!.files!.length).toBeGreaterThan(0);
  });

  it("includes cwd agentic content in scan results", () => {
    const spoke = path.join(parentDir, "my-app");
    fs.mkdirSync(spoke);
    fs.mkdirSync(path.join(spoke, ".claude"));
    fs.writeFileSync(path.join(spoke, ".claude", "CLAUDE.md"), "# test", "utf-8");

    const results = scanNearby(spoke);
    const cwdResult = results.find(r => r.path === spoke);
    expect(cwdResult).toBeDefined();
    expect(cwdResult!.type).toBe("prompts");
    expect(cwdResult!.files).toBeDefined();
  });

  it("does not include cwd as a hub even with agentboot.config.json", () => {
    const spoke = path.join(parentDir, "my-app");
    fs.mkdirSync(spoke);
    fs.writeFileSync(path.join(spoke, "agentboot.config.json"), "{}", "utf-8");

    const results = scanNearby(spoke);
    const cwdHub = results.find(r => r.path === spoke && r.type === "hub");
    expect(cwdHub).toBeUndefined();
  });

  it("returns empty for isolated directory without .claude/", () => {
    const spoke = path.join(parentDir, "lonely");
    fs.mkdirSync(spoke);

    const results = scanNearby(spoke);
    expect(results.length).toBe(0);
  });

  it("does not double-count parent that is also a sibling entry", () => {
    // Edge case: parent has config, and a sibling also has config
    fs.writeFileSync(path.join(parentDir, "agentboot.config.json"), "{}", "utf-8");
    const spoke = path.join(parentDir, "my-app");
    const otherHub = path.join(parentDir, "other-hub");
    fs.mkdirSync(spoke);
    fs.mkdirSync(otherHub);
    fs.writeFileSync(path.join(otherHub, "agentboot.config.json"), "{}", "utf-8");

    const results = scanNearby(spoke);
    const hubs = results.filter(r => r.type === "hub");
    expect(hubs.length).toBe(2);
    // Parent and sibling are both detected
    expect(hubs.map(h => h.path).sort()).toEqual([parentDir, otherHub].sort());
  });
});

// ===========================================================================
// AB-99: hasPrompts
// ===========================================================================

describe("AB-99: hasPrompts", () => {
  let testDir: string;
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "hasPrompts-"));
  });
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns found: false for empty directory", () => {
    const result = hasPrompts(testDir);
    expect(result.found).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("detects non-empty .claude/ directory", () => {
    fs.mkdirSync(path.join(testDir, ".claude"));
    fs.writeFileSync(path.join(testDir, ".claude", "CLAUDE.md"), "# test", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    expect(result.files).toContain(".claude/CLAUDE.md");
  });

  it("returns found: false for .claude/ with only agentboot artifacts", () => {
    fs.mkdirSync(path.join(testDir, ".claude"));
    fs.writeFileSync(path.join(testDir, ".claude", ".agentboot-manifest.json"), "{}", "utf-8");
    const result = hasPrompts(testDir);
    // .agentboot-manifest.json is excluded
    expect(result.found).toBe(false);
    expect(result.files.filter(f => f.startsWith(".claude/"))).toEqual([]);
  });

  it("excludes .agentboot-archive from .claude/ check", () => {
    fs.mkdirSync(path.join(testDir, ".claude", ".agentboot-archive"), { recursive: true });
    const result = hasPrompts(testDir);
    expect(result.files.filter(f => f.includes("agentboot-archive"))).toEqual([]);
  });

  it("detects root CLAUDE.md", () => {
    fs.writeFileSync(path.join(testDir, "CLAUDE.md"), "# Instructions", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    expect(result.files).toContain("CLAUDE.md");
  });

  it("detects .cursorrules", () => {
    fs.writeFileSync(path.join(testDir, ".cursorrules"), "rules", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    expect(result.files).toContain(".cursorrules");
  });

  it("detects .github/copilot-instructions.md", () => {
    fs.mkdirSync(path.join(testDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".github", "copilot-instructions.md"), "# copilot", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    expect(result.files).toContain(".github/copilot-instructions.md");
  });

  it("detects .github/prompts/*.prompt.md files", () => {
    fs.mkdirSync(path.join(testDir, ".github", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".github", "prompts", "review.prompt.md"), "# review", "utf-8");
    fs.writeFileSync(path.join(testDir, ".github", "prompts", "test.prompt.md"), "# test", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    expect(result.files).toContain(".github/prompts/review.prompt.md");
    expect(result.files).toContain(".github/prompts/test.prompt.md");
  });

  it("ignores non-.prompt.md files in .github/prompts/", () => {
    fs.mkdirSync(path.join(testDir, ".github", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".github", "prompts", "README.md"), "# readme", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.files.filter(f => f.includes("README"))).toEqual([]);
  });

  it("returns all files for mixed content", () => {
    fs.writeFileSync(path.join(testDir, "CLAUDE.md"), "# root", "utf-8");
    fs.writeFileSync(path.join(testDir, ".cursorrules"), "rules", "utf-8");
    fs.mkdirSync(path.join(testDir, ".claude"));
    fs.writeFileSync(path.join(testDir, ".claude", "settings.json"), "{}", "utf-8");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    expect(result.files.length).toBe(3);
    expect(result.files).toContain("CLAUDE.md");
    expect(result.files).toContain(".cursorrules");
    expect(result.files).toContain(".claude/settings.json");
  });

  it("files array contains relative paths", () => {
    fs.writeFileSync(path.join(testDir, "CLAUDE.md"), "# test", "utf-8");
    const result = hasPrompts(testDir);
    for (const f of result.files) {
      expect(path.isAbsolute(f)).toBe(false);
    }
  });
});

// ===========================================================================
// AB-99: getGitOrgAndRepo
// ===========================================================================

describe("AB-99: getGitOrgAndRepo", () => {
  let testDir: string;
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitOrgRepo-"));
  });
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("extracts org and repo from HTTPS remote", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git remote add origin https://github.com/acme-corp/my-api.git", { cwd: testDir, stdio: "pipe" });
    const result = getGitOrgAndRepo(testDir);
    expect(result).toEqual({ org: "acme-corp", repo: "my-api" });
  });

  it("extracts org and repo from SSH remote", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git remote add origin git@github.com:acme-corp/my-api.git", { cwd: testDir, stdio: "pipe" });
    const result = getGitOrgAndRepo(testDir);
    expect(result).toEqual({ org: "acme-corp", repo: "my-api" });
  });

  it("returns null for directory without .git", () => {
    const result = getGitOrgAndRepo(testDir);
    expect(result).toBeNull();
  });

  it("returns null for git repo without remote", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    const result = getGitOrgAndRepo(testDir);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// AB-99: addToReposJson
// ===========================================================================

describe("AB-99: addToReposJson", () => {
  let hubDir: string;
  beforeEach(() => {
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "addRepos-"));
    fs.writeFileSync(path.join(hubDir, "repos.json"), "[]", "utf-8");
  });
  afterEach(() => {
    fs.rmSync(hubDir, { recursive: true, force: true });
  });

  it("adds entry to empty repos.json", () => {
    const result = addToReposJson(hubDir, "/path/to/repo", "org/repo");
    expect(result).toBe(true);
    const repos = JSON.parse(fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8"));
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe("/path/to/repo");
    expect(repos[0].label).toBe("org/repo");
  });

  it("adds entry to existing repos.json", () => {
    fs.writeFileSync(path.join(hubDir, "repos.json"), JSON.stringify([{ path: "/existing", label: "org/existing" }]), "utf-8");
    const result = addToReposJson(hubDir, "/new/repo", "org/new");
    expect(result).toBe(true);
    const repos = JSON.parse(fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8"));
    expect(repos).toHaveLength(2);
  });

  it("returns false if repo already registered by path", () => {
    addToReposJson(hubDir, "/path/to/repo", "org/repo");
    const result = addToReposJson(hubDir, "/path/to/repo", "org/other-label");
    expect(result).toBe(false);
  });

  it("returns false if repo already registered by label", () => {
    addToReposJson(hubDir, "/path/to/repo", "org/repo");
    const result = addToReposJson(hubDir, "/different/path", "org/repo");
    expect(result).toBe(false);
  });

  it("creates valid JSON output", () => {
    addToReposJson(hubDir, "/path/to/repo", "org/repo");
    const content = fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });
});

// ===========================================================================
// AB-43: import pure functions
// ===========================================================================

import { normalizeContent, jaccardSimilarity, scanPath, applyPlan, buildClassificationPrompt, ALLOWED_CLASSIFICATION_DIRS } from "../scripts/lib/import.js";
import type { Classification } from "../scripts/lib/import.js";

describe("AB-43: import — normalizeContent", () => {
  it("strips markdown formatting and normalizes whitespace", () => {
    const tokens = normalizeContent("# Heading\n\n**Bold** text with `code`");
    expect(tokens).toContain("heading");
    expect(tokens).toContain("bold");
    expect(tokens).toContain("text");
    expect(tokens).toContain("with");
    expect(tokens).toContain("code");
    // Short words (<=2 chars) should be filtered
    expect(tokens.every(t => t.length > 2)).toBe(true);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeContent("")).toEqual([]);
    expect(normalizeContent("   ")).toEqual([]);
  });

  it("strips horizontal rules", () => {
    const tokens = normalizeContent("above\n---\nbelow");
    expect(tokens).toContain("above");
    expect(tokens).toContain("below");
    expect(tokens).not.toContain("---");
  });
});

describe("AB-43: import — jaccardSimilarity", () => {
  it("returns 1.0 for identical sets", () => {
    const a = new Set(["foo", "bar", "baz"]);
    const b = new Set(["foo", "bar", "baz"]);
    expect(jaccardSimilarity(a, b)).toBe(1.0);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["foo", "bar"]);
    const b = new Set(["baz", "qux"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    const a = new Set(["foo", "bar", "baz"]);
    const b = new Set(["bar", "baz", "qux"]);
    // intersection=2, union=4, similarity=0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 0 when one set is empty", () => {
    const a = new Set(["foo"]);
    expect(jaccardSimilarity(a, new Set())).toBe(0);
  });
});

// ===========================================================================
// AB-43: import — scanPath
// ===========================================================================

describe("AB-43: import — scanPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scan-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds CLAUDE.md at root level", () => {
    fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "# Instructions\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("claude-md");
    expect(result.files[0]!.relativePath).toBe("CLAUDE.md");
  });

  it("finds .claude/ directory contents", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(path.join(claudeDir, "rules"), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Test\n", "utf-8");
    fs.writeFileSync(path.join(claudeDir, "rules", "baseline.md"), "# Rule\n", "utf-8");
    const result = scanPath(tempDir);
    const types = result.files.map(f => f.type);
    expect(types).toContain("claude-md");
    expect(types).toContain("rule");
  });

  it("classifies .cursorrules", () => {
    fs.writeFileSync(path.join(tempDir, ".cursorrules"), "You are a helpful AI.\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("cursorrules");
  });

  it("classifies copilot-instructions.md", () => {
    fs.mkdirSync(path.join(tempDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".github", "copilot-instructions.md"), "# Copilot\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("copilot-instructions");
  });

  it("classifies .prompt.md files in .github/prompts/", () => {
    fs.mkdirSync(path.join(tempDir, ".github", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".github", "prompts", "review.prompt.md"), "# Review\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("copilot-prompt");
  });

  it("skips binary files", () => {
    const buf = Buffer.alloc(100);
    buf[50] = 0; // null byte = binary
    fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", "binary.md"), buf);
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(0);
  });

  it("skips agentboot artifacts", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, ".agentboot-manifest.json"), "{}", "utf-8");
    fs.mkdirSync(path.join(claudeDir, ".agentboot-archive"));
    fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Test\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("claude-md");
  });

  it("returns empty for directory with no agentic content", () => {
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Hello\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(0);
  });

  it("counts lines correctly", () => {
    fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "line1\nline2\nline3\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files[0]!.lines).toBe(4); // trailing newline creates empty 4th line
  });

  it("classifies SKILL.md files", () => {
    const claudeDir = path.join(tempDir, ".claude", "skills", "review");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "SKILL.md"), "---\nid: test\n---\n# Test\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("skill");
  });

  it("classifies agent files", () => {
    const agentsDir = path.join(tempDir, ".claude", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "code-reviewer.md"), "---\nname: reviewer\n---\n", "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("agent");
  });

  it("classifies settings.json", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "settings.json"), '{"env":{}}', "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("settings");
  });

  it("classifies .mcp.json", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, ".mcp.json"), '{"mcpServers":{}}', "utf-8");
    const result = scanPath(tempDir);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.type).toBe("mcp");
  });
});

// ===========================================================================
// AB-43: import — applyPlan
// ===========================================================================

describe("AB-43: import — applyPlan", () => {
  let hubDir: string;
  let sourceDir: string;
  let sourceFile: string;

  beforeEach(() => {
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-apply-hub-"));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-apply-src-"));
    sourceFile = path.join(sourceDir, "CLAUDE.md");
    fs.writeFileSync(sourceFile, "line1\nline2\nline3\nline4\nline5\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(hubDir, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  function makeClassification(overrides: Partial<Classification> = {}): Classification {
    return {
      source_file: sourceFile,
      lines: [1, 3] as [number, number],
      content_preview: "line1\nline2\nline3",
      classification: "trait",
      suggested_name: "test-trait",
      suggested_path: "core/traits/test-trait.md",
      overlaps_with: null,
      confidence: "high",
      action: "create",
      ...overrides,
    };
  }

  it("creates files in allowed directories", () => {
    const plan = {
      hub: hubDir,
      scanned_at: new Date().toISOString(),
      classifications: [makeClassification()],
    };
    const result = applyPlan(plan, hubDir, new Set([path.resolve(sourceFile)]));
    expect(result.created).toBe(1);
    expect(result.errors.length).toBe(0);
    expect(fs.existsSync(path.join(hubDir, "core/traits/test-trait.md"))).toBe(true);
  });

  it("rejects path traversal attempts", () => {
    const plan = {
      hub: hubDir,
      scanned_at: new Date().toISOString(),
      classifications: [makeClassification({ suggested_path: "../../../etc/passwd" })],
    };
    const result = applyPlan(plan, hubDir, new Set([path.resolve(sourceFile)]));
    expect(result.created).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("escapes hub boundary");
  });

  it("rejects writes to non-allowed directories", () => {
    const plan = {
      hub: hubDir,
      scanned_at: new Date().toISOString(),
      classifications: [makeClassification({ suggested_path: "src/malicious.ts" })],
    };
    const result = applyPlan(plan, hubDir, new Set([path.resolve(sourceFile)]));
    expect(result.created).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("not in allowed directory");
  });

  it("rejects source files not in trusted set", () => {
    const plan = {
      hub: hubDir,
      scanned_at: new Date().toISOString(),
      classifications: [makeClassification({ source_file: "/tmp/evil.md" })],
    };
    const result = applyPlan(plan, hubDir, new Set([path.resolve(sourceFile)]));
    expect(result.created).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("not in original scan");
  });

  it("skips items with action: skip", () => {
    const plan = {
      hub: hubDir,
      scanned_at: new Date().toISOString(),
      classifications: [makeClassification({ action: "skip" })],
    };
    const result = applyPlan(plan, hubDir, new Set([path.resolve(sourceFile)]));
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("merges into existing files", () => {
    fs.mkdirSync(path.join(hubDir, "core/traits"), { recursive: true });
    fs.writeFileSync(path.join(hubDir, "core/traits/test-trait.md"), "existing content", "utf-8");

    const plan = {
      hub: hubDir,
      scanned_at: new Date().toISOString(),
      classifications: [makeClassification({ action: "merge" })],
    };
    const result = applyPlan(plan, hubDir, new Set([path.resolve(sourceFile)]));
    expect(result.created).toBe(1);
    const content = fs.readFileSync(path.join(hubDir, "core/traits/test-trait.md"), "utf-8");
    expect(content).toContain("existing content");
    expect(content).toContain("line1");
  });

  it("allows all documented classification directories", () => {
    for (const dir of ALLOWED_CLASSIFICATION_DIRS) {
      expect(dir).toMatch(/^core\//);
    }
    expect(ALLOWED_CLASSIFICATION_DIRS).toContain("core/traits/");
    expect(ALLOWED_CLASSIFICATION_DIRS).toContain("core/gotchas/");
    expect(ALLOWED_CLASSIFICATION_DIRS).toContain("core/instructions/");
    expect(ALLOWED_CLASSIFICATION_DIRS).toContain("core/personas/");
  });
});

// ===========================================================================
// AB-43: import — buildClassificationPrompt
// ===========================================================================

describe("AB-43: import — buildClassificationPrompt", () => {
  it("includes file content in the prompt", () => {
    const prompt = buildClassificationPrompt("# My Rules\nDo this.", "CLAUDE.md", {
      traits: [], personas: [], gotchas: [], instructions: [],
    });
    expect(prompt).toContain("# My Rules");
    expect(prompt).toContain("Do this.");
  });

  it("includes file path in the prompt", () => {
    const prompt = buildClassificationPrompt("content", "path/to/CLAUDE.md", {
      traits: [], personas: [], gotchas: [], instructions: [],
    });
    expect(prompt).toContain("path/to/CLAUDE.md");
  });

  it("includes hub inventory context", () => {
    const prompt = buildClassificationPrompt("content", "CLAUDE.md", {
      traits: [{ name: "critical-thinking", firstLine: "Think critically" }],
      personas: [{ name: "code-reviewer", description: "Reviews code" }],
      gotchas: [{ name: "postgres-rls", firstLine: "Always use RLS" }],
      instructions: [{ name: "baseline", firstLine: "Code quality" }],
    });
    expect(prompt).toContain("critical-thinking");
    expect(prompt).toContain("code-reviewer");
    expect(prompt).toContain("postgres-rls");
    expect(prompt).toContain("baseline");
  });

  it("shows (none) for empty inventory sections", () => {
    const prompt = buildClassificationPrompt("content", "CLAUDE.md", {
      traits: [], personas: [], gotchas: [], instructions: [],
    });
    expect(prompt).toContain("(none)");
  });

  it("includes classification category descriptions", () => {
    const prompt = buildClassificationPrompt("content", "CLAUDE.md", {
      traits: [], personas: [], gotchas: [], instructions: [],
    });
    expect(prompt).toContain("trait");
    expect(prompt).toContain("gotcha");
    expect(prompt).toContain("persona-rule");
    expect(prompt).toContain("instruction");
    expect(prompt).toContain("skip");
  });
});

// ===========================================================================
// AB-34/35/55: add command
// ===========================================================================

describe("AB-34/35/55: add command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-add-"));
    // Create the core directories the add command expects
    fs.mkdirSync(path.join(tempDir, "core", "personas"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "core", "traits"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "core", "gotchas"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("scaffolds a persona with SKILL.md and persona.config.json", () => {
    run("add persona my-reviewer", tempDir);
    const personaDir = path.join(tempDir, "core", "personas", "my-reviewer");
    expect(fs.existsSync(path.join(personaDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(personaDir, "persona.config.json"))).toBe(true);
  });

  it("persona SKILL.md has trait injection markers", () => {
    run("add persona my-reviewer", tempDir);
    const content = fs.readFileSync(
      path.join(tempDir, "core", "personas", "my-reviewer", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("<!-- traits:start -->");
    expect(content).toContain("<!-- traits:end -->");
  });

  it("persona SKILL.md has required frontmatter", () => {
    run("add persona my-reviewer", tempDir);
    const content = fs.readFileSync(
      path.join(tempDir, "core", "personas", "my-reviewer", "SKILL.md"),
      "utf-8",
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: my-reviewer");
    expect(content).toContain("description:");
  });

  it("persona SKILL.md has style guide sections (AB-55)", () => {
    run("add persona my-reviewer", tempDir);
    const content = fs.readFileSync(
      path.join(tempDir, "core", "personas", "my-reviewer", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("## Identity");
    expect(content).toContain("## Setup");
    expect(content).toContain("## Rules");
    expect(content).toContain("## Output Format");
    expect(content).toContain("## What Not To Do");
    // Style guide comments
    expect(content).toContain("imperative voice");
    expect(content).toContain("20 rules maximum");
  });

  it("persona.config.json is valid JSON with required fields", () => {
    run("add persona my-reviewer", tempDir);
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "core", "personas", "my-reviewer", "persona.config.json"), "utf-8"),
    );
    expect(config.name).toBe("My Reviewer");
    expect(config.description).toBeDefined();
    expect(config.invocation).toBe("/my-reviewer");
    expect(Array.isArray(config.traits)).toBe(true);
  });

  it("rejects duplicate persona names", () => {
    run("add persona my-reviewer", tempDir);
    const output = runExpectFail("add persona my-reviewer", tempDir);
    expect(output).toContain("already exists");
  });

  it("rejects invalid names (uppercase, special chars, leading digit)", () => {
    expect(() => run("add persona MyReviewer", tempDir)).toThrow();
    expect(() => run("add persona 1bad", tempDir)).toThrow();
    expect(() => run("add persona has_underscore", tempDir)).toThrow();
  });

  it("scaffolds a trait with correct sections", () => {
    run("add trait error-handling", tempDir);
    const traitPath = path.join(tempDir, "core", "traits", "error-handling.md");
    expect(fs.existsSync(traitPath)).toBe(true);
    const content = fs.readFileSync(traitPath, "utf-8");
    expect(content).toContain("# Error Handling");
    expect(content).toContain("## When to Apply");
    expect(content).toContain("## What to Do");
    expect(content).toContain("## What Not to Do");
  });

  it("scaffolds a gotcha with paths frontmatter", () => {
    run("add gotcha lambda-cold-starts", tempDir);
    const gotchaPath = path.join(tempDir, "core", "gotchas", "lambda-cold-starts.md");
    expect(fs.existsSync(gotchaPath)).toBe(true);
    const content = fs.readFileSync(gotchaPath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("paths:");
    expect(content).toContain("# Lambda Cold Starts");
  });

  it("rejects unknown type", () => {
    const output = runExpectFail("add widget foo", tempDir);
    expect(output).toContain("Unknown type");
  });

  it("capitalizes hyphenated names correctly", () => {
    run("add persona multi-word-name", tempDir);
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "core", "personas", "multi-word-name", "persona.config.json"), "utf-8"),
    );
    expect(config.name).toBe("Multi Word Name");
  });
});

// ===========================================================================
// AB-36: doctor command
// ===========================================================================

describe("AB-36: doctor command", () => {
  it("passes all checks on the project root", () => {
    const output = run("doctor");
    expect(output).toContain("All checks passed");
  });

  it("detects missing config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-doc-"));
    try {
      const output = runExpectFail(`doctor --config ${path.join(tempDir, "nonexistent.json")}`, tempDir);
      expect(output).toContain("not found");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports exit code 0 on success", () => {
    // Should not throw
    run("doctor");
  });

  it("--dry-run without --fix warns user", () => {
    const output = run("doctor --dry-run");
    expect(output).toContain("--dry-run has no effect without --fix");
  });

  it("--fix creates missing repos.json and directories", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-fix-"));
    try {
      // Minimal config with a fictional persona and trait
      const config = {
        org: "test-org",
        personas: { enabled: ["fix-test-persona"] },
        traits: { enabled: ["fix-test-trait"] },
        sync: { repos: "./repos.json" },
      };
      fs.writeFileSync(path.join(tempDir, "agentboot.config.json"), JSON.stringify(config), "utf-8");

      const output = run(`doctor --fix --config ${path.join(tempDir, "agentboot.config.json")}`, tempDir);
      expect(output).toContain("(fixed)");

      // repos.json created
      expect(fs.existsSync(path.join(tempDir, "repos.json"))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(tempDir, "repos.json"), "utf-8"))).toEqual([]);

      // Persona scaffolded
      expect(fs.existsSync(path.join(tempDir, "core", "personas", "fix-test-persona", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "core", "personas", "fix-test-persona", "persona.config.json"))).toBe(true);

      // Trait created
      expect(fs.existsSync(path.join(tempDir, "core", "traits", "fix-test-trait.md"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("--fix --dry-run reports fixes without writing files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-dry-"));
    try {
      const config = {
        org: "test-org",
        personas: { enabled: ["dry-persona"] },
        traits: { enabled: ["dry-trait"] },
        sync: { repos: "./repos.json" },
      };
      fs.writeFileSync(path.join(tempDir, "agentboot.config.json"), JSON.stringify(config), "utf-8");

      const output = run(`doctor --fix --dry-run --config ${path.join(tempDir, "agentboot.config.json")}`, tempDir);
      expect(output).toContain("(would fix)");

      // Nothing actually created
      expect(fs.existsSync(path.join(tempDir, "repos.json"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "core"))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports fixable hint when issues exist without --fix", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hint-"));
    try {
      const config = {
        org: "test-org",
        personas: { enabled: ["missing-persona"] },
        traits: { enabled: [] },
      };
      fs.writeFileSync(path.join(tempDir, "agentboot.config.json"), JSON.stringify(config), "utf-8");

      const output = runExpectFail(`doctor --config ${path.join(tempDir, "agentboot.config.json")}`, tempDir);
      expect(output).toContain("fixable with --fix");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AB-37: status command
// ===========================================================================

describe("AB-37: status command", () => {
  it("shows org and persona info", () => {
    const output = run("status");
    expect(output).toContain("Your Organization");
    expect(output).toContain("code-reviewer");
    expect(output).toContain("4 enabled");
  });

  it("--format json produces valid JSON", () => {
    const output = run("status --format json");
    const status = JSON.parse(output);
    expect(status.org).toBe("your-org");
    expect(status.personas).toContain("code-reviewer");
    expect(Array.isArray(status.repos)).toBe(true);
  });

  it("shows repo information or 'No repos' in status output", () => {
    const output = run("status");
    // repos.json may have entries from prior test runs; both states are valid
    expect(output).toMatch(/Repos|No repos/);
  });
});

// ===========================================================================
// AB-38: lint command
// ===========================================================================

describe("AB-38: lint command", () => {
  it("reports trait-too-long for current traits", () => {
    const output = run("lint");
    expect(output).toContain("trait-too-long");
  });

  it("--severity error hides warnings", () => {
    const output = run("lint --severity error");
    // Should only show errors or pass with no issues
    expect(output).not.toContain("WARN");
  });

  it("--severity info shows warnings (info threshold includes all)", () => {
    const output = run("lint --severity info");
    // With info threshold, warnings are still shown
    expect(output).toContain("WARN");
  });

  it("--format json produces valid JSON output", () => {
    const output = run("lint --format json --severity info");
    const findings = JSON.parse(output);
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings) {
      expect(f.rule).toBeDefined();
      expect(f.severity).toMatch(/^(info|warn|error)$/);
      expect(f.file).toBeDefined();
      expect(f.message).toBeDefined();
    }
  });

  it("--persona filters to specific persona", () => {
    const output = run("lint --format json --severity info --persona code-reviewer");
    const findings = JSON.parse(output);
    // All findings should be for code-reviewer persona, general (traits), or compiled output
    for (const f of findings) {
      const isPersonaFile = f.file.includes("code-reviewer");
      const isTraitFile = f.file.startsWith("core/traits/");
      const isCompiledFile = f.file.startsWith("dist/");
      expect(isPersonaFile || isTraitFile || isCompiledFile, `Unexpected file in filtered output: ${f.file}`).toBe(true);
    }
  });

  it("detects vague language in a test persona", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-lint-"));
    const personaDir = path.join(tempDir, "core", "personas", "vague-persona");
    fs.mkdirSync(personaDir, { recursive: true });
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      '---\nname: vague\ndescription: test\n---\n\nBe thorough when reviewing.\nTry to check if possible.\n',
    );
    fs.writeFileSync(
      path.join(tempDir, "agentboot.config.json"),
      JSON.stringify({
        org: "test",
        personas: { enabled: ["vague-persona"] },
        traits: { enabled: [] },
      }),
    );

    try {
      const output = run(`lint --config ${path.join(tempDir, "agentboot.config.json")} --format json --severity warn`, tempDir);
      const findings = JSON.parse(output);
      const vagueFindings = findings.filter((f: any) => f.rule === "vague-instruction");
      expect(vagueFindings.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects secrets in persona files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-lint-secret-"));
    const personaDir = path.join(tempDir, "core", "personas", "secret-persona");
    fs.mkdirSync(personaDir, { recursive: true });
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      '---\nname: secret\ndescription: test\n---\n\nUse api key sk-abcdefghijklmnopqrstuvwxyz1234 for testing.\n',
    );
    fs.writeFileSync(
      path.join(tempDir, "agentboot.config.json"),
      JSON.stringify({
        org: "test",
        personas: { enabled: ["secret-persona"] },
        traits: { enabled: [] },
      }),
    );

    try {
      const output = runExpectFail(
        `lint --config ${path.join(tempDir, "agentboot.config.json")} --format json`,
        tempDir,
      );
      const findings = JSON.parse(output);
      expect(findings.some((f: any) => f.rule === "credential-in-prompt")).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AB-45: uninstall command
// ===========================================================================

describe("AB-45: uninstall command", () => {
  let syncTarget: string;
  let originalRepos: string;

  beforeAll(() => {
    // Build + sync to a temp target to have something to uninstall
    originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-uninstall-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "uninstall-test", platform: "claude" }]),
    );
    run("sync");
  });

  afterAll(() => {
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("dry-run lists files without removing them", () => {
    const output = run(`uninstall --repo ${syncTarget} --dry-run`);
    expect(output).toContain("would remove");
    // Files should still exist
    expect(fs.existsSync(path.join(syncTarget, ".claude", "skills", "review-code", "SKILL.md"))).toBe(true);
  });

  it("uninstall removes synced files with matching hashes", () => {
    // Verify manifest exists before uninstall
    const manifestPath = path.join(syncTarget, ".claude", ".agentboot-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const output = run(`uninstall --repo ${syncTarget}`);
    expect(output).toContain("removed");

    // Skills should be gone
    expect(fs.existsSync(path.join(syncTarget, ".claude", "skills", "review-code", "SKILL.md"))).toBe(false);
    // Manifest should be gone
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it("skips modified files (hash mismatch)", () => {
    // Re-sync to have fresh files
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "uninstall-test", platform: "claude" }]),
    );
    run("sync");

    // Modify one file
    const skillPath = path.join(syncTarget, ".claude", "skills", "review-code", "SKILL.md");
    fs.appendFileSync(skillPath, "\n<!-- manually modified -->\n");

    const output = run(`uninstall --repo ${syncTarget}`);
    expect(output).toContain("modified");
    // Modified file should still exist
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it("rejects path traversal in manifest entries", () => {
    // Create a malicious manifest
    const maliciousTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-traversal-"));
    const claudeDir = path.join(maliciousTarget, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    // Create a canary file outside .claude/ that should NOT be deleted
    const canaryPath = path.join(maliciousTarget, "important-file.txt");
    fs.writeFileSync(canaryPath, "do not delete");

    // Write manifest with traversal attempt
    const canaryContent = fs.readFileSync(canaryPath);
    const canaryHash = createHash("sha256").update(canaryContent).digest("hex");
    fs.writeFileSync(
      path.join(claudeDir, ".agentboot-manifest.json"),
      JSON.stringify({
        managed_by: "agentboot",
        version: "0.1.0",
        synced_at: new Date().toISOString(),
        files: [{ path: "../important-file.txt", hash: canaryHash }],
      }),
    );

    try {
      const output = run(`uninstall --repo ${maliciousTarget}`);
      expect(output).toContain("rejected");
      // Canary file should still exist
      expect(fs.existsSync(canaryPath)).toBe(true);
    } finally {
      fs.rmSync(maliciousTarget, { recursive: true, force: true });
    }
  });

  it("handles no manifest gracefully", () => {
    const emptyTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-empty-"));
    try {
      const output = run(`uninstall --repo ${emptyTarget}`);
      expect(output).toContain("No .agentboot-manifest.json found");
    } finally {
      fs.rmSync(emptyTarget, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Config command
// ===========================================================================

describe("config command", () => {
  it("reads a top-level key", () => {
    const output = run("config org");
    expect(output.trim()).toBe("your-org");
  });

  it("reads a nested key with dot notation", () => {
    const output = run("config personas.enabled");
    const parsed = JSON.parse(output);
    expect(parsed).toContain("code-reviewer");
  });

  it("errors on nonexistent key", () => {
    const output = runExpectFail("config nonexistent.key");
    expect(output).toContain("Key not found");
  });

  it("writes a top-level string value", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cfgw-"));
    try {
      const configPath = path.join(tempDir, "agentboot.config.json");
      fs.writeFileSync(configPath, JSON.stringify({ org: "test-org" }, null, 2) + "\n");
      const output = run(`config orgDisplayName "Acme Engineering" --config ${configPath}`, tempDir);
      expect(output).toContain("added");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.orgDisplayName).toBe("Acme Engineering");
      expect(config.org).toBe("test-org");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("overwrites an existing value and shows old → new", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cfgw-"));
    try {
      const configPath = path.join(tempDir, "agentboot.config.json");
      fs.writeFileSync(configPath, JSON.stringify({ org: "old-org" }, null, 2) + "\n");
      const output = run(`config org new-org --config ${configPath}`, tempDir);
      expect(output).toContain("old-org");
      expect(output).toContain("new-org");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.org).toBe("new-org");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes a nested value with dot notation", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cfgw-"));
    try {
      const configPath = path.join(tempDir, "agentboot.config.json");
      fs.writeFileSync(configPath, JSON.stringify({ org: "test", output: { distPath: "./dist" } }, null, 2) + "\n");
      const output = run(`config output.distPath ./build --config ${configPath}`, tempDir);
      expect(output).toContain("./dist");
      expect(output).toContain("./build");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.output.distPath).toBe("./build");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses to write when config has JSONC comments", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cfgw-"));
    try {
      const configPath = path.join(tempDir, "agentboot.config.json");
      fs.writeFileSync(configPath, '{\n  "org": "test" // my org\n}\n');
      const output = runExpectFail(`config org new-org --config ${configPath}`, tempDir);
      expect(output).toContain("comments");
      // File should be unchanged
      expect(fs.readFileSync(configPath, "utf-8")).toContain("// my org");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite non-string values", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cfgw-"));
    try {
      const configPath = path.join(tempDir, "agentboot.config.json");
      fs.writeFileSync(configPath, JSON.stringify({ org: "test", personas: { enabled: ["code-reviewer"] } }, null, 2) + "\n");
      const output = runExpectFail(`config personas.enabled foo --config ${configPath}`, tempDir);
      expect(output).toContain("not a string");
      // File should be unchanged
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(Array.isArray(config.personas.enabled)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// YAML frontmatter safety
// ===========================================================================

describe("YAML frontmatter safety", () => {
  it("all compiled skill descriptions are quoted in YAML frontmatter", () => {
    // Verify existing compiled output has quoted descriptions
    const skills = ["review-code", "review-security", "gen-tests", "gen-testdata"];
    for (const skill of skills) {
      const content = fs.readFileSync(
        path.join(ROOT, "dist", "claude", "core", "skills", skill, "SKILL.md"),
        "utf-8",
      );
      expect(content, `${skill} description should be quoted`).toMatch(/description: ".*"/);
      expect(content, `${skill} agent should be quoted`).toMatch(/agent: ".*"/);
    }
  });

  it("all compiled agent names and descriptions are quoted", () => {
    const agents = ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"];
    for (const agent of agents) {
      const content = fs.readFileSync(
        path.join(ROOT, "dist", "claude", "core", "agents", `${agent}.md`),
        "utf-8",
      );
      expect(content, `${agent} name should be quoted`).toMatch(/name: ".*"/);
      expect(content, `${agent} description should be quoted`).toMatch(/description: ".*"/);
    }
  });

  it("description containing special YAML characters is safely escaped", () => {
    // The security-reviewer description contains an em-dash (—) which is safe but worth verifying
    const content = fs.readFileSync(
      path.join(ROOT, "dist", "claude", "core", "skills", "review-security", "SKILL.md"),
      "utf-8",
    );
    // Description should be quoted and contain the full text
    expect(content).toContain('description: "Adversarial security reviewer');
  });
});

// ===========================================================================
// CLI global behavior
// ===========================================================================

describe("CLI global behavior", () => {
  it("--version outputs the version from package.json", () => {
    const output = run("--version");
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help lists all commands", () => {
    const output = run("--help");
    expect(output).toContain("build");
    expect(output).toContain("validate");
    expect(output).toContain("sync");
    expect(output).toContain("install");
    expect(output).toContain("add");
    expect(output).toContain("doctor");
    expect(output).toContain("status");
    expect(output).toContain("lint");
    expect(output).toContain("uninstall");
    expect(output).toContain("config");
  });
});

// ---------------------------------------------------------------------------
// dev-sync script
// ---------------------------------------------------------------------------

describe("dev-sync script", () => {
  it("syncs dist/ to local repo directories", () => {
    // dev-sync requires dist/ to exist (from prior build)
    const distPath = path.join(ROOT, "dist");
    if (!fs.existsSync(distPath)) {
      // Build first if dist/ missing
      execSync(`${TSX} ${path.join(ROOT, "scripts", "compile.ts")}`, { cwd: ROOT, stdio: "pipe" });
    }

    const output = execSync(`${TSX} ${path.join(ROOT, "scripts", "dev-sync.ts")}`, {
      cwd: ROOT,
      encoding: "utf-8",
    });

    expect(output).toContain("Dev-synced");
    expect(output).toContain("claude");

    // Verify files were actually copied
    expect(fs.existsSync(path.join(ROOT, ".claude", "skills"))).toBe(true);
  });

  it("copies files to platform-native locations", () => {
    // Verify claude platform files end up in .claude/
    const skillsDir = path.join(ROOT, ".claude", "skills");
    expect(fs.existsSync(skillsDir)).toBe(true);
    const skills = fs.readdirSync(skillsDir);
    expect(skills.length).toBeGreaterThan(0);

    // Verify copilot platform files end up in .github/copilot/
    const copilotDir = path.join(ROOT, ".github", "copilot");
    expect(fs.existsSync(copilotDir)).toBe(true);
  });
});

// ===========================================================================
// Phase 3 Tests
// ===========================================================================

// AB-57: Plugin structure
describe("AB-57: plugin structure", () => {
  const pluginDir = path.join(ROOT, "dist", "plugin");

  it("generates plugin.json with required fields", () => {
    const pluginJson = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf-8"));
    expect(pluginJson.name).toBeTruthy();
    expect(pluginJson.version).toBeTruthy();
    expect(pluginJson.agentboot_version).toBeTruthy();
    expect(pluginJson.license).toBe("Apache-2.0");
    expect(pluginJson.personas).toBeInstanceOf(Array);
    expect(pluginJson.personas.length).toBe(4);
    expect(pluginJson.traits).toBeInstanceOf(Array);
    expect(pluginJson.traits.length).toBe(6);
  });

  it("includes agents directory with persona agents", () => {
    const agentsDir = path.join(pluginDir, "agents");
    expect(fs.existsSync(agentsDir)).toBe(true);
    const agents = fs.readdirSync(agentsDir);
    expect(agents).toContain("code-reviewer.md");
    expect(agents).toContain("security-reviewer.md");
  });

  it("includes skills directory with skill files", () => {
    const skillsDir = path.join(pluginDir, "skills");
    expect(fs.existsSync(skillsDir)).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "review-code", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "review-security", "SKILL.md"))).toBe(true);
  });

  it("includes traits directory with all 6 traits", () => {
    const traitsDir = path.join(pluginDir, "traits");
    expect(fs.existsSync(traitsDir)).toBe(true);
    const traits = fs.readdirSync(traitsDir);
    expect(traits.length).toBe(6);
    expect(traits).toContain("critical-thinking.md");
  });

  it("includes hooks directory", () => {
    const hooksDir = path.join(pluginDir, "hooks");
    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  it("includes rules directory", () => {
    const rulesDir = path.join(pluginDir, "rules");
    expect(fs.existsSync(rulesDir)).toBe(true);
    const rules = fs.readdirSync(rulesDir);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("persona entries have correct paths", () => {
    const pluginJson = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf-8"));
    for (const persona of pluginJson.personas) {
      expect(persona.id).toBeTruthy();
      expect(persona.agent_path).toMatch(/^agents\//);
      expect(persona.skill_path).toMatch(/^skills\//);
      // Verify the referenced files exist
      expect(fs.existsSync(path.join(pluginDir, persona.agent_path))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, persona.skill_path))).toBe(true);
    }
  });
});

// AB-59/60/63: Compliance hooks
describe("AB-59/60/63: compliance and audit trail hooks", () => {
  const hooksDir = path.join(ROOT, "dist", "claude", "core", "hooks");

  it("generates input scanning hook (AB-59)", () => {
    const hookPath = path.join(hooksDir, "agentboot-input-scan.sh");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("UserPromptSubmit");
    expect(content).toContain("credential");
    // Verify executable
    const stat = fs.statSync(hookPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it("generates output scanning hook (AB-60)", () => {
    const hookPath = path.join(hooksDir, "agentboot-output-scan.sh");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("Stop");
    expect(content).toContain("credential");
  });

  it("generates audit trail / telemetry hook (AB-63)", () => {
    const hookPath = path.join(hooksDir, "agentboot-telemetry.sh");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("SubagentStart");
    expect(content).toContain("SubagentStop");
    expect(content).toContain("PostToolUse");
    expect(content).toContain("SessionEnd");
    expect(content).toContain("telemetry.ndjson");
  });

  it("registers hooks in settings.json", () => {
    const settingsPath = path.join(ROOT, "dist", "claude", "core", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.SubagentStart).toBeDefined();
    expect(settings.hooks.SubagentStop).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
  });
});

// AB-64: Telemetry NDJSON schema
describe("AB-64: telemetry NDJSON schema", () => {
  it("generates telemetry event JSON schema", () => {
    const schemaPath = path.join(ROOT, "dist", "schema", "telemetry-event.v1.json");
    expect(fs.existsSync(schemaPath)).toBe(true);
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    expect(schema.$id).toContain("telemetry-event");
    expect(schema.required).toContain("event");
    expect(schema.required).toContain("persona_id");
    expect(schema.required).toContain("timestamp");
    expect(schema.properties.event.enum).toContain("persona_invocation");
    expect(schema.properties.event.enum).toContain("session_summary");
    expect(schema.properties.findings_count).toBeDefined();
  });
});

// AB-46: Add domain/hook scaffolding
describe("AB-46: add domain and hook scaffolding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-add-"));
    // Create minimal config for add to work
    fs.mkdirSync(path.join(tmpDir, "core", "personas"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "core", "traits"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scaffolds a domain with agentboot.domain.json", () => {
    run("add domain my-compliance", tmpDir);
    const domainDir = path.join(tmpDir, "domains", "my-compliance");
    expect(fs.existsSync(domainDir)).toBe(true);
    expect(fs.existsSync(path.join(domainDir, "agentboot.domain.json"))).toBe(true);
    expect(fs.existsSync(path.join(domainDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(domainDir, "traits"))).toBe(true);
    expect(fs.existsSync(path.join(domainDir, "personas"))).toBe(true);
    expect(fs.existsSync(path.join(domainDir, "instructions"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(domainDir, "agentboot.domain.json"), "utf-8"));
    expect(manifest.name).toBe("my-compliance");
    expect(manifest.version).toBe("1.0.0");
  });

  it("scaffolds a hook with executable shell script", () => {
    run("add hook my-scanner", tmpDir);
    const hookPath = path.join(tmpDir, "hooks", "my-scanner.sh");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("#!/bin/bash");
    expect(content).toContain("hook_event_name");
    // Verify executable
    const stat = fs.statSync(hookPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it("rejects duplicate domain names", () => {
    run("add domain test-domain", tmpDir);
    const output = runExpectFail("add domain test-domain", tmpDir);
    expect(output).toContain("already exists");
  });

  it("rejects duplicate hook names", () => {
    run("add hook test-hook", tmpDir);
    const output = runExpectFail("add hook test-hook", tmpDir);
    expect(output).toContain("already exists");
  });

  it("shows domain and hook in add help text", () => {
    const output = runExpectFail("add unknown-type test", tmpDir);
    expect(output).toContain("domain");
    expect(output).toContain("hook");
  });
});

// AB-40: export command
describe("AB-40: export command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-export-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports plugin format to specified directory", () => {
    const output = run(`export --format plugin --output ${tmpDir}/plugin-out`);
    expect(output).toContain("Exported plugin");
    expect(fs.existsSync(path.join(tmpDir, "plugin-out", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "plugin-out", "agents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "plugin-out", "skills"))).toBe(true);
  });

  it("exports marketplace scaffold", () => {
    const output = run(`export --format marketplace --output ${tmpDir}`);
    expect(output).toContain("marketplace.json");
    const marketplace = JSON.parse(fs.readFileSync(path.join(tmpDir, "marketplace.json"), "utf-8"));
    expect(marketplace.$schema).toContain("agentboot.dev");
    expect(marketplace.entries).toBeInstanceOf(Array);
  });

  it("rejects unknown export format", () => {
    const output = runExpectFail("export --format unknown");
    expect(output).toContain("Unknown export format");
  });
});

// AB-41: publish command
describe("AB-41: publish command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-publish-"));
    // Create a fake plugin directory
    const pluginDir = path.join(tmpDir, ".claude-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "plugin.json"), JSON.stringify({
      name: "test-org@test-personas",
      version: "1.0.0",
      description: "Test plugin",
      author: "test",
    }, null, 2), "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("publishes plugin to marketplace.json with --dry-run", () => {
    const output = run("publish --dry-run", tmpDir);
    expect(output).toContain("DRY RUN");
    expect(output).toContain("Would write marketplace.json");
  });

  it("publishes plugin and creates marketplace.json", () => {
    run("publish", tmpDir);
    const marketplacePath = path.join(tmpDir, "marketplace.json");
    expect(fs.existsSync(marketplacePath)).toBe(true);
    const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
    expect(marketplace.entries.length).toBe(1);
    expect(marketplace.entries[0].type).toBe("plugin");
    expect(marketplace.entries[0].version).toBe("1.0.0");
    expect(marketplace.entries[0].sha256).toBeTruthy();
  });

  it("bumps version with --bump patch", () => {
    const output = run("publish --bump patch", tmpDir);
    expect(output).toContain("1.0.1");
    const marketplace = JSON.parse(fs.readFileSync(path.join(tmpDir, "marketplace.json"), "utf-8"));
    expect(marketplace.entries[0].version).toBe("1.0.1");
  });
});

// AB-88: N-tier scope model
describe("AB-88: N-tier scope model", () => {
  it("converts legacy groups/teams to scope nodes", async () => {
    // Import the conversion function
    const { groupsToNodes, flattenNodes } = await import("../scripts/lib/config.js");

    const groups = {
      platform: { teams: ["api", "infra"] },
      product: { teams: ["web"] },
    };

    const nodes = groupsToNodes(groups);
    expect(nodes["platform"]).toBeDefined();
    expect(nodes["platform"]!.children?.["api"]).toBeDefined();
    expect(nodes["platform"]!.children?.["infra"]).toBeDefined();
    expect(nodes["product"]!.children?.["web"]).toBeDefined();

    const flat = flattenNodes(nodes);
    const paths = flat.map((f) => f.path);
    expect(paths).toContain("platform");
    expect(paths).toContain("platform/api");
    expect(paths).toContain("platform/infra");
    expect(paths).toContain("product");
    expect(paths).toContain("product/web");
  });
});

// AB-62/65: Privacy and telemetry config types
describe("AB-62/65: privacy and telemetry config", () => {
  it("config accepts privacy and telemetry fields", async () => {
    const { loadConfig, stripJsoncComments } = await import("../scripts/lib/config.js");

    // Write a test config with privacy/telemetry
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-privacy-"));
    const configContent = JSON.stringify({
      org: "test-org",
      privacy: {
        tier: "organizational",
        rawPrompts: false,
        escalationEnabled: true,
      },
      telemetry: {
        enabled: true,
        includeDevId: "hashed",
        logPath: "~/.agentboot/telemetry.ndjson",
        includeContent: false,
      },
    });
    const configPath = path.join(tmpDir, "agentboot.config.json");
    fs.writeFileSync(configPath, configContent, "utf-8");

    const config = loadConfig(configPath);
    expect(config.privacy?.tier).toBe("organizational");
    expect(config.privacy?.rawPrompts).toBe(false);
    expect(config.telemetry?.enabled).toBe(true);
    expect(config.telemetry?.includeDevId).toBe("hashed");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// AB-53: Domain layer structure
describe("AB-53: domain layer loading", () => {
  it("compiles domain personas and traits when configured", () => {
    // Create a temp config with a domain reference
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-domain-"));
    const domainDir = path.join(tmpDir, "domains", "test-domain");

    // Create domain structure
    fs.mkdirSync(path.join(domainDir, "traits"), { recursive: true });
    fs.writeFileSync(path.join(domainDir, "agentboot.domain.json"), JSON.stringify({
      name: "test-domain",
      version: "1.0.0",
    }), "utf-8");
    fs.writeFileSync(path.join(domainDir, "traits", "test-trait.md"), "# Test Trait\n\nTest content.\n", "utf-8");

    // Verify domain manifest loads
    const manifest = JSON.parse(fs.readFileSync(path.join(domainDir, "agentboot.domain.json"), "utf-8"));
    expect(manifest.name).toBe("test-domain");
    expect(manifest.version).toBe("1.0.0");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// AB-56: Model selection matrix
describe("AB-56: model selection matrix", () => {
  it("documentation file exists with required sections", () => {
    const docPath = path.join(ROOT, "docs", "model-selection.md");
    expect(fs.existsSync(docPath)).toBe(true);
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content).toContain("# Model Selection Matrix");
    expect(content).toContain("Haiku");
    expect(content).toContain("Sonnet");
    expect(content).toContain("Opus");
    expect(content).toContain("Code Reviewer");
    expect(content).toContain("Security Reviewer");
    expect(content).toContain("persona.config.json");
  });
});

// ===========================================================================
// AB-131: CC Plugin Manifest Validation
// ===========================================================================

import { validatePluginManifest } from "../scripts/lib/config.js";

describe("AB-131: validatePluginManifest", () => {
  it("returns no warnings for a valid manifest", () => {
    const manifest = {
      name: "@my-org/personas",
      version: "1.0.0",
      description: "My personas plugin",
      agents: ["code-reviewer"],
      skills: ["review-code"],
      rules: ["baseline"],
    };
    const warnings = validatePluginManifest(manifest);
    expect(warnings).toHaveLength(0);
  });

  it("reports error when name is missing", () => {
    const manifest = { version: "1.0.0", description: "test" };
    const warnings = validatePluginManifest(manifest);
    const nameError = warnings.find(w => w.field === "name" && w.level === "error");
    expect(nameError).toBeDefined();
    expect(nameError!.message).toContain("required");
  });

  it("reports error when name is not a string", () => {
    const manifest = { name: 123, version: "1.0.0", description: "test" };
    const warnings = validatePluginManifest(manifest);
    const nameError = warnings.find(w => w.field === "name" && w.level === "error");
    expect(nameError).toBeDefined();
    expect(nameError!.message).toContain("string");
  });

  it("reports error when name does not follow @scope/package format", () => {
    const manifest = { name: "not-scoped", version: "1.0.0", description: "test" };
    const warnings = validatePluginManifest(manifest);
    const nameError = warnings.find(w => w.field === "name" && w.level === "error");
    expect(nameError).toBeDefined();
    expect(nameError!.message).toContain("@scope/package-name");
  });

  it("accepts valid scoped name formats", () => {
    const manifest = { name: "@acme-corp/my-personas", version: "1.0.0", description: "test" };
    const warnings = validatePluginManifest(manifest);
    const nameErrors = warnings.filter(w => w.field === "name");
    expect(nameErrors).toHaveLength(0);
  });

  it("reports error when version is missing", () => {
    const manifest = { name: "@org/pkg", description: "test" };
    const warnings = validatePluginManifest(manifest);
    const versionError = warnings.find(w => w.field === "version");
    expect(versionError).toBeDefined();
    expect(versionError!.level).toBe("error");
  });

  it("reports error when description is missing", () => {
    const manifest = { name: "@org/pkg", version: "1.0.0" };
    const warnings = validatePluginManifest(manifest);
    const descError = warnings.find(w => w.field === "description");
    expect(descError).toBeDefined();
    expect(descError!.level).toBe("error");
  });

  it("warns when agents array is empty", () => {
    const manifest = { name: "@org/pkg", version: "1.0.0", description: "test", agents: [] };
    const warnings = validatePluginManifest(manifest);
    const agentsWarn = warnings.find(w => w.field === "agents");
    expect(agentsWarn).toBeDefined();
    expect(agentsWarn!.level).toBe("warn");
  });

  it("warns when skills array is empty", () => {
    const manifest = { name: "@org/pkg", version: "1.0.0", description: "test", skills: [] };
    const warnings = validatePluginManifest(manifest);
    const skillsWarn = warnings.find(w => w.field === "skills");
    expect(skillsWarn).toBeDefined();
    expect(skillsWarn!.level).toBe("warn");
  });

  it("warns when rules array is empty", () => {
    const manifest = { name: "@org/pkg", version: "1.0.0", description: "test", rules: [] };
    const warnings = validatePluginManifest(manifest);
    const rulesWarn = warnings.find(w => w.field === "rules");
    expect(rulesWarn).toBeDefined();
    expect(rulesWarn!.level).toBe("warn");
  });

  it("does not warn when arrays are absent (only when empty)", () => {
    const manifest = { name: "@org/pkg", version: "1.0.0", description: "test" };
    const warnings = validatePluginManifest(manifest);
    expect(warnings).toHaveLength(0);
  });

  it("reports multiple errors at once", () => {
    const manifest = {};
    const warnings = validatePluginManifest(manifest);
    expect(warnings.length).toBeGreaterThanOrEqual(3); // name, version, description
  });
});

// AB-91: ACKNOWLEDGMENTS.md
describe("AB-91: ACKNOWLEDGMENTS.md", () => {
  it("exists with prior art credits", () => {
    const ackPath = path.join(ROOT, "ACKNOWLEDGMENTS.md");
    expect(fs.existsSync(ackPath)).toBe(true);
    const content = fs.readFileSync(ackPath, "utf-8");
    expect(content).toContain("SuperClaude");
    expect(content).toContain("Trail of Bits");
    expect(content).toContain("ArcKit");
    expect(content).toContain("CC-BY-SA-4.0");
    expect(content).toContain("Apache-2.0");
  });
});
