/**
 * AgentBoot hub migration — convert existing repos into AgentBoot hubs.
 *
 * AB-126: `agentboot migrate` scans a repo for existing agentic content,
 * classifies it, scaffolds the hub structure, and imports content.
 * `--revert` restores from a backup created during migration.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import chalk from "chalk";
import {
  scanParentForContent,
  categorizeByStrategy,
  processWholeFileImports,
  processConfigMerges,
  applyWholeFileImports,
  applyConfigMerges,
  type ScanManifest,
} from "./import.js";
import { scaffoldHub } from "./install.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MigrateBackup {
  createdAt: string;
  repoPath: string;
  files: Array<{
    originalPath: string;
    contentHash: string;
  }>;
}

export interface MigrateOptions {
  path?: string | undefined;
  revert?: boolean | undefined;
  dryRun?: boolean | undefined;
  org?: string | undefined;
}

const BACKUP_FILE = ".agentboot-migrate-backup.json";

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Run the migration: scan, classify, scaffold, import.
 */
export function runMigrate(opts: MigrateOptions): void {
  const repoPath = path.resolve(opts.path ?? process.cwd());

  console.log(chalk.bold("\n  AgentBoot — migrate\n"));

  // Check for --revert
  if (opts.revert) {
    revertMigration(repoPath);
    return;
  }

  // Check if already an AgentBoot hub
  if (fs.existsSync(path.join(repoPath, "agentboot.config.json"))) {
    console.log(chalk.yellow("  This directory is already an AgentBoot hub.\n"));
    console.log(chalk.gray("  To reimport content, use `agentboot import` instead.\n"));
    return;
  }

  console.log(chalk.gray(`  Scanning: ${repoPath}\n`));

  // Step 1: Scan for existing content
  // Use scanParentForContent with the repo as a "parent" containing itself
  // Create a temp manifest by scanning this single repo
  const scanResult = scanSingleRepo(repoPath);
  if (scanResult.files.length === 0) {
    console.log(chalk.yellow("  No agentic content found to migrate.\n"));
    return;
  }

  console.log(chalk.green(`  Found ${scanResult.files.length} file(s):\n`));
  for (const f of scanResult.files) {
    console.log(chalk.gray(`    ${f.relativePath} (${f.type})`));
  }

  // Step 2: Create backup before modifying anything
  const backup: MigrateBackup = {
    createdAt: new Date().toISOString(),
    repoPath,
    files: scanResult.files.map(f => ({
      originalPath: f.absolutePath,
      contentHash: hashFile(f.absolutePath),
    })),
  };

  if (opts.dryRun) {
    console.log(chalk.cyan("\n  Dry run — no changes will be made.\n"));
  }

  // Step 3: Scaffold hub structure
  console.log(chalk.cyan("\n  Scaffolding hub structure..."));
  const org = opts.org ?? path.basename(repoPath);
  if (!opts.dryRun) {
    // Write backup first
    fs.writeFileSync(
      path.join(repoPath, BACKUP_FILE),
      JSON.stringify(backup, null, 2) + "\n",
      "utf-8",
    );

    // Scaffold (creates core/, agentboot.config.json, etc.)
    scaffoldHub(repoPath, org, org);
    console.log(chalk.green(`  ✓ Hub scaffolded (org: ${org})`));
  } else {
    console.log(chalk.gray(`    Would scaffold hub with org: ${org}`));
  }

  // Step 4: Categorize and import
  const categorized = categorizeByStrategy(scanResult);
  console.log(chalk.cyan("\n  Categorizing content..."));
  console.log(chalk.gray(
    `    Whole-file: ${categorized.wholeFile.length}, ` +
    `LLM classify: ${categorized.llmClassify.length}, ` +
    `Config merge: ${categorized.configMerge.length}, ` +
    `Skipped: ${categorized.skipped.length}`
  ));

  if (!opts.dryRun) {
    // Apply whole-file imports
    if (categorized.wholeFile.length > 0) {
      console.log(chalk.cyan("\n  Importing whole-file content..."));
      const wholeFileImports = processWholeFileImports(categorized.wholeFile, repoPath);
      const trusted = new Set(scanResult.files.map(f => f.absolutePath));
      const wfResult = applyWholeFileImports(wholeFileImports, repoPath, trusted);
      console.log(chalk.green(`    Created: ${wfResult.created}, Skipped: ${wfResult.skipped}`));
      for (const err of wfResult.errors) console.log(chalk.red(`    ${err}`));
    }

    // Apply config merges
    if (categorized.configMerge.length > 0) {
      console.log(chalk.cyan("\n  Importing config..."));
      const configMerges = processConfigMerges(categorized.configMerge);
      const cmResult = applyConfigMerges(configMerges, repoPath);
      console.log(chalk.green(`    Applied: ${cmResult.applied}, Skipped: ${cmResult.skipped}`));
    }

    // Note: LLM classification is NOT run during migrate.
    // Users should run `agentboot import` for that.
    if (categorized.llmClassify.length > 0) {
      console.log(chalk.cyan(`\n  ${categorized.llmClassify.length} file(s) need LLM classification.`));
      console.log(chalk.gray("  Run `agentboot import` after migration to classify them.\n"));
    }
  } else {
    console.log(chalk.gray(`\n    Would import ${categorized.wholeFile.length} whole-file(s) and ${categorized.configMerge.length} config(s)`));
    if (categorized.llmClassify.length > 0) {
      console.log(chalk.gray(`    ${categorized.llmClassify.length} file(s) would need separate LLM classification`));
    }
  }

  console.log(chalk.bold(chalk.green(
    `\n  ✓ Migration ${opts.dryRun ? "preview" : "complete"}. ` +
    `Run \`agentboot build\` to compile.\n`
  )));
  if (!opts.dryRun) {
    console.log(chalk.gray(`  Backup saved to: ${BACKUP_FILE}`));
    console.log(chalk.gray("  To undo: agentboot migrate --revert\n"));
  }
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

function revertMigration(repoPath: string): void {
  const backupPath = path.join(repoPath, BACKUP_FILE);
  if (!fs.existsSync(backupPath)) {
    console.log(chalk.red("  No migration backup found (.agentboot-migrate-backup.json).\n"));
    console.log(chalk.gray("  Cannot revert without a backup.\n"));
    return;
  }

  let backup: MigrateBackup;
  try {
    backup = JSON.parse(fs.readFileSync(backupPath, "utf-8")) as MigrateBackup;
  } catch {
    console.log(chalk.red("  Backup file is corrupt.\n"));
    return;
  }

  console.log(chalk.cyan(`  Reverting migration from ${backup.createdAt}...\n`));

  // Remove scaffolded files
  const scaffoldedPaths = [
    "agentboot.config.json",
    "repos.json",
    "core/",
    "dist/",
  ];

  let removed = 0;
  for (const sp of scaffoldedPaths) {
    const full = path.join(repoPath, sp);
    if (fs.existsSync(full)) {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        fs.unlinkSync(full);
      }
      removed++;
      console.log(chalk.gray(`    Removed: ${sp}`));
    }
  }

  // Remove backup file
  fs.unlinkSync(backupPath);

  console.log(chalk.green(`\n  ✓ Reverted (${removed} item(s) removed).\n`));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Scan a single repo directory (not a parent of repos).
 * Wraps the scan result into a ScanManifest format.
 */
function scanSingleRepo(repoPath: string): ScanManifest {
  // Use the parent scan with a temp structure
  const parentDir = path.dirname(repoPath);
  const repoName = path.basename(repoPath);

  // We can't use scanParentForContent directly since the repo would be
  // excluded if it has agentboot.config.json. But at this point it doesn't
  // (we check above). So we can use it with the parent.
  const manifest = scanParentForContent(parentDir, []);

  // Filter to only files from this repo
  return {
    parentDir: manifest.parentDir,
    scannedAt: manifest.scannedAt,
    files: manifest.files.filter(f => f.repoName === repoName),
  };
}
