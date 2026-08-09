/**
 * F-6: how an instruction's `applyTo` path scope projects onto each platform.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `compileInstructions` never parsed the source frontmatter at all. It stripped
 * it, then hardcoded `alwaysApply: true` for Cursor and the literal string
 * `trigger: always_on` for Windsurf. A rule the operator authored as
 * `applyTo: "src/api/**"` was therefore delivered as *always on, every file* —
 * not dropped, INVERTED. The shipped default
 * `core/instructions/security.instructions.md`, scoped to secrets/auth/crypto
 * paths, becomes a global always-on rule on both platforms, and did so in this
 * repo's own committed `dist/`.
 *
 * Inversion is strictly worse than omission. A warning is the right response to
 * "we dropped something"; it is the wrong response to "we shipped the opposite
 * of what you wrote."
 *
 * Deliberately shaped like `guardrail-scan.ts` — same naming, same fail-closed
 * posture, same escape-hatch style. A second, differently-shaped mechanism for
 * the same class is how the two platform lists drifted in the first place.
 */

export type ScopeSupport = "native" | "translated" | "unsupported";

export interface ScopeProjection {
  support: ScopeSupport;
  detail: string;
}

/**
 * How each output format can express an `applyTo` path scope.
 *
 * VERIFIED against real `dist/` output on 2026-08-08 — an unverified row here is
 * the same class of error as an unsourced claim. `translated` means the platform
 * HAS a mechanism and AgentBoot now emits it (the correct implementations
 * already existed ten lines away, in `compileGotchas`); `unsupported` means the
 * platform has no scoping key at all and the rule is necessarily always-on.
 */
export const APPLY_TO_PROJECTION: Record<string, ScopeProjection> = {
  copilot:   { support: "native",      detail: "`applyTo:` is a first-class Copilot instruction key" },
  cursor:    { support: "translated",  detail: "`globs:` + `alwaysApply: false` in the .mdc frontmatter" },
  windsurf:  { support: "translated",  detail: "`trigger: glob` + `globs:` in .windsurf/rules/" },
  jetbrains: { support: "translated",  detail: "`globs:` in .aiassistant/rules/" },
  claude:    { support: "unsupported", detail: "rules/ files are @-imported unconditionally from CLAUDE.md" },
  skill:     { support: "unsupported", detail: "SKILL.md instruction files have no scoping key" },
  plugin:    { support: "unsupported", detail: "plugin rules/ load with the plugin, unscoped" },
  agents:    { support: "unsupported", detail: "text is inlined into AGENTS.md, which is always-on" },
  codex:     { support: "unsupported", detail: "text is inlined into AGENTS.md, which is always-on" },
  gemini:    { support: "unsupported", detail: "text is inlined into GEMINI.md, which is always-on" },
};

/**
 * Globs meaning "everywhere". Documented in the `agentboot add instruction`
 * scaffold and docs/getting-started.md ("`**` = always on, every file");
 * docs/guardrails.md uses the `**` + `/*` form for the same meaning.
 */
const UNIVERSAL_GLOBS = new Set(["**", "**/*", "*"]);

export interface ScopedArtifact {
  name: string;
  /** Absolute path to the source file. */
  file: string;
  /** The `applyTo` value as written, for the diagnostic. */
  scopePath: string;
  globs: string[];
  acknowledgedUnscoped: boolean;
}

export interface ScopeInspection {
  /** Parsed narrowing globs. EMPTY when the artifact is always-on. */
  globs: string[];
  /** True when `applyTo` is absent, empty, or entirely universal. */
  alwaysOn: boolean;
  /** `scope-unsupported: acknowledged` in the frontmatter. */
  acknowledgedUnscoped: boolean;
  /** The raw `applyTo` value, for reporting. */
  raw: string | null;
  /**
   * Non-null when `applyTo` is present but unparseable. NOT folded into
   * `alwaysOn`: "I could not read the scope" and "there is no scope" are
   * different facts, and reporting the first as the second reports a
   * narrowly-scoped rule as global — the inversion this module exists to
   * prevent.
   */
  malformed: string | null;
}

/**
 * C1: re-exported from the ONE tolerant extractor rather than re-implemented.
 *
 * The copy that lived here was `/^---\n([\s\S]*?)\n---/` against raw content —
 * so a CRLF or BOM artifact matched nothing, `inspectScope` returned
 * `{globs: [], alwaysOn: true}`, and this gate — the gate that exists BECAUSE
 * `applyTo` was being inverted — failed open on exactly the artifacts a Windows
 * checkout produces. The tolerant parser was already in the repo, ten lines
 * away, unused by both copies.
 */
export { frontmatterBlock } from "./frontmatter.js";
import { frontmatterBlock, normalizeForFrontmatter } from "./frontmatter.js";

/**
 * Parse an artifact's path scope.
 *
 * Deliberately does NOT validate glob syntax or check that a glob matches
 * anything — that is a separate finding with a different verdict (warn, not
 * error), and folding it in here makes this change unshippable.
 */
/**
 * C2: YAML ends a scalar at an inline comment. This parser did not.
 *
 * AgentBoot's OWN documented scaffold — core/instructions/agentboot-authoring
 * .instructions.md and the `agentboot add instruction` template — writes:
 *
 *     applyTo: "**"  # glob pattern for activation scope
 *
 * Everything after the closing quote was being taken as part of the glob, so the
 * value the product tells authors to write parsed to the single glob
 * `** # glob pattern for activation scope`, which is not universal, does not
 * match the always-on sentinel set, and therefore made every artifact written to
 * our own instructions look NARROWLY SCOPED. The gate would then fire on the
 * default install — the exact "check becomes noise inside a week" outcome the
 * UNIVERSAL_GLOBS set exists to prevent.
 */
function stripYamlInlineComment(raw: string): string {
  // A quoted scalar ends at its closing quote; anything after is a comment.
  const quoted = raw.match(/^(["'])(?:[^\\]|\\.)*?\1/);
  if (quoted) return quoted[0]!;
  // An unquoted scalar ends at whitespace-then-hash. A bare `#` with no leading
  // space is a legal character in a glob and is deliberately NOT treated as a
  // comment, matching YAML.
  const at = raw.search(/\s#/);
  return at === -1 ? raw : raw.slice(0, at).trimEnd();
}

/**
 * C3: split a comma-separated glob list WITHOUT splitting inside a brace or
 * bracket group.
 *
 * A naive `.split(",")` turns the entirely ordinary
 *
 *     applyTo: "src/**\/*.{ts,tsx}"
 *
 * into the two globs `src/**\/*.{ts` and `tsx}`, neither of which matches
 * anything. Before `961bf25` this artifact was delivered always-on; after it, it
 * is delivered scoped to two globs that match no file — so the rule reaches
 * nothing. Exit 0, no diagnostic, and the failure mode moved from "applies
 * everywhere" to "applies nowhere", which is quieter and therefore worse.
 *
 * Bracket groups `[...]` are tracked for the same reason: `*.[ch]` is legal and
 * a comma inside a character class is a literal.
 */
function splitGlobList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let braces = 0;
  let brackets = 0;
  for (const ch of value) {
    if (ch === "{") braces++;
    else if (ch === "}") braces = Math.max(0, braces - 1);
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets = Math.max(0, brackets - 1);
    if (ch === "," && braces === 0 && brackets === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((g) => g.trim()).filter(Boolean);
}

/**
 * The ONE glob-list parser: strip the YAML inline comment, strip the surrounding
 * quotes, split on commas that are not inside a brace or bracket group.
 *
 * V1: this existed and only `inspectScope` used it. The gotcha emitters
 * hand-rolled `rawPaths.replace(/^["\']|["\']$/g,"").split(",")` at SEVEN sites
 * (cursor, windsurf, gemini, copilot, jetbrains, the AGENTS.md section and the
 * skills index), so `paths: "src/**\/*.{ts,tsx}"` became the two globs
 * `src/**\/*.{ts` and `tsx}` — two globs that match nothing — and
 * `paths: "src/**"  # glob pattern for activation scope` became one glob that
 * matches nothing. Exit 0, no diagnostic. That is the C2/C3 defect class
 * surviving in "the correct implementation ten lines away", which is the phrase
 * commit 6c5ffdc used about the opposite direction.
 */
export function parseGlobList(raw: string): string[] {
  return splitGlobList(stripYamlInlineComment(raw.trim()).replace(/^["']|["']$/g, "").trim());
}

/**
 * NF2-3 / V1: split a YAML FLOW sequence body on its top-level commas.
 *
 * Distinct from `splitGlobList` because the two split at different depths:
 * `splitGlobList` operates on an already-unquoted scalar and must NOT split
 * inside `{...}` or `[...]` (a brace group is one glob), while a flow sequence's
 * commas are item separators and its quotes are YAML quoting, so a comma inside
 * a quoted item is literal. Sharing one splitter between the two would make one
 * of them wrong.
 */
function splitFlowItems(inner: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"') {
        current += ch + (inner[++i] ?? "");
        continue;
      }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out
    .map((s) => s.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim())
    .filter(Boolean);
}

/**
 * Result of reading a path-scope key. `malformed` is non-null when the value is
 * present but cannot be parsed — a state that must NOT be reported as "no
 * scope", because "no scope" means always-on and always-on is the inversion this
 * whole module exists to prevent.
 */
export interface ScopeRead {
  globs: string[];
  raw: string | null;
  /** Non-null when the value is present and unparseable. */
  malformed: string | null;
}

/**
 * Read a path-scope key out of an artifact's frontmatter, in EITHER YAML form.
 *
 * NF-4: the old single-line regex `/^\s*applyTo:\s*(.+)$/im` crossed the
 * newline — `\s*` matches `\n` — so the perfectly legal block sequence
 *
 *     applyTo:
 *       - "src/db/**"
 *       - "src/auth/**"
 *
 * captured the literal text `- "src/db/**"` as the glob and dropped
 * `src/auth/**` entirely. That value was then interpolated verbatim into the
 * emitted frontmatter, so Cursor received `globs: "- "src/db/**"` and Windsurf
 * `- "- "src/db/**"` — unbalanced quotes, i.e. the emitted .mdc/.md frontmatter
 * was not valid YAML. Build exit 0, no diagnostic: the "applies nowhere" class
 * this branch calls quieter-and-therefore-worse, plus a corrupted artifact,
 * reachable through ordinary YAML rather than a brace group.
 */
export function readScopeGlobs(content: string, key: "applyTo" | "paths"): ScopeRead {
  const fm = frontmatterBlock(content);
  if (fm === null) return { globs: [], raw: null, malformed: null };
  return readScopeGlobsFromBlock(fm, key);
}

/**
 * NF2-3: block sequences were handled; FLOW sequences and BLOCK SCALARS were
 * not, and both are ordinary YAML that this product's own documentation teaches
 * authors to write (docs/concepts.md:1407 `paths: ["packages/api-service/**"]`,
 * docs/prompt-guide.md:859, and the repo's own fixtures).
 *
 *     applyTo: ["src/db/**", "src/auth/**"]
 *       → ONE glob, the literal string `["src/db/**", "src/auth/**"]`
 *     applyTo: >            applyTo: |
 *       src/api/**            src/api/**
 *       → ONE glob, `>` / `|`, and the real scope on the next line DROPPED
 *
 * End to end at `agentboot build`, exit 0 with no diagnostic:
 * dist/cursor/…/phi.instructions.mdc emitted `globs: "["src/db/**", "src/auth/**"]"`
 * and dist/windsurf/… emitted `- "["src/db/**", "src/auth/**"]"` — BOTH fail a
 * js-yaml parse ("bad indentation of a mapping entry (2:11)" / "bad indentation
 * of a sequence entry (3:8)"). That is the NF-4 symptom verbatim, on a form the
 * docs recommend. Meanwhile jetbrains and copilot got syntactically valid
 * frontmatter carrying a glob that matches nothing, and copilot's native
 * passthrough of `applyTo: >` resolved CORRECTLY — so two platforms disagreed
 * about the same rule's scope from one source.
 *
 * Routing all seven gotcha emitters through one parser (V1) made this UNIFORM
 * rather than closing it. The fix has to be in the parser.
 *
 * Block scalars are read line-per-glob rather than by YAML's folding rules,
 * because a folded `>` over two lines yields `src/api/** src/db/**` — one
 * scalar with a space in it, which is not a glob anyone meant. Line-per-glob is
 * the only reading that agrees with the block-sequence form directly above it.
 */
/**
 * Net bracket depth of a line, ignoring brackets inside quotes.
 *
 * A glob legitimately contains `[` — `src/**\/*.[jt]s` is a character class —
 * so counting raw characters would make a single-line sequence look unbalanced.
 * Quoted spans are skipped for the same reason.
 */
function bracketDepth(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "#") break; // trailing comment
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
  }
  return depth;
}

function readScopeGlobsFromBlock(fm: string, key: string): ScopeRead {
  const lines = fm.split("\n");
  // Anchored to the line, and `[ \t]*` never crosses a newline — that crossing
  // is the whole of NF-4.
  //
  // NEW-2 (read side): anchored at COLUMN 0 as well. Matching `applyTo:` at any
  // indent means the first hit can be the CONTENT of another key's block scalar
  // — e.g. a `description: |` whose prose explains what applyTo does. The reader
  // then returns that prose as the glob, and the real top-level `applyTo:` two
  // lines down is never reached. Indentation is exactly what distinguishes a key
  // from text, so the reader and the rewriter must anchor the same way; they
  // disagreeing is how one artifact came to mean two scopes.
  const keyRe = new RegExp(`^()${key}:[ \\t]*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = keyRe.exec(lines[i]!);
    if (!m) continue;
    const keyIndent = m[1]!.length;
    const rawAfterColon = m[2]!.trim();

    // A block scalar header (`|`, `>`, with optional chomping/indent indicators
    // such as `>-`, `|+`, `|2`). Checked BEFORE the inline branch, because these
    // are non-empty inline text that means "the value is on the following lines".
    if (/^[|>][+-]?\d*$|^[|>]\d*[+-]?$/.test(rawAfterColon)) {
      const items = collectIndentedLines(lines, i + 1, keyIndent);
      if (items.length === 0) return { globs: [], raw: null, malformed: null };
      return {
        globs: items.flatMap((v) => parseGlobList(v)),
        raw: items.join(", "),
        malformed: null,
      };
    }

    const inline = stripYamlInlineComment(rawAfterColon);
    if (inline !== "") {
      // A YAML FLOW sequence.
      if (inline.startsWith("[")) {
        // NF4-7: a flow sequence may span LINES. This is legal YAML and it is
        // the form the product's own docs teach, just wrapped:
        //
        //     paths: [
        //       "src/n/**",
        //       "src/o/**"
        //     ]
        //
        // The reader only handled a sequence that opens and closes on ONE line,
        // so the above hit the unterminated branch and — correctly, given what
        // it believed — FAILED THE BUILD with "unterminated flow sequence: [".
        // The posture was right and the parse was wrong, which is the worst
        // combination: a loud, well-worded refusal of valid input teaches the
        // operator that the gate is broken, and a gate the operator works around
        // protects nothing.
        //
        // Continuation lines are gathered until the brackets balance. If they
        // never do, it is genuinely unterminated and still fails closed — an
        // unreadable scope reported as "no scope" is reported as ALWAYS-ON, the
        // inversion this module exists to prevent.
        let flow = inline;
        let depth = bracketDepth(inline);
        let j = i;
        while (depth > 0 && j + 1 < lines.length) {
          j++;
          const cont = lines[j]!;
          // A line at column 0 that looks like `key:` is the NEXT key, not a
          // continuation: stop rather than swallowing the rest of the block.
          if (/^[^\s#][^:]*:/.test(cont) && depth > 0 && !cont.trim().startsWith("[")) {
            const looksLikeItem = /^[\s]*["'\[]|^[\s]*[^\s:]+\s*,\s*$/.test(cont);
            if (!looksLikeItem) break;
          }
          flow += ` ${cont.trim()}`;
          depth += bracketDepth(cont);
        }
        if (depth !== 0 || !flow.trimEnd().endsWith("]")) {
          return { globs: [], raw: inline, malformed: `unterminated flow sequence: ${inline}` };
        }
        const body = flow.trim().slice(1, -1);
        const items = splitFlowItems(body);
        return {
          globs: items.flatMap((v) => parseGlobList(v)),
          raw: flow.trim(),
          malformed: null,
        };
      }
      if (inline.startsWith("{")) {
        return { globs: [], raw: inline, malformed: `${key} is a mapping, expected a glob or a list of globs` };
      }
      return { globs: parseGlobList(inline), raw: inline, malformed: null };
    }

    // Empty after the colon → a block sequence may follow.
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (/^[ \t]*(#.*)?$/.test(line)) continue; // blank or comment line
      const item = /^[ \t]*-[ \t]*(.+)$/.exec(line);
      if (!item) break; // next key — the sequence is over
      const v = stripYamlInlineComment(item[1]!.trim()).replace(/^["']|["']$/g, "").trim();
      if (v) items.push(v);
    }
    if (items.length === 0) return { globs: [], raw: null, malformed: null };
    return { globs: items.flatMap((v) => parseGlobList(v)), raw: items.join(", "), malformed: null };
  }
  return { globs: [], raw: null, malformed: null };
}

/** Lines of a block scalar: everything indented strictly deeper than the key. */
function collectIndentedLines(lines: string[], start: number, keyIndent: number): string[] {
  const out: string[] = [];
  for (let j = start; j < lines.length; j++) {
    const line = lines[j]!;
    if (/^[ \t]*$/.test(line)) continue; // blank lines are part of the scalar
    const indent = /^[ \t]*/.exec(line)![0]!.length;
    if (indent <= keyIndent) break; // dedented → the next key
    const v = line.trim().replace(/^["']|["']$/g, "").trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * R4N-1: find a path-scope key the reader deliberately did NOT match because it
 * is indented, and which is not merely the word appearing inside another key's
 * block scalar.
 *
 * The column-0 anchor above is correct and must stay — matching at any indent
 * lets a `description: |` whose prose explains applyTo be read as the glob. But
 * the consequence was that an operator who indents their frontmatter gets
 * `raw === null`, which means "no scope declared", which means ALWAYS-ON. A
 * narrowing directive silently inverted to its opposite is the exact defect
 * class this module exists to close (F-6), so the answer is not to loosen the
 * anchor — it is to stop being silent about the case we decline to honour.
 *
 * Returns the offending line, or null.
 */
function findIndentedScopeKey(fm: string, key: string): string | null {
  const lines = fm.split("\n");
  const keyRe = new RegExp(`^[ \\t]+${key}:`, "i");
  const blockOpen = /^([ \t]*)[A-Za-z0-9_-]+:[ \t]*[|>][-+0-9]*[ \t]*$/;
  let blockIndent: number | null = null;

  for (const line of lines) {
    if (blockIndent !== null) {
      // Still inside a block scalar while the line is blank or more indented
      // than the key that opened it.
      const indent = /^[ \t]*/.exec(line)![0]!.length;
      if (line.trim() === "" || indent > blockIndent) continue;
      blockIndent = null;
    }
    const open = blockOpen.exec(line);
    if (open) { blockIndent = open[1]!.length; continue; }
    if (keyRe.test(line)) return line.trim();
  }
  return null;
}

export function inspectScope(content: string): ScopeInspection {
  const fm = frontmatterBlock(content);
  // `=== null`, not falsy: an EMPTY frontmatter block ("---\n---") is a real
  // block that happens to be empty, and `!fm` conflated it with "no frontmatter".
  if (fm === null) {
    return { globs: [], alwaysOn: true, acknowledgedUnscoped: false, raw: null, malformed: null };
  }

  const acknowledgedUnscoped = /^\s*scope-unsupported:\s*acknowledged\s*$/im.test(fm);
  const { globs, raw, malformed } = readScopeGlobsFromBlock(fm, "applyTo");
  // FAIL CLOSED: an unreadable scope is treated as narrowing, so the
  // degradation gate FIRES rather than waving the artifact through as global.
  if (malformed !== null) {
    return { globs, alwaysOn: false, acknowledgedUnscoped, raw, malformed };
  }
  if (raw === null) {
    // Before concluding "no scope declared" — which means ALWAYS-ON — check
    // whether the operator wrote one at an indent the reader will not honour.
    // Saying nothing here delivers the opposite of what they asked for.
    const indented = findIndentedScopeKey(fm, "applyTo");
    if (indented !== null) {
      return {
        globs: [],
        alwaysOn: false,
        acknowledgedUnscoped,
        raw: indented,
        malformed:
          `\`applyTo:\` must start at column 0 of the frontmatter; found indented (\`${indented}\`). ` +
          `An indented key is not read as the artifact's scope, and an unscoped artifact is delivered always-on.`,
      };
    }
    return { globs: [], alwaysOn: true, acknowledgedUnscoped, raw: null, malformed: null };
  }

  // A universal scope is not a scope. Losing it is a no-op, and treating it as
  // narrowing would fire the gate on every default install — which is how a
  // check becomes noise inside a week.
  if (globs.length === 0 || globs.every((g) => UNIVERSAL_GLOBS.has(g))) {
    return { globs: [], alwaysOn: true, acknowledgedUnscoped, raw, malformed: null };
  }
  return { globs, alwaysOn: false, acknowledgedUnscoped, raw, malformed: null };
}

/**
 * Output formats that cannot express a path scope at all.
 *
 * FAIL CLOSED on an unknown platform — `?? "unsupported"`, never a falsy
 * fallback. A classifier may ignore what it has no data for; a safety gate may
 * not. Writing `?.support === "unsupported"` here would silently treat an
 * unknown format as capable, which is exactly the mistake that let the HARD
 * guardrail gate fail open on `plugin`.
 */
export function degradedFormats(outputFormats: string[]): string[] {
  return outputFormats.filter(
    (f) => (APPLY_TO_PROJECTION[f]?.support ?? "unsupported") === "unsupported",
  );
}

/**
 * The gate. A rule authored as narrow and delivered always-on means the operator
 * restricted it and the platform received the opposite instruction, behind a
 * signed manifest — so it is an ERROR, not a warning, unless the author
 * acknowledged it on the artifact.
 *
 * Ratified pre-GA on purpose, matching `unenforceableViolations`: after the 1.0
 * tag this becomes a breaking change, and the choice degrades to "break adopters
 * later" or "live with it".
 */
export function scopeViolations(
  scoped: ScopedArtifact[],
  outputFormats: string[],
): { artifact: ScopedArtifact; formats: string[] }[] {
  const degraded = degradedFormats(outputFormats);
  if (degraded.length === 0) return [];
  return scoped
    .filter((a) => a.globs.length > 0 && !a.acknowledgedUnscoped)
    .map((artifact) => ({ artifact, formats: degraded }));
}

/**
 * The preamble injected into a target that cannot express scope.
 *
 * This is what makes the acknowledgement a decision rather than a rubber stamp:
 * acknowledging opts into a DOCUMENTED degraded delivery, not into silence. It
 * is not enforcement — it is the difference between "inverted" and "degraded
 * honestly".
 */
export function scopePreamble(globs: string[]): string {
  return (
    `> **Scope — \`${globs.join(", ")}\`.** This target cannot express path scoping, so the rule is\n` +
    `> delivered always-on. Apply it only when working on files matching that pattern.\n`
  );
}

/**
 * NF2-3 (emit side): replace or delete a frontmatter key whose value MAY SPAN
 * MULTIPLE LINES.
 *
 * The JetBrains emitter rewrote the scope key with
 * `.replace(/^\s*applyTo:.*$/im, …)` and deleted it with
 * `.replace(/^\s*applyTo:.*\n/im, "")`. Both operate on ONE line. A block
 * sequence or a block scalar leaves its continuation lines behind, so
 *
 *     applyTo: >              becomes      globs: ["src/api/**"]
 *       src/api/**                           src/api/**
 *
 * — an orphaned indented line under a flow-sequence value, which js-yaml
 * rejects with "bad indentation of a mapping entry (3:3)". Getting the PARSER
 * right and leaving the rewriter single-line just moves the invalid-YAML
 * artifact from one platform to another.
 *
 * Operates only inside the first frontmatter block, and only on a key at the
 * TOP level of it: a nested `applyTo:` under some other mapping is not this key.
 *
 * NEW-2: that last sentence was the doc comment's claim and not the code's
 * behaviour. The matcher was `^([ \t]*)<key>:`, which matches at ANY indent, so
 * it fired on every such line inside the block — including one that is CONTENT,
 * not structure. The same commit switched Copilot from source-line passthrough
 * to re-serialization through this helper, so Copilot went from "valid YAML,
 * correct glob" to "unparseable YAML, wrong glob" for a whole input class:
 *
 *     description: |                     ->    description: |
 *       applyTo: narrows a rule ...            applyTo: "narrows a rule ..."
 *       Keep it as tight as you can.             Keep it as tight as you can.
 *     applyTo: "src/pay/**"                    applyTo: "narrows a rule ..."
 *
 * — an uninserted replacement at the nested position, the following indented
 * lines consumed as if they were the key's continuation, the replacement
 * emitted TWICE, and the surviving glob taken from prose. js-yaml: "bad
 * indentation of a mapping entry (3:3)". Copilot is one of the three officially
 * supported v1.0 platforms, and this is precisely the defect class ("emitted
 * frontmatter no YAML parser accepts") the helper exists to close.
 *
 * Indentation is what distinguishes a key from the text of a block scalar, so
 * anchoring at column 0 is the whole fix. It also means the deletion case can
 * no longer silently drop someone else's nested key.
 *
 * @param replacement full replacement line (no trailing newline), or null to delete.
 */
export function rewriteFrontmatterKeyBlock(
  content: string,
  key: string,
  replacement: string | null,
): string {
  const normalized = normalizeForFrontmatter(content);
  const m = /^---\n([\s\S]*?)\n---/.exec(normalized);
  if (!m) return content;
  const block = m[1] ?? "";
  const blockStart = 4; // "---\n"
  const lines = block.split("\n");
  // Column 0 only. See NEW-2 above: a `key:` at any other indent is either
  // nested under another mapping or is the CONTENT of a block scalar, and in
  // both cases it belongs to someone else.
  const keyRe = new RegExp(`^()${key}:`, "i");

  const out: string[] = [];
  let i = 0;
  let changed = false;
  while (i < lines.length) {
    const km = keyRe.exec(lines[i]!);
    if (!km) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    const keyIndent = km[1]!.length;
    changed = true;
    if (replacement !== null) out.push(replacement);
    i++;
    // Consume every continuation line: block-sequence items and block-scalar
    // content are both "indented deeper than the key, or a `-` item at or
    // deeper than the key's indent".
    while (i < lines.length) {
      const line = lines[i]!;
      if (/^[ \t]*$/.test(line)) {
        // A blank line inside a block scalar belongs to it; a blank line before
        // the next key does not. Look ahead: keep consuming only if what
        // follows is still a continuation.
        let k = i + 1;
        while (k < lines.length && /^[ \t]*$/.test(lines[k]!)) k++;
        if (k >= lines.length) break;
        const nextIndent = /^[ \t]*/.exec(lines[k]!)![0]!.length;
        if (nextIndent <= keyIndent && !/^[ \t]*-[ \t]/.test(lines[k]!)) break;
        i++;
        continue;
      }
      const indent = /^[ \t]*/.exec(line)![0]!.length;
      const isSeqItem = /^[ \t]*-[ \t]*\S/.test(line);
      if (indent > keyIndent || (isSeqItem && indent >= keyIndent)) {
        i++;
        continue;
      }
      break;
    }
  }
  if (!changed) return content;
  const newBlock = out.join("\n");
  return normalized.slice(0, blockStart) + newBlock + normalized.slice(blockStart + block.length);
}
