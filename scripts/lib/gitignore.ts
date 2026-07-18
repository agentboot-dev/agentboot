/**
 * Gitignore conflict detection.
 *
 * Phase 11 C1.5: Detects when managed AgentBoot files would be
 * ignored by git in a target repo.
 *
 * UI-6 resolution: a field report initially read as a false positive (warning
 * in a repo with no .gitignore) turned out to be a CORRECT warning — the
 * machine's GLOBAL gitignore (core.excludesFile) ignored `.claude`. The
 * consequence is real either way: whoever runs sync cannot commit the synced
 * files. So we detect ignores from EVERY source, but ATTRIBUTE them — a
 * global-gitignore match must say so, or the fix hint points at the wrong file.
 */

import { spawnSync } from "node:child_process";

export interface GitignoreConflict {
  file: string;
  ignored: boolean;
  /** The ignore-rule source file (e.g. ".gitignore", "~/.config/git/ignore") and line, when known. */
  source?: string;
  /** True when the matching rule lives OUTSIDE the repo (global excludes / XDG ignore) —
   * it affects this machine's commits but not teammates or CI. */
  fromGlobal?: boolean;
}

/**
 * Check if managed files would be ignored by git in the given repo.
 * Uses `git check-ignore --verbose` with batched input so each conflict carries
 * the source of the matching rule.
 *
 * Returns only the files that ARE ignored (conflicts).
 */
export function detectGitignoreConflicts(
  repoPath: string,
  managedFiles: string[],
): GitignoreConflict[] {
  if (managedFiles.length === 0) return [];

  try {
    // --verbose output: <source>:<linenum>:<pattern>\t<pathname>
    const result = spawnSync("git", ["check-ignore", "--verbose", "--non-matching", "--stdin"], {
      cwd: repoPath,
      input: managedFiles.join("\n"),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    if (result.status === null || result.status === 128) {
      // Not a git repo or git error — return no conflicts
      return [];
    }

    const stdout = result.stdout?.toString() ?? "";
    const conflicts: GitignoreConflict[] = [];
    const wanted = new Set(managedFiles);

    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const meta = line.slice(0, tab);          // <source>:<linenum>:<pattern> ("::" when non-matching)
      const file = line.slice(tab + 1).trim();
      if (!wanted.has(file)) continue;
      // Parse from the linenum anchor, not a naive split — a Windows source
      // like "C:/Users/x/global-gitignore" contains a colon of its own.
      const m = /^(.+):(\d+):/.exec(meta);
      if (!m) continue;                         // "::" --non-matching entry: not ignored
      const source = m[1]!;
      const linenum = m[2]!;
      // A rule source inside the repo is repo-relative (".gitignore",
      // ".git/info/exclude", "sub/.gitignore"); global/XDG sources come back
      // as absolute paths (or ~-prefixed).
      const fromGlobal = source.startsWith("/") || source.startsWith("~") || /^[A-Za-z]:[\\/]/.test(source);
      conflicts.push({
        file,
        ignored: true,
        source: linenum ? `${source}:${linenum}` : source,
        fromGlobal,
      });
    }
    return conflicts;
  } catch {
    // git not available — skip
    return [];
  }
}
