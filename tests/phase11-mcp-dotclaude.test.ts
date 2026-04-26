/**
 * Phase 11 Batch 8: MCP expansion + dotclaude writeDirectly
 *
 * Tests for cross-platform MCP configs and user-level content delivery.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

beforeAll(() => {
  const distPath = path.join(ROOT, "dist");
  if (!fs.existsSync(distPath) || !fs.existsSync(path.join(distPath, "cursor"))) {
    execSync(`${TSX} scripts/compile.ts`, {
      cwd: ROOT,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 30_000,
    });
  }
});

// ---------------------------------------------------------------------------
// MCP Config Expansion
// ---------------------------------------------------------------------------

describe("MCP config expansion: cursor", () => {
  it("dist/cursor/ contains .cursor/mcp.json with agentboot entry", () => {
    const mcpPath = path.join(ROOT, "dist", "cursor", "core", ".cursor", "mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.agentboot).toBeDefined();
    expect(content.mcpServers.agentboot.command).toBe("npx");
  });
});

describe("MCP config expansion: jetbrains", () => {
  it("dist/jetbrains/ contains .junie/mcp/mcp.json", () => {
    const mcpPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "mcp", "mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.agentboot).toBeDefined();
  });
});

describe("MCP config expansion: gemini", () => {
  it("dist/gemini/ contains .gemini/settings.json with mcpServers", () => {
    const settingsPath = path.join(ROOT, "dist", "gemini", "core", ".gemini", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.agentboot).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// dotclaude writeDirectly
// ---------------------------------------------------------------------------

import { writeDirectly, detectExistingContent, removeUserContent } from "../scripts/lib/dotclaude.js";

describe("B3: dotclaude writeDirectly", () => {
  let tempHome: string;
  let origHome: string | undefined;

  beforeAll(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-dotclaude-"));
    origHome = process.env["HOME"];
    process.env["HOME"] = tempHome;
    // Create a minimal .claude dir
    fs.mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
  });

  afterEach(() => {
    // Cleanup between tests
  });

  afterAll(() => {
    if (origHome !== undefined) {
      process.env["HOME"] = origHome;
    } else {
      delete process.env["HOME"];
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("writes skills and rules to ~/.claude/", () => {
    const distPath = path.join(ROOT, "dist", "claude", "core");
    const result = writeDirectly(distPath);
    expect(result.errors).toHaveLength(0);
    expect(result.skillsWritten.length).toBeGreaterThan(0);
  });

  it("does NOT write CLAUDE.md (requires dotclaude markers)", () => {
    const claudeMdPath = path.join(tempHome, ".claude", "CLAUDE.md");
    // writeDirectly should not create or modify CLAUDE.md
    // (it's listed in skipped)
    const distPath = path.join(ROOT, "dist", "claude", "core");
    const result = writeDirectly(distPath);
    expect(result.skipped).toContain("CLAUDE.md (requires dotclaude markers for safe append)");
  });

  it("does NOT write settings.json (requires dotclaude merge)", () => {
    const distPath = path.join(ROOT, "dist", "claude", "core");
    const result = writeDirectly(distPath);
    expect(result.skipped).toContain("settings.json (requires dotclaude for safe merge)");
  });

  it("generates user manifest tracking written files", () => {
    const manifestPath = path.join(tempHome, ".claude", ".agentboot-user-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.managed_by).toBe("agentboot");
    expect(manifest.scope).toBe("user");
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it("detectExistingContent finds the manifest", () => {
    const detection = detectExistingContent();
    expect(detection.claudeDirExists).toBe(true);
    expect(detection.hasManifest).toBe(true);
  });

  it("removeUserContent cleans up managed files", () => {
    const { removed, errors } = removeUserContent();
    expect(errors).toHaveLength(0);
    expect(removed.length).toBeGreaterThan(0);
    // Manifest should be removed too
    const detection = detectExistingContent();
    expect(detection.hasManifest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dotclaude module existence
// ---------------------------------------------------------------------------

describe("dotclaude module", () => {
  it("scripts/lib/dotclaude.ts exists", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts", "lib", "dotclaude.ts"))).toBe(true);
  });
});
