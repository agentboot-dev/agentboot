/**
 * Gitignore conflict detection.
 *
 * Phase 11 C1.5: Detects when managed AgentBoot files would be
 * ignored by a repo's .gitignore configuration.
 */

import { spawnSync } from "node:child_process";
import os from "node:os";

export interface GitignoreConflict {
  file: string;
  ignored: boolean;
}

/**
 * Check if managed files would be ignored by git in the given repo.
 * Uses `git check-ignore` with batched input for performance (O(1) process spawns).
 *
 * Returns only the files that ARE ignored (conflicts).
 */
export function detectGitignoreConflicts(
  repoPath: string,
  managedFiles: string[],
): GitignoreConflict[] {
  if (managedFiles.length === 0) return [];

  try {
    // Batch all paths into a single git check-ignore call via stdin.
    // Neutralize the user's GLOBAL excludes file (core.excludesFile): this check
    // warns that "the team won't see these files", which is only true for ignore
    // rules the repo itself carries — a rule in one developer's personal global
    // gitignore says nothing about teammates or CI, and matching it here produced
    // false-positive warnings in repos with no .gitignore at all.
    const result = spawnSync("git", ["-c", `core.excludesFile=${os.devNull}`, "check-ignore", "--stdin"], {
      cwd: repoPath,
      input: managedFiles.join("\n"),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    if (result.status === null || result.status === 128) {
      // Not a git repo or git error — return no conflicts
      return [];
    }

    // git check-ignore --stdin outputs one ignored path per line on stdout
    const stdout = result.stdout?.toString().trim() ?? "";
    if (!stdout) return [];

    const ignoredSet = new Set(stdout.split("\n").map(l => l.trim()).filter(Boolean));
    return managedFiles
      .filter(f => ignoredSet.has(f))
      .map(f => ({ file: f, ignored: true }));
  } catch {
    // git not available — skip
    return [];
  }
}
