/**
 * AgentBoot sync script.
 *
 * Reads repos.json and distributes compiled output from dist/ to each registered
 * repository. For each repo, it merges the applicable scopes in order:
 *
 *   1. dist/core/           — studio baseline (all repos)
 *   2. dist/groups/{group}/ — group-level additions (if repo has a group)
 *   3. dist/teams/{group}/{team}/ — team-level additions (if repo has a team)
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
import { fileURLToPath } from "node:url";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentBootConfig {
  org: string;
  orgDisplayName?: string;
  groups?: Record<string, { teams?: string[] }>;
  output?: {
    distPath?: string;
  };
  sync?: {
    repos?: string;
    targetDir?: string;
    writePersonasIndex?: boolean;
    dryRun?: boolean;
  };
}

interface RepoEntry {
  // Absolute or relative path to the repo root.
  path: string;
  // Group this repo belongs to (must match a key in config.groups).
  group?: string;
  // Team this repo belongs to (must be a member of the group's teams).
  team?: string;
  // Human-readable label. Used in sync output only.
  label?: string;
}

interface SyncResult {
  repo: string;
  label?: string;
  group?: string;
  team?: string;
  filesWritten: string[];
  filesSkipped: string[];  // unchanged files (same content)
  errors: string[];
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveConfigPath(argv: string[]): string {
  const idx = argv.indexOf("--config");
  if (idx !== -1 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]!);
  }
  return path.join(ROOT, "agentboot.config.json");
}

/**
 * Strip single-line // comments from a JSONC string, respecting string literals.
 * Handles // inside URLs and regex patterns that appear as JSON string values.
 */
function stripJsoncComments(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    let inString = false;
    let i = 0;
    let out = "";

    while (i < line.length) {
      const ch = line[i]!;

      if (inString) {
        out += ch;
        if (ch === "\\" && i + 1 < line.length) {
          i++;
          out += line[i]!;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
          out += ch;
        } else if (ch === "/" && line[i + 1] === "/") {
          break;
        } else {
          out += ch;
        }
      }
      i++;
    }

    result.push(out.trimEnd());
  }

  return result.join("\n");
}

function loadConfig(configPath: string): AgentBootConfig {
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`✗ Config file not found: ${configPath}`));
    process.exit(1);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(stripJsoncComments(raw)) as AgentBootConfig;
}

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
 * Merge files from multiple scopes. Higher specificity scope wins on
 * filename conflict: team > group > core.
 */
function mergeScopes(
  coreFiles: ScopedFile[],
  groupFiles: ScopedFile[],
  teamFiles: ScopedFile[]
): Map<string, ScopedFile> {
  const merged = new Map<string, ScopedFile>();

  // Apply in order of increasing specificity so higher specificity overwrites lower.
  for (const file of [...coreFiles, ...groupFiles, ...teamFiles]) {
    merged.set(file.relativePath, file);
  }

  return merged;
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
  org: string
): string | null {
  const fragments: string[] = [];

  for (const [relPath, file] of mergedFiles) {
    if (relPath.endsWith("copilot-instructions.md")) {
      fragments.push(fs.readFileSync(file.absolutePath, "utf-8").trim());
    }
  }

  if (fragments.length === 0) return null;

  const header = [
    `<!-- AgentBoot merged copilot instructions — do not edit manually. -->`,
    `<!-- Org: ${org} | Generated: ${new Date().toISOString()} -->`,
    "",
  ].join("\n");

  return `${header}${fragments.join("\n\n---\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Per-repo sync
// ---------------------------------------------------------------------------

function syncRepo(
  entry: RepoEntry,
  distPath: string,
  config: AgentBootConfig,
  dryRun: boolean
): SyncResult {
  const repoPath = path.resolve(entry.path);
  const targetDir = config.sync?.targetDir ?? ".claude";
  const writePersonasIndex = config.sync?.writePersonasIndex !== false;
  const org = config.orgDisplayName ?? config.org;

  const result: SyncResult = {
    repo: repoPath,
    label: entry.label,
    group: entry.group,
    team: entry.team,
    filesWritten: [],
    filesSkipped: [],
    errors: [],
    dryRun,
  };

  if (!fs.existsSync(repoPath)) {
    result.errors.push(`Repo path does not exist: ${repoPath}`);
    return result;
  }

  // Collect files from applicable scopes.
  const coreDir = path.join(distPath, "core");
  const groupDir = entry.group
    ? path.join(distPath, "groups", entry.group)
    : null;
  const teamDir = entry.group && entry.team
    ? path.join(distPath, "teams", entry.group, entry.team)
    : null;

  const coreFiles = collectScopeFiles(coreDir, "core");
  const groupFiles = groupDir ? collectScopeFiles(groupDir, "group") : [];
  const teamFiles = teamDir ? collectScopeFiles(teamDir, "team") : [];

  if (coreFiles.length === 0) {
    result.errors.push(
      `dist/core/ is empty. Run \`npm run build\` before syncing.`
    );
    return result;
  }

  const merged = mergeScopes(coreFiles, groupFiles, teamFiles);

  // Write all merged files to the target directory.
  const targetBase = path.join(repoPath, targetDir);
  ensureDir(targetBase, dryRun);

  for (const [relPath, file] of merged) {
    // copilot-instructions.md fragments are handled separately below.
    if (relPath.endsWith("copilot-instructions.md")) continue;

    // PERSONAS.md goes to the targetDir root, not inside a persona subdirectory.
    // All other files preserve their relative path structure.
    const destPath = path.join(targetBase, relPath);
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    const status = writeFile(destPath, content, dryRun);

    const relDest = path.relative(repoPath, destPath);
    if (status === "written") {
      result.filesWritten.push(relDest);
    } else {
      result.filesSkipped.push(relDest);
    }
  }

  // Write merged copilot-instructions.md to .github/.
  const copilotContent = buildCopilotInstructions(merged, org);
  if (copilotContent) {
    const copilotDest = path.join(repoPath, ".github", "copilot-instructions.md");
    ensureDir(path.dirname(copilotDest), dryRun);
    const status = writeFile(copilotDest, copilotContent, dryRun);
    const relDest = path.relative(repoPath, copilotDest);
    if (status === "written") {
      result.filesWritten.push(relDest);
    } else {
      result.filesSkipped.push(relDest);
    }
  }

  // Optionally write PERSONAS.md to repo root.
  if (writePersonasIndex) {
    const personasIndexSrc = path.join(coreDir, "PERSONAS.md");
    if (fs.existsSync(personasIndexSrc)) {
      const destPath = path.join(repoPath, targetDir, "PERSONAS.md");
      const content = fs.readFileSync(personasIndexSrc, "utf-8");
      const status = writeFile(destPath, content, dryRun);
      const relDest = path.relative(repoPath, destPath);
      if (status === "written") {
        result.filesWritten.push(relDest);
      } else {
        result.filesSkipped.push(relDest);
      }
    }
  }

  return result;
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

  return errors;
}

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function printSyncResult(result: SyncResult): void {
  const repoLabel = result.label ?? path.basename(result.repo);
  const scope =
    result.team
      ? `${result.group}/${result.team}`
      : result.group
      ? result.group
      : "core";
  const dryRunTag = result.dryRun ? chalk.yellow(" [DRY RUN]") : "";

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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const configPath = resolveConfigPath(argv);
  const isDryRun =
    argv.includes("--dry-run") || argv.includes("--dryRun");

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
  const coreDistDir = path.join(distPath, "core");
  if (!fs.existsSync(coreDistDir)) {
    console.error(
      chalk.red(
        `✗ dist/core/ not found at ${coreDistDir}\n  Run \`npm run build\` before syncing.`
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

  // Sync each repo.
  const results: SyncResult[] = [];
  for (const entry of repos) {
    const result = syncRepo(entry, distPath, config, dryRun);
    results.push(result);
    printSyncResult(result);
  }

  // Summary.
  const totalWritten = results.reduce((acc, r) => acc + r.filesWritten.length, 0);
  const totalSkipped = results.reduce((acc, r) => acc + r.filesSkipped.length, 0);
  const failedRepos = results.filter((r) => r.errors.length > 0);

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
  console.log(
    chalk.bold(
      chalk.green("✓") +
        ` Synced ${results.length} repo${results.length > 1 ? "s" : ""}` +
        ` — ${totalWritten} file${totalWritten !== 1 ? "s" : ""} written, ` +
        `${totalSkipped} unchanged` +
        dryRunNote
    )
  );
}

main().catch((err: unknown) => {
  console.error(chalk.red("Unexpected error:"), err);
  process.exit(1);
});
