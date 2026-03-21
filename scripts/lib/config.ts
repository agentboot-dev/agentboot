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
    extend?: string;
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
  };
  sync?: {
    repos?: string;
    targetDir?: string;
    writePersonasIndex?: boolean;
    dryRun?: boolean;
  };
  validation?: {
    secretPatterns?: string[];
    strictMode?: boolean;
  };
}

export interface GroupConfig {
  label?: string;
  teams?: string[];
}

export interface PersonaConfig {
  name: string;
  description: string;
  invocation?: string;
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
  return JSON.parse(stripped) as AgentBootConfig;
}
