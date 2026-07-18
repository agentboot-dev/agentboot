/**
 * Tests for the MCP server (AB-140).
 *
 * Tests tool handlers and JSON-RPC message handling directly
 * without launching a subprocess.
 */

import { describe, it, expect } from "vitest";
import { handleToolCall, handleMessage, isContainedIn } from "../scripts/mcp-server.js";

// ---------------------------------------------------------------------------
// Tool handler tests
// ---------------------------------------------------------------------------

describe("MCP tool handlers", () => {
  describe("agentboot_list_personas", () => {
    it("returns a list of personas", () => {
      const result = handleToolCall("agentboot_list_personas", {});
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const data = JSON.parse(result.content[0]!.text);
      expect(data.personas).toBeDefined();
      expect(Array.isArray(data.personas)).toBe(true);
      expect(data.personas.length).toBeGreaterThan(0);

      // Each persona should have id, name, description, invocation
      const persona = data.personas[0];
      expect(persona).toHaveProperty("id");
      expect(persona).toHaveProperty("name");
      expect(persona).toHaveProperty("description");
      expect(persona).toHaveProperty("invocation");
    });

    it("includes code-reviewer persona", () => {
      const result = handleToolCall("agentboot_list_personas", {});
      const data = JSON.parse(result.content[0]!.text);
      const codeReviewer = data.personas.find(
        (p: { id: string }) => p.id === "code-reviewer",
      );
      expect(codeReviewer).toBeDefined();
      expect(codeReviewer.name).toBe("Code Reviewer");
      expect(codeReviewer.invocation).toBe("/review-code");
    });

    it("reports source (dist or core)", () => {
      const result = handleToolCall("agentboot_list_personas", {});
      const data = JSON.parse(result.content[0]!.text);
      expect(["dist", "core"]).toContain(data.source);
    });
  });

  describe("agentboot_get_persona", () => {
    it("returns SKILL.md content for a valid persona", () => {
      const result = handleToolCall("agentboot_get_persona", {
        name: "code-reviewer",
      });
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0]!.text);
      expect(data.name).toBe("Code Reviewer");
      expect(data.skill_content).toBeDefined();
      expect(data.skill_content.length).toBeGreaterThan(0);
    });

    it("returns error for missing persona", () => {
      const result = handleToolCall("agentboot_get_persona", {
        name: "nonexistent-persona",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("not found");
    });

    it("returns error when name is missing", () => {
      const result = handleToolCall("agentboot_get_persona", {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("required");
    });
  });

  describe("agentboot_list_traits", () => {
    it("returns a list of traits", () => {
      const result = handleToolCall("agentboot_list_traits", {});
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0]!.text);
      expect(data.traits).toBeDefined();
      expect(Array.isArray(data.traits)).toBe(true);
      expect(data.traits.length).toBeGreaterThan(0);

      // Should include critical-thinking
      const ct = data.traits.find(
        (t: { id: string }) => t.id === "critical-thinking",
      );
      expect(ct).toBeDefined();
      expect(ct.file).toBe("critical-thinking.md");
    });
  });

  describe("agentboot_get_trait", () => {
    it("returns trait content for a valid trait", () => {
      const result = handleToolCall("agentboot_get_trait", {
        name: "critical-thinking",
      });
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0]!.text);
      expect(data.id).toBe("critical-thinking");
      expect(data.content).toContain("Critical Thinking");
    });

    it("returns error for missing trait", () => {
      const result = handleToolCall("agentboot_get_trait", {
        name: "nonexistent-trait",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("not found");
    });
  });

  describe("agentboot_list_gotchas", () => {
    it("returns gotchas array (may be empty if no gotcha files exist)", () => {
      const result = handleToolCall("agentboot_list_gotchas", {});
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0]!.text);
      expect(data.gotchas).toBeDefined();
      expect(Array.isArray(data.gotchas)).toBe(true);
    });
  });

  // --- Phase 10 read tools ---

  describe("agentboot_status", () => {
    it("returns hub info, personas, and repos", () => {
      const result = handleToolCall("agentboot_status", {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.hub).toBeDefined();
      expect(data.hub.org).toBeDefined();
      expect(data.hub.version).toBeDefined();
      expect(Array.isArray(data.personas)).toBe(true);
      expect(Array.isArray(data.repos)).toBe(true);
    });
  });

  describe("agentboot_list_repos", () => {
    it("returns repos array", () => {
      const result = handleToolCall("agentboot_list_repos", {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(Array.isArray(data.repos)).toBe(true);
    });
  });

  describe("agentboot_cost_estimate", () => {
    it("returns cost table for default params", () => {
      const result = handleToolCall("agentboot_cost_estimate", { model: "sonnet", teamSize: 10 });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.model).toBe("sonnet");
      expect(data.teamSize).toBe(10);
      expect(Array.isArray(data.personas)).toBe(true);
    });

    it("returns error for invalid model", () => {
      const result = handleToolCall("agentboot_cost_estimate", { model: "gpt-9000", teamSize: 5 });
      expect(result.isError).toBe(true);
    });
  });

  // --- Phase 10 execute tools (error path / response shape) ---

  describe("agentboot_validate", () => {
    it("returns passed boolean and checks array", () => {
      const result = handleToolCall("agentboot_validate", {});
      // May pass or fail depending on hub state — just verify response shape
      const data = JSON.parse(result.content[0]!.text);
      expect(typeof data.passed).toBe("boolean");
      expect(Array.isArray(data.checks)).toBe(true);
    });
  });

  describe("agentboot_lint", () => {
    it("returns findings array", () => {
      const result = handleToolCall("agentboot_lint", {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(Array.isArray(data.findings)).toBe(true);
    });
  });

  describe("agentboot_doctor", () => {
    it("returns allClear boolean and issues array", () => {
      const result = handleToolCall("agentboot_doctor", {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(typeof data.allClear).toBe("boolean");
      expect(Array.isArray(data.issues)).toBe(true);
    });
  });

  describe("agentboot_build", () => {
    it("returns build result with filesWritten count", () => {
      const result = handleToolCall("agentboot_build", {});
      // Build may succeed or fail depending on hub state — verify response shape
      const text = result.content[0]!.text;
      const data = JSON.parse(text);
      if (!result.isError) {
        expect(typeof data.filesWritten).toBe("number");
        expect(typeof data.duration_ms).toBe("number");
      } else {
        expect(typeof data.error).toBe("string");
      }
    });
  });

  describe("agentboot_sync", () => {
    it("returns sync result with repos array", () => {
      const result = handleToolCall("agentboot_sync", {});
      const text = result.content[0]!.text;
      const data = JSON.parse(text);
      if (!result.isError) {
        expect(Array.isArray(data.repos)).toBe(true);
        expect(data.repos.length).toBeGreaterThan(0);
        expect(data.repos[0]).toHaveProperty("name");
        expect(data.repos[0]).toHaveProperty("filesWritten");
      } else {
        // Sync may fail if repos.json is empty — that's expected
        expect(typeof data.error).toBe("string");
      }
    });
  });

  describe("agentboot_scan_for_import", () => {
    it("returns error when paths argument is missing", () => {
      const result = handleToolCall("agentboot_scan_for_import", {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("paths");
    });

    it("returns error when paths is empty array", () => {
      const result = handleToolCall("agentboot_scan_for_import", { paths: [] });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("non-empty");
    });

    it("returns scan results for a valid path", () => {
      // Use the project root as a scan target — it has agentic files
      const result = handleToolCall("agentboot_scan_for_import", { paths: [process.cwd()] });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(Array.isArray(data.highConfidence)).toBe(true);
      expect(Array.isArray(data.uncertain)).toBe(true);
    });
  });

  // --- Phase 10 write tool (input validation only — no git operations) ---

  describe("agentboot_propose_change", () => {
    it("returns error when required args are missing", () => {
      const result = handleToolCall("agentboot_propose_change", {});
      expect(result.isError).toBe(true);
    });

    it("returns error when path is not a string", () => {
      const result = handleToolCall("agentboot_propose_change", {
        path: 42,
        content: "content",
        commitMessage: "msg",
        prTitle: "title",
        prBody: "body",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("Invalid argument types");
    });

    it("returns error for path traversal attempt", () => {
      const result = handleToolCall("agentboot_propose_change", {
        path: "../../.ssh/authorized_keys",
        content: "malicious",
        commitMessage: "msg",
        prTitle: "title",
        prBody: "body",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/traversal|outside/i);
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", () => {
      const result = handleToolCall("nonexistent_tool", {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("unknown tool");
    });
  });
});

// ---------------------------------------------------------------------------
// isContainedIn security tests
// ---------------------------------------------------------------------------

describe("isContainedIn (path traversal prevention)", () => {
  const base = "/hub/root";

  it("accepts a path within the base directory", () => {
    expect(isContainedIn("/hub/root/core/traits/foo.md", base)).toBe(true);
  });

  it("accepts a deeply nested path", () => {
    expect(isContainedIn("/hub/root/a/b/c/d.md", base)).toBe(true);
  });

  it("rejects a path traversal via ..", () => {
    expect(isContainedIn("/hub/root/../../../etc/passwd", base)).toBe(false);
  });

  it("rejects a path that shares a prefix but is not a child", () => {
    // /hub/root-malicious should NOT be considered inside /hub/root
    expect(isContainedIn("/hub/root-malicious/file.md", base)).toBe(false);
  });

  it("accepts the base directory itself (equality check)", () => {
    // The base directory itself is considered contained — needed for operations
    // that target the hub root directly (e.g., writing agentboot.config.json)
    expect(isContainedIn(base, base)).toBe(true);
  });

  it("rejects a completely unrelated path", () => {
    expect(isContainedIn("/etc/passwd", base)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC / MCP message handling tests
// ---------------------------------------------------------------------------

describe("MCP message handling", () => {
  it("handles initialize", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });

    expect(response).not.toBeNull();
    expect(response!.id).toBe(1);
    const result = response!.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo).toEqual({
      name: "agentboot",
      version: expect.any(String),
    });
    expect(result.capabilities).toEqual({ tools: {} });
  });

  it("handles notifications/initialized (returns null)", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response).toBeNull();
  });

  it("handles tools/list", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(response).not.toBeNull();
    const result = response!.result as { tools: Array<{ name: string }> };
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThanOrEqual(5);

    const toolNames = result.tools.map((t) => t.name);
    // Original 5 tools
    expect(toolNames).toContain("agentboot_list_personas");
    expect(toolNames).toContain("agentboot_get_persona");
    expect(toolNames).toContain("agentboot_list_traits");
    expect(toolNames).toContain("agentboot_get_trait");
    expect(toolNames).toContain("agentboot_list_gotchas");
    // Phase 10 read tools
    expect(toolNames).toContain("agentboot_status");
    expect(toolNames).toContain("agentboot_list_repos");
    expect(toolNames).toContain("agentboot_cost_estimate");
    expect(toolNames).toContain("agentboot_scan_for_import");
    // Phase 10 execute tools (read-only tier)
    expect(toolNames).toContain("agentboot_validate");
    expect(toolNames).toContain("agentboot_lint");
    expect(toolNames).toContain("agentboot_doctor");
    // B4: mutating tools are HIDDEN in the default read-only profile —
    // maintainer-profile exposure is covered in tests/band-b.test.ts
    expect(toolNames).not.toContain("agentboot_build");
    expect(toolNames).not.toContain("agentboot_sync");
    expect(toolNames).not.toContain("agentboot_propose_change");
  });

  it("handles tools/call", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "agentboot_list_personas",
        arguments: {},
      },
    });

    expect(response).not.toBeNull();
    expect(response!.error).toBeUndefined();
    const result = response!.result as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content).toHaveLength(1);
    const data = JSON.parse(result.content[0]!.text);
    expect(data.personas).toBeDefined();
  });

  it("returns error for unknown method", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "unknown/method",
    });

    expect(response).not.toBeNull();
    expect(response!.error).toBeDefined();
    expect(response!.error!.code).toBe(-32601);
  });

  it("handles ping", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "ping",
    });

    expect(response).not.toBeNull();
    expect(response!.error).toBeUndefined();
    expect(response!.result).toEqual({});
  });

  it("returns error for tools/call with missing name", () => {
    const response = handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {},
    });

    expect(response).not.toBeNull();
    expect(response!.error).toBeDefined();
    expect(response!.error!.code).toBe(-32602);
  });
});
