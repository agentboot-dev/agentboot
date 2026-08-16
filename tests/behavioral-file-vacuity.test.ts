/**
 * L2 — `--allow-unevaluated` waived a scenario file whose every entry was
 * UNREADABLE.
 *
 * The flag exists to waive a JUDGEMENT GAP: expectations that are real, that we
 * read, and for which no mechanical evaluator exists. The per-case path in
 * `behavioralFindings()` already splits on `DroppedCase.kind` for exactly that
 * reason — `malformed` (not a mapping, no `id:`, no `prompt:`, no `expect:`) is
 * a scenario that never said what it tests, and no flag waives that.
 *
 * The FILE-granularity path did not split. It downgraded every no-cases file to
 * a warning on `allow` alone, and the drops for that file were excluded from the
 * per-case loop (`!run.filesWithNoCases.includes(d.file)`), so the kind check
 * never ran on them at all. A scenario file in which EVERY entry was broken
 * passed under `npx agentboot test --behavioral --allow-unevaluated` — the exact
 * invocation AgentBoot's own published reusable workflow uses. The coarser
 * report was strictly WEAKER than the finer one; the previous fix in this area
 * corrected the same inversion in the other direction.
 *
 * The message compounded it: "every expectation in it is unevaluable" is a claim
 * about expectations that were read. For a file we could not parse into a single
 * entry it is the wrong word, and it points the operator at a waiver flag
 * instead of at the broken YAML.
 *
 * BOTH HALVES ARE ASSERTED HERE. A test that only proves the malformed file now
 * fires would be satisfied by making the file path unwaivable across the board,
 * which would break the waiver for the judgement-gap case it exists to serve.
 */

import { describe, it, expect } from "vitest";

import {
  behavioralFindings,
  parseTestFile,
  type BehavioralRun,
  type DroppedCase,
} from "../scripts/lib/test-runner.js";

const run = (over: Partial<BehavioralRun> = {}): BehavioralRun => ({
  // A passing case elsewhere in the run, so the verdict under test is the file
  // finding and not "no behavioral test cases ran" (which is never waivable).
  results: [
    { name: "ok", persona: "alpha", passed: true, personaContextLoaded: true, assertions: [] },
  ] as unknown as BehavioralRun["results"],
  filesSeen: ["ok.yaml", "b.yaml"],
  filesWithNoCases: [],
  unevaluated: [],
  droppedCases: [],
  ...over,
});

const drop = (kind: DroppedCase["kind"], reason: string, caseId: string | null = "c1"): DroppedCase => ({
  file: "b.yaml",
  caseId,
  reason,
  kind,
});

const errors = (f: ReturnType<typeof behavioralFindings>) =>
  f.filter((x) => x.level === "error").map((x) => x.message);

describe("L2 — a file of UNREADABLE entries is not a judgement gap", () => {
  const MALFORMED: DroppedCase[] = [
    drop("malformed", "entry is not a mapping", null),
    drop("malformed", "no `id:`", null),
    drop("malformed", "no `prompt:`"),
    drop("malformed", "no `expect:` block"),
  ];

  it("FIRES: a no-cases file whose drops are ALL malformed errors even WITH the flag", () => {
    const f = behavioralFindings(
      run({ filesWithNoCases: ["b.yaml"], droppedCases: MALFORMED }),
      { allowUnevaluated: true, testDirLabel: "tests/behavioral" },
    );
    expect(
      errors(f).some((m) => m.includes("b.yaml")),
      "--allow-unevaluated waived a scenario file that never said what it tests",
    ).toBe(true);
  });

  it("FIRES for each malformed reason on its own — no single-reason blind spot", () => {
    for (const d of MALFORMED) {
      const f = behavioralFindings(
        run({ filesWithNoCases: ["b.yaml"], droppedCases: [d] }),
        { allowUnevaluated: true, testDirLabel: "t" },
      );
      expect(errors(f).some((m) => m.includes("b.yaml")), `waived: ${d.reason}`).toBe(true);
    }
  });

  it("FIRES when a file MIXES a malformed entry with unevaluable ones", () => {
    // One unreadable entry is enough. A file that is half-broken is not waivable
    // because the other half was merely judgement-only.
    const f = behavioralFindings(
      run({
        filesWithNoCases: ["b.yaml"],
        droppedCases: [
          drop("unevaluable", "every expectation is unevaluable — no mechanical evaluator matched", "c1"),
          drop("malformed", "no `prompt:`", "c2"),
        ],
      }),
      { allowUnevaluated: true, testDirLabel: "t" },
    );
    expect(errors(f).some((m) => m.includes("b.yaml"))).toBe(true);
  });

  it("SILENT HALF: an all-unevaluable file still downgrades to a warning under the flag", () => {
    const droppedCases = [
      drop("unevaluable", "every expectation is unevaluable — no mechanical evaluator matched", "c1"),
      drop("unevaluable", "every expectation is unevaluable — no mechanical evaluator matched", "c2"),
    ];
    const waived = behavioralFindings(
      run({ filesWithNoCases: ["b.yaml"], droppedCases }),
      { allowUnevaluated: true, testDirLabel: "t" },
    );
    expect(
      errors(waived),
      "the flag stopped waiving the judgement gap it exists for",
    ).toEqual([]);
    const named = waived.find((x) => x.message.includes("b.yaml"))!;
    expect(named.level).toBe("warn");
    expect(named.message.startsWith("⚠"), "a waived finding must not wear an error's face").toBe(true);

    // And it is still fatal without the flag — the waiver is a waiver, not a
    // no-op.
    expect(
      errors(behavioralFindings(
        run({ filesWithNoCases: ["b.yaml"], droppedCases }),
        { allowUnevaluated: false, testDirLabel: "t" },
      )).some((m) => m.includes("b.yaml")),
    ).toBe(true);
  });

  it("says COULD NOT BE READ, not 'unevaluable', when the entries were unreadable", () => {
    // Wrong word, wrong remedy: "unevaluable" sends the operator to the waiver
    // flag; the actual fix is the broken YAML.
    const f = behavioralFindings(
      run({ filesWithNoCases: ["b.yaml"], droppedCases: MALFORMED }),
      { allowUnevaluated: true, testDirLabel: "t" },
    );
    const line = f.find((x) => x.message.includes("b.yaml"))!;
    expect(line.message).toMatch(/could NOT BE READ/i);
    expect(line.message).not.toMatch(/every expectation in it is unevaluable/);
    // The entries are NAMED, not counted anonymously — the file loop used to
    // swallow them entirely (the per-case loop skips files in filesWithNoCases).
    expect(line.detail ?? "").toContain("no `prompt:`");
  });

  it("END-TO-END from the parser: a wholly broken YAML file is unwaivable", () => {
    // The fixture goes through parseTestFile so the classifier and the consumer
    // are proven to agree — the pair that drifts when a consumer branches on
    // prose instead of on `kind`.
    const yaml = [
      "persona: alpha",
      "tests:",
      "  - 'a bare string, not a mapping'",
      "  - prompt: has a prompt but no id",
      "  - id: has-an-id-but-no-prompt",
      "  - id: has-both-but-no-expect",
      "    prompt: hello",
    ].join("\n");
    const parsed = parseTestFile(yaml, "b.yaml");
    expect(parsed.cases, "fixture is supposed to yield no runnable case").toEqual([]);
    expect(parsed.droppedCases.length).toBe(4);
    expect(parsed.droppedCases.every((d) => d.kind === "malformed")).toBe(true);

    const f = behavioralFindings(
      run({ filesWithNoCases: ["b.yaml"], droppedCases: parsed.droppedCases }),
      { allowUnevaluated: true, testDirLabel: "tests/behavioral" },
    );
    expect(errors(f).some((m) => m.includes("b.yaml"))).toBe(true);
  });

  it("NEGATIVE: a run with no vacuous files produces no error findings", () => {
    expect(errors(behavioralFindings(run(), { allowUnevaluated: false, testDirLabel: "t" }))).toEqual([]);
  });
});
