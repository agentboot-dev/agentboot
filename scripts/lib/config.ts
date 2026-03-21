/**
 * Shared configuration types and utilities used by validate, compile, and sync scripts.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBootConfig {
  org: string;
  orgDisplayName?: string;
  groups?: Record<string, GroupConfig>;
  personas?: {
    enabled?: string[];
    customDir?: string;
    outputFormats?: string[];
  };
  traits?: {
    enabled?: string[];
  };
  instructions?: {
    enabled?: string[];
  };
  output?: {
    distPath?: string;
    provenanceHeaders?: boolean;
    failOnDirtyDist?: boolean;
    tokenBudget?: { warnAt?: number };
  };
  sync?: {
    repos?: string;
    targetDir?: string;
    writePersonasIndex?: boolean;
    dryRun?: boolean;
    pr?: {
      enabled?: boolean;
      branchPrefix?: string;
      titleTemplate?: string;
    };
  };
  claude?: {
    hooks?: Record<string, unknown>;
    permissions?: { allow?: string[]; deny?: string[] };
    mcpServers?: Record<string, unknown>;
  };
  validation?: {
    secretPatterns?: string[];
    strictMode?: boolean;
  };
}

export interface GroupConfig {
  teams?: string[];
}

export interface PersonaConfig {
  name: string;
  description: string;
  invocation?: string;
  model?: string;
  permissionMode?: string;
  traits?: string[];
  groups?: Record<string, { traits?: string[] }>;
  teams?: Record<string, { traits?: string[] }>;
}

// ---------------------------------------------------------------------------
// JSONC stripping
// ---------------------------------------------------------------------------

/**
 * Strip single-line // comments from a JSONC string, respecting string literals.
 * Tracks whether we are inside a quoted string (handling escaped quotes) before
 * deciding to truncate a line at a // comment.
 */
export function stripJsoncComments(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    let inString = false;
    let i = 0;
    let out = "";

    while (i < line.length) {
      const ch = line[i]!;

      if (inString) {
        out += ch;
        if (ch === "\\" && i + 1 < line.length) {
          i++;
          out += line[i]!;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
          out += ch;
        } else if (ch === "/" && line[i + 1] === "/") {
          break;
        } else {
          out += ch;
        }
      }
      i++;
    }

    result.push(out.trimEnd());
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export function resolveConfigPath(argv: string[], root: string): string {
  const idx = argv.indexOf("--config");
  if (idx !== -1 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]!);
  }
  return path.join(root, "agentboot.config.json");
}

export function loadConfig(configPath: string): AgentBootConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const stripped = stripJsoncComments(raw);
  const parsed = JSON.parse(stripped);

  // Minimal runtime validation for critical fields
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Config must be a JSON object");
  }
  if (typeof parsed.org !== "string" || parsed.org.length === 0) {
    throw new Error('Config requires a non-empty "org" field (string)');
  }
  if (parsed.personas?.enabled !== undefined && !Array.isArray(parsed.personas.enabled)) {
    throw new Error('"personas.enabled" must be an array of strings');
  }
  if (parsed.sync?.targetDir !== undefined && typeof parsed.sync.targetDir !== "string") {
    throw new Error('"sync.targetDir" must be a string');
  }

  return parsed as AgentBootConfig;
}
