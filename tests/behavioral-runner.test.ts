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

/**
 * NF2-6 / J1-residual — a CASE that produced no runnable check was dropped
 * anonymously, while a FILE in the same state was reported loudly.
 *
 * `parseTestFile` `continue`d at scripts/lib/test-runner.ts:229 without
 * recording the case id, and cli.ts reported only `run.filesWithNoCases`; the
 * unevaluated printout aggregates by KEY, never by case. So an operator could
 * learn "17 expectations used `mentions_persona`, which has no evaluator" and
 * could NOT learn "the scenario `routing-ambiguous-clarify` did not run at all".
 *
 * Measured by calling parseTestFile directly on tests/behavioral/*.yaml: the raw
 * YAML holds 28 `tests:` entries and parseTestFile returned 26 cases. The two
 * missing are `author-import-duplicate-detection` (ab-author-import.yaml) and
 * `routing-ambiguous-clarify` (ab-routing.yaml), and nothing named them.
 *
 * Same class as the file-granularity signal, opposite treatment. J1's own norm —
 * silence is not success — applies at both granularities.
 */
describe("NF2-6 — a scenario that did not run is named", () => {
  it("a case whose expectations are all unevaluable is RECORDED, not just skipped", () => {
    const yaml = [
      "persona: ab-probe",
      "tests:",
      "  - id: runnable",
      "    prompt: do the thing",
      "    expect:",
      "      - response_contains: hello",
      "  - id: unevaluable-scenario",
      "    prompt: do the other thing",
      "    expect:",
      "      - reasoning_is_sound: true",
      "",
    ].join("\n");
    const parsed = parseTestFile(yaml, "probe.yaml");
    expect(parsed.cases.map((c) => c.name)).toEqual(["runnable"]);
    expect(parsed.droppedCases.map((d) => d.caseId)).toEqual(["unevaluable-scenario"]);
    expect(parsed.droppedCases[0]!.reason).toContain("unevaluable");
  });

  it("an entry with no id or no prompt is recorded too — previously dropped with NO trace", () => {
    // scripts/lib/test-runner.ts:201 `if (!id || !prompt) continue;` left no
    // record at all. Zero such entries ship today, so it was latent — which is
    // the state a defect is in right before it is introduced.
    const yaml = [
      "persona: ab-probe",
      "tests:",
      "  - prompt: no id here",
      "    expect:",
      "      - response_contains: hello",
      "  - id: no-prompt-here",
      "    expect:",
      "      - response_contains: hello",
      "",
    ].join("\n");
    const parsed = parseTestFile(yaml, "probe.yaml");
    expect(parsed.cases).toEqual([]);
    expect(parsed.droppedCases.map((d) => d.reason)).toEqual(["no `id:`", "no `prompt:`"]);
  });

  it("the repo's OWN scenarios: every dropped case is named, and the count matches", () => {
    // The specific finding, pinned against the real corpus so a future edit that
    // silently loses a scenario goes red here.
    const dir = path.join(ROOT, "tests", "behavioral");
    const dropped: string[] = [];
    let cases = 0;
    for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const parsed = parseTestFile(fs.readFileSync(path.join(dir, f), "utf-8"), f);
      cases += parsed.cases.length;
      for (const d of parsed.droppedCases) dropped.push(`${f}:${d.caseId}`);
    }
    expect(cases).toBeGreaterThan(20);
    // Every dropped case has a NAME. That is the property; the specific two are
    // asserted so a regression that drops a third is visible.
    expect(dropped.every((d) => !d.endsWith(":null"))).toBe(true);
    expect(dropped.sort()).toEqual([
      "ab-author-import.yaml:author-import-duplicate-detection",
      "ab-routing.yaml:routing-ambiguous-clarify",
    ]);
  });

  it("NEGATIVE: a fully-evaluable file drops nothing", () => {
    const yaml = [
      "persona: ab-probe",
      "tests:",
      "  - id: a",
      "    prompt: p",
      "    expect:",
      "      - response_contains: hello",
      "",
    ].join("\n");
    const parsed = parseTestFile(yaml, "probe.yaml");
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.droppedCases).toEqual([]);
  });
});
