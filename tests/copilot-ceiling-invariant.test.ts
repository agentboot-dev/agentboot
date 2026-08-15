/**
 * The website audit's structural observation, turned into a check.
 *
 * From plans/website-efficacy-audit-2026-08-08.md § "One structural observation":
 *
 *   "Every OVERSTATED item is the same failure: a page that isn't the capability
 *    matrix stating enforcement without the ceiling. platform-capability-matrix.md
 *    is correct, and four other pages correctly restate its caveats — so the
 *    caveats are being COPIED BY HAND, and O1, O2, O4, O5 are the copies that
 *    were missed."
 *
 * The audit proposed a shared MDX partial and called it out of scope. A partial
 * is a real improvement and also a bigger change than the problem: docs/*.md are
 * read raw on GitHub as well as through Docusaurus, and an MDX import breaks the
 * raw view. This is the cheaper half of the same fix and the one this codebase's
 * own norm asks for first — TWO LISTS THAT MUST AGREE WILL DRIFT, so assert the
 * invariant in code instead of maintaining the second list by hand.
 *
 * THE INVARIANT: a published page that says Copilot BLOCKS must, within sight of
 * that claim, carry the ceiling the capability matrix states — exit-2 blocking is
 * documented-but-unverified, and command-hook timeouts fail open.
 *
 * Found by this check when it was written: docs/concepts.md:760 ("all of which
 * block on exit code 2", no ceiling) and docs/getting-started.md:254 ("a HARD
 * guardrail compiles to a blocking hook", no ceiling). Both are now caveated.
 *
 * This is deliberately NOT a ban on mentioning Copilot, and not a rule about
 * where the caveat sits in the file. It fires only on a sentence that asserts
 * blocking, and it accepts either an inline ceiling or a link to the matrix
 * nearby — a stricter rule would fire on the correct pages and get tuned out,
 * which is how a check becomes noise.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

/** The page that DEFINES the ceiling; it is the source, not a copy. */
const SOURCE_OF_TRUTH = "platform-capability-matrix.md";

/**
 * A PARAGRAPH claiming Copilot blocks.
 *
 * Paragraph-scoped, not line-scoped, because Markdown prose wraps: the
 * concepts.md instance this check was written for had "GitHub Copilot" on one
 * line and "all of which block on exit code 2" on the next, and a line-scoped
 * matcher saw neither. A checker whose granularity is finer than the prose it
 * reads is a checker that passes for the wrong reason.
 */
const MENTIONS_COPILOT = /copilot/i;
const CLAIMS_BLOCKING = /blocking hook|block on exit|blocks on exit|exit code 2|exit-2 block/i;

/** Any statement of the ceiling, in the wordings the corpus actually uses. */
const STATES_CEILING =
  /fail open|fails open|fail-open|not yet verified|not yet empirically|have not yet verified|not empirically|platform-capability-matrix/i;

interface Claim {
  file: string;
  line: number;
  text: string;
  covered: boolean;
}

/** Split into paragraphs, keeping each one's starting line number. */
function paragraphs(body: string): { text: string; line: number }[] {
  const lines = body.split("\n");
  const out: { text: string; line: number }[] = [];
  let buf: string[] = [];
  let start = 1;
  const flush = () => {
    if (buf.length > 0) out.push({ text: buf.join("\n"), line: start });
    buf = [];
  };
  lines.forEach((l, i) => {
    if (l.trim() === "") { flush(); start = i + 2; return; }
    if (buf.length === 0) start = i + 1;
    buf.push(l);
  });
  flush();
  return out;
}

/** Every file under `dir` matching `re`, RECURSIVELY. */
function walk(dir: string, re: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, re));
    else if (re.test(e.name)) out.push(abs);
  }
  return out;
}

function findClaims(): Claim[] {
  const out: Claim[] = [];
  const files = fs
    .readdirSync(DOCS)
    .filter((f) => f.endsWith(".md") && f !== SOURCE_OF_TRUTH);
  /**
   * NF4-6: the WEBSITE, all of it — not one hand-listed file.
   *
   * This was `[website/src/pages/index.tsx]`, a single extra path, so
   * website/src/pages/trust.md and for-organizations.md were outside the
   * invariant — two of the four pages the audit itself identified as the
   * correct hand-maintained copies. Regex-stripping "fail open" -> "enforce"
   * and "not yet verified" -> "verified" in both left all three tests green,
   * with for-organizations.md:37 then reading "blocking on exit code 2 —
   * empirically verified on Claude Code and Codex; verified on Copilot".
   *
   * A hand-listed extra is a second list beside `docs/`, and two lists that must
   * agree drift — which is the same finding as NF4-5 one file over. Enumerate
   * the directory instead, so a page added later is covered by default rather
   * than exempt by default.
   */
  const extra = walk(path.join(ROOT, "website", "src", "pages"), /\.(md|mdx|tsx)$/)
    // POSIX separators throughout: these strings are compared against and
    // reported as repo-relative paths, and `path.relative` returns `\` on
    // Windows — which made the scan return nothing there and fired this file's
    // own vacuity guard. Normalising here keeps ONE spelling of a path.
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"));

  for (const rel of [...files.map((f) => path.join("docs", f)), ...extra]) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const paras = paragraphs(fs.readFileSync(abs, "utf-8"));
    paras.forEach((para, idx) => {
      if (!MENTIONS_COPILOT.test(para.text) || !CLAIMS_BLOCKING.test(para.text)) return;
      // The ceiling may sit in the paragraph itself or in the one immediately
      // following it — "…blocks on exit 2." / "Copilot's ceiling: …" is an
      // ordinary and correct way to write it.
      const scope = [para.text, paras[idx + 1]?.text ?? ""].join("\n");
      out.push({
        file: rel,
        line: para.line,
        text: para.text.replace(/\s+/g, " ").trim().slice(0, 120),
        covered: STATES_CEILING.test(scope),
      });
    });
  }
  return out;
}

const CLAIMS = findClaims();

describe("the Copilot enforcement ceiling is restated wherever enforcement is claimed", () => {
  it("the scan found the claims — an empty list is a vacuous check", () => {
    // If a docs restructure moves these pages, this fails rather than passing
    // over nothing. Which is the whole reason the audit's O-items existed.
    expect(CLAIMS.length, "no page claims Copilot blocking — the matcher has drifted").toBeGreaterThan(2);
    for (const anchor of ["docs/concepts.md", "docs/guardrails.md"]) {
      expect(
        CLAIMS.some((c) => c.file === anchor),
        `${anchor} dropped out of the scan`,
      ).toBe(true);
    }
    // NF4-6: the website pages are named, not merely counted. A count-only
    // guard goes green again the moment the directory walk stops matching them,
    // which is the failure this fixes.
    const site = CLAIMS.filter((c) => c.file.startsWith(path.join("website", "src", "pages")));
    expect(
      site.length,
      "no website page is in the scan — the site is the surface an evaluator reads first",
    ).toBeGreaterThan(0);
  });

  it("the source of truth exists and states the ceiling", () => {
    // Every assertion below is about restating THIS. If it stops saying it, the
    // check above is measuring agreement with nothing.
    const matrix = fs.readFileSync(path.join(DOCS, SOURCE_OF_TRUTH), "utf-8");
    expect(matrix).toMatch(/fail-open|fail open/i);
    expect(matrix).toMatch(/not yet empirically|not yet verified/i);
  });

  it("every page claiming Copilot blocks also carries the ceiling", () => {
    const uncovered = CLAIMS.filter((c) => !c.covered);
    expect(
      uncovered,
      "these pages state Copilot enforcement without its ceiling — the caveat is copied " +
        "by hand and these are the copies that were missed:\n" +
        uncovered.map((c) => `  ${c.file}:${c.line}  ${c.text}`).join("\n"),
    ).toEqual([]);
  });
});
