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
    /** Disable the ability to bypass permissions */
    disableBypassPermissions?: boolean;
  };
}

/** A trait weight value: named string, numeric 0.0–1.0, or boolean. */
export type TraitWeightValue = string | number | boolean;

/** Trait refs: array (all MEDIUM) or object with per-trait weights. */
export type TraitRefs = string[] | Record<string, TraitWeightValue>;

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
  traits?: TraitRefs;
  groups?: Record<string, { traits?: TraitRefs }>;
  teams?: Record<string, { traits?: TraitRefs }>;
  /** Per-persona hook configuration */
  hooks?: Record<string, unknown>;
  /** Per-persona MCP servers */
  mcpServers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AB-134: Trait weight system
// ---------------------------------------------------------------------------

/** Named weight constants. */
export const WEIGHT_MAP: Record<string, number> = {
  "OFF": 0.0,
  "LOW": 0.3,
  "MEDIUM": 0.5,
  "HIGH": 0.7,
  "MAX": 1.0,
};

/** Default weight when none is specified. */
export const DEFAULT_WEIGHT = 0.5;

/** Valid named weight strings (case-insensitive). */
export const VALID_WEIGHT_NAMES = new Set(Object.keys(WEIGHT_MAP));

/** A resolved trait with name and numeric weight. */
export interface ResolvedTrait {
  name: string;
  weight: number;
}

/**
 * Resolve a weight value to a number in [0.0, 1.0].
 *
 * - `false` / `0` / `"OFF"` → 0.0
 * - `true` / `undefined` → DEFAULT_WEIGHT (0.5)
 * - number → clamped to [0.0, 1.0]
 * - named string (case-insensitive) → looked up in WEIGHT_MAP
 * - unknown string → DEFAULT_WEIGHT
 */
export function resolveWeight(val: TraitWeightValue | undefined): number {
  if (val === false || val === 0 || val === "OFF") return 0.0;
  if (val === true || val === undefined) return DEFAULT_WEIGHT;
  if (typeof val === "number") return Math.min(1.0, Math.max(0.0, val));
  return WEIGHT_MAP[val.toUpperCase()] ?? DEFAULT_WEIGHT;
}

/**
 * Normalize trait refs (array or object) into resolved trait list.
 * Array form: all traits get DEFAULT_WEIGHT.
 * Object form: each trait gets its specified weight.
 */
export function normalizeTraitRefs(refs: TraitRefs): ResolvedTrait[] {
  if (Array.isArray(refs)) {
    return refs.map(name => ({ name, weight: DEFAULT_WEIGHT }));
  }
  return Object.entries(refs).map(([name, val]) => ({
    name,
    weight: resolveWeight(val),
  }));
}

/**
 * Extract trait names from refs (array or object), for use in contexts
 * that only need the name list.
 */
export function traitRefsToNames(refs: TraitRefs): string[] {
  if (Array.isArray(refs)) return refs;
  return Object.keys(refs);
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
 * Strip single-line // comments and block comments from a JSONC string,
 * respecting string literals. Tracks whether we are inside a quoted string
 * (handling escaped quotes) before deciding to strip comments.
 * Comment content is replaced with spaces to preserve character positions
 * for error messages.
 */
export function stripJsoncComments(raw: string): string {
  let inString = false;
  let inBlockComment = false;
  let i = 0;
  let out = "";

  while (i < raw.length) {
    const ch = raw[i]!;
    const next = i + 1 < raw.length ? raw[i + 1] : "";

    if (inBlockComment) {
      // Look for end of block comment
      if (ch === "*" && next === "/") {
        out += "  "; // replace */ with spaces
        i += 2;
        inBlockComment = false;
      } else {
        // Preserve newlines, replace other chars with space
        out += ch === "\n" ? "\n" : " ";
        i++;
      }
    } else if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        i++;
        out += raw[i]!;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
    } else {
      if (ch === '"') {
        inString = true;
        out += ch;
        i++;
      } else if (ch === "/" && next === "/") {
        // Single-line comment: replace rest of line with spaces
        i += 2;
        while (i < raw.length && raw[i] !== "\n") {
          i++;
        }
      } else if (ch === "/" && next === "*") {
        out += "  "; // replace /* with spaces
        i += 2;
        inBlockComment = true;
      } else {
        out += ch;
        i++;
      }
    }
  }

  // Trim trailing whitespace from each line to match previous behavior
  return out.split("\n").map(line => line.trimEnd()).join("\n");
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

// ---------------------------------------------------------------------------
// AB-131: CC Plugin Manifest Validation
// ---------------------------------------------------------------------------

export interface PluginValidationWarning {
  field: string;
  message: string;
  level: "error" | "warn";
}

/** Check if a value contains path traversal (..) segments. */
function hasPathTraversal(val: unknown): boolean {
  if (typeof val !== "string") return false;
  return val.split("/").includes("..");
}

/**
 * Validate a plugin.json manifest against the CC plugin spec.
 * Returns an array of warnings/errors. Non-blocking — callers decide whether to proceed.
 */
export function validatePluginManifest(manifest: Record<string, unknown>): PluginValidationWarning[] {
  const warnings: PluginValidationWarning[] = [];

  // name: required, must be string, must follow @scope/package-name format
  if (manifest["name"] === undefined || manifest["name"] === null) {
    warnings.push({ field: "name", message: "name is required", level: "error" });
  } else if (typeof manifest["name"] !== "string") {
    warnings.push({ field: "name", message: "name must be a string", level: "error" });
  } else if (!/^@[a-z0-9-]+\/[a-z0-9._-]+$/.test(manifest["name"])) {
    warnings.push({ field: "name", message: `name must follow @scope/package-name format, got "${manifest["name"]}"`, level: "error" });
  }

  // version: required
  if (manifest["version"] === undefined || manifest["version"] === null) {
    warnings.push({ field: "version", message: "version is required", level: "error" });
  } else if (typeof manifest["version"] !== "string") {
    warnings.push({ field: "version", message: "version must be a string", level: "error" });
  }

  // description: required
  if (manifest["description"] === undefined || manifest["description"] === null) {
    warnings.push({ field: "description", message: "description is required", level: "error" });
  } else if (typeof manifest["description"] !== "string") {
    warnings.push({ field: "description", message: "description must be a string", level: "error" });
  }

  // Warn if agents, skills, or rules arrays are empty
  for (const arrayField of ["agents", "skills", "rules"] as const) {
    const val = manifest[arrayField];
    if (Array.isArray(val) && val.length === 0) {
      warnings.push({ field: arrayField, message: `${arrayField} array is empty`, level: "warn" });
    }
  }

  // Check for path traversal in array entries with path-like fields
  for (const arrayField of ["agents", "skills", "rules", "hooks"] as const) {
    const val = manifest[arrayField];
    if (Array.isArray(val)) {
      for (let idx = 0; idx < val.length; idx++) {
        const entry = val[idx];
        if (typeof entry === "object" && entry !== null) {
          for (const [key, v] of Object.entries(entry as Record<string, unknown>)) {
            if (hasPathTraversal(v)) {
              warnings.push({
                field: `${arrayField}[${idx}].${key}`,
                message: `path contains ".." traversal segment`,
                level: "error",
              });
            }
          }
        }
      }
    }
  }

  return warnings;
}
