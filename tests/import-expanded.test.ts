/**
 * Tests for Phase 5 import expansion: whole-file imports, config merges,
 * skill import with agent linking, cross-platform dedup, staging v2, and
 * secret detection.
 *
 * Covers: AB-112, AB-113, AB-114, AB-115
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  processWholeFileImports,
  applyWholeFileImports,
  processConfigMerges,
  applyConfigMerges,
  looksLikeSecret,
  processSkillImports,
  deduplicateCrossPlatform,
  categorizeByStrategy,
  isAgentBootCompiled,
  detectPlatform,
  slugify,
  parseAgentFrontmatter,
  stripFrontmatter,
  extractTraitRefs,
  type CategorizedScan,
  type ScanManifest,
  type WholeFileImport,
  type ConfigMergeEntry,
} from "../scripts/lib/import.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ab-import-test-"));
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
// AB-112: Whole-file imports
// ---------------------------------------------------------------------------

describe("AB-112: processWholeFileImports", () => {
  it("converts an agent file to a persona", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const agentPath = writeFile(repoDir, ".claude/agents/my-reviewer.md", [
      "---",
      "name: My Reviewer",
      "description: Reviews code for quality",
      "---",
      "",
      "You are a senior code reviewer.",
      "<!-- trait: critical-thinking -->",
    ].join("\n"));

    const files: CategorizedScan["wholeFile"] = [{
      absolutePath: agentPath,
      relativePath: ".claude/agents/my-reviewer.md",
      repoDir,
      repoName: "repo",
      lines: 7,
      type: "agent",
    }];

    const imports = processWholeFileImports(files, hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.import_type).toBe("agent");
    expect(imports[0]!.target_path).toBe("core/personas/my-reviewer/SKILL.md");
    expect(imports[0]!.generates).toContain("core/personas/my-reviewer/persona.config.json");
    expect(imports[0]!.persona_config?.traits).toContain("critical-thinking");
    expect(imports[0]!.action).toBe("create");
    expect(imports[0]!.composition_type).toBe("rule");
  });

  it("converts a trait file to core/traits/", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const traitPath = writeFile(repoDir, ".claude/traits/my-trait.md", "# My Trait\nBe thorough.");

    const files: CategorizedScan["wholeFile"] = [{
      absolutePath: traitPath,
      relativePath: ".claude/traits/my-trait.md",
      repoDir,
      repoName: "repo",
      lines: 2,
      type: "trait",
    }];

    const imports = processWholeFileImports(files, hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.import_type).toBe("trait");
    expect(imports[0]!.target_path).toBe("core/traits/my-trait.md");
    expect(imports[0]!.composition_type).toBe("preference");
  });

  it("converts a rule with paths: to a gotcha", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const rulePath = writeFile(repoDir, ".claude/rules/db-safety.md", [
      "---",
      "paths:",
      "  - src/db/**",
      "---",
      "# DB Safety",
      "Never use raw SQL.",
    ].join("\n"));

    const files: CategorizedScan["wholeFile"] = [{
      absolutePath: rulePath,
      relativePath: ".claude/rules/db-safety.md",
      repoDir,
      repoName: "repo",
      lines: 6,
      type: "rule",
    }];

    const imports = processWholeFileImports(files, hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.import_type).toBe("rule");
    expect(imports[0]!.target_path).toBe("core/gotchas/db-safety.md");
    expect(imports[0]!.composition_type).toBe("rule");
  });

  it("detects duplicates against existing hub content", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    // Pre-existing trait
    writeFile(hubPath, "core/traits/existing-trait.md", "# Existing\nAlready here.");

    const repoDir = path.join(tmpDir, "repo");
    const traitPath = writeFile(repoDir, ".claude/traits/existing-trait.md", "# Existing\nDuplicate.");

    const files: CategorizedScan["wholeFile"] = [{
      absolutePath: traitPath,
      relativePath: ".claude/traits/existing-trait.md",
      repoDir,
      repoName: "repo",
      lines: 2,
      type: "trait",
    }];

    const imports = processWholeFileImports(files, hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.action).toBe("skip");
    expect(imports[0]!.duplicate_of).toBe("core/traits/existing-trait.md");
  });

  it("skips skill type files (processed separately)", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const skillPath = writeFile(repoDir, ".claude/skills/test/SKILL.md", "# Test Skill");

    const files: CategorizedScan["wholeFile"] = [{
      absolutePath: skillPath,
      relativePath: ".claude/skills/test/SKILL.md",
      repoDir,
      repoName: "repo",
      lines: 1,
      type: "skill",
    }];

    const imports = processWholeFileImports(files, hubPath);
    expect(imports).toHaveLength(0); // Skills processed by processSkillImports
  });
});

describe("AB-112: applyWholeFileImports", () => {
  it("writes persona files to hub", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const agentPath = writeFile(repoDir, ".claude/agents/test-agent.md", [
      "---",
      "name: Test Agent",
      "description: A test agent",
      "---",
      "",
      "You are a test agent.",
    ].join("\n"));

    const imports: WholeFileImport[] = [{
      source_file: agentPath,
      import_type: "agent",
      target_path: "core/personas/test-agent/SKILL.md",
      generates: ["core/personas/test-agent/persona.config.json"],
      persona_config: {
        name: "test-agent",
        description: "A test agent",
        invocation: "/test-agent",
        traits: [],
      },
      action: "create",
      composition_type: "rule",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify SKILL.md written (body only, no frontmatter)
    const skillContent = fs.readFileSync(
      path.join(hubPath, "core/personas/test-agent/SKILL.md"), "utf-8"
    );
    expect(skillContent).toContain("You are a test agent.");
    expect(skillContent).not.toContain("---");

    // Verify persona.config.json written
    const config = JSON.parse(fs.readFileSync(
      path.join(hubPath, "core/personas/test-agent/persona.config.json"), "utf-8"
    ));
    expect(config.name).toBe("test-agent");
    expect(config.invocation).toBe("/test-agent");
  });

  it("skips duplicates gracefully", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const imports: WholeFileImport[] = [{
      source_file: "/nonexistent",
      import_type: "trait",
      target_path: "core/traits/test.md",
      generates: [],
      action: "skip",
      composition_type: "preference",
      duplicate_of: "core/traits/test.md",
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it("rejects paths that escape hub boundary", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const imports: WholeFileImport[] = [{
      source_file: "/some/file.md",
      import_type: "trait",
      target_path: "../../../etc/passwd",
      generates: [],
      action: "create",
      composition_type: "preference",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("path escapes hub boundary");
  });
});

// ---------------------------------------------------------------------------
// AB-113: Config merges
// ---------------------------------------------------------------------------

describe("AB-113: looksLikeSecret", () => {
  it("detects key name patterns", () => {
    expect(looksLikeSecret("API_KEY", "some-value")).toBe(true);
    expect(looksLikeSecret("AUTH_TOKEN", "abc")).toBe(true);
    expect(looksLikeSecret("PASSWORD", "hunter2")).toBe(true);
    expect(looksLikeSecret("CREDENTIAL", "x")).toBe(true);
    expect(looksLikeSecret("SECRET", "y")).toBe(true);
    expect(looksLikeSecret("my_secret", "")).toBe(true);
    expect(looksLikeSecret("PRIVATE_KEY", "v")).toBe(true);
    expect(looksLikeSecret("SIGNING_KEY", "v")).toBe(true);
  });

  it("allows non-sensitive key names (no false positives on substrings)", () => {
    expect(looksLikeSecret("PORT", "3000")).toBe(false);
    expect(looksLikeSecret("NODE_ENV", "production")).toBe(false);
    expect(looksLikeSecret("LOG_LEVEL", "debug")).toBe(false);
    // "monkey" should NOT match just because it contains "key"
    expect(looksLikeSecret("monkey", "value")).toBe(false);
    // "authenticate_user" should NOT match for "auth" substring
    expect(looksLikeSecret("AUTHENTICATE_USER", "value")).toBe(false);
  });

  it("detects high-entropy base64-like values", () => {
    expect(looksLikeSecret("SOME_VAR", "aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2u")).toBe(true);
  });

  it("allows short strings even if base64-like", () => {
    expect(looksLikeSecret("SOME_VAR", "short")).toBe(false);
  });

  it("allows low-entropy long strings", () => {
    expect(looksLikeSecret("SOME_VAR", "aaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("detects known secret value prefixes", () => {
    expect(looksLikeSecret("SOME_VAR", "sk-ant-abc123xyz456def789")).toBe(true);
    expect(looksLikeSecret("SOME_VAR", "ghp_xxxxxxxxxxxxxxxxxxxx")).toBe(true);
    expect(looksLikeSecret("SOME_VAR", "github_pat_xxxxxxxxxxxx")).toBe(true);
    expect(looksLikeSecret("SOME_VAR", "xoxb-something")).toBe(true);
  });

  it("is case insensitive for key patterns", () => {
    expect(looksLikeSecret("Api_Key", "v")).toBe(true);
    expect(looksLikeSecret("auth_token", "v")).toBe(true);
    expect(looksLikeSecret("MY_PAT", "v")).toBe(true);
  });
});

describe("AB-113: processConfigMerges", () => {
  it("extracts permissions from settings.json", () => {
    const repoDir = path.join(tmpDir, "repo");
    const settingsPath = writeFile(repoDir, ".claude/settings.json", JSON.stringify({
      permissions: {
        allow: ["Bash(npm:*)", "Bash(git:*)"],
        deny: ["Bash(rm:*)"],
      },
    }));

    const files: CategorizedScan["configMerge"] = [{
      absolutePath: settingsPath,
      relativePath: ".claude/settings.json",
      repoDir,
      repoName: "repo",
      lines: 5,
      type: "settings",
    }];

    const entries = processConfigMerges(files);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.merge_type).toBe("permissions");
    expect(entries[0]!.extractions).toHaveLength(2);
    expect(entries[0]!.extractions[0]!.key).toBe("allow");
    expect(entries[0]!.extractions[0]!.values).toEqual(["Bash(npm:*)", "Bash(git:*)"]);
    expect(entries[0]!.extractions[1]!.key).toBe("deny");
  });

  it("skips empty permissions arrays", () => {
    const repoDir = path.join(tmpDir, "repo");
    const settingsPath = writeFile(repoDir, ".claude/settings.json", JSON.stringify({
      permissions: { allow: [], deny: [] },
    }));

    const files: CategorizedScan["configMerge"] = [{
      absolutePath: settingsPath,
      relativePath: ".claude/settings.json",
      repoDir,
      repoName: "repo",
      lines: 3,
      type: "settings",
    }];

    const entries = processConfigMerges(files);
    expect(entries).toHaveLength(0);
  });

  it("extracts MCP servers and warns about secrets", () => {
    const repoDir = path.join(tmpDir, "repo");
    const mcpPath = writeFile(repoDir, ".mcp.json", JSON.stringify({
      mcpServers: {
        "my-server": {
          command: "npx",
          args: ["-y", "my-mcp-server"],
          env: {
            API_KEY: "sk-secret-12345678901234567890",
            PORT: "3000",
          },
        },
      },
    }));

    const files: CategorizedScan["configMerge"] = [{
      absolutePath: mcpPath,
      relativePath: ".mcp.json",
      repoDir,
      repoName: "repo",
      lines: 8,
      type: "mcp",
    }];

    const entries = processConfigMerges(files);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.merge_type).toBe("mcp-servers");
    expect(entries[0]!.warnings.length).toBeGreaterThan(0);
    expect(entries[0]!.warnings[0]).toContain("API_KEY");
    // Servers with detected secrets should default to unconfirmed
    expect(entries[0]!.extractions[0]!.confirmed).toBe(false);
  });

  it("extracts hooks with default confirmed=false", () => {
    const repoDir = path.join(tmpDir, "repo");
    const settingsPath = writeFile(repoDir, ".claude/settings.json", JSON.stringify({
      hooks: {
        PreToolUse: [{ command: "bash", args: ["-c", "echo check"] }],
        PostToolUse: [{ command: "node", args: ["verify.js"] }],
      },
    }));

    const files: CategorizedScan["configMerge"] = [{
      absolutePath: settingsPath,
      relativePath: ".claude/settings.json",
      repoDir,
      repoName: "repo",
      lines: 5,
      type: "settings",
    }];

    const entries = processConfigMerges(files);
    const hookEntry = entries.find(e => e.merge_type === "hooks");
    expect(hookEntry).toBeDefined();
    expect(hookEntry!.extractions).toHaveLength(2);
    // Default NO — security-first
    expect(hookEntry!.extractions.every(e => e.confirmed === false)).toBe(true);
    expect(hookEntry!.warnings.length).toBe(2);
  });

  it("handles corrupt JSON gracefully", () => {
    const repoDir = path.join(tmpDir, "repo");
    const settingsPath = writeFile(repoDir, ".claude/settings.json", "not valid json {{{");

    const files: CategorizedScan["configMerge"] = [{
      absolutePath: settingsPath,
      relativePath: ".claude/settings.json",
      repoDir,
      repoName: "repo",
      lines: 1,
      type: "settings",
    }];

    const entries = processConfigMerges(files);
    expect(entries).toHaveLength(0);
  });
});

describe("AB-113: applyConfigMerges", () => {
  it("merges permissions additively", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const merges: ConfigMergeEntry[] = [{
      source_file: "/some/settings.json",
      merge_type: "permissions",
      target: "claude.permissions",
      extractions: [
        { key: "allow", values: ["Bash(npm:*)"], confirmed: true },
      ],
      warnings: [],
    }];

    const result = applyConfigMerges(merges, hubPath);
    expect(result.applied).toBe(1);

    const config = JSON.parse(fs.readFileSync(
      path.join(hubPath, "agentboot.config.json"), "utf-8"
    ));
    expect(config.claude.permissions.allow).toContain("Bash(npm:*)");
  });

  it("does not overwrite existing MCP servers", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    // Pre-populate config with an existing MCP server
    const configPath = path.join(hubPath, "agentboot.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.claude = { mcpServers: { existing: { command: "old" } } };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const merges: ConfigMergeEntry[] = [{
      source_file: "/some/.mcp.json",
      merge_type: "mcp-servers",
      target: "claude.mcpServers",
      extractions: [
        { key: "existing", data: { command: "new" }, confirmed: true },
        { key: "new-server", data: { command: "npx", args: ["-y", "server"] }, confirmed: true },
      ],
      warnings: [],
    }];

    const result = applyConfigMerges(merges, hubPath);
    expect(result.applied).toBe(1); // only new-server
    expect(result.skipped).toBe(1); // existing skipped

    const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(updated.claude.mcpServers.existing.command).toBe("old"); // preserved
    expect(updated.claude.mcpServers["new-server"]).toBeDefined();
  });

  it("only applies confirmed hooks", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const merges: ConfigMergeEntry[] = [{
      source_file: "/some/settings.json",
      merge_type: "hooks",
      target: "claude.hooks",
      extractions: [
        { key: "PreToolUse", data: { command: "bash", args: ["-c", "echo yes"] }, confirmed: true },
        { key: "PostToolUse", data: { command: "bash", args: ["-c", "echo no"] }, confirmed: false },
      ],
      warnings: [],
    }];

    const result = applyConfigMerges(merges, hubPath);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);

    const config = JSON.parse(fs.readFileSync(
      path.join(hubPath, "agentboot.config.json"), "utf-8"
    ));
    expect(config.claude.hooks.PreToolUse).toHaveLength(1);
    expect(config.claude.hooks.PostToolUse).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AB-114: Skill import with agent linking
// ---------------------------------------------------------------------------

describe("AB-114: processSkillImports", () => {
  it("links skill to imported agent", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const skillPath = writeFile(repoDir, ".claude/skills/review/SKILL.md", [
      "---",
      "name: Review Skill",
      "agent: my-reviewer",
      "---",
      "Review code thoroughly.",
    ].join("\n"));

    const agentImports: WholeFileImport[] = [{
      source_file: "/some/agent.md",
      import_type: "agent",
      target_path: "core/personas/my-reviewer/SKILL.md",
      generates: ["core/personas/my-reviewer/persona.config.json"],
      persona_config: {
        name: "my-reviewer",
        description: "Code reviewer",
        invocation: "/my-reviewer",
        traits: [],
      },
      action: "create",
      composition_type: "rule",
      duplicate_of: null,
      confidence: "high",
    }];

    const skillFiles: CategorizedScan["wholeFile"] = [{
      absolutePath: skillPath,
      relativePath: ".claude/skills/review/SKILL.md",
      repoDir,
      repoName: "repo",
      lines: 5,
      type: "skill",
    }];

    const imports = processSkillImports(skillFiles, agentImports, hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.import_type).toBe("skill");
    // Linked to agent's persona
    expect(imports[0]!.target_path).toBe("core/personas/my-reviewer/SKILL.md");
    expect(imports[0]!.persona_config).toBeUndefined();
  });

  it("creates standalone persona for unlinked skill", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const skillPath = writeFile(repoDir, ".claude/skills/code-fixer/SKILL.md", [
      "---",
      "name: Code Fixer",
      "description: Fixes bugs automatically",
      "---",
      "Fix all the bugs.",
    ].join("\n"));

    const skillFiles: CategorizedScan["wholeFile"] = [{
      absolutePath: skillPath,
      relativePath: ".claude/skills/code-fixer/SKILL.md",
      repoDir,
      repoName: "repo",
      lines: 5,
      type: "skill",
    }];

    const imports = processSkillImports(skillFiles, [], hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.import_type).toBe("skill");
    expect(imports[0]!.target_path).toBe("core/personas/code-fixer/SKILL.md");
    expect(imports[0]!.generates).toContain("core/personas/code-fixer/persona.config.json");
    expect(imports[0]!.persona_config?.name).toBe("code-fixer");
    expect(imports[0]!.confidence).toBe("medium");
  });

  it("detects duplicate against existing persona", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);
    // Pre-existing persona
    fs.mkdirSync(path.join(hubPath, "core/personas/existing-persona"), { recursive: true });
    fs.writeFileSync(
      path.join(hubPath, "core/personas/existing-persona/persona.config.json"),
      JSON.stringify({ name: "existing-persona", description: "Already here" }),
    );

    const repoDir = path.join(tmpDir, "repo");
    const skillPath = writeFile(repoDir, ".claude/skills/existing-persona/SKILL.md", [
      "---",
      "name: Existing Persona",
      "---",
      "Duplicate.",
    ].join("\n"));

    const skillFiles: CategorizedScan["wholeFile"] = [{
      absolutePath: skillPath,
      relativePath: ".claude/skills/existing-persona/SKILL.md",
      repoDir,
      repoName: "repo",
      lines: 4,
      type: "skill",
    }];

    const imports = processSkillImports(skillFiles, [], hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.action).toBe("skip");
    expect(imports[0]!.duplicate_of).toContain("core/personas/existing-persona");
  });

  it("extracts trait references from skill body", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const skillPath = writeFile(repoDir, ".claude/skills/traited/SKILL.md", [
      "---",
      "name: Traited Skill",
      "---",
      "Be careful.",
      "<!-- trait: critical-thinking -->",
      "@.claude/traits/source-citation.md",
    ].join("\n"));

    const skillFiles: CategorizedScan["wholeFile"] = [{
      absolutePath: skillPath,
      relativePath: ".claude/skills/traited/SKILL.md",
      repoDir,
      repoName: "repo",
      lines: 6,
      type: "skill",
    }];

    const imports = processSkillImports(skillFiles, [], hubPath);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.persona_config?.traits).toContain("critical-thinking");
    expect(imports[0]!.persona_config?.traits).toContain("source-citation");
  });
});

// ---------------------------------------------------------------------------
// AB-115: Cross-platform deduplication
// ---------------------------------------------------------------------------

describe("AB-115: detectPlatform", () => {
  it("detects Claude platform", () => {
    expect(detectPlatform(".claude/agents/reviewer.md")).toBe("claude");
    expect(detectPlatform("CLAUDE.md")).toBe("claude");
    expect(detectPlatform(".claude/rules/test.md")).toBe("claude");
  });

  it("detects Cursor platform", () => {
    expect(detectPlatform(".cursorrules")).toBe("cursor");
    expect(detectPlatform(".cursor/rules/test.md")).toBe("cursor");
  });

  it("detects Copilot platform", () => {
    expect(detectPlatform(".github/copilot-instructions.md")).toBe("copilot");
    expect(detectPlatform(".github/prompts/test.prompt.md")).toBe("copilot");
  });

  it("returns unknown for unrecognized paths", () => {
    expect(detectPlatform("README.md")).toBe("unknown");
    expect(detectPlatform("src/main.ts")).toBe("unknown");
  });
});

describe("AB-115: deduplicateCrossPlatform", () => {
  it("deduplicates near-identical cross-platform files", () => {
    const repoDir = path.join(tmpDir, "repo");
    const content = "# Instructions\n\nBe thorough when reviewing code. Check for bugs, security issues, and performance problems. Always explain your reasoning.";

    const claudePath = writeFile(repoDir, "CLAUDE.md", content);
    const cursorPath = writeFile(repoDir, ".cursorrules", content);
    const copilotPath = writeFile(repoDir, ".github/copilot-instructions.md", content);

    const files: ScanManifest["files"] = [
      { absolutePath: claudePath, relativePath: "CLAUDE.md", repoDir, repoName: "repo", lines: 3, type: "claude-md" },
      { absolutePath: cursorPath, relativePath: ".cursorrules", repoDir, repoName: "repo", lines: 3, type: "cursorrules" },
      { absolutePath: copilotPath, relativePath: ".github/copilot-instructions.md", repoDir, repoName: "repo", lines: 3, type: "copilot-instructions" },
    ];

    const { filtered, dedup } = deduplicateCrossPlatform(files);
    // Claude has highest priority, should keep only Claude
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.relativePath).toBe("CLAUDE.md");
    expect(dedup.deduplicated_count).toBe(2);
    expect(dedup.cross_platform_overlaps).toHaveLength(1);
    expect(dedup.cross_platform_overlaps[0]!.primary.platform).toBe("claude");
  });

  it("does not dedup files within the same platform", () => {
    const repoDir = path.join(tmpDir, "repo");
    const content = "# Same content\nReused across files.";

    const path1 = writeFile(repoDir, ".claude/rules/rule1.md", content);
    const path2 = writeFile(repoDir, ".claude/rules/rule2.md", content);

    const files: ScanManifest["files"] = [
      { absolutePath: path1, relativePath: ".claude/rules/rule1.md", repoDir, repoName: "repo", lines: 2, type: "rule" },
      { absolutePath: path2, relativePath: ".claude/rules/rule2.md", repoDir, repoName: "repo", lines: 2, type: "rule" },
    ];

    const { filtered, dedup } = deduplicateCrossPlatform(files);
    expect(filtered).toHaveLength(2); // Both kept
    expect(dedup.deduplicated_count).toBe(0);
  });

  it("does not dedup distinct content across platforms", () => {
    const repoDir = path.join(tmpDir, "repo");

    const claudePath = writeFile(repoDir, "CLAUDE.md", "# Claude specific\nUse structured output. Follow coding standards. Review carefully.");
    const cursorPath = writeFile(repoDir, ".cursorrules", "# Cursor specific\nCompletely different content about linting and formatting rules.");

    const files: ScanManifest["files"] = [
      { absolutePath: claudePath, relativePath: "CLAUDE.md", repoDir, repoName: "repo", lines: 2, type: "claude-md" },
      { absolutePath: cursorPath, relativePath: ".cursorrules", repoDir, repoName: "repo", lines: 2, type: "cursorrules" },
    ];

    const { filtered, dedup } = deduplicateCrossPlatform(files);
    expect(filtered).toHaveLength(2); // Both kept (distinct content)
    expect(dedup.deduplicated_count).toBe(0);
  });

  it("handles single file (no dedup needed)", () => {
    const repoDir = path.join(tmpDir, "repo");
    const p = writeFile(repoDir, "CLAUDE.md", "# Single file");

    const files: ScanManifest["files"] = [
      { absolutePath: p, relativePath: "CLAUDE.md", repoDir, repoName: "repo", lines: 1, type: "claude-md" },
    ];

    const { filtered, dedup } = deduplicateCrossPlatform(files);
    expect(filtered).toHaveLength(1);
    expect(dedup.deduplicated_count).toBe(0);
  });

  it("prefers claude over cursor over copilot as primary", () => {
    const repoDir = path.join(tmpDir, "repo");
    const content = "# Shared instructions\nAlways review code carefully. Check for bugs and security issues. Use structured output format.";

    // Only cursor and copilot — cursor should be primary
    const cursorPath = writeFile(repoDir, ".cursorrules", content);
    const copilotPath = writeFile(repoDir, ".github/copilot-instructions.md", content);

    const files: ScanManifest["files"] = [
      { absolutePath: cursorPath, relativePath: ".cursorrules", repoDir, repoName: "repo", lines: 2, type: "cursorrules" },
      { absolutePath: copilotPath, relativePath: ".github/copilot-instructions.md", repoDir, repoName: "repo", lines: 2, type: "copilot-instructions" },
    ];

    const { filtered, dedup } = deduplicateCrossPlatform(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.relativePath).toBe(".cursorrules");
    expect(dedup.cross_platform_overlaps[0]!.primary.platform).toBe("cursor");
  });
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

describe("Helper functions", () => {
  it("slugify creates valid slugs", () => {
    expect(slugify("My Reviewer")).toBe("my-reviewer");
    expect(slugify("Test_Agent_v2")).toBe("test-agent-v2");
    expect(slugify("  spaces  ")).toBe("spaces");
    expect(slugify("UPPERCASE")).toBe("uppercase");
  });

  it("parseAgentFrontmatter extracts fields", () => {
    const content = "---\nname: Test\ndescription: A test\nmodel: sonnet\n---\nBody";
    const fm = parseAgentFrontmatter(content);
    expect(fm["name"]).toBe("Test");
    expect(fm["description"]).toBe("A test");
    expect(fm["model"]).toBe("sonnet");
  });

  it("parseAgentFrontmatter handles no frontmatter", () => {
    const fm = parseAgentFrontmatter("Just body content");
    expect(Object.keys(fm)).toHaveLength(0);
  });

  it("stripFrontmatter removes YAML frontmatter", () => {
    const content = "---\nname: Test\n---\n\nBody content here.";
    expect(stripFrontmatter(content)).toBe("Body content here.");
  });

  it("stripFrontmatter returns content as-is without frontmatter", () => {
    expect(stripFrontmatter("No frontmatter here")).toBe("No frontmatter here");
  });

  it("extractTraitRefs finds comment-style refs", () => {
    const content = "<!-- trait: critical-thinking -->\n<!-- trait: source-citation -->";
    expect(extractTraitRefs(content)).toContain("critical-thinking");
    expect(extractTraitRefs(content)).toContain("source-citation");
  });

  it("extractTraitRefs finds @import refs", () => {
    const content = "@.claude/traits/audit-trail.md\n@traits/schema-awareness.md";
    const refs = extractTraitRefs(content);
    expect(refs).toContain("audit-trail");
    expect(refs).toContain("schema-awareness");
  });

  it("extractTraitRefs deduplicates", () => {
    const content = "<!-- trait: x -->\n<!-- trait: x -->";
    expect(extractTraitRefs(content)).toEqual(["x"]);
  });
});

// ---------------------------------------------------------------------------
// Provenance and categorization (AB-112 pre-requisites, already implemented)
// ---------------------------------------------------------------------------

describe("isAgentBootCompiled", () => {
  it("detects AgentBoot provenance header", () => {
    const filePath = writeFile(tmpDir, "compiled.md", "<!-- AgentBoot compiled output -->\n# Content");
    expect(isAgentBootCompiled(filePath)).toBe(true);
  });

  it("returns false for non-compiled files", () => {
    const filePath = writeFile(tmpDir, "normal.md", "# Just a normal file");
    expect(isAgentBootCompiled(filePath)).toBe(false);
  });

  it("returns false for nonexistent files", () => {
    expect(isAgentBootCompiled("/nonexistent/path.md")).toBe(false);
  });

  it("detects header within first 500 bytes", () => {
    const padding = "x".repeat(400);
    const filePath = writeFile(tmpDir, "padded.md", padding + "<!-- AgentBoot compiled output -->");
    expect(isAgentBootCompiled(filePath)).toBe(true);
  });

  it("misses header beyond 500 bytes", () => {
    const padding = "x".repeat(501);
    const filePath = writeFile(tmpDir, "far.md", padding + "<!-- AgentBoot compiled output -->");
    expect(isAgentBootCompiled(filePath)).toBe(false);
  });
});

describe("categorizeByStrategy", () => {
  it("routes agents to wholeFile", () => {
    const repoDir = path.join(tmpDir, "repo");
    const agentPath = writeFile(repoDir, ".claude/agents/test.md", "# Agent");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: agentPath,
        relativePath: ".claude/agents/test.md",
        repoDir,
        repoName: "repo",
        lines: 1,
        type: "agent",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.wholeFile).toHaveLength(1);
    expect(cat.llmClassify).toHaveLength(0);
  });

  it("routes traits to wholeFile", () => {
    const repoDir = path.join(tmpDir, "repo");
    const traitPath = writeFile(repoDir, ".claude/traits/test.md", "# Trait");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: traitPath,
        relativePath: ".claude/traits/test.md",
        repoDir,
        repoName: "repo",
        lines: 1,
        type: "trait",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.wholeFile).toHaveLength(1);
  });

  it("routes rules with paths: to wholeFile", () => {
    const repoDir = path.join(tmpDir, "repo");
    const rulePath = writeFile(repoDir, ".claude/rules/test.md", "---\npaths:\n  - src/**\n---\n# Rule");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: rulePath,
        relativePath: ".claude/rules/test.md",
        repoDir,
        repoName: "repo",
        lines: 5,
        type: "rule",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.wholeFile).toHaveLength(1);
  });

  it("routes rules without paths: to llmClassify", () => {
    const repoDir = path.join(tmpDir, "repo");
    const rulePath = writeFile(repoDir, ".claude/rules/general.md", "# General Rule\nDo good things.");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: rulePath,
        relativePath: ".claude/rules/general.md",
        repoDir,
        repoName: "repo",
        lines: 2,
        type: "rule",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.llmClassify).toHaveLength(1);
  });

  it("routes settings to configMerge", () => {
    const repoDir = path.join(tmpDir, "repo");
    const settingsPath = writeFile(repoDir, ".claude/settings.json", "{}");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: settingsPath,
        relativePath: ".claude/settings.json",
        repoDir,
        repoName: "repo",
        lines: 1,
        type: "settings",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.configMerge).toHaveLength(1);
  });

  it("routes .mcp.json to configMerge", () => {
    const repoDir = path.join(tmpDir, "repo");
    const mcpPath = writeFile(repoDir, ".mcp.json", "{}");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: mcpPath,
        relativePath: ".mcp.json",
        repoDir,
        repoName: "repo",
        lines: 1,
        type: "mcp",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.configMerge).toHaveLength(1);
  });

  it("routes CLAUDE.md to llmClassify", () => {
    const repoDir = path.join(tmpDir, "repo");
    const claudePath = writeFile(repoDir, "CLAUDE.md", "# Instructions");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: claudePath,
        relativePath: "CLAUDE.md",
        repoDir,
        repoName: "repo",
        lines: 1,
        type: "claude-md",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.llmClassify).toHaveLength(1);
  });

  it("skips AgentBoot-compiled files", () => {
    const repoDir = path.join(tmpDir, "repo");
    const compiledPath = writeFile(repoDir, ".claude/agents/compiled.md",
      "<!-- AgentBoot compiled output -->\n# Compiled content");

    const manifest: ScanManifest = {
      parentDir: tmpDir,
      scannedAt: new Date().toISOString(),
      files: [{
        absolutePath: compiledPath,
        relativePath: ".claude/agents/compiled.md",
        repoDir,
        repoName: "repo",
        lines: 2,
        type: "agent",
      }],
    };

    const cat = categorizeByStrategy(manifest);
    expect(cat.skipped).toHaveLength(1);
    expect(cat.wholeFile).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Security fix tests
// ---------------------------------------------------------------------------

describe("Security: applyWholeFileImports hardening", () => {
  it("rejects generates paths that escape hub boundary", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const agentPath = writeFile(repoDir, ".claude/agents/evil.md", "---\nname: Evil\n---\nMalicious.");

    const imports: WholeFileImport[] = [{
      source_file: agentPath,
      import_type: "agent",
      target_path: "core/personas/evil/SKILL.md",
      generates: ["../../../etc/cron.d/evil"], // path traversal via generates
      persona_config: {
        name: "evil",
        description: "Malicious",
        invocation: "/evil",
        traits: [],
      },
      action: "create",
      composition_type: "rule",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("path escapes hub boundary");
    expect(result.created).toBe(0);
  });

  it("rejects generates paths outside allowed directories", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const agentPath = writeFile(repoDir, ".claude/agents/sneaky.md", "---\nname: Sneaky\n---\nBody.");

    const imports: WholeFileImport[] = [{
      source_file: agentPath,
      import_type: "agent",
      target_path: "core/personas/sneaky/SKILL.md",
      generates: ["scripts/cli.ts"], // valid hub path but not in allowed dirs
      persona_config: {
        name: "sneaky",
        description: "Sneaky",
        invocation: "/sneaky",
        traits: [],
      },
      action: "create",
      composition_type: "rule",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("not in allowed directory");
  });

  it("rejects target_path outside allowed directories", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const traitPath = writeFile(repoDir, ".claude/traits/test.md", "# Trait");

    const imports: WholeFileImport[] = [{
      source_file: traitPath,
      import_type: "trait",
      target_path: "scripts/evil.ts",
      generates: [],
      action: "create",
      composition_type: "preference",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("not in allowed directory");
  });

  it("rejects source_file not in trusted sources", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    writeFile(repoDir, ".claude/traits/test.md", "# Trait");

    const trusted = new Set(["/some/other/file.md"]); // source_file not in set

    const imports: WholeFileImport[] = [{
      source_file: path.join(repoDir, ".claude/traits/test.md"),
      import_type: "trait",
      target_path: "core/traits/test.md",
      generates: [],
      action: "create",
      composition_type: "preference",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath, trusted);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("not in original scan");
  });

  it("rejects symlinks as source files", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    const repoDir = path.join(tmpDir, "repo");
    const realFile = writeFile(repoDir, "real.md", "# Real file content");
    const symlinkPath = path.join(repoDir, "symlink.md");
    fs.symlinkSync(realFile, symlinkPath);

    const imports: WholeFileImport[] = [{
      source_file: symlinkPath,
      import_type: "trait",
      target_path: "core/traits/symlink.md",
      generates: [],
      action: "create",
      composition_type: "preference",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("symlink");
  });

  it("linked skill appends to existing SKILL.md instead of overwriting", () => {
    const hubPath = path.join(tmpDir, "hub");
    scaffoldHub(hubPath);

    // Pre-existing agent SKILL.md
    writeFile(hubPath, "core/personas/my-agent/SKILL.md", "Agent content here.");

    const repoDir = path.join(tmpDir, "repo");
    const skillPath = writeFile(repoDir, ".claude/skills/extra/SKILL.md", [
      "---",
      "name: Extra Skill",
      "---",
      "Extra skill content.",
    ].join("\n"));

    const imports: WholeFileImport[] = [{
      source_file: skillPath,
      import_type: "skill",
      target_path: "core/personas/my-agent/SKILL.md",
      generates: [],
      action: "create",
      composition_type: "rule",
      duplicate_of: null,
      confidence: "high",
    }];

    const result = applyWholeFileImports(imports, hubPath);
    expect(result.created).toBe(1);

    const content = fs.readFileSync(
      path.join(hubPath, "core/personas/my-agent/SKILL.md"), "utf-8"
    );
    // Should contain BOTH the original and the appended content
    expect(content).toContain("Agent content here.");
    expect(content).toContain("Extra skill content.");
  });
});

describe("Security: MCP servers with secrets default to unconfirmed", () => {
  it("sets confirmed=false for MCP servers with detected secrets", () => {
    const repoDir = path.join(tmpDir, "repo");
    const mcpPath = writeFile(repoDir, ".mcp.json", JSON.stringify({
      mcpServers: {
        "safe-server": {
          command: "npx",
          env: { PORT: "3000", NODE_ENV: "dev" },
        },
        "secret-server": {
          command: "npx",
          env: { API_KEY: "sk-verysecretkey1234567890" },
        },
      },
    }));

    const files: CategorizedScan["configMerge"] = [{
      absolutePath: mcpPath,
      relativePath: ".mcp.json",
      repoDir,
      repoName: "repo",
      lines: 10,
      type: "mcp",
    }];

    const entries = processConfigMerges(files);
    expect(entries).toHaveLength(1);
    const safeExtraction = entries[0]!.extractions.find(e => e.key === "safe-server");
    const secretExtraction = entries[0]!.extractions.find(e => e.key === "secret-server");
    expect(safeExtraction!.confirmed).toBe(true);
    expect(secretExtraction!.confirmed).toBe(false);
  });
});
