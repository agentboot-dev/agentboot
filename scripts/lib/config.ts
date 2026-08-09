/**
 * Shared configuration types and utilities used by validate, compile, and sync scripts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Output formats — ONE definition, asserted, not eight literals
// ---------------------------------------------------------------------------

/**
 * A5: every output format AgentBoot knows how to emit.
 *
 * This used to be spelled out at two call sites (compile's `validFormats`,
 * sync's `validPlatforms`) that had already drifted from each other. Two lists
 * that must agree will drift; the fix is one list plus an asserted derivation
 * for the places that legitimately differ.
 */
export const VALID_OUTPUT_FORMATS: readonly string[] = [
  "skill", "claude", "copilot", "cursor", "agents",
  "plugin", "windsurf", "gemini", "jetbrains", "codex",
];

/**
 * The formats a hub builds when `personas.outputFormats` is absent.
 *
 * Before this constant there were FOUR different answers to "what is the
 * default?" across eight sites — `["skill","claude","copilot","agents"]`,
 * `["skill","claude","copilot"]`, `["claude"]`, and `[]`. The `[]` variants
 * were the dangerous ones: in `doctor`'s Coverage and Enforcement blocks an
 * unspecified config produced an EMPTY format list, so every capability and
 * enforcement check iterated over nothing and reported clean. A gate that
 * evaluates zero platforms is not a passing gate, it is an absent one.
 *
 * R1-5: `agents` is in the list. Unifying the four answers resolved the drift by
 * silently picking the SHORTEST of them, which dropped `agents` from
 * compilePersona's fallback — where an in-code comment specifically asserted it
 * had to be there ("agents is a first-class official output — the fallback must
 * agree with the install/export defaults, which always include it"). The
 * consequence was not cosmetic: a hub whose config omits
 * `personas.outputFormats` stopped emitting `dist/agents/` entirely, and because
 * sync prunes against the previous manifest, the next sync would then WITHDRAW
 * AGENTS.md artifacts already delivered to spokes. `scaffoldConfig` in
 * install.ts still writes `agents` into every hub it creates, so the two agree
 * again; unification is supposed to remove a contradiction, not resolve it by
 * quietly deleting an output surface.
 */
export const DEFAULT_OUTPUT_FORMATS: readonly string[] = ["skill", "claude", "copilot", "agents"];

/**
 * Formats that can be SYNCED into a spoke repo.
 *
 * `plugin` is deliberately excluded: a Claude Code plugin is installed as a
 * plugin, not copied into a target repository, so `dist/plugin/` is not a sync
 * target. Derived-and-asserted rather than re-typed, so adding a format to
 * `VALID_OUTPUT_FORMATS` cannot silently leave sync behind.
 */
export const SYNCABLE_OUTPUT_FORMATS: readonly string[] =
  VALID_OUTPUT_FORMATS.filter((f) => f !== "plugin");

/**
 * The invariant, checked at module load rather than trusted.
 *
 * A default the build would then reject as unknown is not a hypothetical: it is
 * exactly the shape of the `plugin` fail-open (a name present in one list and
 * absent from its partner). This throws at import time, so it cannot be
 * introduced and shipped.
 */
{
  const unknownDefaults = DEFAULT_OUTPUT_FORMATS.filter((f) => !VALID_OUTPUT_FORMATS.includes(f));
  if (unknownDefaults.length > 0) {
    throw new Error(
      `DEFAULT_OUTPUT_FORMATS contains format(s) missing from VALID_OUTPUT_FORMATS: ${unknownDefaults.join(", ")}`,
    );
  }
  const dupes = VALID_OUTPUT_FORMATS.filter((f, i) => VALID_OUTPUT_FORMATS.indexOf(f) !== i);
  if (dupes.length > 0) {
    throw new Error(`VALID_OUTPUT_FORMATS contains duplicate(s): ${dupes.join(", ")}`);
  }
}

/**
 * H1: output formats whose emitters DEPEND on another format being built.
 *
 * `plugin` is the only one today. The plugin tree is assembled by copying
 * artifacts out of `dist/claude/`, and both `generatePluginOutput` and
 * `generateComplianceHooks` sit inside `if (outputFormats.includes("claude"))`.
 * A `plugin`-only build therefore produced a near-empty `dist/plugin/` and
 * reported `✓ Compiled 4 persona(s) × 1 platform(s)`.
 *
 * ONE declaration of that fact, consumed by three gates that would otherwise
 * each re-state it: the build precondition (compile), the enforcement resolver
 * (PLATFORM_ENFORCEMENT.requires) and the capability table
 * (CAPABILITY_SUPPORT.conditionalOn). Three copies of one dependency is how the
 * `plugin` fail-open happened three separate times.
 */
export const PLATFORM_REQUIRES: Record<string, string[]> = {
  plugin: ["claude"],
};

/**
 * Aliases operators actually type. Historically local to sync.ts, which meant
 * every OTHER consumer of a repos.json platform compared un-normalized strings.
 */
export const PLATFORM_ALIASES: Record<string, string> = {
  "claude-code": "claude",
  "github-copilot": "copilot",
  "openai-codex": "codex",
};

/** Canonical platform ids for a repos.json entry (singular or array form). */
export function resolveRepoPlatforms(entry: { platform?: string; platforms?: string[] }): string[] {
  const raw = entry.platforms && entry.platforms.length > 0
    ? entry.platforms
    : [entry.platform ?? "claude"];
  return raw.map((p) => PLATFORM_ALIASES[p] ?? p);
}

/**
 * A4: platforms that repos.json TARGETS but the hub does not BUILD.
 *
 * `status` printed `Platforms:` and `Repos (N)` four lines apart and never
 * compared them, so the single most common misconfiguration in the product —
 * a repo pointed at a platform that was never added to personas.outputFormats —
 * was displayed, in full, on one screen, to an operator with no reason to
 * cross-reference two lists by eye. sync catches it, but only at ship time and
 * only for the repos it reaches.
 */
export function unbuiltRepoPlatforms(
  repos: Array<{ label?: string; path?: string; platform?: string; platforms?: string[] }>,
  outputFormats: readonly string[],
): Array<{ platform: string; repos: string[] }> {
  const built = new Set(outputFormats.map((f) => PLATFORM_ALIASES[f] ?? f));
  const byPlatform = new Map<string, string[]>();
  for (const entry of repos) {
    for (const p of resolveRepoPlatforms(entry)) {
      if (built.has(p)) continue;
      const label = entry.label ?? entry.path ?? "(unnamed repo)";
      const list = byPlatform.get(p) ?? [];
      if (!list.includes(label)) list.push(label);
      byPlatform.set(p, list);
    }
  }
  return [...byPlatform.entries()]
    .map(([platform, r]) => ({ platform, repos: r }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

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
    /** B11: warnAt (default 8000) warns; failAt (opt-in) FAILS the build when a
     * compiled persona's estimated size exceeds it — the CI gate for prompt-size
     * regressions. Sizes are reported to dist/persona-sizes.json either way. */
    tokenBudget?: { warnAt?: number; failAt?: number };
  };
  sync?: {
    repos?: string;
    targetDir?: string;
    writePersonasIndex?: boolean;
    dryRun?: boolean;
    /**
     * F-1 escape hatch, hub-wide. Regex sources matched against repo-relative
     * POSIX paths. A revoked artifact whose path matches is never unlinked from
     * a spoke, and the resulting unremediated revocation is reported at WARN
     * instead of failing the sync. Set per-repo via `retain` in repos.json for
     * the usual case — ownership is a property of the spoke, not of the hub.
     */
    retain?: string[];
    pr?: {
      enabled?: boolean;
      branchPrefix?: string;
      titleTemplate?: string;
    };
    /** D6: SSH-sign the sync manifest digest (`ssh-keygen -Y sign`). The key
     * path resolves relative to the hub config. A configured-but-failing
     * signer is a sync ERROR — the hub never silently ships unsigned. */
    signing?: {
      enabled?: boolean;
      sshKeyPath?: string;
      /**
       * v0.19.0: also emit a standards-shaped attestation next to the manifest
       * (.agentboot-manifest.intoto.json): an in-toto v1 Statement (subjects =
       * per-file sha256 digests + the manifest digest; predicate = hub
       * provenance) in a DSSE envelope, signed over the DSSE PAE bytes with
       * the same SSH key. Honest posture: this gives policy tooling a standard
       * predicate to consume and binds git context into the predicate, but the
       * signature is SSHSIG (verifiable via `agentboot verify-manifest` /
       * ssh-keygen), NOT a Sigstore bundle — no transparency log, no
       * CI-identity certificate. Sigstore keyless is the documented next step.
       */
      emitInToto?: boolean;
    };
  };
  claude?: {
    hooks?: Record<string, unknown>;
    permissions?: { allow?: string[]; deny?: string[] };
    mcpServers?: Record<string, unknown>;
    /**
     * Arbitrary additional Claude Code settings keys, passed through VERBATIM to
     * the managed output (both dist/managed/managed-settings.json and the
     * managed-settings.d fragments). This is how an org expresses settings that
     * have no dedicated AgentBoot key — enableAllProjectMcpServers,
     * enabledMcpjsonServers, disabledMcpjsonServers, env, cleanupPeriodDays,
     * includeCoAuthoredBy, or any key Claude Code adds later — so an existing
     * hand-written managed settings file can be reproduced 1:1 from hub config.
     * Keys with dedicated config (permissions, hooks, mcpServers) are rejected
     * at validation; use the dedicated key.
     */
    settings?: Record<string, unknown>;
  };

  // User-level (~/.claude) write SPI. AgentBoot is the default provider for this
  // slot. If another tool manages ~/.claude — signalled by a ~/.claude/.managed
  // sentinel — AgentBoot defers to it and stages its output for that tool to apply.
  userLevel?: {
    /**
     * "auto" (default): write ~/.claude directly UNLESS a ~/.claude/.managed
     * sentinel indicates another tool owns the slot, in which case stage for handoff.
     * "direct": always write ~/.claude directly.
     * "manifest": never write ~/.claude; stage the resolved content + a manifest for
     * an external provider to apply.
     */
    mode?: "auto" | "direct" | "manifest";
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

  // AB-143: MCP connection governance
  mcp?: McpGovernanceConfig;

  // Phase 11 B1.5: /ab skill model and tool configuration
  ab?: {
    modelOverrides?: Record<string, string>;
  };

  validation?: {
    secretPatterns?: string[];
    strictMode?: boolean;
  };

  /**
   * B2/B3: Compliance-hook behavior. The bundled regex patterns always run
   * (fast path, fail-safe baseline); an org can additionally plug its own
   * scanner into the same hook chain — a DLP endpoint wrapper, a PHI
   * classifier, anything executable.
   *
   * Scanner contract: receives the content (prompt or response) on stdin;
   * exit 0 = allow, exit 2 = block, any other exit = scanner failure, resolved
   * by failMode ("open" = allow with a warning, "closed" = block; default
   * "open"). Scanner stdout/stderr is surfaced to the developer, never sent
   * anywhere. The command is embedded in the generated hook at build time and
   * must not contain quotes, backticks, $( or newlines (validated).
   */
  compliance?: {
    inputScan?: {
      scannerCommand?: string;
      failMode?: "open" | "closed";
    };
    outputScan?: {
      scannerCommand?: string;
      failMode?: "open" | "closed";
      /** B3: promote the output scan from warn-only to blocking (exit 2 with a
       * redact instruction back to the model). Default false (warn). */
      blocking?: boolean;
    };
  };
}

export interface GroupConfig {
  teams?: string[];
  /** AB-160: Group-level managed settings */
  permissions?: { allow?: string[]; deny?: string[] };
  mcpServers?: Record<string, unknown>;
  enabledPlugins?: Array<{ url: string }>;
}

// ---------------------------------------------------------------------------
// Version-pinned npx spec
// ---------------------------------------------------------------------------

/**
 * The npx package spec for invoking this exact AgentBoot version
 * ("agentboot@X.Y.Z"). All generated artifacts that launch AgentBoot via npx
 * (MCP server entries in .mcp.json / mcp.json / Codex config.toml) must use
 * this — an unpinned "agentboot" spec would execute whatever npm serves as
 * latest, breaking reproducibility and supply-chain review of the generated
 * output. Falls back to the bare name only if package.json cannot be read.
 */
export function agentbootNpxSpec(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"
    );
    const version = (JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string }).version;
    return version ? `agentboot@${version}` : "agentboot";
  } catch {
    return "agentboot";
  }
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
  /**
   * D3: org-configured central telemetry sink. OFF unless the org configures
   * it — AgentBoot ships no default endpoint and never phones home. When set,
   * `agentboot telemetry-ship` spools hash-chained events into signed batches
   * and POSTs them to the ORG'S OWN endpoint; the sink config is compiled into
   * synced artifacts so it is org-managed, not per-developer.
   */
  sink?: TelemetrySinkConfig;
}

export interface TelemetrySinkConfig {
  /** HTTPS collector endpoint owned by the org. https:// only. */
  url: string;
  /**
   * Extra request headers (e.g. auth). A value of the form "$VAR_NAME" is
   * resolved from the shipper's environment at ship time — never commit
   * literal credentials to the hub.
   */
  headers?: Record<string, string>;
  /** Events per shipped batch. Default 100. */
  batchSize?: number;
  /** Spool directory. Default ~/.agentboot/telemetry-spool */
  spoolDir?: string;
  /** Sign batch digests with sync.signing.sshKeyPath (default: true when signing is enabled). */
  sign?: boolean;
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
  /**
   * F-5: scope-merge overrides the operator has reviewed and accepted.
   *
   * When two managed-settings fragments declare the same key with DIFFERENT
   * values, the higher scope wins and the lower value is discarded. On the MDM
   * channel — the non-overridable one — a silently discarded control is a
   * compliance hole with a green build and a signed manifest, so the build
   * fails. Listing the key here says "I know, that override is intended."
   *
   * Keys are top-level managed-settings key names (e.g. "cleanupPeriodDays").
   * `permissions` and `hooks` never appear here: both are UNIONED, so nothing
   * is discarded and there is nothing to acknowledge. `"*"` is rejected — the
   * point is that each accepted loss is enumerated.
   */
  scopeMerge?: { acknowledgedOverrides?: string[] };
  /** HARD guardrails to enforce via managed settings */
  guardrails?: {
    /**
     * NOT IMPLEMENTED. Typed, documented, and read by no code path on any
     * platform — see CAPABILITY_SUPPORT row `managed.guardrails.forcePlugins`,
     * which fails the build when this is set. Kept only so that failure is
     * explicable; implement it or delete it.
     */
    forcePlugins?: string[];
    /** Deny these tool patterns */
    denyTools?: string[];
    /** Require audit logging */
    requireAuditLog?: boolean;
    /** Disable the ability to bypass permissions */
    disableBypassPermissions?: boolean;
  };
}

// ---------------------------------------------------------------------------
// AB-143: MCP connection governance
// ---------------------------------------------------------------------------

export interface McpGovernanceConfig {
  /** Approved MCP servers — only these are allowed in target repos */
  approved?: McpServerEntry[];
  /** If true, reject any MCP servers in target repos not in the approved list */
  enforceApproved?: boolean;
  /** MCP servers that are required in all repos */
  required?: string[];
}

export interface McpServerEntry {
  /** Server name/identifier */
  name: string;
  /**
   * B5 identity pinning: when set, the configured server under this name must
   * use EXACTLY this command — a trusted name may not front a different
   * executable. Without it, approval is name-only (legacy, weaker).
   */
  command?: string;
  /** B5: exact expected argument vector (pin the package spec here, e.g.
   * ["agentboot@0.12.0", "mcp-server"] — this is how a version is pinned). */
  args?: string[];
  /** B5: exact expected URL for remote (sse/http) servers. */
  url?: string;
  /** B5: expected transport ("stdio" | "sse" | "http" | ...). */
  transport?: string;
  /**
   * Environment for a stdio server when AgentBoot spawns it to read tool
   * definitions (mcp-pin / mcp-verify). AgentBoot does NOT hand the spawned
   * server its full environment — a pin probes a possibly-compromised server,
   * so leaking every CI secret to it is an exfil channel. Only PATH/HOME and
   * OS essentials are passed by default; anything the server genuinely needs
   * goes here. Values of the form "$VAR" are expanded from the environment at
   * spawn time (so secrets stay out of the committed config).
   */
  env?: Record<string, string>;
  /** Description of what this server provides */
  description?: string;
  /** Scope: which level this server is approved at */
  scope?: "org" | "group" | "team" | "repo";
  /**
   * v0.19.0 digest pinning: sha256 over the server's canonicalized tool
   * definitions (the full tools/list surface — names, descriptions, input
   * schemas). Version pins alone do not stop a mutable server mutating its
   * tool descriptions under a fixed name (the rug-pull class); the digest
   * does. Record with `agentboot mcp-pin`, check with `agentboot mcp-verify`.
   */
  toolsDigest?: string;
  /** When the toolsDigest was recorded (ISO datetime), for staleness display. */
  toolsDigestRecordedAt?: string;
  /**
   * Provenance of this server reference — where the org got it and what
   * vetting stands behind it. Free-form but conventionally one of:
   * "official-registry:<namespace>" (MCP Registry, namespace-authenticated),
   * "vetted:<registry name>" (curated registry, e.g. an org-internal or
   * vendor-vetted catalog), "vendor:<name>", or "unvetted". Surfaces in
   * validate warnings and the evidence pack.
   */
  registry?: string;
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
  /** AB-161: Agent orchestration pattern */
  pattern?: "react" | "rewoo" | "router" | "sequential" | "tool-calling";
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
  /** Spec: kebab-case unique identifier (used for component namespacing). */
  name: string;
  /** Spec: human-readable name for UI surfaces (may contain spaces/casing). */
  displayName?: string;
  version: string;
  description: string;
  /** Spec type: author is an OBJECT — a bare string is a load error. */
  author: { name: string; email?: string };
  license: string;
  /** Spec: hook config path (or inline object). We point at ./hooks/hooks.json. */
  hooks?: string | Array<{ event: string; path: string }> | undefined;
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

/**
 * UI-14: the ONE hub-resolution order, applied uniformly:
 *   1. --config flag           (explicit always wins)
 *   2. AGENTBOOT_HUB env var   (session-scoped override — same precedence the
 *                               MCP server and doctor already honored; status,
 *                               drift-check, and the other hub commands now do too)
 *   3. cwd                     (you are in your hub)
 *   4. command-specific fallback (package root for build-tool scripts; the hub
 *      REGISTRY is consulted only by read-only commands, and only to SUGGEST)
 */
export function envHubConfig(): string | null {
  const envHub = process.env["AGENTBOOT_HUB"];
  if (!envHub) return null;
  const p = path.join(path.resolve(envHub), "agentboot.config.json");
  return fs.existsSync(p) ? p : null;
}

/**
 * R1-4 residual: resolve a HUB config, or nothing.
 *
 * `resolveConfigPath`'s last fallback is `path.join(<packageRoot>,
 * "agentboot.config.json")`, which is right for a caller whose `root` argument
 * IS a hub (import.ts passes the hub path) and catastrophic for `validate`,
 * `build` and `sync`, which pass the PACKAGE root:
 *
 *   * In the dev checkout that file exists, so `agentboot validate` in an empty
 *     directory silently validated the AGENTBOOT REPO'S OWN hub and printed
 *     "Config: /…/agentboot/agentboot.config.json" + "✓ All 12 checks passed",
 *     exit 0. A false green in a directory with no hub — and it is what kept
 *     R1-4's own enumeration test green, because that test asserts only "no
 *     stack frame" and "status !== 7", both of which a false green satisfies.
 *   * `npm pack` does NOT ship agentboot.config.json (89 files, confirmed with
 *     `npm pack --dry-run --json`), so for a REAL install the same path throws
 *     out of `loadConfig` with no handler: extracted tarball + empty cwd ->
 *     `agentboot validate` and `agentboot build` both print
 *     `at loadConfig (…/scripts/lib/config.ts:894:11)`.
 *
 * One defect, two faces, and the dev-checkout face is what hid the shipped one.
 * These three commands take flag -> env -> cwd and then STOP; "I am not in a
 * hub" is a fact to report, not a cue to adopt somebody else's hub.
 */
export function resolveHubConfigPath(argv: string[], cwd?: string): string | null {
  const idx = argv.indexOf("--config");
  if (idx !== -1 && argv[idx + 1]) return path.resolve(argv[idx + 1]!);
  const fromEnv = envHubConfig();
  if (fromEnv) return fromEnv;
  const cwdConfig = path.join(cwd ?? process.cwd(), "agentboot.config.json");
  return fs.existsSync(cwdConfig) ? cwdConfig : null;
}

/**
 * `resolveHubConfigPath`, with the "not a hub" refusal in ONE place.
 *
 * Three scripts needed this and giving each its own wording is how the
 * enumeration test ended up asserting a property ("no stack frame") that a
 * false green also satisfies.
 */
export function resolveHubConfigOrExit(argv: string[], command: string, cwd?: string): string {
  const p = resolveHubConfigPath(argv, cwd);
  if (p) return p;
  console.error(`✗ No agentboot.config.json found — \`${command}\` needs a hub.`);
  console.error(`    Looked in: ${cwd ?? process.cwd()}`);
  console.error("    Run it from a hub directory, pass --config <path>, or set AGENTBOOT_HUB.");
  console.error("    To create one: agentboot install --hub");
  process.exit(1);
}

export function resolveConfigPath(argv: string[], root: string, cwd?: string): string {
  const idx = argv.indexOf("--config");
  if (idx !== -1 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]!);
  }

  // AGENTBOOT_HUB: explicit session-scoped hub override (UI-14 — previously
  // honored by mcp-server/doctor but ignored here, so a session with the env
  // exported got answers from cwd/registry instead of the intended hub).
  const fromEnv = envHubConfig();
  if (fromEnv) return fromEnv;

  // Prefer cwd if it has a config (user is in their hub directory).
  // Fall back to the package root (for running from the build tool repo itself).
  const effectiveCwd = cwd ?? process.cwd();
  const cwdConfig = path.join(effectiveCwd, "agentboot.config.json");
  if (fs.existsSync(cwdConfig)) {
    return cwdConfig;
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
  if (parsed.sync?.signing !== undefined) {
    const signing = parsed.sync.signing as Record<string, unknown>;
    if (signing["enabled"] !== undefined && typeof signing["enabled"] !== "boolean") {
      throw new Error('"sync.signing.enabled" must be a boolean');
    }
    if (signing["sshKeyPath"] !== undefined && typeof signing["sshKeyPath"] !== "string") {
      throw new Error('"sync.signing.sshKeyPath" must be a string');
    }
    if (signing["enabled"] === true && !signing["sshKeyPath"]) {
      throw new Error('"sync.signing.enabled" requires "sync.signing.sshKeyPath"');
    }
  }
  if (parsed.telemetry?.sink !== undefined) {
    const sink = parsed.telemetry.sink as Record<string, unknown>;
    if (typeof sink["url"] !== "string" || !sink["url"].startsWith("https://")) {
      throw new Error('"telemetry.sink.url" must be an https:// URL (the org\'s own collector — AgentBoot has no default endpoint)');
    }
    if (sink["batchSize"] !== undefined &&
        (typeof sink["batchSize"] !== "number" || sink["batchSize"] < 1 || sink["batchSize"] > 10_000)) {
      throw new Error('"telemetry.sink.batchSize" must be a number between 1 and 10000');
    }
    if (sink["headers"] !== undefined) {
      for (const [k, v] of Object.entries(sink["headers"] as Record<string, unknown>)) {
        if (typeof v !== "string") throw new Error(`"telemetry.sink.headers.${k}" must be a string`);
      }
    }
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

  // name: required, must be string, spec format = kebab-case (used for
  // component namespacing, e.g. "org-personas:code-reviewer"). The old
  // @scope/package format predates the plugin spec and is rejected by it.
  if (manifest["name"] === undefined || manifest["name"] === null) {
    warnings.push({ field: "name", message: "name is required", level: "error" });
  } else if (typeof manifest["name"] !== "string") {
    warnings.push({ field: "name", message: "name must be a string", level: "error" });
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest["name"])) {
    warnings.push({ field: "name", message: `name must be kebab-case (lowercase letters, digits, single hyphens), got "${manifest["name"]}"`, level: "error" });
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
