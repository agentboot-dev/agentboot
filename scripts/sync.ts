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
} from "./lib/config.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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
}

/**
 * Normalize platform(s) for a repo entry. Handles both the old singular
 * `platform` field and the new `platforms` array. Returns an array.
 */
function getRepoPlatforms(entry: RepoEntry): string[] {
  if (entry.platforms && entry.platforms.length > 0) {
    return entry.platforms;
  }
  return [entry.platform ?? "claude"];
}

interface SyncResult {
  repo: string;
  label?: string;
  platform?: string;
  group?: string;
  team?: string;
  filesWritten: string[];
  filesSkipped: string[];  // unchanged files (same content)
  errors: string[];
  dryRun: boolean;
  prUrl?: string;
  /** True when smart sync determined the repo is already up-to-date. */
  skippedNoChanges?: boolean;
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
      return "skipped";
    }
  }

  ensureDir(path.dirname(filePath), false);
  fs.writeFileSync(filePath, content, "utf-8");
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
        if (relBase === "" && (entry === ".agentboot-archive" || entry === ".agentboot-manifest.json")) continue;
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

  // BUG-6: Also archive repo-root files that sync will overwrite
  const rootFiles = ["CLAUDE.md", ".mcp.json"];
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
      path: file.relPath,
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

  let manifest: { files?: Array<{ path: string; hash: string }> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    // Corrupt manifest = broken integrity check. Refuse sync.
    return { drifted: [".agentboot-manifest.json (unreadable — corrupt or malformed)"], clean: false };
  }

  const drifted: string[] = [];
  for (const entry of manifest.files ?? []) {
    // Skip the manifest's own entry (it contains a timestamp so it always "drifts")
    if (entry.path.endsWith(".agentboot-manifest.json")) continue;

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
    for (const rootFile of [".mcp.json", "CLAUDE.md"]) {
      const file = mergedFiles.get(rootFile);
      if (file) {
        const content = fs.readFileSync(file.absolutePath);
        const hash = createHash("sha256").update(content).digest("hex");
        wouldWrite.set(rootFile, hash);
      }
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

  // Compare: every file we would write must exist in manifest with same hash
  for (const [destPath, hash] of wouldWrite) {
    const manifestHash = manifestHashes.get(destPath);
    if (manifestHash !== hash) return false;
  }

  // Also check: manifest shouldn't have files we wouldn't write (deleted files)
  // Skip the manifest file itself
  for (const [manifestPath] of manifestHashes) {
    if (manifestPath.endsWith(".agentboot-manifest.json")) continue;
    if (!wouldWrite.has(manifestPath)) return false;
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
  const platform = platformOverride ?? entry.platform ?? "claude";
  // AB-129: Cursor uses .cursor/ as its target directory
  const targetDir = platform === "cursor" ? ".cursor" : (config.sync?.targetDir ?? ".claude");
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
    errors: [],
    dryRun,
  };

  if (!fs.existsSync(effectivePath)) {
    result.errors.push(`${packagePath ? "Package" : "Repo"} path does not exist: ${effectivePath}`);
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

  // Archive existing content before first sync.
  const archive = archiveExistingContent(effectivePath, targetDir, dryRun);
  if (archive.archived) {
    const verb = dryRun ? "Would archive" : "Archived";
    console.log(chalk.cyan(`    ${verb} ${archive.fileCount} existing file(s) to ${targetDir}/.agentboot-archive/`));
  }

  // Collect files from applicable scopes within the platform distribution.
  const platformDir = path.join(distPath, platform);
  const coreDir = path.join(platformDir, "core");
  const groupDir = entry.group
    ? path.join(platformDir, "groups", entry.group)
    : null;
  const teamDir = entry.group && entry.team
    ? path.join(platformDir, "teams", entry.group, entry.team)
    : null;

  const coreFiles = collectScopeFiles(coreDir, "core");
  const groupFiles = groupDir ? collectScopeFiles(groupDir, "group") : [];
  const teamFiles = teamDir ? collectScopeFiles(teamDir, "team") : [];

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
      result.skippedNoChanges = true;
      return result;
    }
  }

  // Write all merged files to the target directory.
  // Platform-specific routing:
  //   - copilot: merged copilot-instructions.md → .github/, scoped instructions → .github/instructions/
  //   - cursor: rules/*.mdc → .cursor/rules/
  //   - claude/skill: everything → {targetDir}/
  const targetBase = path.join(effectivePath, targetDir);

  if (platform === "cursor") {
    // AB-129: Cursor platform — write rules/*.mdc to .cursor/rules/
    const cursorBase = path.join(effectivePath, ".cursor");
    for (const [relPath, file] of merged) {
      if (relPath === "PERSONAS.md") continue;

      // Map rules/*.mdc to .cursor/rules/*.mdc
      const destPath = path.join(cursorBase, relPath);
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
  } else if (platform !== "copilot") {
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
    const agentbootEntry = {
      command: "npx",
      args: ["agentboot", "mcp-server"],
    };

    // Start from org-configured servers in dist (if any)
    let mcpServers: Record<string, unknown> = {};
    const mcpDistFile = merged.get(".mcp.json");
    if (mcpDistFile) {
      try {
        const distContent = JSON.parse(fs.readFileSync(mcpDistFile.absolutePath, "utf-8")) as {
          mcpServers?: Record<string, unknown>;
        };
        if (distContent.mcpServers) mcpServers = { ...distContent.mcpServers };
      } catch { /* malformed dist .mcp.json — ignore */ }
    }

    // Preserve extra servers already in the spoke that aren't ours
    if (fs.existsSync(mcpDestPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(mcpDestPath, "utf-8")) as {
          mcpServers?: Record<string, unknown>;
        };
        if (existing.mcpServers) mcpServers = { ...existing.mcpServers, ...mcpServers };
      } catch { /* malformed existing .mcp.json — overwrite */ }
    }

    // AgentBoot entry always wins (ensures it's present and up to date)
    mcpServers["agentboot"] = agentbootEntry;

    const mcpContent = JSON.stringify({ mcpServers }, null, 2) + "\n";
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
  const manifestRelPath = generateManifest(
    effectivePath,
    targetDir,
    result.filesWritten,
    entry.group,
    entry.team,
    dryRun
  );
  if (!dryRun) {
    result.filesWritten.push(manifestRelPath);
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
  const validPlatforms = ["skill", "claude", "copilot", "cursor", "agents", "windsurf", "gemini"];
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
  dryRun?: boolean
): string {
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
      fileEntries.push({ path: relPath, hash });
    }
  }

  const manifest = {
    managed_by: "agentboot",
    version: pkg.version,
    synced_at: new Date().toISOString(),
    scope: { group: group ?? null, team: team ?? null },
    files: fileEntries,
  };

  const manifestRelPath = path.join(targetDir, ".agentboot-manifest.json");
  const manifestAbsPath = path.join(repoPath, manifestRelPath);

  if (!dryRun) {
    ensureDir(path.dirname(manifestAbsPath), false);
    fs.writeFileSync(manifestAbsPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  return manifestRelPath;
}

// ---------------------------------------------------------------------------
// AB-28: PR mode (sync via git/gh)
// ---------------------------------------------------------------------------

function createSyncPR(
  repoPath: string,
  targetDir: string,
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
  const diffResult = spawnSync("git", ["diff", "--quiet"], { cwd: repoPath, stdio: "pipe" });
  const cachedResult = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: repoPath, stdio: "pipe" });
  const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard", targetDir], { cwd: repoPath, stdio: "pipe" });
  const untracked = untrackedResult.stdout?.toString().trim() ?? "";

  if (diffResult.status === 0 && cachedResult.status === 0 && !untracked) {
    return; // No changes
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

  try {
    const run = (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { cwd: repoPath, stdio: "pipe" });
      if (r.status !== 0) {
        throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr?.toString().trim()}`);
      }
      return r.stdout?.toString().trim() ?? "";
    };

    run("git", ["checkout", "-b", branch]);
    // Only add paths that exist
    const addPaths = [targetDir];
    if (fs.existsSync(path.join(repoPath, ".github"))) {
      addPaths.push(".github/");
    }
    // Root-level files written outside targetDir
    for (const rootFile of [".mcp.json", "CLAUDE.md"]) {
      if (fs.existsSync(path.join(repoPath, rootFile))) {
        addPaths.push(rootFile);
      }
    }
    run("git", ["add", ...addPaths]);
    run("git", ["commit", "-m", titleTemplate]);
    run("git", ["push", "-u", "origin", branch]);
    const prOutput = run("gh", ["pr", "create", "--title", titleTemplate, "--body", "Automated AgentBoot sync"]);
    result.prUrl = prOutput;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`PR creation failed: ${errMsg}`);
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
  const parts: string[] = [];
  if (written > 0) parts.push(`${written} written`);
  if (skipped > 0) parts.push(chalk.gray(`${skipped} unchanged`));

  console.log(
    `  ${chalk.green("✓")} ${repoLabel}${chalk.gray(` (${scope})`)} — ${parts.join(", ")}${dryRunTag}`
  );

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

  // Load repos.
  const repos = loadRepos(reposPath, configDir);

  if (repos.length === 0) {
    console.log(chalk.yellow("No repos in repos.json — nothing to sync."));
    process.exit(0);
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

    // AB-28: Create ONE PR per repo entry (not per package) in PR mode
    if (isPrMode && !dryRun && successResults.length > 0) {
      const targetDir = config.sync?.targetDir ?? ".claude";
      // Merge all package results into a single result for the PR
      const mergedResult: SyncResult = {
        repo: successResults[0]!.repo,
        label: entry.label ?? path.basename(entry.path),
        platform: successResults[0]!.platform ?? "claude",
        filesWritten: successResults.flatMap(r => r.filesWritten),
        filesSkipped: successResults.flatMap(r => r.filesSkipped),
        errors: [],
        dryRun,
      };
      createSyncPR(path.resolve(entry.path), targetDir, config, mergedResult);
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
