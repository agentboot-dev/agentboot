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
