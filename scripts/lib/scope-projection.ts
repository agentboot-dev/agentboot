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

/** Frontmatter block of a Markdown artifact, or null when absent. */
export function frontmatterBlock(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1]! : null;
}

/**
 * Parse an artifact's path scope.
 *
 * Deliberately does NOT validate glob syntax or check that a glob matches
 * anything — that is a separate finding with a different verdict (warn, not
 * error), and folding it in here makes this change unshippable.
 */
export function inspectScope(content: string): ScopeInspection {
  const fm = frontmatterBlock(content);
  if (!fm) return { globs: [], alwaysOn: true, acknowledgedUnscoped: false, raw: null };

  const acknowledgedUnscoped = /^\s*scope-unsupported:\s*acknowledged\s*$/im.test(fm);
  const m = fm.match(/^\s*applyTo:\s*(.+)$/im);
  if (!m) return { globs: [], alwaysOn: true, acknowledgedUnscoped, raw: null };

  const raw = m[1]!.trim();
  const globs = raw
    .replace(/^["']|["']$/g, "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

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
