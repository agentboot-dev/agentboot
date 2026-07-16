/**
 * Unit tests for validation logic.
 *
 * Tests config loading (JSONC stripping), persona existence checks,
 * trait reference checks, SKILL.md frontmatter parsing, and secret scanning.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { stripJsoncComments } from "../scripts/lib/config.js";
import {
  parseFrontmatter,
  scanForSecrets,
  DEFAULT_SECRET_PATTERNS,
} from "../scripts/lib/frontmatter.js";
import { isUnsafeRegex, buildSecretPatterns } from "../scripts/validate.js";
import type { AgentBootConfig } from "../scripts/lib/config.js";

// ---------------------------------------------------------------------------
// JSONC stripping
// ---------------------------------------------------------------------------

describe("stripJsoncComments", () => {
  it("strips single-line comments", () => {
    const input = `{
  "key": "value" // this is a comment
}`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe("value");
  });

  it("strips full-line comments", () => {
    const input = `{
  // this line is entirely a comment
  "key": "value"
}`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe("value");
  });

  it("preserves // inside string values", () => {
    const input = `{
  "url": "https://example.com/path"
}`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.url).toBe("https://example.com/path");
  });

  it("handles escaped quotes in strings", () => {
    const input = `{
  "msg": "say \\"hello\\"" // comment
}`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.msg).toBe('say "hello"');
  });

  it("parses real agentboot.config.json", () => {
    const configPath = path.join(__dirname, "..", "agentboot.config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const stripped = stripJsoncComments(raw);
    const config = JSON.parse(stripped);
    expect(config.org).toBe("your-org");
    expect(config.personas.enabled).toContain("code-reviewer");
  });
});

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("extracts name and description", () => {
    const content = `---
name: code-reviewer
description: Reviews code for bugs
---

# Code Reviewer`;

    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("name")).toBe("code-reviewer");
    expect(fields!.get("description")).toBe("Reviews code for bugs");
  });

  it("returns null when no frontmatter block", () => {
    const content = `# Just a heading\n\nSome content.`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  // Regression: git autocrlf on Windows checks files out with CRLF, which the
  // original `^---\n` matcher rejected — breaking SKILL.md validation on the
  // windows-latest CI leg while ubuntu (LF) passed.
  it("parses CRLF line endings (Windows checkout)", () => {
    const content =
      "---\r\nname: code-reviewer\r\ndescription: Reviews code for bugs\r\n---\r\n\r\n# Code Reviewer";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("name")).toBe("code-reviewer");
    expect(fields!.get("description")).toBe("Reviews code for bugs");
  });

  it("parses content with a leading UTF-8 BOM", () => {
    const content =
      "\uFEFF---\nname: security-reviewer\ndescription: Finds vulnerabilities\n---\n";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("name")).toBe("security-reviewer");
    expect(fields!.get("description")).toBe("Finds vulnerabilities");
  });

  it("parses content with a BOM and CRLF together", () => {
    const content =
      "\uFEFF---\r\nname: test-generator\r\ndescription: Writes tests\r\n---\r\n";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("name")).toBe("test-generator");
    expect(fields!.get("description")).toBe("Writes tests");
  });

  it("handles multi-word values", () => {
    const content = `---
name: test-generator
description: Writes unit and integration tests for any codebase
---`;
    const fields = parseFrontmatter(content);
    expect(fields!.get("description")).toBe(
      "Writes unit and integration tests for any codebase"
    );
  });

  it("parses all real SKILL.md files", () => {
    const personasDir = path.join(__dirname, "..", "core", "personas");
    const personas = fs.readdirSync(personasDir).filter((entry) =>
      fs.statSync(path.join(personasDir, entry)).isDirectory()
    );

    expect(personas.length).toBeGreaterThanOrEqual(4);

    for (const persona of personas) {
      const skillPath = path.join(personasDir, persona, "SKILL.md");
      expect(fs.existsSync(skillPath), `${persona}/SKILL.md should exist`).toBe(true);

      const content = fs.readFileSync(skillPath, "utf-8");
      const fields = parseFrontmatter(content);
      expect(fields, `${persona}/SKILL.md should have frontmatter`).not.toBeNull();
      expect(fields!.has("name"), `${persona} frontmatter should have name`).toBe(true);
      expect(fields!.has("description"), `${persona} frontmatter should have description`).toBe(true);
      expect(fields!.get("name"), `${persona} name should not be empty`).not.toBe("");
      expect(fields!.get("description"), `${persona} description should not be empty`).not.toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// Secret scanning
// ---------------------------------------------------------------------------

describe("scanForSecrets", () => {
  it("detects password assignments", () => {
    const content = `const password = "hunter2";`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.pattern).toMatch(/password/i);
  });

  it("detects API keys", () => {
    const content = `api_key = "sk-1234567890abcdef"`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.pattern).toMatch(/api[_-]?key/i);
  });

  it("detects AWS keys", () => {
    const content = `aws_access_key_id = AKIAIOSFODNN7EXAMPLE`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.pattern).toContain("aws");
  });

  it("detects private keys", () => {
    const content = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.pattern).toContain("PRIVATE KEY");
  });

  it("detects GitHub tokens", () => {
    const content = `ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.pattern).toContain("ghp");
  });

  it("does not flag safe content", () => {
    const content = `Use environment variables for credentials.\nNever hardcode passwords.`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBe(0);
  });

  it("does not flag password references in instructions", () => {
    // Our security instructions mention passwords conceptually — that's fine
    const content = `- Never hardcode (not even for local dev)\n- Flag secrets in wrong places`;
    const hits = scanForSecrets(content);
    expect(hits.length).toBe(0);
  });

  it("scans all real trait and persona files without false positives", () => {
    const dirs = [
      path.join(__dirname, "..", "core", "traits"),
      path.join(__dirname, "..", "core", "personas"),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = walkDir(dir, [".md", ".json"]);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const hits = scanForSecrets(content);
        const relPath = path.relative(path.join(__dirname, ".."), file);
        expect(hits, `Secret found in ${relPath} at line ${hits[0]?.line}`).toHaveLength(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// isUnsafeRegex
// ---------------------------------------------------------------------------

describe("isUnsafeRegex", () => {
  it("rejects patterns longer than 200 chars", () => {
    expect(isUnsafeRegex("a".repeat(201))).toBe(true);
  });

  it("accepts patterns under 200 chars", () => {
    expect(isUnsafeRegex("a".repeat(200))).toBe(false);
  });

  it("rejects nested quantifiers (x+)+", () => {
    expect(isUnsafeRegex("(a+)+")).toBe(true);
  });

  it("rejects nested quantifiers (x*)+", () => {
    expect(isUnsafeRegex("(a*)+")).toBe(true);
  });

  it("rejects nested quantifiers (x+)*", () => {
    expect(isUnsafeRegex("(a+)*")).toBe(true);
  });

  it("rejects nested quantifiers with braces (x+){2,}", () => {
    expect(isUnsafeRegex("(a+){2,}")).toBe(true);
  });

  it("rejects adjacent overlapping quantifiers **", () => {
    expect(isUnsafeRegex("a**")).toBe(true);
  });

  it("rejects adjacent overlapping quantifiers ++", () => {
    expect(isUnsafeRegex("a++")).toBe(true);
  });

  it("accepts safe patterns", () => {
    expect(isUnsafeRegex("password\\s*[:=]")).toBe(false);
    expect(isUnsafeRegex("[a-z]+")).toBe(false);
    expect(isUnsafeRegex("AKIA[A-Z0-9]{16}")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSecretPatterns
// ---------------------------------------------------------------------------

describe("buildSecretPatterns", () => {
  it("returns DEFAULT_SECRET_PATTERNS when config has no custom patterns", () => {
    const config = { org: "test" } as AgentBootConfig;
    const patterns = buildSecretPatterns(config);
    expect(patterns.length).toBe(DEFAULT_SECRET_PATTERNS.length);
  });

  it("appends valid custom patterns", () => {
    const config = {
      org: "test",
      validation: { secretPatterns: ["CUSTOM_KEY_[A-Z]+"] },
    } as AgentBootConfig;
    const patterns = buildSecretPatterns(config);
    expect(patterns.length).toBe(DEFAULT_SECRET_PATTERNS.length + 1);
    expect(patterns[patterns.length - 1]!.source).toBe("CUSTOM_KEY_[A-Z]+");
  });

  it("rejects unsafe custom patterns", () => {
    const config = {
      org: "test",
      validation: { secretPatterns: ["(a+)+"] },
    } as AgentBootConfig;
    const patterns = buildSecretPatterns(config);
    // Unsafe pattern rejected — only defaults remain
    expect(patterns.length).toBe(DEFAULT_SECRET_PATTERNS.length);
  });

  it("rejects invalid regex syntax", () => {
    const config = {
      org: "test",
      validation: { secretPatterns: ["[invalid"] },
    } as AgentBootConfig;
    const patterns = buildSecretPatterns(config);
    expect(patterns.length).toBe(DEFAULT_SECRET_PATTERNS.length);
  });

  it("handles mix of valid and invalid patterns", () => {
    const config = {
      org: "test",
      validation: { secretPatterns: ["GOOD_[A-Z]+", "(bad+)+", "ALSO_GOOD"] },
    } as AgentBootConfig;
    const patterns = buildSecretPatterns(config);
    expect(patterns.length).toBe(DEFAULT_SECRET_PATTERNS.length + 2);
  });
});

// ---------------------------------------------------------------------------
// persona.config.json validation
// ---------------------------------------------------------------------------

describe("persona.config.json", () => {
  it("exists for all enabled personas", () => {
    const configPath = path.join(__dirname, "..", "agentboot.config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(stripJsoncComments(raw));
    const enabled: string[] = config.personas.enabled;

    for (const persona of enabled) {
      const pcPath = path.join(__dirname, "..", "core", "personas", persona, "persona.config.json");
      expect(fs.existsSync(pcPath), `${persona}/persona.config.json should exist`).toBe(true);
    }
  });

  it("has required fields (name, description, invocation, traits)", () => {
    const personasDir = path.join(__dirname, "..", "core", "personas");
    const personas = fs.readdirSync(personasDir).filter((entry) =>
      fs.statSync(path.join(personasDir, entry)).isDirectory()
    );

    for (const persona of personas) {
      const pcPath = path.join(personasDir, persona, "persona.config.json");
      if (!fs.existsSync(pcPath)) continue;

      const config = JSON.parse(fs.readFileSync(pcPath, "utf-8"));
      expect(config.name, `${persona} should have name`).toBeTruthy();
      expect(config.description, `${persona} should have description`).toBeTruthy();
      expect(config.invocation, `${persona} should have invocation`).toBeTruthy();
      // AB-134: traits can be array or object (weight map)
      const isArray = Array.isArray(config.traits);
      const isObject = typeof config.traits === "object" && config.traits !== null && !isArray;
      expect(isArray || isObject, `${persona} traits should be array or object`).toBe(true);
      const traitCount = isArray ? config.traits.length : Object.keys(config.traits).length;
      expect(traitCount, `${persona} should have at least one trait`).toBeGreaterThan(0);
    }
  });

  it("only references traits that exist in core/traits/", () => {
    const traitsDir = path.join(__dirname, "..", "core", "traits");
    const availableTraits = new Set(
      fs.readdirSync(traitsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.basename(f, ".md"))
    );

    const personasDir = path.join(__dirname, "..", "core", "personas");
    const personas = fs.readdirSync(personasDir).filter((entry) =>
      fs.statSync(path.join(personasDir, entry)).isDirectory()
    );

    for (const persona of personas) {
      const pcPath = path.join(personasDir, persona, "persona.config.json");
      if (!fs.existsSync(pcPath)) continue;

      const config = JSON.parse(fs.readFileSync(pcPath, "utf-8"));
      // AB-134: traits can be array or object (weight map)
      const traitNames = Array.isArray(config.traits)
        ? config.traits
        : Object.keys(config.traits ?? {});
      for (const trait of traitNames) {
        expect(
          availableTraits.has(trait),
          `${persona} references trait "${trait}" which doesn't exist`
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validate --strict mode exit code
// Addresses gap: "Validate exit codes — code 2 (--strict) not tested"
// (human-in-the-loop-priority.md MEDIUM section)
//
// IMPORTANT BUG FINDING: The manual test plan (TP-03-12) documents expected exit
// code 2 for --strict mode. The implementation at scripts/validate.ts line 736
// calls process.exit(1) unconditionally — there is no exit(2) path in the code.
// These tests verify ACTUAL behavior (exit 1) and establish a regression baseline.
// If exit code 2 is intentional, the implementation needs to be updated.
// ---------------------------------------------------------------------------

const VALIDATE_TSX_BIN = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
const VALIDATE_SCRIPT = path.join(__dirname, "..", "scripts", "validate.ts");

function runValidateRaw(args: string, cwd = path.join(__dirname, "..")): string {
  return execSync(`${VALIDATE_TSX_BIN} ${VALIDATE_SCRIPT} ${args}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
    stdio: "pipe",
  }).toString();
}

function runValidateExpectFailRaw(
  args: string,
  cwd = path.join(__dirname, "..")
): { output: string; status: number } {
  try {
    runValidateRaw(args, cwd);
    throw new Error("Expected validate to fail but it succeeded");
  } catch (err: any) {
    if (err.message === "Expected validate to fail but it succeeded") throw err;
    // execSync captures both stdout and stderr when stdio: "pipe" is set
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    return {
      output: stdout + stderr,
      status: err.status ?? 1,
    };
  }
}

describe("validate --strict mode", () => {
  // Prove --strict is accepted without "unknown flag" error on a clean repo
  it("--strict: flag accepted without unknown-flag error", () => {
    const output = runValidateRaw("--strict");
    expect(output).not.toContain("unknown option");
    expect(output).not.toContain("unknown flag");
    // Clean repo exits 0 with --strict when no warnings exist
  });

  // Prove --strict causes exit 1 (non-zero) when a warning-only condition exists.
  // A config with no personas enabled triggers the "No personas enabled" warning
  // in checkPersonaExistence() — a WARN, not an ERROR, so without --strict it passes.
  it("--strict: exits non-zero when warnings exist (empty personas list)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-strict-warn-"));
    const tmpConfig = path.join(tmpDir, "agentboot.config.json");
    fs.writeFileSync(
      tmpConfig,
      JSON.stringify({
        org: "test-org",
        personas: { enabled: [] }, // empty — triggers "No personas enabled" WARN
        traits: { enabled: [] },
        instructions: { enabled: [] },
      })
    );

    try {
      // Without --strict: a warning does not cause a non-zero exit
      const cleanOutput = runValidateRaw(`--config ${tmpConfig}`);
      expect(cleanOutput).toContain("passed");

      // With --strict: warnings are promoted to failures → exit non-zero
      const { status, output } = runValidateExpectFailRaw(`--config ${tmpConfig} --strict`);
      // Implementation currently exits 1, not 2. If this fails, the code was changed
      // to emit 2 and the test should be updated to expect(status).toBe(2).
      expect(status).toBe(1);
      // Output must reference strict mode
      expect(output.toLowerCase()).toMatch(/strict/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Error message quality
// Addresses gap: "Error message quality — errors thrown checked, not message text"
// (human-in-the-loop-priority.md CRITICAL section)
// ---------------------------------------------------------------------------

describe("validate error message quality", () => {
  // Prove that referencing a non-existent trait produces an error that names
  // BOTH the persona containing the bad reference AND the missing trait name.
  // This is the TP-15-3 scenario graded A–F in the manual plan.
  it("unknown trait: error names the persona AND the missing trait", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-badtrait-msg-"));
    const customPersonaDir = path.join(tmpDir, "custom-personas", "code-reviewer");
    fs.mkdirSync(customPersonaDir, { recursive: true });

    fs.writeFileSync(
      path.join(customPersonaDir, "persona.config.json"),
      JSON.stringify({
        name: "Code Reviewer",
        description: "Test persona for error message quality",
        invocation: "/review-code",
        traits: ["completely-made-up-trait"],
      })
    );
    // Copy a real SKILL.md so frontmatter checks pass
    fs.copyFileSync(
      path.join(__dirname, "..", "core", "personas", "code-reviewer", "SKILL.md"),
      path.join(customPersonaDir, "SKILL.md")
    );

    const tmpConfig = path.join(tmpDir, "agentboot.config.json");
    fs.writeFileSync(
      tmpConfig,
      JSON.stringify({
        org: "test-org",
        personas: {
          enabled: ["code-reviewer"],
          customDir: path.join(tmpDir, "custom-personas"),
        },
        traits: { enabled: ["critical-thinking"] },
        instructions: { enabled: [] },
      })
    );

    try {
      const { output } = runValidateExpectFailRaw(`--config ${tmpConfig}`);
      // Must name the persona that has the bad reference
      expect(output).toContain("code-reviewer");
      // Must name the specific missing trait — this is the actionability test
      expect(output).toContain("completely-made-up-trait");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Prove that a missing agentboot.config.json produces an error that is actionable
  // (TP-15-1: missing config should suggest "agentboot install")
  it("missing config file: error output is actionable (not just 'file not found')", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-noconfig-msg-"));
    const missingConfig = path.join(emptyDir, "nonexistent-config.json");

    try {
      const { output } = runValidateExpectFailRaw(`--config ${missingConfig}`);
      // Error should communicate the problem in a way the user can act on
      expect(output.toLowerCase()).toMatch(/not found|does not exist|cannot|no such/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Domain layers (A.2) — validate must scan config-referenced domains/*
// Addresses gap: checkTraitReferences/checkSkillFrontmatter/checkNoSecrets
// previously ignored domain layers, so a domain passed validation vacuously.
// ---------------------------------------------------------------------------

describe("validate — domain layers (A.2)", () => {
  // Prove domain PERSONAS are scanned: a bad trait ref inside a domain persona
  // is caught and the error names both the domain persona and the missing trait.
  it("domain persona with an unknown trait ref is caught", () => {
    // realpath the tmp dir so the compiler's boundary check (which compares a
    // realpath'd domain path against a non-realpath'd configDir) matches on
    // macOS, where os.tmpdir() lives under a /var → /private/var symlink.
    const tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-domain-badtrait-"))
    );
    const personaDir = path.join(tmpDir, "domains", "test-domain", "personas", "dana-durability");
    fs.mkdirSync(personaDir, { recursive: true });
    fs.writeFileSync(
      path.join(personaDir, "persona.config.json"),
      JSON.stringify({
        name: "Dana Durability",
        description: "Domain persona for the A.2 negative test",
        invocation: "/dana",
        traits: ["nonexistent-domain-trait"],
      })
    );
    // Copy a real SKILL.md so the frontmatter check is not what fails.
    fs.copyFileSync(
      path.join(__dirname, "..", "core", "personas", "code-reviewer", "SKILL.md"),
      path.join(personaDir, "SKILL.md")
    );

    const tmpConfig = path.join(tmpDir, "agentboot.config.json");
    fs.writeFileSync(
      tmpConfig,
      JSON.stringify({
        org: "test-org",
        personas: { enabled: [] },
        instructions: { enabled: [] },
        domains: ["./domains/test-domain"],
      })
    );

    try {
      const { output } = runValidateExpectFailRaw(`--config ${tmpConfig}`);
      expect(output).toContain("dana-durability");
      expect(output).toContain("nonexistent-domain-trait");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Prove domain TRAITS join the resolution pool: a domain persona referencing a
  // domain-local trait validates cleanly (would ERROR if domain traits were ignored).
  it("domain persona referencing a valid domain-local trait passes", () => {
    const tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-domain-ok-"))
    );
    const domainDir = path.join(tmpDir, "domains", "test-domain");
    const traitsDir = path.join(domainDir, "traits");
    const personaDir = path.join(domainDir, "personas", "sam-simplicity");
    fs.mkdirSync(traitsDir, { recursive: true });
    fs.mkdirSync(personaDir, { recursive: true });
    fs.writeFileSync(
      path.join(traitsDir, "domain-only-trait.md"),
      "# Trait: Domain Only\n\nA domain-local trait used only by this domain's personas.\n"
    );
    fs.writeFileSync(
      path.join(personaDir, "persona.config.json"),
      JSON.stringify({
        name: "Sam Simplicity",
        description: "Domain persona for the A.2 positive test",
        invocation: "/sam",
        traits: ["domain-only-trait"],
      })
    );
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      "---\nname: sam-simplicity\ndescription: Domain persona for the A.2 positive test\n---\n\n# Sam\n"
    );

    const tmpConfig = path.join(tmpDir, "agentboot.config.json");
    fs.writeFileSync(
      tmpConfig,
      JSON.stringify({
        org: "test-org",
        personas: { enabled: [] },
        instructions: { enabled: [] },
        domains: ["./domains/test-domain"],
      })
    );

    try {
      const output = runValidateRaw(`--config ${tmpConfig}`);
      expect(output).toContain("passed");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------

function walkDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, extensions));
    } else if (extensions.some((ext) => full.endsWith(ext))) {
      results.push(full);
    }
  }

  return results;
}
