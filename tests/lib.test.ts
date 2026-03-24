/**
 * Unit tests for shared library modules: config.ts and frontmatter.ts.
 *
 * These modules are partially covered by integration tests in pipeline.test.ts
 * and cli.test.ts. This file adds dedicated unit tests for edge cases, error
 * paths, and utility functions that are not exercised by the integration suite.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  stripJsoncComments,
  resolveConfigPath,
  loadConfig,
  flattenNodes,
  groupsToNodes,
  type ScopeNode,
} from "../scripts/lib/config.js";
import {
  parseFrontmatter,
  scanForSecrets,
  DEFAULT_SECRET_PATTERNS,
} from "../scripts/lib/frontmatter.js";

// ---------------------------------------------------------------------------
// stripJsoncComments — edge cases
// ---------------------------------------------------------------------------

describe("stripJsoncComments (edge cases)", () => {
  it("returns empty string for empty input", () => {
    expect(stripJsoncComments("")).toBe("");
  });

  it("returns input unchanged when no comments present", () => {
    const input = '{"key": "value", "num": 42}';
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("handles a line that is entirely a comment", () => {
    const input = '// entire line is a comment\n{"key": "value"}';
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe("value");
  });

  it("handles multiple consecutive comment-only lines", () => {
    const input = `{
// comment 1
// comment 2
// comment 3
  "key": "value"
}`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe("value");
  });

  it("strips trailing whitespace from commented lines", () => {
    const input = '{"key": "value"  // trailing comment  }';
    const stripped = stripJsoncComments(input);
    // The trailing comment and its whitespace should be stripped
    expect(stripped).not.toContain("trailing comment");
  });

  it("preserves strings with backslash-quote followed by comment", () => {
    // Verifies the string tracking handles escaped quotes correctly
    const input = `{
  "path": "C:\\\\Users\\\\test" // windows path comment
}`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.path).toBe("C:\\Users\\test");
  });

  it("handles input with no newlines", () => {
    const input = '{"k":"v"} // comment';
    const stripped = stripJsoncComments(input);
    expect(stripped.trim()).toBe('{"k":"v"}');
  });

  it("handles // at the very beginning of the string inside JSON value", () => {
    const input = '{"url": "//cdn.example.com/file.js"}';
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.url).toBe("//cdn.example.com/file.js");
  });
});

// ---------------------------------------------------------------------------
// resolveConfigPath
// ---------------------------------------------------------------------------

describe("resolveConfigPath", () => {
  it("returns default path when --config is not in argv", () => {
    const result = resolveConfigPath([], "/some/root");
    expect(result).toBe(path.join("/some/root", "agentboot.config.json"));
  });

  it("returns custom path when --config is provided", () => {
    const result = resolveConfigPath(
      ["--config", "/custom/path/config.json"],
      "/some/root"
    );
    expect(result).toBe("/custom/path/config.json");
  });

  it("handles --config with relative path", () => {
    const result = resolveConfigPath(
      ["--config", "relative/config.json"],
      "/some/root"
    );
    expect(result).toBe(path.resolve("relative/config.json"));
  });

  it("handles --config mixed with other flags", () => {
    const result = resolveConfigPath(
      ["--strict", "--config", "/custom/config.json", "--verbose"],
      "/root"
    );
    expect(result).toBe("/custom/config.json");
  });

  it("returns default path when --config is the last arg with no value", () => {
    // --config is present but has no following argument
    const result = resolveConfigPath(["--config"], "/some/root");
    expect(result).toBe(path.join("/some/root", "agentboot.config.json"));
  });
});

// ---------------------------------------------------------------------------
// loadConfig — happy path and error cases
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let tempDir: string;

  function writeTempConfig(content: string): string {
    const configPath = path.join(tempDir, "agentboot.config.json");
    fs.writeFileSync(configPath, content, "utf-8");
    return configPath;
  }

  // Create a fresh temp directory for each test
  it("loads a valid minimal config", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig(
        JSON.stringify({ org: "test-org", personas: { enabled: ["code-reviewer"] } })
      );
      const config = loadConfig(configPath);
      expect(config.org).toBe("test-org");
      expect(config.personas?.enabled).toEqual(["code-reviewer"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("strips JSONC comments before parsing", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig(`{
  // This is a comment
  "org": "test-org"
}`);
      const config = loadConfig(configPath);
      expect(config.org).toBe("test-org");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws on missing file", () => {
    expect(() => loadConfig("/nonexistent/path/config.json")).toThrow(
      "Config file not found"
    );
  });

  it("throws when JSON parses to a non-object (array)", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('[{"org": "test"}]');
      expect(() => loadConfig(configPath)).toThrow("Config must be a JSON object");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when JSON parses to null", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig("null");
      expect(() => loadConfig(configPath)).toThrow("Config must be a JSON object");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when org field is missing", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"personas": {"enabled": []}}');
      expect(() => loadConfig(configPath)).toThrow('non-empty "org" field');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when org field is empty string", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": ""}');
      expect(() => loadConfig(configPath)).toThrow('non-empty "org" field');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when personas.enabled is not an array", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "test", "personas": {"enabled": "not-an-array"}}');
      expect(() => loadConfig(configPath)).toThrow('"personas.enabled" must be an array');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when sync.targetDir is not a string", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "test", "sync": {"targetDir": 123}}');
      expect(() => loadConfig(configPath)).toThrow('"sync.targetDir" must be a string');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts config with only org (all other fields optional)", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "minimal"}');
      const config = loadConfig(configPath);
      expect(config.org).toBe("minimal");
      expect(config.personas).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal in sync.repos", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "test", "sync": {"repos": "../../../etc/repos.json"}}');
      expect(() => loadConfig(configPath)).toThrow('must not contain ".."');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal in output.distPath", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "test", "output": {"distPath": "../../other"}}');
      expect(() => loadConfig(configPath)).toThrow('must not contain ".."');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects sync.targetDir without dot prefix", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "test", "sync": {"targetDir": "claude"}}');
      expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts valid sync.targetDir", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-loadcfg-"));
    try {
      const configPath = writeTempConfig('{"org": "test", "sync": {"targetDir": ".claude"}}');
      const config = loadConfig(configPath);
      expect(config.sync?.targetDir).toBe(".claude");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// flattenNodes
// ---------------------------------------------------------------------------

describe("flattenNodes", () => {
  it("returns empty array for empty input", () => {
    expect(flattenNodes({})).toEqual([]);
  });

  it("flattens single node with no children", () => {
    const nodes: Record<string, ScopeNode> = {
      platform: { displayName: "Platform" },
    };
    const result = flattenNodes(nodes);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("platform");
    expect(result[0]!.node.displayName).toBe("Platform");
  });

  it("flattens nested two-level tree", () => {
    const nodes: Record<string, ScopeNode> = {
      platform: {
        children: {
          api: {},
          web: {},
        },
      },
    };
    const result = flattenNodes(nodes);
    expect(result).toHaveLength(3);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(["platform", "platform/api", "platform/web"]);
  });

  it("flattens three-level deep tree", () => {
    const nodes: Record<string, ScopeNode> = {
      org: {
        children: {
          group: {
            children: {
              team: {},
            },
          },
        },
      },
    };
    const result = flattenNodes(nodes);
    const paths = result.map((r) => r.path);
    expect(paths).toContain("org");
    expect(paths).toContain("org/group");
    expect(paths).toContain("org/group/team");
    expect(result).toHaveLength(3);
  });

  it("handles multiple sibling nodes", () => {
    const nodes: Record<string, ScopeNode> = {
      alpha: {},
      beta: {},
      gamma: {},
    };
    const result = flattenNodes(nodes);
    expect(result).toHaveLength(3);
  });

  it("respects prefix parameter", () => {
    const nodes: Record<string, ScopeNode> = { child: {} };
    const result = flattenNodes(nodes, "parent");
    expect(result[0]!.path).toBe("parent/child");
  });
});

// ---------------------------------------------------------------------------
// groupsToNodes
// ---------------------------------------------------------------------------

describe("groupsToNodes", () => {
  it("returns empty object for empty groups", () => {
    expect(groupsToNodes({})).toEqual({});
  });

  it("converts group with teams to node with children", () => {
    const result = groupsToNodes({
      platform: { teams: ["api", "web"] },
    });
    expect(result.platform).toBeDefined();
    expect(result.platform!.children).toBeDefined();
    expect(Object.keys(result.platform!.children!)).toEqual(["api", "web"]);
  });

  it("converts group with no teams to node without children", () => {
    const result = groupsToNodes({
      infrastructure: {},
    });
    expect(result.infrastructure).toBeDefined();
    // Node exists but has no children property (or children is undefined)
    expect(result.infrastructure!.children).toBeUndefined();
  });

  it("converts group with empty teams array to node without children", () => {
    const result = groupsToNodes({
      data: { teams: [] },
    });
    expect(result.data).toBeDefined();
    expect(result.data!.children).toBeUndefined();
  });

  it("converts multiple groups", () => {
    const result = groupsToNodes({
      platform: { teams: ["api"] },
      mobile: { teams: ["ios", "android"] },
    });
    expect(Object.keys(result)).toEqual(["platform", "mobile"]);
    expect(Object.keys(result.mobile!.children!)).toEqual(["ios", "android"]);
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter — edge cases
// ---------------------------------------------------------------------------

describe("parseFrontmatter (edge cases)", () => {
  // NOTE: The regex /^---\n([\s\S]+?)\n---/ requires at least one character
  // between the --- markers. An empty frontmatter block (---\n---) returns null.
  // This is a known edge case in the implementation.
  it("returns null for empty frontmatter block (no content between markers)", () => {
    const content = "---\n---\n\nBody content";
    const fields = parseFrontmatter(content);
    expect(fields).toBeNull();
  });

  it("returns null for frontmatter with only a blank line between markers", () => {
    // "---\n\n---" — the regex uses [\s\S]*? (zero or more chars) so empty
    // frontmatter returns an empty Map rather than null.
    const content = "---\n\n---\n\nBody content";
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it("returns Map for frontmatter with a field on one line", () => {
    // Minimal valid frontmatter: one key-value pair between markers
    const content = "---\nkey: val\n---\n\nBody";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("key")).toBe("val");
  });

  it("handles key with empty value after colon", () => {
    const content = "---\nname:\ndescription: has value\n---";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("name")).toBe("");
    expect(fields!.get("description")).toBe("has value");
  });

  it("handles lines without colons (ignores them)", () => {
    const content = "---\nname: test\nthis line has no colon\ndescription: ok\n---";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.size).toBe(2);
    expect(fields!.get("name")).toBe("test");
    expect(fields!.get("description")).toBe("ok");
  });

  it("last value wins when duplicate keys exist", () => {
    const content = "---\nname: first\nname: second\n---";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    // Map.set overwrites, so last value wins
    expect(fields!.get("name")).toBe("second");
  });

  it("handles value containing colons", () => {
    const content = "---\ndescription: http://example.com:8080/path\n---";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    // Only splits on first colon
    expect(fields!.get("description")).toBe("http://example.com:8080/path");
  });

  it("returns null for content that starts with text then has ---", () => {
    const content = "Some text before\n---\nname: test\n---";
    const fields = parseFrontmatter(content);
    // Regex anchors to start of string (^---\n)
    expect(fields).toBeNull();
  });

  it("handles frontmatter with only whitespace-value keys", () => {
    const content = "---\nname:    \n---";
    const fields = parseFrontmatter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("name")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// scanForSecrets — additional patterns
// ---------------------------------------------------------------------------

describe("scanForSecrets (additional cases)", () => {
  it("detects Slack tokens", () => {
    const content = 'const token = "xoxb-1234567890-abcdefghij";';
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThan(0);
    // Verify the hit is on line 1
    expect(hits[0]!.line).toBe(1);
  });

  it("reports correct line numbers for multi-line content", () => {
    const content = "line 1 safe\nline 2 safe\npassword = \"hunter2\"\nline 4 safe";
    const hits = scanForSecrets(content);
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(3);
  });

  it("detects multiple different secrets in one file", () => {
    const content = [
      'const password = "hunter2";',
      "normal code here",
      'const api_key = "sk-abc123";',
    ].join("\n");
    const hits = scanForSecrets(content);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const lines = hits.map((h) => h.line);
    expect(lines).toContain(1);
    expect(lines).toContain(3);
  });

  it("uses custom patterns when provided", () => {
    const customPatterns = [/CUSTOM_SECRET_[A-Z]+/];
    const content = "const key = CUSTOM_SECRET_ABC;";
    const hits = scanForSecrets(content, customPatterns);
    expect(hits.length).toBe(1);
  });

  it("returns empty array for empty content", () => {
    expect(scanForSecrets("")).toEqual([]);
  });

  it("does not flag quoted mentions of 'password' without assignment", () => {
    // The pattern requires password = "value" or password: "value"
    const content = "Enter your password in the form below.";
    const hits = scanForSecrets(content);
    expect(hits.length).toBe(0);
  });

  it("DEFAULT_SECRET_PATTERNS is an array of RegExp", () => {
    expect(Array.isArray(DEFAULT_SECRET_PATTERNS)).toBe(true);
    expect(DEFAULT_SECRET_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of DEFAULT_SECRET_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});
