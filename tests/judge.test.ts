/**
 * AB-156: LLM-as-Judge evaluation framework tests.
 *
 * Tests the judge library: test case loading, prompt construction,
 * response parsing, cost estimation, and score validation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadJudgeTestCases,
  buildJudgePrompt,
  parseJudgeResponse,
  estimateJudgeCost,
  printJudgeResults,
  type JudgeTestCase,
  type JudgeResult,
  type JudgeOptions,
} from "../scripts/lib/judge.js";

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Temp directory for isolated test case loading
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-judge-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadJudgeTestCases
// ---------------------------------------------------------------------------

describe("loadJudgeTestCases", () => {
  it("returns empty array when judge/ directory does not exist", () => {
    const result = loadJudgeTestCases(path.join(tmpDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("loads JSON test cases from tests/judge/", () => {
    const result = loadJudgeTestCases(path.join(ROOT, "tests"));
    expect(result.length).toBeGreaterThanOrEqual(2);

    const sqlCase = result.find((tc) => tc.input.includes("SELECT"));
    expect(sqlCase).toBeDefined();
    expect(sqlCase!.persona).toBe("code-reviewer");
    expect(sqlCase!.ground_truth.must_find).toBeDefined();
    expect(sqlCase!.ground_truth.must_find!.length).toBeGreaterThan(0);
    expect(sqlCase!.ground_truth.must_find![0]!.topic).toBe("sql-injection");
  });

  it("loads JSON test cases from a custom directory", () => {
    const judgeDir = path.join(tmpDir, "custom-tests", "judge");
    fs.mkdirSync(judgeDir, { recursive: true });
    fs.writeFileSync(
      path.join(judgeDir, "test-case.json"),
      JSON.stringify({
        persona: "test-persona",
        input: "test input",
        ground_truth: {
          must_find: [{ severity: "ERROR", topic: "test-topic" }],
        },
      }),
    );

    const result = loadJudgeTestCases(path.join(tmpDir, "custom-tests"));
    expect(result).toHaveLength(1);
    expect(result[0]!.persona).toBe("test-persona");
  });

  it("skips invalid JSON files gracefully", () => {
    const judgeDir = path.join(tmpDir, "bad-json", "judge");
    fs.mkdirSync(judgeDir, { recursive: true });
    fs.writeFileSync(path.join(judgeDir, "bad.json"), "not json at all");

    const result = loadJudgeTestCases(path.join(tmpDir, "bad-json"));
    expect(result).toEqual([]);
  });

  it("ignores files without .json, .yaml, or .yml extension", () => {
    const judgeDir = path.join(tmpDir, "mixed-files", "judge");
    fs.mkdirSync(judgeDir, { recursive: true });
    fs.writeFileSync(path.join(judgeDir, "readme.txt"), "not a test case");
    fs.writeFileSync(
      path.join(judgeDir, "valid.json"),
      JSON.stringify({
        persona: "reviewer",
        input: "code",
        ground_truth: { must_find: [] },
      }),
    );

    const result = loadJudgeTestCases(path.join(tmpDir, "mixed-files"));
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildJudgePrompt
// ---------------------------------------------------------------------------

describe("buildJudgePrompt", () => {
  const testCase: JudgeTestCase = {
    persona: "code-reviewer",
    input: "Review this code:\n```ts\nconst x = 1;\n```",
    ground_truth: {
      must_find: [{ severity: "WARN", topic: "unused-variable" }],
      must_not_find: [{ topic: "security" }],
    },
  };

  it("includes persona name in prompt", () => {
    const prompt = buildJudgePrompt(testCase, "Found unused variable x.");
    expect(prompt).toContain("PERSONA: code-reviewer");
  });

  it("includes the developer input", () => {
    const prompt = buildJudgePrompt(testCase, "Found unused variable x.");
    expect(prompt).toContain("const x = 1;");
  });

  it("includes the actual persona response", () => {
    const output = "Found unused variable x at line 1.";
    const prompt = buildJudgePrompt(testCase, output);
    expect(prompt).toContain("PERSONA RESPONSE:");
    expect(prompt).toContain(output);
  });

  it("includes ground truth as JSON", () => {
    const prompt = buildJudgePrompt(testCase, "output");
    expect(prompt).toContain('"must_find"');
    expect(prompt).toContain("unused-variable");
    expect(prompt).toContain('"must_not_find"');
  });

  it("includes all 5 scoring dimensions", () => {
    const prompt = buildJudgePrompt(testCase, "output");
    expect(prompt).toContain("ACCURACY");
    expect(prompt).toContain("PRECISION");
    expect(prompt).toContain("RECALL");
    expect(prompt).toContain("SPECIFICITY");
    expect(prompt).toContain("ACTIONABILITY");
  });

  it("requests JSON-only response format", () => {
    const prompt = buildJudgePrompt(testCase, "output");
    expect(prompt).toContain("Respond with JSON only");
  });
});

// ---------------------------------------------------------------------------
// parseJudgeResponse
// ---------------------------------------------------------------------------

describe("parseJudgeResponse", () => {
  it("parses a valid JSON response", () => {
    const response = JSON.stringify({
      scores: {
        accuracy: 4,
        precision: 5,
        recall: 3,
        specificity: 4,
        actionability: 5,
      },
      overall: 4.2,
      rationale: {
        accuracy: "Correctly identified the SQL injection.",
        precision: "No false positives.",
        recall: "Found all must_find items.",
        specificity: "Pointed to exact location.",
        actionability: "Clear fix recommendation.",
      },
      failedMustFind: [],
      falsePrecisions: [],
    });

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.accuracy).toBe(4);
    expect(result!.scores.precision).toBe(5);
    expect(result!.scores.recall).toBe(3);
    expect(result!.overall).toBe(4.2);
    expect(result!.rationale["accuracy"]).toContain("SQL injection");
  });

  it("extracts JSON from surrounding text", () => {
    const response = `Here is my evaluation:
{
  "scores": { "accuracy": 3, "precision": 3, "recall": 3, "specificity": 3, "actionability": 3 },
  "overall": 3.0,
  "rationale": {},
  "failedMustFind": [],
  "falsePrecisions": []
}
That's my assessment.`;

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.accuracy).toBe(3);
  });

  it("returns null for completely invalid input", () => {
    expect(parseJudgeResponse("not json at all")).toBeNull();
  });

  it("returns null when scores object is missing", () => {
    const response = JSON.stringify({ rationale: {}, overall: 3 });
    expect(parseJudgeResponse(response)).toBeNull();
  });

  it("returns null when accuracy is not a number", () => {
    const response = JSON.stringify({
      scores: { accuracy: "high", precision: 3, recall: 3, specificity: 3, actionability: 3 },
    });
    expect(parseJudgeResponse(response)).toBeNull();
  });

  it("clamps scores above 5 down to 5", () => {
    const response = JSON.stringify({
      scores: {
        accuracy: 7,
        precision: 3,
        recall: 3,
        specificity: 3,
        actionability: 3,
      },
      overall: 3.8,
      rationale: {},
      failedMustFind: [],
      falsePrecisions: [],
    });

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.accuracy).toBe(5);
  });

  it("clamps scores below 1 up to 1", () => {
    const response = JSON.stringify({
      scores: {
        accuracy: -1,
        precision: 0,
        recall: 3,
        specificity: 3,
        actionability: 3,
      },
      overall: 2.0,
      rationale: {},
      failedMustFind: [],
      falsePrecisions: [],
    });

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.accuracy).toBe(1);
    expect(result!.scores.precision).toBe(1);
  });

  it("rounds fractional scores to nearest integer", () => {
    const response = JSON.stringify({
      scores: {
        accuracy: 3.7,
        precision: 2.2,
        recall: 4.5,
        specificity: 1.4,
        actionability: 3,
      },
      overall: 2.9,
      rationale: {},
      failedMustFind: [],
      falsePrecisions: [],
    });

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.accuracy).toBe(4);
    expect(result!.scores.precision).toBe(2);
    expect(result!.scores.recall).toBe(5);
    expect(result!.scores.specificity).toBe(1);
  });

  it("recalculates overall as average of 5 dimensions", () => {
    const response = JSON.stringify({
      scores: {
        accuracy: 5,
        precision: 5,
        recall: 5,
        specificity: 5,
        actionability: 5,
      },
      overall: 1, // wrong overall — should be recalculated
      rationale: {},
      failedMustFind: [],
      falsePrecisions: [],
    });

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.overall).toBe(5.0);
  });

  it("defaults failedMustFind and falsePrecisions to empty arrays", () => {
    const response = JSON.stringify({
      scores: {
        accuracy: 3,
        precision: 3,
        recall: 3,
        specificity: 3,
        actionability: 3,
      },
      overall: 3,
      rationale: {},
    });

    const result = parseJudgeResponse(response);
    expect(result).not.toBeNull();
    expect(result!.failedMustFind).toEqual([]);
    expect(result!.falsePrecisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// estimateJudgeCost
// ---------------------------------------------------------------------------

describe("estimateJudgeCost", () => {
  it("returns zero cost for zero test cases", () => {
    const result = estimateJudgeCost([]);
    expect(result.totalUsd).toBe(0);
    expect(result.breakdown).toContain("0 cases");
  });

  it("returns a positive cost for test cases", () => {
    const testCases: JudgeTestCase[] = [
      {
        persona: "code-reviewer",
        input: "test",
        ground_truth: { must_find: [] },
      },
    ];
    const result = estimateJudgeCost(testCases);
    expect(result.totalUsd).toBeGreaterThan(0);
    expect(result.breakdown).toContain("1 cases");
  });

  it("scales linearly with test case count", () => {
    const oneCase: JudgeTestCase[] = [
      { persona: "a", input: "x", ground_truth: {} },
    ];
    const threeCases: JudgeTestCase[] = [
      { persona: "a", input: "x", ground_truth: {} },
      { persona: "b", input: "y", ground_truth: {} },
      { persona: "c", input: "z", ground_truth: {} },
    ];

    const costOne = estimateJudgeCost(oneCase);
    const costThree = estimateJudgeCost(threeCases);
    // Allow rounding tolerance
    expect(Math.abs(costThree.totalUsd - costOne.totalUsd * 3)).toBeLessThan(0.02);
  });

  it("breakdown includes Sonnet and Opus references", () => {
    const testCases: JudgeTestCase[] = [
      { persona: "a", input: "x", ground_truth: {} },
    ];
    const result = estimateJudgeCost(testCases);
    expect(result.breakdown).toContain("Sonnet");
    expect(result.breakdown).toContain("Opus");
  });
});

// ---------------------------------------------------------------------------
// printJudgeResults (smoke test — just verify it doesn't throw)
// ---------------------------------------------------------------------------

describe("printJudgeResults", () => {
  it("prints without throwing for passing results", () => {
    const results: JudgeResult[] = [
      {
        testCase: "code-reviewer-sql-injection",
        persona: "code-reviewer",
        scores: { accuracy: 5, precision: 5, recall: 5, specificity: 4, actionability: 5 },
        overall: 4.8,
        rationale: { accuracy: "good" },
        failedMustFind: [],
        falsePrecisions: [],
        passed: true,
      },
    ];
    const options: JudgeOptions = { verbose: false, minScore: 3.0 };

    expect(() => printJudgeResults(results, options)).not.toThrow();
  });

  it("prints without throwing for failing results", () => {
    const results: JudgeResult[] = [
      {
        testCase: "security-reviewer-hardcoded-secret",
        persona: "security-reviewer",
        scores: { accuracy: 2, precision: 1, recall: 2, specificity: 2, actionability: 2 },
        overall: 1.8,
        rationale: { accuracy: "missed the secret", precision: "many false positives" },
        failedMustFind: ["hardcoded-secret"],
        falsePrecisions: ["endpoint-validation"],
        passed: false,
      },
    ];
    const options: JudgeOptions = { verbose: true, minScore: 3.0 };

    expect(() => printJudgeResults(results, options)).not.toThrow();
  });
});
