/**
 * Regression guards for the capability-gate defect (confirmed 2026-08-07, v0.20.2).
 *
 * The defect: a `guardrail: hard` artifact compiled to platforms that cannot
 * enforce anything landed as ordinary advisory prose — byte-indistinguishable
 * from a soft style preference — behind a green build, a green `validate
 * --strict`, and a green `doctor`. A signed manifest then attested the bytes
 * arrived intact, which they had.
 *
 * The root cause was a split brain: `compile` scanned artifact frontmatter for
 * `guardrail: hard`, while `doctor` derived its enforcement-honesty trigger from
 * four CONFIG keys and never looked at artifacts. The compiler knew; the honesty
 * check never asked.
 *
 * These tests pin the shared predicate and the gate. Per the standing norm — a
 * check that cannot fail is not a check — each asserts BOTH the firing case and
 * the silent case, so a future change that makes the gate vacuous fails here.
 *
 * See docs/research/defect-hard-guardrail-silent-downgrade.md
 */

import { describe, it, expect } from "vitest";
import {
  inspectArtifact,
  unenforceableFormats,
  unenforceableViolations,
  type HardArtifact,
} from "../scripts/lib/guardrail-scan.js";

const hard = (extra = "") =>
  `---\ndescription: x\napplyTo: "**/*"\nguardrail: hard\n${extra}---\n\n# body\n`;
const soft = `---\ndescription: x\napplyTo: "**/*"\n---\n\n# body\n`;

function artifact(over: Partial<HardArtifact> = {}): HardArtifact {
  return { name: "a", kind: "instruction", file: "/x/a.md", acknowledgedAdvisory: false, ...over };
}

describe("inspectArtifact — the shared predicate", () => {
  it("detects guardrail: hard", () => {
    expect(inspectArtifact(hard()).hard).toBe(true);
  });

  it("does NOT fire on a soft artifact", () => {
    // The negative case is the whole point: a predicate that always returns
    // true would make the gate unconditional and equally useless.
    expect(inspectArtifact(soft).hard).toBe(false);
  });

  it("does not fire on content with no frontmatter", () => {
    expect(inspectArtifact("# just a heading\n").hard).toBe(false);
  });

  it("does not treat a mention of the word in prose as a declaration", () => {
    expect(inspectArtifact(`---\ndescription: x\n---\n\nguardrail: hard\n`).hard).toBe(false);
  });

  it("reads the acknowledgement escape hatch", () => {
    expect(inspectArtifact(hard("advisory-on-unenforceable: acknowledged\n")).acknowledgedAdvisory).toBe(true);
    expect(inspectArtifact(hard()).acknowledgedAdvisory).toBe(false);
  });
});

describe("unenforceableFormats", () => {
  it("classifies advisory-only targets", () => {
    expect(unenforceableFormats(["cursor", "agents", "skill"]).sort()).toEqual(
      ["agents", "cursor", "skill"]
    );
  });

  it("does not classify an enforcing target as unenforceable", () => {
    expect(unenforceableFormats(["claude"])).toEqual([]);
  });

  it("FAILS CLOSED on an unknown format", () => {
    // This test previously asserted the opposite — "ignore unknown formats
    // rather than guessing" — and that reasoning shipped a hole. It is correct
    // for a classifier and backwards for a safety gate: any output format
    // missing from PLATFORM_ENFORCEMENT was silently treated as ENFORCING, so
    // a HARD guardrail targeting it passed unchecked. `plugin` was such a
    // format, and the artifact then reached no platform tree at all — a
    // disappearance, strictly worse than the downgrade the gate exists to stop.
    expect(unenforceableFormats(["not-a-platform"])).toEqual(["not-a-platform"]);
  });

  it("classifies plugin as enforcing — verified, not assumed", () => {
    // Confirmed against the real hub: dist/plugin receives instructions AND
    // hooks (agentboot-input-scan.sh, output-scan, telemetry). An unverified
    // row in this table is the same class of error as an unsourced claim.
    expect(unenforceableFormats(["plugin"])).toEqual([]);
  });
});

describe("unenforceableViolations — the gate", () => {
  it("FIRES for a HARD artifact on an advisory-only target", () => {
    const v = unenforceableViolations([artifact()], ["cursor", "agents"]);
    expect(v).toHaveLength(1);
    expect(v[0]!.formats.sort()).toEqual(["agents", "cursor"]);
  });

  it("stays SILENT when every target can enforce", () => {
    expect(unenforceableViolations([artifact()], ["claude"])).toEqual([]);
  });

  it("stays SILENT when the author acknowledged advisory delivery", () => {
    const v = unenforceableViolations([artifact({ acknowledgedAdvisory: true })], ["cursor"]);
    expect(v).toEqual([]);
  });

  it("stays SILENT when there are no HARD artifacts at all", () => {
    expect(unenforceableViolations([], ["cursor", "agents", "skill"])).toEqual([]);
  });

  it("reports every unacknowledged artifact, not just the first", () => {
    // The original defect surfaced one artifact; an operator with twenty needs
    // all twenty, or the fix is a whack-a-mole loop.
    const v = unenforceableViolations(
      [artifact({ name: "a" }), artifact({ name: "b" }), artifact({ name: "c", acknowledgedAdvisory: true })],
      ["cursor"]
    );
    expect(v.map((x) => x.artifact.name).sort()).toEqual(["a", "b"]);
  });

  it("mixed targets still fail — one unenforceable target is enough", () => {
    // The dangerous case: claude enforces, cursor does not, and the artifact
    // ships to both. Partial enforcement is what makes it feel safe.
    const v = unenforceableViolations([artifact()], ["claude", "cursor"]);
    expect(v).toHaveLength(1);
    expect(v[0]!.formats).toEqual(["cursor"]);
  });
});
