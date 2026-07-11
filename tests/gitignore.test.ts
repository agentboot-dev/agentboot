/**
 * B.1: gitignore conflict detection.
 *
 * detectGitignoreConflicts() was shipped but had no functional test and no callers.
 * These tests exercise the real `git check-ignore` path; sync now calls it after
 * writing to each repo so a synced-but-gitignored file (invisible to the team and to
 * drift-check) is surfaced instead of silently swallowed.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectGitignoreConflicts } from "../scripts/lib/gitignore.js";

describe("detectGitignoreConflicts (B.1)", () => {
  it("flags managed files a .gitignore would exclude, leaves clean ones alone", () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-gi-")));
    try {
      execSync("git init -q", { cwd: repo });
      // The field failure mode: the whole .claude/ tree is gitignored.
      fs.writeFileSync(path.join(repo, ".gitignore"), ".claude/\n");
      const managed = [
        ".claude/agents/code-reviewer.md",
        "AGENTS.md",
        ".claude/settings.json",
      ];
      const files = detectGitignoreConflicts(repo, managed)
        .map((c) => c.file)
        .sort();
      expect(files).toEqual([".claude/agents/code-reviewer.md", ".claude/settings.json"]);
      expect(files).not.toContain("AGENTS.md"); // not ignored → not a conflict
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns [] for a non-git directory (no crash)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-gi-nogit-"));
    try {
      expect(detectGitignoreConflicts(dir, [".claude/x.md"])).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] for an empty managed-file list", () => {
    expect(detectGitignoreConflicts(os.tmpdir(), [])).toEqual([]);
  });
});
