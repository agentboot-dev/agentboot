/**
 * Security-focused tests for config loading and validation.
 *
 * These tests exercise the path traversal rejection, targetDir validation,
 * and type-safety checks in loadConfig that protect against malicious or
 * malformed configuration files.
 *
 * Complements lib.test.ts (which covers happy-path and basic error cases)
 * with adversarial inputs specifically targeting security boundaries.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, stripJsoncComments } from "../scripts/lib/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempConfig(content: string, fn: (configPath: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sec-"));
  const configPath = path.join(tempDir, "agentboot.config.json");
  try {
    fs.writeFileSync(configPath, content, "utf-8");
    fn(configPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// loadConfig — path traversal rejection
// ---------------------------------------------------------------------------

describe("loadConfig: path traversal rejection", () => {
  it("rejects sync.repos containing '..'", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { repos: "../../etc/passwd" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow(
          '"sync.repos" must not contain ".." path segments'
        );
      }
    );
  });

  it("rejects output.distPath containing '..'", () => {
    withTempConfig(
      JSON.stringify({ org: "test", output: { distPath: "../../../tmp/evil" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow(
          '"output.distPath" must not contain ".." path segments'
        );
      }
    );
  });

  it("rejects personas.customDir containing '..'", () => {
    withTempConfig(
      JSON.stringify({ org: "test", personas: { customDir: "foo/../bar" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow(
          '"personas.customDir" must not contain ".." path segments'
        );
      }
    );
  });

  it("accepts path fields without '..'", () => {
    withTempConfig(
      JSON.stringify({
        org: "test",
        sync: { repos: "./repos.json" },
        output: { distPath: "./dist" },
        personas: { customDir: "./custom-personas" },
      }),
      (configPath) => {
        const config = loadConfig(configPath);
        expect(config.org).toBe("test");
        expect(config.sync?.repos).toBe("./repos.json");
        expect(config.output?.distPath).toBe("./dist");
        expect(config.personas?.customDir).toBe("./custom-personas");
      }
    );
  });

  it("allows '..' embedded in a filename (not a path traversal)", () => {
    // "repos..json" is not a traversal — only standalone ".." path segments are rejected.
    withTempConfig(
      JSON.stringify({ org: "test", sync: { repos: "repos..json" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).not.toThrow();
      }
    );
  });
});

// ---------------------------------------------------------------------------
// loadConfig — sync.targetDir validation
// ---------------------------------------------------------------------------

describe("loadConfig: sync.targetDir validation", () => {
  it("accepts '.claude' as targetDir", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".claude" } }),
      (configPath) => {
        const config = loadConfig(configPath);
        expect(config.sync?.targetDir).toBe(".claude");
      }
    );
  });

  it("accepts '.cursor' as targetDir", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".cursor" } }),
      (configPath) => {
        const config = loadConfig(configPath);
        expect(config.sync?.targetDir).toBe(".cursor");
      }
    );
  });

  it("accepts '.agentboot' as targetDir", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".agentboot" } }),
      (configPath) => {
        const config = loadConfig(configPath);
        expect(config.sync?.targetDir).toBe(".agentboot");
      }
    );
  });

  it("accepts '.my-custom_dir123' as targetDir (alphanumeric, hyphen, underscore)", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".my-custom_dir123" } }),
      (configPath) => {
        const config = loadConfig(configPath);
        expect(config.sync?.targetDir).toBe(".my-custom_dir123");
      }
    );
  });

  it("rejects targetDir without leading dot", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: "claude" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });

  it("rejects targetDir with path separator '/'", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".claude/sub" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });

  it("rejects targetDir that is just a dot '.'", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: "." } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });

  it("rejects targetDir '..' (double dot)", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".." } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });

  it("rejects targetDir with spaces", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".my dir" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });

  it("rejects empty string targetDir", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: "" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });

  it("rejects targetDir starting with dot but second char is digit (.1dir)", () => {
    // Regex requires ^\.[a-z] — second char must be a letter
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: ".1dir" } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("dot-prefixed directory name");
      }
    );
  });
});

// ---------------------------------------------------------------------------
// loadConfig — type safety for critical fields
// ---------------------------------------------------------------------------

describe("loadConfig: type safety", () => {
  it("throws when org is a number", () => {
    withTempConfig(
      JSON.stringify({ org: 42 }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow('non-empty "org" field');
      }
    );
  });

  it("throws when org is a boolean", () => {
    withTempConfig(
      JSON.stringify({ org: true }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow('non-empty "org" field');
      }
    );
  });

  it("throws when org is null", () => {
    withTempConfig(
      JSON.stringify({ org: null }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow('non-empty "org" field');
      }
    );
  });

  it("throws when config is a JSON array (with correct error message)", () => {
    // Arrays pass typeof check but are caught by Array.isArray
    withTempConfig(
      '[{"org": "test"}]',
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("Config must be a JSON object");
      }
    );
  });

  it("throws when config is a JSON primitive (string)", () => {
    withTempConfig(
      '"just a string"',
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("Config must be a JSON object");
      }
    );
  });

  it("throws when config is a JSON primitive (number)", () => {
    withTempConfig(
      "42",
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow("Config must be a JSON object");
      }
    );
  });

  it("throws on invalid JSON syntax with a parse error", () => {
    withTempConfig(
      '{"org": "test",}',  // trailing comma — invalid JSON
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow();
      }
    );
  });

  it("throws when sync.targetDir is a number", () => {
    withTempConfig(
      JSON.stringify({ org: "test", sync: { targetDir: 123 } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow('"sync.targetDir" must be a string');
      }
    );
  });

  it("throws when personas.enabled is an object instead of array", () => {
    withTempConfig(
      JSON.stringify({ org: "test", personas: { enabled: { "code-reviewer": true } } }),
      (configPath) => {
        expect(() => loadConfig(configPath)).toThrow('"personas.enabled" must be an array');
      }
    );
  });
});

// ---------------------------------------------------------------------------
// loadConfig — accepts fully populated config
// ---------------------------------------------------------------------------

describe("loadConfig: full config acceptance", () => {
  it("accepts config with all optional sections populated", () => {
    withTempConfig(
      JSON.stringify({
        org: "test-org",
        orgDisplayName: "Test Organization",
        groups: {
          platform: { teams: ["api", "web"] },
        },
        personas: {
          enabled: ["code-reviewer"],
          customDir: "./custom",
          outputFormats: ["skill", "claude", "copilot"],
        },
        traits: {
          enabled: ["critical-thinking"],
        },
        instructions: {
          enabled: ["baseline.instructions"],
        },
        output: {
          distPath: "./dist",
          provenanceHeaders: true,
          failOnDirtyDist: false,
          tokenBudget: { warnAt: 8000 },
        },
        sync: {
          repos: "./repos.json",
          targetDir: ".claude",
          writePersonasIndex: true,
          dryRun: false,
          pr: {
            enabled: false,
            branchPrefix: "agentboot/sync-",
            titleTemplate: "chore: AgentBoot sync",
          },
        },
        claude: {
          hooks: {},
          permissions: { allow: ["Read"], deny: [] },
          mcpServers: {},
        },
        privacy: {
          tier: "organizational",
          rawPrompts: false,
          escalationEnabled: true,
        },
        telemetry: {
          enabled: true,
          includeDevId: "hashed",
          includeContent: false,
        },
        validation: {
          secretPatterns: ["CUSTOM_[A-Z]+"],
          strictMode: false,
        },
      }),
      (configPath) => {
        const config = loadConfig(configPath);
        expect(config.org).toBe("test-org");
        expect(config.orgDisplayName).toBe("Test Organization");
        expect(config.groups?.platform?.teams).toEqual(["api", "web"]);
        expect(config.personas?.enabled).toEqual(["code-reviewer"]);
        expect(config.privacy?.tier).toBe("organizational");
        expect(config.telemetry?.includeDevId).toBe("hashed");
        expect(config.sync?.pr?.enabled).toBe(false);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// stripJsoncComments — security-relevant edge cases
// ---------------------------------------------------------------------------

describe("stripJsoncComments: adversarial inputs", () => {
  it("does not strip // inside single-quoted strings (JSON does not use single quotes)", () => {
    // JSON spec only uses double quotes. Single-quoted strings are invalid JSON.
    // But if someone passes JSONC with single quotes, the // should still be stripped
    // because the character is not "inside a string" by JSON rules.
    const input = "{'key': 'val // not a comment'}";
    const stripped = stripJsoncComments(input);
    // The // should be stripped because single quotes don't start strings in JSON
    expect(stripped.trim()).toBe("{'key': 'val");
  });

  it("handles deeply nested escaped quotes before comment", () => {
    const input = '{"a": "b\\"c\\"d"} // comment';
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.a).toBe('b"c"d');
  });

  it("handles line with only //", () => {
    const input = '{\n//\n"key": "val"\n}';
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe("val");
  });

  it("handles extremely long lines without hanging", () => {
    const longValue = "x".repeat(100_000);
    const input = `{"key": "${longValue}"} // comment`;
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe(longValue);
  });

  it("does not treat /// (triple slash) differently from //", () => {
    const input = '{"key": "val"} /// triple slash comment';
    const stripped = stripJsoncComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.key).toBe("val");
  });
});
