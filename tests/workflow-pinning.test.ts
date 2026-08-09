/**
 * V6 / CI-PIN — the repo has a de-facto SHA-pin invariant for GitHub Actions
 * with nothing asserting it.
 *
 * Its own disclosed exception is the proof: `actions/upload-artifact@v4` shipped
 * in conformance-baseline.yml behind a `PIN REQUIRED BEFORE MERGE` comment, and
 * nothing went red. Every other `uses:` across all seven workflows carried a
 * 40-character SHA. tests/release-workflow.test.ts reads release.yml and
 * validate.yml only, and never asserts pinning generally.
 *
 * A comment is not a check. Per the standing norm — two lists that must agree
 * will drift, so assert the invariant in code — this enumerates every workflow
 * and every `uses:` in it.
 *
 * WHY PINNING MATTERS HERE SPECIFICALLY: a mutable tag in a workflow that
 * uploads the conformance BASELINE is a supply-chain position. The baseline is
 * the record of observed platform behaviour that cannot be reconstructed after
 * the fact; whoever controls the action that stores it controls the evidence.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const WF_DIR = path.join(ROOT, ".github", "workflows");

interface Use {
  file: string;
  line: number;
  ref: string;
}

function allUses(): Use[] {
  const out: Use[] = [];
  for (const f of fs.readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const lines = fs.readFileSync(path.join(WF_DIR, f), "utf-8").split("\n");
    lines.forEach((line, i) => {
      // Skip commented-out examples — the usage block at the top of
      // agentboot-ci.yml documents how a CONSUMER calls this workflow.
      if (/^\s*#/.test(line)) return;
      const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
      if (m) out.push({ file: f, line: i + 1, ref: m[1]! });
    });
  }
  return out;
}

const USES = allUses();

/**
 * References that are legitimately not SHA-pinned, each with a reason.
 *
 * A local action (`./…`) is this repo's own code at this repo's own commit —
 * pinning it to a SHA would be pinning it to itself. Nothing else belongs here;
 * "we'll pin it later" is what this test exists to prevent.
 */
const isLocal = (ref: string) => ref.startsWith("./") || ref.startsWith("docker://");

describe("V6 — every GitHub Action is pinned to a commit SHA", () => {
  it("the enumeration found the workflows at all — an empty scan is a vacuous check", () => {
    expect(fs.readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n)).length).toBeGreaterThanOrEqual(5);
    expect(USES.length).toBeGreaterThan(10);
  });

  it("V6-1: no `uses:` references a mutable tag or branch", () => {
    const unpinned = USES.filter((u) => !isLocal(u.ref) && !/@[0-9a-f]{40}$/.test(u.ref));
    expect(
      unpinned.map((u) => `${u.file}:${u.line} ${u.ref}`),
      "these actions are pinned to a mutable ref — a tag can be repointed at " +
        "arbitrary code after review"
    ).toEqual([]);
  });

  it("V6-2: every pinned ref carries a human-readable version comment", () => {
    // A bare SHA is unreviewable: nobody can tell v4.6.2 from a typo. The
    // trailing `# v4.6.2` is what makes the pin auditable rather than opaque.
    const missing: string[] = [];
    for (const f of fs.readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
      const lines = fs.readFileSync(path.join(WF_DIR, f), "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        const m = /^\s*(?:-\s*)?uses:\s*(\S+@[0-9a-f]{40})/.exec(line);
        if (!m) return;
        if (!/#\s*\S/.test(line)) missing.push(`${f}:${i + 1} ${m[1]}`);
      });
    }
    expect(missing, `pinned without a version comment: ${missing.join(", ")}`).toEqual([]);
  });

  it("V6-3: the conformance-baseline upload — the one that shipped unpinned — is pinned", () => {
    // Named explicitly because this is the regression, and because a generic
    // assertion passes trivially if the step is ever deleted.
    const wf = fs.readFileSync(path.join(WF_DIR, "conformance-baseline.yml"), "utf-8");
    expect(wf).toContain("actions/upload-artifact@");
    expect(wf).toMatch(/actions\/upload-artifact@[0-9a-f]{40} # v4/);
    expect(wf, "the PIN REQUIRED marker outlived the pin").not.toContain("PIN REQUIRED");
  });
});

/**
 * NF2-5 — the repo's own published GUIDANCE was exempt from the invariant.
 *
 * `.github/workflows/agentboot-ci.yml:9` told adopters
 *
 *     uses: agentboot-dev/agentboot/.github/workflows/agentboot-ci.yml@main
 *
 * inside the file's "Usage in your personas repo" header block, and
 * docs/enterprise-operations.md:179 said the same in a YAML code fence — three
 * lines above a parenthetical advising the reader to pin. `allUses()` skips
 * lines beginning with `#`, and it does not read docs/ at all, so the V6
 * invariant this repo just asserted for itself could not see either one.
 *
 * `@main` is a mutable ref: it re-points under the consumer. That is precisely
 * the supply-chain shape every `uses:` in these workflows is SHA-pinned to
 * avoid, so publishing it as the recommended call is the same defect as an
 * unpinned action, aimed at everyone downstream instead of at us.
 *
 * These are EXAMPLES, so they must stay copy-pasteable — the rule asserted is
 * therefore "not a mutable branch ref", not "a 40-character SHA".
 */
describe("NF2-5 — documented usage examples are pinned too", () => {
  const MUTABLE = /@(main|master|HEAD|latest)$/;

  function documentedRefs(): { where: string; ref: string }[] {
    const out: { where: string; ref: string }[] = [];
    const scan = (file: string, body: string) => {
      body.split("\n").forEach((line, i) => {
        const m = /uses:\s*(\S+)/.exec(line);
        if (m) out.push({ where: `${file}:${i + 1}`, ref: m[1]! });
      });
    };
    // Commented usage blocks inside the workflows themselves...
    for (const f of fs.readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
      scan(path.join(".github/workflows", f), fs.readFileSync(path.join(WF_DIR, f), "utf-8"));
    }
    // ...and the published docs, which is where an adopter actually reads it.
    const docs = path.join(ROOT, "docs");
    if (fs.existsSync(docs)) {
      for (const f of fs.readdirSync(docs).filter((n) => n.endsWith(".md"))) {
        scan(path.join("docs", f), fs.readFileSync(path.join(docs, f), "utf-8"));
      }
    }
    return out;
  }

  const DOCUMENTED = documentedRefs();

  it("the scan found the guidance — an empty list is a vacuous check", () => {
    expect(DOCUMENTED.length).toBeGreaterThan(0);
    expect(
      DOCUMENTED.some((d) => d.ref.includes("agentboot-ci.yml@")),
      "the reusable-workflow usage example dropped out of the scan",
    ).toBe(true);
  });

  it("no documented `uses:` points at a MUTABLE ref", () => {
    const mutable = DOCUMENTED.filter((d) => MUTABLE.test(d.ref) && !d.ref.startsWith("./"));
    expect(
      mutable,
      "AgentBoot tells adopters to consume a workflow at a ref that can re-point " +
        `under them: ${mutable.map((m) => `${m.where} → ${m.ref}`).join(", ")}`,
    ).toEqual([]);
  });
});
