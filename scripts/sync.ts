/**
 * AgentBoot sync script.
 *
 * Reads repos.json and distributes compiled output from dist/{platform}/ to each
 * registered repository. For each repo, it merges the applicable scopes in order:
 *
 *   1. dist/{platform}/core/                    — org baseline (all repos)
 *   2. dist/{platform}/groups/{group}/          — group-level additions
 *   3. dist/{platform}/teams/{group}/{team}/    — team-level additions
 *
 * Higher specificity scope wins on filename conflict:
 *   team > group > core
 *
 * Output is written to {repo}/.claude/ (or the configured targetDir).
 * copilot-instructions.md fragments are also written to {repo}/.github/.
 *
 * Usage:
 *   npm run sync
 *   tsx scripts/sync.ts
 *   tsx scripts/sync.ts --dry-run
 *   tsx scripts/sync.ts --config path/to/agentboot.config.json
 *   tsx scripts/sync.ts --repos path/to/repos.json
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  type AgentBootConfig,
  resolveConfigPath,
  loadConfig,
  agentbootNpxSpec,
  DEFAULT_OUTPUT_FORMATS,
  SYNCABLE_OUTPUT_FORMATS,
  PLATFORM_ALIASES,
  resolveRepoPlatforms,
} from "./lib/config.js";
import { checkDistFreshness, staleDistMessage } from "./lib/dist-stamp.js";
import { childScopeNames } from "./lib/scope-layout.js";
import { detectGitignoreConflicts } from "./lib/gitignore.js";
import { hasBeenImported } from "./lib/import.js";
import { planOrphanRemoval, pruneEmptyDirs } from "./lib/prune.js";
import {
  collectHubProvenance,
  buildSyncPrBody,
  buildDsseEnvelope,
  computeManifestDigest,
  signManifestDigest,
  type HubProvenance,
  type ManifestIntegrity,
} from "./lib/provenance.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// D6: per-run sync context — hub provenance collected once in main() and read
// by manifest generation and PR creation. Null outside a full sync run (then
// provenance degrades to version-only and manifests are unsigned).
// ---------------------------------------------------------------------------

interface SyncRunContext {
  provenance: HubProvenance;
  /** Resolved SSH private-key path when sync.signing is enabled; else null. */
  signingKeyPath: string | null;
  /** v0.19.0: also emit the in-toto/DSSE attestation next to the manifest. */
  emitInToto: boolean;
  /** The hub directory (the loaded config's dir) — used to read the import ledger. */
  configDir: string;
}

let syncRunContext: SyncRunContext | null = null;

interface RepoEntry {
  // Absolute or relative path to the repo root.
  path: string;
  // Platform distribution to sync (singular, deprecated — use `platforms`).
  // Defaults to "claude".
  platform?: string;
  // Multiple platform distributions to sync to this repo.
  // e.g., ["claude", "copilot"] — repo receives both platform outputs.
  // Takes precedence over `platform` if both are set.
  platforms?: string[];
  // Group this repo belongs to (must match a key in config.groups).
  group?: string;
  // Team this repo belongs to (must be a member of the group's teams).
  team?: string;
  // Human-readable label. Used in sync output only.
  label?: string;
  // If true, suppress org-identifying information in generated file headers.
  public?: boolean;
  // AB-142: Monorepo support — sync to specific packages instead of repo root.
  // When specified, each package path (relative to repo root) gets its own persona deployment.
  // e.g., ["packages/api", "packages/web"]
  packages?: string[];
  // F-1: regex sources for revoked artifacts this spoke is allowed to keep.
  // A match is never unlinked and downgrades the "could not withdraw" error to
  // a warning that still prints on every sync — it silences the error, never
  // the fact.
  retain?: string[];
}

/**
 * Common aliases for platform names. People naturally write the product name
 * ("claude-code") where the canonical id is expected ("claude") — accept the
 * alias instead of failing their first sync.
 */
// A4: moved to lib/config.ts so `status` and `doctor` compare the SAME
// normalized ids sync does. Keeping this private to sync is why the two other
// consumers were comparing raw strings.

/**
 * Normalize platform(s) for a repo entry. Handles both the old singular
 * `platform` field and the new `platforms` array, and resolves common
 * aliases to canonical platform ids. Returns an array.
 */
function getRepoPlatforms(entry: RepoEntry): string[] {
  return resolveRepoPlatforms(entry);
}

interface SyncResult {
  repo: string;
  label?: string;
  platform?: string;
  group?: string;
  team?: string;
  filesWritten: string[];
  filesSkipped: string[];  // unchanged files (same content)
  /** F-1: files the hub stopped producing, unlinked from the spoke. */
  filesRemoved: string[];
  /** F-1: revoked files sync could NOT withdraw because the spoke edited them.
   *  An unremediated revocation — reported, never silently dropped. */
  removalBlocked: Array<{ path: string; reason: "modified-locally" }>;
  /** F-1: revoked files left in place by an explicit `retain` pattern. */
  removalRetained: string[];
  errors: string[];
  dryRun: boolean;
  prUrl?: string;
  /** True when smart sync determined the repo is already up-to-date. */
  skippedNoChanges?: boolean;
  /** B.1: managed files git would ignore here (repo-relative), with the source
   * of the matching rule (UI-6: global-gitignore matches are attributed). */
  gitignoreConflicts?: Array<{ file: string; source?: string; fromGlobal?: boolean }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadRepos(reposPath: string, configDir: string): RepoEntry[] {
  const resolved = path.resolve(configDir, reposPath);
  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`✗ repos.json not found: ${resolved}`));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf-8")) as RepoEntry[];
}

function ensureDir(dirPath: string, dryRun: boolean): void {
  if (!dryRun) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(filePath: string, content: string, dryRun: boolean): "written" | "skipped" {
  if (dryRun) {
    // In dry-run mode, always report as "would write".
    return "written";
  }

  // Check if the file already has the same content to avoid unnecessary writes.
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) {
      // Even when content is unchanged, ensure .sh files have the execute bit.
      // Without this, a fresh clone (git doesn't preserve 0o755 on all platforms)
      // or a manual chmod 644 would never be corrected by subsequent syncs.
      if (filePath.endsWith(".sh")) {
        const mode = fs.statSync(filePath).mode;
        if ((mode & 0o111) === 0) fs.chmodSync(filePath, 0o755);
      }
      return "skipped";
    }
  }

  ensureDir(path.dirname(filePath), false);
  fs.writeFileSync(filePath, content, "utf-8");
  // Shell hook scripts must be executable so Claude Code hooks can invoke them.
  if (filePath.endsWith(".sh")) {
    fs.chmodSync(filePath, 0o755);
  }
  return "written";
}

// ---------------------------------------------------------------------------
// Scope file collection
// ---------------------------------------------------------------------------

interface ScopedFile {
  relativePath: string; // relative to the scope root (e.g. "code-reviewer/SKILL.md")
  absolutePath: string;
  scope: "core" | "group" | "team";
}

/**
 * Recursively collect all files from a directory, returning them as
 * ScopedFile entries. Filters out non-content files.
 */
function collectScopeFiles(
  scopeDir: string,
  scope: "core" | "group" | "team"
): ScopedFile[] {
  if (!fs.existsSync(scopeDir)) {
    return [];
  }

  const results: ScopedFile[] = [];

  function walk(dir: string, relBase: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const absPath = path.join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      const stat = fs.statSync(absPath);

      if (stat.isDirectory()) {
        walk(absPath, relPath);
      } else {
        results.push({
          relativePath: relPath,
          absolutePath: absPath,
          scope,
        });
      }
    }
  }

  walk(scopeDir, "");
  return results;
}

/**
 * Load a composition manifest from a scope directory.
 * Returns a mapping of relative paths to composition types.
 * If no manifest exists, returns empty (all default to preference = current behavior).
 */
function loadCompositionManifest(scopeDir: string): Record<string, string> {
  const manifestPath = path.join(scopeDir, "composition-manifest.json");
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    // Validate: only accept "rule" or "preference" values
    const validated: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === "rule" || value === "preference") {
        validated[key] = value as string;
      }
    }
    return validated;
  } catch {
    return {};
  }
}

interface MergeResult {
  merged: Map<string, ScopedFile>;
  warnings: string[];
}

/**
 * Merge files from multiple scopes with composition-type awareness.
 *
 * - `rule` composition: higher scope (core) wins. Lower scope overrides are ignored with a warning.
 * - `preference` composition: lower scope (team) wins. This is the default/backward-compatible behavior.
 *
 * Composition types are read from composition-manifest.json in each scope directory.
 * If no manifest exists, all files default to `preference` (backward compatible).
 */
function mergeScopes(
  coreFiles: ScopedFile[],
  groupFiles: ScopedFile[],
  teamFiles: ScopedFile[],
  coreDir?: string,
  groupDir?: string,
): MergeResult {
  const merged = new Map<string, ScopedFile>();
  const warnings: string[] = [];

  // Load composition manifests
  const coreManifest = coreDir ? loadCompositionManifest(coreDir) : {};
  const groupManifest = groupDir ? loadCompositionManifest(groupDir) : {};

  // Apply core files first (baseline)
  for (const file of coreFiles) {
    merged.set(file.relativePath, file);
  }

  // Apply group files with composition check
  for (const file of groupFiles) {
    if (merged.has(file.relativePath)) {
      const compositionType = coreManifest[file.relativePath] ?? "preference";
      if (compositionType === "rule") {
        warnings.push(`${file.relativePath}: org-level rule — group override ignored`);
        continue;
      }
    }
    merged.set(file.relativePath, file);
  }

  // Apply team files with composition check
  for (const file of teamFiles) {
    if (merged.has(file.relativePath)) {
      const existing = merged.get(file.relativePath)!;
      // Always check core manifest first — core rules are authoritative regardless
      // of which scope currently holds the file. Then check group manifest.
      const compositionType =
        coreManifest[file.relativePath] ??
        groupManifest[file.relativePath] ??
        "preference";
      if (compositionType === "rule") {
        warnings.push(`${file.relativePath}: ${existing.scope}-level rule — team override ignored`);
        continue;
      }
    }
    merged.set(file.relativePath, file);
  }

  return { merged, warnings };
}

// ---------------------------------------------------------------------------
// Copilot instructions merger
// ---------------------------------------------------------------------------

/**
 * Build a merged copilot-instructions.md from all persona copilot fragments.
 * GitHub Copilot reads a single file, so we concatenate all fragments.
 */
function buildCopilotInstructions(
  mergedFiles: Map<string, ScopedFile>,
  org: string,
  isPublic?: boolean
): string | null {
  const fragments: string[] = [];

  for (const [relPath, file] of mergedFiles) {
    if (relPath.endsWith("copilot-instructions.md")) {
      fragments.push(fs.readFileSync(file.absolutePath, "utf-8").trim());
    }
  }

  if (fragments.length === 0) return null;

  // Suppress org-identifying info for public repos
  const header = isPublic
    ? `<!-- AgentBoot merged copilot instructions — do not edit manually. -->\n\n`
    : [
        `<!-- AgentBoot merged copilot instructions — do not edit manually. -->`,
        `<!-- Org: ${org} | Generated: ${new Date().toISOString()} -->`,
        "",
      ].join("\n");

  return `${header}${fragments.join("\n\n---\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Archive: snapshot existing .claude/ before first sync
// ---------------------------------------------------------------------------

interface ArchiveManifestEntry {
  path: string;
  timestamp: string;
  size: number;
}

interface ArchiveManifest {
  archived_by: "agentboot";
  archived_at: string;
  source_dir: string;
  files: ArchiveManifestEntry[];
}

/**
 * Archive all existing content in the target directory before first sync.
 * Only runs when no archive already exists (first sync to this repo).
 * Returns true if archive was created or already existed, false on error.
 */
function archiveExistingContent(
  repoPath: string,
  targetDir: string,
  dryRun: boolean
): { archived: boolean; fileCount: number } {
  const targetBase = path.join(repoPath, targetDir);
  const archiveDir = path.join(targetBase, ".agentboot-archive");
  const archiveManifestPath = path.join(archiveDir, "archive-manifest.json");

  // If archive already exists, this is not a first sync — skip.
  if (fs.existsSync(archiveManifestPath)) {
    return { archived: false, fileCount: 0 };
  }

  // BUG-7: Also check for sync manifest — if it exists, a previous sync happened
  // and the archive was deleted. Do not re-archive (would capture AgentBoot artifacts).
  const syncManifestPath = path.join(targetBase, ".agentboot-manifest.json");
  if (fs.existsSync(syncManifestPath)) {
    return { archived: false, fileCount: 0 };
  }

  // Collect all existing files (excluding any prior agentboot artifacts).
  const filesToArchive: { relPath: string; absPath: string }[] = [];

  // Walk .claude/ directory (if it exists)
  if (fs.existsSync(targetBase)) {
    function walk(dir: string, relBase: string): void {
      for (const entry of fs.readdirSync(dir)) {
        // Skip agentboot artifacts
        if (relBase === "" && (entry === ".agentboot-archive" || entry === ".agentboot-manifest.json" || entry === ".agentboot-manifest.intoto.json")) continue;
        const absPath = path.join(dir, entry);
        const relPath = relBase ? `${relBase}/${entry}` : entry;
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          walk(absPath, relPath);
        } else {
          filesToArchive.push({ relPath, absPath });
        }
      }
    }
    walk(targetBase, "");
  }

  // BUG-6: Also archive repo-root files that sync will overwrite.
  // v0.16.0: the list must cover EVERY root artifact any platform sync can
  // write — AGENTS.md and .cursorrules were previously destroyed with no
  // archive on an --adopt-existing first sync (bespoke content, unrecoverable).
  const rootFiles = ["CLAUDE.md", ".mcp.json", "AGENTS.md", ".cursorrules", "GEMINI.md"];
  for (const rootFile of rootFiles) {
    const absPath = path.join(repoPath, rootFile);
    if (fs.existsSync(absPath)) {
      filesToArchive.push({ relPath: `__root__/${rootFile}`, absPath });
    }
  }
  const copilotPath = path.join(repoPath, ".github", "copilot-instructions.md");
  if (fs.existsSync(copilotPath)) {
    filesToArchive.push({ relPath: "__root__/.github/copilot-instructions.md", absPath: copilotPath });
  }

  if (filesToArchive.length === 0) {
    return { archived: false, fileCount: 0 };
  }

  if (dryRun) {
    return { archived: true, fileCount: filesToArchive.length };
  }

  // Create archive directory and copy files.
  fs.mkdirSync(archiveDir, { recursive: true });

  const manifestEntries: ArchiveManifestEntry[] = [];

  for (const file of filesToArchive) {
    const destPath = path.join(archiveDir, file.relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(file.absPath, destPath);
    const stat = fs.statSync(file.absPath);
    manifestEntries.push({
      path: file.relPath.replace(/\\/g, "/"), // POSIX separators — portable manifest
      timestamp: stat.mtime.toISOString(),
      size: stat.size,
    });
  }

  // Write archive manifest.
  const manifest: ArchiveManifest = {
    archived_by: "agentboot",
    archived_at: new Date().toISOString(),
    source_dir: targetDir,
    files: manifestEntries,
  };

  fs.writeFileSync(
    archiveManifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8"
  );

  return { archived: true, fileCount: filesToArchive.length };
}

// ---------------------------------------------------------------------------
// Drift detection: check if managed files were modified outside AgentBoot
// ---------------------------------------------------------------------------

interface DriftResult {
  drifted: string[];
  clean: boolean;
}

/**
 * Check managed files against the manifest. Returns list of files that
 * have been modified since last sync (hash mismatch).
 */
function detectDrift(
  repoPath: string,
  targetDir: string
): DriftResult {
  const manifestPath = path.join(repoPath, targetDir, ".agentboot-manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return { drifted: [], clean: true };
  }

  let manifest: {
    files?: Array<{ path: string; hash: string }>;
    retired?: Array<{ path: string; reason: string }>;
  };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    // Corrupt manifest = broken integrity check. Refuse sync.
    return { drifted: [".agentboot-manifest.json (unreadable — corrupt or malformed)"], clean: false };
  }

  const drifted: string[] = [];
  for (const entry of manifest.files ?? []) {
    // Skip the manifest's own entry (it contains a timestamp so it always "drifts")
    if (entry.path.endsWith(".agentboot-manifest.json") || entry.path.endsWith(".agentboot-manifest.intoto.json")) continue;

    const fullPath = path.resolve(repoPath, entry.path);
    if (!fs.existsSync(fullPath)) {
      // BUG-4: Deleted managed files are drift — someone removed an AgentBoot file
      drifted.push(`${entry.path} (deleted)`);
      continue;
    }
    const content = fs.readFileSync(fullPath);
    const currentHash = createHash("sha256").update(content).digest("hex");
    if (currentHash !== entry.hash) {
      drifted.push(entry.path);
    }
  }

  // F-1 / §2D: a revoked artifact sync could not withdraw is drift. Without
  // this pass drift-check reported the repo clean precisely BECAUSE the file
  // had dropped out of `files` — a revoked control still live on a spoke is not
  // a clean repo. High-precision by construction: only files AgentBoot itself
  // previously delivered and has since been unable to remove are listed, so no
  // hand-written .claude/ content is ever flagged.
  for (const entry of manifest.retired ?? []) {
    const fullPath = path.resolve(repoPath, entry.path);
    if (fs.existsSync(fullPath)) {
      drifted.push(`${entry.path} (retired — revoked at the hub, still present here)`);
    }
  }

  return { drifted, clean: drifted.length === 0 };
}

// ---------------------------------------------------------------------------
// AB-142: Monorepo detection
// ---------------------------------------------------------------------------

/**
 * Detect if a repo looks like a monorepo (has packages/ or apps/ directories)
 * but has no explicit packages configuration. Emits a warning to help users
 * discover the monorepo support feature.
 */
function detectMonorepo(repoPath: string): string[] {
  const monorepoMarkers = ["packages", "apps"];
  const detected: string[] = [];
  for (const marker of monorepoMarkers) {
    const markerPath = path.join(repoPath, marker);
    if (fs.existsSync(markerPath) && fs.statSync(markerPath).isDirectory()) {
      // List subdirectories as potential packages
      try {
        const entries = fs.readdirSync(markerPath);
        for (const entry of entries) {
          const entryPath = path.join(markerPath, entry);
          if (fs.statSync(entryPath).isDirectory()) {
            detected.push(`${marker}/${entry}`);
          }
        }
      } catch { /* permission denied — skip */ }
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Smart sync: check if repo is already up-to-date
// ---------------------------------------------------------------------------

/**
 * Load the existing manifest from a repo and build a hash lookup.
 * Returns null if no manifest exists (first sync).
 */
function loadManifestHashes(
  repoPath: string,
  targetDir: string
): Map<string, string> | null {
  const manifestPath = path.join(repoPath, targetDir, ".agentboot-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const hashes = new Map<string, string>();
    for (const entry of manifest.files ?? []) {
      if (entry.path && entry.hash) {
        hashes.set(entry.path, entry.hash);
      }
    }
    return hashes;
  } catch {
    return null; // Corrupt manifest — sync as normal
  }
}

/**
 * F-1: metadata the orphan-removal pass needs from the previous manifest.
 *
 * `platform` exists because several platforms share a targetDir (copilot,
 * codex-as-claude and claude all land under `.claude` by default). Two
 * platforms syncing to one repo therefore overwrite each other's manifest —
 * which was harmless while sync only ever wrote, and is catastrophic now that
 * it deletes: platform B would read platform A's manifest and see every one of
 * A's files as an orphan.
 */
function loadManifestMeta(
  repoPath: string,
  targetDir: string,
): { platform: string | null; retired: Array<{ path: string; reason: string; hash_expected: string | null }> } {
  const manifestPath = path.join(repoPath, targetDir, ".agentboot-manifest.json");
  if (!fs.existsSync(manifestPath)) return { platform: null, retired: [] };
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      platform?: string;
      retired?: Array<{ path: string; reason: string; hash_expected: string | null }>;
    };
    return { platform: m.platform ?? null, retired: m.retired ?? [] };
  } catch {
    return { platform: null, retired: [] };
  }
}

/**
 * Compute the merged .mcp.json content that sync would write to a spoke.
 * Mirrors the merge logic in syncRepoTarget so isRepoUpToDate can hash
 * the same bytes that the manifest recorded on the previous sync.
 */
function buildMcpContent(
  mergedFiles: Map<string, ScopedFile>,
  existingMcpPath: string,
): string {
  const agentbootEntry = { command: "npx", args: [agentbootNpxSpec(), "mcp-server"] };
  let mcpServers: Record<string, unknown> = {};
  const mcpDistFile = mergedFiles.get(".mcp.json");
  if (mcpDistFile) {
    try {
      const distContent = JSON.parse(fs.readFileSync(mcpDistFile.absolutePath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
      };
      if (distContent.mcpServers) mcpServers = { ...distContent.mcpServers };
    } catch { /* ignore */ }
  }
  if (fs.existsSync(existingMcpPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingMcpPath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
      };
      if (existing.mcpServers) mcpServers = { ...existing.mcpServers, ...mcpServers };
    } catch { /* ignore */ }
  }
  mcpServers["agentboot"] = agentbootEntry;
  return JSON.stringify({ mcpServers }, null, 2) + "\n";
}

/**
 * Check if all files that would be synced to a repo match the existing manifest.
 * Returns true if the repo is up-to-date and can be skipped.
 */
function isRepoUpToDate(
  mergedFiles: Map<string, ScopedFile>,
  repoPath: string,
  targetDir: string,
  platform: string,
  distPath: string,
  org: string,
  isPublic?: boolean,
  writePersonasIndex?: boolean,
): boolean {
  const manifestHashes = loadManifestHashes(repoPath, targetDir);
  if (!manifestHashes) return false; // No manifest = first sync, must sync

  // Build a map of destination-path → source-content-hash for everything we would write
  const wouldWrite = new Map<string, string>();

  for (const [relPath, file] of mergedFiles) {
    // Skip copilot fragments — they get merged into a single file
    if (relPath.endsWith("copilot-instructions.md")) continue;
    if (relPath === "PERSONAS.md") continue;
    if (relPath === ".mcp.json" || relPath === "CLAUDE.md") continue;

    const content = fs.readFileSync(file.absolutePath);
    const hash = createHash("sha256").update(content).digest("hex");

    let destRelPath: string;
    if (platform === "cursor") {
      destRelPath = path.join(".cursor", relPath);
    } else if (platform === "copilot") {
      if (relPath.startsWith("instructions/") && relPath.endsWith(".instructions.md")) {
        destRelPath = path.join(".github", "instructions", path.basename(relPath));
      } else if (relPath.startsWith(".github/")) {
        // A1.5: governance hooks (.github/hooks/agentboot.json + scripts) land as-is.
        destRelPath = relPath;
      } else {
        continue;
      }
    } else {
      destRelPath = path.join(targetDir, relPath);
    }
    wouldWrite.set(destRelPath, hash);
  }

  // Handle merged copilot instructions
  const copilotContent = buildCopilotInstructions(mergedFiles, org, isPublic);
  if (copilotContent) {
    const hash = createHash("sha256").update(copilotContent).digest("hex");
    wouldWrite.set(path.join(".github", "copilot-instructions.md"), hash);
  }

  // Handle root-level files
  if (platform !== "copilot" && platform !== "cursor") {
    // .mcp.json: hash the merged content (dist + existing spoke + agentboot entry)
    // because that's what sync writes and what the manifest recorded.
    const mcpDestPath = path.join(repoPath, ".mcp.json");
    const mcpContent = buildMcpContent(mergedFiles, mcpDestPath);
    wouldWrite.set(".mcp.json", createHash("sha256").update(mcpContent).digest("hex"));

    // CLAUDE.md: plain file, hash the dist source directly.
    const claudeMdFile = mergedFiles.get("CLAUDE.md");
    if (claudeMdFile) {
      const content = fs.readFileSync(claudeMdFile.absolutePath);
      wouldWrite.set("CLAUDE.md", createHash("sha256").update(content).digest("hex"));
    }
  }

  // Handle PERSONAS.md
  if (writePersonasIndex) {
    const coreDir = path.join(distPath, platform, "core");
    const personasIndexSrc = path.join(coreDir, "PERSONAS.md");
    if (fs.existsSync(personasIndexSrc)) {
      const content = fs.readFileSync(personasIndexSrc);
      const hash = createHash("sha256").update(content).digest("hex");
      wouldWrite.set(path.join(targetDir, "PERSONAS.md"), hash);
    }
  }

  // Handle AGENTS.md
  const agentsMdSrc = path.join(distPath, "agents", "AGENTS.md");
  if (fs.existsSync(agentsMdSrc)) {
    const content = fs.readFileSync(agentsMdSrc);
    const hash = createHash("sha256").update(content).digest("hex");
    wouldWrite.set("AGENTS.md", hash);
  }

  // Normalize keys to POSIX before comparing: path.join above yields "\" on
  // Windows, while the manifest stores "/". Without this, every file looks
  // changed on Windows and smart-sync never skips an up-to-date repo.
  const toPosix = (p: string) => p.replace(/\\/g, "/");
  const wouldWritePosix = new Map([...wouldWrite].map(([k, v]) => [toPosix(k), v]));
  const manifestPosix = new Map([...manifestHashes].map(([k, v]) => [toPosix(k), v]));

  // Compare: every file we would write must exist in manifest with same hash
  for (const [destPath, hash] of wouldWritePosix) {
    const manifestHash = manifestPosix.get(destPath);
    if (manifestHash !== hash) return false;
  }

  // Also check: manifest shouldn't have files we wouldn't write (deleted files)
  // Skip the manifest file itself
  for (const [manifestPath] of manifestPosix) {
    if (manifestPath.endsWith(".agentboot-manifest.json") || manifestPath.endsWith(".agentboot-manifest.intoto.json")) continue;
    if (!wouldWritePosix.has(manifestPath)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Per-repo sync (single target — repo root or a package subdirectory)
// ---------------------------------------------------------------------------

function syncRepoTarget(
  entry: RepoEntry,
  distPath: string,
  config: AgentBootConfig,
  dryRun: boolean,
  force: boolean,
  /** If set, sync to this subdirectory instead of repo root. */
  packagePath?: string,
  /** Explicit platform override (for multi-platform repos). */
  platformOverride?: string,
): SyncResult {
  const repoPath = path.resolve(entry.path);
  // AB-142: When syncing to a monorepo package, effectivePath is the package root.
  const effectivePath = packagePath ? path.join(repoPath, packagePath) : repoPath;
  const rawPlatform = platformOverride ?? entry.platform ?? "claude";
  const platform = PLATFORM_ALIASES[rawPlatform] ?? rawPlatform;
  // AB-129: Platform-specific target directories
  const targetDir = platform === "cursor" ? ".cursor"
    : platform === "gemini" ? ".gemini"
    : platform === "windsurf" ? ".windsurf"
    : platform === "jetbrains" ? ".junie"
    : platform === "agents" ? ".agents"
    : platform === "codex" ? ".codex"
    : (config.sync?.targetDir ?? ".claude");
  const writePersonasIndex = config.sync?.writePersonasIndex !== false;
  const org = config.orgDisplayName ?? config.org;

  const labelSuffix = packagePath ? ` [${packagePath}]` : "";
  const result: SyncResult = {
    repo: effectivePath,
    ...(entry.label != null ? { label: `${entry.label}${labelSuffix}` } : (packagePath ? { label: `${path.basename(repoPath)}${labelSuffix}` } : {})),
    platform,
    ...(entry.group != null ? { group: entry.group } : {}),
    ...(entry.team != null ? { team: entry.team } : {}),
    filesWritten: [],
    filesSkipped: [],
    filesRemoved: [],
    removalBlocked: [],
    removalRetained: [],
    errors: [],
    dryRun,
  };

  if (!fs.existsSync(effectivePath)) {
    result.errors.push(`${packagePath ? "Package" : "Repo"} path does not exist: ${effectivePath}`);
    return result;
  }

  // F-1 / §2C: refuse to ship a platform the hub does not build.
  //
  // The gate is the FILESYSTEM, not the config: since compile prunes dist/, a
  // retired platform's tree genuinely does not exist, and a filesystem check
  // cannot drift from the emitters the way a config-derived list can. The
  // config is read only to make the message name both sides.
  //
  // Before this check, repos.json and personas.outputFormats could contradict
  // each other and the contradiction was resolved silently in favour of the
  // stale tree — i.e. in favour of the RETIRED policy.
  if (!fs.existsSync(path.join(distPath, platform))) {
    const declared = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
    result.errors.push(
      `hub does not build for this platform\n` +
      `      repos.json targets \`${platform}\`, but personas.outputFormats = [${declared.join(", ")}],\n` +
      `      so dist/${platform}/ was not produced by the last build.\n` +
      `      Fix: add "${platform}" to personas.outputFormats, or change/remove this repo entry.`,
    );
    return result;
  }

  // Drift detection: check if managed files were modified outside AgentBoot.
  const drift = detectDrift(effectivePath, targetDir);
  if (!drift.clean && !force) {
    result.errors.push(
      `Drift detected — ${drift.drifted.length} managed file(s) modified outside AgentBoot:\n` +
      drift.drifted.map(f => `        ${f}`).join("\n") + "\n" +
      `      AgentBoot manages ${targetDir}/ exclusively after install.\n` +
      `      To incorporate your changes: agentboot import --path .\n` +
      `      To override: agentboot sync --force`
    );
    return result;
  }
  if (!drift.clean && force) {
    console.log(chalk.yellow(`    ⚠ Overriding drift in ${drift.drifted.length} file(s) (--force)`));
  }

  // B9: import-first sync safety. A FIRST sync onto pre-existing bespoke
  // instruction files replaces them — archived, but the knowledge goes dormant.
  // That has to be a deliberate choice, not a default: without --adopt-existing
  // the sync stops and points at import, which decomposes the bespoke content
  // into hub artifacts so nothing is lost by construction.
  const targetBaseForAdopt = path.join(effectivePath, targetDir);
  const isFirstSync =
    !fs.existsSync(path.join(targetBaseForAdopt, ".agentboot-archive", "archive-manifest.json")) &&
    !fs.existsSync(path.join(targetBaseForAdopt, ".agentboot-manifest.json"));
  if (isFirstSync && !process.argv.includes("--adopt-existing")) {
    const bespoke: string[] = [];
    for (const f of ["CLAUDE.md", ".cursorrules", "AGENTS.md"]) {
      if (fs.existsSync(path.join(effectivePath, f))) bespoke.push(f);
    }
    if (fs.existsSync(path.join(effectivePath, ".github", "copilot-instructions.md"))) {
      bespoke.push(".github/copilot-instructions.md");
    }
    if (bespoke.length > 0) {
      // If this spoke has already been imported, the knowledge is in the hub and
      // the reason for the gate is satisfied — so say so, rather than repeating a
      // recommendation the operator has already followed. `import` never modifies
      // the spoke, so the raw file test alone cannot tell the two states apart.
      const hubDir = syncRunContext?.configDir ?? process.cwd();
      const alreadyImported = hasBeenImported(hubDir, effectivePath);
      result.errors.push(
        alreadyImported
          ? `First sync would replace pre-existing instruction file(s): ${bespoke.join(", ")}.\n` +
            `      This repo HAS already been imported — its content is in the hub, so nothing is lost.\n` +
            `      Confirm the replacement:  agentboot sync --adopt-existing\n` +
            `           — originals are still archived to ${targetDir}/.agentboot-archive/`
          : `First sync would REPLACE pre-existing instruction file(s): ${bespoke.join(", ")}.\n` +
            `      They would be archived, but their knowledge goes dormant. Choose deliberately:\n` +
            `        1. Import first (recommended): agentboot import --path ${entry.path}\n` +
            `           — decomposes the bespoke content into hub artifacts, then re-run sync.\n` +
            `        2. Replace anyway:             agentboot sync --adopt-existing\n` +
            `           — originals are archived to ${targetDir}/.agentboot-archive/`
      );
      return result;
    }
  }

  // Archive existing content before first sync.
  const archive = archiveExistingContent(effectivePath, targetDir, dryRun);
  if (archive.archived) {
    const verb = dryRun ? "Would archive" : "Archived";
    console.log(chalk.cyan(`    ${verb} ${archive.fileCount} existing file(s) to ${targetDir}/.agentboot-archive/`));
  }

  // Collect files from applicable scopes within the platform distribution.
  // UI-8: compile writes scope output to dist/{platform}/nodes/<g>[/<t>]/ (the
  // AB-88 canonical layout) — sync previously only read the legacy
  // dist/{platform}/groups|teams/ dirs, so team-scope content built clean and
  // silently never reached a spoke. Read BOTH; the nodes layout wins on
  // filename conflict within the same scope tier (listed later → overrides in
  // mergeScopes, still subject to rule-composition checks).
  const platformDir = path.join(distPath, platform);
  const coreDir = path.join(platformDir, "core");
  const groupDir = entry.group
    ? path.join(platformDir, "groups", entry.group)
    : null;
  const nodeGroupDir = entry.group
    ? path.join(platformDir, "nodes", entry.group)
    : null;
  const teamDir = entry.group && entry.team
    ? path.join(platformDir, "teams", entry.group, entry.team)
    : null;
  const nodeTeamDir = entry.group && entry.team
    ? path.join(platformDir, "nodes", entry.group, entry.team)
    : null;

  /** Node-scope dirs contain composition inputs that are not spoke files. */
  const dropNodeArtifacts = (files: ScopedFile[]): ScopedFile[] =>
    files.filter((f) =>
      !f.relativePath.startsWith("managed-settings.d/") &&
      // A team node dir contains its child dirs when groups nest — exclude
      // deeper node subtrees collected via the group-level walk.
      !f.relativePath.split("/").includes("managed-settings.d")
    );

  // Child-scope subtrees must be excluded from a parent-scope walk by the
  // authoritative scope layout, not by the one registered child. Filtering
  // only `entry.team` leaked every SIBLING team's subtree into this spoke —
  // a cross-team confidentiality breach the signed manifest then certified.
  const dropChildScopes = (files: ScopedFile[], parentScopePath: string): ScopedFile[] => {
    const children = childScopeNames(config, parentScopePath);
    if (children.length === 0) return files;
    return files.filter(
      (f) => !children.some((c) => f.relativePath.startsWith(`${c}/`))
    );
  };

  const coreFiles = collectScopeFiles(coreDir, "core");
  const groupFiles = [
    ...(groupDir ? collectScopeFiles(groupDir, "group") : []),
    ...(nodeGroupDir
      ? dropChildScopes(
          dropNodeArtifacts(collectScopeFiles(nodeGroupDir, "group")),
          entry.group!,
        )
      : []),
  ];
  const teamFiles = [
    ...(teamDir ? collectScopeFiles(teamDir, "team") : []),
    ...(nodeTeamDir
      ? dropChildScopes(
          dropNodeArtifacts(collectScopeFiles(nodeTeamDir, "team")),
          `${entry.group}/${entry.team}`,
        )
      : []),
  ];

  if (coreFiles.length === 0) {
    result.errors.push(
      `dist/${platform}/core/ is empty. Run \`npm run build\` before syncing.`
    );
    return result;
  }

  const { merged, warnings } = mergeScopes(
    coreFiles, groupFiles, teamFiles,
    coreDir,
    groupDir ?? undefined
  );

  // Print composition warnings
  for (const w of warnings) {
    console.log(chalk.yellow(`  ⚠ ${w}`));
  }

  // Smart sync: check if repo is already up-to-date (skip if no changes)
  if (!force) {
    const writePersonasIndex = config.sync?.writePersonasIndex !== false;
    const upToDate = isRepoUpToDate(
      merged, effectivePath, targetDir, platform, distPath, org,
      entry.public, writePersonasIndex,
    );
    if (upToDate) {
      // Content is current, but still ensure .sh hook scripts have the execute bit.
      // Git doesn't preserve 0o755 on all platforms, and a manual chmod 644 would
      // otherwise survive undetected until the next content-changing sync.
      if (!dryRun) {
        const hooksDir = path.join(effectivePath, targetDir, "hooks");
        if (fs.existsSync(hooksDir)) {
          for (const entry of fs.readdirSync(hooksDir)) {
            if (entry.endsWith(".sh")) {
              const hookPath = path.join(hooksDir, entry);
              const mode = fs.statSync(hookPath).mode;
              if ((mode & 0o111) === 0) fs.chmodSync(hookPath, 0o755);
            }
          }
        }
      }
      result.skippedNoChanges = true;
      return result;
    }
  }

  // Write all merged files to the target directory.
  // Platform-specific routing determines where files land in the spoke repo.
  const targetBase = path.join(effectivePath, targetDir);

  // Helper: write a single merged file to the correct destination.
  const writeMergedFile = (destPath: string, file: ScopedFile): void => {
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    ensureDir(path.dirname(destPath), dryRun);
    const status = writeFile(destPath, content, dryRun);
    const relDest = path.relative(effectivePath, destPath);
    if (status === "written") {
      result.filesWritten.push(relDest);
    } else {
      result.filesSkipped.push(relDest);
    }
  };

  if (platform === "cursor") {
    // AB-129: Cursor platform — write rules/*.mdc to .cursor/rules/
    const cursorBase = path.join(effectivePath, ".cursor");
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md") continue;
      writeMergedFile(path.join(cursorBase, relPath), file);
    }
  } else if (platform === "gemini") {
    // Phase 11 A0: Gemini platform routing
    // GEMINI.md → repo root; .gemini/ subdirectory files → .gemini/
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md" || relPath === "composition-manifest.json") continue;
      if (relPath === "GEMINI.md") {
        // Root-level GEMINI.md goes to repo root
        writeMergedFile(path.join(effectivePath, "GEMINI.md"), file);
      } else {
        // Everything else goes under .gemini/ (persona files, rules, etc.)
        writeMergedFile(path.join(effectivePath, ".gemini", relPath), file);
      }
    }
    // Phase 11 A1c migration: clean up orphaned .gemini/rules/ from old format
    const orphanedRulesDir = path.join(effectivePath, ".gemini", "rules");
    if (!dryRun && fs.existsSync(orphanedRulesDir)) {
      fs.rmSync(orphanedRulesDir, { recursive: true, force: true });
      console.log(chalk.yellow(`    Removed orphaned .gemini/rules/ directory (replaced by subdirectory GEMINI.md files)`));
    }
  } else if (platform === "windsurf") {
    // Phase 11 A0: Windsurf platform routing
    // .windsurfrules → repo root; .windsurf/ files → .windsurf/
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md" || relPath === "composition-manifest.json") continue;
      if (relPath === ".windsurfrules") {
        writeMergedFile(path.join(effectivePath, ".windsurfrules"), file);
      } else if (relPath.startsWith(".windsurf/") || relPath.startsWith("rules/")) {
        writeMergedFile(path.join(effectivePath, ".windsurf", relPath.replace(/^\.windsurf\//, "")), file);
      } else {
        writeMergedFile(path.join(effectivePath, ".windsurf", relPath), file);
      }
    }
  } else if (platform === "jetbrains") {
    // Phase 11 A0: JetBrains platform routing
    // .junie/ files → .junie/; .aiassistant/ files → .aiassistant/
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md" || relPath === "composition-manifest.json") continue;
      if (relPath.startsWith(".junie/")) {
        writeMergedFile(path.join(effectivePath, relPath), file);
      } else if (relPath.startsWith(".aiassistant/")) {
        writeMergedFile(path.join(effectivePath, relPath), file);
      } else {
        // Default: write under .junie/
        writeMergedFile(path.join(effectivePath, ".junie", relPath), file);
      }
    }
  } else if (platform === "codex") {
    // Phase 11 A1.7: Codex platform routing
    // AGENTS.md → repo root (handled by AGENTS.md sync block below)
    // .codex/ files → .codex/ (config.toml, hooks.json, hooks/)
    // .agents/skills/ → .agents/skills/
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md" || relPath === "composition-manifest.json") continue;
      if (relPath === "AGENTS.md") continue; // handled by AGENTS.md sync block below
      if (relPath.startsWith(".codex/")) {
        writeMergedFile(path.join(effectivePath, relPath), file);
      } else if (relPath.startsWith(".agents/")) {
        writeMergedFile(path.join(effectivePath, relPath), file);
      } else {
        // Other files go under .codex/
        writeMergedFile(path.join(effectivePath, ".codex", relPath), file);
      }
    }
  } else if (platform === "agents") {
    // Phase 11 A0 + A1.7-3: Agents platform routing
    // AGENTS.md → repo root (handled later in AGENTS.md sync block)
    // .agents/ files → .agents/ (strip prefix if already present in relPath)
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md" || relPath === "composition-manifest.json") continue;
      if (relPath === "AGENTS.md") continue; // handled by AGENTS.md sync block below
      if (relPath.startsWith(".agents/")) {
        // Already has .agents/ prefix — write directly
        writeMergedFile(path.join(effectivePath, relPath), file);
      } else {
        writeMergedFile(path.join(effectivePath, ".agents", relPath), file);
      }
    }
  } else if (platform !== "copilot") {
    // Claude/skill and other platforms: write to targetDir (default .claude/)
    ensureDir(targetBase, dryRun);

    for (const [relPath, file] of merged) {
      // copilot-instructions.md fragments are handled separately below.
      if (relPath.endsWith("copilot-instructions.md")) continue;

      // PERSONAS.md is handled separately (controlled by writePersonasIndex config).
      if (relPath === "PERSONAS.md") continue;

      // These files need special placement at repo root, handled below.
      if (relPath === ".mcp.json" || relPath === "CLAUDE.md") continue;

      const destPath = path.join(targetBase, relPath);
      const content = fs.readFileSync(file.absolutePath, "utf-8");
      const status = writeFile(destPath, content, dryRun);

      const relDest = path.relative(effectivePath, destPath);
      if (status === "written") {
        result.filesWritten.push(relDest);
      } else {
        result.filesSkipped.push(relDest);
      }
    }
  }

  // Write merged copilot-instructions.md to .github/.
  const copilotContent = buildCopilotInstructions(merged, org, entry.public);
  if (copilotContent) {
    const copilotDest = path.join(effectivePath, ".github", "copilot-instructions.md");
    ensureDir(path.dirname(copilotDest), dryRun);
    const status = writeFile(copilotDest, copilotContent, dryRun);
    const relDest = path.relative(effectivePath, copilotDest);
    if (status === "written") {
      result.filesWritten.push(relDest);
    } else {
      result.filesSkipped.push(relDest);
    }
  }

  // AB-130: Write copilot scoped instructions to .github/instructions/
  if (platform === "copilot") {
    for (const [relPath, file] of merged) {
      if (relPath.startsWith("instructions/") && relPath.endsWith(".instructions.md")) {
        const fileName = path.basename(relPath);
        const destPath = path.join(effectivePath, ".github", "instructions", fileName);
        const content = fs.readFileSync(file.absolutePath, "utf-8");
        ensureDir(path.dirname(destPath), dryRun);
        const status = writeFile(destPath, content, dryRun);
        const relDest = path.relative(effectivePath, destPath);
        if (status === "written") {
          result.filesWritten.push(relDest);
        } else {
          result.filesSkipped.push(relDest);
        }
      }
    }
  }

  // A1.5: Write copilot governance hooks (.github/hooks/agentboot.json + scripts).
  // One committed .github/hooks file governs both the Copilot CLI and cloud agent.
  if (platform === "copilot") {
    for (const [relPath, file] of merged) {
      if (!relPath.startsWith(".github/")) continue;
      const destPath = path.join(effectivePath, relPath);
      const content = fs.readFileSync(file.absolutePath, "utf-8");
      ensureDir(path.dirname(destPath), dryRun);
      const status = writeFile(destPath, content, dryRun);
      // Preserve the execute bit on hook scripts (git/checkout may drop 0o755).
      if (status === "written" && !dryRun && relPath.endsWith(".sh")) {
        fs.chmodSync(destPath, 0o755);
      }
      const relDest = path.relative(effectivePath, destPath);
      if (status === "written") {
        result.filesWritten.push(relDest);
      } else {
        result.filesSkipped.push(relDest);
      }
    }
  }

  // Phase 11 B1: Write copilot .agent.md files to .github/agents/
  if (platform === "copilot") {
    for (const [relPath, file] of merged) {
      if (relPath.startsWith("agents/") && relPath.endsWith(".agent.md")) {
        const fileName = path.basename(relPath);
        const destPath = path.join(effectivePath, ".github", "agents", fileName);
        const content = fs.readFileSync(file.absolutePath, "utf-8");
        ensureDir(path.dirname(destPath), dryRun);
        const status = writeFile(destPath, content, dryRun);
        const relDest = path.relative(effectivePath, destPath);
        if (status === "written") {
          result.filesWritten.push(relDest);
        } else {
          result.filesSkipped.push(relDest);
        }
      }
    }
  }

  // Write root-level files (CC reads .mcp.json and CLAUDE.md from project root, not .claude/).
  if (platform !== "copilot" && platform !== "cursor") {
    // CLAUDE.md — write as-is from dist
    const claudeMdFile = merged.get("CLAUDE.md");
    if (claudeMdFile) {
      const destPath = path.join(effectivePath, "CLAUDE.md");
      const content = fs.readFileSync(claudeMdFile.absolutePath, "utf-8");
      const status = writeFile(destPath, content, dryRun);
      const relDest = path.relative(effectivePath, destPath);
      if (status === "written") result.filesWritten.push(relDest);
      else result.filesSkipped.push(relDest);
    }

    // .mcp.json — always inject the AgentBoot MCP server entry, merged with any
    // org-configured servers from dist and any servers already in the spoke.
    // No AGENTBOOT_HUB in the entry — the MCP server resolves the hub at runtime
    // from ~/.agentboot/config.json (written by `agentboot install`). This makes
    // /ab available in every spoke repo without hardcoding a machine-specific path.
    const mcpDestPath = path.join(effectivePath, ".mcp.json");
    const mcpContent = buildMcpContent(merged, mcpDestPath);
    const mcpStatus = writeFile(mcpDestPath, mcpContent, dryRun);
    if (mcpStatus === "written") result.filesWritten.push(".mcp.json");
    else result.filesSkipped.push(".mcp.json");
  }

  // Sync AGENTS.md to repo root (universal cross-tool standard).
  const agentsMdSrc = path.join(distPath, "agents", "AGENTS.md");
  if (fs.existsSync(agentsMdSrc)) {
    const destPath = path.join(effectivePath, "AGENTS.md");
    const content = fs.readFileSync(agentsMdSrc, "utf-8");
    const status = writeFile(destPath, content, dryRun);
    const relDest = path.relative(effectivePath, destPath);
    if (status === "written") {
      result.filesWritten.push(relDest);
    } else {
      result.filesSkipped.push(relDest);
    }
  }

  // Phase 11 B11: Sync scope-specific AGENTS.md files
  const agentsNodesDir = path.join(distPath, "agents", "nodes");
  if (fs.existsSync(agentsNodesDir)) {
    const walkAgentsNodes = (dir: string, relBase: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walkAgentsNodes(path.join(dir, entry.name), path.join(relBase, entry.name));
        } else if (entry.name === "AGENTS.md") {
          const destPath = path.join(effectivePath, ".agents", "nodes", relBase, "AGENTS.md");
          const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
          ensureDir(path.dirname(destPath), dryRun);
          const status = writeFile(destPath, content, dryRun);
          const relDest = path.relative(effectivePath, destPath);
          if (status === "written") result.filesWritten.push(relDest);
          else result.filesSkipped.push(relDest);
        }
      }
    };
    walkAgentsNodes(agentsNodesDir, "");
  }

  // Optionally write PERSONAS.md to the target directory.
  if (writePersonasIndex) {
    const personasIndexSrc = path.join(coreDir, "PERSONAS.md");
    if (fs.existsSync(personasIndexSrc)) {
      const destPath = path.join(effectivePath, targetDir, "PERSONAS.md");
      const content = fs.readFileSync(personasIndexSrc, "utf-8");
      const status = writeFile(destPath, content, dryRun);
      const relDest = path.relative(effectivePath, destPath);
      if (status === "written") {
        result.filesWritten.push(relDest);
      } else {
        result.filesSkipped.push(relDest);
      }
    }
  }

  // AB-24: Generate manifest after all files are written.
  // D6: the manifest is the drift/integrity BASELINE, so it must inventory
  // every managed file delivered to this repo — including files skipped
  // because their content was already identical. Building it from
  // filesWritten alone meant a re-sync over an up-to-date repo (e.g. --force)
  // regenerated a near-empty manifest and silently gutted drift coverage.
  const managedFiles = [...new Set([...result.filesWritten, ...result.filesSkipped])];

  // F-1 / §2B: propagate deletions. Ordering is load-bearing — the orphans must
  // be unlinked BEFORE the new manifest is written, because the manifest is
  // regenerated from managedFiles and would otherwise de-list the revoked file
  // without removing it. That is strictly worse than leaving it tracked-and-
  // stale: it converts a governed artifact into an untracked one, and
  // drift-check then reports "clean" precisely BECAUSE it stopped being tracked.
  const toPosixPath = (p: string) => p.replace(/\\/g, "/");
  const prevManifest = loadManifestHashes(effectivePath, targetDir);
  const prevMeta = loadManifestMeta(effectivePath, targetDir);
  const keptPaths = new Set(managedFiles.map(toPosixPath));
  const retainPatterns = [...(config.sync?.retain ?? []), ...(entry.retain ?? [])];

  // Only prune against a manifest THIS platform wrote. A manifest with no
  // `platform` field predates platform tagging, and one written by a different
  // platform belongs to a sibling target sharing this targetDir — in both cases
  // its file list is not a truthful record of what this sync delivers, so
  // treating its entries as orphans would delete live artifacts. Skip the pass
  // for one run (the manifest is retagged below) and SAY SO rather than
  // silently doing nothing.
  const prunable = prevManifest !== null && prevMeta.platform === platform;
  if (prevManifest !== null && !prunable) {
    console.log(
      chalk.yellow(
        `    ⚠ Revocation propagation skipped for ${path.basename(effectivePath)} (${platform}): ` +
        (prevMeta.platform === null
          ? "the existing manifest predates platform tagging."
          : `the existing ${targetDir}/ manifest was written by \`${prevMeta.platform}\`.`) +
        ` Re-run sync to prune revoked artifacts.`,
      ),
    );
  }
  const orphanPlan = planOrphanRemoval(
    prunable ? prevManifest : null,
    keptPaths,
    (rel) => {
      const abs = path.resolve(effectivePath, rel);
      if (!fs.existsSync(abs)) return null;
      return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    },
    retainPatterns,
  );
  result.removalBlocked = orphanPlan.blocked;
  result.removalRetained = orphanPlan.retained;
  if (!dryRun) {
    for (const rel of orphanPlan.remove) {
      try {
        fs.unlinkSync(path.resolve(effectivePath, rel));
        result.filesRemoved.push(rel);
      } catch (err: unknown) {
        result.errors.push(
          `Could not remove revoked artifact ${rel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    pruneEmptyDirs(effectivePath, result.filesRemoved);
  } else {
    result.filesRemoved = [...orphanPlan.remove];
  }
  if (orphanPlan.blocked.length > 0) {
    result.errors.push(
      `${orphanPlan.blocked.length} revoked artifact(s) could NOT be withdrawn — modified locally:\n` +
      orphanPlan.blocked.map((b) => `        ${b.path}`).join("\n") + "\n" +
      `      The org withdrew these controls at the hub; this repo still has them.\n` +
      `      Fix: revert the local edit so AgentBoot can remove the file, or add a\n` +
      `      "retain" regex to this repos.json entry to accept the gap deliberately.`,
    );
  }

  const manifestOut = generateManifest(
    effectivePath,
    targetDir,
    managedFiles,
    entry.group,
    entry.team,
    dryRun,
    // Carry forward any previously-recorded retired entries when this run could
    // not run the pass — dropping them would re-green drift-check on a
    // revocation nobody has remediated.
    prunable
      ? [...orphanPlan.blocked.map((b) => ({ path: b.path, reason: b.reason, hash_expected: prevManifest?.get(b.path) ?? null })),
         ...orphanPlan.retained.map((p) => ({ path: p, reason: "retained", hash_expected: prevManifest?.get(p) ?? null }))]
      : prevMeta.retired,
    platform,
  );
  if (!dryRun) {
    result.filesWritten.push(manifestOut.relPath);
  }
  if (manifestOut.signingError) {
    // D6: signing was configured but failed — surface as a sync error rather
    // than silently delivering an unsigned manifest.
    result.errors.push(`Manifest signing failed: ${manifestOut.signingError}`);
  }

  // B.1: flag managed files this repo's .gitignore would exclude. A synced file that
  // git ignores is invisible to the team AND to drift-check — it silently defeats the
  // whole governance loop (a common failure mode: .claude/ gitignored in most repos).
  const conflicts = detectGitignoreConflicts(effectivePath, result.filesWritten);
  if (conflicts.length > 0) {
    result.gitignoreConflicts = conflicts.map((c) => {
      const entry: { file: string; source?: string; fromGlobal?: boolean } = { file: c.file };
      if (c.source !== undefined) entry.source = c.source;
      if (c.fromGlobal !== undefined) entry.fromGlobal = c.fromGlobal;
      return entry;
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// AB-142: Monorepo-aware sync wrapper
// ---------------------------------------------------------------------------

/**
 * Sync a repo entry, handling monorepo packages if configured.
 * When `entry.packages` is set, iterates over each package and syncs independently.
 * When not set, syncs to repo root (backward compatible) and warns if monorepo detected.
 */
function syncRepo(
  entry: RepoEntry,
  distPath: string,
  config: AgentBootConfig,
  dryRun: boolean,
  force: boolean
): SyncResult[] {
  const repoPath = path.resolve(entry.path);
  const platforms = getRepoPlatforms(entry);

  // Multi-platform: iterate over each platform for this repo entry.
  const allResults: SyncResult[] = [];

  for (const platform of platforms) {
    if (entry.packages && entry.packages.length > 0) {
      // Monorepo mode: sync to each package independently.
      for (const pkg of entry.packages) {
        const pkgPath = path.join(repoPath, pkg);
        // Post-resolution containment check — prevents path traversal even if validation is bypassed
        if (!path.resolve(pkgPath).startsWith(path.resolve(repoPath) + path.sep)) {
          console.log(chalk.red(`  ✗ Package "${pkg}" escapes repo boundary — skipping`));
          continue;
        }
        if (!fs.existsSync(pkgPath)) {
          // Warn and skip non-existent packages.
          console.log(chalk.yellow(`  ⚠ Package "${pkg}" does not exist at ${pkgPath} — skipping`));
          const skipResult: SyncResult = {
            repo: pkgPath,
            label: `${entry.label ?? path.basename(repoPath)} [${pkg}]`,
            platform,
            filesWritten: [],
            filesSkipped: [],
            filesRemoved: [],
            removalBlocked: [],
            removalRetained: [],
            errors: [`Package path does not exist: ${pkgPath}`],
            dryRun,
          };
          allResults.push(skipResult);
          continue;
        }
        allResults.push(syncRepoTarget(entry, distPath, config, dryRun, force, pkg, platform));
      }
    } else {
      // Single-target mode (backward compatible).
      // AB-142: Warn if monorepo structure detected but not configured.
      if (platform === platforms[0] && fs.existsSync(repoPath)) {
        const detected = detectMonorepo(repoPath);
        if (detected.length > 0) {
          console.log(chalk.yellow(
            `  ⚠ Monorepo structure detected in ${entry.label ?? path.basename(repoPath)} ` +
            `(${detected.length} package(s): ${detected.slice(0, 3).join(", ")}${detected.length > 3 ? ", ..." : ""}) ` +
            `but no "packages" configured. Add "packages" to repos.json for per-package deployment.`
          ));
        }
      }

      allResults.push(syncRepoTarget(entry, distPath, config, dryRun, force, undefined, platform));
    }
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Validation: group/team references
// ---------------------------------------------------------------------------

function validateRepoEntry(entry: RepoEntry, config: AgentBootConfig): string[] {
  const errors: string[] = [];
  const label = entry.label ?? entry.path;

  if (entry.group && !config.groups?.[entry.group]) {
    errors.push(
      `[${label}] Group "${entry.group}" is not defined in agentboot.config.json`
    );
  }

  if (entry.team && !entry.group) {
    errors.push(
      `[${label}] Has team "${entry.team}" but no group. Team requires a group.`
    );
  }

  if (entry.group && entry.team) {
    const groupTeams = config.groups?.[entry.group]?.teams ?? [];
    if (!groupTeams.includes(entry.team)) {
      errors.push(
        `[${label}] Team "${entry.team}" is not a member of group "${entry.group}" ` +
          `(defined teams: ${groupTeams.join(", ") || "(none)"})`
      );
    }
  }

  // AB-142: Validate packages array
  if (entry.packages !== undefined) {
    if (!Array.isArray(entry.packages)) {
      errors.push(`[${label}] "packages" must be an array of strings`);
    } else {
      for (const pkg of entry.packages) {
        if (typeof pkg !== "string" || pkg.length === 0) {
          errors.push(`[${label}] Each package path must be a non-empty string`);
        } else if (pkg.includes("..")) {
          errors.push(`[${label}] Package path "${pkg}" must not contain ".." path segments`);
        } else if (path.isAbsolute(pkg)) {
          errors.push(`[${label}] Package path "${pkg}" must be relative, not absolute`);
        }
      }
    }
  }

  // Validate platform(s)
  // A5: derived from VALID_OUTPUT_FORMATS (minus `plugin`, which installs as a
  // plugin rather than syncing into a spoke) instead of re-typed. The re-typed
  // copy had already drifted from compile's list.
  const validPlatforms = [...SYNCABLE_OUTPUT_FORMATS];
  const platforms = getRepoPlatforms(entry);
  for (const platform of platforms) {
    if (!validPlatforms.includes(platform)) {
      errors.push(
        `[${label}] Platform "${platform}" is not supported. Valid: ${validPlatforms.join(", ")}`
      );
    }
  }

  // Validate platforms array format if specified
  if (entry.platforms !== undefined) {
    if (!Array.isArray(entry.platforms)) {
      errors.push(`[${label}] "platforms" must be an array of strings`);
    } else {
      for (const p of entry.platforms) {
        if (typeof p !== "string" || p.length === 0) {
          errors.push(`[${label}] Each platform must be a non-empty string`);
        }
      }
    }
  }

  // Validate repo path safety — resolve symlinks to check the real target
  const resolvedPath = path.resolve(entry.path);
  let realPath = resolvedPath;
  try {
    if (fs.existsSync(resolvedPath)) {
      realPath = fs.realpathSync(resolvedPath);
    }
  } catch { /* permission denied or broken symlink — use resolved path */ }
  const dangerousPaths = ["/", "/etc", "/usr", "/var", "/tmp", "/home", "/root", "/bin", "/sbin", "/lib", "/opt"];
  if (dangerousPaths.includes(realPath)) {
    errors.push(
      `[${label}] Repo path "${realPath}" resolves to a system directory — refusing to sync`
    );
  }
  if (fs.existsSync(realPath) && !fs.existsSync(path.join(realPath, ".git"))) {
    // Warn but don't block — temp dirs in tests and some workflows don't have .git
    console.warn(
      chalk.yellow(`  ⚠ [${label}] Repo path "${resolvedPath}" has no .git directory — is this a git repo?`)
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// AB-24: Manifest generation
// ---------------------------------------------------------------------------

function generateManifest(
  repoPath: string,
  targetDir: string,
  filesWritten: string[],
  group?: string,
  team?: string,
  dryRun?: boolean,
  /** F-1: revoked artifacts sync could not withdraw. Recorded IN the manifest
   *  (and therefore inside the digest) so drift-check can see them — a file
   *  that is neither delivered nor removable is otherwise invisible to every
   *  honesty surface the product has. */
  retired?: Array<{ path: string; reason: string; hash_expected: string | null }>,
  /** F-1: which platform's delivery this manifest records. Several platforms
   *  share a targetDir, so an untagged manifest cannot be safely pruned against. */
  platform?: string,
): { relPath: string; signed: boolean; signingError: string | null } {
  // Read version from package.json
  const pkgJsonPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as { version: string };

  // Compute SHA-256 hashes of written files
  const fileEntries: { path: string; hash: string }[] = [];
  for (const relPath of filesWritten) {
    const absPath = path.join(repoPath, relPath);
    if (fs.existsSync(absPath)) {
      const content = fs.readFileSync(absPath);
      const hash = createHash("sha256").update(content).digest("hex");
      // Manifests are portable artifacts read back on any OS for drift detection —
      // always store POSIX separators, not the native "\" that path.relative emits
      // on Windows. (path.join tolerates "/" on Windows when the manifest is read.)
      fileEntries.push({ path: relPath.replace(/\\/g, "/"), hash });
    }
  }

  // D6: provenance travels IN the manifest — the spoke can always answer
  // "which hub commit / config / policy set produced these artifacts".
  const provenance: HubProvenance = syncRunContext?.provenance ?? {
    agentboot_version: pkg.version,
    hub_commit: null,
    hub_dirty: false,
    config_hash: null,
    exceptions_hash: null,
    generated_at: new Date().toISOString(),
  };

  const manifest: Record<string, unknown> = {
    managed_by: "agentboot",
    version: pkg.version,
    synced_at: new Date().toISOString(),
    scope: { group: group ?? null, team: team ?? null },
    platform: platform ?? null,
    files: fileEntries,
    retired: retired ?? [],
    provenance,
  };

  // D6: tamper-evidence — content digest always; SSH signature when configured.
  const digest = computeManifestDigest(manifest);
  const integrity: ManifestIntegrity = { algorithm: "sha256", manifest_digest: digest };
  let signed = false;
  let signingError: string | null = null;
  if (syncRunContext?.signingKeyPath) {
    const sig = signManifestDigest(digest, syncRunContext.signingKeyPath);
    if ("signature" in sig) {
      integrity.signature = sig.signature;
      signed = true;
    } else {
      // Fail LOUD: a hub that configured signing must not silently ship
      // unsigned manifests — the caller records this as a sync error.
      signingError = sig.error;
    }
  }
  manifest["integrity"] = integrity;

  const manifestRelPath = path.join(targetDir, ".agentboot-manifest.json");
  const manifestAbsPath = path.join(repoPath, manifestRelPath);

  if (!dryRun) {
    ensureDir(path.dirname(manifestAbsPath), false);
    fs.writeFileSync(manifestAbsPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  // v0.19.0: standards-shaped attestation (in-toto Statement in a DSSE
  // envelope, SSHSIG-signed) next to the manifest, when configured. A
  // configured-but-failing attestation is a sync error like manifest signing.
  if (!dryRun && signed && syncRunContext?.emitInToto && syncRunContext.signingKeyPath) {
    const att = buildDsseEnvelope(manifest, syncRunContext.signingKeyPath);
    if ("envelope" in att) {
      fs.writeFileSync(
        path.join(repoPath, targetDir, ".agentboot-manifest.intoto.json"),
        JSON.stringify(att.envelope, null, 2) + "\n",
        "utf-8",
      );
    } else if (!signingError) {
      signingError = att.error;
    }
  }

  return { relPath: manifestRelPath, signed, signingError };
}

// ---------------------------------------------------------------------------
// AB-28: PR mode (sync via git/gh)
// ---------------------------------------------------------------------------

function createSyncPR(
  repoPath: string,
  config: AgentBootConfig,
  result: SyncResult
): void {
  const prConfig = config.sync?.pr;
  const branchPrefix = prConfig?.branchPrefix ?? "agentboot/sync-";
  const titleTemplate = prConfig?.titleTemplate ?? "chore: AgentBoot persona sync";

  // Validate inputs to prevent injection
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branchPrefix)) {
    result.errors.push(`Invalid branchPrefix: "${branchPrefix}" — only alphanumeric, /, _, ., - allowed`);
    return;
  }
  if (!/^[a-zA-Z0-9 :/_.,-]+$/.test(titleTemplate)) {
    result.errors.push(`Invalid titleTemplate: "${titleTemplate}" — only alphanumeric, spaces, and common punctuation allowed`);
    return;
  }

  // Check if there are actual changes
  // Stage exactly the files sync WROTE (repo-relative paths). This covers every
  // platform target (.claude/.cursor/.codex/.gemini/.junie/.windsurf/.github) AND
  // root-level files (AGENTS.md, GEMINI.md, .windsurfrules, .mcp.json, CLAUDE.md).
  // Previously createSyncPR staged only [targetDir, .github, .mcp.json, CLAUDE.md]
  // with targetDir hardcoded to .claude — so PR mode created NO PR at all for
  // cursor/gemini/windsurf/jetbrains/codex repos and always dropped root AGENTS.md.
  const writtenPaths = result.filesWritten.filter((f) => fs.existsSync(path.join(repoPath, f)));
  // F-1: a sync that only REVOKED artifacts writes nothing but still has a
  // change to propose. Returning early here would have made PR mode silently
  // drop deletions — the same defect class, one layer up.
  if (writtenPaths.length === 0 && result.filesRemoved.length === 0) {
    return; // nothing written and nothing removed — no PR
  }

  // Assert the preconditions BEFORE branching and committing. Previously the first
  // sign that PR mode could not be honoured was a failure from `git push` or
  // `gh pr create` — after a branch had been cut and a commit made. Check up front
  // and fail with a reason the operator can act on.
  const prPreconditionErrors: string[] = [];
  const originUrl = spawnSync("git", ["remote", "get-url", "origin"], { cwd: repoPath, stdio: "pipe" });
  if (originUrl.status !== 0) {
    prPreconditionErrors.push(`no "origin" remote — PR mode needs a remote to push a branch to`);
  } else if (!/github\.com/i.test(originUrl.stdout?.toString() ?? "")) {
    prPreconditionErrors.push(
      `origin is not a GitHub remote (${originUrl.stdout?.toString().trim()}) — PR creation uses the "gh" CLI`,
    );
  }
  if (spawnSync("gh", ["--version"], { stdio: "pipe" }).status !== 0) {
    prPreconditionErrors.push(`the "gh" CLI is not installed or not on PATH`);
  } else if (spawnSync("gh", ["auth", "status"], { stdio: "pipe" }).status !== 0) {
    prPreconditionErrors.push(`"gh" is not authenticated — run "gh auth login"`);
  }
  if (prPreconditionErrors.length > 0) {
    result.errors.push(
      `PR mode was requested but cannot be honoured for this repo:\n` +
        prPreconditionErrors.map((e) => `      - ${e}`).join("\n") +
        `\n      Files were written directly. Re-run without PR mode to accept that, or fix the above.`,
    );
    return;
  }

  const dateSlug = new Date().toISOString().slice(0, 10);
  let branch = `${branchPrefix}${dateSlug}`;

  // Handle branch-already-exists by appending counter
  const branchCheck = spawnSync("git", ["rev-parse", "--verify", branch], { cwd: repoPath, stdio: "pipe" });
  if (branchCheck.status === 0) {
    let counter = 2;
    while (spawnSync("git", ["rev-parse", "--verify", `${branch}-${counter}`], { cwd: repoPath, stdio: "pipe" }).status === 0) {
      counter++;
    }
    branch = `${branch}-${counter}`;
  }

  let originalBranch = "";
  try {
    const run = (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { cwd: repoPath, stdio: "pipe" });
      if (r.status !== 0) {
        throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr?.toString().trim()}`);
      }
      return r.stdout?.toString().trim() ?? "";
    };

    originalBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    run("git", ["checkout", "-b", branch]);
    if (writtenPaths.length > 0) run("git", ["add", "--", ...writtenPaths]);
    // Stage the revocations too. Best-effort: a path that was never committed
    // has nothing to stage, and that is not an error.
    if (result.filesRemoved.length > 0) {
      spawnSync("git", ["add", "-A", "--", ...result.filesRemoved], { cwd: repoPath, stdio: "pipe" });
    }

    // If staging produced no actual change (files identical to what's committed),
    // there is nothing to PR — abort cleanly (the finally restores the branch).
    const stagedClean = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: repoPath, stdio: "pipe" });
    if (stagedClean.status === 0) {
      return;
    }

    run("git", ["commit", "-m", titleTemplate]);
    run("git", ["push", "-u", "origin", branch]);
    // D6: the PR body carries provenance (hub commit, versions, policy hashes)
    // and a risk-classified change summary — generated config is reviewed like
    // any change to CI or repo settings, not rubber-stamped as "automated".
    const manifestPaths = writtenPaths
      .filter((f) => f.replace(/\\/g, "/").endsWith(".agentboot-manifest.json"))
      .map((f) => f.replace(/\\/g, "/"));
    const prBody = syncRunContext
      ? buildSyncPrBody({
          provenance: syncRunContext.provenance,
          filesWritten: writtenPaths,
          manifestPaths,
          signed: syncRunContext.signingKeyPath !== null,
        })
      : "Automated AgentBoot sync";
    // F-1: a PR that deletes files must SAY so in its own description.
    const removalNote = result.filesRemoved.length > 0
      ? `\n\n## Revoked at the hub — removed here\n\n` +
        result.filesRemoved.map((f) => `- \`${f}\``).join("\n") + "\n"
      : "";
    const prOutput = run("gh", ["pr", "create", "--title", titleTemplate, "--body", prBody + removalNote]);
    result.prUrl = prOutput;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`PR creation failed: ${errMsg}`);
  } finally {
    // Always return to the original branch — previously the repo was left checked
    // out on the sync branch (M12) on both success and failure.
    if (originalBranch && originalBranch !== "HEAD") {
      spawnSync("git", ["checkout", originalBranch], { cwd: repoPath, stdio: "pipe" });
    }
  }
}

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function printSyncResult(result: SyncResult): void {
  const repoLabel = result.label ?? path.basename(result.repo);
  const scopeParts: string[] = [result.platform ?? "claude"];
  if (result.team) scopeParts.push(`${result.group}/${result.team}`);
  else if (result.group) scopeParts.push(result.group);
  const scope = scopeParts.join("/");
  const dryRunTag = result.dryRun ? chalk.yellow(" [DRY RUN]") : "";

  if (result.skippedNoChanges) {
    console.log(
      `  ${chalk.gray("–")} ${repoLabel}${chalk.gray(` (${scope})`)} — ${chalk.gray("skipped (no changes)")}`
    );
    return;
  }

  if (result.errors.length > 0) {
    console.log(`  ${chalk.red("✗")} ${repoLabel} (${scope})${dryRunTag}`);
    for (const err of result.errors) {
      console.log(chalk.red(`      ${err}`));
    }
    return;
  }

  const written = result.filesWritten.length;
  const skipped = result.filesSkipped.length;
  const removed = result.filesRemoved.length;
  const parts: string[] = [];
  if (written > 0) parts.push(`${written} written`);
  if (skipped > 0) parts.push(chalk.gray(`${skipped} unchanged`));
  if (removed > 0) parts.push(chalk.yellow(`${removed} removed`));

  console.log(
    `  ${chalk.green("✓")} ${repoLabel}${chalk.gray(` (${scope})`)} — ${parts.join(", ")}${dryRunTag}`
  );

  // F-1: a sync that DELETED files must say which. A removal mentioned only in
  // a count is the same failure class one layer up.
  for (const f of result.filesRemoved) {
    console.log(chalk.yellow(`      ${result.dryRun ? "− would remove" : "−"} ${f}`));
  }
  if (result.removalRetained.length > 0) {
    console.log(
      chalk.yellow(
        `      ⚠ ${result.removalRetained.length} revoked artifact(s) retained by an explicit \`retain\` rule — the control is withdrawn at the hub but still live here:`,
      ),
    );
    for (const f of result.removalRetained) {
      console.log(chalk.yellow(`          ${f}`));
    }
  }

  if (written > 0 && written <= 10) {
    for (const f of result.filesWritten) {
      console.log(chalk.gray(`      + ${f}`));
    }
  } else if (written > 10) {
    for (const f of result.filesWritten.slice(0, 5)) {
      console.log(chalk.gray(`      + ${f}`));
    }
    console.log(chalk.gray(`      ... and ${written - 5} more`));
  }

  if (result.gitignoreConflicts && result.gitignoreConflicts.length > 0) {
    console.log(
      chalk.yellow(
        `      ⚠ ${result.gitignoreConflicts.length} synced file(s) are gitignored here — they won't be committed, so they never reach the repo and drift-check can't verify them:`,
      ),
    );
    for (const c of result.gitignoreConflicts) {
      const attribution = c.source ? ` (rule: ${c.source}${c.fromGlobal ? " — your GLOBAL gitignore" : ""})` : "";
      console.log(chalk.yellow(`          ${c.file}${attribution}`));
    }
    const anyGlobal = result.gitignoreConflicts.some((c) => c.fromGlobal);
    console.log(
      chalk.yellow(
        anyGlobal
          ? "        Fix: the matching rule is in your machine-wide global gitignore (core.excludesFile), not this repo — edit THAT file. Teammates and CI are unaffected, but YOUR commits will silently omit these files."
          : "        Fix: remove or anchor the offending .gitignore pattern (or move internal-only excludes to .claude/.gitignore).",
      ),
    );
  }

  if (result.prUrl) {
    console.log(chalk.cyan(`      PR: ${result.prUrl}`));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const configPath = resolveConfigPath(argv, ROOT);
  const isDryRun =
    argv.includes("--dry-run") || argv.includes("--dryRun");
  const isForce = argv.includes("--force");
  const modeIdx = argv.indexOf("--mode");
  const cliMode = modeIdx !== -1 ? argv[modeIdx + 1] : undefined;
  // Optional repo-name filter (repeatable): --repo <name>. Scopes the sync to
  // specific repos.json entries (matched by label or path basename) instead of
  // syncing every repo. Callers like the MCP sync tool use this to honor a
  // requested repo subset rather than writing to all repos.
  const repoFilter: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) repoFilter.push(argv[i + 1]!);
  }

  console.log(chalk.bold("\nAgentBoot — sync"));
  console.log(chalk.gray(`Config: ${configPath}`));

  if (isDryRun) {
    console.log(chalk.yellow("  DRY RUN mode — no files will be written\n"));
  } else {
    console.log("");
  }

  const config = loadConfig(configPath);
  const configDir = path.dirname(configPath);
  const dryRun = isDryRun || (config.sync?.dryRun ?? false);

  // D6: collect hub provenance once per run; resolve the signing key when
  // sync.signing is enabled (path relative to the hub config).
  const pkgVersion = (JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
  ) as { version: string }).version;
  const signingCfg = config.sync?.signing;
  syncRunContext = {
    provenance: collectHubProvenance(configDir, pkgVersion),
    signingKeyPath: signingCfg?.enabled && signingCfg.sshKeyPath
      ? path.resolve(configDir, signingCfg.sshKeyPath)
      : null,
    emitInToto: signingCfg?.enabled === true && signingCfg.emitInToto === true,
    configDir,
  };
  if (syncRunContext.provenance.hub_dirty) {
    console.log(chalk.yellow(
      "  ⚠ Hub working tree is DIRTY — artifacts may not match the recorded hub commit. Commit hub changes before syncing for clean provenance.",
    ));
  }

  const reposPath = config.sync?.repos ?? "./repos.json";
  const distPath = path.resolve(
    configDir,
    config.output?.distPath ?? "./dist"
  );

  // Check that dist/ exists and has been built.
  if (!fs.existsSync(distPath)) {
    console.error(
      chalk.red(
        `✗ dist/ not found at ${distPath}\n  Run \`npm run build\` before syncing.`
      )
    );
    process.exit(1);
  }

  // A2 / N1: existence is not freshness.
  //
  // The pre-existing check above asks "is there a dist?" — which is exactly the
  // question that returned yes in the N1 repro, because a failed build leaves
  // the previous tree byte-identical. Shipping from it ships the policy the
  // operator just revoked, and signs it. Refuse, named, non-zero. This runs
  // before the dry-run branch too: a plan derived from a stale tree is a plan
  // for the wrong policy, and printing it as if it were current is the same lie.
  const freshness = checkDistFreshness(distPath, config);
  if (!freshness.fresh) {
    console.error(chalk.red(staleDistMessage(freshness, "sync")));
    process.exit(1);
  }

  // Load repos.
  const allRepos = loadRepos(reposPath, configDir);

  if (allRepos.length === 0) {
    console.log(chalk.yellow("No repos in repos.json — nothing to sync."));
    process.exit(0);
  }

  // Apply the optional --repo filter.
  const repos = repoFilter.length === 0
    ? allRepos
    : allRepos.filter((r) => {
        const want = new Set(repoFilter);
        return want.has(r.label ?? "") || want.has(path.basename(r.path)) || want.has(r.path);
      });

  if (repos.length === 0) {
    console.error(chalk.red(`No repos.json entries matched --repo ${repoFilter.join(", ")}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`Syncing to ${repos.length} repo${repos.length > 1 ? "s" : ""}...`));

  // Validate all repo entries before writing anything.
  const validationErrors: string[] = [];
  for (const entry of repos) {
    validationErrors.push(...validateRepoEntry(entry, config));
  }

  if (validationErrors.length > 0) {
    console.log(chalk.red("\nRepos validation failed:"));
    for (const err of validationErrors) {
      console.log(chalk.red(`  ✗ ${err}`));
    }
    process.exit(1);
  }

  // Determine sync mode: "local" (default) or "pr"
  const isPrMode = cliMode === "pr" || (config.sync?.pr?.enabled === true);

  // Sync each repo (may return multiple results for monorepo packages).
  const results: SyncResult[] = [];
  for (const entry of repos) {
    const repoResults = syncRepo(entry, distPath, config, dryRun, isForce);

    // Collect all successful results for this repo entry before creating a single PR.
    // This prevents monorepo PR corruption where multiple git checkout -b calls
    // from the same repo create overlapping branches.
    const successResults: SyncResult[] = [];

    for (const result of repoResults) {
      results.push(result);
      printSyncResult(result);
      if (result.errors.length === 0 && result.filesWritten.length > 0) {
        successResults.push(result);
      }
    }

    // A dry run must SAY that PR mode is active. Previously its output was
    // byte-identical to direct-write mode, so an operator had no way to confirm PR
    // mode was configured correctly except by doing it for real — and a
    // misconfiguration then looked like a successful direct write.
    if (isPrMode && dryRun && successResults.length > 0) {
      console.log(chalk.cyan(`      PR mode: a branch and pull request would be opened for these files [DRY RUN]`));
    }

    // AB-28: Create ONE PR per repo entry (not per package) in PR mode
    if (isPrMode && !dryRun && successResults.length > 0) {
      // Merge all package results into a single result for the PR
      const mergedResult: SyncResult = {
        repo: successResults[0]!.repo,
        label: entry.label ?? path.basename(entry.path),
        platform: successResults[0]!.platform ?? "claude",
        filesWritten: successResults.flatMap(r => r.filesWritten),
        filesSkipped: successResults.flatMap(r => r.filesSkipped),
        filesRemoved: successResults.flatMap(r => r.filesRemoved),
        removalBlocked: successResults.flatMap(r => r.removalBlocked),
        removalRetained: successResults.flatMap(r => r.removalRetained),
        errors: [],
        dryRun,
      };
      createSyncPR(path.resolve(entry.path), config, mergedResult);
      // If PR creation added errors, include them in the results for the summary
      if (mergedResult.errors.length > 0) {
        results.push(mergedResult);
        printSyncResult(mergedResult);
      }
    }
  }

  // Summary.
  const totalWritten = results.reduce((acc, r) => acc + r.filesWritten.length, 0);
  const totalSkipped = results.reduce((acc, r) => acc + r.filesSkipped.length, 0);
  const totalRemoved = results.reduce((acc, r) => acc + r.filesRemoved.length, 0);
  const failedRepos = results.filter((r) => r.errors.length > 0);
  const skippedRepos = results.filter((r) => r.skippedNoChanges);
  const syncedRepos = results.filter((r) => !r.skippedNoChanges && r.errors.length === 0);

  console.log("");

  if (failedRepos.length > 0) {
    console.log(
      chalk.bold(
        chalk.red(
          `✗ Sync completed with errors: ` +
            `${failedRepos.length} repo${failedRepos.length > 1 ? "s" : ""} failed`
        )
      )
    );
    process.exit(1);
  }

  const dryRunNote = dryRun ? chalk.yellow(" (dry run — nothing written)") : "";
  const skippedNote = skippedRepos.length > 0
    ? ` (${skippedRepos.length} skipped — no changes)`
    : "";
  console.log(
    chalk.bold(
      chalk.green("✓") +
        ` Synced ${syncedRepos.length} of ${results.length} repo${results.length > 1 ? "s" : ""}` +
        ` — ${totalWritten} file${totalWritten !== 1 ? "s" : ""} written, ` +
        `${totalSkipped} unchanged` +
        (totalRemoved > 0 ? `, ${totalRemoved} removed` : "") +
        skippedNote +
        dryRunNote
    )
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`Unexpected error: ${message}`));
  if (process.argv.includes("--verbose")) {
    console.error(err);
  }
  process.exit(1);
});
