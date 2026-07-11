#!/usr/bin/env node

/**
 * AgentBoot MCP Server (AB-140, Phase 10)
 *
 * A lightweight JSON-RPC 2.0 over stdio server implementing the Model Context
 * Protocol (MCP). Exposes AgentBoot persona, trait, and gotcha data as MCP tools,
 * enabling any MCP-compatible client to access organizational knowledge.
 *
 * No external MCP SDK dependency — implements the protocol directly.
 *
 * Phase 10 additions:
 *   - AGENTBOOT_HUB env var support (override cwd as hub root)
 *   - Read tools: agentboot_status, agentboot_list_repos, agentboot_cost_estimate, agentboot_scan_for_import
 *   - Execute tools: agentboot_validate, agentboot_lint, agentboot_doctor, agentboot_build, agentboot_sync, agentboot_optimize_metrics
 *   - Write tool: agentboot_propose_change (always opens a PR, never pushes to main)
 *
 * Usage:
 *   npx tsx scripts/mcp-server.ts
 *   AGENTBOOT_HUB=/path/to/hub npx tsx scripts/mcp-server.ts
 *   agentboot mcp-server
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";
import { execSync, spawnSync } from "node:child_process";
import { stripJsoncComments, type PersonaConfig, type AgentBootConfig, loadConfig } from "./lib/config.js";
import { scanParentForContent } from "./lib/import.js";
import { getDefaultHub } from "./lib/registry.js";
import { checkDrift, findManifestPath } from "./lib/drift.js";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths — hub root resolution (in priority order):
//   1. AGENTBOOT_HUB env var       — explicit override, CI/scripting, hub sessions
//   2. process.cwd()               — user is in their hub directory
//   3. ~/.agentboot/config.json    — global registry (default hub, works from any repo)
//   4. Package install dir          — fallback for running the build tool itself
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..");

function resolveHubRoot(): string {
  // Diagnostics go to stderr only — stdout is the JSON-RPC channel and must not
  // be polluted, or the MCP handshake breaks.
  // 1. Explicit env var
  const envHub = process.env["AGENTBOOT_HUB"];
  if (envHub) {
    const resolved = path.resolve(envHub);
    // Dual-source clarity: if a registry default also exists and differs, the
    // env var wins — surface that so the operator isn't confused about which SSOT applies.
    try {
      const regDefault = getDefaultHub();
      if (regDefault && path.resolve(regDefault) !== resolved) {
        console.error(
          `[agentboot] AGENTBOOT_HUB (${resolved}) overrides the registry default hub (${regDefault}).`
        );
      }
    } catch {
      // registry unavailable — nothing to compare against
    }
    return resolved;
  }
  // 2. cwd is a hub
  const cwdConfig = path.join(process.cwd(), "agentboot.config.json");
  if (fs.existsSync(cwdConfig)) {
    return process.cwd();
  }
  // 3. Global registry (Phase 11 A3): default hub, or the only hub for single-hub orgs
  try {
    const candidate = getDefaultHub();
    if (candidate && fs.existsSync(path.join(candidate, "agentboot.config.json"))) {
      return candidate;
    }
  } catch {
    // Registry file missing/corrupt — fall through (getDefaultHub self-heals a corrupt file)
  }
  // 4. Package install dir — no hub resolved from env, cwd, or registry. Fall back
  //    to AgentBoot's own bundled content so the server still starts, but make the
  //    fallback VISIBLE: a spoke that silently serves the package's demo personas is
  //    the confusing failure mode the registry was built to prevent.
  console.error(
    "[agentboot] No hub resolved from AGENTBOOT_HUB, the current directory, or the " +
      "global registry — falling back to AgentBoot's bundled content. Run " +
      "'agentboot connect <hub-path>' to register your hub, or set AGENTBOOT_HUB."
  );
  return DEFAULT_ROOT;
}

/** Hub root path resolved from env var, cwd, global registry, or package root. */
export const HUB_ROOT = resolveHubRoot();

/** Sanitize error messages by replacing absolute paths with relative ones. */
function sanitizeErrorOutput(msg: string): string {
  return msg.replaceAll(HUB_ROOT, "<hub>").slice(0, 2000);
}

const DIST_SKILL_CORE = path.join(HUB_ROOT, "dist", "skill", "core");
const CORE_PERSONAS = path.join(HUB_ROOT, "core", "personas");
const CORE_TRAITS = path.join(HUB_ROOT, "core", "traits");
const CORE_GOTCHAS = path.join(HUB_ROOT, "core", "gotchas");

// ---------------------------------------------------------------------------
// MCP Protocol Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = "agentboot";
const SERVER_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(HUB_ROOT, "package.json"), "utf-8"));
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
export function isContainedIn(resolved: string, baseDir: string): boolean {
  // Use realpathSync to canonicalize case (macOS HFS+) and resolve symlinks
  let realResolved: string;
  let realBase: string;
  try {
    // For new files, the file may not exist yet — resolve the parent dir instead
    const resolvedPath = path.resolve(resolved);
    const parentDir = path.dirname(resolvedPath);
    const realParent = fs.existsSync(parentDir)
      ? fs.realpathSync(parentDir)
      : path.resolve(parentDir);
    realResolved = path.join(realParent, path.basename(resolvedPath));
    realBase = fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : path.resolve(baseDir);
  } catch {
    return false; // If we can't resolve paths, reject
  }
  const normalizedBase = realBase + path.sep;
  return realResolved === realBase || realResolved.startsWith(normalizedBase);
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
// Hub config & repos helpers
// ---------------------------------------------------------------------------

/** Load the hub's agentboot.config.json. Returns null if not found. */
function loadHubConfig(): AgentBootConfig | null {
  const configPath = path.join(HUB_ROOT, "agentboot.config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    return loadConfig(configPath);
  } catch {
    return null;
  }
}

interface RepoEntry {
  path: string;
  platform?: string;
  platforms?: string[];
  group?: string;
  team?: string;
  label?: string;
  public?: boolean;
  packages?: string[];
}

/** Load repos.json from the hub. */
function loadReposJson(): RepoEntry[] {
  const config = loadHubConfig();
  const reposFile = config?.sync?.repos ?? "./repos.json";
  const reposPath = path.resolve(HUB_ROOT, reposFile);
  if (!fs.existsSync(reposPath)) return [];
  try {
    const raw = fs.readFileSync(reposPath, "utf-8");
    const parsed = JSON.parse(stripJsoncComments(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  // --- Original 5 tools ---
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

  // --- Story 1: Read tools ---
  {
    name: "agentboot_status",
    description:
      "Get the full status of the AgentBoot hub: org info, build state, personas, repos, and platforms.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_list_repos",
    description:
      "List all target repos configured in repos.json with sync status and drift detection.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_cost_estimate",
    description:
      "Estimate monthly cost for persona invocations based on model, team size, and invocation frequency.",
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          enum: ["haiku", "sonnet", "opus"],
          description: "Model to estimate costs for (default: sonnet)",
        },
        teamSize: {
          type: "number",
          description: "Number of developers on the team (default: 10)",
        },
        invocations: {
          type: "number",
          description: "Invocations per persona per person per month (default: 100)",
        },
      },
      required: [],
    },
  },
  {
    name: "agentboot_scan_for_import",
    description:
      "Scan directories for existing AI agent content (CLAUDE.md, .cursorrules, etc.) that could be imported into the hub.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Array of directory paths to scan for importable content",
        },
      },
      required: ["paths"],
    },
  },

  // --- Story 2: Execute tools ---
  {
    name: "agentboot_validate",
    description:
      "Run the AgentBoot validation pipeline (persona existence, trait refs, frontmatter, secrets, composition, MCP governance).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_lint",
    description:
      "Lint persona SKILL.md files for prompt quality issues (length, vague language, credentials, missing sections).",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "Optional persona ID to lint. If omitted, lints all personas.",
        },
      },
      required: [],
    },
  },
  {
    name: "agentboot_doctor",
    description:
      "Check the health of the AgentBoot environment (Node.js version, gh CLI, config, dist, repos).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_build",
    description:
      "Run the AgentBoot compile pipeline to build dist/ from source personas and traits.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "agentboot_sync",
    description:
      "Sync compiled dist/ output to target repos. Optionally specify which repos to sync.",
    inputSchema: {
      type: "object",
      properties: {
        repos: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of repo names to sync. If omitted, syncs all repos.",
        },
      },
      required: [],
    },
  },
  {
    name: "agentboot_optimize_metrics",
    description:
      "Retrieve optimization metrics for personas (telemetry-driven). Currently a stub — telemetry collection not yet implemented.",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "Optional persona ID to get metrics for.",
        },
      },
      required: [],
    },
  },

  // --- Story 3: Write tool ---
  {
    name: "agentboot_propose_change",
    description:
      "Propose a change to the hub by creating a branch, committing a file, pushing, and opening a PR. Never pushes to main directly.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within hub (e.g., 'core/gotchas/n-plus-one-orm.md')",
        },
        content: {
          type: "string",
          description: "Full file content to write",
        },
        commitMessage: {
          type: "string",
          description: "Git commit message",
        },
        prTitle: {
          type: "string",
          description: "Pull request title",
        },
        prBody: {
          type: "string",
          description: "Pull request body (markdown)",
        },
        contributor: {
          type: "string",
          description: "Optional git author email/name",
        },
      },
      required: ["path", "content", "commitMessage", "prTitle", "prBody"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function toolOk(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

export function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): ToolResult {
  switch (toolName) {
    // ----- Original 5 tools -----
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
      const traitContent = loadTraitContent(name);
      if (!traitContent) {
        return {
          content: [{ type: "text", text: `Error: trait '${name}' not found` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: name, content: traitContent }, null, 2),
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

    // ----- Story 1: Read tools -----
    case "agentboot_status":
      return handleStatus();
    case "agentboot_list_repos":
      return handleListRepos();
    case "agentboot_cost_estimate":
      return handleCostEstimate(args);
    case "agentboot_scan_for_import":
      return handleScanForImport(args);

    // ----- Story 2: Execute tools -----
    case "agentboot_validate":
      return handleValidate();
    case "agentboot_lint":
      return handleLint(args);
    case "agentboot_doctor":
      return handleDoctor();
    case "agentboot_build":
      return handleBuild();
    case "agentboot_sync":
      return handleSync(args);
    case "agentboot_optimize_metrics":
      return handleOptimizeMetrics(args);

    // ----- Story 3: Write tool -----
    case "agentboot_propose_change":
      return handleProposeChange(args);

    default:
      return {
        content: [{ type: "text", text: `Error: unknown tool '${toolName}'` }],
        isError: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Story 1: Read Tool Implementations
// ---------------------------------------------------------------------------

/**
 * Per-repo sync/drift state for status reporting. Uses the real drift checker
 * (content-hash comparison), so a synced repo whose managed files were modified
 * correctly reports drift — the previous check only asked "does a manifest exist",
 * which reported hasDrift=false for any drifted-but-synced repo. "Never synced"
 * (no manifest) is a distinct state (synced=false), not drift.
 */
export function computeRepoDrift(repoPath: string): {
  synced: boolean;
  hasDrift: boolean;
  driftCount: number;
  lastSyncAt: string | null;
} {
  const manifestPath = findManifestPath(repoPath);
  let lastSyncAt: string | null = null;
  if (manifestPath) {
    try {
      lastSyncAt = fs.statSync(manifestPath).mtime.toISOString();
    } catch { /* ignore */ }
  }
  let synced = false;
  let hasDrift = false;
  let driftCount = 0;
  try {
    const report = checkDrift(repoPath);
    synced = report.manifestFound;
    driftCount = report.summary.modifiedCount + report.summary.missingCount;
    hasDrift = report.manifestFound && driftCount > 0;
  } catch { /* drift check is best-effort for status; keep defaults */ }
  return { synced, hasDrift, driftCount, lastSyncAt };
}

function handleStatus(): ToolResult {
  const config = loadHubConfig();

  // Build info
  const distDir = path.join(HUB_ROOT, "dist");
  const distExists = fs.existsSync(distDir);
  let lastBuiltAt: string | null = null;
  if (distExists) {
    try {
      const stat = fs.statSync(distDir);
      lastBuiltAt = stat.mtime.toISOString();
    } catch { /* ignore */ }
  }

  // Personas
  const dirs = listPersonaDirs();
  const personas = dirs.map((dir) => {
    const pc = loadPersonaConfig(dir);
    return {
      id: dir,
      name: pc?.name ?? dir,
      description: pc?.description ?? "",
    };
  });

  // Repos
  const repoEntries = loadReposJson();
  const repos = repoEntries.map((r) => {
    const repoPath = path.resolve(HUB_ROOT, r.path);
    const { synced, hasDrift, driftCount, lastSyncAt } = computeRepoDrift(repoPath);
    return {
      name: r.label ?? path.basename(r.path),
      path: repoPath,
      platforms: r.platforms ?? (r.platform ? [r.platform] : ["claude"]),
      lastSyncAt,
      synced,
      hasDrift,
      driftCount,
    };
  });

  // Platforms
  const platformSet = new Set<string>();
  for (const r of repoEntries) {
    const plats = r.platforms ?? (r.platform ? [r.platform] : ["claude"]);
    for (const p of plats) platformSet.add(p);
  }

  // Phase 11 B1.1: Artifact counts and maturity label
  const countDir = (dir: string): number => {
    try {
      return fs.readdirSync(path.join(HUB_ROOT, dir)).filter(f => f.endsWith(".md") && f !== "README.md").length;
    } catch { return 0; }
  };
  const countDirAll = (dir: string): number => {
    try {
      return fs.readdirSync(path.join(HUB_ROOT, dir)).filter(f => !f.startsWith(".")).length;
    } catch { return 0; }
  };

  // Package-bundled counts = the personas/traits AgentBoot itself ships, read from
  // the package's own core/ dir (DEFAULT_ROOT). Derived, not hardcoded, so the
  // org-specific math stays correct as the bundled set changes over releases.
  const countPackageDir = (rel: string, dirsOnly: boolean): number => {
    try {
      const dir = path.join(DEFAULT_ROOT, rel);
      return fs.readdirSync(dir).filter((e) => {
        if (dirsOnly) {
          try {
            return fs.statSync(path.join(dir, e)).isDirectory();
          } catch {
            return false;
          }
        }
        return e.endsWith(".md") && e !== "README.md";
      }).length;
    } catch {
      return 0;
    }
  };
  const packagePersonaCount = countPackageDir(path.join("core", "personas"), true);
  const packageTraitCount = countPackageDir(path.join("core", "traits"), false);
  const coreTraitCount = countDir("core/traits");
  const coreGotchaCount = countDir("core/gotchas");
  const coreLexiconCount = countDirAll("core/lexicon");

  // Gotchas with paths: frontmatter
  let gotchaPathPatternCount = 0;
  try {
    const gotchaDir = path.join(HUB_ROOT, "core", "gotchas");
    if (fs.existsSync(gotchaDir)) {
      for (const f of fs.readdirSync(gotchaDir).filter(f => f.endsWith(".md") && f !== "README.md")) {
        const content = fs.readFileSync(path.join(gotchaDir, f), "utf-8");
        if (content.match(/^paths:/m)) gotchaPathPatternCount++;
      }
    }
  } catch { /* ignore */ }

  const orgSpecificPersonas = Math.max(0, personas.length - packagePersonaCount);
  const orgSpecificTraits = Math.max(0, coreTraitCount - packageTraitCount);

  // Maturity label
  const maturityLabel = computeMaturityLabel(orgSpecificPersonas, orgSpecificTraits, coreGotchaCount, repos.length, lastBuiltAt);

  return toolOk({
    hub: {
      path: HUB_ROOT,
      org: config?.org ?? "unknown",
      displayName: config?.orgDisplayName ?? config?.org ?? "unknown",
      version: SERVER_VERSION,
    },
    build: {
      lastBuiltAt,
      distExists,
    },
    personas,
    repos,
    platforms: [...platformSet],
    artifactCounts: {
      personas: { core: packagePersonaCount, orgSpecific: orgSpecificPersonas },
      traits: { core: packageTraitCount, orgSpecific: orgSpecificTraits },
      gotchas: { total: coreGotchaCount, withPaths: gotchaPathPatternCount },
      lexicons: coreLexiconCount,
    },
    maturityLabel,
  });
}

function computeMaturityLabel(
  orgPersonas: number,
  orgTraits: number,
  gotchaCount: number,
  repoCount: number,
  lastBuiltAt: string | null,
): string {
  // "early": only default personas, no org-specific content
  if (orgPersonas === 0 && orgTraits === 0 && gotchaCount === 0) return "early";
  // "mature": 20+ gotchas, multiple repos, recent build
  if (gotchaCount >= 20 && repoCount >= 3 && lastBuiltAt) {
    const daysSinceBuild = (Date.now() - new Date(lastBuiltAt).getTime()) / 86_400_000;
    if (daysSinceBuild <= 30) return "mature";
  }
  // "established": some org content + gotchas with paths
  if (gotchaCount >= 10 || (orgPersonas >= 1 && orgTraits >= 2)) return "established";
  // "growing": any org-specific content
  return "growing";
}

function handleListRepos(): ToolResult {
  const repoEntries = loadReposJson();
  const repos = repoEntries.map((r) => {
    const repoPath = path.resolve(HUB_ROOT, r.path);
    const { synced, hasDrift, driftCount, lastSyncAt } = computeRepoDrift(repoPath);
    return {
      name: r.label ?? path.basename(r.path),
      path: repoPath,
      platforms: r.platforms ?? (r.platform ? [r.platform] : ["claude"]),
      lastSyncAt,
      synced,
      hasDrift,
      driftCount,
    };
  });
  return toolOk({ repos });
}

function handleCostEstimate(args: Record<string, unknown>): ToolResult {
  const model = (args["model"] as string) ?? "sonnet";
  const teamSize = (args["teamSize"] as number) ?? 10;
  const invocationsPerPersonPerMonth = (args["invocations"] as number) ?? 100;

  // Model pricing per 1M tokens
  const pricing: Record<string, { input: number; output: number }> = {
    haiku: { input: 0.25, output: 1.25 },
    sonnet: { input: 3, output: 15 },
    opus: { input: 15, output: 75 },
  };

  const modelPricing = pricing[model];
  if (!modelPricing) {
    return toolError(`Invalid model "${model}". Must be one of: haiku, sonnet, opus`);
  }

  const dirs = listPersonaDirs();
  const personaCosts: Array<{
    id: string;
    name: string;
    estimatedTokens: number;
    monthlyInvocations: number;
    estimatedMonthlyCost: number;
  }> = [];

  for (const dir of dirs) {
    const skill = loadPersonaSkill(dir);
    const pc = loadPersonaConfig(dir);
    // Rough estimate: chars / 4 = tokens
    const estimatedTokens = skill ? Math.ceil(skill.length / 4) : 0;
    const monthlyInvocations = teamSize * invocationsPerPersonPerMonth;
    // Each invocation sends the system prompt (input tokens) and gets a response.
    // Assume output is roughly equal to input for estimation.
    const inputCost = (estimatedTokens * monthlyInvocations / 1_000_000) * modelPricing.input;
    const outputCost = (estimatedTokens * monthlyInvocations / 1_000_000) * modelPricing.output;
    const monthlyCost = Math.round((inputCost + outputCost) * 100) / 100;

    personaCosts.push({
      id: dir,
      name: pc?.name ?? dir,
      estimatedTokens,
      monthlyInvocations,
      estimatedMonthlyCost: monthlyCost,
    });
  }

  const totalMonthlyCost = Math.round(personaCosts.reduce((sum, p) => sum + p.estimatedMonthlyCost, 0) * 100) / 100;

  return toolOk({
    model,
    teamSize,
    personas: personaCosts,
    totalMonthlyCost,
  });
}

function handleScanForImport(args: Record<string, unknown>): ToolResult {
  const paths = args["paths"] as string[] | undefined;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return toolError("'paths' argument is required and must be a non-empty array of directory paths");
  }

  const highConfidence: Array<{
    path: string;
    relativePath: string;
    repoName: string;
    type: string;
    lines: number;
  }> = [];

  const uncertain: Array<{
    path: string;
    relativePath: string;
    repoName: string;
    type: string;
    lines: number;
  }> = [];

  const HIGH_CONFIDENCE_TYPES = new Set([
    "claude-md", "skill", "agent", "trait", "rule",
    "settings", "mcp", "cursorrules", "copilot-instructions", "copilot-prompt",
  ]);

  // Reject system directories to prevent scanning sensitive locations
  const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir();
  const BLOCKED_PREFIXES = [
    "/etc", "/usr", "/var", "/root", "/bin", "/sbin", "/lib", "/boot", "/proc", "/sys",
    // Sensitive user directories — scan is for git repos, not credentials/config
    path.join(homeDir, ".ssh"), path.join(homeDir, ".gnupg"), path.join(homeDir, ".aws"),
    path.join(homeDir, ".config"), path.join(homeDir, ".kube"),
  ];

  for (const scanPath of paths) {
    const resolved = path.resolve(scanPath);
    if (!fs.existsSync(resolved)) continue;

    // Boundary check: reject system directories
    if (BLOCKED_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(prefix + "/"))) {
      return toolError(`Rejected path "${scanPath}": scanning system directories is not allowed`);
    }

    // Use scanParentForContent if the path is a parent directory of repos,
    // otherwise scan the single directory.
    const manifest = scanParentForContent(resolved, [HUB_ROOT]);

    for (const file of manifest.files) {
      const entry = {
        path: file.absolutePath,
        relativePath: file.relativePath,
        repoName: file.repoName,
        type: file.type,
        lines: file.lines,
      };

      if (HIGH_CONFIDENCE_TYPES.has(file.type)) {
        highConfidence.push(entry);
      } else {
        uncertain.push(entry);
      }
    }
  }

  return toolOk({ highConfidence, uncertain });
}

// ---------------------------------------------------------------------------
// Story 2: Execute Tool Implementations
// ---------------------------------------------------------------------------

function handleValidate(): ToolResult {
  try {
    const output = execSync("npx tsx scripts/validate.ts 2>&1", {
      cwd: HUB_ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });

    // Parse output for check results
    const checks: Array<{ name: string; status: string; message: string }> = [];
    const lines = output.split("\n");
    for (const line of lines) {
      // Match check lines like "  ✓ Persona existence — ..." or "  ✗ ..."
      const passMatch = line.match(/\s*[✓]\s+(.*)/);
      const failMatch = line.match(/\s*[✗]\s+(.*)/);
      if (passMatch) {
        checks.push({ name: passMatch[1]!.trim(), status: "pass", message: "" });
      } else if (failMatch) {
        checks.push({ name: failMatch[1]!.trim(), status: "fail", message: "" });
      }
      // Attach ERROR/WARN messages to the last check
      const errorMatch = line.match(/ERROR:\s+(.*)/);
      const warnMatch = line.match(/WARN[^:]*:\s+(.*)/);
      if (errorMatch && checks.length > 0) {
        const last = checks[checks.length - 1]!;
        last.message = last.message ? `${last.message}; ${errorMatch[1]!.trim()}` : errorMatch[1]!.trim();
      } else if (warnMatch && checks.length > 0) {
        const last = checks[checks.length - 1]!;
        last.message = last.message ? `${last.message}; ${warnMatch[1]!.trim()}` : warnMatch[1]!.trim();
      }
    }

    return toolOk({
      passed: true,
      checks: checks.length > 0 ? checks : [{ name: "validation", status: "pass", message: "All checks passed" }],
    });
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const output = sanitizeErrorOutput(error.stdout ?? error.stderr ?? error.message ?? "Validation failed");

    // Parse failures from output
    const checks: Array<{ name: string; status: string; message: string }> = [];
    const lines = (typeof output === "string" ? output : "").split("\n");
    for (const line of lines) {
      const passMatch = line.match(/\s*[✓]\s+(.*)/);
      const failMatch = line.match(/\s*[✗]\s+(.*)/);
      if (passMatch) {
        checks.push({ name: passMatch[1]!.trim(), status: "pass", message: "" });
      } else if (failMatch) {
        checks.push({ name: failMatch[1]!.trim(), status: "fail", message: "" });
      }
      const errorMatch = line.match(/ERROR:\s+(.*)/);
      if (errorMatch && checks.length > 0) {
        const last = checks[checks.length - 1]!;
        last.message = last.message ? `${last.message}; ${errorMatch[1]!.trim()}` : errorMatch[1]!.trim();
      }
    }

    return toolOk({
      passed: false,
      checks: checks.length > 0 ? checks : [{ name: "validation", status: "fail", message: String(output).trim() }],
    });
  }
}

function handleLint(args: Record<string, unknown>): ToolResult {
  const targetPersona = args["persona"] as string | undefined;
  const findings: Array<{
    rule: string;
    severity: string;
    persona: string;
    message: string;
    line: number | null;
  }> = [];

  const VAGUE_PHRASES = ["be thorough", "try to", "best practice", "as needed", "where appropriate"];
  const CREDENTIAL_PATTERNS = [
    /apikey/i, /api_key/i, /token\s*[:=]/i, /password\s*[:=]/i,
    /secret\s*[:=]/i, /[A-Za-z0-9+/]{40,}/, // high-entropy base64-like strings
  ];

  const dirs = listPersonaDirs();
  const personasToLint = targetPersona ? dirs.filter((d) => d === targetPersona) : dirs;

  if (targetPersona && personasToLint.length === 0) {
    return toolError(`Persona "${targetPersona}" not found`);
  }

  for (const dir of personasToLint) {
    const skill = loadPersonaSkill(dir);
    if (!skill) continue;

    const skillLines = skill.split("\n");
    const lineCount = skillLines.length;

    // Rule: prompt-too-long
    if (lineCount > 1000) {
      findings.push({
        rule: "prompt-too-long",
        severity: "error",
        persona: dir,
        message: `SKILL.md is ${lineCount} lines (exceeds 1000 line limit)`,
        line: null,
      });
    } else if (lineCount > 500) {
      findings.push({
        rule: "prompt-too-long",
        severity: "warn",
        persona: dir,
        message: `SKILL.md is ${lineCount} lines (exceeds 500 line recommendation)`,
        line: null,
      });
    }

    // Rule: vague-instruction
    for (let i = 0; i < skillLines.length; i++) {
      const line = skillLines[i]!.toLowerCase();
      for (const phrase of VAGUE_PHRASES) {
        if (line.includes(phrase)) {
          findings.push({
            rule: "vague-instruction",
            severity: "warn",
            persona: dir,
            message: `Phrase '${phrase}' found`,
            line: i + 1,
          });
        }
      }
    }

    // Rule: credential-in-prompt
    for (let i = 0; i < skillLines.length; i++) {
      const line = skillLines[i]!;
      for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            rule: "credential-in-prompt",
            severity: "error",
            persona: dir,
            message: `Potential credential pattern found: ${pattern.source}`,
            line: i + 1,
          });
          break; // One finding per line for credentials
        }
      }
    }

    // Rule: missing-output-format
    if (!skill.includes("## Output Format") && !skill.includes("## Output format")) {
      findings.push({
        rule: "missing-output-format",
        severity: "info",
        persona: dir,
        message: "No '## Output Format' section found in SKILL.md",
        line: null,
      });
    }
  }

  return toolOk({ findings });
}

function handleDoctor(): ToolResult {
  const issues: Array<{
    severity: string;
    description: string;
    fixable: boolean;
    fixCommand: string | null;
  }> = [];

  // Check Node.js version >= 18
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.replace("v", "").split(".")[0]!, 10);
  if (major < 18) {
    issues.push({
      severity: "error",
      description: `Node.js ${nodeVersion} is below minimum v18. Upgrade Node.js.`,
      fixable: false,
      fixCommand: null,
    });
  }

  // Check gh CLI
  try {
    execSync("gh --version", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    issues.push({
      severity: "warn",
      description: "gh CLI not found. Required for agentboot_propose_change and PR features.",
      fixable: true,
      fixCommand: "brew install gh && gh auth login",
    });
  }

  // Check agentboot.config.json exists and parses
  const configPath = path.join(HUB_ROOT, "agentboot.config.json");
  if (!fs.existsSync(configPath)) {
    issues.push({
      severity: "error",
      description: "agentboot.config.json not found in hub root.",
      fixable: true,
      fixCommand: "agentboot init",
    });
  } else {
    try {
      loadConfig(configPath);
    } catch (e: unknown) {
      issues.push({
        severity: "error",
        description: `agentboot.config.json parse error: ${e instanceof Error ? e.message : String(e)}`,
        fixable: false,
        fixCommand: null,
      });
    }
  }

  // Check dist/ exists
  const distDir = path.join(HUB_ROOT, "dist");
  if (!fs.existsSync(distDir)) {
    issues.push({
      severity: "warn",
      description: "dist/ not found — run agentboot build",
      fixable: true,
      fixCommand: "agentboot build",
    });
  }

  // Check repos.json exists
  const config = loadHubConfig();
  const reposFile = config?.sync?.repos ?? "./repos.json";
  const reposPath = path.resolve(HUB_ROOT, reposFile);
  if (!fs.existsSync(reposPath)) {
    issues.push({
      severity: "warn",
      description: `repos.json not found at ${reposPath}`,
      fixable: true,
      fixCommand: "echo '[]' > repos.json",
    });
  }

  return toolOk({
    issues,
    allClear: issues.length === 0,
  });
}

function handleBuild(): ToolResult {
  const startTime = Date.now();
  try {
    const output = execSync("npx tsx scripts/compile.ts 2>&1", {
      cwd: HUB_ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    });

    const duration_ms = Date.now() - startTime;

    // Count files written from output
    const filesWrittenMatch = output.match(/(\d+)\s+files?\s+written/i);
    const filesWritten = filesWrittenMatch ? parseInt(filesWrittenMatch[1]!, 10) : 0;

    // Extract warnings
    const warnings: string[] = [];
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("WARN") || line.includes("warning")) {
        warnings.push(line.trim());
      }
    }

    // If we can't parse the count, count dist files
    let finalCount = filesWritten;
    if (finalCount === 0) {
      const distDir = path.join(HUB_ROOT, "dist");
      if (fs.existsSync(distDir)) {
        finalCount = countFiles(distDir);
      }
    }

    return toolOk({
      success: true,
      filesWritten: finalCount,
      duration_ms,
      errors: [],
      warnings,
    });
  } catch (err: unknown) {
    const duration_ms = Date.now() - startTime;
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const errorMsg = sanitizeErrorOutput(error.stdout ?? error.stderr ?? error.message ?? "Build failed");
    return toolOk({
      success: false,
      filesWritten: 0,
      duration_ms,
      errors: [String(errorMsg).trim()],
      warnings: [],
    });
  }
}

/** Recursively count files in a directory. */
function countFiles(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      count += countFiles(full);
    } else {
      count++;
    }
  }
  return count;
}

function handleSync(args: Record<string, unknown>): ToolResult {
  const targetRepos = args["repos"] as string[] | undefined;

  try {
    // Build the command
    let cmd = "npx tsx scripts/sync.ts 2>&1";
    // If specific repos requested, we can't pass them via CLI args to sync.ts easily,
    // so we sync all and filter the output. The sync script uses repos.json.
    const output = execSync(cmd, {
      cwd: HUB_ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    });

    // Parse output for per-repo results
    const repos: Array<{
      name: string;
      filesWritten: number;
      filesUnchanged: number;
      driftWarnings: string[];
    }> = [];

    // Try to parse structured output from sync
    const lines = output.split("\n");
    let currentRepo: string | null = null;
    let written = 0;
    let unchanged = 0;

    for (const line of lines) {
      const repoMatch = line.match(/(?:Syncing|Sync)\s+(?:to\s+)?(?:repo\s+)?["']?([^"'\s]+)/i);
      if (repoMatch) {
        if (currentRepo) {
          repos.push({ name: currentRepo, filesWritten: written, filesUnchanged: unchanged, driftWarnings: [] });
        }
        currentRepo = repoMatch[1]!;
        written = 0;
        unchanged = 0;
      }
      if (line.includes("written") || line.includes("wrote")) {
        const countMatch = line.match(/(\d+)/);
        if (countMatch) written += parseInt(countMatch[1]!, 10);
      }
      if (line.includes("unchanged") || line.includes("skipped")) {
        const countMatch = line.match(/(\d+)/);
        if (countMatch) unchanged += parseInt(countMatch[1]!, 10);
      }
    }
    if (currentRepo) {
      repos.push({ name: currentRepo, filesWritten: written, filesUnchanged: unchanged, driftWarnings: [] });
    }

    // Filter by target repos if specified
    const filteredRepos = targetRepos && targetRepos.length > 0
      ? repos.filter((r) => targetRepos.includes(r.name))
      : repos;

    return toolOk({
      repos: filteredRepos.length > 0 ? filteredRepos : [{ name: "all", filesWritten: 0, filesUnchanged: 0, driftWarnings: [] }],
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const errorMsg = sanitizeErrorOutput(error.stdout ?? error.stderr ?? error.message ?? "Sync failed");
    return toolError(`Sync failed: ${String(errorMsg).trim()}`);
  }
}

function handleOptimizeMetrics(_args: Record<string, unknown>): ToolResult {
  return toolOk({
    message: "Telemetry data not yet available. Run agentboot optimize after configuring telemetry collection.",
    personas: [],
  });
}

// ---------------------------------------------------------------------------
// Story 3: Write Tool Implementation — agentboot_propose_change
// ---------------------------------------------------------------------------

function handleProposeChange(args: Record<string, unknown>): ToolResult {
  const relativePath = args["path"] as string;
  const content = args["content"] as string;
  const commitMessage = args["commitMessage"] as string;
  const prTitle = args["prTitle"] as string;
  const prBody = args["prBody"] as string;
  const contributor = args["contributor"] as string | undefined;

  // Type and presence validation — catch non-string types before any string operations
  if (typeof relativePath !== "string" || typeof content !== "string" ||
      typeof commitMessage !== "string" || typeof prTitle !== "string" ||
      typeof prBody !== "string") {
    return toolError("Invalid argument types: path, content, commitMessage, prTitle, prBody must all be strings");
  }
  if (!relativePath || !content || !commitMessage || !prTitle || !prBody) {
    return toolError("Missing required arguments: path, content, commitMessage, prTitle, prBody");
  }
  if (contributor !== undefined && typeof contributor !== "string") {
    return toolError("Invalid argument type: contributor must be a string if provided");
  }

  // Path traversal check
  const fullPath = path.resolve(HUB_ROOT, relativePath);
  if (!isContainedIn(fullPath, HUB_ROOT)) {
    return toolError(`Path traversal detected: "${relativePath}" resolves outside hub root`);
  }

  // Check gh is available
  try {
    execSync("gh --version", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    return toolError("gh CLI not found. Install it: https://cli.github.com/ then run 'gh auth login'");
  }

  // Check gh is authenticated
  try {
    execSync("gh auth status", { encoding: "utf-8", stdio: "pipe", cwd: HUB_ROOT });
  } catch {
    return toolError("gh CLI not authenticated. Run 'gh auth login' first.");
  }

  // Derive branch name
  const basename = path.basename(relativePath, path.extname(relativePath));
  const kebab = basename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  let branchName = `ab/${kebab}`;

  // Detect the default branch (main, master, or whatever the repo uses).
  let defaultBranch = "main";
  try {
    const symbolicRef = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: HUB_ROOT, encoding: "utf-8", stdio: "pipe",
    }).trim();
    defaultBranch = symbolicRef.replace("refs/remotes/origin/", "");
  } catch {
    // Fall back to "main" if not determinable
  }

  // Check if branch exists already — exact line match, not substring.
  try {
    const localBranches = execSync("git branch --list", { cwd: HUB_ROOT, encoding: "utf-8", stdio: "pipe" })
      .split("\n").map(b => b.replace(/^\*?\s+/, "").trim()).filter(Boolean);
    if (localBranches.includes(branchName)) {
      branchName = `${branchName}-${Date.now()}`;
    }
    const remoteBranches = execSync("git branch -r --list", { cwd: HUB_ROOT, encoding: "utf-8", stdio: "pipe" })
      .split("\n").map(b => b.trim()).filter(Boolean);
    if (remoteBranches.includes(`origin/${branchName}`)) {
      branchName = `${branchName}-${Date.now()}`;
    }
  } catch {
    // If git fails, just proceed with the branch name
  }

  // Helper: run a git/gh command safely via spawnSync (no shell interpolation).
  function gitRun(args: string[], opts?: { cwd?: string }): { ok: boolean; out: string; err: string } {
    const result = spawnSync("git", args, {
      cwd: opts?.cwd ?? HUB_ROOT,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return {
      ok: result.status === 0,
      out: (result.stdout ?? "").trim(),
      err: (result.stderr ?? "").trim(),
    };
  }
  function ghRun(args: string[]): { ok: boolean; out: string; err: string } {
    const result = spawnSync("gh", args, {
      cwd: HUB_ROOT,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return {
      ok: result.status === 0,
      out: (result.stdout ?? "").trim(),
      err: (result.stderr ?? "").trim(),
    };
  }

  try {
    // Ensure we start from the default branch
    const checkoutDefault = gitRun(["checkout", defaultBranch]);
    if (!checkoutDefault.ok) throw new Error(`git checkout ${defaultBranch}: ${checkoutDefault.err}`);

    // Pull latest (best effort)
    gitRun(["pull", "--ff-only"]);

    // Create and checkout new branch
    const checkoutBranch = gitRun(["checkout", "-b", branchName]);
    if (!checkoutBranch.ok) throw new Error(`git checkout -b ${branchName}: ${checkoutBranch.err}`);

    // Re-validate path containment after checkout/pull (TOCTOU defense)
    if (!isContainedIn(fullPath, HUB_ROOT)) {
      throw new Error(`Path validation failed after checkout: "${relativePath}" resolves outside hub root`);
    }

    // Write the file
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");

    // Stage
    const addResult = gitRun(["add", "--", relativePath]);
    if (!addResult.ok) throw new Error(`git add: ${addResult.err}`);

    // Commit — pass message and author as separate args (no shell interpolation)
    const commitArgs = ["commit", "-m", commitMessage];
    if (contributor) {
      // Validate contributor format: reject control chars, backticks, and git author special chars
      if (/[\x00-\x1f\x7f`<>"']/.test(contributor)) {
        throw new Error("Invalid contributor: must not contain control characters, backticks, or angle brackets");
      }
      commitArgs.push(`--author=${contributor} <${contributor}>`);
    }
    const commitResult = gitRun(commitArgs);
    if (!commitResult.ok) throw new Error(`git commit: ${commitResult.err}`);

    // Push
    const pushResult = gitRun(["push", "origin", branchName, "--set-upstream"]);
    if (!pushResult.ok) throw new Error(`git push: ${pushResult.err}`);

    // Create PR — pass title/body as separate args
    const fullBody = `${prBody}\n\n---\n*Proposed via /ab*`;
    let prUrl = "";
    const prResult = ghRun([
      "pr", "create",
      "--title", prTitle,
      "--body", fullBody,
      "--base", defaultBranch,
      "--head", branchName,
    ]);
    if (prResult.ok) {
      prUrl = prResult.out;
    } else {
      // Try to extract URL from output even on error (gh sometimes writes URL to stderr)
      const combined = `${prResult.out} ${prResult.err}`;
      const urlMatch = combined.match(/(https:\/\/github\.com\/[^\s]+)/);
      // Still return success — the branch and commit were created even if PR open failed
      prUrl = urlMatch ? urlMatch[1]! : `Branch pushed but PR creation failed: ${prResult.err}`;
    }

    // Return to default branch
    gitRun(["checkout", defaultBranch]);

    return toolOk({
      prUrl,
      branch: branchName,
      path: relativePath,
    });
  } catch (err: unknown) {
    // Best-effort return to default branch on any error
    gitRun(["checkout", defaultBranch]);

    const error = err as { message?: string };
    return toolError(`propose_change failed: ${error.message ?? String(err)}`);
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
