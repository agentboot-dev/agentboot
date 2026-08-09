/**
 * J1 — the behavioral runner ran vacuously, and could not report that it had.
 *
 * `parseTestCases` split on `/^---$/m` and required name+persona+prompt+
 * assertions. Every one of the seven files in tests/behavioral/ uses
 * `tests:` / `- id:` / `prompt:` / `expect:` with `routes_to` / `intent` /
 * `artifact_type` / `calls_tool` assertions. Measured by calling it directly on
 * each file: every file returned 0. TOTAL PARSED: 0. `runBehavioralTests` then
 * returned `[]` with no diagnostic, and `.github/workflows/agentboot-ci.yml`
 * treats that step's exit 0 as a pass.
 *
 * Two things must now hold, and the second matters as much as the first:
 *   1. the real schema parses;
 *   2. what could NOT be turned into a check is counted and reported, because
 *      an evaluator that quietly ignores two thirds of a file's expectations
 *      rebuilds the same lie one layer up.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseTestFile, parseTestCases } from "../scripts/lib/test-runner.js";

const ROOT = path.resolve(__dirname, "..");
const BEHAVIORAL_DIR = path.join(ROOT, "tests", "behavioral");

const scenarioFiles = () =>
  fs.readdirSync(BEHAVIORAL_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

describe("J1 — the shipped scenario files parse", () => {
  it("J1-0: there are scenario files to parse — an empty directory makes this file vacuous", () => {
    expect(scenarioFiles().length).toBeGreaterThan(0);
  });

  it("J1-1: EVERY shipped scenario file yields at least one runnable case", () => {
    // This is the measurement from the report, inverted. Pre-fix every entry
    // in this table was 0.
    const zero: string[] = [];
    for (const f of scenarioFiles()) {
      const parsed = parseTestFile(fs.readFileSync(path.join(BEHAVIORAL_DIR, f), "utf-8"), f);
      if (parsed.cases.length === 0) zero.push(f);
    }
    expect(zero, `these files parse to zero runnable cases: ${zero.join(", ")}`).toEqual([]);
  });

  it("J1-2: the total is a real number of cases, not one lucky file", () => {
    let total = 0;
    for (const f of scenarioFiles()) {
      total += parseTestFile(fs.readFileSync(path.join(BEHAVIORAL_DIR, f), "utf-8"), f).cases.length;
    }
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it("J1-3: a case carries the assertions its expect: block declared", () => {
    const yaml = [
      "tests:",
      "  - id: routing-clear",
      '    prompt: "route this"',
      "    expect:",
      "      - routes_to: ab-author",
      "      - calls_tool: agentboot_propose_change",
      '      - response_matches: "propos(e|ed)"',
    ].join("\n");
    const parsed = parseTestFile(yaml, "ab-routing.yaml");
    expect(parsed.cases).toHaveLength(1);
    const tc = parsed.cases[0]!;
    expect(tc.name).toBe("routing-clear");
    expect(tc.persona).toBe("ab-routing");
    expect(tc.assertions.map((a) => a.value).sort()).toEqual(
      ["ab-author", "agentboot_propose_change", "propos(e|ed)"]
    );
    expect(tc.assertions.find((a) => a.from === "response_matches")!.type).toBe("regex");
  });
});

describe("J1 — what could not be checked is REPORTED, not dropped", () => {
  it("J1-4: a judgement expectation with no evaluator is counted, named, and located", () => {
    const yaml = [
      "tests:",
      "  - id: author-add-gotcha",
      '    prompt: "add a gotcha"',
      "    expect:",
      "      - calls_tool: agentboot_propose_change",
      "      - confirms_scope: true",
      "      - groups_by_confidence_tier: true",
    ].join("\n");
    const parsed = parseTestFile(yaml, "ab-author-add.yaml");
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.unevaluated.map((u) => u.key).sort())
      .toEqual(["confirms_scope", "groups_by_confidence_tier"]);
    expect(parsed.unevaluated[0]!.file).toBe("ab-author-add.yaml");
    expect(parsed.unevaluated[0]!.caseId).toBe("author-add-gotcha");
  });

  it("J1-5: a mechanical key with a NON-string value is unevaluated, not silently dropped", () => {
    // `calls_tool: true` asserts nothing checkable. Treating it as a pass is the
    // failure mode; treating it as absent is the quieter version of the same one.
    const parsed = parseTestFile(
      ["tests:", "  - id: x", '    prompt: "p"', "    expect:", "      - calls_tool: true"].join("\n"),
      "ab-query.yaml"
    );
    expect(parsed.cases).toHaveLength(0);
    expect(parsed.unevaluated.map((u) => u.key)).toEqual(["calls_tool"]);
  });

  it("J1-6: a case whose every expectation is unevaluable produces NO case", () => {
    // Running it would report a pass for having checked nothing.
    const parsed = parseTestFile(
      ["tests:", "  - id: y", '    prompt: "p"', "    expect:", "      - confirms_weight: true"].join("\n"),
      "ab-author-add.yaml"
    );
    expect(parsed.cases).toHaveLength(0);
    expect(parsed.unevaluated).toHaveLength(1);
  });

  it("J1-7: the shipped corpus HAS unevaluated expectations — the gap is real and stated", () => {
    // If this ever reaches zero it means either every judgement key grew an
    // evaluator (good) or the reporting broke (bad). Asserting it is non-zero
    // keeps the honest number honest.
    let total = 0;
    for (const f of scenarioFiles()) {
      total += parseTestFile(fs.readFileSync(path.join(BEHAVIORAL_DIR, f), "utf-8"), f).unevaluated.length;
    }
    expect(total).toBeGreaterThan(0);
  });
});

describe("J1 — the legacy format still parses", () => {
  it("J1-8 (NEGATIVE): the old ---separated schema is not broken by the new one", () => {
    const legacy = [
      "name: legacy case",
      "persona: reviewer",
      "prompt: review this",
      "assertions:",
      '  - contains: "looks good"',
    ].join("\n");
    const cases = parseTestCases(legacy);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.persona).toBe("reviewer");
  });
});
