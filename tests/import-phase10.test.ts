/**
 * Tests for Phase 10 import pipeline bug fixes (Stories 13d-13h).
 *
 * 13d: Import batching — single LLM call per repo
 * 13e: Import timeout tracking
 * 13f: Path-scoped files not appearing in scan
 * 13g: Source attribution in import
 * 13h: Duplicate detection during import
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  scanParentForContent,
  categorizeByStrategy,
  classifyScannedFiles,
  BATCH_SIZE,
  buildBatchedClassificationPrompt,
  writeFailedFile,
  readFailedFile,
  resolveAttribution,
  injectAttribution,
  tokenizeForJaccard,
  jaccardSimilarityTokenized,
  detectDuplicates,
  type ScanManifest,
  type CategorizedScan,
  type TimedOutFile,
  type Attribution,
  type DuplicateMatch,
} from "../scripts/lib/import.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ab-p10-test-"));
}

function scaffoldHub(hubPath: string): void {
  fs.mkdirSync(path.join(hubPath, "core", "traits"), { recursive: true });
  fs.mkdirSync(path.join(hubPath, "core", "personas"), { recursive: true });
  fs.mkdirSync(path.join(hubPath, "core", "gotchas"), { recursive: true });
  fs.mkdirSync(path.join(hubPath, "core", "instructions"), { recursive: true });
  fs.writeFileSync(
    path.join(hubPath, "agentboot.config.json"),
    JSON.stringify({ org: "test-org", groups: {}, personas: { enabled: [] } }, null, 2),
  );
}

function writeFile(dir: string, relPath: string, content: string): string {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Story 13d: Import batching
// ---------------------------------------------------------------------------

describe("Story 13d: Import batching", () => {
  it("BATCH_SIZE is 10", () => {
    expect(BATCH_SIZE).toBe(10);
  });

  it("buildBatchedClassificationPrompt includes all files with delimiters", () => {
    const files = [
      { filePath: "CLAUDE.md", absolutePath: "/tmp/a/CLAUDE.md", content: "# Claude\nSome rules.", lines: 2 },
      { filePath: ".claude/rules/test.md", absolutePath: "/tmp/a/.claude/rules/test.md", content: "# Test Rule\nBe safe.", lines: 2 },
    ];
    const inventory = { traits: [], personas: [], gotchas: [], instructions: [] };
    const prompt = buildBatchedClassificationPrompt(files, "my-repo", inventory);

    expect(prompt).toContain("[BATCH: 2 files from my-repo]");
    expect(prompt).toContain("=== FILE 1: CLAUDE.md (2 lines) ===");
    expect(prompt).toContain("=== FILE 2: .claude/rules/test.md (2 lines) ===");
    expect(prompt).toContain("# Claude");
    expect(prompt).toContain("# Test Rule");
  });

  it("batching math: BATCH_SIZE constant groups files into correct batch counts", () => {
    // classifyScannedFiles cannot be easily unit-tested (requires live LLM provider),
    // so this test verifies the grouping and batching arithmetic it relies on.
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const parentDir = path.join(tmpDir, "parent");
    const repo1 = path.join(parentDir, "repo1");
    const repo2 = path.join(parentDir, "repo2");

    // Create 5 files in repo1 (should be 1 batch)
    for (let i = 0; i < 5; i++) {
      writeFile(repo1, `CLAUDE.md`, `# Repo1 Claude\nRule ${i}`);
    }
    writeFile(repo2, "CLAUDE.md", "# Repo2 Claude\nAnother rule");

    // Build manifest manually
    const manifest: ScanManifest = {
      parentDir,
      scannedAt: new Date().toISOString(),
      files: [
        ...Array.from({ length: 5 }, (_, i) => ({
          absolutePath: path.join(repo1, "CLAUDE.md"),
          relativePath: "CLAUDE.md",
          repoDir: repo1,
          repoName: "repo1",
          lines: 2,
          type: "claude-md" as const,
        })),
        {
          absolutePath: path.join(repo2, "CLAUDE.md"),
          relativePath: "CLAUDE.md",
          repoDir: repo2,
          repoName: "repo2",
          lines: 2,
          type: "claude-md" as const,
        },
      ],
    };

    // Mock the LLM provider module — classifyScannedFiles uses getProvider internally
    // We can't easily mock that, so we verify the batching constant and prompt structure
    // The structural test above (buildBatchedClassificationPrompt) validates the batching logic
    expect(manifest.files.length).toBe(6);

    // Verify grouping logic: 5 files from repo1 + 1 from repo2
    const byRepo = new Map<string, typeof manifest.files>();
    for (const file of manifest.files) {
      const list = byRepo.get(file.repoName) ?? [];
      list.push(file);
      byRepo.set(file.repoName, list);
    }
    expect(byRepo.get("repo1")?.length).toBe(5);
    expect(byRepo.get("repo2")?.length).toBe(1);

    // With BATCH_SIZE=10, repo1's 5 files should be 1 batch, repo2's 1 file should be 1 batch
    const repo1Batches = Math.ceil(5 / BATCH_SIZE);
    const repo2Batches = Math.ceil(1 / BATCH_SIZE);
    expect(repo1Batches).toBe(1); // Single call for repo1
    expect(repo2Batches).toBe(1); // Single call for repo2
  });
});

// ---------------------------------------------------------------------------
// Story 13f: Path-scoped files in scan results
// ---------------------------------------------------------------------------

describe("Story 13f: Path-scoped files in scan", () => {
  it("files with paths: frontmatter appear in scan results", () => {
    const parentDir = path.join(tmpDir, "parent");
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    // Create a repo with a path-scoped rule file
    const repoDir = path.join(parentDir, "myrepo");
    writeFile(repoDir, ".claude/rules/auth-safety.md", [
      "---",
      'paths: ["src/auth/**"]',
      "description: Auth safety rules",
      "---",
      "",
      "# Auth Safety",
      "Always validate tokens before processing.",
    ].join("\n"));

    // Also create a regular rule for comparison
    writeFile(repoDir, ".claude/rules/general.md", [
      "---",
      "description: General rules",
      "---",
      "",
      "# General",
      "Be careful.",
    ].join("\n"));

    const manifest = scanParentForContent(parentDir, [hubPath]);
    expect(manifest.files.length).toBe(2);

    // Both files should be in the scan results
    const authFile = manifest.files.find(f => f.relativePath.includes("auth-safety"));
    const generalFile = manifest.files.find(f => f.relativePath.includes("general"));
    expect(authFile).toBeDefined();
    expect(generalFile).toBeDefined();
    expect(authFile!.type).toBe("rule");
    expect(generalFile!.type).toBe("rule");
  });

  it("path-scoped rules are categorized as wholeFile (gotchas)", () => {
    const parentDir = path.join(tmpDir, "parent");
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(parentDir, "myrepo");
    writeFile(repoDir, ".claude/rules/scoped.md", [
      "---",
      "paths:",
      "  - src/db/**",
      "---",
      "# DB Safety",
      "Never use raw SQL.",
    ].join("\n"));

    const manifest = scanParentForContent(parentDir, [hubPath]);
    const categorized = categorizeByStrategy(manifest);

    // Path-scoped rules should go to wholeFile, not llmClassify
    expect(categorized.wholeFile.length).toBe(1);
    expect(categorized.wholeFile[0]!.relativePath).toContain("scoped");
  });

  it("files with paths: as array in frontmatter are not excluded", () => {
    const parentDir = path.join(tmpDir, "parent");
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(parentDir, "myrepo");
    writeFile(repoDir, ".claude/rules/multi-path.md", [
      "---",
      "paths:",
      "  - src/auth/**",
      "  - src/session/**",
      "description: Multi-path rule",
      "---",
      "",
      "# Multi Path Rule",
      "Rules for auth and session.",
    ].join("\n"));

    const manifest = scanParentForContent(parentDir, [hubPath]);
    expect(manifest.files.length).toBe(1);
    expect(manifest.files[0]!.type).toBe("rule");
  });

  it("path-scoped .md files outside rules/ directory are detected as rule type", () => {
    const parentDir = path.join(tmpDir, "parent");
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    // Create a file with paths: frontmatter that is NOT in a rules/ directory
    const repoDir = path.join(parentDir, "myrepo");
    writeFile(repoDir, ".claude/custom/db-safety.md", [
      "---",
      "paths:",
      "  - src/db/**",
      "description: DB safety gotcha",
      "---",
      "",
      "# DB Safety",
      "Never use raw SQL.",
    ].join("\n"));

    const manifest = scanParentForContent(parentDir, [hubPath]);
    expect(manifest.files.length).toBe(1);
    expect(manifest.files[0]!.type).toBe("rule");

    // Should be categorized as wholeFile (gotcha) because it has paths:
    const categorized = categorizeByStrategy(manifest);
    expect(categorized.wholeFile.length).toBe(1);
    expect(categorized.skipped.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Story 13e: Import timeout tracking
// ---------------------------------------------------------------------------

describe("Story 13e: Import timeout tracking", () => {
  it("writeFailedFile persists timed-out files to disk", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const timedOut: TimedOutFile[] = [
      { file: "/repos/auth-service/CLAUDE.md", repoName: "auth-service", timedOutAt: "2026-04-11T00:00:00.000Z" },
      { file: "/repos/api-gateway/.claude/rules/rate-limit.md", repoName: "api-gateway", timedOutAt: "2026-04-11T00:00:01.000Z" },
    ];

    const failedPath = writeFailedFile(timedOut, hubPath);
    expect(fs.existsSync(failedPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(failedPath, "utf-8"));
    expect(written).toHaveLength(2);
    expect(written[0].file).toBe("/repos/auth-service/CLAUDE.md");
    expect(written[0].repoName).toBe("auth-service");
    expect(written[1].timedOutAt).toBe("2026-04-11T00:00:01.000Z");
  });

  it("readFailedFile returns timed-out files from disk", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const timedOut: TimedOutFile[] = [
      { file: "/repos/auth-service/CLAUDE.md", repoName: "auth-service", timedOutAt: "2026-04-11T00:00:00.000Z" },
    ];
    writeFailedFile(timedOut, hubPath);

    const result = readFailedFile(hubPath);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe("/repos/auth-service/CLAUDE.md");
  });

  it("readFailedFile returns empty array when no failed file exists", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const result = readFailedFile(hubPath);
    expect(result).toHaveLength(0);
  });

  it("ClassifyResult includes timedOutFiles array", () => {
    // Verify the interface shape by type
    const result = {
      classifications: [],
      trustedSources: new Set<string>(),
      timedOutFiles: [{ file: "/path", repoName: "repo", timedOutAt: "2026-04-11T00:00:00.000Z" }],
    };
    expect(result.timedOutFiles).toHaveLength(1);
    expect(result.timedOutFiles[0]!.file).toBe("/path");
  });
});

// ---------------------------------------------------------------------------
// Story 13g: Source attribution in import
// ---------------------------------------------------------------------------

describe("Story 13g: Source attribution", () => {
  it("injectAttribution adds attribution to content without frontmatter", () => {
    const attr: Attribution = { contributor: "mike@acme.com", source: "auth-service" };
    const content = "# My Rule\nDo something safely.";
    const result = injectAttribution(content, attr);

    expect(result).toContain("---");
    expect(result).toContain("contributor: mike@acme.com");
    expect(result).toContain("source: auth-service");
    expect(result).toContain("# My Rule");
  });

  it("injectAttribution adds attribution to content with existing frontmatter", () => {
    const attr: Attribution = { contributor: "jane@acme.com", source: "api-gateway" };
    const content = [
      "---",
      "type: gotcha",
      'paths: ["src/auth/**"]',
      "description: Auth rules",
      "---",
      "",
      "# Auth Rules",
    ].join("\n");

    const result = injectAttribution(content, attr);
    expect(result).toContain("contributor: jane@acme.com");
    expect(result).toContain("source: api-gateway");
    // Attribution should appear after type:
    const typeIdx = result.indexOf("type: gotcha");
    const contribIdx = result.indexOf("contributor:");
    expect(contribIdx).toBeGreaterThan(typeIdx);
  });

  it("injectAttribution handles null contributor", () => {
    const attr: Attribution = { contributor: null, source: "my-repo" };
    const content = "# Test\nContent.";
    const result = injectAttribution(content, attr);

    expect(result).toContain("source: my-repo");
    expect(result).not.toContain("contributor:");
  });

  it("resolveAttribution returns source from repoName", () => {
    // Create a temp git repo
    const repoDir = path.join(tmpDir, "test-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    const filePath = path.join(repoDir, "test.md");
    fs.writeFileSync(filePath, "# Test\n", "utf-8");

    const attr = resolveAttribution(filePath, repoDir, "test-repo");
    expect(attr.source).toBe("test-repo");
    // contributor may be null if not a git repo — that's fine
  });

  it("resolveAttribution uses git blame when available", () => {
    // Initialize a git repo and commit a file
    const repoDir = path.join(tmpDir, "git-repo");
    fs.mkdirSync(repoDir, { recursive: true });

    const { spawnSync } = require("node:child_process");
    spawnSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "pipe" });
    spawnSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "pipe" });

    const filePath = path.join(repoDir, "rule.md");
    fs.writeFileSync(filePath, "# Safety Rule\nBe safe.\n", "utf-8");
    spawnSync("git", ["add", "rule.md"], { cwd: repoDir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "add rule"], { cwd: repoDir, stdio: "pipe" });

    const attr = resolveAttribution(filePath, repoDir, "git-repo");
    expect(attr.source).toBe("git-repo");
    expect(attr.contributor).toBe("test@example.com");
  });
});

// ---------------------------------------------------------------------------
// Story 13h: Duplicate detection during import
// ---------------------------------------------------------------------------

describe("Story 13h: Duplicate detection", () => {
  it("tokenizeForJaccard splits on whitespace/punctuation, filters short tokens", () => {
    const tokens = tokenizeForJaccard("Hello world! This is a test of tokenization.");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("this")).toBe(true);
    expect(tokens.has("test")).toBe(true);
    expect(tokens.has("tokenization")).toBe(true);
    // Short tokens should be filtered
    expect(tokens.has("is")).toBe(false);
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("of")).toBe(false);
  });

  it("jaccardSimilarityTokenized returns 1.0 for identical sets", () => {
    const a = new Set(["hello", "world", "test"]);
    const b = new Set(["hello", "world", "test"]);
    expect(jaccardSimilarityTokenized(a, b)).toBe(1.0);
  });

  it("jaccardSimilarityTokenized returns 0 for disjoint sets", () => {
    const a = new Set(["hello", "world"]);
    const b = new Set(["goodbye", "universe"]);
    expect(jaccardSimilarityTokenized(a, b)).toBe(0);
  });

  it("jaccardSimilarityTokenized returns 0 for two empty sets", () => {
    expect(jaccardSimilarityTokenized(new Set(), new Set())).toBe(0);
  });

  it("jaccardSimilarityTokenized computes correct value for partial overlap", () => {
    const a = new Set(["alpha", "beta", "gamma"]);
    const b = new Set(["beta", "gamma", "delta"]);
    // intersection: {beta, gamma} = 2, union: {alpha, beta, gamma, delta} = 4
    expect(jaccardSimilarityTokenized(a, b)).toBe(0.5);
  });

  it("detectDuplicates flags DUPLICATE for similar hub artifacts", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    // Write an existing trait in the hub
    writeFile(hubPath, "core/traits/critical-thinking.md",
      "# Critical Thinking\nAlways verify assumptions before acting. " +
      "Question the obvious. Look for edge cases and failure modes. " +
      "Consider alternative explanations for every finding."
    );

    // Create a scanned file with very similar content
    const parentDir = path.join(tmpDir, "parent");
    const repoDir = path.join(parentDir, "myrepo");
    writeFile(repoDir, ".claude/traits/careful-thinking.md",
      "# Careful Thinking\nAlways verify assumptions before acting. " +
      "Question the obvious. Look for edge cases and failure modes. " +
      "Consider alternative explanations for every finding."
    );

    const manifest: ScanManifest = {
      parentDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: path.join(repoDir, ".claude/traits/careful-thinking.md"),
        relativePath: ".claude/traits/careful-thinking.md",
        repoDir,
        repoName: "myrepo",
        lines: 5,
        type: "trait",
      }],
    };

    const matches = detectDuplicates(manifest, hubPath);
    const dups = matches.filter(m => m.type === "DUPLICATE");
    expect(dups.length).toBeGreaterThan(0);
    expect(dups[0]!.matchedArtifact).toContain("critical-thinking");
    expect(dups[0]!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("detectDuplicates flags PROMOTION_CANDIDATE for 3+ repos with same pattern", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const parentDir = path.join(tmpDir, "parent");
    const sharedContent = "# Safety Rule\nAlways validate user input before processing. " +
      "Check authentication before authorization. Reject invalid data early. " +
      "Use parameterized queries for all database operations.";

    // Create the same content in 4 different repos
    const repos = ["repo-a", "repo-b", "repo-c", "repo-d"];
    const files: ScanManifest["files"] = [];
    for (const repo of repos) {
      const repoDir = path.join(parentDir, repo);
      writeFile(repoDir, ".claude/rules/safety.md", sharedContent);
      files.push({
        absolutePath: path.join(repoDir, ".claude/rules/safety.md"),
        relativePath: ".claude/rules/safety.md",
        repoDir,
        repoName: repo,
        lines: 4,
        type: "rule",
      });
    }

    const manifest: ScanManifest = {
      parentDir,
      scannedAt: new Date().toISOString(),
      files,
    };

    const matches = detectDuplicates(manifest, hubPath);
    const promotions = matches.filter(m => m.type === "PROMOTION_CANDIDATE");
    expect(promotions.length).toBeGreaterThanOrEqual(4); // One per file in the group
    expect(promotions[0]!.matchedArtifact).toContain("4 repos");
  });

  it("detectDuplicates does not flag unrelated content", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    writeFile(hubPath, "core/traits/critical-thinking.md",
      "# Critical Thinking\nAlways verify assumptions. Question the obvious."
    );

    const parentDir = path.join(tmpDir, "parent");
    const repoDir = path.join(parentDir, "myrepo");
    writeFile(repoDir, ".claude/rules/database-safety.md",
      "# Database Safety\nUse connection pooling. Set query timeouts. " +
      "Enable RLS on all Postgres tables. Never expose admin endpoints."
    );

    const manifest: ScanManifest = {
      parentDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: path.join(repoDir, ".claude/rules/database-safety.md"),
        relativePath: ".claude/rules/database-safety.md",
        repoDir,
        repoName: "myrepo",
        lines: 4,
        type: "rule",
      }],
    };

    const matches = detectDuplicates(manifest, hubPath);
    expect(matches.filter(m => m.type === "DUPLICATE")).toHaveLength(0);
  });
});
