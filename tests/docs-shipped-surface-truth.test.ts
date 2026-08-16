/**
 * L13 / L15 / L16 — THE DOCS MUST NOT ASSERT A SURFACE v1.0 DOES NOT HAVE.
 *
 * Three instances of one defect class, and the class is the product's own:
 * a green surface over a thing that is not there. A tag freezes prose into a
 * standing assertion, and an evaluator who greps the docs and then greps
 * `--help` is exactly the reader these three failed.
 *
 *   L13  `docs/prompt-guide.md` described `/insights`, `agentboot metrics` and
 *        the org dashboard in the PRESENT TENSE AS SHIPPED at eight sites,
 *        while one line in the same file said they were planned. None of the
 *        three exists: `git grep -rn insights -- core/ scripts/ templates/`
 *        returns nothing, and `cli.ts` declares no `metrics` command.
 *
 *   L15  `docs/delivery-methods.md` labelled the `gemini/` and `jetbrains/`
 *        emitter trees "(planned)" when `compile.ts` has emitted both since
 *        AB-144 / AB-158. Advertising a shipped surface as unbuilt is the same
 *        untruth pointing the other way, and it costs adoption rather than
 *        credibility.
 *
 *   L16  `core/skills/learn/faq.md` promised gotchas were "shareable across
 *        organizations via the marketplace" — and that file PACKS INTO THE NPM
 *        TARBALL, so the promise ships to every installer — while the
 *        marketplace/registry subsystem is `{ hidden: true }` in v1.0.
 *        `docs/org-connection.md` described installing "the generic AgentBoot
 *        plugin from a public marketplace" as a workflow step.
 *
 * WHY A TEST AND NOT A SWEEP. The v0.20.0 CHANGELOG claimed a docs↔CLI parity
 * GATE and shipped a one-time manual sweep wearing a mechanism's name; the drift
 * resumed the same week. A sweep expires on the day it runs. These assertions are
 * DERIVED — the shipped-emitter set comes out of `compile.ts` and the hidden-command
 * set comes out of `cli.ts` — so a surface that ships next quarter, or gets hidden
 * next quarter, is covered without anyone remembering to extend a list.
 *
 * VACUITY GUARDS. Every extractor here is asserted on before it is used. This
 * branch has already shipped a tamper test that passed without tampering and a
 * conformance assertion that passed over an empty set, so a corpus scanner that
 * silently matches nothing is a known-live failure mode, not a hypothetical one.
 * Each `describe` below opens with the guard that makes its assertion non-vacuous:
 * a plausible hit count, a known-shipped emitter, a known-hidden command, and a
 * POSITIVE CONTROL that feeds the compliance checker a deliberately unmarked line
 * and requires it to be reported as a violation.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const CORE = path.join(ROOT, "core");
const PROMPT_GUIDE = path.join(DOCS, "prompt-guide.md");
const DELIVERY_METHODS = path.join(DOCS, "delivery-methods.md");
const COMPILE_SRC = path.join(ROOT, "scripts", "compile.ts");
const CLI_SRC = path.join(ROOT, "scripts", "cli.ts");

// ---------------------------------------------------------------------------
// Corpus helpers
// ---------------------------------------------------------------------------

/**
 * Every tracked `.md` under `docs/` EXCEPT `docs/_archive/`. The archive is the
 * sanctioned home for cut surfaces — `docs/_archive/marketplace.md` opens with
 * "ARCHIVED — not part of v1.0" and exists precisely so the marketplace design
 * is withheld explicitly rather than deleted silently. Scanning it would punish
 * the honest disposition.
 */
function liveDocs(): string[] {
  return walk(DOCS).filter((p) => p.endsWith(".md") && !p.includes(`${path.sep}_archive${path.sep}`));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(p: string): string {
  return path.relative(ROOT, p);
}

// ---------------------------------------------------------------------------
// L13 · unshipped surfaces must be marked, everywhere they are named
// ---------------------------------------------------------------------------

/**
 * Surfaces the docs discuss at length that v1.0 does not ship. Each is proved
 * unshipped below rather than asserted — if one of them ships, the guard fails
 * and tells you to DROP the planned markers, which is the failure you want.
 */
const UNSHIPPED_SURFACES = [
  { token: "/insights", label: "/insights" },
  { token: "agentboot metrics", label: "agentboot metrics" },
] as const;

/**
 * A line is honest about an unshipped surface if it says so. Kept deliberately
 * broad — the point is that the reader is told, not that a particular phrasing
 * was used — and narrow enough that a plain present-tense sentence fails.
 */
const MARKER =
  /\bplanned\b|\bunbuilt\b|\bnot shipped\b|\bnot in v1\.0\b|\bdoes not exist\b|\bdo not exist\b|\bnot yet\b|\bwould\b|\bwill\b|\bV1\.5\b|\bV2\b/i;

/** Headings and fenced-block boundaries, so a code block can inherit its section's marker. */
interface LineContext {
  line: string;
  /** Nearest preceding non-blank line. */
  prev: string;
  /** Nearest preceding ATX heading, or "" if none. */
  heading: string;
  inFence: boolean;
}

function contextualise(text: string): LineContext[] {
  const lines = text.split("\n");
  const out: LineContext[] = [];
  let heading = "";
  let inFence = false;
  let prev = "";
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence && /^#{1,6}\s/.test(line)) heading = line;
    out.push({ line, prev, heading, inFence });
    if (line.trim() !== "") prev = line;
  }
  return out;
}

/**
 * Lines naming `token` that carry no honesty marker on the line itself, on the
 * nearest preceding non-blank line (prose wraps), or on the enclosing heading
 * (a fenced example inherits the section that introduced it).
 */
function unmarkedMentions(text: string, token: string): Array<{ n: number; line: string }> {
  const bad: Array<{ n: number; line: string }> = [];
  contextualise(text).forEach((ctx, i) => {
    if (!ctx.line.includes(token)) return;
    if (MARKER.test(ctx.line)) return;
    if (MARKER.test(ctx.prev)) return;
    if (MARKER.test(ctx.heading)) return;
    bad.push({ n: i + 1, line: ctx.line.trim() });
  });
  return bad;
}

describe("L13 — unshipped surfaces are never described as shipped", () => {
  it("proves the surfaces really are unshipped (guards against marking a shipped thing planned)", () => {
    // `/insights` — no skill, no command, nowhere in the shipped trees.
    const shippedTrees = [path.join(ROOT, "core"), path.join(ROOT, "scripts"), path.join(ROOT, "templates")];
    const insightsHits = shippedTrees
      .filter((d) => fs.existsSync(d))
      .flatMap((d) => walk(d))
      .filter((p) => fs.readFileSync(p, "utf-8").includes("/insights"));
    expect(
      insightsHits.map(rel),
      "`/insights` now appears in a shipped tree — if it SHIPPED, drop the (planned) markers " +
        "in docs/prompt-guide.md and delete this expectation rather than loosening it.",
    ).toEqual([]);

    // `agentboot metrics` — cli.ts declares no such command.
    const cli = fs.readFileSync(CLI_SRC, "utf-8");
    expect(/\.command\(\s*"metrics"/.test(cli)).toBe(false);
    // …and the extractor is looking at the right file: commands that DO exist.
    expect(/\.command\(\s*"cost-estimate"/.test(cli)).toBe(true);
    expect(/\.command\(\s*"lint"/.test(cli)).toBe(true);
  });

  it("finds a plausible number of mentions to check (guards against a vacuous pass)", () => {
    const text = fs.readFileSync(PROMPT_GUIDE, "utf-8");
    const total = UNSHIPPED_SURFACES.reduce(
      (n, s) => n + text.split("\n").filter((l) => l.includes(s.token)).length,
      0,
    );
    // 16 lines named one of the two when this gate was written. A path or
    // splitting mistake drops this to zero and must go red here rather than let
    // the assertion below pass over an empty set.
    expect(total).toBeGreaterThanOrEqual(12);
  });

  it("POSITIVE CONTROL — the checker reports an unmarked mention", () => {
    // A check that cannot fail is not a check. Feed it prose of exactly the
    // shape this row existed to catch and require a violation.
    const synthetic = ["# Section", "", "Run `/insights` to see your rephrase rate.", ""].join("\n");
    expect(unmarkedMentions(synthetic, "/insights").length).toBe(1);
    // …and the marked form is accepted, so the checker is not merely always-red.
    const marked = ["# Section", "", "`/insights` (planned) would show your rephrase rate.", ""].join("\n");
    expect(unmarkedMentions(marked, "/insights")).toEqual([]);
  });

  /**
   * A KNOWN HOLE, NAMED RATHER THAN EXCLUDED (gsd-norms "Sanitize, Don't Ghost").
   *
   * `docs/privacy.md` describes `/insights` in the present tense at 14 sites —
   * the identical defect, in a file outside L13's stated scope and outside this
   * fixer's file ownership. Quietly excluding it would make the gate report
   * green over a corpus that still asserts the surface exists, which is the
   * exact shape this file exists to catch.
   *
   * So it is recorded here with a CEILING instead: the hole may shrink to zero
   * (whoever fixes privacy.md gets a green run and can delete this entry) but it
   * may not grow, and it may not spread to a file not on this list.
   */
  const KNOWN_HOLES: Record<string, number> = { "docs/privacy.md": 14 };

  it("every mention across docs/ carries an honesty marker", () => {
    const byFile = new Map<string, string[]>();
    for (const file of liveDocs()) {
      const text = fs.readFileSync(file, "utf-8");
      for (const surface of UNSHIPPED_SURFACES) {
        for (const hit of unmarkedMentions(text, surface.token)) {
          const key = rel(file).split(path.sep).join("/");
          if (!byFile.has(key)) byFile.set(key, []);
          byFile.get(key)!.push(`${key}:${hit.n} names ${surface.label} — ${hit.line}`);
        }
      }
    }

    const unexpected = [...byFile.entries()]
      .filter(([file]) => !(file in KNOWN_HOLES))
      .flatMap(([, lines]) => lines);
    expect(
      unexpected,
      `These lines describe a surface v1.0 does not ship, with nothing telling the reader so:\n` +
        unexpected.join("\n"),
    ).toEqual([]);

    for (const [file, ceiling] of Object.entries(KNOWN_HOLES)) {
      const count = byFile.get(file)?.length ?? 0;
      expect(
        count,
        `${file} is a recorded hole capped at ${ceiling} unmarked mentions and now has ${count}. ` +
          `If it went DOWN, delete or lower its KNOWN_HOLES entry — the cap must never overstate the debt.`,
      ).toBeLessThanOrEqual(ceiling);
      expect(
        count,
        `${file} no longer has unmarked mentions — remove it from KNOWN_HOLES so the gate goes strict.`,
      ).toBeGreaterThan(0);
    }
  });

  it("the files this row owns have ZERO unmarked mentions", () => {
    // L13's acceptance is about prompt-guide.md; asserted separately so the
    // ceiling above can never be read as covering the row's own scope.
    const owned = ["docs/prompt-guide.md", "docs/delivery-methods.md", "docs/org-connection.md"];
    const violations: string[] = [];
    for (const relPath of owned) {
      const text = fs.readFileSync(path.join(ROOT, relPath), "utf-8");
      for (const surface of UNSHIPPED_SURFACES) {
        for (const hit of unmarkedMentions(text, surface.token)) {
          violations.push(`${relPath}:${hit.n} names ${surface.label} — ${hit.line}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("prompt-guide.md keeps ONE authoritative status statement", () => {
    // "One tense in one place": the per-mention markers say *that* a thing is
    // unbuilt; exactly one table says *when* it is planned for. Two schedules
    // is how the file came to contradict itself in the first place.
    const text = fs.readFileSync(PROMPT_GUIDE, "utf-8");
    const scheduleRows = text
      .split("\n")
      .filter((l) => /^\|\s*`?\/insights/.test(l.trim()) || /^\|\s*`agentboot metrics`/.test(l.trim()));
    expect(scheduleRows.length, "each surface should have exactly one schedule row").toBe(2);
    expect(text).toContain("## What AgentBoot Needs to Build");
  });
});

// ---------------------------------------------------------------------------
// L15 · shipped emitters must not be advertised as unbuilt
// ---------------------------------------------------------------------------

/** Output formats `compile.ts` actually emits, read out of the emitter guards. */
function shippedEmitters(): string[] {
  const src = fs.readFileSync(COMPILE_SRC, "utf-8");
  const re = /outputFormats\.includes\(\s*"([a-z0-9-]+)"\s*\)/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]!);
  return [...out];
}

describe("L15 — a shipped emitter is never labelled (planned)", () => {
  it("derives the emitter set from compile.ts (guards against a vacuous pass)", () => {
    const emitters = shippedEmitters();
    expect(emitters.length).toBeGreaterThanOrEqual(5);
    // The two the row is about, plus three that were never in doubt — if the
    // regex breaks, the set empties and this goes red instead of the assertion
    // below passing over nothing.
    for (const known of ["gemini", "jetbrains", "copilot", "cursor", "agents"]) {
      expect(emitters, `compile.ts should still emit ${known}`).toContain(known);
    }
  });

  it("no docs/ line labels a shipped emitter tree (planned)", () => {
    const emitters = shippedEmitters();
    const violations: string[] = [];
    for (const file of liveDocs()) {
      fs.readFileSync(file, "utf-8")
        .split("\n")
        .forEach((line, i) => {
          if (!/\(planned\)/i.test(line)) return;
          for (const fmt of emitters) {
            // `gemini/` in a tree listing, or `dist/gemini`, or a bare mention.
            if (new RegExp(`\\b${fmt}\\b`, "i").test(line)) {
              violations.push(`${rel(file)}:${i + 1} calls the shipped \`${fmt}\` emitter planned — ${line.trim()}`);
            }
          }
        });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L16 · nothing promises a surface v1.0 hides
// ---------------------------------------------------------------------------

/** Commands declared `{ hidden: true }` — the surfaces `--help` does not advertise. */
function hiddenCommands(): string[] {
  const src = fs.readFileSync(CLI_SRC, "utf-8");
  const re = /\.command\(\s*"([^"]+)"\s*,\s*\{([^}]*)\}\s*\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (/\bhidden\s*:\s*true\b/.test(m[2]!)) out.push(m[1]!.split(/\s+/)[0]!);
  }
  return [...new Set(out)];
}

describe("L16 — shipped artifacts do not promise hidden surfaces", () => {
  it("finds the hidden-command set (guards against a vacuous pass)", () => {
    const hidden = hiddenCommands();
    expect(hidden.length).toBeGreaterThanOrEqual(4);
    // The marketplace subsystem is the surface v1.0 cut; if these stop reading
    // as hidden, the assertion below would pass for the wrong reason.
    for (const known of ["marketplace", "registry", "publish"]) {
      expect(hidden, `${known} should still be hidden in cli.ts`).toContain(known);
    }
  });

  it("the npm-packed core/ tree never mentions the marketplace", () => {
    // `core/skills/learn/faq.md` ships inside the tarball, so a promise made
    // here is a promise made to every installer — which is why this half of the
    // row is the strict one: zero mentions, not "mentions with a caveat".
    const coreFiles = walk(CORE).filter((p) => p.endsWith(".md"));
    expect(coreFiles.length, "the core/ walker should find the shipped markdown").toBeGreaterThanOrEqual(10);
    // Proof the walker reads CONTENT and not just names.
    expect(
      coreFiles.some((p) => /gotcha/i.test(fs.readFileSync(p, "utf-8"))),
      "core/ markdown should still discuss gotchas",
    ).toBe(true);

    const offenders = coreFiles.filter((p) => /marketplace/i.test(fs.readFileSync(p, "utf-8")));
    expect(
      offenders.map(rel),
      "These files pack into the npm tarball and name a surface v1.0 hides",
    ).toEqual([]);
  });

  it("docs/ gives no instruction that invokes a hidden command", () => {
    const hidden = hiddenCommands();
    const violations: string[] = [];
    for (const file of liveDocs()) {
      fs.readFileSync(file, "utf-8")
        .split("\n")
        .forEach((line, i) => {
          for (const cmd of hidden) {
            if (new RegExp(`agentboot\\s+${cmd}\\b`).test(line)) {
              violations.push(`${rel(file)}:${i + 1} instructs \`agentboot ${cmd}\`, a hidden surface — ${line.trim()}`);
            }
          }
        });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("docs/org-connection.md does not present the unpublished core plugin as installable", () => {
    // The specific L16 site: Model B opened with a flat present-tense sentence
    // and only qualified it a paragraph later, so a skimming reader took the
    // first line as the procedure.
    const text = fs.readFileSync(path.join(DOCS, "org-connection.md"), "utf-8");
    expect(text).not.toMatch(/^Developer installs the generic AgentBoot plugin from a public marketplace/m);
    expect(text).toMatch(/AgentBoot does not publish such a plugin/);
  });
});
