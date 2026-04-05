/**
 * AB-162: agentskills.io listing export tests.
 *
 * Tests for the generateSkillsIndex() function and the CLI export command.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..");

function run(script: string, cwd = ROOT): string {
  return execSync(`npx tsx ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
  }).toString();
}

// ---------------------------------------------------------------------------
// Ensure dist/ is built before tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  const distSkill = path.join(ROOT, "dist", "skill", "core");
  if (!fs.existsSync(distSkill)) {
    run("scripts/compile.ts");
  }
});

// ---------------------------------------------------------------------------
// Unit tests for generateSkillsIndex
// ---------------------------------------------------------------------------

describe("AB-162: generateSkillsIndex()", () => {
  // We use dynamic import so the module resolves correctly under vitest/tsx
  async function getGenerator() {
    const mod = await import("../scripts/lib/export.js");
    return mod.generateSkillsIndex;
  }

  it("produces valid SkillsIndex with correct schema URL", async () => {
    const generateSkillsIndex = await getGenerator();
    const distPath = path.join(ROOT, "dist");
    const index = generateSkillsIndex(distPath, { org: "test-org" });

    expect(index.$schema).toBe("https://agentskills.io/schema/skills-index/v1.json");
    expect(index.generator).toBe("agentboot");
    expect(index.generatedAt).toBeTruthy();
    expect(new Date(index.generatedAt).getTime()).not.toBeNaN();
  });

  it("each entry has required fields", async () => {
    const generateSkillsIndex = await getGenerator();
    const distPath = path.join(ROOT, "dist");
    const index = generateSkillsIndex(distPath, {
      org: "test-org",
      orgDisplayName: "Test Organization",
      version: "1.2.3",
    });

    expect(index.skills.length).toBeGreaterThan(0);

    for (const skill of index.skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.invocation).toMatch(/^\//);
      expect(skill.version).toBe("1.2.3");
      expect(skill.author).toBe("Test Organization");
      expect(skill.platforms).toBeInstanceOf(Array);
      expect(skill.platforms.length).toBeGreaterThan(0);
      expect(skill.source).toContain("test-org");
      expect(skill.skillPath).toMatch(/^skill\/core\/.+\/SKILL\.md$/);
    }
  });

  it("picks up persona name and invocation from persona.config.json", async () => {
    const generateSkillsIndex = await getGenerator();
    const distPath = path.join(ROOT, "dist");
    const index = generateSkillsIndex(distPath, { org: "test-org" });

    const reviewer = index.skills.find(s => s.invocation === "/review-code");
    expect(reviewer).toBeDefined();
    expect(reviewer!.name).toBe("Code Reviewer");
  });

  it("returns empty skills array when dist/ does not exist", async () => {
    const generateSkillsIndex = await getGenerator();
    const fakeDist = path.join(os.tmpdir(), "agentboot-export-test-missing");

    const index = generateSkillsIndex(fakeDist, { org: "test-org" });

    expect(index.skills).toEqual([]);
    expect(index.$schema).toBe("https://agentskills.io/schema/skills-index/v1.json");
    expect(index.generator).toBe("agentboot");
  });

  it("returns empty skills array when dist/skill/core has no persona dirs", async () => {
    const generateSkillsIndex = await getGenerator();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-export-empty-"));
    const skillCore = path.join(tmpDir, "skill", "core");
    fs.mkdirSync(skillCore, { recursive: true });
    // Create a file (not a directory) — should be skipped
    fs.writeFileSync(path.join(skillCore, "README.md"), "# nothing\n");

    try {
      const index = generateSkillsIndex(tmpDir, { org: "test-org" });
      expect(index.skills).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses org name as author when orgDisplayName is not set", async () => {
    const generateSkillsIndex = await getGenerator();
    const distPath = path.join(ROOT, "dist");
    const index = generateSkillsIndex(distPath, { org: "my-org" });

    for (const skill of index.skills) {
      expect(skill.author).toBe("my-org");
    }
  });

  it("defaults version to 1.0.0 when not provided", async () => {
    const generateSkillsIndex = await getGenerator();
    const distPath = path.join(ROOT, "dist");
    const index = generateSkillsIndex(distPath, { org: "test-org" });

    for (const skill of index.skills) {
      expect(skill.version).toBe("1.0.0");
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration test
// ---------------------------------------------------------------------------

describe("AB-162: agentboot export CLI", () => {
  let outputPath: string;

  afterAll(() => {
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("agentboot export --format agentskills writes skills-index.json", () => {
    outputPath = path.join(os.tmpdir(), `agentboot-export-${Date.now()}.json`);
    const output = run(`scripts/cli.ts export --format agentskills --output ${outputPath}`);
    expect(output).toContain("Exported");
    expect(fs.existsSync(outputPath)).toBe(true);

    const index = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
    expect(index.$schema).toBe("https://agentskills.io/schema/skills-index/v1.json");
    expect(index.skills.length).toBeGreaterThan(0);
  });
});
