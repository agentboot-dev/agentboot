/**
 * Unit tests for validation logic.
 *
 * Tests config loading (JSONC stripping), persona existence checks,
 * trait reference checks, SKILL.md frontmatter parsing, and secret scanning.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripJsoncComments } from "../scripts/lib/config.js";
import {
  parseFrontmatter,
  scanForSecrets,
  DEFAULT_SECRET_PATTERNS,
} from "../scripts/lib/frontmatter.js";

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
      expect(Array.isArray(config.traits), `${persona} traits should be array`).toBe(true);
      expect(config.traits.length, `${persona} should have at least one trait`).toBeGreaterThan(0);
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
      for (const trait of config.traits ?? []) {
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
