/**
 * Shared HARD-guardrail discovery.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `guardrail: hard` is an ARTIFACT-level declaration, but the enforcement-honesty
 * check in `doctor` derived its trigger from four CONFIG keys and never looked at
 * artifact frontmatter. Meanwhile `compile` scanned that frontmatter to populate
 * dist/managed/ but never compared it against the configured output formats.
 *
 * The compiler knew; the honesty check never asked. The result (confirmed
 * 2026-08-07, v0.20.2) was a HARD guardrail emitted to platforms that cannot
 * enforce anything, byte-indistinguishable from a soft style preference, behind a
 * green build, a green `validate --strict`, and a green `doctor`.
 *
 * One scan, one source of truth, consumed by both.
 * See docs/research/defect-hard-guardrail-silent-downgrade.md
 */
import fs from "fs";
import path from "path";
import {
  PLATFORM_ENFORCEMENT,
  CAPABILITY_SUPPORT,
  effectiveEmitters,
  type CapabilityContext,
  type CapabilityRow,
} from "./conformance.js";
import { capabilityExceptionFor, type PolicyException } from "./exceptions.js";

export interface HardArtifact {
  /** Artifact name (filename without extension). */
  name: string;
  /** "instruction" | "trait" */
  kind: "instruction" | "trait";
  /** Absolute path to the source file. */
  file: string;
  /** True when the author explicitly acknowledged unenforceable targets. */
  acknowledgedAdvisory: boolean;
}

/** Frontmatter block of a Markdown artifact, or null when absent. */
function frontmatter(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1]! : null;
}

function isHard(fm: string): boolean {
  return /^\s*guardrail:\s*hard\s*$/im.test(fm);
}

/**
 * The escape hatch. An author who genuinely wants a HARD artifact delivered to a
 * platform that cannot enforce it says so on the artifact:
 *
 *     guardrail: hard
 *     advisory-on-unenforceable: acknowledged
 *
 * This keeps the error resolvable without abandoning the guardrail, which is what
 * makes erroring-by-default safe rather than obstructive.
 */
function acknowledged(fm: string): boolean {
  return /^\s*advisory-on-unenforceable:\s*acknowledged\s*$/im.test(fm);
}

/**
 * The single predicate. Both callers use this: `doctor` scans directories,
 * `compile` holds trait content in memory — same rule either way, which is the
 * point of the file.
 */
export function inspectArtifact(content: string): { hard: boolean; acknowledgedAdvisory: boolean } {
  const fm = frontmatter(content);
  if (!fm) return { hard: false, acknowledgedAdvisory: false };
  return { hard: isHard(fm), acknowledgedAdvisory: acknowledged(fm) };
}

function scanDir(dir: string, kind: HardArtifact["kind"], out: HardArtifact[]): void {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const full = path.join(dir, file);
    const r = inspectArtifact(fs.readFileSync(full, "utf-8"));
    if (!r.hard) continue;
    out.push({
      name: file.replace(/\.md$/, ""),
      kind,
      file: full,
      acknowledgedAdvisory: r.acknowledgedAdvisory,
    });
  }
}

/** Every artifact in the hub declaring `guardrail: hard`. */
export function findHardArtifacts(dirs: {
  instructions?: string[];
  traits?: string[];
}): HardArtifact[] {
  const out: HardArtifact[] = [];
  for (const d of dirs.instructions ?? []) scanDir(d, "instruction", out);
  for (const d of dirs.traits ?? []) scanDir(d, "trait", out);
  return out;
}

/**
 * Output formats that cannot mechanically enforce anything.
 *
 * Deliberately keyed off the SAME table the conformance harness tests and
 * `doctor` reports from — a second list here would drift from the first, which is
 * the defect class this file exists to close.
 */
export function unenforceableFormats(outputFormats: string[]): string[] {
  return outputFormats.filter((f) => {
    const e = PLATFORM_ENFORCEMENT[f];
    // FAIL CLOSED on an unknown platform.
    //
    // The first version of this returned `false` here — "don't guess about a
    // platform we have no data for." That reasoning is right for a classifier
    // and exactly backwards for a safety gate: it meant any output format
    // missing from the table was silently treated as ENFORCING, so a HARD
    // guardrail targeting it passed the gate. `plugin` was such a format, and
    // the artifact then reached no platform tree at all — a disappearance,
    // strictly worse than the downgrade this gate exists to prevent.
    //
    // An unknown platform is a platform we cannot vouch for. Say so.
    return e ? e.level === "advisory" : true;
  });
}

/**
 * The gate. A HARD guardrail compiled to a target that cannot enforce it is a
 * compliance hole with a green build and a signed manifest — so it is an ERROR,
 * not a warning, unless the author acknowledged it on the artifact.
 *
 * Ratified pre-GA on purpose: after the 1.0 tag this becomes a breaking change,
 * and the choice degrades to "break adopters later" or "live with it".
 */
export function unenforceableViolations(
  hard: HardArtifact[],
  outputFormats: string[]
): { artifact: HardArtifact; formats: string[] }[] {
  const advisory = unenforceableFormats(outputFormats);
  if (advisory.length === 0) return [];
  return hard
    .filter((a) => !a.acknowledgedAdvisory)
    .map((artifact) => ({ artifact, formats: advisory }));
}

// ---------------------------------------------------------------------------
// The generalisation: capability × platform (see CAPABILITY_SUPPORT)
// ---------------------------------------------------------------------------

export interface CapabilityViolation {
  row: CapabilityRow;
  /** Active, unexpired exception waiving this row, if any. */
  waivedBy?: PolicyException;
}

/**
 * Configured capabilities that NO configured output format can honour.
 *
 * Mirrors `unenforceableViolations()` above — same shape, same escape-hatch
 * semantics, same fail-closed posture — because the HARD-guardrail gate was the
 * single existing instance of this computation, built for one capability. This
 * generalises it. Two mechanisms with the same shape and different verdicts
 * would be a defect in the product's story about itself.
 *
 * A capability honoured by AT LEAST ONE configured platform is not this defect;
 * partial coverage is the enforcement axis's problem, not this one.
 */
export function capabilityViolations(
  ctx: CapabilityContext,
  outputFormats: string[],
  activeExceptions: PolicyException[] = [],
): CapabilityViolation[] {
  const out: CapabilityViolation[] = [];
  // Declaration order, so output is stable and diffs are reviewable.
  for (const row of CAPABILITY_SUPPORT) {
    if (!row.detect(ctx)) continue;
    // B1: effectiveEmitters, not row.emittedBy — a platform whose emitter is
    // gated on another format that is not being built does NOT honour the key.
    const honoured = effectiveEmitters(row, outputFormats).filter((f) => outputFormats.includes(f));
    if (honoured.length > 0) continue; // the silence case
    const waivedBy = capabilityExceptionFor(row.id, activeExceptions);
    out.push(waivedBy ? { row, waivedBy } : { row });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scope-narrowing counters — the ARTIFACT plane of CapabilityContext
// ---------------------------------------------------------------------------

/** Globs that mean "everywhere". Documented in the `add instruction` scaffold
 *  (cli.ts) and docs/getting-started.md; docs/guardrails.md uses "**\/*". */
const UNIVERSAL_GLOBS = new Set(["**", "**/*", "*"]);

/**
 * Count enabled instructions whose `applyTo` NARROWS scope.
 *
 * A universal `applyTo: "**"` is not narrowing — losing that scope is a no-op,
 * and firing on it would make every default install warn, which is how a check
 * becomes noise inside a week. The shipped baseline.instructions.md is exactly
 * that shape.
 *
 * Later dirs win on name, matching compile's package-then-hub merge.
 */
export function countNarrowlyScopedInstructions(
  instructionDirs: string[],
  enabled?: string[],
): number {
  const seen = new Map<string, string>();
  for (const dir of instructionDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const name = f.replace(/\.md$/, "");
      if (enabled && !enabled.includes(name)) continue;
      seen.set(name, path.join(dir, f));
    }
  }
  let n = 0;
  for (const file of seen.values()) {
    const fm = frontmatter(fs.readFileSync(file, "utf-8"));
    if (!fm) continue;
    const m = fm.match(/^\s*applyTo:\s*(.+)$/im);
    if (!m) continue;
    const globs = m[1]!.trim().replace(/^["']|["']$/g, "")
      .split(",").map((g) => g.trim()).filter(Boolean);
    if (globs.length > 0 && !globs.every((g) => UNIVERSAL_GLOBS.has(g))) n++;
  }
  return n;
}

/** Count gotchas carrying a `paths:` value. */
export function countScopedGotchas(gotchasDir: string): number {
  if (!fs.existsSync(gotchasDir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(gotchasDir).filter((x) => x.endsWith(".md") && x !== "README.md")) {
    const fm = frontmatter(fs.readFileSync(path.join(gotchasDir, f), "utf-8"));
    if (fm && /^\s*paths:\s*\S/im.test(fm)) n++;
  }
  return n;
}
