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
// AB-33: setup command
// ===========================================================================

describe("AB-33: setup command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-setup-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("scaffolds agentboot.config.json in a fresh directory", () => {
    run("setup --skip-detect", tempDir);
    const configPath = path.join(tempDir, "agentboot.config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.org).toBeDefined();
    expect(config.personas.enabled).toContain("code-reviewer");
    expect(config.traits.enabled).toContain("critical-thinking");
  });

  it("scaffolds repos.json", () => {
    run("setup --skip-detect", tempDir);
    expect(fs.existsSync(path.join(tempDir, "repos.json"))).toBe(true);
    const repos = JSON.parse(fs.readFileSync(path.join(tempDir, "repos.json"), "utf-8"));
    expect(repos).toEqual([]);
  });

  it("creates core directory structure", () => {
    run("setup --skip-detect", tempDir);
    expect(fs.existsSync(path.join(tempDir, "core", "personas"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "core", "traits"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "core", "instructions"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "core", "gotchas"))).toBe(true);
  });

  it("does not overwrite existing agentboot.config.json", () => {
    fs.writeFileSync(path.join(tempDir, "agentboot.config.json"), '{"org": "existing"}');
    const output = run("setup", tempDir);
    expect(output).toContain("already exists");
    // Config should not be overwritten
    const config = JSON.parse(fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8"));
    expect(config.org).toBe("existing");
  });

  it("generates valid JSON config (parseable, no syntax errors)", () => {
    run("setup --skip-detect", tempDir);
    const raw = fs.readFileSync(path.join(tempDir, "agentboot.config.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
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

  it("shows 'No repos' when repos.json is empty", () => {
    const output = run("status");
    expect(output).toContain("No repos");
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
    // All findings should be for code-reviewer persona or general (traits)
    for (const f of findings) {
      const isPersonaFile = f.file.includes("code-reviewer");
      const isTraitFile = f.file.startsWith("core/traits/");
      expect(isPersonaFile || isTraitFile, `Unexpected file in filtered output: ${f.file}`).toBe(true);
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

  it("config mutation exits non-zero", () => {
    expect(() => run("config org newvalue")).toThrow();
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
    expect(output).toContain("setup");
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
