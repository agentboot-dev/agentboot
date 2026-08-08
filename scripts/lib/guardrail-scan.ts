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
import { PLATFORM_ENFORCEMENT } from "./conformance.js";

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
