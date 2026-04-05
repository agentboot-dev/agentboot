/**
 * Tests for the MCP server (AB-140).
 *
 * Tests tool handlers and JSON-RPC message handling directly
 * without launching a subprocess.
 */

import { describe, it, expect } from "vitest";
import { handleToolCall, handleMessage } from "../scripts/mcp-server.js";

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

  describe("unknown tool", () => {
    it("returns error for unknown tool name", () => {
      const result = handleToolCall("nonexistent_tool", {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("unknown tool");
    });
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
    expect(result.tools.length).toBe(5);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("agentboot_list_personas");
    expect(toolNames).toContain("agentboot_get_persona");
    expect(toolNames).toContain("agentboot_list_traits");
    expect(toolNames).toContain("agentboot_get_trait");
    expect(toolNames).toContain("agentboot_list_gotchas");
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
