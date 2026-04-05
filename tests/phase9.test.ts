/**
 * Phase 9 integration tests.
 *
 * Tests for: AB-158 (JetBrains output format — Junie + AI Assistant)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

beforeAll(() => {
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
  // Clean up test gotcha files
  if (fs.existsSync(pathScopedGotcha)) fs.unlinkSync(pathScopedGotcha);
  if (fs.existsSync(generalGotcha)) fs.unlinkSync(generalGotcha);
});

// ---------------------------------------------------------------------------
// AB-158: JetBrains Junie output — .junie/guidelines.md
// ---------------------------------------------------------------------------

describe("AB-158: JetBrains Junie output", () => {
  it("generates .junie/guidelines.md in dist/jetbrains/core/", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "guidelines.md");
    expect(fs.existsSync(guidelinesPath)).toBe(true);
  });

  it("guidelines.md contains all persona names", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "guidelines.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    expect(content).toContain("Code Reviewer");
    expect(content).toContain("Security Reviewer");
    expect(content).toContain("Test Generator");
    expect(content).toContain("Test Data Expert");
  });

  it("guidelines.md has no trait injection markers", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "guidelines.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    expect(content).not.toContain("<!-- traits:");
  });

  it("guidelines.md has persona sections separated by ---", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "guidelines.md");
    const content = fs.readFileSync(guidelinesPath, "utf-8");
    // Multiple personas should be separated by --- dividers
    const separators = content.split("\n---\n").length - 1;
    expect(separators).toBeGreaterThanOrEqual(3); // At least 3 separators for 4 personas
  });

  it("guidelines.md starts with AgentBoot header", () => {
    const guidelinesPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "guidelines.md");
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

  it("compile output mentions 8 platforms", () => {
    const output = run("scripts/compile.ts");
    expect(output).toContain("8 platform(s)");
    expect(output).toContain("dist/jetbrains/");
  });
});
