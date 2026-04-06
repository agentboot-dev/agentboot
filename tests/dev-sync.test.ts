/**
 * Tests for dev-sync.ts behavior.
 *
 * Addresses gap: "dev-sync.ts has no dedicated test"
 * (human-in-the-loop-priority.md HIGH section, "Opportunities to Add Automated Tests")
 *
 * dev-sync.ts is a script with side effects — it copies platform distributions to
 * their native locations in the current project for local dogfooding. Because the
 * script is hardcoded to ROOT as both source and destination, these tests run it
 * against the actual project and verify that expected output files appear in the
 * project's own platform directories (which are gitignored).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const DEV_SYNC = path.join(ROOT, "scripts", "dev-sync.ts");
const COMPILE = path.join(ROOT, "scripts", "compile.ts");

function runScript(scriptPath: string): string {
  return execSync(`${TSX} ${scriptPath}`, {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    timeout: 60_000,
  }).toString();
}

// ---------------------------------------------------------------------------
// dev-sync execution and output assertions
// ---------------------------------------------------------------------------

describe("dev-sync: script execution and output", () => {
  let syncOutput: string;

  beforeAll(() => {
    // Ensure dist/ is present. If it already exists this is fast (no-op compile).
    // If it is absent, compile to build it first.
    const distPath = path.join(ROOT, "dist");
    if (!fs.existsSync(distPath)) {
      runScript(COMPILE);
    }
    syncOutput = runScript(DEV_SYNC);
  });

  // Prove dev-sync exits 0 and reports at least one platform in its output
  it("dev-sync: exits 0 and reports synced file count", () => {
    // If dev-sync threw, beforeAll would have failed — reaching here means exit 0
    expect(syncOutput).toMatch(/dev-sync/i);
    // Output must contain a file count (N files) confirming at least one file was copied
    expect(syncOutput).toMatch(/\d+ files?/);
  });

  // Prove dev-sync reports the claude platform in its output
  it("dev-sync: reports claude platform as synced", () => {
    // dist/claude/core/ must exist before this runs (guaranteed by beforeAll compile)
    const claudeDistSrc = path.join(ROOT, "dist", "claude", "core");
    if (fs.existsSync(claudeDistSrc)) {
      expect(syncOutput).toContain("claude");
    }
  });

  // Prove dev-sync writes code-reviewer.md to .claude/agents/ in the project root
  it("dev-sync: writes code-reviewer.md to .claude/agents/", () => {
    const distAgentSrc = path.join(ROOT, "dist", "claude", "core", "agents", "code-reviewer.md");
    const agentDest = path.join(ROOT, ".claude", "agents", "code-reviewer.md");

    if (fs.existsSync(distAgentSrc)) {
      expect(
        fs.existsSync(agentDest),
        "code-reviewer.md must be written to .claude/agents/ after dev-sync"
      ).toBe(true);
    }
  });

  // Prove dev-sync writes skill files to .claude/skills/
  it("dev-sync: writes review-code/SKILL.md to .claude/skills/", () => {
    const distSkillSrc = path.join(ROOT, "dist", "claude", "core", "skills", "review-code", "SKILL.md");
    const skillDest = path.join(ROOT, ".claude", "skills", "review-code", "SKILL.md");

    if (fs.existsSync(distSkillSrc)) {
      expect(
        fs.existsSync(skillDest),
        "review-code/SKILL.md must be written to .claude/skills/ after dev-sync"
      ).toBe(true);
    }
  });

  // Prove dev-sync is idempotent — second run does not error and produces output
  it("dev-sync: running twice does not error and produces consistent output", () => {
    const secondOutput = runScript(DEV_SYNC);
    expect(secondOutput).toMatch(/dev-sync/i);
    // Must not mention error or failure
    expect(secondOutput.toLowerCase()).not.toMatch(/\berror\b|\bfailed\b/);
  });

  // Prove dev-sync exits with the warning about restarting Claude Code when files copied
  it("dev-sync: warns to restart Claude Code when files are copied", () => {
    // This warning appears only when totalFiles > 0; the project always has dist/ content
    const distClaudeCore = path.join(ROOT, "dist", "claude", "core");
    if (fs.existsSync(distClaudeCore)) {
      expect(syncOutput).toMatch(/restart/i);
    }
  });
});

// TODO: integration test — full dev-build pipeline (clean → validate → build → dev-sync)
// What to verify:
//   - All four stages complete sequentially without stopping early
//   - Timestamps on .claude/agents/code-reviewer.md change after dev-build
//   - Introducing a validation error before running dev-build causes the pipeline
//     to stop after validate — dist/ is NOT rebuilt, dev-sync is NOT run
//   This requires file-system mutation of config files and is safest in a CI job
//   with a clean working tree.
// test.skip("dev-build pipeline stops at validate when validation fails", async () => {});
