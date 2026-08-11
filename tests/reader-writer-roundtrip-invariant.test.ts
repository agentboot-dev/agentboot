/**
 * L1 — THE READER/WRITER ROUND-TRIP INVARIANT.
 *
 * This is a mechanism, not another instance patch. It exists because the same
 * defect class produced SIX instances on this branch and every single one was
 * caught by a person reading code or by an adversarial agent — never by a test:
 *
 *   1. F-6      the scope reader learned CRLF/BOM normalization; the guardrail
 *               copy did not, so a CRLF artifact reported "no scope" and a rule
 *               scoped to `src/api/**` was delivered always-on. Exit 0.
 *   2. NF-4     the reader's single-line regex crossed the newline, capturing
 *               `- "src/db/**"` as one glob and dropping the rest — which was
 *               then interpolated verbatim into emitted frontmatter that no YAML
 *               parser accepts.
 *   3. NF2-3    flow sequences and block scalars: the reader was taught; nothing
 *               else was.
 *   4. R4N-1    the fix for F-6 anchored `applyTo:` at column 0, so an INDENTED
 *               but valid key yielded no scope at all — the fix for F-6
 *               reintroduced F-6.
 *   5. NEW4-1   the reader learned that a wrapped flow sequence spans lines; the
 *               REWRITER did not, so the trailing `]` survived a key replacement
 *               and the emitted frontmatter was invalid YAML on Copilot and
 *               JetBrains, both v1.0 GA targets.
 *   6. R4V-1    the blocking-hook helper checked "is the payload an object"; the
 *               extractor never checked "does the field exist", so a gate passed
 *               on a payload it could not read.
 *
 * Every one is the same shape: ONE HALF OF A PAIR WAS TAUGHT SOMETHING THE OTHER
 * HALF WAS NOT. Patching instance seven does not close the class; asserting that
 * the halves agree does.
 *
 * THE PROPERTY, stated once:
 *
 *     The writer must consume EXACTLY the span the reader read.
 *
 * Consume less and residue survives — an orphaned `]`, a stray `- "src/db/**"` —
 * which is invalid YAML in the emitted artifact (NEW4-1). Consume more and an
 * adjacent key is eaten, silently discarding governance the operator wrote. Both
 * directions are asserted below, over every YAML value form the parser accepts
 * and every form this product's own documentation teaches authors to write.
 *
 * WHY THE ASSERTIONS ARE SHAPED THIS WAY. Checking for leftover substrings would
 * pass on a rewrite that produced syntactically valid junk. So instead each case
 * re-parses the rewritten frontmatter with a real YAML parser and compares the
 * WHOLE key set against the original: under-consumption fails the parse or adds a
 * key, over-consumption removes one. That is the invariant an operator actually
 * depends on, rather than a proxy for it.
 *
 * PROVEN TO BITE. Reverting either half to its pre-fix implementation turns this
 * red — measured, not assumed; see `docs/plans/ga-cut-list` L1's acceptance test.
 * A test that cannot fail is not a test, and this branch has already shipped one
 * that passed vacuously.
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { readScopeGlobs, rewriteFrontmatterKeyBlock } from "../scripts/lib/scope-projection.js";
import { frontmatterBlock, parseFrontmatter } from "../scripts/lib/frontmatter.js";

type ScopeKey = "applyTo" | "paths";

interface Form {
  name: string;
  /** The frontmatter value as authored, key line included. */
  value: string;
  /** Globs the reader is expected to produce. */
  expect: string[];
  /** True when the form is legal YAML the reader must refuse rather than guess. */
  malformed?: boolean;
  /** Line endings / byte-order mark applied to the whole artifact. */
  transform?: (s: string) => string;
}

/**
 * Every value form below is either (a) ordinary YAML, (b) a form this repo's own
 * docs teach — `paths: ["packages/api-service/**"]` at docs/concepts.md — or
 * (c) the exact input that produced one of the six instances above.
 */
const FORMS: Form[] = [
  { name: "plain quoted scalar", value: `applyTo: "src/api/**"`, expect: ["src/api/**"] },
  { name: "unquoted scalar", value: `applyTo: src/api/**`, expect: ["src/api/**"] },
  { name: "single-quoted scalar", value: `applyTo: 'src/api/**'`, expect: ["src/api/**"] },
  {
    name: "scalar with a trailing inline comment",
    value: `applyTo: "src/**"  # activation scope`,
    expect: ["src/**"],
  },
  {
    name: "brace group — ONE glob, must not split on its comma",
    value: `applyTo: "src/**/*.{ts,tsx}"`,
    expect: ["src/**/*.{ts,tsx}"],
  },
  {
    name: "character class — a glob may legitimately contain [",
    value: `applyTo: "src/[abc]*.ts"`,
    expect: ["src/[abc]*.ts"],
  },
  {
    name: "comma-separated scalar",
    value: `applyTo: "src/db/**, src/auth/**"`,
    expect: ["src/db/**", "src/auth/**"],
  },
  {
    name: "flow sequence, single line (NF2-3)",
    value: `applyTo: ["src/db/**", "src/auth/**"]`,
    expect: ["src/db/**", "src/auth/**"],
  },
  {
    name: "flow sequence, WRAPPED across lines (NEW4-1 — closes at the key's own indent)",
    value: `applyTo: [\n  "src/db/**",\n  "src/auth/**",\n]`,
    expect: ["src/db/**", "src/auth/**"],
  },
  {
    name: "flow sequence, wrapped, containing a character class",
    value: `applyTo: [\n  "src/[abc]*.ts",\n  "src/auth/**",\n]`,
    expect: ["src/[abc]*.ts", "src/auth/**"],
  },
  {
    name: "block sequence (NF-4)",
    value: `applyTo:\n  - "src/db/**"\n  - "src/auth/**"`,
    expect: ["src/db/**", "src/auth/**"],
  },
  {
    name: "block scalar, folded (NF2-3) — line-per-glob",
    value: `applyTo: >\n  src/api/**\n  src/db/**`,
    expect: ["src/api/**", "src/db/**"],
  },
  {
    name: "block scalar, literal (NF2-3)",
    value: `applyTo: |\n  src/api/**\n  src/db/**`,
    expect: ["src/api/**", "src/db/**"],
  },
  {
    name: "CRLF line endings (F-6 — normalization must not be one-sided)",
    value: `applyTo: "src/api/**"`,
    expect: ["src/api/**"],
    transform: (s) => s.replace(/\n/g, "\r\n"),
  },
  {
    name: "BOM prefix (F-6)",
    value: `applyTo: "src/api/**"`,
    expect: ["src/api/**"],
    transform: (s) => "﻿" + s,
  },
  {
    name: "BOM + CRLF together",
    value: `applyTo:\n  - "src/db/**"\n  - "src/auth/**"`,
    expect: ["src/db/**", "src/auth/**"],
    transform: (s) => "﻿" + s.replace(/\n/g, "\r\n"),
  },
];

/**
 * An artifact with keys on BOTH sides of the scope key. Over-consumption is
 * invisible unless something is standing there to be eaten — the block-scalar
 * and block-sequence consume loops are exactly where that risk lives.
 */
function artifact(valueBlock: string): string {
  return [
    "---",
    "id: 01JQZX9K2M4N6P8R0T2V4W6Y8A",
    "classification: gotcha",
    valueBlock,
    "guardrail: hard",
    "owner: platform-team",
    "---",
    "",
    "# Body",
    "",
    "Prose that must survive untouched.",
    "",
  ].join("\n");
}

/** Keys present in a frontmatter block, per a real YAML parse. */
function keysOf(content: string): Record<string, unknown> {
  const block = frontmatterBlock(content);
  expect(block, "frontmatter block must be extractable").not.toBeNull();
  const parsed = yaml.load(block!);
  expect(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "frontmatter must parse to a mapping",
  ).toBe(true);
  return parsed as Record<string, unknown>;
}

describe("reader/writer round-trip invariant — scope key", () => {
  const KEY: ScopeKey = "applyTo";

  for (const form of FORMS) {
    describe(form.name, () => {
      const raw = artifact(form.value);
      const content = form.transform ? form.transform(raw) : raw;

      it("the reader produces the authored globs", () => {
        const read = readScopeGlobs(content, KEY);
        expect(read.malformed).toBeNull();
        expect(read.globs).toEqual(form.expect);
      });

      it("read → write → read is stable (the writer consumed no LESS than the reader read)", () => {
        const first = readScopeGlobs(content, KEY);
        const rewritten = rewriteFrontmatterKeyBlock(
          content,
          KEY,
          `${KEY}: ${JSON.stringify(first.globs)}`,
        );
        const second = readScopeGlobs(rewritten, KEY);

        expect(second.malformed).toBeNull();
        expect(second.globs).toEqual(first.globs);
      });

      it("the rewritten frontmatter is valid YAML (NEW4-1: an orphaned `]` is not)", () => {
        const first = readScopeGlobs(content, KEY);
        const rewritten = rewriteFrontmatterKeyBlock(
          content,
          KEY,
          `${KEY}: ${JSON.stringify(first.globs)}`,
        );
        // The failure this catches emitted `globs: [...]` followed by a bare `]`
        // or a stray `- "src/db/**"`. js-yaml rejects both; a substring check
        // would not have.
        expect(() => keysOf(rewritten)).not.toThrow();
      });

      it("every sibling key survives, unchanged (the writer consumed no MORE than the reader read)", () => {
        const before = keysOf(content);
        const first = readScopeGlobs(content, KEY);
        const rewritten = rewriteFrontmatterKeyBlock(
          content,
          KEY,
          `${KEY}: ${JSON.stringify(first.globs)}`,
        );
        const after = keysOf(rewritten);

        // Same key SET — a missing key means the consume loop ate its neighbour,
        // an extra key means residue was re-parsed as one.
        expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

        for (const k of Object.keys(before)) {
          if (k === KEY) continue;
          expect(after[k], `sibling key \`${k}\` must be untouched`).toEqual(before[k]);
        }
      });

      it("the body survives the rewrite", () => {
        const first = readScopeGlobs(content, KEY);
        const rewritten = rewriteFrontmatterKeyBlock(
          content,
          KEY,
          `${KEY}: ${JSON.stringify(first.globs)}`,
        );
        expect(rewritten).toContain("Prose that must survive untouched.");
      });

      it("rewriting is idempotent", () => {
        const first = readScopeGlobs(content, KEY);
        const once = rewriteFrontmatterKeyBlock(
          content,
          KEY,
          `${KEY}: ${JSON.stringify(first.globs)}`,
        );
        const twice = rewriteFrontmatterKeyBlock(
          once,
          KEY,
          `${KEY}: ${JSON.stringify(readScopeGlobs(once, KEY).globs)}`,
        );
        expect(twice).toBe(once);
      });

      it("deletion removes the whole span and leaves valid YAML", () => {
        const deleted = rewriteFrontmatterKeyBlock(content, KEY, null);
        const after = keysOf(deleted);

        expect(after).not.toHaveProperty(KEY);
        // The residue class again: deleting a wrapped flow sequence must not
        // leave its closing bracket behind.
        expect(after).toHaveProperty("guardrail");
        expect(after).toHaveProperty("owner");
        expect(readScopeGlobs(deleted, KEY).globs).toEqual([]);
      });
    });
  }
});

describe("reader/writer agreement on the forms that must FAIL CLOSED", () => {
  const KEY: ScopeKey = "applyTo";

  /**
   * R4N-1. The column-0 anchor is CORRECT — a key at another indent is nested
   * under some other mapping, or is the CONTENT of a block scalar, and in both
   * cases it belongs to someone else. The defect was the SILENCE beside it: an
   * indented key produced no scope, and "no scope" means always-on.
   *
   * So the invariant here is not "read it anyway". It is that the two halves
   * agree about ownership: if the reader refuses to claim the value, the writer
   * must not rewrite it either.
   */
  it("an indented key is reported malformed, not as an absent scope", () => {
    const content = artifact(`  applyTo: "src/api/**"`);
    const read = readScopeGlobs(content, KEY);

    expect(read.malformed, "an indented key must not silently mean always-on").not.toBeNull();
    expect(read.globs).toEqual([]);
  });

  /**
   * INSTANCE SEVEN — found by this file on the day it was written, which is the
   * whole argument for building the mechanism instead of patching instance six.
   *
   * R4N-1 landed the indented-key check in `inspectScope`. But `inspectScope` is
   * only ever called for `applyTo`: every `paths` read in the product goes
   * straight through `readScopeGlobs` — five platform emitters, the
   * sensitive-globs collector, and the `malformed` gates in validate.ts and
   * compile.ts. So an indented `paths:` returned "no scope", and no scope means
   * always-on. Build exit 0, no diagnostic, on five v1.0 targets.
   *
   * The fix is in the SHARED reader, not in a second caller, because a check
   * that lives in one caller of one key is the split itself.
   */
  it("BOTH scope keys fail closed on an indented key — not just the one that had a bug filed", () => {
    for (const key of ["applyTo", "paths"] as const) {
      const content = artifact(`  ${key}: "src/api/**"`);
      const read = readScopeGlobs(content, key);

      expect(read.malformed, `\`${key}\` must fail closed on an indented key`).not.toBeNull();
      expect(read.malformed).toContain(key);
      expect(read.globs).toEqual([]);
      expect(read.raw, "the declined value is reported so the operator can see it").not.toBeNull();
    }
  });

  it("the two keys are indistinguishable to the reader across every value form", () => {
    // The seventh instance existed because one key was taught and the other was
    // not. Asserting they agree is cheaper than remembering to fix both.
    for (const form of FORMS.filter((f) => !f.transform)) {
      const asApplyTo = readScopeGlobs(artifact(form.value), "applyTo");
      const asPaths = readScopeGlobs(
        artifact(form.value.replace(/^(\s*)applyTo:/, "$1paths:")),
        "paths",
      );
      expect(asPaths.globs, `divergence on: ${form.name}`).toEqual(asApplyTo.globs);
      expect(asPaths.malformed === null, `divergence on: ${form.name}`).toBe(
        asApplyTo.malformed === null,
      );
    }
  });

  it("the writer declines the value the reader declined (ownership agreement)", () => {
    const content = artifact(`  applyTo: "src/api/**"`);
    const rewritten = rewriteFrontmatterKeyBlock(content, KEY, `${KEY}: ["rewritten/**"]`);

    // Neither half claims it, so the artifact is returned untouched. A writer
    // that rewrote what the reader refused to read would be the same split in
    // the opposite direction.
    expect(rewritten).toBe(content);
  });

  it("an absent key reads as absent and rewrites to a no-op", () => {
    const content = artifact(`classification-note: none`);
    const read = readScopeGlobs(content, KEY);

    expect(read.globs).toEqual([]);
    expect(read.malformed).toBeNull();
    expect(rewriteFrontmatterKeyBlock(content, KEY, `${KEY}: ["x/**"]`)).toBe(content);
  });

  it("an artifact with no frontmatter at all is not treated as scoped", () => {
    const content = "# Just a heading\n\nNo frontmatter here.\n";
    const read = readScopeGlobs(content, KEY);

    expect(read.globs).toEqual([]);
    expect(read.raw).toBeNull();
    expect(rewriteFrontmatterKeyBlock(content, KEY, `${KEY}: ["x/**"]`)).toBe(content);
  });
});

describe("reader/writer agreement — the `paths` key travels with `applyTo`", () => {
  /**
   * Two keys, one parser. Every instance above was found on `applyTo` and fixed
   * on `applyTo`; `paths` is the sibling that would carry the seventh instance
   * if the fix were ever applied to one and not the other. That is the class,
   * verbatim, which makes this the cheapest assertion in the file.
   */
  const CASES = FORMS.filter((f) => !f.transform);

  for (const form of CASES) {
    it(`round-trips on \`paths\`: ${form.name}`, () => {
      const content = artifact(form.value.replace(/^(\s*)applyTo:/, "$1paths:"));
      const first = readScopeGlobs(content, "paths");
      expect(first.globs).toEqual(form.expect);

      const rewritten = rewriteFrontmatterKeyBlock(
        content,
        "paths",
        `paths: ${JSON.stringify(first.globs)}`,
      );
      expect(readScopeGlobs(rewritten, "paths").globs).toEqual(first.globs);
      expect(() => keysOf(rewritten)).not.toThrow();
    });
  }
});

describe("reader/writer agreement — frontmatter field reader vs the key rewriter", () => {
  /**
   * The second pair. `parseFrontmatter` is the field-level reader used by
   * validation, identity and composition resolution; `rewriteFrontmatterKeyBlock`
   * is what edits those fields. They normalize independently, which is exactly
   * the condition that produced F-6, so their agreement is asserted rather than
   * assumed.
   */
  it("a key the field reader sees is a key the rewriter can replace", () => {
    const content = artifact(`applyTo: "src/api/**"`);
    const fields = parseFrontmatter(content);

    expect(fields).not.toBeNull();
    for (const key of fields!.keys()) {
      const rewritten = rewriteFrontmatterKeyBlock(content, key, `${key}: replaced`);
      expect(rewritten, `rewriter must recognise \`${key}\``).not.toBe(content);
      expect(parseFrontmatter(rewritten)!.get(key)).toBe("replaced");
    }
  });

  it("both halves agree across CRLF and BOM", () => {
    const base = artifact(`applyTo: "src/api/**"`);
    for (const [label, content] of [
      ["CRLF", base.replace(/\n/g, "\r\n")],
      ["BOM", "﻿" + base],
      ["BOM+CRLF", "﻿" + base.replace(/\n/g, "\r\n")],
    ] as const) {
      const fields = parseFrontmatter(content);
      expect(fields, `${label}: field reader must see frontmatter`).not.toBeNull();
      expect(fields!.get("guardrail"), `${label}`).toBe("hard");

      const rewritten = rewriteFrontmatterKeyBlock(content, "guardrail", "guardrail: advisory");
      expect(parseFrontmatter(rewritten)!.get("guardrail"), `${label}`).toBe("advisory");
      expect(readScopeGlobs(rewritten, "applyTo").globs, `${label}`).toEqual(["src/api/**"]);
    }
  });
});
