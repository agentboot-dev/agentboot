/**
 * Field reports UI-10..UI-13 (fourth wave).
 *
 * UI-10: /ab conflated "enabled in the hub" with "deployed to this repo" —
 *   ab-query now instructs verifying the spoke's sync manifest before claiming
 *   invocability.
 * UI-11: persona review findings were non-durable (session scrollback only) —
 *   reviewer personas now persist the JSON findings to .claude/reviews/.
 * UI-12: the /ab skill had no branch for MCP tools being permission-DENIED —
 *   it now distinguishes denied (CLI fallback, no server start) from
 *   failed/timed-out (attempt server start).
 * UI-13: `agentboot status` in a spoke dead-ended with "Run agentboot install"
 *   — it now detects the spoke manifest and points at registered hubs.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerHub } from "../scripts/lib/registry.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

describe("UI-10: enabled vs deployed distinction in ab-query", () => {
  const skill = fs.readFileSync(path.join(ROOT, "templates", "skills", "ab-query.md"), "utf-8");

  it("instructs verifying the sync manifest before claiming a persona is invocable here", () => {
    expect(skill).toContain('"Enabled" is not "deployed here."');
    expect(skill).toContain(".agentboot-manifest.json");
    expect(skill).toContain("NOT deployed");
  });
});

describe("UI-11: reviewer personas persist findings", () => {
  for (const [persona, slug] of [
    ["code-reviewer", "review-code"],
    ["security-reviewer", "review-security"],
    ["ai-security-reviewer", "review-ai-security"],
  ] as const) {
    it(`${persona} instructs writing findings to .claude/reviews/`, () => {
      const content = fs.readFileSync(
        path.join(ROOT, "core", "personas", persona, "SKILL.md"), "utf-8");
      expect(content).toContain("Persist the findings (always)");
      expect(content).toContain(`.claude/reviews/${slug}-`);
      expect(content).toContain("durable artifact");
    });
  }
});

describe("UI-12: /ab distinguishes permission-DENIED from server failure", () => {
  it("ab.md has an explicit denied branch: CLI fallback, no server start", () => {
    const skill = fs.readFileSync(path.join(ROOT, "templates", "skills", "ab.md"), "utf-8");
    expect(skill).toContain("DENIED by the client's permission mode");
    expect(skill).toContain("Do NOT start a server");
    expect(skill).toContain("npx agentboot status");
    // The failure branch survives
    expect(skill).toContain("If the call fails or times out");
    expect(skill).toContain("npx agentboot mcp-server");
  });

  it("ab-query.md general behavior carries the denied fallback too", () => {
    const skill = fs.readFileSync(path.join(ROOT, "templates", "skills", "ab-query.md"), "utf-8");
    expect(skill).toContain("DENIED by the client's permission mode");
  });
});

describe("UI-13: status in a spoke routes to the registered hub", () => {
  function runStatus(cwd: string): string {
    try {
      return execSync(`${TSX} ${CLI} status`, { cwd, encoding: "utf-8", timeout: 30_000 });
    } catch (err: any) {
      return (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    }
  }

  it("detects the spoke manifest and suggests the registered hub's config", () => {
    const spoke = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui13-spoke-"));
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui13-hub-"));
    try {
      fs.mkdirSync(path.join(spoke, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(spoke, ".claude", ".agentboot-manifest.json"),
        JSON.stringify({ managed_by: "agentboot", version: "0", synced_at: "t", files: [] }));
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({ org: "acme" }));
      registerHub(hub, "acme"); // AGENTBOOT_HOME is test-isolated (tests/setup.ts)

      const out = runStatus(spoke);
      expect(out).toContain("synced SPOKE");
      expect(out).toContain("Registered hub");
      expect(out).toContain(hub);
      expect(out).toContain("--config");
      expect(out).not.toContain("Run `agentboot install`."); // the old dead end
    } finally {
      fs.rmSync(spoke, { recursive: true, force: true });
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("still suggests install/connect when NO hub is registered", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui13-empty-"));
    const savedHome = process.env["AGENTBOOT_HOME"];
    const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-ui13-home-"));
    process.env["AGENTBOOT_HOME"] = freshHome;
    try {
      const out = runStatus(dir);
      expect(out).toContain("No hubs registered");
      expect(out).toContain("agentboot connect");
    } finally {
      if (savedHome !== undefined) process.env["AGENTBOOT_HOME"] = savedHome;
      else delete process.env["AGENTBOOT_HOME"];
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(freshHome, { recursive: true, force: true });
    }
  });
});
