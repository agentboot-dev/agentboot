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
import { frontmatterBlock } from "./frontmatter.js";

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
export function readScopeGlobs(
  content: string,
  key: "applyTo" | "paths",
): { globs: string[]; raw: string | null } {
  const fm = frontmatterBlock(content);
  if (fm === null) return { globs: [], raw: null };
  return readScopeGlobsFromBlock(fm, key);
}

function readScopeGlobsFromBlock(fm: string, key: string): { globs: string[]; raw: string | null } {
  const lines = fm.split("\n");
  // Anchored to the line, and `[ \t]*` never crosses a newline — that crossing
  // is the whole of NF-4.
  const keyRe = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = keyRe.exec(lines[i]!);
    if (!m) continue;
    const inline = stripYamlInlineComment(m[1]!.trim());
    if (inline !== "") return { globs: parseGlobList(inline), raw: inline };

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
    if (items.length === 0) return { globs: [], raw: null };
    return { globs: items.flatMap((v) => parseGlobList(v)), raw: items.join(", ") };
  }
  return { globs: [], raw: null };
}

export function inspectScope(content: string): ScopeInspection {
  const fm = frontmatterBlock(content);
  // `=== null`, not falsy: an EMPTY frontmatter block ("---\n---") is a real
  // block that happens to be empty, and `!fm` conflated it with "no frontmatter".
  if (fm === null) return { globs: [], alwaysOn: true, acknowledgedUnscoped: false, raw: null };

  const acknowledgedUnscoped = /^\s*scope-unsupported:\s*acknowledged\s*$/im.test(fm);
  const { globs, raw } = readScopeGlobsFromBlock(fm, "applyTo");
  if (raw === null) return { globs: [], alwaysOn: true, acknowledgedUnscoped, raw: null };

  // A universal scope is not a scope. Losing it is a no-op, and treating it as
  // narrowing would fire the gate on every default install — which is how a
  // check becomes noise inside a week.
  if (globs.length === 0 || globs.every((g) => UNIVERSAL_GLOBS.has(g))) {
    return { globs: [], alwaysOn: true, acknowledgedUnscoped, raw };
  }
  return { globs, alwaysOn: false, acknowledgedUnscoped, raw };
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
