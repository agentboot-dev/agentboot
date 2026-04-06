/**
 * AgentBoot LLM-as-Judge evaluation framework.
 *
 * AB-156: 5-dimension scoring (Accuracy, Precision, Recall, Specificity, Actionability)
 * using Opus as the judge model to evaluate persona output quality.
 *
 * Each dimension is scored 1-5. Test cases define ground truth (must_find / must_not_find)
 * and the judge evaluates how well the persona response matches.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JudgeTestCase {
  persona: string;
  input: string;
  ground_truth: {
    must_find?: Array<{
      severity: string;
      topic: string;
      location_hint?: string;
    }>;
    must_not_find?: Array<{
      topic: string;
    }>;
  };
  dimensions_focus?: string[];
  model?: string;
}

export interface JudgeScores {
  accuracy: number;
  precision: number;
  recall: number;
  specificity: number;
  actionability: number;
}

export interface JudgeResult {
  testCase: string;
  persona: string;
  scores: JudgeScores;
  overall: number;
  rationale: Record<string, string>;
  failedMustFind: string[];
  falsePrecisions: string[];
  passed: boolean;
}

export interface JudgeOptions {
  verbose?: boolean;
  dryRun?: boolean;
  ci?: boolean;
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Test case loading
// ---------------------------------------------------------------------------

export function loadJudgeTestCases(testsDir: string): JudgeTestCase[] {
  const judgeDir = path.join(testsDir, "judge");
  if (!fs.existsSync(judgeDir)) {
    return [];
  }

  const files = fs
    .readdirSync(judgeDir)
    .filter(
      (f) =>
        f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"),
    );

  const testCases: JudgeTestCase[] = [];

  for (const file of files) {
    const filePath = path.join(judgeDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    try {
      if (file.endsWith(".json")) {
        const parsed = JSON.parse(content) as JudgeTestCase;
        if (parsed && parsed.persona && parsed.input) {
          testCases.push(parsed);
        }
      } else {
        const parsed = yaml.load(content) as JudgeTestCase;
        if (parsed && parsed.persona && parsed.input) {
          testCases.push(parsed);
        }
      }
    } catch (err) {
      console.log(
        chalk.yellow(`  Warning: Failed to parse ${file}: ${err}`),
      );
    }
  }

  return testCases;
}

// ---------------------------------------------------------------------------
// Judge prompt construction
// ---------------------------------------------------------------------------

export function buildJudgePrompt(
  testCase: JudgeTestCase,
  actualOutput: string,
): string {
  return `You are an expert evaluator of AI code review quality. You will score a code review response on 5 dimensions.

PERSONA: ${testCase.persona}
INPUT (what the developer submitted):
${testCase.input}

PERSONA RESPONSE:
${actualOutput}

GROUND TRUTH:
${JSON.stringify(testCase.ground_truth, null, 2)}

Score each dimension 1-5:
1 = Very poor  2 = Poor  3 = Acceptable  4 = Good  5 = Excellent

ACCURACY (1-5): Did the persona correctly identify real issues from ground_truth.must_find?
PRECISION (1-5): Did the persona avoid false positives from ground_truth.must_not_find?
RECALL (1-5): Did the persona catch all required issues (not miss must_find items)?
SPECIFICITY (1-5): Were finding locations, severity levels, and context accurate?
ACTIONABILITY (1-5): Can a developer act on these findings without guessing?

Respond with JSON only, no other text:
{
  "scores": {
    "accuracy": <number>,
    "precision": <number>,
    "recall": <number>,
    "specificity": <number>,
    "actionability": <number>
  },
  "overall": <number>,
  "rationale": {
    "accuracy": "<string>",
    "precision": "<string>",
    "recall": "<string>",
    "specificity": "<string>",
    "actionability": "<string>"
  },
  "failedMustFind": [<strings of topics not found>],
  "falsePrecisions": [<strings of false positive topics>]
}`;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export function estimateJudgeCost(testCases: JudgeTestCase[]): {
  totalUsd: number;
  breakdown: string;
} {
  // Each test case requires:
  // 1. Persona invocation (~4000 input + ~2000 output tokens on Sonnet)
  // 2. Judge evaluation (~5000 input + ~1000 output tokens on Opus)
  const personaCostPerCase =
    (4000 / 1_000_000) * 3.0 + (2000 / 1_000_000) * 15.0; // Sonnet
  const judgeCostPerCase =
    (5000 / 1_000_000) * 15.0 + (1000 / 1_000_000) * 75.0; // Opus
  const totalPerCase = personaCostPerCase + judgeCostPerCase;
  const totalUsd = testCases.length * totalPerCase;

  return {
    totalUsd: Math.round(totalUsd * 100) / 100,
    breakdown: `${testCases.length} cases x ~$${totalPerCase.toFixed(3)}/case (Sonnet persona + Opus judge)`,
  };
}

// ---------------------------------------------------------------------------
// Result validation
// ---------------------------------------------------------------------------

export function parseJudgeResponse(responseText: string): {
  scores: JudgeScores;
  overall: number;
  rationale: Record<string, string>;
  failedMustFind: string[];
  falsePrecisions: string[];
} | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch?.[0]) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      scores?: Record<string, unknown>;
      overall?: number;
      rationale?: Record<string, string>;
      failedMustFind?: string[];
      falsePrecisions?: string[];
    };

    if (
      !parsed.scores ||
      typeof parsed.scores["accuracy"] !== "number"
    )
      return null;

    // Validate and clamp scores to range 1-5
    const dimensionKeys: Array<keyof JudgeScores> = [
      "accuracy",
      "precision",
      "recall",
      "specificity",
      "actionability",
    ];

    const scores: JudgeScores = {
      accuracy: 1,
      precision: 1,
      recall: 1,
      specificity: 1,
      actionability: 1,
    };

    for (const key of dimensionKeys) {
      const raw = parsed.scores[key];
      if (typeof raw === "number") {
        scores[key] = Math.max(1, Math.min(5, Math.round(raw)));
      }
    }

    // Calculate overall as average
    const overall =
      (scores.accuracy +
        scores.precision +
        scores.recall +
        scores.specificity +
        scores.actionability) /
      5;

    return {
      scores,
      overall: Math.round(overall * 10) / 10,
      rationale: parsed.rationale ?? {},
      failedMustFind: parsed.failedMustFind ?? [],
      falsePrecisions: parsed.falsePrecisions ?? [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

export function printJudgeResults(
  results: JudgeResult[],
  options: JudgeOptions,
): void {
  console.log(chalk.bold(`\nLLM-as-Judge Results:\n`));

  let passed = 0;
  let failed = 0;
  const minScore = options.minScore ?? 3.0;

  for (const result of results) {
    const icon = result.passed ? chalk.green("PASS") : chalk.red("FAIL");
    const scoreStr = `${result.overall.toFixed(1)}/5`;
    const dims = `[accuracy:${result.scores.accuracy} precision:${result.scores.precision} recall:${result.scores.recall} specificity:${result.scores.specificity} action:${result.scores.actionability}]`;

    console.log(
      `  ${icon} ${result.testCase.padEnd(35)} ${scoreStr}  ${chalk.gray(dims)}`,
    );

    if (!result.passed) {
      // Show which dimensions failed
      for (const [dim, score] of Object.entries(result.scores)) {
        if ((score as number) < minScore) {
          console.log(
            chalk.yellow(
              `    WARN ${dim}:${score} — below threshold ${minScore}`,
            ),
          );
        }
      }
    }

    if (options.verbose && result.rationale) {
      for (const [dim, text] of Object.entries(result.rationale)) {
        console.log(chalk.gray(`    ${dim}: ${text}`));
      }
    }

    if (result.passed) passed++;
    else failed++;
  }

  console.log(
    `\n${passed} passed, ${failed} below threshold (>=${minScore} required).`,
  );

  if (options.verbose) {
    console.log(
      chalk.gray("\nRun without --verbose for compact output."),
    );
  } else {
    console.log(
      chalk.gray("\nRun with --verbose for per-dimension rationale."),
    );
  }
}
