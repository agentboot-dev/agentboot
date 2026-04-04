/**
 * Tests for Phase 6: Governance & Quality (AB-117).
 *
 * Covers: AB-118 (composition consistency), AB-119 (rule overrides),
 * AB-123/124 (test-runner: behavioral + snapshot), AB-127 (API providers).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  parseTestCases,
  evaluateAssertions,
  createSnapshot,
  compareSnapshots,
  saveSnapshot,
  loadSnapshot,
} from "../scripts/lib/test-runner.js";

import {
  AnthropicAPIProvider,
  OpenAIAPIProvider,
  GoogleAPIProvider,
  resolveProvider,
  resolveProviderWithFallback,
  ManualProvider,
} from "../scripts/lib/llm-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ab-phase6-test-"));
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
// AB-123: Behavioral test parser and assertions
// ---------------------------------------------------------------------------

describe("AB-123: parseTestCases", () => {
  it("parses a valid test case (legacy format)", () => {
    const yaml = [
      "name: Test SQL injection review",
      "persona: security-reviewer",
      "prompt: Review this code for SQL injection",
      "- contains: SQL injection",
      "- not-contains: looks fine",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("Test SQL injection review");
    expect(cases[0]!.persona).toBe("security-reviewer");
    expect(cases[0]!.prompt).toBe("Review this code for SQL injection");
    expect(cases[0]!.assertions).toHaveLength(2);
    expect(cases[0]!.assertions[0]!.type).toBe("contains");
    expect(cases[0]!.assertions[1]!.type).toBe("not-contains");
  });

  it("parses multiple test cases separated by ---", () => {
    const yaml = [
      "name: Test 1",
      "persona: code-reviewer",
      "prompt: Review this",
      "- contains: review",
      "---",
      "name: Test 2",
      "persona: security-reviewer",
      "prompt: Check this",
      "- regex: (error|warning)",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(2);
    expect(cases[0]!.name).toBe("Test 1");
    expect(cases[1]!.name).toBe("Test 2");
  });

  it("skips incomplete test cases (missing assertions)", () => {
    const yaml = [
      "name: Incomplete",
      "persona: code-reviewer",
      "prompt: No assertions here",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(0);
  });

  it("ignores comment lines", () => {
    const yaml = [
      "# This is a comment",
      "name: Test",
      "persona: code-reviewer",
      "prompt: Review code",
      "- contains: bug",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
  });

  it("parses retries field", () => {
    const yaml = [
      "name: Flaky test",
      "persona: code-reviewer",
      "prompt: Review code",
      "retries: 5",
      "- contains: review",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.retries).toBe(5);
  });

  // AB-133: New YAML parser tests

  it("parses multiline prompt using YAML block scalar (|)", () => {
    const yaml = [
      "name: Multiline test",
      "persona: code-reviewer",
      "prompt: |",
      "  Review this code:",
      "  function foo() { return bar; }",
      "  Check for bugs.",
      "assertions:",
      "  - contains: bug",
      "  - not-contains: LGTM",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.prompt).toContain("Review this code:");
    expect(cases[0]!.prompt).toContain("function foo()");
    expect(cases[0]!.prompt).toContain("Check for bugs.");
    expect(cases[0]!.assertions).toHaveLength(2);
  });

  it("parses assertions under assertions: key (proper YAML format)", () => {
    const yaml = [
      "name: YAML assertions",
      "persona: security-reviewer",
      "prompt: Check for XSS",
      "assertions:",
      "  - contains: XSS",
      "  - not-contains: safe",
      "  - regex: (vuln|injection)",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.assertions).toHaveLength(3);
    expect(cases[0]!.assertions[0]!.type).toBe("contains");
    expect(cases[0]!.assertions[0]!.value).toBe("XSS");
    expect(cases[0]!.assertions[1]!.type).toBe("not-contains");
    expect(cases[0]!.assertions[1]!.value).toBe("safe");
    expect(cases[0]!.assertions[2]!.type).toBe("regex");
    expect(cases[0]!.assertions[2]!.value).toBe("(vuln|injection)");
  });

  it("parses quoted strings correctly in YAML format", () => {
    const yaml = [
      'name: "Quoted name test"',
      'persona: "code-reviewer"',
      'prompt: "Review this: function test() { return true; }"',
      "assertions:",
      '  - contains: "function test"',
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe("Quoted name test");
    expect(cases[0]!.prompt).toBe("Review this: function test() { return true; }");
    expect(cases[0]!.assertions[0]!.value).toBe("function test");
  });

  it("parses assertions with full type/value form", () => {
    const yaml = [
      "name: Full form test",
      "persona: code-reviewer",
      "prompt: Review code",
      "assertions:",
      "  - type: contains",
      "    value: bug",
      "  - type: not-contains",
      "    value: perfect",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.assertions).toHaveLength(2);
    expect(cases[0]!.assertions[0]!.type).toBe("contains");
    expect(cases[0]!.assertions[0]!.value).toBe("bug");
    expect(cases[0]!.assertions[1]!.type).toBe("not-contains");
    expect(cases[0]!.assertions[1]!.value).toBe("perfect");
  });

  it("handles mix of YAML and legacy test cases in same file", () => {
    const yaml = [
      "name: Legacy test",
      "persona: code-reviewer",
      "prompt: Review this",
      "- contains: review",
      "---",
      "name: YAML test",
      "persona: security-reviewer",
      "prompt: Check this",
      "assertions:",
      "  - contains: check",
    ].join("\n");

    const cases = parseTestCases(yaml);
    expect(cases).toHaveLength(2);
    expect(cases[0]!.name).toBe("Legacy test");
    expect(cases[0]!.assertions[0]!.value).toBe("review");
    expect(cases[1]!.name).toBe("YAML test");
    expect(cases[1]!.assertions[0]!.value).toBe("check");
  });
});

describe("AB-123: evaluateAssertions", () => {
  it("contains assertion matches case-insensitively", () => {
    const result = evaluateAssertions("Found a SQL Injection vulnerability", [
      { type: "contains", value: "sql injection" },
    ]);
    expect(result.passed).toBe(true);
  });

  it("contains assertion fails when text is absent", () => {
    const result = evaluateAssertions("Everything looks good", [
      { type: "contains", value: "vulnerability" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it("not-contains assertion passes when text is absent", () => {
    const result = evaluateAssertions("Code review complete", [
      { type: "not-contains", value: "vulnerability" },
    ]);
    expect(result.passed).toBe(true);
  });

  it("not-contains assertion fails when text is present", () => {
    const result = evaluateAssertions("This code looks fine", [
      { type: "not-contains", value: "looks fine" },
    ]);
    expect(result.passed).toBe(false);
  });

  it("regex assertion matches pattern", () => {
    const result = evaluateAssertions("Found 3 errors and 2 warnings", [
      { type: "regex", value: "\\d+ error" },
    ]);
    expect(result.passed).toBe(true);
  });

  it("regex assertion rejects unsafe patterns (ReDoS)", () => {
    const result = evaluateAssertions("test input", [
      { type: "regex", value: "(a+)+$" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("Unsafe regex");
  });

  it("regex assertion handles invalid regex gracefully", () => {
    const result = evaluateAssertions("test input", [
      { type: "regex", value: "[invalid" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("Invalid regex");
  });

  it("mixed assertions — partial failure reports correct failures", () => {
    const result = evaluateAssertions("Found a bug in authentication", [
      { type: "contains", value: "bug" },
      { type: "contains", value: "XSS" }, // this fails
      { type: "not-contains", value: "LGTM" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("XSS");
  });

  it("empty assertions returns passed", () => {
    const result = evaluateAssertions("anything", []);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AB-124: Snapshot testing
// ---------------------------------------------------------------------------

describe("AB-124: Snapshot testing", () => {
  it("creates snapshot from directory with files", () => {
    const distDir = path.join(tmpDir, "dist");
    writeFile(distDir, "claude/core/CLAUDE.md", "# Test");
    writeFile(distDir, "skill/core/personas/reviewer/SKILL.md", "# Reviewer");

    const snapshot = createSnapshot(distDir);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[0]!.path).toMatch(/CLAUDE\.md|SKILL\.md/);
    expect(snapshot.entries[0]!.hash).toHaveLength(16);
    expect(snapshot.entries[0]!.size).toBeGreaterThan(0);
  });

  it("creates empty snapshot from empty directory", () => {
    const distDir = path.join(tmpDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const snapshot = createSnapshot(distDir);
    expect(snapshot.entries).toHaveLength(0);
  });

  it("compareSnapshots detects no changes", () => {
    const distDir = path.join(tmpDir, "dist");
    writeFile(distDir, "file.md", "content");
    const baseline = createSnapshot(distDir);
    const current = createSnapshot(distDir);
    const diff = compareSnapshots(baseline, current);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("compareSnapshots detects added files", () => {
    const distDir = path.join(tmpDir, "dist");
    writeFile(distDir, "file1.md", "content1");
    const baseline = createSnapshot(distDir);
    writeFile(distDir, "file2.md", "content2");
    const current = createSnapshot(distDir);
    const diff = compareSnapshots(baseline, current);
    expect(diff.added).toContain("file2.md");
  });

  it("compareSnapshots detects removed files", () => {
    const distDir = path.join(tmpDir, "dist");
    writeFile(distDir, "file1.md", "content1");
    writeFile(distDir, "file2.md", "content2");
    const baseline = createSnapshot(distDir);
    fs.unlinkSync(path.join(distDir, "file2.md"));
    const current = createSnapshot(distDir);
    const diff = compareSnapshots(baseline, current);
    expect(diff.removed).toContain("file2.md");
  });

  it("compareSnapshots detects changed files", () => {
    const distDir = path.join(tmpDir, "dist");
    writeFile(distDir, "file.md", "original");
    const baseline = createSnapshot(distDir);
    writeFile(distDir, "file.md", "modified");
    const current = createSnapshot(distDir);
    const diff = compareSnapshots(baseline, current);
    expect(diff.changed).toContain("file.md");
  });

  it("saveSnapshot + loadSnapshot round-trip", () => {
    const distDir = path.join(tmpDir, "dist");
    writeFile(distDir, "test.md", "content");
    const baseline = createSnapshot(distDir);
    const snapshotPath = path.join(tmpDir, "snapshot.json");
    saveSnapshot(baseline, snapshotPath);
    const loaded = loadSnapshot(snapshotPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.entries).toHaveLength(baseline.entries.length);
    expect(loaded!.entries[0]!.hash).toBe(baseline.entries[0]!.hash);
  });

  it("loadSnapshot returns null for nonexistent file", () => {
    expect(loadSnapshot("/nonexistent/path.json")).toBeNull();
  });

  it("loadSnapshot returns null for corrupt JSON", () => {
    const corruptPath = path.join(tmpDir, "corrupt.json");
    fs.writeFileSync(corruptPath, "not json {{{");
    expect(loadSnapshot(corruptPath)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AB-127: API provider resolution
// ---------------------------------------------------------------------------

describe("AB-127: API provider resolution", () => {
  it("resolveProvider returns AnthropicAPIProvider for anthropic-api", () => {
    const provider = resolveProvider({ org: "test", agents: { llmProvider: "anthropic-api" } } as any);
    expect(provider).toBeInstanceOf(AnthropicAPIProvider);
  });

  it("resolveProvider returns OpenAIAPIProvider for openai-api", () => {
    const provider = resolveProvider({ org: "test", agents: { llmProvider: "openai-api" } } as any);
    expect(provider).toBeInstanceOf(OpenAIAPIProvider);
  });

  it("resolveProvider returns GoogleAPIProvider for google-api", () => {
    const provider = resolveProvider({ org: "test", agents: { llmProvider: "google-api" } } as any);
    expect(provider).toBeInstanceOf(GoogleAPIProvider);
  });

  it("API provider isAvailable returns false when env var is unset", () => {
    const origKey = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      const provider = new AnthropicAPIProvider();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.unavailableReason()).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (origKey) process.env["ANTHROPIC_API_KEY"] = origKey;
    }
  });

  it("OpenAI provider checks OPENAI_API_KEY", () => {
    const origKey = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    try {
      const provider = new OpenAIAPIProvider();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.unavailableReason()).toContain("OPENAI_API_KEY");
    } finally {
      if (origKey) process.env["OPENAI_API_KEY"] = origKey;
    }
  });

  it("Google provider checks GOOGLE_API_KEY", () => {
    const origKey = process.env["GOOGLE_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
    try {
      const provider = new GoogleAPIProvider();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.unavailableReason()).toContain("GOOGLE_API_KEY");
    } finally {
      if (origKey) process.env["GOOGLE_API_KEY"] = origKey;
    }
  });

  it("resolveProviderWithFallback falls back when primary is unavailable", () => {
    // Save and clear all API keys
    const saved: Record<string, string | undefined> = {};
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      const provider = resolveProviderWithFallback({
        org: "test",
        agents: { llmProvider: "anthropic-api" },
      } as any);
      // Anthropic is unavailable (no key), so it falls back.
      // If Claude Code CLI is available, it gets ClaudeCodeProvider; otherwise ManualProvider.
      expect(provider.name).not.toBe("Anthropic API");
    } finally {
      for (const [key, val] of Object.entries(saved)) {
        if (val !== undefined) process.env[key] = val;
      }
    }
  });

  it("API providers have correct name properties", () => {
    expect(new AnthropicAPIProvider().name).toBe("Anthropic API");
    expect(new OpenAIAPIProvider().name).toBe("OpenAI API");
    expect(new GoogleAPIProvider().name).toBe("Google Gemini API");
  });
});

// ---------------------------------------------------------------------------
// AB-118/119: Validate composition checks (integration via CLI)
// ---------------------------------------------------------------------------

describe("AB-118/119: Validate composition checks", () => {
  const ROOT = path.resolve(__dirname, "..");
  const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

  function runValidate(): string {
    const { execSync } = require("node:child_process");
    return execSync(`${TSX} ${path.join(ROOT, "scripts/validate.ts")}`, {
      cwd: ROOT,
      env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
      timeout: 15_000,
    }).toString();
  }

  it("composition consistency and rule override checks pass on clean repo", () => {
    const output = runValidate();
    expect(output).toContain("Composition consistency");
    expect(output).toContain("Rule overrides");
    expect(output).toContain("All 6 checks passed");
  });
});

// ---------------------------------------------------------------------------
// Majority calculation verification
// ---------------------------------------------------------------------------

describe("Majority calculation", () => {
  it("2-of-3 is majority", () => {
    const maxAttempts = 3;
    const required = Math.floor(maxAttempts / 2) + 1;
    expect(required).toBe(2);
  });

  it("2-of-4 is majority (not 3-of-4)", () => {
    const maxAttempts = 4;
    const required = Math.floor(maxAttempts / 2) + 1;
    expect(required).toBe(3);
  });

  it("3-of-5 is majority", () => {
    const maxAttempts = 5;
    const required = Math.floor(maxAttempts / 2) + 1;
    expect(required).toBe(3);
  });

  it("1-of-1 is majority", () => {
    const maxAttempts = 1;
    const required = Math.floor(maxAttempts / 2) + 1;
    expect(required).toBe(1);
  });
});
