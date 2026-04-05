/**
 * Tests for AB-154/AB-155: LLM-powered trait weight recommendations.
 *
 * Covers: weightToLabel, labelToWeight, buildRecommendationPrompt,
 * parseRecommendationResponse, printWeightDiff, applyWeightChanges.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  weightToLabel,
  labelToWeight,
  buildRecommendationPrompt,
  parseRecommendationResponse,
  printWeightDiff,
  applyWeightChanges,
  type WeightRecommendation,
} from "../scripts/lib/optimize-weights.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-weights-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRec(overrides: Partial<WeightRecommendation> = {}): WeightRecommendation {
  return {
    trait: "critical-thinking",
    current: "HIGH",
    recommended: "MEDIUM",
    rationale: "Too many false positives",
    ...overrides,
  };
}

// ===========================================================================
// weightToLabel
// ===========================================================================

describe("weightToLabel", () => {
  it("maps 0.0 to OFF", () => {
    expect(weightToLabel(0.0)).toBe("OFF");
  });

  it("maps 0.3 to LOW", () => {
    expect(weightToLabel(0.3)).toBe("LOW");
  });

  it("maps 0.5 to MEDIUM", () => {
    expect(weightToLabel(0.5)).toBe("MEDIUM");
  });

  it("maps 0.7 to HIGH", () => {
    expect(weightToLabel(0.7)).toBe("HIGH");
  });

  it("maps 1.0 to MAX", () => {
    expect(weightToLabel(1.0)).toBe("MAX");
  });

  it("returns numeric string for unknown weight (0.42)", () => {
    expect(weightToLabel(0.42)).toBe("0.42");
  });

  it("returns numeric string for negative weight", () => {
    expect(weightToLabel(-0.1)).toBe("-0.1");
  });
});

// ===========================================================================
// labelToWeight
// ===========================================================================

describe("labelToWeight", () => {
  it("maps HIGH to 0.7", () => {
    expect(labelToWeight("HIGH")).toBe(0.7);
  });

  it("maps OFF to 0.0", () => {
    expect(labelToWeight("OFF")).toBe(0.0);
  });

  it("maps LOW to 0.3", () => {
    expect(labelToWeight("LOW")).toBe(0.3);
  });

  it("maps MEDIUM to 0.5", () => {
    expect(labelToWeight("MEDIUM")).toBe(0.5);
  });

  it("maps MAX to 1.0", () => {
    expect(labelToWeight("MAX")).toBe(1.0);
  });

  it("handles case-insensitive input (off -> 0.0)", () => {
    expect(labelToWeight("off")).toBe(0.0);
  });

  it("handles mixed case input (High -> 0.7)", () => {
    expect(labelToWeight("High")).toBe(0.7);
  });

  it("returns 0.5 default for unknown label", () => {
    expect(labelToWeight("unknown")).toBe(0.5);
  });

  it("returns 0.5 default for empty string", () => {
    expect(labelToWeight("")).toBe(0.5);
  });
});

// ===========================================================================
// buildRecommendationPrompt
// ===========================================================================

describe("buildRecommendationPrompt", () => {
  it("includes persona ID in output", () => {
    const prompt = buildRecommendationPrompt(
      "code-reviewer",
      "Reviews code for quality",
      { "critical-thinking": "HIGH" },
      { "critical-thinking": "Challenges assumptions" },
      { invocations: 100, rephraseRate: 0.12, findings: { CRITICAL: 1, ERROR: 5 }, avgTokens: 8000 },
    );
    expect(prompt).toContain("code-reviewer");
  });

  it("includes trait weights in YAML format", () => {
    const prompt = buildRecommendationPrompt(
      "test-persona",
      "Test",
      { "source-citation": "MEDIUM", "structured-output": "HIGH" },
      {},
      { invocations: 10, rephraseRate: 0, findings: {}, avgTokens: 5000 },
    );
    expect(prompt).toContain("source-citation: MEDIUM");
    expect(prompt).toContain("structured-output: HIGH");
  });

  it("includes metrics with formatted rephrase rate", () => {
    const prompt = buildRecommendationPrompt(
      "test-persona",
      "Test",
      {},
      {},
      { invocations: 50, rephraseRate: 0.183, findings: { CRITICAL: 2, ERROR: 0, WARN: 3, INFO: 10 }, avgTokens: 6000 },
    );
    expect(prompt).toContain("18.3%");
    expect(prompt).toContain("Invocations: 50");
    expect(prompt).toContain("CRITICAL=2");
    expect(prompt).toContain("Average tokens per invocation: 6000");
  });

  it("includes trait definitions", () => {
    const prompt = buildRecommendationPrompt(
      "test-persona",
      "Test",
      {},
      { "critical-thinking": "Challenges assumptions and questions defaults" },
      { invocations: 1, rephraseRate: 0, findings: {}, avgTokens: 1000 },
    );
    expect(prompt).toContain("critical-thinking: Challenges assumptions and questions defaults");
  });

  it("includes JSON response format instructions", () => {
    const prompt = buildRecommendationPrompt(
      "test-persona",
      "Test",
      {},
      {},
      { invocations: 1, rephraseRate: 0, findings: {}, avgTokens: 1000 },
    );
    expect(prompt).toContain("Respond with JSON only");
    expect(prompt).toContain("recommendations");
  });
});

// ===========================================================================
// parseRecommendationResponse
// ===========================================================================

describe("parseRecommendationResponse", () => {
  it("extracts recommendations from valid JSON", () => {
    const json = JSON.stringify({
      recommendations: [
        { trait: "critical-thinking", current: "HIGH", recommended: "MEDIUM", rationale: "Too aggressive" },
      ],
      summary: "Reduce intensity",
      confidence: "HIGH",
    });

    const result = parseRecommendationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.recommendations[0]!.trait).toBe("critical-thinking");
    expect(result!.recommendations[0]!.current).toBe("HIGH");
    expect(result!.recommendations[0]!.recommended).toBe("MEDIUM");
    expect(result!.summary).toBe("Reduce intensity");
    expect(result!.confidence).toBe("HIGH");
  });

  it("extracts JSON embedded in prose text", () => {
    const text = `Here are my recommendations:

${JSON.stringify({
  recommendations: [
    { trait: "source-citation", current: "LOW", recommended: "HIGH", rationale: "Needs more rigor" },
  ],
  summary: "Increase citation",
  confidence: "MEDIUM",
})}

I hope this helps!`;

    const result = parseRecommendationResponse(text);
    expect(result).not.toBeNull();
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.recommendations[0]!.trait).toBe("source-citation");
  });

  it("returns null for empty input", () => {
    expect(parseRecommendationResponse("")).toBeNull();
  });

  it("returns null for plain text without JSON", () => {
    expect(parseRecommendationResponse("No JSON here at all")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseRecommendationResponse("{broken: json,}")).toBeNull();
  });

  it("returns null when recommendations array is missing", () => {
    const json = JSON.stringify({ summary: "No recs", confidence: "HIGH" });
    expect(parseRecommendationResponse(json)).toBeNull();
  });

  it("returns null when recommendations is not an array", () => {
    const json = JSON.stringify({ recommendations: "not-array", summary: "Bad", confidence: "HIGH" });
    expect(parseRecommendationResponse(json)).toBeNull();
  });

  it("defaults confidence to MEDIUM for invalid confidence value", () => {
    const json = JSON.stringify({
      recommendations: [
        { trait: "a", current: "HIGH", recommended: "LOW", rationale: "r" },
      ],
      summary: "s",
      confidence: "SUPER_HIGH",
    });

    const result = parseRecommendationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("MEDIUM");
  });

  it("defaults confidence to MEDIUM when confidence is missing", () => {
    const json = JSON.stringify({
      recommendations: [
        { trait: "a", current: "HIGH", recommended: "LOW", rationale: "r" },
      ],
      summary: "s",
    });

    const result = parseRecommendationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("MEDIUM");
  });

  it("filters out recommendations with missing required fields", () => {
    const json = JSON.stringify({
      recommendations: [
        { trait: "good", current: "HIGH", recommended: "LOW", rationale: "valid" },
        { trait: "bad-no-rationale", current: "HIGH", recommended: "LOW" },
        { current: "HIGH", recommended: "LOW", rationale: "no-trait" },
      ],
      summary: "s",
      confidence: "LOW",
    });

    const result = parseRecommendationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.recommendations).toHaveLength(1);
    expect(result!.recommendations[0]!.trait).toBe("good");
  });

  it("normalizes weight labels to uppercase", () => {
    const json = JSON.stringify({
      recommendations: [
        { trait: "a", current: "high", recommended: "low", rationale: "r" },
      ],
      summary: "s",
      confidence: "low",
    });

    const result = parseRecommendationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.recommendations[0]!.current).toBe("HIGH");
    expect(result!.recommendations[0]!.recommended).toBe("LOW");
    expect(result!.confidence).toBe("LOW");
  });

  it("defaults summary to empty string when missing", () => {
    const json = JSON.stringify({
      recommendations: [
        { trait: "a", current: "HIGH", recommended: "LOW", rationale: "r" },
      ],
      confidence: "HIGH",
    });

    const result = parseRecommendationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("");
  });
});

// ===========================================================================
// printWeightDiff
// ===========================================================================

describe("printWeightDiff", () => {
  it("does not throw for valid input", () => {
    expect(() => {
      printWeightDiff("code-reviewer", [makeRec()], "Summary text", "HIGH");
    }).not.toThrow();
  });

  it("does not throw for empty recommendations", () => {
    expect(() => {
      printWeightDiff("code-reviewer", [], "No changes", "LOW");
    }).not.toThrow();
  });

  it("does not throw when current equals recommended", () => {
    expect(() => {
      printWeightDiff("code-reviewer", [makeRec({ current: "HIGH", recommended: "HIGH" })], "Same", "MEDIUM");
    }).not.toThrow();
  });
});

// ===========================================================================
// applyWeightChanges
// ===========================================================================

describe("applyWeightChanges", () => {
  it("returns changed: false for non-existent config file", () => {
    const result = applyWeightChanges(path.join(tmpDir, "missing.json"), [makeRec()]);
    expect(result.changed).toBe(false);
    expect(result.diff).toContain("Config file not found");
  });

  it("returns changed: false with message when traits is an array", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ traits: ["critical-thinking", "source-citation"] }));

    const result = applyWeightChanges(configPath, [makeRec()]);
    expect(result.changed).toBe(false);
    expect(result.diff).toContain("Traits must be weight-object format");
  });

  it("returns changed: false when traits is missing entirely", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ name: "test" }));

    const result = applyWeightChanges(configPath, [makeRec()]);
    expect(result.changed).toBe(false);
    expect(result.diff).toContain("Traits must be weight-object format");
  });

  it("applies changes and writes updated config to disk", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    const config = {
      name: "code-reviewer",
      traits: { "critical-thinking": "HIGH", "source-citation": "MEDIUM" },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = applyWeightChanges(configPath, [
      makeRec({ trait: "critical-thinking", current: "HIGH", recommended: "MEDIUM" }),
    ]);

    expect(result.changed).toBe(true);
    expect(result.diff).toHaveLength(1);
    expect(result.diff[0]).toContain("critical-thinking");
    expect(result.diff[0]).toContain("HIGH");
    expect(result.diff[0]).toContain("MEDIUM");

    // Verify file was actually written
    const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(updated.traits["critical-thinking"]).toBe("MEDIUM");
    // Unmodified trait should remain
    expect(updated.traits["source-citation"]).toBe("MEDIUM");
  });

  it("skips recommendations where current equals recommended", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    const config = { traits: { "critical-thinking": "HIGH" } };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = applyWeightChanges(configPath, [
      makeRec({ trait: "critical-thinking", current: "HIGH", recommended: "HIGH" }),
    ]);

    expect(result.changed).toBe(false);
    expect(result.diff).toHaveLength(0);
  });

  it("skips recommendations for traits not present in config", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    const config = { traits: { "source-citation": "LOW" } };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = applyWeightChanges(configPath, [
      makeRec({ trait: "nonexistent-trait", current: "HIGH", recommended: "LOW" }),
    ]);

    expect(result.changed).toBe(false);
    expect(result.diff).toHaveLength(0);
  });

  it("applies multiple recommendations in one call", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    const config = {
      traits: { "critical-thinking": "HIGH", "source-citation": "LOW", "structured-output": "MEDIUM" },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = applyWeightChanges(configPath, [
      makeRec({ trait: "critical-thinking", current: "HIGH", recommended: "MEDIUM" }),
      makeRec({ trait: "source-citation", current: "LOW", recommended: "HIGH" }),
      makeRec({ trait: "structured-output", current: "MEDIUM", recommended: "MEDIUM" }), // no change
    ]);

    expect(result.changed).toBe(true);
    expect(result.diff).toHaveLength(2);

    const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(updated.traits["critical-thinking"]).toBe("MEDIUM");
    expect(updated.traits["source-citation"]).toBe("HIGH");
    expect(updated.traits["structured-output"]).toBe("MEDIUM"); // unchanged
  });

  it("preserves other config keys when writing changes", () => {
    const configPath = path.join(tmpDir, "persona.config.json");
    const config = {
      name: "test-persona",
      description: "A test persona",
      traits: { "critical-thinking": "HIGH" },
      other: { key: "value" },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    applyWeightChanges(configPath, [
      makeRec({ trait: "critical-thinking", current: "HIGH", recommended: "LOW" }),
    ]);

    const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(updated.name).toBe("test-persona");
    expect(updated.description).toBe("A test persona");
    expect(updated.other.key).toBe("value");
  });
});
