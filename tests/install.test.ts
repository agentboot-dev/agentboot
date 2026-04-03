/**
 * Unit tests for scripts/lib/install.ts — exported pure functions.
 *
 * Supplements the existing tests in cli.test.ts (AB-33.2, AB-99) with
 * additional edge cases, error paths, and boundary conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  AgentBootError,
  detectCwd,
  scaffoldHub,
  scanNearby,
  hasPrompts,
  getGitOrgAndRepo,
  addToReposJson,
  shellQuote,
} from "../scripts/lib/install.js";

// ---------------------------------------------------------------------------
// AgentBootError
// ---------------------------------------------------------------------------

describe("AgentBootError", () => {
  it("stores the exit code as a property", () => {
    const err = new AgentBootError(42);
    expect(err.exitCode).toBe(42);
  });

  it("sets the name to AgentBootError", () => {
    const err = new AgentBootError(1);
    expect(err.name).toBe("AgentBootError");
  });

  it("is an instance of Error", () => {
    const err = new AgentBootError(0);
    expect(err).toBeInstanceOf(Error);
  });

  it("includes exit code in message", () => {
    const err = new AgentBootError(127);
    expect(err.message).toBe("AgentBoot exit: 127");
  });

  it("handles zero exit code (non-error exit)", () => {
    const err = new AgentBootError(0);
    expect(err.exitCode).toBe(0);
    expect(err.message).toBe("AgentBoot exit: 0");
  });
});

// ---------------------------------------------------------------------------
// addToReposJson — additional edge cases
// ---------------------------------------------------------------------------

describe("addToReposJson: edge cases", () => {
  let hubDir: string;

  beforeEach(() => {
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-addrepos-"));
  });

  afterEach(() => {
    fs.rmSync(hubDir, { recursive: true, force: true });
  });

  it("creates repos.json from scratch when file does not exist", () => {
    // No repos.json at all — addToReposJson should create it
    const result = addToReposJson(hubDir, "/path/to/new-repo", "org/new-repo");
    expect(result).toBe(true);

    const reposPath = path.join(hubDir, "repos.json");
    expect(fs.existsSync(reposPath)).toBe(true);
    const repos = JSON.parse(fs.readFileSync(reposPath, "utf-8"));
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe("/path/to/new-repo");
    expect(repos[0].label).toBe("org/new-repo");
  });

  it("handles invalid JSON in existing repos.json (starts fresh)", () => {
    // Write invalid JSON — the function should warn and start fresh
    fs.writeFileSync(path.join(hubDir, "repos.json"), "not valid json{{{", "utf-8");
    const result = addToReposJson(hubDir, "/path/to/repo", "org/repo");
    expect(result).toBe(true);

    const repos = JSON.parse(fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8"));
    expect(repos).toHaveLength(1);
    expect(repos[0].path).toBe("/path/to/repo");
  });

  it("backs up corrupted repos.json to .corrupt file", () => {
    fs.writeFileSync(path.join(hubDir, "repos.json"), "broken{{{", "utf-8");
    addToReposJson(hubDir, "/path/to/repo", "org/repo");
    const backupPath = path.join(hubDir, "repos.json.corrupt");
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe("broken{{{");
  });

  it("writes JSON with trailing newline", () => {
    addToReposJson(hubDir, "/path/to/repo", "org/repo");
    const content = fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("produces pretty-printed JSON (2-space indent)", () => {
    addToReposJson(hubDir, "/path/to/repo", "org/repo");
    const content = fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8");
    // JSON.stringify with null, 2 produces lines starting with 2 spaces
    expect(content).toContain("  ");
    // Verify it round-trips cleanly
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("handles empty string path (still adds — no validation on content)", () => {
    // The function does not validate path/label content, only checks for duplicates
    const result = addToReposJson(hubDir, "", "some-label");
    expect(result).toBe(true);
    const repos = JSON.parse(fs.readFileSync(path.join(hubDir, "repos.json"), "utf-8"));
    expect(repos[0].path).toBe("");
  });

  it("dedup check matches on path even when label differs", () => {
    fs.writeFileSync(
      path.join(hubDir, "repos.json"),
      JSON.stringify([{ path: "/same/path", label: "original-label" }]),
      "utf-8",
    );
    const result = addToReposJson(hubDir, "/same/path", "different-label");
    expect(result).toBe(false);
  });

  it("dedup check matches on label even when path differs", () => {
    fs.writeFileSync(
      path.join(hubDir, "repos.json"),
      JSON.stringify([{ path: "/original/path", label: "same-label" }]),
      "utf-8",
    );
    const result = addToReposJson(hubDir, "/different/path", "same-label");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectCwd — additional edge cases
// ---------------------------------------------------------------------------

describe("detectCwd: additional edge cases", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-detect2-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects src/ directory as code repo heuristic", () => {
    fs.mkdirSync(path.join(tempDir, "src"));
    const result = detectCwd(tempDir);
    expect(result.hasSrcDir).toBe(true);
    // src alone (without agentboot config) means looksLikeCodeRepo
    expect(result.looksLikeCodeRepo).toBe(true);
  });

  it("looksLikeCodeRepo is false when agentboot.config.json is present even with package.json", () => {
    // A hub can have package.json (for build tooling) but should not look like a code repo
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tempDir, "agentboot.config.json"), "{}");
    const result = detectCwd(tempDir);
    expect(result.hasPackageJson).toBe(true);
    expect(result.hasAgentbootConfig).toBe(true);
    expect(result.looksLikeCodeRepo).toBe(false);
  });

  it("inventories .claude/agents/ subdirectory entries", () => {
    fs.mkdirSync(path.join(tempDir, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", "agents", "code-reviewer.md"), "# agent");
    fs.writeFileSync(path.join(tempDir, ".claude", "agents", "security-reviewer.md"), "# agent");
    const result = detectCwd(tempDir);
    expect(result.claudeArtifacts).toContain("agents/code-reviewer.md");
    expect(result.claudeArtifacts).toContain("agents/security-reviewer.md");
  });

  it("inventories .claude/skills/ subdirectory entries", () => {
    fs.mkdirSync(path.join(tempDir, ".claude", "skills"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", "skills", "review-code"), "# skill");
    const result = detectCwd(tempDir);
    expect(result.claudeArtifacts).toContain("skills/review-code");
  });

  it("inventories .claude/settings.json", () => {
    fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", "settings.json"), "{}");
    const result = detectCwd(tempDir);
    expect(result.claudeArtifacts).toContain("settings.json");
  });

  it("inventories .claude/.mcp.json", () => {
    fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".claude", ".mcp.json"), "{}");
    const result = detectCwd(tempDir);
    expect(result.claudeArtifacts).toContain(".mcp.json");
  });

  it("populates promptFiles from hasPrompts", () => {
    fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "# instructions");
    fs.writeFileSync(path.join(tempDir, ".cursorrules"), "rules");
    const result = detectCwd(tempDir);
    expect(result.promptFiles).toContain("CLAUDE.md");
    expect(result.promptFiles).toContain(".cursorrules");
  });

  it("gitOrg and gitRepoName are null for non-git directory", () => {
    const result = detectCwd(tempDir);
    expect(result.gitOrg).toBeNull();
    expect(result.gitRepoName).toBeNull();
  });

  it("gitOrg and gitRepoName are populated for git repo with remote", () => {
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    execSync("git remote add origin https://github.com/test-org/test-repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    const result = detectCwd(tempDir);
    expect(result.isGitRepo).toBe(true);
    expect(result.gitOrg).toBe("test-org");
    expect(result.gitRepoName).toBe("test-repo");
  });

  it("all boolean fields default to false for empty directory", () => {
    const result = detectCwd(tempDir);
    expect(result.isGitRepo).toBe(false);
    expect(result.hasPackageJson).toBe(false);
    expect(result.hasSrcDir).toBe(false);
    expect(result.hasAgentbootConfig).toBe(false);
    expect(result.hasClaudeDir).toBe(false);
    expect(result.hasManifest).toBe(false);
    expect(result.looksLikeCodeRepo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getGitOrgAndRepo — additional edge cases
// ---------------------------------------------------------------------------

describe("getGitOrgAndRepo: additional edge cases", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-gitorg2-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("handles HTTPS remote without .git suffix", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git remote add origin https://github.com/acme-corp/my-api", {
      cwd: testDir,
      stdio: "pipe",
    });
    const result = getGitOrgAndRepo(testDir);
    expect(result).toEqual({ org: "acme-corp", repo: "my-api" });
  });

  it("handles org and repo names with dots", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git remote add origin https://github.com/my.org/my.repo.git", {
      cwd: testDir,
      stdio: "pipe",
    });
    const result = getGitOrgAndRepo(testDir);
    expect(result).not.toBeNull();
    expect(result!.org).toBe("my.org");
    expect(result!.repo).toBe("my.repo");
  });

  it("handles org and repo names with hyphens and underscores", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git remote add origin https://github.com/my-org_v2/my-repo_v3.git", {
      cwd: testDir,
      stdio: "pipe",
    });
    const result = getGitOrgAndRepo(testDir);
    expect(result).not.toBeNull();
    expect(result!.org).toBe("my-org_v2");
    expect(result!.repo).toBe("my-repo_v3");
  });

  it("returns null for nonexistent directory", () => {
    const result = getGitOrgAndRepo("/nonexistent/path/that/does/not/exist");
    expect(result).toBeNull();
  });

  it("returns null for empty git remote URL", () => {
    // git init but with a remote that has an invalid URL pattern
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git remote add origin just-a-name", { cwd: testDir, stdio: "pipe" });
    const result = getGitOrgAndRepo(testDir);
    // The regex /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/ won't match "just-a-name"
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasPrompts — additional edge cases
// ---------------------------------------------------------------------------

describe("hasPrompts: additional edge cases", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-prompts2-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns found: false for .github/prompts/ with no .prompt.md files", () => {
    // Directory exists but has only non-matching files
    fs.mkdirSync(path.join(testDir, ".github", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".github", "prompts", "README.md"), "# readme");
    fs.writeFileSync(path.join(testDir, ".github", "prompts", "notes.txt"), "notes");
    const result = hasPrompts(testDir);
    // No .prompt.md files, no other agentic content
    expect(result.files.filter((f) => f.includes(".github/prompts/"))).toEqual([]);
  });

  it("excludes both .agentboot-archive and .agentboot-manifest.json from .claude/", () => {
    fs.mkdirSync(path.join(testDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".claude", ".agentboot-manifest.json"), "{}");
    fs.mkdirSync(path.join(testDir, ".claude", ".agentboot-archive"), { recursive: true });
    const result = hasPrompts(testDir);
    expect(result.found).toBe(false);
    expect(result.files).toEqual([]);
  });

  it("includes non-excluded .claude/ entries alongside excluded ones", () => {
    fs.mkdirSync(path.join(testDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(testDir, ".claude", ".agentboot-manifest.json"), "{}");
    fs.writeFileSync(path.join(testDir, ".claude", "CLAUDE.md"), "# instructions");
    fs.writeFileSync(path.join(testDir, ".claude", "settings.json"), "{}");
    const result = hasPrompts(testDir);
    expect(result.found).toBe(true);
    // Excluded files should not appear
    expect(result.files).not.toContain(".claude/.agentboot-manifest.json");
    // Included files should appear
    expect(result.files).toContain(".claude/CLAUDE.md");
    expect(result.files).toContain(".claude/settings.json");
  });

  it("handles .claude/ directory that is actually a file (not a directory)", () => {
    // Edge case: .claude is a file, not a directory
    fs.writeFileSync(path.join(testDir, ".claude"), "not a directory");
    const result = hasPrompts(testDir);
    // Should not crash; .claude is not a directory so it's skipped
    expect(result.files.filter((f) => f.startsWith(".claude/"))).toEqual([]);
  });

  it("gracefully handles unreadable directories (permission errors)", () => {
    // Create a directory that will cause a permission error on read
    const restrictedDir = path.join(testDir, ".claude");
    fs.mkdirSync(restrictedDir);
    fs.writeFileSync(path.join(restrictedDir, "CLAUDE.md"), "# test");
    // Remove read permission
    fs.chmodSync(restrictedDir, 0o000);

    try {
      const result = hasPrompts(testDir);
      // Should not crash — the try/catch in hasPrompts handles EACCES
      // The .claude/ check fails silently, but other checks still run
      expect(result).toBeDefined();
      expect(result.files.filter(f => f.startsWith(".claude/"))).toEqual([]);
    } finally {
      // Restore permissions for cleanup
      fs.chmodSync(restrictedDir, 0o755);
    }
  });
});

// ---------------------------------------------------------------------------
// scaffoldHub — additional edge cases
// ---------------------------------------------------------------------------

describe("scaffoldHub: additional edge cases", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scaffold2-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("is idempotent — calling twice does not error", () => {
    scaffoldHub(tempDir, "test-org", "Test Org");
    // Second call should not throw
    expect(() => scaffoldHub(tempDir, "test-org", "Test Org")).not.toThrow();
  });

  it("overwrites agentboot.config.json on re-scaffold", () => {
    scaffoldHub(tempDir, "first-org", "First Org");
    scaffoldHub(tempDir, "second-org", "Second Org");
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"),
    );
    expect(config.org).toBe("second-org");
    expect(config.orgDisplayName).toBe("Second Org");
  });

  it("does NOT overwrite repos.json on re-scaffold", () => {
    scaffoldHub(tempDir, "test-org");
    // Manually add content to repos.json
    fs.writeFileSync(
      path.join(tempDir, "repos.json"),
      JSON.stringify([{ path: "/user/repo", label: "my/repo" }]),
    );
    scaffoldHub(tempDir, "test-org");
    const repos = JSON.parse(fs.readFileSync(path.join(tempDir, "repos.json"), "utf-8"));
    expect(repos).toEqual([{ path: "/user/repo", label: "my/repo" }]);
  });

  it("config includes all 4 personas in enabled list", () => {
    scaffoldHub(tempDir, "test-org");
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"),
    );
    const expected = [
      "code-reviewer",
      "security-reviewer",
      "test-generator",
      "test-data-expert",
    ];
    for (const persona of expected) {
      expect(config.personas.enabled).toContain(persona);
    }
    expect(config.personas.enabled).toHaveLength(4);
  });

  it("config includes all 6 traits in enabled list", () => {
    scaffoldHub(tempDir, "test-org");
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"),
    );
    const expected = [
      "critical-thinking",
      "structured-output",
      "source-citation",
      "confidence-signaling",
      "audit-trail",
      "schema-awareness",
    ];
    for (const trait of expected) {
      expect(config.traits.enabled).toContain(trait);
    }
    expect(config.traits.enabled).toHaveLength(6);
  });

  it("config includes all 4 output formats", () => {
    scaffoldHub(tempDir, "test-org");
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"),
    );
    expect(config.personas.outputFormats).toEqual(["skill", "agents", "claude", "copilot"]);
  });

  it("config includes both instruction sets", () => {
    scaffoldHub(tempDir, "test-org");
    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"),
    );
    expect(config.instructions.enabled).toEqual([
      "baseline.instructions",
      "security.instructions",
    ]);
  });

  it("config file ends with a trailing newline", () => {
    scaffoldHub(tempDir, "test-org");
    const raw = fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanNearby — additional edge cases
// ---------------------------------------------------------------------------

describe("scanNearby: additional edge cases", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nearby2-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("returns empty when only spoke directory exists in parent", () => {
    const spoke = path.join(parentDir, "only-child");
    fs.mkdirSync(spoke);
    const results = scanNearby(spoke);
    expect(results).toEqual([]);
  });

  it("does not include non-directory entries as siblings", () => {
    const spoke = path.join(parentDir, "my-app");
    fs.mkdirSync(spoke);
    // Create a file sibling, not a directory
    fs.writeFileSync(path.join(parentDir, "README.md"), "# readme");
    const results = scanNearby(spoke);
    // File siblings should be ignored
    const fileSiblings = results.filter((r) => r.path.endsWith("README.md"));
    expect(fileSiblings).toEqual([]);
  });

  it("does not scan the cwd directory as a sibling (avoids double-counting)", () => {
    const spoke = path.join(parentDir, "my-app");
    fs.mkdirSync(spoke);
    fs.mkdirSync(path.join(spoke, ".claude"));
    fs.writeFileSync(path.join(spoke, ".claude", "CLAUDE.md"), "# test");

    const results = scanNearby(spoke);
    // cwd should appear as "prompts" type, not duplicated
    const cwdMatches = results.filter((r) => r.path === spoke);
    expect(cwdMatches).toHaveLength(1);
  });

  it("handles multiple sibling hubs and prompts repos", () => {
    const spoke = path.join(parentDir, "my-app");
    const hub1 = path.join(parentDir, "personas");
    const hub2 = path.join(parentDir, "other-personas");
    const promptRepo = path.join(parentDir, "legacy-app");

    fs.mkdirSync(spoke);
    fs.mkdirSync(hub1);
    fs.mkdirSync(hub2);
    fs.mkdirSync(path.join(promptRepo, ".claude"), { recursive: true });

    fs.writeFileSync(path.join(hub1, "agentboot.config.json"), "{}");
    fs.writeFileSync(path.join(hub2, "agentboot.config.json"), "{}");
    fs.writeFileSync(path.join(promptRepo, ".claude", "CLAUDE.md"), "# legacy");

    const results = scanNearby(spoke);
    const hubs = results.filter((r) => r.type === "hub");
    const prompts = results.filter((r) => r.type === "prompts");

    expect(hubs).toHaveLength(2);
    expect(prompts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------

describe("shellQuote", () => {
  it("returns simple paths unchanged", () => {
    expect(shellQuote("/Users/mike/work/personas")).toBe("/Users/mike/work/personas");
  });

  it("returns paths with tildes and dots unchanged", () => {
    expect(shellQuote("~/work/../personas")).toBe("~/work/../personas");
  });

  it("wraps paths with spaces in single quotes", () => {
    expect(shellQuote("/Users/mike/My Projects/app")).toBe("'/Users/mike/My Projects/app'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("/Users/mike/it's-a-repo")).toBe("'/Users/mike/it'\\''s-a-repo'");
  });

  it("wraps paths with backticks", () => {
    expect(shellQuote("/path/with`backtick")).toBe("'/path/with`backtick'");
  });

  it("wraps paths with dollar signs", () => {
    expect(shellQuote("/path/$HOME/repo")).toBe("'/path/$HOME/repo'");
  });

  it("wraps paths with double quotes", () => {
    expect(shellQuote('/path/with"quote')).toBe("'/path/with\"quote'");
  });

  it("handles empty string", () => {
    expect(shellQuote("")).toBe("''");
  });
});

// ---------------------------------------------------------------------------
// Non-destructive install safety — data loss prevention
// ---------------------------------------------------------------------------

describe("scaffoldHub: non-destructive safety guarantees", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-safety-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not delete any pre-existing files in the target directory", () => {
    // Simulate a directory with user files already present
    fs.writeFileSync(path.join(tempDir, "README.md"), "# My Project\n");
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "important notes\n");
    fs.mkdirSync(path.join(tempDir, "docs"));
    fs.writeFileSync(path.join(tempDir, "docs", "design.md"), "architecture\n");

    scaffoldHub(tempDir, "test-org");

    // All pre-existing files must still be intact
    expect(fs.readFileSync(path.join(tempDir, "README.md"), "utf-8")).toBe("# My Project\n");
    expect(fs.readFileSync(path.join(tempDir, "notes.txt"), "utf-8")).toBe("important notes\n");
    expect(fs.readFileSync(path.join(tempDir, "docs", "design.md"), "utf-8")).toBe("architecture\n");
  });

  it("does not modify pre-existing files outside its known file set", () => {
    // User has their own config files — scaffold must not touch them
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"name": "my-app"}\n');
    fs.writeFileSync(path.join(tempDir, "tsconfig.json"), '{"strict": true}\n');

    scaffoldHub(tempDir, "test-org");

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf-8")).toBe('{"name": "my-app"}\n');
    expect(fs.readFileSync(path.join(tempDir, "tsconfig.json"), "utf-8")).toBe('{"strict": true}\n');
  });

  it("does not overwrite pre-existing core/ directories with user content", () => {
    // User already has a core/personas/ with custom content
    fs.mkdirSync(path.join(tempDir, "core", "personas"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "core", "personas", "my-custom-persona.md"),
      "# Custom Persona\n",
    );

    scaffoldHub(tempDir, "test-org");

    // Custom persona file must survive
    expect(
      fs.readFileSync(path.join(tempDir, "core", "personas", "my-custom-persona.md"), "utf-8"),
    ).toBe("# Custom Persona\n");
  });

  it("creates target directory if it does not exist without affecting siblings", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-parent-"));
    const siblingDir = path.join(parent, "existing-repo");
    const hubDir = path.join(parent, "personas");

    fs.mkdirSync(siblingDir);
    fs.writeFileSync(path.join(siblingDir, "important.txt"), "do not touch\n");

    scaffoldHub(hubDir, "test-org");

    // Sibling directory must be untouched
    expect(fs.readFileSync(path.join(siblingDir, "important.txt"), "utf-8")).toBe("do not touch\n");
    // Hub was created
    expect(fs.existsSync(path.join(hubDir, "agentboot.config.json"))).toBe(true);

    fs.rmSync(parent, { recursive: true, force: true });
  });

  it("preserves file permissions of pre-existing repos.json", () => {
    const reposPath = path.join(tempDir, "repos.json");
    fs.writeFileSync(reposPath, "[]\n");
    fs.chmodSync(reposPath, 0o644);
    const beforeMode = fs.statSync(reposPath).mode;

    scaffoldHub(tempDir, "test-org");

    const afterMode = fs.statSync(reposPath).mode;
    expect(afterMode).toBe(beforeMode);
  });

  it("does not remove or replace .git directory on re-scaffold", () => {
    // First scaffold creates .git
    scaffoldHub(tempDir, "test-org");
    expect(fs.existsSync(path.join(tempDir, ".git"))).toBe(true);

    // Add a commit so .git has real content
    execSync("git add -A && git commit -m init --allow-empty", {
      cwd: tempDir,
      stdio: "pipe",
    });
    const logBefore = execSync("git log --oneline", { cwd: tempDir, encoding: "utf-8" });

    // Re-scaffold must not destroy git history
    scaffoldHub(tempDir, "second-org");
    const logAfter = execSync("git log --oneline", { cwd: tempDir, encoding: "utf-8" });
    expect(logAfter).toBe(logBefore);
  });
});

describe("addToReposJson: non-destructive safety guarantees", () => {
  let hubDir: string;

  beforeEach(() => {
    hubDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-repos-safety-"));
  });

  afterEach(() => {
    fs.rmSync(hubDir, { recursive: true, force: true });
  });

  it("never removes existing entries when adding a new one", () => {
    const reposPath = path.join(hubDir, "repos.json");
    const existing = [
      { path: "/first/repo", label: "org/first" },
      { path: "/second/repo", label: "org/second" },
    ];
    fs.writeFileSync(reposPath, JSON.stringify(existing), "utf-8");

    addToReposJson(hubDir, "/third/repo", "org/third");

    const result = JSON.parse(fs.readFileSync(reposPath, "utf-8"));
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ path: "/first/repo", label: "org/first" });
    expect(result[1]).toEqual({ path: "/second/repo", label: "org/second" });
    expect(result[2]).toEqual({ path: "/third/repo", label: "org/third" });
  });

  it("does not modify entries when adding a duplicate", () => {
    const reposPath = path.join(hubDir, "repos.json");
    const existing = [{ path: "/existing/repo", label: "org/repo" }];
    fs.writeFileSync(reposPath, JSON.stringify(existing), "utf-8");

    const added = addToReposJson(hubDir, "/existing/repo", "org/repo");

    expect(added).toBe(false);
    const result = JSON.parse(fs.readFileSync(reposPath, "utf-8"));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: "/existing/repo", label: "org/repo" });
  });

  it("preserves corrupted file as .corrupt backup before recovering", () => {
    const reposPath = path.join(hubDir, "repos.json");
    const corruptContent = "this is not json {{{";
    fs.writeFileSync(reposPath, corruptContent, "utf-8");

    addToReposJson(hubDir, "/new/repo", "org/new");

    // Corrupt content backed up
    const backupPath = path.join(hubDir, "repos.json.corrupt");
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe(corruptContent);

    // New file is valid
    const result = JSON.parse(fs.readFileSync(reposPath, "utf-8"));
    expect(result).toHaveLength(1);
  });
});
