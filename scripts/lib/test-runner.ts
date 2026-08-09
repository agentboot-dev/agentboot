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
import yaml from "js-yaml";
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
    /** The `expect:` key this assertion was derived from, for the report. */
    from?: string;
  }>;
  /** Number of retries for flake tolerance. Default: 3 (pass 2-of-3). */
  retries?: number;
}

/**
 * J1 — what a parse could NOT turn into a check.
 *
 * The runner used to return `[]` for every scenario file in this repo and say
 * nothing: `parseTestCases` split on `/^---$/m` and required name+persona+prompt
 * +assertions, while all seven files use `tests:` / `- id:` / `prompt:` /
 * `expect:`. `agentboot test --behavioral` therefore ran VACUOUSLY in
 * .github/workflows/agentboot-ci.yml — the largest check-that-cannot-fail on
 * the branch.
 *
 * Parsing the real schema is half the fix. The other half is that most `expect:`
 * keys (`confirms_scope`, `asks_for_base_persona`, `groups_by_confidence_tier`,
 * …) are judgements about a conversation, not string matches, and have no
 * mechanical evaluator. Silently ignoring them would rebuild the same lie one
 * layer up: a green run that checked a third of what the file asserts. They are
 * REPORTED, counted, and they fail the run unless explicitly waived.
 */
/**
 * NF2-6: a scenario entry that did not become a runnable case, and WHY.
 *
 * "Which scenarios did not run" is a different question from "how many
 * expectation keys had no evaluator", and only the second was answerable.
 */
export interface DroppedCase {
  file: string;
  /** The scenario id, or null when the entry was too malformed to have one. */
  caseId: string | null;
  reason: string;
  /**
   * NEW-4: WHY it dropped, in a form the caller can branch on.
   *
   * `unevaluable` — the scenario is well formed and its expectations are real;
   *     none of them maps onto a mechanical check. This is the same state
   *     `--allow-unevaluated` exists to waive, one granularity finer, so it must
   *     answer to the same flag. Reporting it as unwaivable made
   *     `--allow-unevaluated` unable to waive the thing it is named after — and
   *     AgentBoot's own published reusable workflow passes that flag.
   * `malformed` — the entry is structurally broken (not a mapping, no `id:`, no
   *     `prompt:`, no `expect:` block). No flag should wave that through: it is
   *     a scenario file that does not say what it is testing.
   *
   * A string `reason` alone is not branchable without matching on prose, which
   * is how a classifier and its consumer drift.
   */
  kind: "unevaluable" | "malformed";
}

export interface UnevaluatedExpectation {
  file: string;
  caseId: string;
  /** The `expect:` key with no evaluator. */
  key: string;
}

export interface BehavioralParse {
  cases: BehavioralTestCase[];
  unevaluated: UnevaluatedExpectation[];
  /** NF2-6: scenario entries that did not become runnable cases, and why. */
  droppedCases: DroppedCase[];
}

/**
 * `expect:` keys that map onto a mechanical check of the transcript.
 *
 * Deliberately small and literal. An evaluator that "sort of" checks a
 * judgement key is worse than one that declares it unevaluated: it converts an
 * honest gap into a false pass.
 */
const MECHANICAL_EXPECTATIONS: Record<string, "contains" | "regex" | "not-contains"> = {
  calls_tool: "contains",
  routes_to: "contains",
  intent: "contains",
  artifact_type: "contains",
  proposed_artifact_type: "contains",
  promotion_target_scope: "contains",
  runs_command: "contains",
  response_contains: "contains",
  response_includes: "contains",
  summary_includes: "contains",
  table_includes: "contains",
  response_matches: "regex",
  does_not_call_tool_before_clarification: "not-contains",
};

export interface BehavioralTestResult {
  name: string;
  persona: string;
  passed: boolean;
  attempts: number;
  passes: number;
  failures: string[];
  /**
   * R4-4: did the persona's compiled SKILL.md actually get loaded as the system
   * prompt? `false` means the scenario exercised the BARE MODEL, and its verdict
   * says nothing about the compiled persona it is named for.
   */
  personaContextLoaded: boolean;
}

/**
 * Parse assertion lines from raw text using the legacy line-by-line format.
 * Handles: "- contains: text", "- not-contains: text", "- regex: pattern"
 */
function parseLegacyAssertions(block: string): BehavioralTestCase["assertions"] {
  const assertions: BehavioralTestCase["assertions"] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    const assertMatch = trimmed.match(/^-\s*(contains|not-contains|regex):\s*(.+)/);
    if (assertMatch) {
      assertions.push({
        type: assertMatch[1] as "contains" | "not-contains" | "regex",
        value: assertMatch[2]!,
      });
    }
  }
  return assertions;
}

/**
 * Extract assertions from a parsed YAML object.
 * Supports assertions under an `assertions:` key as a list of objects
 * with `type` and `value` fields, or shorthand `{ contains: X }` / `{ not-contains: X }` / `{ regex: X }`.
 */
function extractYamlAssertions(parsed: Record<string, unknown>): BehavioralTestCase["assertions"] {
  const assertions: BehavioralTestCase["assertions"] = [];
  const raw = parsed["assertions"];
  if (!Array.isArray(raw)) return assertions;

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;

    // Full form: { type: "contains", value: "text" }
    if (typeof obj["type"] === "string" && typeof obj["value"] === "string") {
      const t = obj["type"] as string;
      if (t === "contains" || t === "not-contains" || t === "regex") {
        assertions.push({ type: t, value: obj["value"] as string });
      }
      continue;
    }

    // Shorthand form: { contains: "text" } or { not-contains: "text" } or { regex: "pattern" }
    for (const key of ["contains", "not-contains", "regex"] as const) {
      if (typeof obj[key] === "string") {
        assertions.push({ type: key, value: obj[key] as string });
        break;
      }
    }
  }

  return assertions;
}

/**
 * Parse a YAML test case file.
 *
 * Supports two formats:
 * 1. Proper YAML with `assertions:` key (parsed via js-yaml)
 * 2. Legacy format with root-level `- contains: X` lines (backward compatible)
 *
 * Blocks are separated by `---`.
 */
/**
 * J1: parse the `tests:` scenario schema every file in tests/behavioral/ uses.
 *
 *     tests:
 *       - id: author-add-gotcha
 *         prompt: "..."
 *         expect:
 *           - calls_tool: agentboot_propose_change
 *           - confirms_scope: true
 *
 * Returns null when the document is not in this shape, so the legacy
 * `---`-separated parser still runs for files that are.
 */
function parseScenarioSchema(content: string, file: string): BehavioralParse | null {
  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const root = doc as Record<string, unknown>;
  const tests = root["tests"];
  if (!Array.isArray(tests)) return null;

  // The persona under test: an explicit key, else the file stem. The scenario
  // files are named for the skill they exercise (ab-author-add.yaml →
  // ab-author), and guessing is stated rather than hidden — runBehavioralTest
  // tolerates a missing SKILL.md by running with no system prompt.
  const declaredPersona =
    (typeof root["persona"] === "string" && root["persona"]) ||
    (typeof root["skill"] === "string" && root["skill"]) ||
    null;
  const stem = file.replace(/\.(ya?ml)$/, "");
  const persona = declaredPersona ?? (stem.match(/^(ab-[a-z]+)/)?.[1] ?? stem);

  const cases: BehavioralTestCase[] = [];
  const unevaluated: UnevaluatedExpectation[] = [];
  // NF2-6: a case that produced no runnable check, and an entry too malformed to
  // become a case at all, are both "we did not run this scenario" — and both
  // were `continue`d with no record. A FILE with no cases is reported loudly
  // ("✗ … produced NO runnable test case"); a CASE with no checks was reported
  // only as an anonymous by-key count, so nothing named the scenario. Same
  // class, finer granularity, opposite treatment.
  //
  // Today `author-import-duplicate-detection` (ab-author-import.yaml) and
  // `routing-ambiguous-clarify` (ab-routing.yaml) are dropped this way — 28
  // `tests:` entries in the YAML, 26 cases returned — and nothing names them.
  const droppedCases: DroppedCase[] = [];

  for (const entry of tests) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      droppedCases.push({ file, caseId: null, reason: "entry is not a mapping", kind: "malformed" });
      continue;
    }
    const tc = entry as Record<string, unknown>;
    const id = typeof tc["id"] === "string" ? tc["id"] : undefined;
    const prompt = typeof tc["prompt"] === "string" ? tc["prompt"] : undefined;
    if (!id || !prompt) {
      droppedCases.push({
        file,
        caseId: id ?? null,
        reason: !id ? "no `id:`" : "no `prompt:`",
        kind: "malformed",
      });
      continue;
    }

    const assertions: BehavioralTestCase["assertions"] = [];
    const expects = Array.isArray(tc["expect"]) ? tc["expect"] : [];
    for (const e of expects) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      for (const [key, value] of Object.entries(e as Record<string, unknown>)) {
        const kind = MECHANICAL_EXPECTATIONS[key];
        if (!kind) {
          unevaluated.push({ file, caseId: id, key });
          continue;
        }
        // A mechanical key whose value is not a string (e.g. `calls_tool: true`)
        // asserts nothing checkable — count it as unevaluated rather than
        // silently dropping it.
        const values = typeof value === "string"
          ? [value]
          : Array.isArray(value) && value.every((v) => typeof v === "string")
            ? (value as string[])
            : null;
        if (!values || values.length === 0) {
          unevaluated.push({ file, caseId: id, key });
          continue;
        }
        for (const v of values) assertions.push({ type: kind, value: v, from: key });
      }
    }

    if (assertions.length === 0) {
      // Every expectation in this case was unevaluable. Running it would report
      // a pass for having checked nothing — so it is not run, and it IS named.
      droppedCases.push({
        file,
        caseId: id,
        reason: expects.length === 0
          ? "no `expect:` block"
          : "every expectation is unevaluable — no mechanical evaluator matched",
        // A scenario with no `expect:` block asserts nothing at all — that is
        // structurally broken, not "we have judgement expectations we cannot
        // check mechanically". Only the latter answers to --allow-unevaluated.
        kind: expects.length === 0 ? "malformed" : "unevaluable",
      });
      continue;
    }
    cases.push({
      name: id,
      persona,
      prompt,
      assertions,
      ...(typeof tc["retries"] === "number" ? { retries: tc["retries"] } : {}),
    });
  }

  return { cases, unevaluated, droppedCases };
}

/**
 * Parse one scenario FILE, reporting what it could not turn into a check.
 *
 * `parseTestCases` (below) remains the string-in/cases-out entry point the older
 * tests use; this is the one the runner calls, because the runner needs to know
 * about the gaps.
 */
export function parseTestFile(content: string, file = "inline.yaml"): BehavioralParse {
  const scenario = parseScenarioSchema(content, file);
  if (scenario) return scenario;
  return { cases: parseTestCases(content), unevaluated: [], droppedCases: [] };
}

export function parseTestCases(content: string): BehavioralTestCase[] {
  // J1: the scenario schema first — every file that ships with this repo is in
  // it, and the legacy splitter returned 0 cases for all of them.
  const scenario = parseScenarioSchema(content, "inline.yaml");
  if (scenario) return scenario.cases;

  const cases: BehavioralTestCase[] = [];

  // Split by "---" test case separator
  const blocks = content.split(/^---$/m).filter(b => b.trim());

  for (const block of blocks) {
    let tc: Partial<BehavioralTestCase> = { assertions: [] };

    // Try proper YAML parsing first
    let yamlParsed = false;
    try {
      const parsed = yaml.load(block);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj["name"] === "string") tc.name = obj["name"];
        if (typeof obj["persona"] === "string") tc.persona = obj["persona"];
        if (typeof obj["prompt"] === "string") tc.prompt = obj["prompt"];
        if (typeof obj["retries"] === "number") tc.retries = obj["retries"];

        // Extract assertions from YAML structure
        const yamlAssertions = extractYamlAssertions(obj);
        if (yamlAssertions.length > 0) {
          tc.assertions = yamlAssertions;
          yamlParsed = true;
        }
      }
    } catch {
      // YAML parsing failed — fall through to legacy parser
    }

    // If YAML didn't produce assertions, fall back to legacy line-by-line parser
    if (!yamlParsed) {
      // Extract fields from lines if YAML parsing didn't get them
      if (!tc.name || !tc.persona || !tc.prompt) {
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;

          const match = trimmed.match(/^(\w+):\s*(.+)/);
          if (match) {
            const [, key, value] = match;
            switch (key) {
              case "name": tc.name = tc.name ?? value!; break;
              case "persona": tc.persona = tc.persona ?? value!; break;
              case "prompt": tc.prompt = tc.prompt ?? value!; break;
              case "retries": tc.retries = tc.retries ?? parseInt(value!, 10); break;
            }
          }
        }
      }

      tc.assertions = parseLegacyAssertions(block);
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
        // Guard against catastrophic backtracking (ReDoS)
        const UNSAFE_REGEX = /(\([^)]*[+*][^)]*\))[+*{]|\(\?[^)]+\)\{.*,/;
        if (UNSAFE_REGEX.test(assertion.value)) {
          failures.push(`Unsafe regex pattern rejected (potential ReDoS): ${assertion.value}`);
          break;
        }
        try {
          const re = new RegExp(assertion.value, "i");
          if (!re.test(output)) {
            failures.push(`Expected output to match regex /${assertion.value}/i`);
          }
        } catch (e) {
          failures.push(`Invalid regex: ${assertion.value} (${e instanceof Error ? e.message : String(e)})`);
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
  const requiredPasses = Math.floor(maxAttempts / 2) + 1; // true majority: 2-of-3, 2-of-4, 3-of-5
  let passes = 0;
  let attempts = 0;
  const allFailures: string[] = [];

  // Load persona SKILL.md as system context.
  //
  // R4-4: this path carried a `personas` segment the compiler has never written.
  // compileInstructions writes `dist/skill/<scope>/<persona>/SKILL.md`
  // (compile.ts: `path.join(distPath, "skill", scopePath, personaName)`), so
  // `dist/skill/core/personas/<persona>/SKILL.md` did not exist on ANY hub, in
  // any configuration. `systemPrompt` was therefore always "" and every
  // behavioral scenario ran against the bare model — while the runner printed
  // "Running: <case> (<persona>)" and reported the verdict as a persona result.
  //
  // The existsSync was written as tolerance ("runBehavioralTest tolerates a
  // missing SKILL.md by running with no system prompt") and became total
  // vacuity, because a tolerance with no diagnostic cannot distinguish "this hub
  // does not build skill" from "the path is wrong". It says so now, and the
  // caller turns it into a finding.
  const skillPath = path.join(distPath, "skill", "core", testCase.persona, "SKILL.md");
  let systemPrompt = "";
  if (fs.existsSync(skillPath)) {
    systemPrompt = fs.readFileSync(skillPath, "utf-8");
  }
  const personaContextLoaded = systemPrompt.length > 0;

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
    personaContextLoaded,
  };
}

/**
 * Run all behavioral tests from a directory.
 */
export interface BehavioralRun {
  results: BehavioralTestResult[];
  /** Scenario files present in the directory. */
  filesSeen: string[];
  /** Files that produced ZERO runnable cases — the vacuity signal. */
  filesWithNoCases: string[];
  /** Expectations with no mechanical evaluator, by file and case. */
  unevaluated: UnevaluatedExpectation[];
  /**
   * NF2-6: scenario entries that produced NO runnable case, BY NAME.
   *
   * `filesWithNoCases` answers the same question at file granularity and is
   * reported loudly. At case granularity the answer existed only as an
   * anonymous by-key count, so an operator could not learn WHICH scenarios did
   * not run.
   */
  droppedCases: DroppedCase[];
}

/**
 * Run all behavioral tests from a directory.
 *
 * J1: returns the GAPS as well as the results. Returning only `[]` — which is
 * what it did for every file in this repo — is indistinguishable from "all
 * tests passed" to anything that counts failures, and that is precisely how
 * `agentboot test --behavioral` ran vacuously in CI.
 */
export function runBehavioralTestsDetailed(
  testDir: string,
  distPath: string,
  provider?: LLMProvider,
): BehavioralRun {
  const results: BehavioralTestResult[] = [];
  const unevaluated: UnevaluatedExpectation[] = [];
  const filesWithNoCases: string[] = [];
  const droppedCases: DroppedCase[] = [];
  const llm = provider ?? new ClaudeCodeProvider();

  if (!fs.existsSync(testDir)) {
    console.log(chalk.yellow(`  Test directory not found: ${testDir}`));
    return { results, filesSeen: [], filesWithNoCases, unevaluated, droppedCases };
  }

  const files = fs.readdirSync(testDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(testDir, file), "utf-8");
    const parsed = parseTestFile(content, file);
    const testCases = parsed.cases;
    unevaluated.push(...parsed.unevaluated);
    droppedCases.push(...parsed.droppedCases);
    if (testCases.length === 0) filesWithNoCases.push(file);

    for (const tc of testCases) {
      console.log(chalk.cyan(`  Running: ${tc.name} (${tc.persona})...`));
      const result = runBehavioralTest(tc, llm, distPath);
      results.push(result);

      if (!result.personaContextLoaded) {
        console.log(chalk.yellow(
          `    ~ no compiled SKILL.md for "${tc.persona}" — this case ran against the BARE MODEL`,
        ));
      }
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

  return { results, filesSeen: files, filesWithNoCases, unevaluated, droppedCases };
}

/** Back-compatible shape: results only. Prefer runBehavioralTestsDetailed. */
export function runBehavioralTests(
  testDir: string,
  distPath: string,
  provider?: LLMProvider,
): BehavioralTestResult[] {
  return runBehavioralTestsDetailed(testDir, distPath, provider).results;
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


/**
 * NEW-4 — the verdict on a behavioral run, as data.
 *
 * This logic used to live inline in the `test` command action, which is why it
 * could not be tested: reaching it requires runBehavioralTestsDetailed(), and
 * that spawns an LLM per case. So the ONE thing about this feature that must be
 * right — which conditions are fatal, and which the operator can waive — was the
 * one thing no test could see. 06c9683 then moved a fatal condition outside the
 * waiver guard and nothing noticed, breaking the flag for exactly the state the
 * flag names, in the invocation AgentBoot's own published reusable workflow uses
 * (`npx agentboot test --behavioral --allow-unevaluated`).
 *
 * Returning findings rather than printing them means the MESSAGE and the VERDICT
 * come from one place and cannot disagree — a report that says "⚠" while exiting
 * 1 is its own kind of lie.
 *
 * `error` findings fail the run. `warn` findings are printed and do not.
 * Nothing is silent either way: silence is not success.
 */
export interface BehavioralFinding {
  level: "error" | "warn";
  /** Lines to print, already worded. No color — the caller owns presentation. */
  message: string;
  /** Extra indented detail printed under the message. */
  detail?: string;
}

export function behavioralFindings(
  run: BehavioralRun,
  opts: { allowUnevaluated: boolean; testDirLabel: string },
): BehavioralFinding[] {
  const findings: BehavioralFinding[] = [];
  const allow = opts.allowUnevaluated;

  // R4-4: a scenario that ran WITHOUT the compiled persona as its system prompt
  // did not test the persona. It tested the bare model, and reported the verdict
  // under the persona's name.
  //
  // This was total, not occasional: the loader looked for
  // `dist/skill/core/personas/<p>/SKILL.md` and the compiler writes
  // `dist/skill/core/<p>/SKILL.md`, so the system prompt was empty on every hub
  // in every configuration, silently, behind an `fs.existsSync` written as
  // tolerance. Not waivable by --allow-unevaluated: that flag waives
  // expectations we cannot MECHANICALLY check, and this is a run whose subject
  // was absent.
  const contextless = run.results.filter((r) => !r.personaContextLoaded);
  if (contextless.length > 0) {
    const personas = [...new Set(contextless.map((r) => r.persona))].sort();
    findings.push({
      level: "error",
      message:
        `✗ ${contextless.length} of ${run.results.length} scenario(s) ran with NO compiled persona ` +
        `as system prompt (${personas.join(", ")}) — those verdicts describe the bare model, not the persona.`,
      detail:
        "    The prompt comes from dist/skill/core/<persona>/SKILL.md. Build `skill` in\n" +
        "    personas.outputFormats, or name a persona the hub compiles (`persona:` /\n" +
        "    `skill:` in the scenario file, else the file stem).",
    });
  }

  // J1: a directory with no scenario files checked nothing. Not waivable —
  // there is no judgement gap here, there is no corpus.
  if (run.filesSeen.length === 0) {
    findings.push({
      level: "error",
      message: `✗ No scenario files in ${opts.testDirLabel}/ — nothing was checked.`,
    });
  }

  // A whole FILE that produced no runnable case. Waivable on the same terms as
  // a single unevaluable case: it is the same condition at file granularity,
  // and treating the coarser report as stricter than the finer one is backwards.
  for (const f of run.filesWithNoCases) {
    findings.push({
      level: allow ? "warn" : "error",
      message: `${allow ? "⚠" : "✗"} ${f} produced NO runnable test case — every expectation in it is unevaluable.`,
    });
  }

  // NF2-6: name the SCENARIOS that did not run, not just an anonymous count.
  const skipped = run.droppedCases.filter((d) => !run.filesWithNoCases.includes(d.file));
  for (const d of skipped) {
    // NEW-4: `unevaluable` is precisely what --allow-unevaluated waives.
    // `malformed` — not a mapping, no `id:`, no `prompt:`, no `expect:` block —
    // is a scenario that does not say what it tests, and no flag waives that.
    const waivable = d.kind === "unevaluable" && allow;
    findings.push({
      level: waivable ? "warn" : "error",
      message: `${waivable ? "⚠" : "✗"} ${d.file}: scenario ${d.caseId ?? "(no id)"} did NOT run — ${d.reason}.`,
    });
  }
  if (!allow && skipped.some((d) => d.kind === "unevaluable")) {
    findings.push({
      level: "warn",
      message: "",
      detail: "Pass --allow-unevaluated to proceed anyway (the scenarios are still named).",
    });
  }

  if (run.unevaluated.length > 0) {
    const byKey = new Map<string, number>();
    for (const u of run.unevaluated) byKey.set(u.key, (byKey.get(u.key) ?? 0) + 1);
    const top = [...byKey.entries()].sort((a, b) => b[1] - a[1]);
    findings.push({
      level: allow ? "warn" : "error",
      message:
        `⚠ ${run.unevaluated.length} expectation(s) across ${run.filesSeen.length} file(s) have NO evaluator:`,
      detail:
        top.map(([key, n]) => `    ${key} ×${n}`).join("\n") +
        "\n  These are judgements about a conversation, not string matches. They are NOT\n" +
        "  checked. A run that ignored them and reported green would be checking a\n" +
        "  fraction of what the scenario files assert." +
        (allow ? "" : "\n  Pass --allow-unevaluated to proceed anyway (the count is still printed)."),
    });
  }

  // Nothing ran at all. NOT waivable, and deliberately distinct from the
  // conditions above: a flag that says "I accept some checks are judgement-only"
  // cannot also mean "I accept that zero checks ran".
  if (run.results.length === 0) {
    findings.push({ level: "error", message: "✗ No behavioral test cases ran." });
  } else {
    const failed = run.results.filter((r) => !r.passed).length;
    if (failed > 0) {
      findings.push({
        level: "error",
        message: `✗ ${failed}/${run.results.length} behavioral test(s) failed.`,
      });
    }
  }
  return findings;
}
