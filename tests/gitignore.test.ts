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
      // The fortael failure mode: the whole .claude/ tree is gitignored.
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

  it("ignores the user's GLOBAL gitignore (false-positive regression)", () => {
    // Repro of the field report: a repo with NO .gitignore warned anyway because
    // the developer's personal global excludes matched managed paths. Global
    // rules say nothing about what teammates/CI will see — repo-level only.
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
      // Sanity: plain git DOES consider these ignored via the global file...
      const raw = execSync("git check-ignore .claude/settings.json || true", { cwd: repo, encoding: "utf-8" });
      expect(raw).toContain(".claude/settings.json");
      // ...but the conflict detector must not — no repo-level .gitignore exists.
      expect(detectGitignoreConflicts(repo, managed)).toEqual([]);
    } finally {
      if (savedEnv !== undefined) process.env["GIT_CONFIG_GLOBAL"] = savedEnv;
      else delete process.env["GIT_CONFIG_GLOBAL"];
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
