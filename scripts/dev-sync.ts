/**
 * Dev-only: syncs all platform distributions to their native locations
 * in the current repo for local dogfooding. Gitignored output only.
 *
 * This is NOT the production sync script (sync.ts). This is a convenience
 * for developing AgentBoot itself with its own personas loaded.
 *
 * Usage:
 *   npm run dev-sync         (after npm run build)
 *   npm run dev-build && npm run dev-sync
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { checkDistFreshness, staleDistMessage } from "./lib/dist-stamp.js";
import { loadConfig } from "./lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function copyRecursive(src: string, dest: string): number {
  let count = 0;
  if (!fs.existsSync(src)) return count;

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/**
 * Remove only files that exist in the source tree from the destination.
 * This avoids destroying manually-created files (e.g., .claude/rules/ or
 * .claude/settings.json that are checked into the repo).
 */
function cleanMatchingFiles(src: string, dest: string): void {
  if (!fs.existsSync(src) || !fs.existsSync(dest)) return;

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const destPath = path.join(dest, entry.name);
    if (!fs.existsSync(destPath)) continue;

    if (entry.isDirectory()) {
      cleanMatchingFiles(path.join(src, entry.name), destPath);
      // Remove directory only if now empty
      try {
        const remaining = fs.readdirSync(destPath);
        if (remaining.length === 0) fs.rmdirSync(destPath);
      } catch { /* ignore */ }
    } else {
      fs.unlinkSync(destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Platform sync definitions
// ---------------------------------------------------------------------------

const platforms: Array<{
  name: string;
  distSubdir: string;
  repoTarget: string;
  available: boolean;
}> = [
  {
    name: "claude",
    distSubdir: "claude/core",
    repoTarget: ".claude",
    available: false,
  },
  {
    name: "copilot",
    distSubdir: "copilot/core",
    repoTarget: ".github/copilot",
    available: false,
  },
  {
    name: "cursor",
    distSubdir: "cursor/core",
    repoTarget: ".cursor",
    available: false,
  },
  {
    name: "skill",
    distSubdir: "skill/core",
    repoTarget: ".agentboot/skill",
    available: false,
  },
  {
    name: "gemini",
    distSubdir: "gemini/core",
    repoTarget: ".gemini/agentboot",
    available: false,
  },
  {
    name: "windsurf",
    distSubdir: "windsurf/core",
    repoTarget: ".",  // .windsurfrules goes at project root
    available: false,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(chalk.bold("\nAgentBoot — dev-sync"));

if (!fs.existsSync(DIST)) {
  console.error(chalk.red("✗ dist/ not found. Run `npm run build` first."));
  process.exit(1);
}

// R2-1: dev-sync INSTALLS dist/ into live agent-tool locations, so it takes the
// same `gated` posture as install-user (see scripts/lib/dist-consumers.ts). It
// had `fs.existsSync(DIST)` only — existence read as freshness. That is the
// pattern the N1 gate exists to kill, and "it's dev-only" is exactly the
// hand-wave that left eight other consumers ungated: this is the copy that
// decides which personas the maintainers themselves are dogfooding, so a stale
// one means the tool is developed against policy it has already replaced.
{
  const cfgPath = path.join(ROOT, "agentboot.config.json");
  if (fs.existsSync(cfgPath)) {
    const check = checkDistFreshness(DIST, loadConfig(cfgPath), ROOT);
    if (!check.fresh) {
      console.error(chalk.red(staleDistMessage(check, "dev-sync")));
      process.exit(1);
    }
  }
}

let totalFiles = 0;

for (const platform of platforms) {
  const src = path.join(DIST, platform.distSubdir);
  if (!fs.existsSync(src)) {
    continue;
  }

  platform.available = true;
  const dest = path.join(ROOT, platform.repoTarget);
  cleanMatchingFiles(src, dest);
  const count = copyRecursive(src, dest);
  totalFiles += count;

  console.log(`  ${chalk.green("✓")} ${platform.name} → ${platform.repoTarget}/ (${count} files)`);
}

const skipped = platforms.filter((p) => !p.available);
if (skipped.length > 0) {
  console.log(chalk.gray(`  (not built: ${skipped.map((p) => p.name).join(", ")})`));
}

console.log(
  chalk.bold(`\n${chalk.green("✓")} Dev-synced ${totalFiles} files across ${platforms.filter((p) => p.available).length} platforms (gitignored)`)
);

if (totalFiles > 0) {
  console.log(chalk.yellow("\n  ⚠ Restart Claude Code to pick up persona changes\n"));
}
