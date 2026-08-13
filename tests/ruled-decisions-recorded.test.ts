/**
 * D1 / D3 / D5 / D8 — A RULING NOBODY WROTE DOWN IS INDISTINGUISHABLE FROM SILENCE.
 *
 * Four decisions were ruled on 2026-08-11 and three of them left no trace in the
 * repository. That is its own defect class, and it is the one the E9 repair made
 * normative: an acceptance with no written entry cannot be told apart from a
 * question nobody asked. Six months later the only surviving evidence that
 * `--behavioral` was CUT deliberately — rather than lost in a refactor — is
 * whatever a doc says about it.
 *
 *   D1  `agentboot test --behavioral` is CUT from the v1.0 surface. Three doc
 *       surfaces advertised it, one of them with a "requires LLM, costs money"
 *       flag row. A cut flag still advertised is worse than an undocumented one:
 *       it is a published instruction that fails when followed.
 *
 *   D3  Four descope levers (SessionStart drift hook, `/ab explain`, user-level
 *       MCP writes, conversational import specialist) are v1.1, not 1.0.
 *
 *   D5  The npm dist-tag is `latest`. This one is a RECORD, not a change — and
 *       that is exactly why it went unwritten. The doc claim is checked here
 *       against release.yml rather than trusted, because a record whose subject
 *       silently changes is worse than no record.
 *
 *   D8  RAISE is the 1.0 capability-gate contract: a configured control that
 *       reaches no platform FAILS the build. The code chose it months ago; what
 *       was missing was the written record and the CHANGELOG BREAKING entry
 *       telling adopters their green build will go red.
 *
 * WHY A TEST AND NOT A CHECKLIST. The identical shape has already been shipped
 * on this branch: a v0.20.0 CHANGELOG entry claimed a docs↔CLI parity GATE and
 * delivered a one-time manual sweep wearing a mechanism's name, and the drift
 * resumed the same week. A sweep expires the day it runs.
 *
 * VACUITY GUARDS. This project has shipped a tamper test that passed without
 * tampering and a conformance assertion that passed over an empty set, so every
 * scanner below is asserted ON before it is used: each file is proved readable
 * and non-trivial, and the flag scanner is proved able to SEE a flag of exactly
 * the banned shape (`--snapshot`, which must remain present) before it is asked
 * to report that `--behavioral` is absent. A "no hits" result from a scanner
 * that never matched anything is the failure mode, not the pass.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/** The doc surfaces the D1 cut and the D3/D5/D8 records live on. */
const SURFACES = {
  cliReference: path.join(ROOT, "docs", "cli-reference.md"),
  promptGuide: path.join(ROOT, "docs", "prompt-guide.md"),
  concepts: path.join(ROOT, "docs", "concepts.md"),
  releaseProcess: path.join(ROOT, "docs", "release-process.md"),
  changelog: path.join(ROOT, "CHANGELOG.md"),
} as const;

const RELEASE_YML = path.join(ROOT, ".github", "workflows", "release.yml");

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

/**
 * The `[Unreleased]` section of the CHANGELOG — everything above the first
 * released-version heading.
 *
 * The flag ban is scoped to this section on purpose, and the scoping is a
 * semantic distinction rather than a convenience. A released section is an
 * ARCHIVE: `[0.20.x]` says what v0.20.x did, and v0.20.x really did ship
 * `--behavioral`. Editing that would be falsifying history to make a present-day
 * gate green, which is a worse defect than the one being gated. What must not
 * survive is an OFFER — a line in the notes for the release that withdraws the
 * flag, telling a reader to run it.
 */
/**
 * The body under an `##` heading, up to the next `##` of the same or higher
 * level. Returns "" when the heading is absent — every caller guards on the
 * result before asserting over it.
 */
function sectionUnder(text: string, heading: RegExp): string {
  const m = heading.exec(text);
  if (!m) return "";
  const from = m.index;
  const rest = text.slice(from + m[0].length);
  const next = rest.search(/\n##\s/);
  return next === -1 ? text.slice(from) : text.slice(from, from + m[0].length + next);
}

function unreleasedSection(text: string): string {
  const start = text.indexOf("## [Unreleased]");
  if (start === -1) return "";
  const next = text.slice(start + 1).search(/\n## \[\d/);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/**
 * Occurrences of a CLI flag token, matched as a whole flag rather than as a
 * substring — `--behavioral` must not be reported for `--behavioral-x`, and
 * more importantly a scanner that matches too loosely is a scanner whose
 * negative result means nothing.
 */
function flagHits(text: string, flag: string): Array<{ n: number; line: string }> {
  const re = new RegExp(`${flag}(?![\\w-])`);
  const out: Array<{ n: number; line: string }> = [];
  text.split("\n").forEach((line, i) => {
    if (re.test(line)) out.push({ n: i + 1, line: line.trim() });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 0 · The instruments, before anything is measured with them
// ---------------------------------------------------------------------------

describe("scanner vacuity guards", () => {
  it("every surface is readable and non-trivial", () => {
    for (const [name, file] of Object.entries(SURFACES)) {
      expect(fs.existsSync(file), `${name}: ${path.relative(ROOT, file)} is missing`).toBe(true);
      // Deliberately generous: the point is to catch an empty/truncated file, so
      // that "no banned hits" cannot be produced by there being no content.
      expect(read(file).length, `${name} is suspiciously short`).toBeGreaterThan(2000);
    }
  });

  it("the flag scanner SEES a flag of the banned shape (guards a vacuous absence)", () => {
    // --snapshot is the flag that survives the D1 cut. If the scanner cannot
    // find it, the --behavioral assertions below prove nothing whatsoever.
    expect(flagHits(read(SURFACES.cliReference), "--snapshot").length).toBeGreaterThan(0);
    expect(flagHits(read(SURFACES.promptGuide), "--snapshot").length).toBeGreaterThan(0);
    // And it does not match a longer flag by prefix.
    expect(flagHits("agentboot test --snapshot-file x", "--snapshot")).toEqual([]);
    // And it DOES report the banned token when one is present.
    expect(flagHits("agentboot test --behavioral", "--behavioral").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D1 · the cut flag is advertised nowhere
// ---------------------------------------------------------------------------

describe("D1 — --behavioral is cut from the v1.0 doc surface", () => {
  it("the CHANGELOG's Unreleased section is located (guards the scoped scan)", () => {
    // If this extractor silently returned "", the flag ban over the CHANGELOG
    // below would pass over an empty string — the exact vacuous-pass shape.
    const section = unreleasedSection(read(SURFACES.changelog));
    expect(section.startsWith("## [Unreleased]")).toBe(true);
    expect(section.length).toBeGreaterThan(2000);
    // It really does STOP at the first released section.
    expect(section).not.toMatch(/\n## \[\d/);
    // And the released sections it excludes are non-empty — i.e. the scoping is
    // doing real work rather than being a no-op over a one-version file.
    expect(read(SURFACES.changelog).length - section.length).toBeGreaterThan(2000);
  });

  /**
   * A line that ANNOUNCES the removal, or narrates what an older release did,
   * is not an offer — and the CHANGELOG is the one surface whose job is to say
   * "this is gone". Excluding it wholesale would be weakening the check; the
   * charter is precise and worth honouring literally: *a doc that still OFFERS
   * the flag publishes an instruction that fails when followed.* `is REMOVED`
   * is not an instruction. This mirrors the exemption in
   * `shipped-surfaces-invoke-real-flags.test.ts`, deliberately, so the two
   * detectors do not disagree about what counts as an invocation — two rules
   * for one property is the reader/writer split this branch has eight instances
   * of.
   */
  const ANNOUNCES_REMOVAL = /\bis REMOVED\b|\bremoved\b|withdrawn|deprecated|no longer|unknown option/i;

  it("no owned doc surface offers the flag", () => {
    const offenders: string[] = [];
    for (const [name, file] of Object.entries(SURFACES)) {
      const text = name === "changelog" ? unreleasedSection(read(file)) : read(file);
      for (const hit of flagHits(text, "--behavioral")) {
        if (name === "changelog" && ANNOUNCES_REMOVAL.test(hit.line)) continue;
        offenders.push(`${name} (${path.relative(ROOT, file)}): ${hit.line}`);
      }
    }
    expect(
      offenders,
      "`--behavioral` was ruled CUT from the v1.0 surface on 2026-08-11. A doc that still " +
        "offers it publishes an instruction that fails when followed:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("the CLI reference still documents the deterministic testing that DOES ship", () => {
    // The other direction: deleting the flag must not leave the `test` command
    // undocumented. A cut executed as a silent deletion is its own defect.
    const text = read(SURFACES.cliReference);
    expect(text).toMatch(/##\s+`agentboot test`/);
    expect(flagHits(text, "--regression").length).toBeGreaterThan(0);
    expect(flagHits(text, "--snapshot-file").length).toBeGreaterThan(0);
  });

  it("the cut is stated IN THE TESTING SECTION, not merely enacted", () => {
    // "Withheld explicitly, with a note" — a reader who goes looking for
    // behavioural testing must find out what happened to it, not find nothing.
    //
    // Scoped to the section on purpose. A file-wide search for the disclaimer
    // passes on an unrelated line elsewhere in the same document — prompt-guide.md
    // already carries "planned — not in v1.0" about a different surface entirely,
    // and a first cut of this assertion was satisfied by it while the testing
    // section said nothing at all. A marker in the wrong section reaches no reader.
    for (const [file, heading] of [
      [SURFACES.cliReference, /^##\s+`agentboot test`\s*$/m],
      [SURFACES.promptGuide, /^##\s+6\..*Prompt Testing/m],
    ] as const) {
      const section = sectionUnder(read(file), heading);
      // Vacuity guard: prove the extractor found the RIGHT region before asking
      // it whether the region says something.
      expect(
        section.includes("--snapshot"),
        `the testing section of ${path.relative(ROOT, file)} was not located`,
      ).toBe(true);
      expect(section.length).toBeGreaterThan(400);
      expect(
        /not\s+(?:be\s+)?part of the v1\.0 surface|not in v1\.0|no supported command or flag/i.test(section),
        `${path.relative(ROOT, file)} removed behavioural testing from its testing section without saying so`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D3 · the four descope levers are recorded as v1.1
// ---------------------------------------------------------------------------

describe("D3 — the four descope levers are recorded as v1.1", () => {
  const LEVERS = ["SessionStart", "/ab explain", "MCP writes", "import specialist"];

  it("the CHANGELOG carries a v1.1 deferral section", () => {
    expect(read(SURFACES.changelog)).toMatch(/###\s+Deferred to v1\.1/);
  });

  it("names all four levers", () => {
    const text = read(SURFACES.changelog);
    const missing = LEVERS.filter((l) => !text.includes(l));
    expect(
      missing,
      `Ruled 2026-08-11: all four levers are v1.1. Unrecorded levers: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D5 · the dist-tag record is checked against the workflow, not trusted
// ---------------------------------------------------------------------------

describe("D5 — the npm dist-tag record is `latest`, and it is true", () => {
  it("release-process.md states the dist-tag", () => {
    const text = read(SURFACES.releaseProcess);
    expect(text).toMatch(/##\s+npm dist-tags/);
    expect(text).toMatch(/`latest`/);
  });

  it("release.yml agrees — the publish carries no --tag", () => {
    // The record's whole value is that it describes the shipped mechanic. If
    // someone adds `--tag beta` the doc becomes a false statement, and this is
    // where that is caught rather than at an adopter's `npm install`.
    const yml = read(RELEASE_YML);
    const publishLines = yml.split("\n").filter((l) => l.includes("npm publish"));
    expect(publishLines.length, "no `npm publish` line found in release.yml").toBeGreaterThan(0);
    for (const line of publishLines) {
      expect(
        line,
        "release.yml publishes with an explicit dist-tag; docs/release-process.md says `latest`",
      ).not.toMatch(/--tag\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// D8 · RAISE is written down, and adopters are told their build will go red
// ---------------------------------------------------------------------------

describe("D8 — RAISE is the recorded 1.0 capability-gate contract", () => {
  it("concepts.md carries the dated ruling and the rejected alternative", () => {
    const text = read(SURFACES.concepts);
    expect(text, "concepts.md has no capability-gate section").toMatch(
      /##\s+The capability gate/,
    );
    expect(text, "the ruling is undated — a record with no date cannot be superseded").toMatch(
      /RAISE, ruled 2026-08-11|Ruled 2026-08-11.*RAISE/s,
    );
    // A ruling that does not say what it ruled AGAINST gets relitigated.
    expect(text.toLowerCase()).toContain("rejected");
  });

  it("the CHANGELOG marks it BREAKING and says builds that passed will fail", () => {
    const text = read(SURFACES.changelog);
    const breakingStart = text.indexOf("### BREAKING");
    expect(breakingStart, "the CHANGELOG has no BREAKING section").toBeGreaterThan(-1);
    const nextSection = text.indexOf("\n### ", breakingStart + 1);
    const breaking = text.slice(breakingStart, nextSection === -1 ? undefined : nextSection);
    expect(
      breaking,
      "the capability gate is a RAISE: it turns passing builds red, so it belongs in BREAKING",
    ).toMatch(/capability-gate contract/);
    expect(breaking).toMatch(/RAISE/);
    expect(
      breaking,
      "an adopter must be told their currently-green build will fail",
    ).toMatch(/Builds that used to\s+succeed now fail|used to succeed now fail/);
  });
});
