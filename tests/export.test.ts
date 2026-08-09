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

// ---------------------------------------------------------------------------
// R4-5 — "✓ Exported 0 skill(s)" was a green tick over an empty deliverable
// ---------------------------------------------------------------------------

/**
 * `generateSkillsIndex` reads `dist/skill/core/`, and `skill` is one of ten
 * output formats. On a hub that does not build it, `agentboot export --format
 * agentskills` printed, in order, unpiped:
 *
 *     "No dist/skill/core/ found. Run: agentboot build"      <- wrong advice;
 *                                                               the build had
 *                                                               just succeeded
 *     "✓ Exported 0 skill(s) to <path>"                      <- green
 *     "  Submit this file to agentskills.io for directory listing."
 *     EXPORT_EXIT=0
 *
 * — and wrote a well-formed index carrying `"skills": []` for the operator to
 * submit to a public directory. A skip reading as a pass, with the tick and the
 * next-step instruction both attached to a deliverable containing nothing.
 */
describe("R4-5 — an empty agentskills export is a refusal, not a tick", () => {
  async function mkHub(outputFormats: string[], withSkillTree: boolean): Promise<string> {
    const hub = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r4-export-")));
    const cfg = { org: "acme", personas: { enabled: ["alpha"], outputFormats } };
    fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify(cfg));
    fs.writeFileSync(path.join(hub, "package.json"), JSON.stringify({ name: "h", version: "1.0.0" }));
    if (withSkillTree) {
      const d = path.join(hub, "dist", "skill", "core", "alpha");
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "SKILL.md"), "---\ndescription: alpha\n---\n\n# alpha\n");
    } else {
      fs.mkdirSync(path.join(hub, "dist", "claude"), { recursive: true });
    }
    // `export` is a GATED dist/ consumer. Without a valid stamp the freshness
    // gate refuses first and every assertion below would pass for the wrong
    // reason — which is exactly what a bare exit-code check cannot tell apart.
    const { computeConfigDigest, computeSourceDigest, resolveDomainRoots, writeDistStamp } =
      await import("../scripts/lib/dist-stamp.js");
    writeDistStamp(path.join(hub, "dist"), {
      status: "success",
      configDigest: computeConfigDigest(cfg),
      sourceDigest: computeSourceDigest(hub, resolveDomainRoots(hub, cfg)),
      outputFormats,
      builtAt: new Date().toISOString(),
      agentbootVersion: "test",
    });
    return hub;
  }

  function exportRun(hub: string): { status: number; out: string; err: string } {
    try {
      const out = execSync(
        `npx tsx ${path.join(ROOT, "scripts", "cli.ts")} export --format agentskills ` +
          `--output ${path.join(hub, "out", "skills-index.json")}`,
        { cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" }, timeout: 60_000, stdio: "pipe" },
      ).toString();
      return { status: 0, out, err: "" };
    } catch (e: unknown) {
      const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { status: err.status ?? 1, out: err.stdout?.toString() ?? "", err: err.stderr?.toString() ?? "" };
    }
  }

  it("a hub without `skill` in outputFormats exits NON-ZERO and names the real cause", async () => {
    const r = exportRun(await mkHub(["claude", "copilot"], false));
    expect(r.status, "an empty listing must not exit 0").not.toBe(0);
    // Not just non-zero — non-zero FOR THIS REASON. A bare exit-code assertion
    // would pass on any unrelated failure (a missing config, a stale dist/).
    expect(r.err).toContain("Exported 0 skill(s)");
    expect(r.err, "the operator must be told which knob is wrong").toContain("personas.outputFormats");
    expect(r.out, "the green tick must be gone, not merely accompanied").not.toContain("✓ Exported");
    expect(r.out).not.toContain("Submit this file");
  });

  it("a hub that DOES compile skills still exports and exits 0 — no new false refusal", async () => {
    const hub = await mkHub(["skill", "claude"], true);
    const r = exportRun(hub);
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain("✓ Exported 1 skill(s)");
    const index = JSON.parse(fs.readFileSync(path.join(hub, "out", "skills-index.json"), "utf-8"));
    expect(index.skills).toHaveLength(1);
  });
});
