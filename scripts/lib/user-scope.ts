/**
 * User-level (~/.claude) write SPI.
 *
 * AgentBoot is the DEFAULT provider for the user-level config slot: it writes
 * compiled skills and rules straight to ~/.claude/. If another tool manages that
 * directory, AgentBoot detects it (a ~/.claude/.managed sentinel, or an explicit
 * userLevel.mode) and switches to MANIFEST mode — staging the resolved content plus
 * a manifest for that external provider to apply, and never touching ~/.claude
 * itself. This keeps AgentBoot useful out of the box for solo users while yielding
 * cleanly to a dedicated user-config manager when one is present.
 *
 * Direct-write constraints (an external provider owns the composed slots):
 * - MUST NOT use {{ TEMPLATE_VARS }} in any content (unresolved vars are rejected).
 * - MUST NOT touch CLAUDE.md (safe append needs the external provider's markers).
 * - MUST NOT touch settings.json (safe merge needs the external provider's deep merge).
 * - Direct writes are additive only (no hooks, no permissions.deny) into slot dirs.
 *
 * ---------------------------------------------------------------------------
 * THE SENTINEL WINS OVER AN EXPLICIT "direct" (L47e ruling)
 * ---------------------------------------------------------------------------
 * The ratified design is that the sentinel "auto-flips to manifest-only and HARD
 * REFUSES direct writes". The shipped code did the opposite: an explicit
 * `mode: "direct"` beat a PRESENT sentinel and AgentBoot wrote into a directory
 * another tool had claimed — silently, exit 0, with a green "Wrote N skill
 * file(s)". A test pinned that precedence, so the contradiction was load-bearing
 * rather than accidental.
 *
 * The design wins, and the test is what changed. The sentinel is the only signal
 * that comes from the OTHER side of the boundary: it is how a provider we cannot
 * see says "this slot is mine". A local config key overriding it makes the whole
 * promise unenforceable — the provider's claim would hold exactly until someone
 * set a key in a hub config it does not control and cannot read.
 *
 * "Hard refuse" here means: ~/.claude is not written, the content is still staged
 * for handoff (that is what "flips to manifest-only" buys), the refusal is
 * reported on the error channel, and the command exits NON-ZERO — because the
 * operator's explicit instruction was not carried out and a silent downgrade to
 * manifest mode would be the same green-over-a-refusal this codebase keeps
 * closing. The escape hatch is the honest one: remove `~/.claude/.managed` if
 * AgentBoot owns the slot after all.
 *
 * ---------------------------------------------------------------------------
 * `userLevel.applyCommand` — STRUCK, not deferred (L47a ruling)
 * ---------------------------------------------------------------------------
 * The 2026-07-11 design listed an optional generic `userLevel.applyCommand`: a
 * command AgentBoot would run to hand the staged tree to the external provider.
 * It is struck before 1.0, for the reason the same design gives one line earlier:
 * the AB↔provider contract is DATA (a staging dir + a manifest + a sentinel), not
 * a code interface. `applyCommand` is the one piece that would have made it a code
 * interface, and it would do so by turning a hub-synced config key into a command
 * AgentBoot executes on every developer machine that runs `install-user` — a
 * remote-code-execution surface handed to whoever can land a commit in the hub,
 * paid for a handoff the provider can already perform by reading the manifest it
 * asked for.
 *
 * Adding a config key later is additive and non-breaking; shipping an execution
 * surface at 1.0 is not removable. Struck, with the door open: the manifest
 * contract is public, so a provider that wants a push instead of a poll can ask
 * for it against a real use, which no adopter has yet.
 */

import fs from "node:fs";
import path from "node:path";
import { planOrphanRemoval, pruneEmptyDirs } from "./prune.js";
import os from "node:os";
import { createHash } from "node:crypto";
import type { AgentBootConfig } from "./config.js";

function getClaudeDir(): string {
  return path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir(), ".claude");
}

/** Filename of the sentinel an external provider drops in ~/.claude to claim the slot. */
const MANAGED_SENTINEL = ".managed";

export type UserLevelMode = "direct" | "manifest";

/**
 * True when an external tool has claimed the user-level slot (a ~/.claude/.managed
 * sentinel is present). In that case AgentBoot must not write ~/.claude directly.
 */
export function isExternallyManaged(claudeDir: string = getClaudeDir()): boolean {
  return fs.existsSync(path.join(claudeDir, MANAGED_SENTINEL));
}

/**
 * Env override for the user-level write mode.
 *
 * The design called for "config + env override"; a `--mode` flag shipped instead,
 * which does not serve the callers the override exists for — CI jobs and
 * non-interactive installers that can set an environment variable but cannot edit
 * a hub config they do not own, and cannot always reach the flag (an
 * `install-user` invoked from a script they wrap).
 */
export const USER_LEVEL_MODE_ENV = "AGENTBOOT_USER_LEVEL_MODE";

const VALID_USER_LEVEL_MODES = ["auto", "direct", "manifest"] as const;
type ConfiguredUserLevelMode = (typeof VALID_USER_LEVEL_MODES)[number];

export interface UserLevelResolution {
  /** The mode that will actually be used. */
  mode: UserLevelMode;
  /** Where the request came from — for diagnostics, and to name the right key in a refusal. */
  source: "config" | "env" | "default";
  /**
   * Non-null when the resolution is a REFUSAL the caller must surface and fail on.
   * Not a warning: a refusal means the operator's explicit instruction was NOT
   * carried out, and printing that as a note next to a success line is the
   * green-over-a-failure class this product exists to refuse.
   */
  refusal: string | null;
}

/**
 * Resolve the effective write mode from config, the env override, and the sentinel.
 *
 * Precedence, highest first:
 *  1. the SENTINEL, for "direct" only — a present `~/.claude/.managed` refuses a
 *     direct write no matter who asked for it (see the header ruling).
 *  2. `userLevel.mode` in the config. The CLI's `--mode` flag arrives here too
 *     (cli.ts injects it as config), which is why config beats env rather than
 *     the other way around: env-over-config would let an inherited environment
 *     variable silently beat the most explicit signal a caller has, which is the
 *     flag-parsed-by-nobody class in a new place.
 *  3. `AGENTBOOT_USER_LEVEL_MODE`.
 *  4. "auto" → manifest if the slot is externally managed, else direct.
 *
 * An UNRECOGNIZED value from either source is a refusal, not a fallback to auto:
 * quietly reinterpreting "manifest-only" or "Direct" as "auto" is how a request
 * not to touch ~/.claude becomes a write. It fails toward the safe side
 * (manifest) AND reports, so the caller exits non-zero.
 */
export function resolveUserLevelModeDetailed(
  config?: AgentBootConfig,
  claudeDir: string = getClaudeDir(),
): UserLevelResolution {
  const managed = isExternallyManaged(claudeDir);
  const fromConfig = config?.userLevel?.mode;
  const fromEnv = process.env[USER_LEVEL_MODE_ENV];

  let requested: string;
  let source: UserLevelResolution["source"];
  if (fromConfig !== undefined && fromConfig !== null) {
    requested = String(fromConfig);
    source = "config";
  } else if (fromEnv !== undefined && fromEnv.trim() !== "") {
    requested = fromEnv.trim();
    source = "env";
  } else {
    requested = "auto";
    source = "default";
  }

  const origin = source === "env" ? USER_LEVEL_MODE_ENV : "userLevel.mode (config or --mode)";

  if (!(VALID_USER_LEVEL_MODES as readonly string[]).includes(requested)) {
    return {
      mode: "manifest",
      source,
      refusal:
        `user-level write mode "${requested}" from ${origin} is not one of ` +
        `${VALID_USER_LEVEL_MODES.join(", ")}. Refusing to guess what was meant: ` +
        "staged for handoff and left ~/.claude untouched.",
    };
  }

  const mode = requested as ConfiguredUserLevelMode;

  if (mode === "direct") {
    if (managed) {
      return {
        mode: "manifest",
        source,
        refusal:
          "Refusing a direct write to ~/.claude: a .managed sentinel says another tool owns " +
          `that slot, while ${origin} asks for "direct". The sentinel wins — it is the only ` +
          "signal from the side that owns the directory. The content was staged for handoff " +
          "instead and ~/.claude was not touched. Remove ~/.claude/.managed if AgentBoot owns " +
          'this slot, or drop the explicit "direct" mode.',
      };
    }
    return { mode: "direct", source, refusal: null };
  }

  if (mode === "manifest") return { mode: "manifest", source, refusal: null };

  return { mode: managed ? "manifest" : "direct", source, refusal: null };
}

/**
 * The effective write mode. Thin shim over {@link resolveUserLevelModeDetailed}
 * for callers that only need the verdict; anything that WRITES must use the
 * detailed form, because a refusal is invisible here.
 */
export function resolveUserLevelMode(
  config?: AgentBootConfig,
  claudeDir: string = getClaudeDir(),
): UserLevelMode {
  return resolveUserLevelModeDetailed(config, claudeDir).mode;
}

/**
 * Match `{{ template_var }}` placeholders. AgentBoot content delivered to a
 * user-level config manager MUST be fully resolved: one unresolved var fails the
 * manager's all-or-nothing template resolution, taking every other tool's content
 * down with it (cross-system audit RISK #2). This guard catches them at write time.
 */
const TEMPLATE_VAR_PATTERN = /\{\{\s*[\w.\-]+\s*\}\}/g;

export function findTemplateVars(content: string): string[] {
  const matches = content.match(TEMPLATE_VAR_PATTERN);
  return matches ? [...new Set(matches)] : [];
}

export interface PrunedUserArtifact {
  /** Path relative to ~/.claude/ */
  path: string;
  /** "removed" — withdrawn; "blocked" — edited by the user, left alone. */
  status: "removed" | "blocked";
}

export interface WriteDirectlyResult {
  skillsWritten: string[];
  rulesWritten: string[];
  skipped: string[];
  errors: string[];
  /**
   * E1: artifacts the PREVIOUS install-user delivered that this one did not.
   *
   * Without this, `writeDirectly` was a pure copy-in and the manifest recorded
   * only the NEW write set — so a revoked artifact was dropped from tracking
   * while remaining on disk in ~/.claude/, still loading in every session.
   * Commit 47ef85c's own message calls that "strictly worse than leaving it
   * tracked-and-stale", because it is invisible to `uninstall --user` too.
   */
  pruned: PrunedUserArtifact[];
}

/**
 * Check if ~/.claude/ exists and whether it has AgentBoot-managed content.
 */
export function detectExistingContent(): {
  claudeDirExists: boolean;
  hasManifest: boolean;
  manifestPath: string;
} {
  const claudeDir = getClaudeDir();
  const manifestPath = path.join(claudeDir, ".agentboot-user-manifest.json");
  return {
    claudeDirExists: fs.existsSync(claudeDir),
    hasManifest: fs.existsSync(manifestPath),
    manifestPath,
  };
}

/**
 * Write compiled skills and rules directly to ~/.claude/.
 * Only writes directory-slot files (skills/, rules/).
 * Skips CLAUDE.md and settings.json (safe composition needs the external provider).
 *
 * `options.claudeDir` overrides the target. It is not a convenience: without it,
 * `installUserLevel({ claudeDir })` accepted a target directory, resolved the MODE
 * against it, and then wrote to `getClaudeDir()` anyway — the injection decided
 * whether to write and had no say in WHERE. See the note on {@link installUserLevel}.
 */
export function writeDirectly(
  distClaudeCorePath: string,
  options?: { dryRun?: boolean; claudeDir?: string },
): WriteDirectlyResult {
  const claudeDir = options?.claudeDir ?? getClaudeDir();
  const result: WriteDirectlyResult = {
    skillsWritten: [],
    rulesWritten: [],
    skipped: [],
    errors: [],
    pruned: [],
  };

  // E1: read what the PREVIOUS install delivered, before we overwrite the
  // manifest with the new write set.
  const previous = loadUserManifestHashes(claudeDir);

  if (!fs.existsSync(distClaudeCorePath)) {
    result.errors.push(`dist path does not exist: ${distClaudeCorePath}`);
    return result;
  }

  // Write skills
  const skillsSrc = path.join(distClaudeCorePath, "skills");
  if (fs.existsSync(skillsSrc)) {
    const skillsDest = path.join(claudeDir, "skills");
    copyDirContents(skillsSrc, skillsDest, result.skillsWritten, result.errors, options?.dryRun);
  }

  // Write rules (instructions compiled as rules)
  const rulesSrc = path.join(distClaudeCorePath, "rules");
  if (fs.existsSync(rulesSrc)) {
    const rulesDest = path.join(claudeDir, "rules");
    copyDirContents(rulesSrc, rulesDest, result.rulesWritten, result.errors, options?.dryRun);
  }

  // Explicitly skip CLAUDE.md and settings.json — safe append/merge into those
  // composed files is the external provider's job (cross-system audit RISK #1 and #3).
  result.skipped.push("CLAUDE.md (composed file — left to the external provider)");
  result.skipped.push("settings.json (composed file — left to the external provider)");

  // E1: withdraw what the previous install delivered and this one did not.
  //
  // Same invariant as sync's file prune: removal is confined to the PREVIOUS
  // MANIFEST, which lists only files AgentBoot itself wrote, so this can never
  // delete a file it did not create. A user-edited file is blocked rather than
  // removed — a local edit is a decision, and silently discarding it would be
  // the destructive-surprise class this codebase keeps closing.
  const written = new Set(
    [...result.skillsWritten, ...result.rulesWritten].map((f) => toManifestPath(claudeDir, f)),
  );
  const plan = planOrphanRemoval(
    previous,
    written,
    (rel) => {
      const abs = path.join(claudeDir, rel);
      if (!fs.existsSync(abs)) return null;
      try {
        return createHash("sha256").update(fs.readFileSync(abs, "utf-8")).digest("hex");
      } catch {
        return null;
      }
    },
  );
  for (const rel of plan.remove) {
    if (!options?.dryRun) {
      try {
        fs.unlinkSync(path.join(claudeDir, rel));
      } catch (err) {
        result.errors.push(`Failed to remove revoked ${rel}: ${(err as Error).message}`);
        continue;
      }
    }
    result.pruned.push({ path: rel, status: "removed" });
  }
  for (const b of plan.blocked) {
    result.pruned.push({ path: b.path, status: "blocked" });
  }
  if (!options?.dryRun && plan.remove.length > 0) {
    pruneEmptyDirs(claudeDir, plan.remove);
  }

  // Write user manifest to track what we wrote.
  //
  // A BLOCKED artifact stays in the manifest: it is still on disk and still
  // AgentBoot's to account for. Dropping it here would reproduce the exact
  // defect this change closes — untracked content that no command can remove.
  if (!options?.dryRun) {
    const stillTracked = [...result.skillsWritten, ...result.rulesWritten];
    for (const b of plan.blocked) stillTracked.push(path.join(claudeDir, b.path));
    const manifest = generateUserManifest(stillTracked, claudeDir);
    const manifestPath = path.join(claudeDir, ".agentboot-user-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return result;
}

function copyDirContents(
  src: string,
  dest: string,
  written: string[],
  errors: string[],
  dryRun?: boolean,
): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!dryRun) fs.mkdirSync(destPath, { recursive: true });
      copyDirContents(srcPath, destPath, written, errors, dryRun);
    } else {
      // Guard (scanned even in dry-run so it surfaces): never deliver content with
      // unresolved {{ template vars }} to ~/.claude/.
      let content: string | null = null;
      try {
        content = fs.readFileSync(srcPath, "utf-8");
      } catch {
        content = null;
      }
      if (content !== null) {
        const vars = findTemplateVars(content);
        if (vars.length > 0) {
          errors.push(
            `Skipped ${path.relative(src, srcPath)} — unresolved template var(s) ${vars.join(", ")}; ` +
              "AgentBoot content must be fully resolved before it reaches ~/.claude/.",
          );
          continue;
        }
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
      written.push(destPath);
    }
  }
}

/**
 * POSIX-normalized path relative to a root, and the ONLY way a path may enter
 * or leave the user manifest.
 *
 * R1-3: this existed and the manifest writer did not use it. `generateUserManifest`
 * called bare `path.relative()`, so on Windows the manifest held
 * `skills\ab\SKILL.md` while the keep-set built here held `skills/ab/SKILL.md`.
 * Every previously-delivered file then missed `kept.has()`, was classified as a
 * revoked orphan, hashed equal (it had just been rewritten unchanged), and was
 * UNLINKED — a second `agentboot install-user` deleted the artifacts the first
 * one installed. On POSIX the two forms coincide, which is why the suite was
 * green: the divergence is invisible on the only OS the tests had actually run on.
 *
 * prune.ts states the contract in its own header ("relative POSIX paths"); this
 * is that contract, enforced in one place instead of restated at each call site.
 */
export function toManifestPath(root: string, absPath: string): string {
  return path.relative(root, absPath).replace(/\\/g, "/");
}

/**
 * Normalize a path READ from a manifest.
 *
 * A manifest written by a pre-R1-3 build on Windows carries backslashes. Fixing
 * only the writer would make the first post-upgrade install treat every legacy
 * entry as an orphan — the same deletion, once, on the way out. Normalizing on
 * read makes the transition inert.
 */
export function fromManifestPath(rel: string): string {
  return rel.replace(/\\/g, "/");
}

/**
 * E1: previous manifest as path → hash, or null when there is no previous install.
 *
 * Exported for R1-3: the read side normalizes too, so a legacy backslash
 * manifest written by a pre-fix Windows build does not read as one big orphan
 * set on the first run after the upgrade.
 */
export function loadUserManifestHashes(claudeDir: string): Map<string, string> | null {
  const manifestPath = path.join(claudeDir, ".agentboot-user-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      files?: Array<{ path?: string; hash?: string }>;
    };
    const out = new Map<string, string>();
    for (const f of manifest.files ?? []) {
      if (f.path && f.hash) out.set(fromManifestPath(f.path), f.hash);
    }
    return out;
  } catch {
    // Unreadable manifest → treat as "no previous install" and prune NOTHING.
    // Guessing here would delete files we cannot prove we wrote.
    return null;
  }
}

/**
 * Generate a manifest tracking what AgentBoot wrote to ~/.claude/.
 */
export function generateUserManifest(
  writtenFiles: string[],
  claudeDir: string,
): Record<string, unknown> {
  const files = writtenFiles.map(f => {
    // R1-3: POSIX-normalized, because the keep-set that is compared against
    // this manifest on the next run is POSIX-normalized. Two path spellings for
    // one file is the drift that made install-user delete its own output.
    const relPath = toManifestPath(claudeDir, f);
    let hash = "";
    try {
      const content = fs.readFileSync(f, "utf-8");
      hash = createHash("sha256").update(content).digest("hex");
    } catch { /* file may not exist in dry-run */ }
    return { path: relPath, hash };
  });

  return {
    managed_by: "agentboot",
    scope: "user",
    written_at: new Date().toISOString(),
    files,
  };
}

/**
 * Remove AgentBoot-managed content from ~/.claude/.
 * Only removes files tracked in the user manifest.
 */
export function removeUserContent(): { removed: string[]; errors: string[] } {
  const { hasManifest, manifestPath } = detectExistingContent();
  const removed: string[] = [];
  const errors: string[] = [];

  if (!hasManifest) {
    return { removed, errors: ["No AgentBoot user manifest found"] };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const claudeDir = getClaudeDir();

    const resolvedClaudeDir = path.resolve(claudeDir) + path.sep;
    for (const file of manifest.files ?? []) {
      const filePath = path.resolve(path.join(claudeDir, file.path));
      // Security: prevent path traversal via tampered manifest
      if (!filePath.startsWith(resolvedClaudeDir)) {
        errors.push(`Skipped "${file.path}" — path traversal detected (resolves outside ~/.claude/)`);
        continue;
      }
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removed.push(file.path);
        }
      } catch (err) {
        errors.push(`Failed to remove ${file.path}: ${(err as Error).message}`);
      }
    }

    // Remove manifest itself
    fs.unlinkSync(manifestPath);
  } catch (err) {
    errors.push(`Failed to read manifest: ${(err as Error).message}`);
  }

  return { removed, errors };
}

export interface StageResult {
  staged: string[];
  errors: string[];
  manifestPath: string;
  stagingDir: string;
}

/**
 * MANIFEST mode: stage the resolved slot content (skills/, rules/) into a staging
 * directory and write a handoff manifest, WITHOUT touching ~/.claude. An external
 * provider that owns ~/.claude applies the staged content. Same all-or-nothing
 * template-var guard as a direct write.
 */
export function stageForHandoff(
  distClaudeCorePath: string,
  stagingDir: string,
  options?: { dryRun?: boolean },
): StageResult {
  const result: StageResult = { staged: [], errors: [], manifestPath: "", stagingDir };

  if (!fs.existsSync(distClaudeCorePath)) {
    result.errors.push(`dist path does not exist: ${distClaudeCorePath}`);
    return result;
  }

  for (const slot of ["skills", "rules"]) {
    const src = path.join(distClaudeCorePath, slot);
    if (fs.existsSync(src)) {
      copyDirContents(src, path.join(stagingDir, slot), result.staged, result.errors, options?.dryRun);
    }
  }

  // The handoff manifest tells the external provider what to apply into ~/.claude;
  // paths are relative to the staging root.
  const manifest = {
    managed_by: "agentboot",
    scope: "user",
    mode: "manifest",
    apply_target: "~/.claude",
    written_at: new Date().toISOString(),
    files: result.staged.map((f) => {
      // R1-3: same normalization as the install manifest. This one is consumed
      // by an EXTERNAL provider, so a backslash spelling would be someone
      // else's bug report.
      const rel = toManifestPath(stagingDir, f);
      let hash = "";
      try {
        hash = createHash("sha256").update(fs.readFileSync(f)).digest("hex");
      } catch { /* not present in dry-run */ }
      return { path: rel, hash };
    }),
  };

  const manifestPath = path.join(stagingDir, ".agentboot-handoff.json");
  if (!options?.dryRun) {
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  result.manifestPath = manifestPath;
  return result;
}

export interface InstallUserLevelResult {
  mode: UserLevelMode;
  /** Present when mode === "direct". */
  direct?: WriteDirectlyResult;
  /** Present when mode === "manifest". */
  staged?: StageResult;
  /**
   * Set when the requested mode was refused (sentinel vs an explicit "direct", or
   * an unrecognized mode). Also pushed onto `staged.errors` so the CLI prints it
   * and exits non-zero without needing to know this field exists — a refusal that
   * only a programmatic caller can see is a refusal the operator never gets.
   */
  refusal?: string | null;
}

/**
 * Top-level user-level install (the SPI entry point). Resolves direct vs manifest
 * from config + the ~/.claude/.managed sentinel, then either writes ~/.claude
 * directly (AgentBoot as the provider) or stages the content + a manifest for an
 * external provider to apply.
 *
 * `options.claudeDir` names the slot for BOTH halves — the sentinel lookup and the
 * write. It used to name only the first: the mode was resolved against the caller's
 * directory and `writeDirectly()` then reached for `getClaudeDir()`, so an injected
 * path was answered with "I will write directly" and the write landed in the real
 * `$HOME/.claude`. That divergence is why the sentinel refusal had to be re-proven
 * by spawning the CLI (L47c) — a function-boundary assertion about a directory the
 * writer never consults can pass while the command writes somewhere else — and it
 * made the SPI's own test suite install a live skill and a manifest into the
 * developer's home on every run, pruning against whatever a real `install-user` had
 * left there. An injected path that silently means "the real home" is worse than no
 * parameter at all.
 */
export function installUserLevel(
  distClaudeCorePath: string,
  config?: AgentBootConfig,
  options?: { dryRun?: boolean; stagingDir?: string; claudeDir?: string },
): InstallUserLevelResult {
  const claudeDir = options?.claudeDir ?? getClaudeDir();
  const resolved = resolveUserLevelModeDetailed(config, claudeDir);

  if (resolved.mode === "direct") {
    return {
      mode: resolved.mode,
      direct: writeDirectly(distClaudeCorePath, { ...options, claudeDir }),
      refusal: null,
    };
  }

  const stagingDir = options?.stagingDir
    ?? path.join(path.resolve(distClaudeCorePath, "..", ".."), "claude-user");
  const staged = stageForHandoff(distClaudeCorePath, stagingDir, options);
  // The refusal leads: it is the reason this run is staging rather than writing,
  // and it must be the first thing printed and the reason for the non-zero exit.
  if (resolved.refusal) staged.errors.unshift(resolved.refusal);
  return { mode: resolved.mode, staged, refusal: resolved.refusal };
}
