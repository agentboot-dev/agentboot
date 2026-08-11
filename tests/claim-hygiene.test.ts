/**
 * V7 — the efficacy sweep was LINE-targeted, not CLAIM-targeted.
 *
 * The 2026-08-08 website audit named `docs/glossary.md:50` for the phrase "the
 * highest-impact artifact AgentBoot produces". That line was fixed. The
 * IDENTICAL claim in `docs/concepts.md:212` shipped, because the fix was applied
 * to the address rather than to the assertion.
 *
 * A phrase removed for being unsupportable is unsupportable everywhere. This
 * scans the whole published corpus for each banned CLAIM, so the next
 * copy-paste of one goes red instead of surviving in the file nobody grepped.
 *
 * WHAT THIS IS NOT: a style linter. Every entry below was removed by a specific
 * audit finding for a specific reason, and carries that reason. Adding a phrase
 * here because it is unfashionable would turn a real gate into a taste filter,
 * which is how a check becomes noise.
 *
 * The evidence standard being enforced is `market-evidence-ledger.md § C8`
 * (arXiv:2604.11088, >5,000 runs): randomly-selected rules improved a coding
 * agent exactly as much as expert-curated ones (both +13.8pp, Cochran's
 * Q=4.70, p=0.697). Any claim that governance CONTENT measurably improves agent
 * output quality is currently unsupported and leaning against.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/**
 * NF2-2: the published corpus is not `docs/`.
 *
 * The first version of this gate scanned docs/, website/src/pages/,
 * website/static/ and README.md. The banned claim "finds real bugs, not style
 * nits" — the exact string this file's own V7-neg ORIGINALS map quotes as the
 * README line the audit removed — survived at PERSONAS.md:10,
 * core/personas/code-reviewer/persona.config.json:3,
 * core/instructions/agentboot-authoring.instructions.md:91 and
 * core/skills/learn/SKILL.md:206.
 *
 * `core/` is not a private directory. It is in package.json `files`, so it ships
 * in the npm tarball, AND it is a COMPILE INPUT: `grep -rl` over a built dist/
 * found that claim in 33 artifacts across claude, cursor, copilot, gemini,
 * codex and skill — every platform's core/PERSONAS.md, plus
 * dist/claude/core/agents/code-reviewer.md and
 * dist/cursor/core/rules/code-reviewer.mdc — which `sync` then delivers into
 * every spoke repo. The claim was deleted from the doc and
 * left in the product.
 *
 * The root cause the V7 commit named — "a corpus-wide claim policed by file
 * address" — recurred one level up as a corpus-wide claim policed by DIRECTORY
 * ROOT. So the shipped roots are DERIVED from package.json `files` rather than
 * listed here: a new shipped directory is scanned automatically, and it cannot
 * be omitted by whoever adds it.
 */
const SCAN_EXT = new Set([".md", ".mdx", ".tsx", ".ts", ".txt", ".json"]);

/** Directories npm actually ships, read from the manifest rather than remembered. */
function shippedRoots(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as {
    files?: string[];
  };
  return (pkg.files ?? [])
    .filter((f) => !f.startsWith("!"))
    .map((f) => f.replace(/\/$/, ""))
    .filter((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isDirectory());
}

/** Paths inside a shipped root that npm excludes (`!` entries in `files`). */
function shippedExclusions(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as {
    files?: string[];
  };
  return (pkg.files ?? []).filter((f) => f.startsWith("!")).map((f) => f.slice(1).replace(/\/$/, ""));
}

const DOC_ROOTS = ["docs", path.join("website", "src", "pages"), path.join("website", "static")];
/**
 * NF4-5: roots that are PUBLIC COMPILE INPUTS but not npm-packed.
 *
 * The corpus was derived from package.json `files`, which is the right source
 * for "what npm ships" and the wrong one for "what AgentBoot publishes".
 * `domains/` is absent from `files` and is nonetheless a documented compile
 * input in the public repo — the repo ships domains/compliance-template and
 * domains/healthcare-template — and its content reaches every spoke.
 *
 * Measured on a snapshot: `echo battle-tested > domains/zz/ZZ.md` was invisible
 * to this test while the identical line in core/ and templates/ was caught. And
 * it really does ship: a hub with `"domains": ["./domains/zz"]` and an
 * instruction containing "finds real bugs, not style nits" built exit 0 and put
 * the phrase in three dist artifacts (dist/skill, dist/copilot, dist/claude).
 *
 * Same root cause the V7 commit named and NF2-2 named again — "a corpus-wide
 * claim policed by directory root" — one step further out: policed by PACKING
 * MANIFEST. No banned claim is present in domains/ today; this is a gate gap,
 * not a live leak, and it is fixed while it is still cheap.
 */
const COMPILE_INPUT_ROOTS = ["domains"];
/** Repo-root prose that is not in a scanned directory. */
const SCAN_FILES = ["README.md", "PERSONAS.md", "CLAUDE.md", "CHANGELOG.md"];

function publishedFiles(): string[] {
  const out: string[] = [];
  const excluded = shippedExclusions().map((e) => path.join(ROOT, e));
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    if (excluded.some((e) => dir === e || dir.startsWith(`${e}${path.sep}`))) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "build" || e.name === ".docusaurus") continue;
        // dist/ is regenerated from the sources scanned here; scanning it too
        // would report every finding twice and make the corpus depend on
        // whether someone had just run a build.
        if (e.name === "dist") continue;
        walk(p);
      } else if (SCAN_EXT.has(path.extname(e.name))) {
        out.push(p);
      }
    }
  };
  for (const r of [...DOC_ROOTS, ...COMPILE_INPUT_ROOTS, ...shippedRoots()]) walk(path.join(ROOT, r));
  for (const f of SCAN_FILES) out.push(path.join(ROOT, f));
  return [...new Set(out)].filter((f) => fs.existsSync(f));
}

interface BannedClaim {
  /** Human-readable name of the claim, for the test title. */
  phrase: string;
  /**
   * What to match. A string is a case-insensitive substring; a RegExp is used
   * when the claim is a SHAPE rather than a phrase — see U4, where the metric
   * NAMES are legitimate (an org may track bug escape rate from its own
   * incident data) and only a causal PERCENTAGE attributed to them is not.
   * Banning the names would have turned this gate into a taste filter on its
   * first run; it did, and this is the correction.
   */
  match: string | RegExp;
  /** The audit finding that removed it, and why it cannot be supported. */
  reason: string;
}

function findHits(text: string, m: string | RegExp): boolean {
  return typeof m === "string" ? text.toLowerCase().includes(m.toLowerCase()) : m.test(text);
}

const BANNED: BannedClaim[] = [
  {
    phrase: "highest-impact artifact",
    match: "highest-impact artifact",
    reason:
      "U9/V7 — an unmeasured impact ranking. Removed from glossary.md, survived in concepts.md.",
  },
  {
    phrase: "single highest-value extension",
    match: "single highest-value extension",
    reason: "U8 — measured against what? No evaluation exists.",
  },
  {
    phrase: "battle-tested",
    match: "battle-tested",
    reason:
      "U3/U8 — asserts field validation. The ledger records one named non-maintainer ask and no " +
      "adopter; the 2026-08-03 CPO audit found self-authored pilots filed as customer evidence.",
  },
  {
    phrase: "validated in a production implementation",
    match: "validated in a production implementation",
    reason: "U11 — self-authored work recorded as field validation; `[self]` per the ledger.",
  },
  {
    phrase: "one of the most powerful features",
    match: "one of the most powerful features",
    reason: "U10 — an unmeasured strength ranking.",
  },
  {
    phrase: "10x the value",
    match: "10x the value",
    reason: "U6 — an unsourced multiplier on an unmeasurable quantity.",
  },
  {
    phrase: "the only path to true",
    match: "the only path to true",
    reason:
      "O8 — a false superlative contradicted by AgentBoot's OWN alternative delivery method: " +
      "`sync` reaches the same three platforms.",
  },
  {
    phrase: "finds real bugs, not style nits",
    match: "finds real bugs, not style nits",
    reason: "README:73 — an output-quality claim about a persona with no evaluation behind it.",
  },
  {
    phrase: "a causal percentage attributed to an outcome metric",
    // The shape, not the metric name. `-22% (fewer prod bugs)` is the claim;
    // "Bug escape rate | Bugs in prod … | Incident tracking" is a row telling
    // an org to source the number from its OWN system, and is fine.
    match: /(bug escape rate|pr review turnaround|test coverage|onboarding time)\s*:?\s*[-+\u2212]\s*\d+\s*%/i,
    reason:
      "U4 — fabricated causal ROI figures. AgentBoot has no mechanism that reads a bug tracker " +
      "or CI; nothing in the telemetry model produces these numbers, and the direction of the " +
      "claim is what C8 leans against. A reader who screenshots the block has a citable " +
      "\"AgentBoot: -22% bug escape rate\" that cannot be defended.",
  },
  {
    phrase: "enforcement guarantees",
    match: "enforcement guarantees",
    reason:
      "minor-1 — the capability matrix's own taxonomy includes Fail-open and Enforced-with-" +
      "known-bypasses; calling those guarantees undercuts the most careful page on the site.",
  },
];

const FILES = publishedFiles();

describe("V7 — a claim removed for being unsupportable stays removed, everywhere", () => {
  it("the scan found the published corpus — an empty file list is a vacuous check", () => {
    expect(FILES.length).toBeGreaterThan(15);
    // Anchor files, so a restructure that moves docs/ cannot silently empty the scan.
    for (const anchor of ["README.md", path.join("docs", "glossary.md"), path.join("docs", "concepts.md")]) {
      expect(FILES.some((f) => f.endsWith(anchor)), `${anchor} dropped out of the scan`).toBe(true);
    }
  });

  it("NF4-5: the scan covers PUBLIC COMPILE INPUTS npm does not pack", () => {
    // domains/ is absent from package.json `files` and is nonetheless a public,
    // documented compile input whose content reaches every spoke. Named, not
    // counted: a total-count guard goes green again the moment the root stops
    // being walked, which is the failure being fixed.
    const inDomains = FILES.filter((f) => f.includes(`${path.sep}domains${path.sep}`));
    expect(
      inDomains.length,
      "domains/ dropped out of the scan — a banned claim there ships to every spoke",
    ).toBeGreaterThan(0);
  });

  it("NF2-2: the scan covers what npm SHIPS, not just what docusaurus renders", () => {
    // The four files that carried a banned claim while the gate was green. Each
    // is a compile input as well as a tarball member, so a claim here reaches
    // every spoke repo through `sync`.
    for (const anchor of [
      path.join("core", "personas", "code-reviewer", "persona.config.json"),
      path.join("core", "instructions", "agentboot-authoring.instructions.md"),
      path.join("core", "skills", "learn", "SKILL.md"),
      "PERSONAS.md",
    ]) {
      expect(FILES.some((f) => f.endsWith(anchor)), `${anchor} is shipped but not scanned`).toBe(true);
    }
    // And the root set is DERIVED, so a newly-shipped directory is covered
    // without anyone remembering to add it here.
    expect(shippedRoots()).toContain("core");
    expect(shippedRoots()).toContain("templates");
  });

  for (const claim of BANNED) {
    it(`no published file says "${claim.phrase}"`, () => {
      const hits: string[] = [];
      for (const f of FILES) {
        const lines = fs.readFileSync(f, "utf-8").split("\n");
        lines.forEach((line, i) => {
          if (findHits(line, claim.match)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
        });
      }
      expect(hits, `${claim.reason}\n  found at: ${hits.join(", ")}`).toEqual([]);
    });
  }

  it("V7-neg: every matcher actually matches the text it was written for", () => {
    // A corpus scanner that matches nothing is indistinguishable from one whose
    // file list is empty or whose comparison is broken. Each matcher is proven
    // against the exact string(s) the audit quoted.
    //
    // L17: the U4 matcher is a SHAPE, and the audit that removed it quoted FOUR
    // lines, not one. Proving it against a single line proved only that one
    // fabricated figure would go red on re-paste — the other three were as
    // unpinned as any claim the corpus had never scanned. Every original the
    // removing commit (96df3f4) listed is now a proof string, so the whole block
    // is pinned rather than its first row.
    const ORIGINALS: Record<string, string[]> = {
      "highest-impact artifact": ["— making them the HIGHEST-IMPACT ARTIFACT AgentBoot produces."],
      "single highest-value extension": ["They are the single highest-value extension you can add"],
      "battle-tested": ["Battle-tested personas for code review, security analysis"],
      "validated in a production implementation": [
        "This pattern was validated in a production implementation, where",
      ],
      "one of the most powerful features": ["They are one of the most powerful features in AgentBoot because"],
      "10x the value": ["learned to prompt effectively gets 10x the value from the"],
      "the only path to true": ["higher effort but the only path to true multi-agent governance."],
      "finds real bugs, not style nits": [
        "| Code Reviewer | `/review-code` | Finds real bugs, not style nits |",
      ],
      // All four lines of the deleted docs/privacy.md ROI block, verbatim from 96df3f4.
      "a causal percentage attributed to an outcome metric": [
        "  PR review turnaround:    -34% (faster since deployment)",
        "  Bug escape rate:         -22% (fewer prod bugs)",
        "  Test coverage:           +15% (from test generation personas)",
        "  Onboarding time:         -40% (new hires productive faster)",
      ],
      "enforcement guarantees": ["CLI surface for the enforcement guarantees above."],
    };
    for (const claim of BANNED) {
      const originals = ORIGINALS[claim.phrase];
      expect(originals, `no proof string for "${claim.phrase}"`).toBeDefined();
      expect(originals!.length, `empty proof set for "${claim.phrase}"`).toBeGreaterThan(0);
      for (const original of originals!) {
        expect(findHits(original, claim.match), `"${claim.phrase}" does not match: ${original}`)
          .toBe(true);
      }
    }
  });

  it("L17: each of the four fabricated ROI figures is individually caught", () => {
    // Named, not counted. A count assertion goes green again the moment three of
    // the four stop matching, which is the whole failure mode of the line-targeted
    // sweep this file exists to replace.
    const u4 = BANNED.find((c) => c.phrase.startsWith("a causal percentage"))!;
    const FABRICATED: Record<string, string> = {
      "-34% PR review turnaround": "  PR review turnaround:    -34% (faster since deployment)",
      "-22% bug escape rate": "  Bug escape rate:         -22% (fewer prod bugs)",
      "+15% test coverage": "  Test coverage:           +15% (from test generation personas)",
      "-40% onboarding time": "  Onboarding time:         -40% (new hires productive faster)",
    };
    for (const [figure, line] of Object.entries(FABRICATED)) {
      expect(findHits(line, u4.match), `${figure} would survive a re-paste`).toBe(true);
    }
    // And the whole block, re-pasted as one chunk, is caught on every line — the
    // realistic regression is a copy-paste of the block, not of one row.
    const block = Object.values(FABRICATED);
    expect(block.filter((l) => findHits(l, u4.match)).length).toBe(4);
  });

  it("V7-neg2: the U4 matcher does NOT fire on a legitimate metric row", () => {
    // The first version of this gate banned the metric NAMES and flagged four
    // honest lines that tell an org to source the number from its own incident
    // tracking. A gate that fires on the correct text is how a channel gets
    // tuned out — the same reasoning the scope gate uses for UNIVERSAL_GLOBS.
    const u4 = BANNED.find((c) => c.phrase.startsWith("a causal percentage"))!;
    for (const ok of [
      "- You see bug escape rates, not their Stack Overflow search history",
      "| **Bug escape rate** | Bugs in prod that a persona should have caught | Incident tracking |",
      "| Bug escape rate | Low | Varies | Medium |",
    ]) {
      expect(findHits(ok, u4.match), `false positive on: ${ok}`).toBe(false);
    }
  });
});
