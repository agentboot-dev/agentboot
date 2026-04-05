#!/usr/bin/env node

/**
 * AgentBoot MCP Server (AB-140)
 *
 * A lightweight JSON-RPC 2.0 over stdio server implementing the Model Context
 * Protocol (MCP). Exposes AgentBoot persona, trait, and gotcha data as MCP tools,
 * enabling any MCP-compatible client to access organizational knowledge.
 *
 * No external MCP SDK dependency — implements the protocol directly.
 *
 * Usage:
 *   npx tsx scripts/mcp-server.ts
 *   agentboot mcp-server
 */

import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { stripJsoncComments, type PersonaConfig } from "./lib/config.js";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DIST_SKILL_CORE = path.join(ROOT, "dist", "skill", "core");
const CORE_PERSONAS = path.join(ROOT, "core", "personas");
const CORE_TRAITS = path.join(ROOT, "core", "traits");
const CORE_GOTCHAS = path.join(ROOT, "core", "gotchas");

// ---------------------------------------------------------------------------
// MCP Protocol Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = "agentboot";
const SERVER_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const PROTOCOL_VERSION = "2024-11-05";

// ---------------------------------------------------------------------------
// Data Access Layer
// ---------------------------------------------------------------------------

/** Check whether compiled dist exists. */
function hasCompiledDist(): boolean {
  return fs.existsSync(DIST_SKILL_CORE);
}

/** List persona directories from dist or core. */
function listPersonaDirs(): string[] {
  const baseDir = hasCompiledDist() ? DIST_SKILL_CORE : CORE_PERSONAS;
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir).filter((entry) => {
    const fullPath = path.join(baseDir, entry);
    return fs.statSync(fullPath).isDirectory() && entry !== "gotchas" && entry !== "instructions";
  });
}

/**
 * Validate that a resolved path stays within the expected base directory.
 * Prevents path traversal attacks via names like "../../.env".
 */
function isContainedIn(resolved: string, baseDir: string): boolean {
  const normalizedBase = path.resolve(baseDir) + path.sep;
  return path.resolve(resolved).startsWith(normalizedBase);
}

/** Load persona config from dist or core. */
function loadPersonaConfig(name: string): PersonaConfig | null {
  // Reject path traversal characters
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;

  const distPath = path.join(DIST_SKILL_CORE, name, "persona.config.json");
  const corePath = path.join(CORE_PERSONAS, name, "persona.config.json");

  const configPath = hasCompiledDist() && fs.existsSync(distPath) ? distPath : corePath;
  if (!isContainedIn(configPath, hasCompiledDist() ? DIST_SKILL_CORE : CORE_PERSONAS)) return null;
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as PersonaConfig;
  } catch {
    return null;
  }
}

/** Load persona SKILL.md content. */
function loadPersonaSkill(name: string): string | null {
  // Reject path traversal characters
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;

  const distPath = path.join(DIST_SKILL_CORE, name, "SKILL.md");
  const corePath = path.join(CORE_PERSONAS, name, "SKILL.md");

  const skillPath = hasCompiledDist() && fs.existsSync(distPath) ? distPath : corePath;
  if (!isContainedIn(skillPath, hasCompiledDist() ? DIST_SKILL_CORE : CORE_PERSONAS)) return null;
  if (!fs.existsSync(skillPath)) return null;

  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch {
    return null;
  }
}

/** List trait files from core/traits/. */
function listTraitFiles(): string[] {
  if (!fs.existsSync(CORE_TRAITS)) return [];
  return fs.readdirSync(CORE_TRAITS).filter((f) => f.endsWith(".md"));
}

/** Load trait content by name (without .md extension). */
function loadTraitContent(name: string): string | null {
  // Reject path traversal characters
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;

  const traitPath = path.join(CORE_TRAITS, `${name}.md`);
  if (!isContainedIn(traitPath, CORE_TRAITS)) return null;
  if (!fs.existsSync(traitPath)) return null;

  try {
    return fs.readFileSync(traitPath, "utf-8");
  } catch {
    return null;
  }
}

/** List gotcha files from core/gotchas/. */
function listGotchaFiles(): Array<{ name: string; description: string; paths: string[] }> {
  if (!fs.existsSync(CORE_GOTCHAS)) return [];
  const files = fs.readdirSync(CORE_GOTCHAS).filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );

  return files.map((f) => {
    const content = fs.readFileSync(path.join(CORE_GOTCHAS, f), "utf-8");
    const frontmatter = parseFrontmatter(content);
    return {
      name: f.replace(/\.md$/, ""),
      description: (frontmatter["description"] as string) ?? "",
      paths: Array.isArray(frontmatter["paths"])
        ? frontmatter["paths"] as string[]
        : typeof frontmatter["paths"] === "string"
          ? [frontmatter["paths"]]
          : [],
    };
  });
}

/** Parse YAML-like frontmatter (simple key-value extraction). */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, unknown> = {};
  const lines = match[1]!.split("\n");
  let currentKey = "";

  for (const line of lines) {
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      const value = kvMatch[2]!.trim();
      if (value === "") {
        // Could be a list starting on the next line
        currentKey = key;
        result[key] = [];
      } else {
        result[key] = value.replace(/^["']|["']$/g, "");
        currentKey = "";
      }
    } else if (currentKey && line.match(/^\s+-\s+/)) {
      const listItem = line.replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "").trim();
      (result[currentKey] as string[]).push(listItem);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "agentboot_list_personas",
    description:
      "List all available AgentBoot personas with their names, descriptions, and invocation commands.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_get_persona",
    description:
      "Get the full SKILL.md content for a specific persona by name (e.g., 'code-reviewer').",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The persona directory name (e.g., 'code-reviewer', 'security-reviewer')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "agentboot_list_traits",
    description: "List all available AgentBoot traits with their IDs.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_get_trait",
    description:
      "Get the full content of a trait by name (e.g., 'critical-thinking').",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The trait name without .md extension (e.g., 'critical-thinking')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "agentboot_list_gotchas",
    description:
      "List all gotcha rules with their descriptions and path patterns.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

export function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  switch (toolName) {
    case "agentboot_list_personas": {
      const dirs = listPersonaDirs();
      const personas = dirs.map((dir) => {
        const config = loadPersonaConfig(dir);
        return {
          id: dir,
          name: config?.name ?? dir,
          description: config?.description ?? "",
          invocation: config?.invocation ?? `/${dir}`,
        };
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ personas, source: hasCompiledDist() ? "dist" : "core" }, null, 2),
          },
        ],
      };
    }

    case "agentboot_get_persona": {
      const name = args["name"] as string;
      if (!name) {
        return {
          content: [{ type: "text", text: "Error: 'name' argument is required" }],
          isError: true,
        };
      }
      const skill = loadPersonaSkill(name);
      if (!skill) {
        return {
          content: [{ type: "text", text: `Error: persona '${name}' not found` }],
          isError: true,
        };
      }
      const config = loadPersonaConfig(name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                name: config?.name ?? name,
                description: config?.description ?? "",
                invocation: config?.invocation ?? `/${name}`,
                skill_content: skill,
                source: hasCompiledDist() ? "dist" : "core",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "agentboot_list_traits": {
      const files = listTraitFiles();
      const traits = files.map((f) => ({
        id: f.replace(/\.md$/, ""),
        file: f,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ traits }, null, 2) }],
      };
    }

    case "agentboot_get_trait": {
      const name = args["name"] as string;
      if (!name) {
        return {
          content: [{ type: "text", text: "Error: 'name' argument is required" }],
          isError: true,
        };
      }
      const content = loadTraitContent(name);
      if (!content) {
        return {
          content: [{ type: "text", text: `Error: trait '${name}' not found` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: name, content }, null, 2),
          },
        ],
      };
    }

    case "agentboot_list_gotchas": {
      const gotchas = listGotchaFiles();
      return {
        content: [{ type: "text", text: JSON.stringify({ gotchas }, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Error: unknown tool '${toolName}'` }],
        isError: true,
      };
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 / MCP Message Handling
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function makeResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function handleMessage(request: JsonRpcRequest): JsonRpcResponse | null {
  const { id, method, params } = request;

  switch (method) {
    // MCP lifecycle
    case "initialize":
      return makeResponse(id ?? null, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });

    case "notifications/initialized":
      // No response needed for notifications
      return null;

    // Tool discovery
    case "tools/list":
      return makeResponse(id ?? null, { tools: TOOLS });

    // Tool invocation
    case "tools/call": {
      const toolName = params?.["name"] as string;
      const toolArgs = (params?.["arguments"] ?? {}) as Record<string, unknown>;

      if (!toolName) {
        return makeError(id ?? null, -32602, "Missing tool name");
      }

      const tool = TOOLS.find((t) => t.name === toolName);
      if (!tool) {
        return makeError(id ?? null, -32602, `Unknown tool: ${toolName}`);
      }

      const result = handleToolCall(toolName, toolArgs);
      return makeResponse(id ?? null, result);
    }

    // Ping
    case "ping":
      return makeResponse(id ?? null, {});

    default:
      return makeError(id ?? null, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Stdio Transport
// ---------------------------------------------------------------------------

function startStdioServer(): void {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  const MAX_MESSAGE_SIZE = 1_048_576; // 1MB limit per message

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Reject oversized messages to prevent memory exhaustion
    if (trimmed.length > MAX_MESSAGE_SIZE) {
      const errResp = makeError(null, -32600, "Message exceeds maximum size");
      process.stdout.write(JSON.stringify(errResp) + "\n");
      return;
    }

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      const error = makeError(null, -32700, "Parse error");
      process.stdout.write(JSON.stringify(error) + "\n");
      return;
    }

    if (request.jsonrpc !== "2.0") {
      const error = makeError(request.id ?? null, -32600, "Invalid JSON-RPC version");
      process.stdout.write(JSON.stringify(error) + "\n");
      return;
    }

    const response = handleMessage(request);
    if (response !== null) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Only start the server when run directly (not when imported for testing)
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
  startStdioServer();
}
