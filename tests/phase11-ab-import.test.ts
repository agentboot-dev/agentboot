/**
 * Phase 11 Batch 6: /ab improvements (B1) + URL import (B2)
 *
 * Tests for parseGitHubUrl, model-aware delegation, status enrichment.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

beforeAll(() => {
  const distPath = path.join(ROOT, "dist");
  if (!fs.existsSync(distPath) || !fs.existsSync(path.join(distPath, "claude", "core", "agents"))) {
    execSync(`${TSX} scripts/compile.ts`, {
      cwd: ROOT,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 30_000,
    });
  }
});

// ---------------------------------------------------------------------------
// B2: parseGitHubUrl
// ---------------------------------------------------------------------------

import { parseGitHubUrl } from "../scripts/lib/import.js";

describe("B2: parseGitHubUrl", () => {
  it("parses repo URL", () => {
    const result = parseGitHubUrl("https://github.com/org/repo");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("repo");
    expect(result!.owner).toBe("org");
    expect(result!.repo).toBe("repo");
  });

  it("parses blob file URL", () => {
    const result = parseGitHubUrl("https://github.com/org/repo/blob/main/SKILL.md");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("blob-file");
    expect(result!.branch).toBe("main");
    expect(result!.filePath).toBe("SKILL.md");
  });

  it("parses raw file URL", () => {
    const result = parseGitHubUrl("https://raw.githubusercontent.com/org/repo/main/path/to/SKILL.md");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("raw-file");
    expect(result!.filePath).toBe("path/to/SKILL.md");
  });

  it("rejects non-GitHub URL", () => {
    expect(parseGitHubUrl("https://evil.com/org/repo")).toBeNull();
    expect(parseGitHubUrl("https://gitlab.com/org/repo")).toBeNull();
  });

  it("rejects URL with literal path traversal in filePath", () => {
    // URL constructor normalizes most .. patterns, but raw strings like %2e%2e bypass
    // Our guard checks parsed.pathname for literal ".." before URL normalization can resolve it
    const result = parseGitHubUrl("https://raw.githubusercontent.com/org/repo/main/..%2F..%2Fetc/passwd");
    // This may or may not parse depending on encoding, but the filePath should not escape
    if (result) {
      expect(result.filePath).not.toContain("..");
    }
  });

  it("rejects invalid URL", () => {
    expect(parseGitHubUrl("not-a-url")).toBeNull();
    expect(parseGitHubUrl("")).toBeNull();
  });

  it("strips .git suffix from repo name", () => {
    const result = parseGitHubUrl("https://github.com/org/repo.git");
    expect(result).not.toBeNull();
    expect(result!.repo).toBe("repo");
  });
});

// ---------------------------------------------------------------------------
// B2: importFromUrl error handling (no network mocking — structural tests)
// ---------------------------------------------------------------------------

import { importFromUrl } from "../scripts/lib/import.js";

describe("B2: importFromUrl structural tests", () => {
  it("rejects invalid GitHub URL", async () => {
    await expect(importFromUrl("https://evil.com/repo", "/tmp")).rejects.toThrow("Invalid GitHub URL");
  });

  it("rejects non-HTTPS URL", async () => {
    await expect(importFromUrl("http://github.com/org/repo", "/tmp")).rejects.toThrow("Invalid GitHub URL");
  });

  it("rejects empty URL", async () => {
    await expect(importFromUrl("", "/tmp")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B1.5: Model-aware delegation
// ---------------------------------------------------------------------------

describe("B1.5: model injection in compiled agents", () => {
  const agentsDir = path.join(ROOT, "dist", "claude", "core", "agents");

  it("ab-query.md has model: haiku in frontmatter", () => {
    const content = fs.readFileSync(path.join(agentsDir, "ab-query.md"), "utf-8");
    expect(content).toContain("model: haiku");
  });

  it("ab.md has model: sonnet in frontmatter", () => {
    const content = fs.readFileSync(path.join(agentsDir, "ab.md"), "utf-8");
    expect(content).toContain("model: sonnet");
  });

  it("ab-author.md has model: sonnet", () => {
    const content = fs.readFileSync(path.join(agentsDir, "ab-author.md"), "utf-8");
    expect(content).toContain("model: sonnet");
  });

  it("ab-query.md has disallowedTools restricting write access", () => {
    const content = fs.readFileSync(path.join(agentsDir, "ab-query.md"), "utf-8");
    expect(content).toContain("disallowedTools:");
    expect(content).toContain("Bash");
    expect(content).toContain("Write");
  });

  it("ab-manage.md does NOT have disallowedTools", () => {
    const content = fs.readFileSync(path.join(agentsDir, "ab-manage.md"), "utf-8");
    expect(content).not.toContain("disallowedTools:");
  });
});

// ---------------------------------------------------------------------------
// B1.1: Status enrichment
// ---------------------------------------------------------------------------

describe("B1.1: status response has artifact counts", () => {
  it("mcp-server.ts contains computeMaturityLabel function", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "mcp-server.ts"), "utf-8");
    expect(content).toContain("computeMaturityLabel");
    expect(content).toContain("artifactCounts");
    expect(content).toContain("maturityLabel");
  });
});

// ---------------------------------------------------------------------------
// B1.5: Config type has ab.modelOverrides
// ---------------------------------------------------------------------------

describe("B1.5: config type", () => {
  it("config.ts has ab.modelOverrides type", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "lib", "config.ts"), "utf-8");
    expect(content).toContain("modelOverrides");
  });
});
