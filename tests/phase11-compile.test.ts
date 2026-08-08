/**
 * Phase 11 Batch 2: Compile fixes
 *
 * Tests for A1a (AGENTS.md instruction fallback), A1c (Gemini emitter),
 * A1e (Windsurf modern format), A1f (JetBrains rename), B2 (Cursor .mdc),
 * B4 (AGENTS.md full content).
 */

import { describe, it, expect, beforeAll } from "vitest";
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

beforeAll(() => {
  const distPath = path.join(ROOT, "dist");
  if (!fs.existsSync(distPath) || !fs.existsSync(path.join(distPath, "agents", "AGENTS.md"))) {
    run("scripts/compile.ts");
  }
});

// ---------------------------------------------------------------------------
// A1f: JetBrains .junie/AGENTS.md (renamed from guidelines.md)
// ---------------------------------------------------------------------------

describe("A1f: JetBrains .junie/AGENTS.md", () => {
  it(".junie/AGENTS.md exists in dist/jetbrains/core/", () => {
    expect(fs.existsSync(path.join(ROOT, "dist", "jetbrains", "core", ".junie", "AGENTS.md"))).toBe(true);
  });

  it(".junie/guidelines.md does NOT exist", () => {
    expect(fs.existsSync(path.join(ROOT, "dist", "jetbrains", "core", ".junie", "guidelines.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B2: Cursor instructions compiled as .mdc with alwaysApply
// ---------------------------------------------------------------------------

describe("B2: Cursor instruction .mdc format", () => {
  const cursorRulesDir = path.join(ROOT, "dist", "cursor", "core", "rules");

  it("cursor rules directory has .mdc files for instructions", () => {
    const files = fs.readdirSync(cursorRulesDir);
    const mdcFiles = files.filter(f => f.endsWith(".mdc"));
    // Should have instruction files as .mdc (baseline, security, agentboot-authoring)
    expect(mdcFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("cursor .mdc files have alwaysApply true XOR globs", () => {
    // Renamed from "…have alwaysApply: true" (F-6). The old title documented the
    // defect as intended behaviour: `alwaysApply: true` was hardcoded for every
    // instruction, so a rule authored `applyTo: "src/api/**"` shipped always-on.
    // A scoped rule now carries globs + alwaysApply:false; an always-on one
    // carries alwaysApply:true and no globs. The two are mutually exclusive.
    const files = fs.readdirSync(cursorRulesDir).filter(f => f.endsWith(".mdc"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(cursorRulesDir, file), "utf-8");
      if (!content.includes("alwaysApply:")) continue;
      expect(content).toMatch(/alwaysApply: (true|false)/);
      const alwaysOn = /alwaysApply: true/.test(content);
      const hasGlobs = /^globs:/m.test(content);
      expect(alwaysOn && hasGlobs, `${file}: globs and alwaysApply:true must not coexist`).toBe(false);
    }
  });

  it("no .md instruction files in cursor rules (should be .mdc)", () => {
    const files = fs.readdirSync(cursorRulesDir);
    const mdInstructionFiles = files.filter(f =>
      f.endsWith(".instructions.md") && !f.endsWith(".mdc")
    );
    expect(mdInstructionFiles.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A1e: Windsurf modern .windsurf/rules/ format
// ---------------------------------------------------------------------------

describe("A1e: Windsurf modern rules format", () => {
  it(".windsurf/rules/ directory exists with .md files", () => {
    const windsurfRulesDir = path.join(ROOT, "dist", "windsurf", "core", ".windsurf", "rules");
    expect(fs.existsSync(windsurfRulesDir)).toBe(true);
    const files = fs.readdirSync(windsurfRulesDir).filter(f => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("windsurf rules have trigger: frontmatter", () => {
    const windsurfRulesDir = path.join(ROOT, "dist", "windsurf", "core", ".windsurf", "rules");
    const files = fs.readdirSync(windsurfRulesDir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(windsurfRulesDir, file), "utf-8");
      expect(content).toContain("trigger:");
    }
  });

  it("legacy .windsurfrules still exists", () => {
    const rulesPath = path.join(ROOT, "dist", "windsurf", "core", ".windsurfrules");
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it(".windsurfrules contains instruction content (was previously missing)", () => {
    const rulesPath = path.join(ROOT, "dist", "windsurf", "core", ".windsurfrules");
    const content = fs.readFileSync(rulesPath, "utf-8");
    // Should contain content from instructions (baseline, security, etc.)
    expect(content.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// A1c: Gemini emitter — no .gemini/rules/, uses subdirectory GEMINI.md
// ---------------------------------------------------------------------------

describe("A1c: Gemini emitter rewrite", () => {
  it("dist/gemini/core/rules/ does NOT exist", () => {
    const rulesDir = path.join(ROOT, "dist", "gemini", "core", "rules");
    expect(fs.existsSync(rulesDir)).toBe(false);
  });

  it("GEMINI.md exists in dist/gemini/core/", () => {
    const geminiMd = path.join(ROOT, "dist", "gemini", "core", "GEMINI.md");
    expect(fs.existsSync(geminiMd)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B4: AGENTS.md has full instruction content, traits, and gotchas
// ---------------------------------------------------------------------------

describe("B4: AGENTS.md full content", () => {
  const agentsMdPath = path.join(ROOT, "dist", "agents", "AGENTS.md");

  it("AGENTS.md exists", () => {
    expect(fs.existsSync(agentsMdPath)).toBe(true);
  });

  it("AGENTS.md has full instruction content (not just one-line summaries)", () => {
    const content = fs.readFileSync(agentsMdPath, "utf-8");
    // Full content should have section headers from instructions
    expect(content).toContain("## Coding Conventions");
    // With B4 fix, instructions should have full content inlined, not just summaries
    // The baseline instructions should contain multi-paragraph content
    expect(content).toContain("Code Quality Principles");
    // Content should be substantial (>2000 chars in coding conventions)
    const afterConventions = content.split("## Coding Conventions")[1] ?? "";
    expect(afterConventions.length).toBeGreaterThan(2000);
  });

  it("AGENTS.md has Behavioral Traits section", () => {
    const content = fs.readFileSync(agentsMdPath, "utf-8");
    expect(content).toContain("## Behavioral Traits");
  });

  it("AGENTS.md has Agents section", () => {
    const content = fs.readFileSync(agentsMdPath, "utf-8");
    expect(content).toContain("## Agents");
    expect(content).toContain("code-reviewer");
  });
});
