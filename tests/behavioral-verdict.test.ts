/**
 * NEW-4 — `--allow-unevaluated` stopped waiving the state it is named after.
 *
 * 06c9683 added a loop over `run.droppedCases` that set `exitCode = 1` for every
 * entry, OUTSIDE the `if (!opts["allowUnevaluated"])` guard the by-key counter
 * uses. The dominant drop reason is literally
 *
 *     "every expectation is unevaluable — no mechanical evaluator matched"
 *
 * i.e. the same condition the flag exists to waive, reported at a finer
 * granularity. AgentBoot's own published reusable workflow runs
 * `npx agentboot test --behavioral --allow-unevaluated`
 * (.github/workflows/agentboot-ci.yml), with a comment saying that flag is the
 * escape hatch — so any adopter opting into `behavioral: true` with a
 * judgement-only scenario got a red CI they could not waive by any means. Before
 * that commit the same case was reported only through the (waivable) counter.
 *
 * Against this repo's own corpus the two surviving drops are
 * ab-author-import.yaml / author-import-duplicate-detection and
 * ab-routing.yaml / routing-ambiguous-clarify, both for that reason.
 *
 * WHY THESE TESTS EXIST AT ALL: the verdict used to be written inline in the
 * `test` command action, and reaching it requires runBehavioralTestsDetailed(),
 * which spawns an LLM per case. So the one thing about this feature that has to
 * be right — which conditions are fatal and which are waivable — was the one
 * thing no test could reach. It is now `behavioralFindings()`, a pure function
 * over a run, and the CLI derives both its output and its exit code from it, so
 * a "⚠" can never accompany an exit 1.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  behavioralFindings,
  parseTestFile,
  type BehavioralRun,
  type DroppedCase,
} from "../scripts/lib/test-runner.js";

const ROOT = path.resolve(__dirname, "..");

const emptyRun = (over: Partial<BehavioralRun> = {}): BehavioralRun => ({
  // R4-4: `personaContextLoaded: true` is stated, not omitted. These fixtures
  // exist to test the GATING of dropped/unevaluable cases; a stub that left the
  // field undefined would trip the contextless finding and mask what is actually
  // under test here.
  results: [{ name: "x", passed: true, personaContextLoaded: true, assertions: [] }] as unknown as BehavioralRun["results"],
  filesSeen: ["a.yaml"],
  filesWithNoCases: [],
  unevaluated: [],
  droppedCases: [],
  ...over,
});

const drop = (kind: DroppedCase["kind"], reason: string): DroppedCase => ({
  file: "a.yaml",
  caseId: "c1",
  reason,
  kind,
});

const failed = (fs_: ReturnType<typeof behavioralFindings>) =>
  fs_.some((f) => f.level === "error");

describe("NEW-4 — the flag waives the state it names", () => {
  const unevaluable = drop("unevaluable", "every expectation is unevaluable — no mechanical evaluator matched");

  it("without --allow-unevaluated an unevaluable scenario FAILS the run", () => {
    const f = behavioralFindings(emptyRun({ droppedCases: [unevaluable] }), {
      allowUnevaluated: false,
      testDirLabel: "tests/behavioral",
    });
    expect(failed(f), "an unchecked scenario passed silently").toBe(true);
    expect(f.some((x) => x.message.includes("did NOT run"))).toBe(true);
  });

  it("WITH --allow-unevaluated it is reported and does NOT fail the run", () => {
    const f = behavioralFindings(emptyRun({ droppedCases: [unevaluable] }), {
      allowUnevaluated: true,
      testDirLabel: "tests/behavioral",
    });
    expect(failed(f), "the flag could not waive the state it is named after").toBe(false);
    // Waived is not silent — the scenario is still named.
    expect(f.some((x) => x.message.includes("did NOT run"))).toBe(true);
  });

  it("the waived finding is a WARNING, not an error wearing a warning's face", () => {
    const f = behavioralFindings(emptyRun({ droppedCases: [unevaluable] }), {
      allowUnevaluated: true,
      testDirLabel: "t",
    });
    const line = f.find((x) => x.message.includes("did NOT run"))!;
    expect(line.level).toBe("warn");
    expect(line.message.startsWith("⚠")).toBe(true);
  });

  it("a MALFORMED scenario is NOT waivable — no flag hides a test that says nothing", () => {
    for (const bad of [
      drop("malformed", "no `id:`"),
      drop("malformed", "no `prompt:`"),
      drop("malformed", "entry is not a mapping"),
      drop("malformed", "no `expect:` block"),
    ]) {
      const f = behavioralFindings(emptyRun({ droppedCases: [bad] }), {
        allowUnevaluated: true,
        testDirLabel: "t",
      });
      expect(failed(f), `--allow-unevaluated waived a structurally broken case: ${bad.reason}`).toBe(true);
    }
  });

  it("`no cases ran` is never waivable — that is a different claim from `some are judgements`", () => {
    const f = behavioralFindings(emptyRun({ results: [], droppedCases: [unevaluable] }), {
      allowUnevaluated: true,
      testDirLabel: "t",
    });
    expect(failed(f)).toBe(true);
    expect(f.some((x) => x.message.includes("No behavioral test cases ran"))).toBe(true);
  });

  it("`no scenario files` is never waivable either — there is no corpus to judge", () => {
    const f = behavioralFindings(emptyRun({ filesSeen: [], results: [] }), {
      allowUnevaluated: true,
      testDirLabel: "tests/behavioral",
    });
    expect(failed(f)).toBe(true);
    expect(f.some((x) => x.message.includes("No scenario files"))).toBe(true);
  });

  it("a real test FAILURE is never waivable", () => {
    const run = emptyRun({
      results: [{ name: "x", passed: false, personaContextLoaded: true, assertions: [] }] as unknown as BehavioralRun["results"],
    });
    expect(failed(behavioralFindings(run, { allowUnevaluated: true, testDirLabel: "t" }))).toBe(true);
  });

  it("a file-level vacuity is waivable on the SAME terms as a case-level one", () => {
    // Treating the coarser report as stricter than the finer one is backwards,
    // and that inconsistency is what made the flag's contract unguessable.
    const run = emptyRun({ filesWithNoCases: ["b.yaml"] });
    expect(failed(behavioralFindings(run, { allowUnevaluated: false, testDirLabel: "t" }))).toBe(true);
    expect(failed(behavioralFindings(run, { allowUnevaluated: true, testDirLabel: "t" }))).toBe(false);
  });

  it("NEGATIVE: a clean run produces no error findings at all", () => {
    expect(failed(behavioralFindings(emptyRun(), { allowUnevaluated: false, testDirLabel: "t" }))).toBe(false);
  });
});

/**
 * The classifier that the waiver branches on. `kind` exists so the consumer can
 * branch without matching on prose — the shape in which a classifier and its
 * consumer drift.
 */
describe("NEW-4 — DroppedCase.kind classifies the real corpus", () => {
  it("this repo's own scenario files drop exactly two cases, both unevaluable", () => {
    const dir = path.join(ROOT, "tests", "behavioral");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(files.length, "the behavioral corpus disappeared").toBeGreaterThan(0);

    const dropped = files.flatMap((f) =>
      parseTestFile(fs.readFileSync(path.join(dir, f), "utf-8"), f).droppedCases,
    );
    // If a future scenario is added that is structurally broken, this goes red —
    // which is correct, because that one would NOT be waivable in CI.
    expect(
      dropped.filter((d) => d.kind === "malformed"),
      "a structurally broken scenario would fail CI unwaivably",
    ).toEqual([]);
    expect(dropped.map((d) => d.caseId).sort()).toEqual(
      ["author-import-duplicate-detection", "routing-ambiguous-clarify"],
    );
  });

  it("the repo's corpus is GREEN under the flag CI actually passes", () => {
    // The end-to-end claim, minus the LLM: with --allow-unevaluated, nothing
    // about the parse of this repo's own scenario files is fatal.
    const dir = path.join(ROOT, "tests", "behavioral");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const parsed = files.map((f) => ({
      f,
      p: parseTestFile(fs.readFileSync(path.join(dir, f), "utf-8"), f),
    }));
    const run: BehavioralRun = {
      // Stand in for the LLM: every parsed case passes. The question under test
      // is the GATING, not the assertions.
      results: parsed.flatMap((x) =>
        x.p.cases.map((c) => ({ name: c.name, passed: true, personaContextLoaded: true, assertions: [] })),
      ) as unknown as BehavioralRun["results"],
      filesSeen: files,
      filesWithNoCases: parsed.filter((x) => x.p.cases.length === 0).map((x) => x.f),
      unevaluated: parsed.flatMap((x) => x.p.unevaluated),
      droppedCases: parsed.flatMap((x) => x.p.droppedCases),
    };
    const f = behavioralFindings(run, { allowUnevaluated: true, testDirLabel: "tests/behavioral" });
    expect(
      f.filter((x) => x.level === "error").map((x) => x.message),
      "`behavioral: true` is an unwaivable red for every adopter",
    ).toEqual([]);
    // And without the flag it is correctly red — the flag is a waiver, not a
    // no-op.
    expect(
      behavioralFindings(run, { allowUnevaluated: false, testDirLabel: "tests/behavioral" })
        .some((x) => x.level === "error"),
    ).toBe(true);
  });
});

/**
 * R4-4 — every behavioral scenario ran against the BARE MODEL.
 *
 * `runBehavioralTest` loaded its system prompt from
 * `dist/skill/core/personas/<persona>/SKILL.md`. The compiler writes
 * `path.join(distPath, "skill", scopePath, personaName)` — i.e.
 * `dist/skill/core/<persona>/SKILL.md`. There is no `personas` segment, in any
 * scope, in any configuration, so the file NEVER existed and `systemPrompt` was
 * always "". The runner still printed "Running: <case> (<persona>)" and reported
 * the verdict as a persona result.
 *
 * The `fs.existsSync` around it was written as tolerance — the parser's own
 * comment says "runBehavioralTest tolerates a missing SKILL.md by running with
 * no system prompt" — and a tolerance with no diagnostic cannot tell "this hub
 * does not build skill" from "the path is wrong". So it became total vacuity
 * that nothing could report. K.1 fixed the PARSE (0 of 7 files → 26 cases); the
 * cases then ran without their subject.
 */
describe("R4-4 — the compiled persona is actually loaded as the system prompt", () => {
  const os = require("node:os") as typeof import("node:os");

  function mkDist(rel: string[], persona: string): string {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r4-beh-"));
    const dir = path.join(dist, ...rel, persona);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# ORGPERSONA MARKER\nYou are the org persona.\n");
    return dist;
  }

  const tc = { name: "c1", persona: "alpha", prompt: "hello", assertions: [] as never[] };

  it("reads dist/skill/core/<persona>/SKILL.md — the layout the compiler writes", async () => {
    const { runBehavioralTest } = await import("../scripts/lib/test-runner.js");
    let seen = "";
    const provider = { classify: (p: string) => { seen = p; return { data: "" }; } };
    const r = runBehavioralTest(
      tc as never,
      provider as never,
      mkDist(["skill", "core"], "alpha"),
    );
    expect(seen, "the compiled persona must reach the model").toContain("ORGPERSONA MARKER");
    expect(r.personaContextLoaded).toBe(true);
  });

  it("NEGATIVE: the old `personas` segment is not a layout the compiler produces", async () => {
    // Pinning the defect itself: a tree shaped the way the loader used to expect
    // must NOT satisfy it, or the fix would be a second accepted layout rather
    // than a correction.
    const { runBehavioralTest } = await import("../scripts/lib/test-runner.js");
    const provider = { classify: () => ({ data: "" }) };
    const r = runBehavioralTest(
      tc as never,
      provider as never,
      mkDist(["skill", "core", "personas"], "alpha"),
    );
    expect(r.personaContextLoaded).toBe(false);
  });

  it("a contextless run is an unwaivable ERROR, naming the personas", async () => {
    const { behavioralFindings } = await import("../scripts/lib/test-runner.js");
    const run = emptyRun({
      results: [
        { name: "c1", persona: "alpha", passed: true, personaContextLoaded: false },
        { name: "c2", persona: "beta", passed: true, personaContextLoaded: true },
      ] as unknown as BehavioralRun["results"],
    });
    for (const allowUnevaluated of [true, false]) {
      const errs = behavioralFindings(run, { allowUnevaluated, testDirLabel: "tests/behavioral" })
        .filter((x) => x.level === "error")
        .map((x) => x.message);
      expect(
        errs.some((m) => m.includes("NO compiled persona") && m.includes("alpha")),
        "--allow-unevaluated waives expectations we cannot check, not a run with no subject",
      ).toBe(true);
      expect(errs.some((m) => m.includes("beta")), "the measured persona must not be named").toBe(false);
    }
  });
});
