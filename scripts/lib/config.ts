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

  // AB-88: N-tier scope model — nodes replace flat groups/teams
  // Legacy groups/teams still supported for backward compat; converted to nodes internally.
  groups?: Record<string, GroupConfig>;
  nodes?: Record<string, ScopeNode>;

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

  // AB-53: Domain layers
  domains?: DomainReference[];

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

  // Agent tools and LLM provider preferences
  agents?: {
    /** Which agent tools the org uses. Drives output format selection. */
    tools?: Array<"claude-code" | "copilot" | "cursor" | "gemini" | string>;
    /** Primary agent tool — used as default when a choice is needed. */
    primary?: string;
    /** LLM provider for AgentBoot's own operations (import classification, etc.). */
    llmProvider?: "claude-code" | "anthropic-api" | "manual" | string;
    /** Model override for API providers. */
    llmModel?: string | null;
    /** Whether the user has acknowledged LLM-powered commands cost money. */
    billingAcknowledged?: boolean;
  };

  // Composition type system (rule/preference scope merging)
  composition?: {
    /** Override default composition type per classification. */
    defaults?: Record<string, "rule" | "preference">;
    /** Override composition type for specific artifact paths. */
    overrides?: Record<string, "rule" | "preference">;
  };

  // AB-62: Three-tier privacy model
  privacy?: PrivacyConfig;

  // AB-65: Telemetry configuration
  telemetry?: TelemetryConfig;

  // AB-61: Managed settings (HARD guardrails for MDM)
  managed?: ManagedConfig;

  validation?: {
    secretPatterns?: string[];
    strictMode?: boolean;
  };
}

export interface GroupConfig {
  teams?: string[];
}

// ---------------------------------------------------------------------------
// AB-88: N-tier scope model
// ---------------------------------------------------------------------------

/** A node in the scope tree. Replaces flat groups/teams with arbitrary depth. */
export interface ScopeNode {
  /** Display name for this scope level */
  displayName?: string;
  /** Child nodes (arbitrary depth) */
  children?: Record<string, ScopeNode>;
  /** Personas enabled at this scope (additive to parent) */
  personas?: string[];
  /** Additional traits enabled at this scope */
  traits?: string[];
  /** Override config values at this scope */
  config?: Record<string, unknown>;
}

/**
 * Flatten a nodes tree into scope paths for compilation.
 * Returns array of { path: "platform/api", node } tuples.
 */
export function flattenNodes(
  nodes: Record<string, ScopeNode>,
  prefix = ""
): Array<{ path: string; node: ScopeNode }> {
  const result: Array<{ path: string; node: ScopeNode }> = [];
  for (const [name, node] of Object.entries(nodes)) {
    const nodePath = prefix ? `${prefix}/${name}` : name;
    result.push({ path: nodePath, node });
    if (node.children) {
      result.push(...flattenNodes(node.children, nodePath));
    }
  }
  return result;
}

/**
 * Convert legacy groups/teams config to N-tier nodes.
 * Groups become depth-1 nodes; teams become depth-2 children.
 */
export function groupsToNodes(groups: Record<string, GroupConfig>): Record<string, ScopeNode> {
  const nodes: Record<string, ScopeNode> = {};
  for (const [groupName, group] of Object.entries(groups)) {
    const children: Record<string, ScopeNode> = {};
    for (const team of group.teams ?? []) {
      children[team] = {};
    }
    const node: ScopeNode = {};
    if (Object.keys(children).length > 0) {
      node.children = children;
    }
    nodes[groupName] = node;
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// AB-53: Domain layer references
// ---------------------------------------------------------------------------

export type DomainReference = string | { name: string; version?: string; path?: string };

export interface DomainManifest {
  name: string;
  version: string;
  description?: string;
  traits?: string[];
  personas?: string[];
  instructions?: string[];
  requires_core_version?: string;
}

// ---------------------------------------------------------------------------
// AB-62: Privacy model
// ---------------------------------------------------------------------------

export interface PrivacyConfig {
  /** Three-tier model: private (raw prompts never leave machine),
   *  privileged (LLM analysis via API, developer approves),
   *  organizational (anonymized metrics only). */
  tier?: "private" | "privileged" | "organizational";
  /** Raw prompts are NEVER collected. This is a design invariant. */
  rawPrompts?: false;
  /** Escalation exception for genuinely harmful content (category flag only). */
  escalationEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// AB-65: Telemetry config
// ---------------------------------------------------------------------------

export interface TelemetryConfig {
  enabled?: boolean;
  /** How to identify developers in telemetry.
   *  false = no developer ID, "hashed" = SHA-256 of email, "email" = raw email. */
  includeDevId?: false | "hashed" | "email" | "email-raw";
  /** Path to NDJSON log file. Default: ~/.agentboot/telemetry.ndjson */
  logPath?: string;
  /** Never include raw prompt content in telemetry. Design invariant. */
  includeContent?: false;
}

// ---------------------------------------------------------------------------
// AB-61: Managed settings (MDM distribution)
// ---------------------------------------------------------------------------

export interface ManagedConfig {
  /** Enable managed settings artifact generation */
  enabled?: boolean;
  /** MDM platform target */
  platform?: "jamf" | "intune" | "jumpcloud" | "kandji" | "other";
  /** Custom output path for managed settings */
  outputPath?: string;
  /** HARD guardrails to enforce via managed settings */
  guardrails?: {
    /** Force-install specific plugins */
    forcePlugins?: string[];
    /** Deny these tool patterns */
    denyTools?: string[];
    /** Require audit logging */
    requireAuditLog?: boolean;
  };
}

export interface PersonaConfig {
  name: string;
  description: string;
  invocation?: string;
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
  disallowedTools?: string[];
  tools?: string[];
  effort?: "low" | "medium" | "high" | "max";
  autonomy?: "advisory" | "auto-approve" | "autonomous";
  skills?: string[];
  memory?: "user" | "project" | "local" | null;
  background?: boolean;
  isolation?: "none" | "worktree";
  tokenBudget?: number;
  traits?: string[];
  groups?: Record<string, { traits?: string[] }>;
  teams?: Record<string, { traits?: string[] }>;
  /** Per-persona hook configuration */
  hooks?: Record<string, unknown>;
  /** Per-persona MCP servers */
  mcpServers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AB-64: Telemetry event schema
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  event: "persona_invocation" | "persona_error" | "hook_execution" | "session_summary";
  persona_id: string;
  persona_version?: string;
  model?: string;
  scope?: string;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  tool_calls?: number;
  duration_ms?: number;
  cost_usd?: number;
  findings_count?: {
    CRITICAL?: number;
    ERROR?: number;
    WARN?: number;
    INFO?: number;
  };
  suggestions?: number;
  timestamp: string;
  session_id?: string;
  dev_id?: string;
}

// ---------------------------------------------------------------------------
// AB-57: Plugin manifest
// ---------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  agentboot_version: string;
  personas: Array<{
    id: string;
    name: string;
    description: string;
    model?: string | undefined;
    agent_path: string;
    skill_path: string;
  }>;
  traits: Array<{
    id: string;
    path: string;
  }>;
  hooks?: Array<{
    event: string;
    path: string;
  }> | undefined;
  rules?: Array<{
    path: string;
    description?: string | undefined;
  }> | undefined;
}

// ---------------------------------------------------------------------------
// AB-58: Marketplace manifest
// ---------------------------------------------------------------------------

export interface MarketplaceManifest {
  $schema?: string;
  name: string;
  description: string;
  maintainer: string;
  url?: string;
  entries: MarketplaceEntry[];
}

export interface MarketplaceEntry {
  type: "plugin" | "trait" | "domain" | "persona";
  name: string;
  version: string;
  description: string;
  published_at: string;
  sha256?: string;
  path: string;
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
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

  // Reject path-type fields containing traversal segments
  const pathFields: Array<[string, unknown]> = [
    ["sync.repos", parsed.sync?.repos],
    ["output.distPath", parsed.output?.distPath],
    ["personas.customDir", parsed.personas?.customDir],
    ["telemetry.logPath", parsed.telemetry?.logPath],
    ["managed.outputPath", parsed.managed?.outputPath],
  ];
  for (const [fieldName, value] of pathFields) {
    if (typeof value === "string") {
      // Check for .. path traversal (normalized for both separators)
      const normalized = value.replace(/\\/g, "/");
      if (normalized.split("/").includes("..")) {
        throw new Error(`"${fieldName}" must not contain ".." path segments`);
      }
    }
  }

  // Validate sync.targetDir against safe pattern (must start with . and be a simple name)
  if (parsed.sync?.targetDir !== undefined) {
    if (!/^\.[a-z][a-z0-9_-]*$/i.test(parsed.sync.targetDir)) {
      throw new Error('"sync.targetDir" must be a dot-prefixed directory name (e.g., ".claude")');
    }
  }

  return parsed as AgentBootConfig;
}
