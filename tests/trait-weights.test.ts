/**
 * AB-134: Trait weight system tests.
 *
 * Unit tests for weight resolution, trait normalization, and calibration preambles.
 * Integration tests for build output with weighted traits.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveWeight,
  normalizeTraitRefs,
  WEIGHT_MAP,
  DEFAULT_WEIGHT,
  VALID_WEIGHT_NAMES,
  traitRefsToNames,
} from "../scripts/lib/config.js";

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
// Unit: resolveWeight()
// ---------------------------------------------------------------------------

describe("resolveWeight", () => {
  it("returns DEFAULT_WEIGHT for undefined", () => {
    expect(resolveWeight(undefined)).toBe(DEFAULT_WEIGHT);
  });

  it("returns DEFAULT_WEIGHT for true", () => {
    expect(resolveWeight(true)).toBe(DEFAULT_WEIGHT);
  });

  it("returns 0.0 for false", () => {
    expect(resolveWeight(false)).toBe(0.0);
  });

  it("returns 0.0 for numeric 0", () => {
    expect(resolveWeight(0)).toBe(0.0);
  });

  it("returns 0.0 for OFF", () => {
    expect(resolveWeight("OFF")).toBe(0.0);
  });

  it("resolves all named weights", () => {
    expect(resolveWeight("OFF")).toBe(0.0);
    expect(resolveWeight("LOW")).toBe(0.3);
    expect(resolveWeight("MEDIUM")).toBe(0.5);
    expect(resolveWeight("HIGH")).toBe(0.7);
    expect(resolveWeight("MAX")).toBe(1.0);
  });

  it("is case-insensitive for named weights", () => {
    expect(resolveWeight("low")).toBe(0.3);
    expect(resolveWeight("High")).toBe(0.7);
    expect(resolveWeight("medium")).toBe(0.5);
  });

  it("returns DEFAULT_WEIGHT for unknown string", () => {
    expect(resolveWeight("INVALID")).toBe(DEFAULT_WEIGHT);
    expect(resolveWeight("foo")).toBe(DEFAULT_WEIGHT);
  });

  it("passes through valid numeric values", () => {
    expect(resolveWeight(0.3)).toBe(0.3);
    expect(resolveWeight(0.7)).toBe(0.7);
    expect(resolveWeight(1.0)).toBe(1.0);
  });

  it("clamps negative numbers to 0.0", () => {
    expect(resolveWeight(-0.5)).toBe(0.0);
    expect(resolveWeight(-1)).toBe(0.0);
  });

  it("clamps numbers above 1.0 to 1.0", () => {
    expect(resolveWeight(1.5)).toBe(1.0);
    expect(resolveWeight(100)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Unit: normalizeTraitRefs()
// ---------------------------------------------------------------------------

describe("normalizeTraitRefs", () => {
  it("handles array form — all get DEFAULT_WEIGHT", () => {
    const result = normalizeTraitRefs(["critical-thinking", "structured-output"]);
    expect(result).toEqual([
      { name: "critical-thinking", weight: DEFAULT_WEIGHT },
      { name: "structured-output", weight: DEFAULT_WEIGHT },
    ]);
  });

  it("handles empty array", () => {
    const result = normalizeTraitRefs([]);
    expect(result).toEqual([]);
  });

  it("handles object form with named weights", () => {
    const result = normalizeTraitRefs({
      "critical-thinking": "HIGH",
      "structured-output": "LOW",
    });
    expect(result).toEqual([
      { name: "critical-thinking", weight: 0.7 },
      { name: "structured-output", weight: 0.3 },
    ]);
  });

  it("handles object form with numeric weights", () => {
    const result = normalizeTraitRefs({
      "critical-thinking": 0.8,
      "structured-output": 0.2,
    });
    expect(result).toEqual([
      { name: "critical-thinking", weight: 0.8 },
      { name: "structured-output", weight: 0.2 },
    ]);
  });

  it("handles object form with boolean values", () => {
    const result = normalizeTraitRefs({
      "critical-thinking": true,
      "structured-output": false,
    });
    expect(result).toEqual([
      { name: "critical-thinking", weight: DEFAULT_WEIGHT },
      { name: "structured-output", weight: 0.0 },
    ]);
  });

  it("handles object form with OFF weight", () => {
    const result = normalizeTraitRefs({
      "critical-thinking": "OFF",
      "structured-output": "MEDIUM",
    });
    expect(result).toEqual([
      { name: "critical-thinking", weight: 0.0 },
      { name: "structured-output", weight: DEFAULT_WEIGHT },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Unit: traitRefsToNames()
// ---------------------------------------------------------------------------

describe("traitRefsToNames", () => {
  it("returns names from array form", () => {
    expect(traitRefsToNames(["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns keys from object form", () => {
    expect(traitRefsToNames({ a: "HIGH", b: "LOW" })).toEqual(["a", "b"]);
  });
});

import { buildWeightPreamble } from "../scripts/compile.js";

// ---------------------------------------------------------------------------
// Unit: buildWeightPreamble()
// ---------------------------------------------------------------------------

describe("buildWeightPreamble", () => {
  it("returns calibration text for an exact weight key (0.3)", () => {
    const result = buildWeightPreamble("critical-thinking", 0.3);
    expect(result).toContain("light scrutiny");
  });

  it("returns calibration text for an exact weight key (0.7)", () => {
    const result = buildWeightPreamble("critical-thinking", 0.7);
    expect(result).toContain("thorough scrutiny");
  });

  it("returns nearest calibration text for 0.4 (nearest is 0.5 or 0.3)", () => {
    const result = buildWeightPreamble("critical-thinking", 0.4);
    // 0.4 is equidistant from 0.3 and 0.5; nearest-neighbor picks the first one found
    // that has the smallest distance. Since keys are sorted [0.3, 0.5, 0.7, 1.0],
    // 0.3 is checked first with dist=0.1, then 0.5 with dist=0.1 (not strictly less).
    // So the result should be the 0.3 calibration text.
    expect(result).toContain("scrutiny");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty string for unknown trait", () => {
    const result = buildWeightPreamble("unknown-trait", 0.7);
    expect(result).toBe("");
  });

  it("returns empty string for DEFAULT_WEIGHT (0.5)", () => {
    const result = buildWeightPreamble("critical-thinking", DEFAULT_WEIGHT);
    expect(result).toBe("");
  });

  it("returns adversarial calibration for MAX weight (1.0)", () => {
    const result = buildWeightPreamble("critical-thinking", 1.0);
    expect(result).toContain("adversarial");
  });
});

// ---------------------------------------------------------------------------
// Integration: build with weight objects
// ---------------------------------------------------------------------------

describe("trait weight integration", () => {
  let tempDir: string;

  beforeAll(() => {
    // Use a dedicated temp directory to avoid conflicts with pipeline.test.ts
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-weights-"));
    const tempConfig = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(tempConfig, JSON.stringify({
      org: "test",
      personas: {
        enabled: ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"],
        outputFormats: ["skill"],
      },
      traits: {
        enabled: [
          "critical-thinking", "structured-output", "source-citation",
          "confidence-signaling", "audit-trail", "schema-awareness",
        ],
      },
      instructions: { enabled: [] },
    }));
    run(`scripts/compile.ts --config ${tempConfig}`);
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("security-reviewer SKILL.md has HIGH-weight critical-thinking with calibration preamble", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "security-reviewer", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    // Weight annotation in comment
    expect(content).toContain("<!-- trait: critical-thinking (weight: 0.7) -->");
    // Calibration preamble for HIGH (0.7)
    expect(content).toContain("Apply thorough scrutiny");
    // Closing tag
    expect(content).toContain("<!-- /trait: critical-thinking -->");
  });

  it("security-reviewer SKILL.md has confidence-signaling at HIGH weight", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "security-reviewer", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("<!-- trait: confidence-signaling (weight: 0.7) -->");
  });

  it("security-reviewer SKILL.md has MEDIUM traits without weight annotation", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "security-reviewer", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    // MEDIUM weight traits should have plain comments (no weight annotation)
    expect(content).toContain("<!-- trait: structured-output -->");
    expect(content).toContain("<!-- trait: source-citation -->");
    expect(content).toContain("<!-- trait: audit-trail -->");
  });

  it("code-reviewer SKILL.md has LOW-weight source-citation with calibration note", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "code-reviewer", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    // Weight annotation for LOW
    expect(content).toContain("<!-- trait: source-citation (weight: 0.3) -->");
  });

  it("code-reviewer SKILL.md has MEDIUM traits without weight annotation", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "code-reviewer", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("<!-- trait: critical-thinking -->");
    expect(content).toContain("<!-- trait: structured-output -->");
    expect(content).toContain("<!-- trait: confidence-signaling -->");
    expect(content).toContain("<!-- trait: schema-awareness -->");
  });

  it("test-generator backward compat — array format still works", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "test-generator", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    // Array format: all traits get MEDIUM, no weight annotations
    expect(content).toContain("<!-- trait: structured-output -->");
    expect(content).toContain("<!-- trait: schema-awareness -->");
    expect(content).toContain("<!-- trait: source-citation -->");
    // No weight annotations for array-format traits
    expect(content).not.toMatch(/<!-- trait: structured-output \(weight:/);
    expect(content).not.toMatch(/<!-- trait: schema-awareness \(weight:/);
    expect(content).not.toMatch(/<!-- trait: source-citation \(weight:/);
  });

  it("test-data-expert backward compat — array format still works", () => {
    const skillPath = path.join(tempDir, "dist", "skill", "core", "test-data-expert", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("<!-- trait: schema-awareness -->");
    expect(content).toContain("<!-- trait: structured-output -->");
    expect(content).toContain("<!-- trait: confidence-signaling -->");
  });

  it("OFF weight traits are excluded from output", () => {
    // Build with a custom config that uses a custom personas dir (avoids modifying real configs)
    const offDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-off-"));

    // Create a custom persona dir with OFF weight
    const customPersonaDir = path.join(offDir, "custom-personas", "code-reviewer");
    fs.mkdirSync(customPersonaDir, { recursive: true });
    fs.writeFileSync(path.join(customPersonaDir, "persona.config.json"), JSON.stringify({
      name: "Code Reviewer",
      description: "Test OFF weight",
      invocation: "/review-code",
      traits: {
        "critical-thinking": "OFF",
        "structured-output": "MEDIUM",
      },
    }));
    // Copy the real SKILL.md
    fs.copyFileSync(
      path.join(ROOT, "core", "personas", "code-reviewer", "SKILL.md"),
      path.join(customPersonaDir, "SKILL.md")
    );

    const offConfig = path.join(offDir, "agentboot.config.json");
    fs.writeFileSync(offConfig, JSON.stringify({
      org: "test",
      personas: {
        enabled: ["code-reviewer"],
        outputFormats: ["skill"],
        customDir: path.join(offDir, "custom-personas"),
      },
      traits: { enabled: ["critical-thinking", "structured-output", "source-citation", "confidence-signaling", "schema-awareness"] },
      instructions: { enabled: [] },
    }));

    try {
      run(`scripts/compile.ts --config ${offConfig}`);
      const skillPath = path.join(offDir, "dist", "skill", "core", "code-reviewer", "SKILL.md");
      const content = fs.readFileSync(skillPath, "utf-8");
      // OFF trait should NOT be injected (no trait comment marker)
      expect(content).not.toContain("<!-- trait: critical-thinking");
      expect(content).not.toContain("<!-- /trait: critical-thinking -->");
      // MEDIUM trait should appear
      expect(content).toContain("<!-- trait: structured-output -->");
    } finally {
      fs.rmSync(offDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Validation: weight value checking
// ---------------------------------------------------------------------------

describe("validate detects invalid weights", () => {
  it("rejects invalid weight string in persona config", () => {
    const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-badweight-"));

    // Create a custom persona dir with invalid weight (avoids modifying real configs)
    const customPersonaDir = path.join(badDir, "custom-personas", "code-reviewer");
    fs.mkdirSync(customPersonaDir, { recursive: true });
    fs.writeFileSync(path.join(customPersonaDir, "persona.config.json"), JSON.stringify({
      name: "Code Reviewer",
      description: "Test",
      traits: { "critical-thinking": "SUPER_HIGH" },
    }));
    // Copy the real SKILL.md so other checks pass
    fs.copyFileSync(
      path.join(ROOT, "core", "personas", "code-reviewer", "SKILL.md"),
      path.join(customPersonaDir, "SKILL.md")
    );

    const badConfig = path.join(badDir, "agentboot.config.json");
    fs.writeFileSync(badConfig, JSON.stringify({
      org: "test",
      personas: {
        enabled: ["code-reviewer"],
        customDir: path.join(badDir, "custom-personas"),
      },
      traits: { enabled: ["critical-thinking"] },
    }));

    try {
      const output = run(`scripts/validate.ts --config ${badConfig}`);
      expect.fail("Should have exited with error");
    } catch (err: any) {
      const output = err.stdout?.toString() ?? err.message;
      expect(output).toContain("invalid weight");
    } finally {
      fs.rmSync(badDir, { recursive: true, force: true });
    }
  });
});
