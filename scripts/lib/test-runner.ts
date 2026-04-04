/**
 * AgentBoot test runner — behavioral and snapshot testing for personas.
 *
 * AB-123: Behavioral testing — YAML test cases with claude -p assertions.
 * AB-124: Snapshot testing — detect persona drift across versions.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import chalk from "chalk";
import { type LLMProvider, ClaudeCodeProvider } from "./llm-provider.js";

// ---------------------------------------------------------------------------
// AB-123: Behavioral test types and runner
// ---------------------------------------------------------------------------

export interface BehavioralTestCase {
  name: string;
  persona: string;
  prompt: string;
  assertions: Array<{
    type: "contains" | "not-contains" | "regex";
    value: string;
  }>;
  /** Number of retries for flake tolerance. Default: 3 (pass 2-of-3). */
  retries?: number;
}

export interface BehavioralTestResult {
  name: string;
  persona: string;
  passed: boolean;
  attempts: number;
  passes: number;
  failures: string[];
}

/**
 * Parse a YAML-like test case file (simplified YAML subset).
 * Supports the fields: name, persona, prompt, assertions[].
 */
export function parseTestCases(content: string): BehavioralTestCase[] {
  const cases: BehavioralTestCase[] = [];

  // Split by "---" test case separator
  const blocks = content.split(/^---$/m).filter(b => b.trim());

  for (const block of blocks) {
    const tc: Partial<BehavioralTestCase> = { assertions: [] };

    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^(\w+):\s*(.+)/);
      if (match) {
        const [, key, value] = match;
        switch (key) {
          case "name": tc.name = value!; break;
          case "persona": tc.persona = value!; break;
          case "prompt": tc.prompt = value!; break;
          case "retries": tc.retries = parseInt(value!, 10); break;
        }
      }

      // Assertion lines: "- contains: text" or "- not-contains: text" or "- regex: pattern"
      const assertMatch = trimmed.match(/^-\s*(contains|not-contains|regex):\s*(.+)/);
      if (assertMatch) {
        tc.assertions!.push({
          type: assertMatch[1] as "contains" | "not-contains" | "regex",
          value: assertMatch[2]!,
        });
      }
    }

    if (tc.name && tc.persona && tc.prompt && tc.assertions!.length > 0) {
      cases.push(tc as BehavioralTestCase);
    }
  }

  return cases;
}

/**
 * Evaluate assertions against LLM output.
 */
export function evaluateAssertions(
  output: string,
  assertions: BehavioralTestCase["assertions"],
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  for (const assertion of assertions) {
    switch (assertion.type) {
      case "contains":
        if (!output.toLowerCase().includes(assertion.value.toLowerCase())) {
          failures.push(`Expected output to contain "${assertion.value}"`);
        }
        break;
      case "not-contains":
        if (output.toLowerCase().includes(assertion.value.toLowerCase())) {
          failures.push(`Expected output NOT to contain "${assertion.value}"`);
        }
        break;
      case "regex": {
        const re = new RegExp(assertion.value, "i");
        if (!re.test(output)) {
          failures.push(`Expected output to match regex /${assertion.value}/i`);
        }
        break;
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Run a single behavioral test case with flake tolerance.
 * Passes if 2-of-N attempts succeed (default N=3).
 */
export function runBehavioralTest(
  testCase: BehavioralTestCase,
  provider: LLMProvider,
  distPath: string,
): BehavioralTestResult {
  const maxAttempts = testCase.retries ?? 3;
  const requiredPasses = Math.ceil(maxAttempts / 2) + (maxAttempts % 2 === 0 ? 1 : 0); // majority
  let passes = 0;
  let attempts = 0;
  const allFailures: string[] = [];

  // Load persona SKILL.md as system context
  const skillPath = path.join(distPath, "skill", "core", "personas", testCase.persona, "SKILL.md");
  let systemPrompt = "";
  if (fs.existsSync(skillPath)) {
    systemPrompt = fs.readFileSync(skillPath, "utf-8");
  }

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${testCase.prompt}`
      : testCase.prompt;

    const result = provider.classify(fullPrompt, "");
    const output = typeof result?.data === "string"
      ? result.data
      : JSON.stringify(result?.data ?? "");

    const evaluation = evaluateAssertions(output, testCase.assertions);
    if (evaluation.passed) {
      passes++;
      if (passes >= requiredPasses) break; // Early exit on sufficient passes
    } else {
      allFailures.push(`Attempt ${i + 1}: ${evaluation.failures.join("; ")}`);
    }
  }

  return {
    name: testCase.name,
    persona: testCase.persona,
    passed: passes >= requiredPasses,
    attempts,
    passes,
    failures: allFailures,
  };
}

/**
 * Run all behavioral tests from a directory.
 */
export function runBehavioralTests(
  testDir: string,
  distPath: string,
  provider?: LLMProvider,
): BehavioralTestResult[] {
  const results: BehavioralTestResult[] = [];
  const llm = provider ?? new ClaudeCodeProvider();

  if (!fs.existsSync(testDir)) {
    console.log(chalk.yellow(`  Test directory not found: ${testDir}`));
    return results;
  }

  const files = fs.readdirSync(testDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(testDir, file), "utf-8");
    const testCases = parseTestCases(content);

    for (const tc of testCases) {
      console.log(chalk.cyan(`  Running: ${tc.name} (${tc.persona})...`));
      const result = runBehavioralTest(tc, llm, distPath);
      results.push(result);

      if (result.passed) {
        console.log(chalk.green(`    ✓ Passed (${result.passes}/${result.attempts})`));
      } else {
        console.log(chalk.red(`    ✗ Failed (${result.passes}/${result.attempts})`));
        for (const f of result.failures) {
          console.log(chalk.gray(`      ${f}`));
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// AB-124: Snapshot testing — detect persona drift
// ---------------------------------------------------------------------------

export interface SnapshotEntry {
  path: string;
  hash: string;
  size: number;
}

export interface SnapshotBaseline {
  createdAt: string;
  version: string;
  entries: SnapshotEntry[];
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Create a snapshot of the dist/ directory.
 */
export function createSnapshot(distPath: string): SnapshotBaseline {
  const entries: SnapshotEntry[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        entries.push({
          path: path.relative(distPath, full).replace(/\\/g, "/"),
          hash: hashFile(full),
          size: stat.size,
        });
      }
    }
  }

  walk(distPath);
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    createdAt: new Date().toISOString(),
    version: "1",
    entries,
  };
}

/**
 * Compare current dist/ against a saved baseline.
 */
export function compareSnapshots(
  baseline: SnapshotBaseline,
  current: SnapshotBaseline,
): SnapshotDiff {
  const baseMap = new Map(baseline.entries.map(e => [e.path, e.hash]));
  const currMap = new Map(current.entries.map(e => [e.path, e.hash]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [p, hash] of currMap) {
    if (!baseMap.has(p)) {
      added.push(p);
    } else if (baseMap.get(p) !== hash) {
      changed.push(p);
    }
  }

  for (const p of baseMap.keys()) {
    if (!currMap.has(p)) {
      removed.push(p);
    }
  }

  return { added, removed, changed };
}

/**
 * Save a snapshot baseline to disk.
 */
export function saveSnapshot(baseline: SnapshotBaseline, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
}

/**
 * Load a snapshot baseline from disk.
 */
export function loadSnapshot(snapshotPath: string): SnapshotBaseline | null {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as SnapshotBaseline;
  } catch {
    return null;
  }
}

/**
 * Print a snapshot diff summary.
 */
export function printSnapshotDiff(diff: SnapshotDiff): void {
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    console.log(chalk.green("    ✓ No changes detected"));
    return;
  }

  if (diff.added.length > 0) {
    console.log(chalk.green(`    + ${diff.added.length} file(s) added`));
    for (const f of diff.added.slice(0, 10)) {
      console.log(chalk.gray(`      ${f}`));
    }
    if (diff.added.length > 10) console.log(chalk.gray(`      ... and ${diff.added.length - 10} more`));
  }

  if (diff.removed.length > 0) {
    console.log(chalk.red(`    - ${diff.removed.length} file(s) removed`));
    for (const f of diff.removed.slice(0, 10)) {
      console.log(chalk.gray(`      ${f}`));
    }
  }

  if (diff.changed.length > 0) {
    console.log(chalk.yellow(`    ~ ${diff.changed.length} file(s) changed`));
    for (const f of diff.changed.slice(0, 10)) {
      console.log(chalk.gray(`      ${f}`));
    }
    if (diff.changed.length > 10) console.log(chalk.gray(`      ... and ${diff.changed.length - 10} more`));
  }
}
