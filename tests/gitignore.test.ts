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

  it("detects GLOBAL-gitignore matches and ATTRIBUTES them (UI-6 resolution)", () => {
    // Field report resolution: a warning in a repo with no .gitignore was
    // CORRECT — the machine's global excludes ignored .claude, so the sync
    // runner's commits genuinely omit the files. Detect it, but say WHERE the
    // rule lives, or the fix hint points at the wrong file.
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-gi-global-")));
    const repo = path.join(base, "repo");
    fs.mkdirSync(repo);
    const globalIgnore = path.join(base, "global-gitignore");
    fs.writeFileSync(globalIgnore, ".claude/\nAGENTS.md\n");
    const savedEnv = process.env["GIT_CONFIG_GLOBAL"];
    const globalCfg = path.join(base, "gitconfig");
    fs.writeFileSync(globalCfg, `[core]\n\texcludesFile = ${globalIgnore.replace(/\\/g, "/")}\n`);
    process.env["GIT_CONFIG_GLOBAL"] = globalCfg;
    try {
      execSync("git init -q", { cwd: repo });
      const managed = [".claude/settings.json", "AGENTS.md"];
      const conflicts = detectGitignoreConflicts(repo, managed);
      expect(conflicts.map((c) => c.file).sort()).toEqual([".claude/settings.json", "AGENTS.md"].sort());
      for (const c of conflicts) {
        expect(c.fromGlobal).toBe(true);
        expect(c.source).toContain("global-gitignore");
      }
    } finally {
      if (savedEnv !== undefined) process.env["GIT_CONFIG_GLOBAL"] = savedEnv;
      else delete process.env["GIT_CONFIG_GLOBAL"];
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("attributes repo-level rules as non-global with source .gitignore", () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-gi-src-")));
    try {
      execSync("git init -q", { cwd: repo });
      fs.writeFileSync(path.join(repo, ".gitignore"), ".claude/\n");
      const conflicts = detectGitignoreConflicts(repo, [".claude/settings.json"]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.fromGlobal).toBe(false);
      expect(conflicts[0]!.source).toMatch(/^\.gitignore:\d+/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
