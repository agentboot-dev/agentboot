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
 * Resolve the effective write mode from config + the sentinel.
 * - "direct"  → always write ~/.claude directly.
 * - "manifest"→ always stage for handoff, never write ~/.claude.
 * - "auto" (default) → manifest if the slot is externally managed, else direct.
 */
export function resolveUserLevelMode(
  config?: AgentBootConfig,
  claudeDir: string = getClaudeDir(),
): UserLevelMode {
  const configured = config?.userLevel?.mode ?? "auto";
  if (configured === "direct") return "direct";
  if (configured === "manifest") return "manifest";
  return isExternallyManaged(claudeDir) ? "manifest" : "direct";
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
 */
export function writeDirectly(
  distClaudeCorePath: string,
  options?: { dryRun?: boolean },
): WriteDirectlyResult {
  const claudeDir = getClaudeDir();
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

/** POSIX-normalized path relative to ~/.claude/, matching the manifest format. */
function toManifestPath(claudeDir: string, absPath: string): string {
  return path.relative(claudeDir, absPath).replace(/\\/g, "/");
}

/** E1: previous manifest as path → hash, or null when there is no previous install. */
function loadUserManifestHashes(claudeDir: string): Map<string, string> | null {
  const manifestPath = path.join(claudeDir, ".agentboot-user-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      files?: Array<{ path?: string; hash?: string }>;
    };
    const out = new Map<string, string>();
    for (const f of manifest.files ?? []) {
      if (f.path && f.hash) out.set(f.path, f.hash);
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
    const relPath = path.relative(claudeDir, f);
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
      const rel = path.relative(stagingDir, f);
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
}

/**
 * Top-level user-level install (the SPI entry point). Resolves direct vs manifest
 * from config + the ~/.claude/.managed sentinel, then either writes ~/.claude
 * directly (AgentBoot as the provider) or stages the content + a manifest for an
 * external provider to apply.
 */
export function installUserLevel(
  distClaudeCorePath: string,
  config?: AgentBootConfig,
  options?: { dryRun?: boolean; stagingDir?: string; claudeDir?: string },
): InstallUserLevelResult {
  const claudeDir = options?.claudeDir ?? getClaudeDir();
  const mode = resolveUserLevelMode(config, claudeDir);

  if (mode === "direct") {
    return { mode, direct: writeDirectly(distClaudeCorePath, options) };
  }

  const stagingDir = options?.stagingDir
    ?? path.join(path.resolve(distClaudeCorePath, "..", ".."), "claude-user");
  return { mode, staged: stageForHandoff(distClaudeCorePath, stagingDir, options) };
}
