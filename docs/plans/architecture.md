# AgentBoot Architecture Document

Version: 1.0.0
Status: Draft
Last Updated: 2026-03-19

---

## Table of Contents

1. [Summary](#1-summary)
2. [System Context Diagram](#2-system-context-diagram)
3. [Component Architecture](#3-component-architecture)
4. [Data Architecture](#4-data-architecture)
5. [Scope Hierarchy & Merge Semantics](#5-scope-hierarchy--merge-semantics)
6. [Build Pipeline](#6-build-pipeline)
7. [Distribution Architecture](#7-distribution-architecture)
8. [Security Architecture](#8-security-architecture)
9. [Cross-Platform Strategy](#9-cross-platform-strategy)
10. [Key Architectural Decisions](#10-key-architectural-decisions)
11. [Open Questions](#11-open-questions)

---

## 1. Summary

AgentBoot is a **build tool** for AI agent governance. It compiles reusable behavioral
building blocks (traits) into deployable agent personas, then distributes them across
an organization's repositories through a hub-and-spoke model. The system treats AI
agent behavior as infrastructure: defined in files, stored in version control, reviewed
in pull requests, and distributed through automated pipelines.

### Key Architectural Decisions

- **Build-time composition, not runtime.** Traits are resolved and composed into
  personas at build time. The compiled output is complete and standalone. No runtime
  resolution, no dynamic includes, no agent-side file reading during sessions. This
  ensures portability across all agent platforms.

- **Hub-and-spoke distribution.** A single personas repository (hub) is the source of
  truth. Target repositories (spokes) receive compiled output via sync. Spokes are
  passive recipients; they do not produce governance artifacts.

- **Per-platform compilation targets.** The build produces one self-contained folder per
  platform under `dist/` (claude, copilot, cursor, skill, gemini). Each folder contains
  everything needed for that platform and nothing it doesn't. The same source definitions
  drive all platforms. Scope hierarchy is preserved within each platform folder.

- **Scope hierarchy with deterministic merge.** Configuration merges across four
  levels (Org, Group, Team, Repo) with clear precedence rules: mandatory behaviors
  are top-down (org wins), optional behaviors are bottom-up (team wins).

- **Privacy by design.** Raw prompts never leave the developer's machine. Telemetry
  captures structured metrics (persona ID, token counts, findings), never transcripts.
  This is a design invariant, not a configuration option.

### Major Components

```
+-------------------+     +------------------+     +-------------------+
|    CLI            |     |   Build System   |     | Output Generators |
|  (agentboot)      |---->| validate/compile |---->| CC-native         |
|                   |     |                  |     | Cross-platform    |
+-------------------+     +------------------+     | Plugin            |
                                |                  | Managed settings  |
                          +-----+------+           +-------------------+
                          |            |                    |
                    +-----v----+ +----v------+     +-------v---------+
                    | Persona  | | Knowledge |     | Sync Engine     |
                    | Engine   | | Server    |     | (distribution)  |
                    +----------+ +-----------+     +-----------------+
```

The pipeline is linear: **source files** --> **validate** --> **compile** --> **output
generation** --> **sync/distribute**. Each stage has well-defined inputs and outputs.
No stage has runtime dependencies on another.

---

## 2. System Context Diagram

```
                                    +-----------------------------------+
                                    |        Developer Machines         |
                                    |                                   |
                                    |  +------------+  +-------------+  |
                                    |  | Claude Code|  | Copilot CLI |  |
                                    |  +------+-----+  +------+------+  |
                                    |         |               |         |
                                    |  +------+-----+  +------+------+  |
                                    |  | Cursor     |  | Gemini CLI  |  |
                                    |  +------+-----+  +------+------+  |
                                    |         |               |         |
                                    +---------|---------------|─────────+
                                              |               |
                                    +---------v---------------v---------+
                                    |                                   |
                                    |     Target Repositories (Spokes)  |
                                    |                                   |
                                    |  .claude/   .github/   .cursor/  |
                                    |  GEMINI.md  SKILL.md   .mcp.json |
                                    |                                   |
                                    +-----------------^-----------------+
                                                      |
                                           Sync (file write / PR)
                                                      |
+-------------------+       +---------+       +-------+--------+
|                   |       |         |       |                |
|  MDM Systems      |       | GitHub  |       |  AgentBoot     |
|  (Jamf, Intune,   |<------| API     |<------+  Hub Repo      |
|   JumpCloud)      |       |         |       |                |
|                   |       +---------+       | agentboot.     |
+---------+---------+                         |  config.json   |
          |                                   | core/          |
          v                                   | domains/       |
+-------------------+                         | extensions/    |
| Managed Settings  |                         |                |
| /Library/App...   |                         +-------+--------+
| /etc/claude-code/ |                                 |
+-------------------+                          agentboot build
                                                      |
                                               +------v-------+
                                               |              |
                                               |   dist/      |
                                               |   (compiled  |
                                               |    output)   |
                                               |              |
                                               +------+-------+
                                                      |
                                          +-----------+-----------+
                                          |           |           |
                                    +-----v---+ +----v----+ +----v--------+
                                    | CC      | | Cross-  | | Plugin      |
                                    | Plugin  | | Platform| | Marketplace |
                                    | Package | | Output  | | (private/   |
                                    |         | |         | |  public)    |
                                    +---------+ +---------+ +-------------+


+-------------------+       +-------------------+
|  MCP Clients      |       |  Anthropic API    |
|  (any platform)   |<----->|  (Claude models)  |
|                   |       |                   |
+--------+----------+       +-------------------+
         |                          ^
         v                          |
+--------+----------+               |
| AgentBoot         |               |
| MCP Server        |               |
| (@agentboot/      |      Used by: behavioral tests,
|  mcp-server)      |      /insights analysis,
|                   |      prompt hooks (type: prompt)
+-------------------+
```

### External System Interactions

| External System          | Interaction                                           | Direction     |
|--------------------------|-------------------------------------------------------|---------------|
| Claude Code              | Reads .claude/ directory, agents, skills, rules       | Consumes      |
| Copilot                  | Reads copilot-instructions.md, prompts, SKILL.md      | Consumes      |
| Cursor                   | Reads .cursor/rules/, .cursorrules, SKILL.md          | Consumes      |
| Gemini CLI               | Reads GEMINI.md, SKILL.md                             | Consumes      |
| GitHub API               | Sync creates PRs, reads repo metadata                 | Bidirectional |
| MDM (Jamf/Intune/etc.)   | Distributes managed-settings.json to endpoints        | Consumes      |
| Anthropic API            | Behavioral tests, /insights, prompt-type hooks        | Bidirectional |
| MCP Clients              | Query personas, traits, knowledge via MCP protocol    | Consumes      |
| CC Plugin Marketplace    | Hosts plugin packages for discovery and installation   | Consumes      |

---

## 3. Component Architecture

### 3.1 Build System

**Responsibility:** Transform source definitions (config, traits, personas, domains,
instructions) into compiled output artifacts.

**Pipeline:**

```
                         agentboot.config.json
                                 |
                    +------------v-------------+
                    |     VALIDATION PHASE     |
                    |                          |
                    |  1. Config schema check  |
                    |  2. Persona existence    |
                    |  3. Trait references     |
                    |  4. SKILL.md frontmatter |
                    |  5. PERSONAS.md sync     |
                    |  6. Secret scanning      |
                    |                          |
                    +------------+-------------+
                                 |
                          pass / fail
                                 |
                    +------------v-------------+
                    |    COMPILATION PHASE     |
                    |                          |
                    |  1. Load config          |
                    |  2. Resolve scope chain  |
                    |  3. Compose traits       |
                    |  4. Generate frontmatter |
                    |  5. Process @imports     |
                    |  6. Merge hooks          |
                    |  7. Generate MCP config  |
                    |                          |
                    +------------+-------------+
                                 |
                    +------------v-------------+
                    |   OUTPUT GENERATION      |
                    |                          |
                    |  +--> CC-native output   |
                    |  +--> Cross-platform     |
                    |  +--> Plugin package     |
                    |  +--> Managed settings   |
                    |                          |
                    +------------+-------------+
                                 |
                                 v
                             dist/
```

**Inputs:**
- `agentboot.config.json` -- org config, group/team hierarchy, enabled personas/traits
- `core/traits/*.md` -- trait definitions with weight configurations
- `core/personas/{name}/SKILL.md` -- persona system prompts with frontmatter
- `core/personas/{name}/persona.config.json` -- build metadata per persona
- `core/instructions/*.md` -- always-on instruction fragments
- `domains/{name}/` -- domain layer directories (traits, personas, instructions, hooks)
- `extensions/` -- org-specific persona extensions

**Outputs:**
- `dist/claude/` -- self-contained Claude Code distribution (agents, skills, rules, traits, CLAUDE.md, settings.json)
- `dist/copilot/` -- self-contained Copilot distribution (.github/copilot-instructions.md, prompts)
- `dist/cursor/` -- self-contained Cursor distribution (.cursor/rules/*.md)
- `dist/skill/` -- cross-platform SKILL.md output (agentskills.io, traits inlined)
- `dist/gemini/` -- self-contained Gemini CLI distribution (GEMINI.md)
- `dist/managed/` -- managed settings artifacts (when `output.managed: true`)
- `dist/plugin/` -- CC plugin package (when export format is plugin)

Each platform folder preserves scope hierarchy internally:
- `dist/{platform}/core/` -- org-level compiled output
- `dist/{platform}/groups/{group}/` -- group-level overrides
- `dist/{platform}/teams/{group}/{team}/` -- team-level overrides

**Key Interfaces:**
- `scripts/validate.ts` -- validation entry point, returns pass/fail with diagnostics
- `scripts/compile.ts` -- compilation entry point, reads config, writes to dist/{platform}/
- `agentboot build` CLI command -- orchestrates validate + compile
- `agentboot build --format <target>` -- selects output generator(s)

---

### 3.2 CLI

**Responsibility:** Primary interface for all AgentBoot operations. Provides
interactive onboarding, build orchestration, sync management, diagnostics, and
content scaffolding.

```
+------------------------------------------------------------------+
|                        agentboot CLI                              |
|                                                                   |
|  +--------------+  +--------------+  +--------------+             |
|  | Command      |  | Setup        |  | Discovery    |             |
|  | Router       |  | Wizard       |  | Engine       |             |
|  |              |  |              |  |              |             |
|  | setup        |  | Role detect  |  | Repo scan    |             |
|  | build        |  | Tool detect  |  | Overlap      |             |
|  | sync         |  | Org detect   |  |  analysis    |             |
|  | export       |  | Compliance   |  | Migration    |             |
|  | publish      |  |  detect      |  |  plan        |             |
|  | doctor       |  | Outcome      |  | Config       |             |
|  | status       |  |  execution   |  |  generation  |             |
|  | discover     |  |              |  |              |             |
|  | add          |  +--------------+  +--------------+             |
|  | validate     |                                                 |
|  | connect      |  +--------------+  +--------------+             |
|  | upgrade      |  | Prompt       |  | Scaffold     |             |
|  | uninstall    |  | Classifier   |  | Engine       |             |
|  | lint         |  |              |  |              |             |
|  | test         |  | Raw text --> |  | persona      |             |
|  | metrics      |  |  trait /     |  | trait         |             |
|  | cost-estimate|  |  gotcha /    |  | domain        |             |
|  | search       |  |  always-on / |  | gotcha        |             |
|  |              |  |  persona     |  | hook          |             |
|  +--------------+  +--------------+  +--------------+             |
|                                                                   |
+------------------------------------------------------------------+
```

**Key subsystems:**

- **Command Router:** Maps CLI arguments to handler functions. Supports `--non-interactive`
  for CI. Auto-detects TTY for interactive vs. scripted mode.

- **Setup Wizard:** Multi-path onboarding flow. Detects user role (developer, platform
  team, IT/security, explorer), agent tooling, org context, and compliance requirements.
  Executes the appropriate setup outcome (Quick Start, Standard Setup, Enterprise Setup).

- **Discovery Engine:** Scans repos, local machine, and GitHub API for existing agentic
  content (CLAUDE.md, copilot-instructions, .cursorrules, agents, skills, rules, hooks,
  MCP servers). Produces overlap analysis, migration plan, and config scaffold. All
  operations are non-destructive -- discovery never modifies existing files.

- **Prompt Classifier:** Used by `agentboot add prompt`. Takes raw text and classifies
  it as a trait, gotcha, always-on instruction, or persona rule. Supports batch mode
  for decomposing existing CLAUDE.md files.

**Distribution:**

| Channel            | Method                                |
|--------------------|---------------------------------------|
| macOS              | `brew install agentboot` (brew tap)   |
| Linux (Debian)     | `sudo apt install agentboot`          |
| Linux (RHEL)       | `sudo dnf install agentboot`          |
| Windows            | `choco install agentboot`             |
| Fallback           | `npx agentboot`                       |

The CLI targets zero runtime dependencies when distributed via native package managers.
The npm/npx fallback requires Node.js 18+.

---

### 3.3 Persona Engine

**Responsibility:** Compose traits into personas according to weight configurations
and scope hierarchy. Resolve trait references, apply calibration, and produce the
effective system prompt for each persona.

```
+------------------------------------------------------------------+
|                       Persona Engine                              |
|                                                                   |
|  +------------------+    +-------------------+                    |
|  | Trait Loader      |    | Weight Resolver    |                   |
|  |                  |    |                   |                    |
|  | core/traits/*.md |    | HIGH   --> 0.7    |                    |
|  | domain/traits/   |--->| MEDIUM --> 0.5    |                    |
|  |                  |    | LOW    --> 0.3    |                    |
|  +------------------+    | OFF    --> 0.0    |                    |
|                          | MAX    --> 1.0    |                    |
|                          | 0.0-1.0 passthru  |                    |
|                          +--------+----------+                    |
|                                   |                               |
|  +------------------+    +--------v----------+                    |
|  | persona.config   |    | Trait Compositor   |                   |
|  |   .json          |--->|                   |                    |
|  |                  |    | For each trait:    |                    |
|  | traits:          |    |  1. Load content   |                    |
|  |   critical-      |    |  2. Select weight  |                    |
|  |    thinking: HIGH |    |     section       |                    |
|  |   structured-    |    |  3. Inline or      |                    |
|  |    output: true  |    |     @import ref    |                    |
|  +------------------+    +--------+----------+                    |
|                                   |                               |
|  +------------------+    +--------v----------+                    |
|  | SKILL.md         |    | Persona Assembler  |                   |
|  | (template with   |--->|                   |                    |
|  |  injection       |    | 1. Parse SKILL.md  |                    |
|  |  markers)        |    | 2. Inject traits   |                    |
|  |                  |    |    between markers |                    |
|  | <!-- traits:     |    | 3. Generate front- |                    |
|  |   start -->      |    |    matter          |                    |
|  | <!-- traits:     |    | 4. Produce output  |                    |
|  |   end -->        |    |    per format      |                    |
|  +------------------+    +-------------------+                    |
|                                                                   |
+------------------------------------------------------------------+
```

**Trait Composition Rules:**

1. Traits listed in `persona.config.json` are loaded from `core/traits/` or domain
   layer `traits/` directories.
2. Named weights (HIGH, MEDIUM, LOW) are resolved to numeric equivalents (0.7, 0.5, 0.3).
3. Boolean values (`true`) mean the trait is active at its default configuration.
4. The trait content for the resolved weight level is extracted.
5. Each platform gets its own self-contained output folder under `dist/{platform}/`.
   For `dist/skill/`: trait content is inlined between `<!-- traits:start -->`
   and `<!-- traits:end -->` markers in the SKILL.md.
6. For `dist/claude/`: trait files are written separately; CLAUDE.md uses `@import`
   references. Other platform folders receive platform-native formats.

**Scope Merging in Persona Engine:**

The Persona Engine applies scope-level overrides during trait composition:

```
Org-level traits (always active)
        +
Group-level traits (additive)
        +
Team-level traits (additive)
        +
Persona-specific traits (from persona.config.json)
        =
Effective trait set for this persona in this scope
```

**Interaction Effects:**

Traits can declare interaction effects with other traits. For example:
- `critical-thinking: HIGH` + `source-citation` --> at HIGH weight, every finding
  must cite the specific line where the issue occurs.
- `creative-suggestion: LOW` + `critical-thinking: HIGH` --> suppresses proactive
  suggestions while maximizing scrutiny.

The build system does not automatically resolve interaction effects. They are encoded
in the trait prose and the model interprets them at runtime. Interaction effects are
documented in each trait file.

---

### 3.4 Output Generators

**Responsibility:** Transform compiled persona data into platform-specific file
formats. Each generator understands the target platform's directory structure,
frontmatter format, and feature surface.

```
+------------------------------------------------------------------+
|                     Output Generators                             |
|                                                                   |
|  Compiled Persona Data                                            |
|  (traits resolved, weights applied, scope merged)                 |
|         |                                                         |
|         +----+----+----+----+                                     |
|              |    |    |    |                                      |
|         +----v--+ | +--v-+ |                                      |
|         |       | | |    | |                                      |
|   CC-Native  Cross  Plugin  Managed                               |
|   Generator  Plat.  Gen.    Settings                              |
|         |    Gen.    |      Gen.                                   |
|         |    |       |      |                                     |
|         v    v       v      v                                     |
|                                                                   |
|   .claude/     SKILL.md    plugin/     managed/                   |
|    agents/     copilot-     .claude-    managed-                  |
|    skills/      instr.md    plugin/     settings.json             |
|    rules/      GEMINI.md    agents/    managed-mcp.json           |
|    traits/     .cursor/     skills/    CLAUDE.md                  |
|    CLAUDE.md    rules/      hooks/                                |
|    settings.               .mcp.json                              |
|      json                  settings.                              |
|    .mcp.json                json                                  |
|                                                                   |
+------------------------------------------------------------------+
```

#### 3.4.1 CC-Native Generator

Produces the full Claude Code directory structure:

| Output File                            | Source                              | Key Features                         |
|----------------------------------------|-------------------------------------|--------------------------------------|
| `.claude/agents/{name}/CLAUDE.md`      | SKILL.md + persona.config.json      | Full frontmatter: model, permissionMode, maxTurns, disallowedTools, tools, skills, mcpServers, hooks, memory, isolation |
| `.claude/skills/{name}/SKILL.md`       | SKILL.md                            | `context: fork`, `agent:` reference, `argument-hint`, dynamic context injection |
| `.claude/rules/{topic}.md`             | Gotchas, domain rules               | `paths:` frontmatter for path-scoped activation |
| `.claude/traits/{name}.md`             | core/traits/*.md                    | Separate files for `@import` composition |
| `.claude/CLAUDE.md`                    | Always-on instructions + @imports   | `@.claude/traits/...` references, SME discoverability fragment |
| `.claude/settings.json`               | Domain hooks, compliance config     | Hook entries, permission rules |
| `.claude/.mcp.json`                    | Domain MCP servers                  | MCP server configurations |

#### 3.4.2 Cross-Platform Generator

Produces standalone files that work across agent platforms:

| Output File                             | Format                   | Target Platforms              |
|-----------------------------------------|--------------------------|-------------------------------|
| `skills/{name}/SKILL.md`               | agentskills.io (traits inlined) | All 26+ compatible platforms |
| `.github/copilot-instructions.md`      | Copilot format           | GitHub Copilot                |
| `.github/instructions/*.instructions.md` | Path-scoped instructions | Copilot (glob-scoped)        |
| `.github/prompts/*.prompt.md`          | Copilot prompt files     | VS Code Copilot Chat          |
| `.cursor/rules/*.md`                   | Cursor rules             | Cursor                        |
| `.cursorrules`                         | Flattened instructions   | Cursor (legacy)               |
| `GEMINI.md`                            | Gemini instructions      | Gemini CLI                    |
| `CLAUDE.md`                            | Flattened (no @imports)  | Claude Code (basic)           |

#### 3.4.3 Plugin Generator

Packages compiled output as a Claude Code plugin:

```
{plugin-name}/
  .claude-plugin/
    plugin.json                # Plugin metadata (name, version, description)
  agents/
    {name}/CLAUDE.md           # Agent definitions
  skills/
    {name}/SKILL.md            # Skill definitions
  hooks/
    hooks.json                 # Compliance and audit hooks
  .mcp.json                    # MCP server configurations
  settings.json                # Default agent, permissions
  README.md                    # Plugin documentation
```

#### 3.4.4 Managed Settings Generator

Produces artifacts for MDM deployment:

```
dist/managed/
  managed-settings.json        # Non-overridable hooks, permissions, lockdown flags
  managed-mcp.json             # Non-overridable MCP servers
  CLAUDE.md                    # Non-overridable instructions
```

These files deploy to system paths:
- macOS: `/Library/Application Support/ClaudeCode/`
- Linux: `/etc/claude-code/`

Managed settings cannot be overridden by any user or project configuration.

---

### 3.5 Sync Engine

**Responsibility:** Distribute compiled output from the hub repository to target
spoke repositories. Manage file writes, PR creation, manifest tracking, and
platform-specific output selection.

```
+------------------------------------------------------------------+
|                        Sync Engine                                |
|                                                                   |
|  +-------------------+                                            |
|  | repos.json        |    For each repo:                          |
|  |                   |                                            |
|  | [{                |    +------------------+                    |
|  |   name: "org/a",  |--->| Repo Targeter    |                    |
|  |   path: "/...",   |    |                  |                    |
|  |   team: "api",    |    | 1. Resolve scope |                    |
|  |   group:"platform"|    |    (org+group+   |                    |
|  |   platform: "cc"  |    |     team)        |                    |
|  | }]                |    | 2. Select output |                    |
|  +-------------------+    |    format        |                    |
|                           | 3. Merge layers  |                    |
|                           +--------+---------+                    |
|                                    |                              |
|           +------------------------+-------------------+          |
|           |                        |                   |          |
|   +-------v--------+    +---------v-------+   +-------v------+   |
|   | Local Writer    |    | GitHub API      |   | GitLab API   |   |
|   |                |    | Writer          |   | Writer       |   |
|   | Writes files   |    |                 |   |              |   |
|   | to local path  |    | Creates branch  |   | Creates MR   |   |
|   |                |    | Commits files   |   |              |   |
|   | Optional:      |    | Opens PR        |   |              |   |
|   | git commit +   |    |                 |   |              |   |
|   | open PR        |    |                 |   |              |   |
|   +-------+--------+    +--------+--------+   +------+-------+   |
|           |                      |                    |           |
|           +----------------------+--------------------+           |
|                                  |                                |
|                     +------------v-----------+                    |
|                     | Manifest Writer        |                    |
|                     |                        |                    |
|                     | Writes .agentboot-     |                    |
|                     |  manifest.json to      |                    |
|                     |  each target repo      |                    |
|                     |                        |                    |
|                     | Tracks: managed files, |                    |
|                     |  hashes, version,      |                    |
|                     |  sync timestamp        |                    |
|                     +------------------------+                    |
|                                                                   |
+------------------------------------------------------------------+
```

**Inputs:**
- `repos.json` -- array of repo entries with name, path, team, group, platform
- `dist/{platform}/` -- compiled output from the build system, one self-contained folder per platform
- `agentboot.config.json` -- sync mode, PR settings, output directory

**Outputs:**
- Files written to each target repo's output directory (default: `.claude/`)
- `.agentboot-manifest.json` in each target repo (tracks managed files)
- Pull requests (when `sync.pr.enabled: true` or `sync.mode: "github-api"`)

**Key Behaviors:**

1. **Platform Selection:** Each repo's `platform` field determines which `dist/{platform}/`
   folder it reads from (e.g., `claude`, `copilot`, `cursor`, `skill`, `gemini`).

2. **Scope Resolution:** The sync engine looks up each repo's group and team in the
   config, then merges `dist/{platform}/core/` + `dist/{platform}/groups/{group}/` +
   `dist/{platform}/teams/{group}/{team}/` to produce the effective output for that repo.

3. **Manifest Tracking:** Every file written by sync is recorded in
   `.agentboot-manifest.json` with its content hash. This enables clean uninstall --
   only files managed by AgentBoot are removed.

4. **PR Creation:** When configured, the sync engine creates a branch
   (`agentboot/sync-{date}`), commits all changes, and opens a PR. The PR is the
   governance checkpoint -- a human reviews the persona changes before they reach
   the team.

5. **Idempotency:** Re-running sync with identical compiled output produces no changes
   (no new commits, no new PRs). Changed files are detected via hash comparison
   against the manifest.

---

### 3.6 Knowledge Server

**Responsibility:** Provide structured and semantic access to organizational knowledge
(gotchas, ADRs, incident learnings, standards, patterns) via MCP protocol. Supports
a three-stage progression from flat files to vector/RAG.

```
+------------------------------------------------------------------+
|                      Knowledge Server                             |
|                                                                   |
|  +-------------------+                                            |
|  | Knowledge Sources |                                            |
|  |                   |                                            |
|  | gotchas/*.md      |    +-----------------+                     |
|  | adrs/*.md         |--->| Indexer          |                     |
|  | incidents/*.md    |    |                  |                     |
|  | standards/*.md    |    | Reads frontmatter|                     |
|  | patterns/*.md     |    | Builds SQLite    |                     |
|  +-------------------+    | index            |                     |
|                           | (agentboot build |                     |
|                           |  --index)        |                     |
|                           +--------+---------+                     |
|                                    |                               |
|                           +--------v---------+                     |
|                           | knowledge.db     |                     |
|                           | (SQLite)         |                     |
|                           |                  |                     |
|                           | Structured index |                     |
|                           | + (optional)     |                     |
|                           | vector embeddings|                     |
|                           | via sqlite-vss   |                     |
|                           +--------+---------+                     |
|                                    |                               |
|                           +--------v---------+                     |
|                           | MCP Server       |                     |
|                           | (@agentboot/     |                     |
|                           |  knowledge-      |                     |
|                           |  server)         |                     |
|                           |                  |                     |
|                           | Tools:           |                     |
|                           |  kb_search       |                     |
|                           |  kb_get          |                     |
|                           |  kb_related      |                     |
|                           |  kb_list         |                     |
|                           |  kb_semantic_    |                     |
|                           |   search (S3)    |                     |
|                           |  kb_relevant_    |                     |
|                           |   to_diff (S3)   |                     |
|                           +------------------+                     |
|                                                                   |
+------------------------------------------------------------------+
```

**Three-Stage Progression:**

| Stage | Backing Store | Retrieval Method | Scale       | Cost  |
|-------|---------------|------------------|-------------|-------|
| 1     | Flat files    | Path-scoped load | 5-50 items  | Free  |
| 2     | SQLite index  | Tag/category queries | 50-500 items | Free |
| 3     | SQLite + sqlite-vss | Vector similarity | 500+ items | $ (embedding API) |

**Critical Design Property:** The MCP interface is stable across all three stages.
Personas call the same tools regardless of whether the backing store is flat files,
SQLite, or vector embeddings. The MCP interface is the abstraction boundary.

**MCP Tools:**

| Tool                         | Stage | Description                                |
|------------------------------|-------|--------------------------------------------|
| `agentboot_kb_search`        | 2+    | Query by tags, technology, severity        |
| `agentboot_kb_get`           | 2+    | Retrieve a specific item by ID             |
| `agentboot_kb_related`       | 2+    | Find items related to a given item         |
| `agentboot_kb_list`          | 2+    | List items by type and filter              |
| `agentboot_kb_semantic_search` | 3   | Vector similarity search                   |
| `agentboot_kb_relevant_to_diff` | 3  | Find knowledge relevant to a code diff     |

---

### 3.7 Telemetry System

**Responsibility:** Emit structured telemetry from persona invocations for cost
optimization, coverage tracking, quality feedback, and adoption metrics.

```
+------------------------------------------------------------------+
|                      Telemetry System                             |
|                                                                   |
|  +-------------------+                                            |
|  | Hook Scripts      |    Generated by build system               |
|  |                   |    Deployed to .claude/hooks/              |
|  | audit-session-    |                                            |
|  |  start.sh         |                                            |
|  | audit-persona-    |                                            |
|  |  start.sh         |                                            |
|  | audit-persona-    |                                            |
|  |  stop.sh          |                                            |
|  | audit-tool-use.sh |                                            |
|  | audit-session-    |                                            |
|  |  end.sh           |                                            |
|  +--------+----------+                                            |
|           |                                                       |
|           | (async -- non-blocking)                               |
|           |                                                       |
|  +--------v----------+                                            |
|  | NDJSON Writer     |    One JSON line per event                 |
|  |                   |                                            |
|  | Writes to:        |                                            |
|  |  .agentboot/      |                                            |
|  |   telemetry.ndjson|                                            |
|  +--------+----------+                                            |
|           |                                                       |
|  +--------v----------+                                            |
|  | Metrics           |    agentboot metrics                       |
|  | Aggregator        |                                            |
|  |                   |    Reads NDJSON, produces:                  |
|  | Per-persona stats |    - Invocation counts                     |
|  | Per-team stats    |    - Token usage                           |
|  | Per-period stats  |    - Cost estimates                        |
|  |                   |    - Finding distributions                  |
|  +-------------------+    - Adoption rates                        |
|                                                                   |
+------------------------------------------------------------------+
```

**Telemetry Event Schema (GELF/NDJSON):**

```json
{
  "persona_id": "review-security",
  "model": "claude-sonnet-4-6",
  "scope": "team:platform/api",
  "product": "my-app",
  "session_id": "abc123",
  "input_tokens": 4200,
  "output_tokens": 1800,
  "outcome": "completed",
  "findings": { "CRITICAL": 0, "ERROR": 1, "WARN": 3, "INFO": 2 },
  "duration_ms": 12400,
  "timestamp": "2026-03-19T14:30:00Z"
}
```

**Key Properties:**
- All hooks are async -- they do not block the developer workflow.
- Output is NDJSON (one JSON object per line) -- queryable with `jq` from day one.
- No dashboarding infrastructure required. `jq` and shell scripts are sufficient
  for initial analysis.
- Raw prompts are never captured. Only structured metadata.

**Hook Events Used:**

| Hook Event        | Telemetry Action                          | Async |
|-------------------|-------------------------------------------|-------|
| `SessionStart`    | Log session initiation with env context   | Yes   |
| `SubagentStart`   | Log persona invocation                    | Yes   |
| `SubagentStop`    | Log persona completion + token counts     | Yes   |
| `PostToolUse`     | Log tool usage (Edit, Write, Bash only)   | Yes   |
| `SessionEnd`      | Log session summary                       | Yes   |

---

### 3.8 Plugin System

**Responsibility:** Package AgentBoot compiled output as installable Claude Code
plugins. Support private marketplace hosting, version management, and force-enable
via managed settings.

```
+------------------------------------------------------------------+
|                       Plugin System                               |
|                                                                   |
|  +-------------------+    +-------------------+                   |
|  | Plugin Packager   |    | Marketplace       |                   |
|  |                   |    | Publisher          |                   |
|  | agentboot export  |    |                   |                   |
|  |  --format plugin  |    | agentboot publish |                   |
|  |                   |    |                   |                   |
|  | Reads:dist/claude/|    | Reads: plugin/    |                   |
|  | Writes: plugin/   |    | Writes:           |                   |
|  |  with plugin.json |    |  marketplace.json |                   |
|  |  and proper CC    |    |  in marketplace   |                   |
|  |  directory layout |    |  repo             |                   |
|  +--------+----------+    +--------+----------+                   |
|           |                        |                              |
|  +--------v----------+    +--------v----------+                   |
|  | Plugin Package    |    | Marketplace Repo  |                   |
|  |                   |    |                   |                   |
|  | plugin.json       |    | .claude-plugin/   |                   |
|  | agents/           |    |  marketplace.json |                   |
|  | skills/           |    | plugins/          |                   |
|  | hooks/            |    |  acme/            |                   |
|  | .mcp.json         |    |  healthcare/      |                   |
|  | settings.json     |    |  fintech/         |                   |
|  +-------------------+    +-------------------+                   |
|                                                                   |
|  Installation:                                                    |
|                                                                   |
|  /plugin marketplace add {org}/{marketplace-repo}                 |
|  /plugin install {plugin-name}                                    |
|                                                                   |
|  Force-enable via managed settings:                               |
|  { "enabledPlugins": { "acme@acme-personas": true } }            |
|                                                                   |
+------------------------------------------------------------------+
```

**Marketplace Layers:**

| Layer     | Quality Bar                     | Governance           |
|-----------|---------------------------------|----------------------|
| Core      | Maintained by AgentBoot project | Apache 2.0, tested   |
| Verified  | Reviewed by maintainer          | License-compatible   |
| Community | Valid frontmatter only          | Buyer beware         |

**Plugin Lifecycle:**

1. `agentboot build` -- compiles personas and traits
2. `agentboot export --format plugin` -- packages as CC plugin
3. `agentboot publish` -- pushes to marketplace repository
4. Developer: `/plugin install {name}` -- installs from marketplace
5. IT: managed settings force-enable -- zero developer action
6. `/reload-plugins` -- picks up updates without restart

---

## 4. Data Architecture

### 4.1 agentboot.config.json

The root configuration file. JSONC format (comments allowed). Validated against
JSON Schema on every build.

```
agentboot.config.json
|
+-- org: string (required)
|     Organization identifier. Lowercase alphanumeric + hyphens.
|     Pattern: ^[a-z0-9][a-z0-9-]*[a-z0-9]$
|
+-- groups: object
|     |
|     +-- {group-name}: GroupConfig
|           |
|           +-- teams: string[] (required)
|           +-- personas: PersonasConfig
|           +-- traits: TraitsConfig
|           +-- extend: string (path to group extensions)
|
+-- personas: PersonasConfig
|     |
|     +-- enabled: string[]
|     |     Default: ["code-reviewer", "security-reviewer",
|     |               "test-generator", "test-data-expert"]
|     +-- extend: string | null
|           Path to org-specific persona directory.
|
+-- traits: TraitsConfig
|     |
|     +-- enabled: string[]
|           Default: all traits in core/traits/
|
+-- sync: SyncConfig
|     |
|     +-- repos: string | RepoConfig[]
|     |     Default: "./repos.json"
|     +-- mode: "local" | "github-api"
|     |     Default: "local"
|     +-- pr: SyncPrConfig
|           |
|           +-- enabled: boolean (default: false)
|           +-- branch_prefix: string (default: "agentboot/sync-")
|           +-- title_template: string
|
+-- output: OutputConfig
|     |
|     +-- dir: string (default: ".claude")
|     +-- format: "claude-code" | "cross-platform" | "both"
|     |     Default: "both"
|     +-- personas_registry: boolean (default: true)
|     +-- hooks: boolean (default: true)
|     +-- mcp: boolean (default: true)
|     +-- managed: boolean (default: false)
|
+-- extend: ExtendConfig
      |
      +-- domains: string[]
      |     Default: []
      +-- instructions: string | null
            Path to org-level always-on instructions.
```

**Full JSON Schema:** Defined in `docs/configuration.md` with `$id:
https://agentboot.dev/schema/config/v1`.

---

### 4.2 persona.config.json

Per-persona build metadata. Lives at `core/personas/{name}/persona.config.json`.

> **Note:** The formal schema for this file is defined in technical-spec.md Section 5.
> The schema below summarizes the structure.

```
persona.config.json
|
+-- id: string (required)
|     Must match the persona directory name.
|
+-- name: string
|     Human-readable display name.
|
+-- description: string
|     One-line description for SME discoverability fragment.
|
+-- traits: object (required)
|     |
|     +-- {trait-id}: string | number | boolean
|           string: "HIGH" | "MEDIUM" | "LOW" | "OFF" | "MAX"
|           number: 0.0 - 1.0
|           boolean: true (default weight) / false (disabled)
|
+-- model: string
|     Recommended model. "opus" | "sonnet" | "haiku"
|
+-- permissionMode: string
|     "default" | "plan" | "acceptEdits" | "bypassPermissions"
|     Review personas should use "plan" (read-only).
|
+-- maxTurns: number
|     Agentic turn limit.
|
+-- tools: string[]
|     Tool allowlist (alternative to disallowedTools).
|
+-- disallowedTools: string[]
|     Tool denylist. E.g., ["Edit", "Write", "Agent"]
|
+-- skills: string[]
|     Skills to preload into agent context.
|
+-- mcpServers: string[]
|     MCP server references (must exist in .mcp.json).
|
+-- hooks: object
|     Agent-specific hooks (merged with domain hooks).
|
+-- memory: string
|     "project" | "local" | null
|
+-- isolation: string
|     "worktree" | null
|
+-- autonomy: string
|     "advisory" | "auto-approve" | "autonomous"
|     Default: "advisory"
|
+-- context: string
|     "fork" | null (for skills that delegate to this agent)
```

---

### 4.3 repos.json

Repository registry. Defines the spoke repos that receive compiled output.

```json
[
  {
    "name": "org/api-service",
    "path": "/absolute/path/to/api-service",
    "team": "api",
    "group": "platform",
    "platform": "claude-code"
  },
  {
    "name": "org/web-app",
    "path": "/absolute/path/to/web-app",
    "team": "web",
    "group": "product",
    "platform": "copilot"
  }
]
```

| Field      | Type   | Required | Description                                |
|------------|--------|----------|--------------------------------------------|
| `name`     | string | Yes      | GitHub repo slug (org/repo)                |
| `path`     | string | Yes*     | Absolute local path (* for local mode)     |
| `team`     | string | No       | Team name (must match config)              |
| `group`    | string | No       | Group name (must match config)             |
| `platform` | string | No       | `claude-code` (default), `copilot`, `cursor`, `cross-platform` |

---

### 4.4 SKILL.md Frontmatter (agentskills.io Format)

The cross-platform persona definition format. Supported by 26+ agent platforms.

```yaml
---
id: review-code
name: Code Reviewer
version: 1.0.0
traits:
  critical-thinking: MEDIUM
  structured-output: true
  source-citation: true
  confidence-signaling: true
scope: pr
output_format: structured
---

[Persona system prompt in prose]
```

| Field           | Type           | Description                                |
|-----------------|----------------|--------------------------------------------|
| `id`            | string         | Machine-readable identifier                |
| `name`          | string         | Human-readable name                        |
| `version`       | semver string  | Persona version                            |
| `traits`        | object         | Trait references with weight config        |
| `scope`         | string         | `pr`, `file`, `project`                    |
| `output_format` | string         | `structured`, `prose`, `json`              |

---

### 4.5 Agent CLAUDE.md Frontmatter (CC-Native Format)

Extended frontmatter for Claude Code agents. Superset of SKILL.md capabilities.

```yaml
---
name: review-security
description: Deep security review -- OWASP, auth, data handling, PHI
model: opus
permissionMode: plan
maxTurns: 25
disallowedTools: Edit, Write, Agent
tools: Read, Grep, Glob, Bash
skills:
  - hipaa-check
  - review-security
mcpServers:
  - compliance-kb
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./hooks/validate-no-phi.sh"
memory: project
isolation: worktree
---
```

This format is CC-only. The build system generates it from `persona.config.json` and
includes all CC-specific fields that the agentskills.io SKILL.md format cannot express.

---

### 4.6 Telemetry Event Schema

GELF/NDJSON format. One JSON object per line. Written by async hook scripts.

```json
{
  "event_type": "persona_invocation",
  "persona_id": "review-security",
  "model": "claude-sonnet-4-6",
  "scope": "team:platform/api",
  "product": "my-app",
  "session_id": "abc123",
  "input_tokens": 4200,
  "output_tokens": 1800,
  "outcome": "completed",
  "findings": {
    "CRITICAL": 0,
    "ERROR": 1,
    "WARN": 3,
    "INFO": 2
  },
  "duration_ms": 12400,
  "timestamp": "2026-03-19T14:30:00Z"
}
```

| Field          | Type    | Description                                        |
|----------------|---------|----------------------------------------------------|
| `event_type`   | string  | `session_start`, `persona_invocation`, `tool_use`, `session_end` |
| `persona_id`   | string  | Which persona was invoked                          |
| `model`        | string  | LLM model used                                    |
| `scope`        | string  | Scope context (org, group:name, team:group/name)   |
| `product`      | string  | Target repo or product name                        |
| `session_id`   | string  | Unique session identifier                          |
| `input_tokens` | number  | Input token count                                  |
| `output_tokens`| number  | Output token count                                 |
| `outcome`      | string  | `completed`, `error`, `timeout`, `cancelled`       |
| `findings`     | object  | Severity distribution of findings                  |
| `duration_ms`  | number  | Total wall-clock duration                          |
| `timestamp`    | ISO8601 | Event timestamp                                    |

**Privacy invariant:** No field in the telemetry schema captures raw prompts,
conversation content, or code snippets. Only structured metadata.

---

### 4.7 Knowledge Item Schema

Knowledge items are markdown files with optional frontmatter for structured
queryability (Stage 2+).

```yaml
---
type: gotcha
technology: postgres
tags: [rls, partitions, security]
severity: high
learned_from: incident-2025-Q3
domain: database
applies_to: [api-service, auth-service]
last_validated: 2026-01-15
---

# PostgreSQL RLS on Partitions

Partitions do NOT inherit `relrowsecurity`...
```

| Field            | Type     | Required | Stage | Description                     |
|------------------|----------|----------|-------|---------------------------------|
| `type`           | string   | Yes (S2) | 2+    | `gotcha`, `adr`, `incident`, `standard`, `pattern` |
| `technology`     | string   | No       | 2+    | Primary technology              |
| `tags`           | string[] | No       | 2+    | Searchable tags                 |
| `severity`       | string   | No       | 2+    | `critical`, `high`, `medium`, `low` |
| `learned_from`   | string   | No       | 2+    | Source event (incident ID, etc.)|
| `domain`         | string   | No       | 2+    | Business domain                 |
| `applies_to`     | string[] | No       | 2+    | Affected services/repos         |
| `last_validated` | date     | No       | 2+    | When the knowledge was last confirmed |

Files without frontmatter degrade gracefully to Stage 1 behavior (full context load).

---

### 4.8 .agentboot-manifest.json

Tracks all files managed by AgentBoot in a target repo. Written by the sync engine.
Used by uninstall to identify which files to remove.

```json
{
  "managed_by": "agentboot",
  "version": "1.2.0",
  "synced_at": "2026-03-19T14:30:00Z",
  "hub_repo": "org/org-personas",
  "scope": {
    "group": "platform",
    "team": "api"
  },
  "files": [
    {
      "path": "agents/code-reviewer/CLAUDE.md",
      "hash": "a3f2e8c1d4b9..."
    },
    {
      "path": "skills/review-code/SKILL.md",
      "hash": "7b1c3e9f2a6d..."
    },
    {
      "path": "traits/critical-thinking.md",
      "hash": "e4d8a1b7c3f5..."
    }
  ]
}
```

| Field       | Type     | Description                                        |
|-------------|----------|----------------------------------------------------|
| `managed_by`| string   | Always `"agentboot"`                               |
| `version`   | semver   | AgentBoot version that performed the sync          |
| `synced_at` | ISO8601  | Timestamp of the sync                              |
| `hub_repo`  | string   | GitHub slug of the source hub repo                 |
| `scope`     | object   | Group and team scope for this repo                 |
| `files`     | array    | List of managed file paths (relative to output dir) and content hashes |

**Key behaviors:**
- If a managed file's hash no longer matches on disk, uninstall warns that the file
  was modified locally.
- Files NOT in the manifest are never touched by uninstall.
- The manifest itself is a managed file.

---

### 4.9 marketplace.json

Plugin marketplace catalog. Lives in the marketplace repository at
`.claude-plugin/marketplace.json`.

```json
{
  "name": "acme-personas",
  "displayName": "Acme Corp AI Personas",
  "owner": {
    "name": "Acme Platform Team"
  },
  "plugins": [
    {
      "name": "acme",
      "source": "./plugins/acme",
      "description": "Acme-customized AgentBoot with compliance",
      "version": "1.0.0"
    }
  ]
}
```

| Field         | Type   | Description                                     |
|---------------|--------|-------------------------------------------------|
| `name`        | string | Marketplace identifier                          |
| `displayName` | string | Human-readable marketplace name                 |
| `owner`       | object | Marketplace owner info                          |
| `plugins`     | array  | List of available plugins with name, source, description, version |

---

### 4.10 plugin.json

Individual plugin metadata. Lives at `{plugin}/.claude-plugin/plugin.json`.

```json
{
  "name": "acme",
  "version": "1.2.0",
  "description": "Acme Corp AI persona governance plugin",
  "author": "Acme Platform Team",
  "license": "Apache-2.0",
  "agentboot_version": ">=1.0.0",
  "personas": ["code-reviewer", "security-reviewer", "test-generator"],
  "traits": ["critical-thinking", "structured-output", "source-citation"]
}
```

---

### 4.11 agentboot.domain.json

Domain layer manifest. Registers domain content with the build system.

```json
{
  "name": "healthcare-compliance",
  "version": "1.0.0",
  "description": "Healthcare compliance domain (HIPAA, PHI, FHIR)",
  "traits": ["phi-awareness", "hipaa-enforcement", "fhir-awareness"],
  "personas": ["hipaa-reviewer", "compliance-checker"],
  "requires_core_version": ">=1.0.0",
  "license": "Apache-2.0"
}
```

---

## 5. Scope Hierarchy & Merge Semantics

### 5.1 The Four Levels

```
+--------------------------------------------------------------+
|                          ORG                                  |
|  Universal rules. Active in every repo. Cannot be disabled   |
|  by any lower scope.                                         |
|                                                              |
|  +---------------------------------------------------------+ |
|  |                       GROUP                              | |
|  |  Horizontal concerns that cross teams. E.g., "platform"  | |
|  |  group adds API contract review for all platform teams.  | |
|  |                                                          | |
|  |  +----------------------------------------------------+  | |
|  |  |                    TEAM                             |  | |
|  |  |  Team-specific customization. Framework-specific    |  | |
|  |  |  traits, team standards, domain knowledge.          |  | |
|  |  |                                                     |  | |
|  |  |  +-----------------------------------------------+  |  | |
|  |  |  |                 REPO                           |  |  | |
|  |  |  |  Path-scoped instructions. Activate only when  |  |  | |
|  |  |  |  specific file types or directories are        |  |  | |
|  |  |  |  touched.                                      |  |  | |
|  |  |  +-----------------------------------------------+  |  | |
|  |  +----------------------------------------------------+  | |
|  +---------------------------------------------------------+ |
+--------------------------------------------------------------+
```

### 5.2 What Each Level Controls

| Level | Controls                                       | Storage Location              |
|-------|------------------------------------------------|-------------------------------|
| Org   | Enabled personas, enabled traits, always-on instructions, compliance hooks, managed settings | `agentboot.config.json` (root), `core/` |
| Group | Additional personas, additional traits, group extensions | `agentboot.config.json` (`groups.{name}`) |
| Team  | Team-level trait overrides, team-specific gotchas | `repos.json` (team field), team extensions |
| Repo  | Path-scoped rules (activated by file pattern)  | `.claude/rules/` with `paths:` frontmatter |

### 5.3 Merge Algorithm

The sync engine performs scope merging when determining the effective configuration
for a target repo:

```
function resolveEffectiveConfig(repo: RepoConfig): EffectiveConfig {
  // Step 1: Start with org-level configuration
  let effective = loadOrgConfig()

  // Step 2: If repo belongs to a group, merge group config
  if (repo.group) {
    const groupConfig = loadGroupConfig(repo.group)
    effective = mergeScopes(effective, groupConfig)
  }

  // Step 3: If repo belongs to a team, merge team config
  if (repo.team && repo.group) {
    const teamConfig = loadTeamConfig(repo.group, repo.team)
    effective = mergeScopes(effective, teamConfig)
  }

  return effective
}
```

### 5.4 Merge Rules

The `mergeScopes` function follows these rules:

#### Rule 1: Personas -- Additive Union

```
Org:   [code-reviewer, security-reviewer]
Group: [code-reviewer, security-reviewer, api-contract-reviewer]
Team:  (no override)

Result: [code-reviewer, security-reviewer, api-contract-reviewer]
```

Lower scopes can ADD personas. They cannot REMOVE org-level personas.

#### Rule 2: Traits -- Additive Union (with weight override)

```
Org:   { critical-thinking: MEDIUM, structured-output: true }
Group: { critical-thinking: HIGH, schema-awareness: true }
Team:  (no override)

Result: { critical-thinking: HIGH, structured-output: true, schema-awareness: true }
```

Lower scopes can ADD traits and OVERRIDE weights of existing traits. They cannot
remove org-level traits.

#### Rule 3: Instructions -- Concatenation

```
Org:   [no-secrets.md, code-style.md]
Group: [api-standards.md]
Team:  [team-conventions.md]

Result: [no-secrets.md, code-style.md, api-standards.md, team-conventions.md]
```

Instructions from all scopes are concatenated. No removal, no override.

#### Rule 4: Hooks -- Merge with Event-Level Override

```
Org:   { UserPromptSubmit: [phi-scan] }
Group: { PreToolUse: [block-dangerous-commands] }
Team:  { UserPromptSubmit: [phi-scan, team-specific-scan] }

Result: { UserPromptSubmit: [phi-scan, team-specific-scan],
          PreToolUse: [block-dangerous-commands] }
```

Hooks merge by event type. Within an event type, the most specific scope's hook
list wins entirely (not merged at the individual hook level).

### 5.5 Mandatory vs. Optional

The distinction between mandatory and optional determines conflict resolution:

**Mandatory** (org wins):
- Traits or personas marked `required: true` in org config
- HARD guardrails (compliance hooks in managed settings)
- Always-on instructions from org scope
- Any configuration deployed via MDM

A team-level config that attempts to disable a mandatory trait or persona causes a
**build failure**. This is an error, not a silent override.

**Optional** (team wins):
- Trait weight adjustments (team sets critical-thinking to HIGH vs. org default MEDIUM)
- Additional personas added at team level
- Team-specific gotchas and path-scoped rules
- Soft guardrail configurations

```
Mandatory: Org ──────────────────────────> All scopes (cannot be overridden)
                  propagates downward

Optional:  Org <── Group <── Team <── Repo (most specific wins)
                  most specific wins
```

### 5.6 Conflict Detection

The build system detects and reports scope conflicts:

| Conflict Type                          | Behavior           |
|----------------------------------------|--------------------|
| Team disables required org persona     | **Build error**    |
| Team disables required org trait       | **Build error**    |
| Team overrides optional trait weight   | Allowed (team wins)|
| Group and team both set same trait weight | Team wins        |
| Domain extension conflicts with base rule | Extension ignored, logged |
| Two domains define same trait ID       | **Build error**    |

---

## 6. Build Pipeline

### 6.1 Detailed Flow

```
  SOURCE FILES                     VALIDATION                    COMPILATION
  ────────────                     ──────────                    ───────────

  agentboot.config.json ─────┐
                              │
  core/                       │     +──────────────────────+
    traits/                   │     │                      │
      critical-thinking.md    ├────>│  1. Config Schema    │
      structured-output.md    │     │     Validate against │
      source-citation.md      │     │     JSON Schema      │
      ...                     │     │                      │
                              │     │  2. Persona Check    │
    personas/                 │     │     Every enabled     │
      code-reviewer/          │     │     persona exists    │
        SKILL.md              │     │     in core/ or       │
        persona.config.json   ├────>│     extension dir     │
      security-reviewer/      │     │                      │
        SKILL.md              │     │  3. Trait References  │
        persona.config.json   │     │     Every trait ref'd │
      ...                     │     │     in persona.config │
                              │     │     exists in traits/ │
    instructions/             │     │                      │
      no-secrets.md           ├────>│  4. Frontmatter      │
      code-style.md           │     │     SKILL.md has      │
      ...                     │     │     required fields   │
                              │     │                      │
  domains/                    │     │  5. PERSONAS.md Sync  │
    healthcare/               ├────>│     Registry matches  │
      agentboot.domain.json   │     │     compiled personas │
      traits/                 │     │                      │
      personas/               │     │  6. Secret Scanning   │
      instructions/           │     │     No credentials    │
      hooks/                  │     │     in any source file│
                              │     │                      │
  repos.json ─────────────────┘     +──────────+───────────+
                                               │
                                          pass │ fail
                                               │
                                    +──────────v───────────+
                                    │                      │
                                    │  COMPILATION         │
                                    │                      │
                                    │  For each persona:   │
                                    │                      │
                                    │  1. Load SKILL.md    │
                                    │  2. Load persona.    │
                                    │     config.json      │
                                    │  3. Resolve traits:  │
                                    │     a. Find trait     │
                                    │        file           │
                                    │     b. Resolve weight │
                                    │        (named->num)   │
                                    │     c. Extract        │
                                    │        weight section │
                                    │  4. Apply domain      │
                                    │     extensions        │
                                    │  5. Generate output:  │
                                    │                      │
                                    +──────────+───────────+
                                               │
                              +────────────────+────────────────+
                              │                │                │
                    +---------v------+  +------v-------+  +----v---------+
                    | CC-Native      |  | Cross-Plat.  |  | Plugin       |
                    |                |  |              |  |              |
                    | @import CLAUDE |  | Inline SKILL |  | plugin.json  |
                    | agent CLAUDE   |  | copilot-     |  | agents/      |
                    | skill SKILL    |  |  instr.md    |  | skills/      |
                    | rules w/paths  |  | cursor rules |  | hooks.json   |
                    | traits (sep.)  |  | GEMINI.md    |  | .mcp.json    |
                    | settings.json  |  |              |  |              |
                    | .mcp.json      |  |              |  |              |
                    +-------+--------+  +------+-------+  +------+-------+
                            |                  |                  |
                            v                  v                  v
                    dist/claude/        dist/skill/         dist/plugin/
                    dist/copilot/       dist/gemini/
                    dist/cursor/
```

### 6.2 Validation Phase

Six checks, executed in order. Any failure blocks the build.

| Check                    | What It Validates                              | Error Behavior |
|--------------------------|------------------------------------------------|----------------|
| **Config Schema**        | `agentboot.config.json` matches JSON Schema    | Build fails with schema violation details |
| **Persona Existence**    | Every persona in `personas.enabled` exists as a directory | Build fails listing missing personas |
| **Trait References**     | Every trait referenced in any `persona.config.json` exists in `core/traits/` or domain layers | Build fails listing unresolvable traits |
| **SKILL.md Frontmatter** | Every persona's SKILL.md has required frontmatter fields (id, name, version) | Build fails listing invalid files |
| **PERSONAS.md Sync**     | Generated PERSONAS.md matches current persona inventory | Warning (or error in strict mode) |
| **Secret Scanning**      | No source file contains patterns matching `validation.secretPatterns` | Build fails listing offending files/lines |

**Error handling:**
- Errors are printed with the exact file and line number.
- Every error includes a suggested fix command.
- `--strict` mode treats warnings as errors.
- `--validate-only` runs validation without proceeding to compilation.

### 6.3 Compilation Phase

For each enabled persona:

1. **Load SKILL.md:** Parse frontmatter and prose body.

2. **Load persona.config.json:** Extract trait references with weights.

3. **Resolve trait references:**
   - Look up each trait in `core/traits/`, then domain layers (in order).
   - If a named weight (HIGH/MEDIUM/LOW), map to numeric (0.7/0.5/0.3).
   - Extract the section of the trait file corresponding to the weight level.

4. **Apply domain extensions:**
   - Load `domains/{domain}/extensions/{persona-name}.md` if it exists.
   - Extension content adds to the persona; it does not replace base content.

5. **Process always-on instructions:**
   - Load all enabled instruction fragments from `core/instructions/`.
   - Load domain-level always-on instructions.

6. **Generate output per format:**

   **CC-Native:**
   - Write trait files to `.claude/traits/{name}.md`
   - Generate CLAUDE.md with `@.claude/traits/{name}.md` imports
   - Generate `.claude/agents/{name}/CLAUDE.md` with full frontmatter from
     persona.config.json (model, permissionMode, maxTurns, tools, etc.)
   - Generate `.claude/skills/{name}/SKILL.md` with `context: fork` and `agent:` ref
   - Generate `.claude/rules/{topic}.md` with `paths:` frontmatter
   - Generate `.claude/settings.json` with hook entries and permission rules
   - Generate `.claude/.mcp.json` with MCP server configurations
   - Generate SME discoverability fragment (list of available personas)

   **Cross-Platform:**
   - Inline all trait content between `<!-- traits:start -->` and `<!-- traits:end -->`
     markers in SKILL.md
   - Generate `copilot-instructions.md` from flattened instructions
   - Generate Copilot prompt files from personas
   - Generate `.cursor/rules/` from gotchas and instructions
   - Generate `GEMINI.md` from flattened instructions

7. **Generate PERSONAS.md registry:**
   - Auto-generated persona inventory with ID, name, description, invocation command.

### 6.4 Frontmatter Generation

The build system generates different frontmatter for each output format:

**SKILL.md (agentskills.io -- cross-platform):**
```yaml
---
id: review-code
name: Code Reviewer
version: 1.2.0
traits:
  critical-thinking: MEDIUM
  structured-output: true
  source-citation: true
scope: pr
output_format: structured
---
```

**Agent CLAUDE.md (CC-native):**
```yaml
---
name: review-code
description: Code review against team standards
model: sonnet
permissionMode: plan
maxTurns: 25
disallowedTools: Edit, Write, Agent
skills:
  - review-code
mcpServers:
  - compliance-kb
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: ".claude/hooks/block-dangerous-commands.sh"
memory: project
---
```

The CC-native frontmatter is a superset. Fields not supported by SKILL.md are
only included in CC-native output.

### 6.5 @import Generation

For CC-native output, the generated CLAUDE.md uses `@import` syntax:

```markdown
# Project Instructions

@.claude/traits/critical-thinking.md
@.claude/traits/structured-output.md
@.claude/traits/source-citation.md

## Always-On Instructions

@.claude/instructions/no-secrets.md
@.claude/instructions/code-style.md

## Available Personas

| Command            | What it does                          |
|--------------------|---------------------------------------|
| /review-code       | Code review against team standards    |
| /review-security   | Security-focused review               |
| /gen-tests         | Generate unit and integration tests   |
```

### 6.6 Plugin Packaging

When `agentboot export --format plugin` is invoked:

1. Read compiled CC-native output from `dist/claude/`
2. Generate `plugin.json` with metadata from `agentboot.config.json`
3. Copy agents, skills, hooks, MCP config into plugin directory structure
4. Generate settings.json with default agent and permissions
5. Generate README.md from persona registry

The plugin directory structure matches the Claude Code plugin specification exactly.

---

## 7. Distribution Architecture

### 7.1 Distribution Channels

```
                  agentboot build
                        |
     +------+------+------+------+------+
     |      |      |      |      |      |
     v      v      v      v      v      v
  dist/  dist/  dist/  dist/  dist/  dist/
  claude copilot cursor skill  gemini plugin
     |      |      |      |      |      |
     v      v      v      v      v      v
  Channel: Direct Sync           Channel:
  (each platform folder is       Marketplace
   self-contained; sync reads
   dist/{platform}/ and writes   Private or
   to repos in platform-native   public CC
   locations)                    marketplace
     |      |      |      |      |      |
     v      v      v      v      v      v
  CC     Copilot Cursor  Any   Gemini CC users
  repos  repos   repos   plat  repos
                  Gemini repos      install via
                                    /plugin install

     +------------------+    +-------------------+
     | Channel:         |    | Channel:          |
     | Managed Settings |    | MCP Server        |
     |                  |    |                   |
     | MDM deploys to   |    | Live persona      |
     | system paths     |    | serving to any    |
     | HARD guardrails  |    | MCP client        |
     | only             |    | Cross-platform    |
     +------------------+    +-------------------+
```

### 7.2 Channel Comparison

| Channel           | Target      | Update Mechanism    | Enforcement   | Effort |
|-------------------|-------------|---------------------|---------------|--------|
| Direct Sync       | Any repo    | `agentboot sync` + PR | PR review    | Low    |
| CC Plugin         | CC users    | `/reload-plugins`   | Namespace     | Medium |
| Managed Settings  | All CC on machine | MDM push       | OS-level      | High   |
| MCP Server        | Any MCP client | Server restart   | None (advisory)| High  |

### 7.3 Direct Sync Flow

```
Hub Repo                     Target Repo
────────                     ───────────

agentboot.config.json
core/
domains/
    │
    │  agentboot build
    ▼
  dist/
    │
    │  agentboot sync
    │
    │  For each repo in repos.json:
    │    1. Resolve scope (org + group + team)
    │    2. Select platform folder (from repo.platform → dist/{platform}/)
    │    3. Merge dist/{platform}/core/ + groups/ + teams/ + public-repos/{repo}/
    │    4. If repo.public: verify .gitignore includes .claude/, skip PR
    │    5. Write files to repo.path in platform-native locations
    │    6. Write .agentboot-manifest.json
    │    7. (Private repos only) git commit + open PR
    ▼
                              .claude/
                                agents/
                                skills/
                                rules/
                                traits/
                                CLAUDE.md
                                settings.json
                                .mcp.json
                              .agentboot-manifest.json
```

### 7.4 Plugin Marketplace Flow

```
Hub Repo                     Marketplace Repo               Developer Machine
────────                     ────────────────               ─────────────────

agentboot build
    │
    │ agentboot export
    │   --format plugin
    ▼
  dist/plugin/
    │
    │ agentboot publish
    │   --marketplace
    │   org/org-personas
    ▼
                              marketplace.json
                              plugins/
                                acme/
                                  .claude-plugin/
                                    plugin.json
                                  agents/
                                  skills/
                                  ...
                                                              /plugin marketplace add
                                                                org/org-personas
                                                              /plugin install acme
                                                                    │
                                                                    ▼
                                                              ~/.claude/plugins/
                                                                acme/
                                                                  agents/
                                                                  skills/
                                                                  ...
```

### 7.5 Managed Settings Flow

```
Hub Repo                     IT / MDM Console               Developer Machine
────────                     ────────────────               ─────────────────

agentboot build
    │
    │ agentboot export
    │   --format managed
    ▼
  dist/managed/
    managed-settings.json
    managed-mcp.json          Upload to Jamf /
    CLAUDE.md                 Intune / JumpCloud
                                    │
                                    │  MDM push
                                    ▼
                                                    /Library/Application Support/
                                                      ClaudeCode/
                                                        managed-settings.json
                                                        managed-mcp.json
                                                        CLAUDE.md

                                                    (Cannot be overridden by
                                                     any user or project config)
```

### 7.6 MCP Server Flow

```
Hub Repo                     MCP Server                     Agent (any platform)
────────                     ──────────                     ────────────────────

agentboot build
    │
    │ agentboot export
    │   --format mcp-server
    ▼
  MCP server package
  (@agentboot/mcp-server)
                              npx @agentboot/mcp-server
                                --config agentboot.config.json
                                    │
                                    │  stdio / HTTP
                                    ▼
                              MCP Tools:                    .mcp.json:
                                agentboot_review            { "mcpServers": {
                                agentboot_list_personas       "agentboot": {
                                agentboot_get_trait             "type": "stdio",
                                agentboot_check_compliance      "command": "npx",
                                agentboot_kb_search             "args": [...]
                                                              }
                              MCP Resources:                }}
                                persona://code-reviewer
                                trait://critical-thinking
                                knowledge://compliance/...
```

---

## 8. Security Architecture

### 8.1 Three-Layer Defense-in-Depth

```
+------------------------------------------------------------------+
|                    LAYER 1: Input Hooks                           |
|                    (Deterministic)                                |
|                                                                   |
|  UserPromptSubmit hook                                            |
|  - Regex-based pattern matching                                   |
|  - Runs BEFORE the model sees the input                           |
|  - Exit code 2 = block request                                    |
|  - Catches: PHI, credentials, SSNs, API keys, internal URLs      |
|  - Latency: < 100ms                                               |
|  - Cost: $0                                                       |
|  - Reliability: 100% for known patterns                           |
|                                                                   |
|  Limitation: regex cannot catch paraphrased or novel patterns     |
+------------------------------------------------------------------+
                              |
                         pass | block
                              |
+------------------------------------------------------------------+
|                    LAYER 2: Instruction-Based Refusal             |
|                    (Advisory)                                     |
|                                                                   |
|  Always-on instruction in CLAUDE.md / copilot-instructions.md     |
|  - Model-level guidance: "refuse to process sensitive content"    |
|  - Active in every interaction                                    |
|  - Cost: ~50 tokens per session (negligible)                      |
|  - Catches: semantic violations that regex misses                 |
|  - Works on ALL platforms (CC, Copilot, Cursor, Gemini)           |
|                                                                   |
|  Limitation: model may not recognize all violations               |
+------------------------------------------------------------------+
                              |
                         pass | refuse
                              |
+------------------------------------------------------------------+
|                    LAYER 3: Output Hooks                          |
|                    (Advisory / Audit)                              |
|                                                                   |
|  Stop hook                                                        |
|  - Scans model output for violations                              |
|  - Fires AFTER the response has rendered                          |
|  - CANNOT block (architectural constraint of Stop hook timing)    |
|  - Logs violations for audit trail                                |
|  - Catches: leakage that Layers 1 and 2 missed                   |
|                                                                   |
|  Limitation: post-hoc -- the developer already saw the output     |
+------------------------------------------------------------------+
```

**No single layer is sufficient alone.** The three layers are complementary:
- Layer 1 catches known patterns deterministically.
- Layer 2 catches semantic violations the model recognizes.
- Layer 3 provides audit evidence and catches leakage.

### 8.2 HARD vs. SOFT Guardrails

```
HARD Guardrails                          SOFT Guardrails
───────────────                          ───────────────

Deployed via MDM                         Deployed via hub repo sync
(managed-settings.json)                  (.claude/settings.json)

Cannot be overridden by ANY              Can be temporarily elevated
user or project config                   by developer with reason

OS-level file protection                 Git-level file protection

For: compliance incidents                For: engineering best practices
     (PHI leakage, credential           (code review standards,
      exposure, audit logging)           output formatting, testing)

Build error if team tries                Team can override weight
to disable                               or add exceptions (ADRs)

Examples:                                Examples:
- PHI input scanning hook                - critical-thinking weight
- Credential blocking                    - structured-output format
- Audit trail logging                    - reviewer selection rules
- disableBypassPermissionsMode           - creative-suggestion level
```

### 8.3 Managed Settings Lockdown

For enterprise HARD guardrails, the managed settings generator produces:

```json
{
  "disableBypassPermissionsMode": "disable",
  "allowManagedHooksOnly": true,
  "allowManagedMcpServersOnly": true,
  "allowManagedPermissionRulesOnly": true,
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/agentboot-compliance-scan",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

When these flags are set:
- Developers cannot add their own hooks (only managed hooks run)
- Developers cannot add unauthorized MCP servers
- Developers cannot override permission rules
- Developers cannot bypass permissions mode

This is the strongest enforcement available in the Claude Code platform.

### 8.4 Guardrail Elevation (SOFT only)

```
Developer invokes /elevate {guardrail-name}
    │
    │  Reason required
    ▼
Skill grants time-bounded bypass (default TTL: 30 minutes)
    │
    │  Audit log entry created:
    │    who, what, why, when, TTL
    ▼
Guardrail suppressed for TTL duration
    │
    │  All actions during window logged
    ▼
TTL expires → guardrail automatically re-engages
```

For organizations where automated elevation creates audit risk, a manual escalation
model is also supported: developer files GitHub issue, designated approver reviews,
decision recorded.

### 8.5 Permanent Exceptions (ADRs)

```
Persona flags finding during review
    │
    ▼
Developer: /propose-exception "rationale for deviation"
    │
    ▼
ADR created in hub repo (adrs/ directory)
    │
    ▼
Designated reviewer approves or rejects (via PR review)
    │
    ├── Approved: ADR committed, persona learns to accept deviation
    │
    └── Rejected: Developer must address the finding
```

ADRs live in the hub repo (governance artifacts, not code artifacts). They are
permanent, approved deviations -- distinct from temporary elevation.

### 8.6 Platform Compliance Matrix

| Enforcement Layer              | Claude Code | Copilot CLI | IDE (VS Code) | Cursor |
|--------------------------------|-------------|-------------|---------------|--------|
| Input hook (deterministic)     | `UserPromptSubmit` | Pre-prompt hook | N/A | N/A |
| Instruction refusal (advisory) | CLAUDE.md   | copilot-instructions.md | copilot-instructions.md | .cursor/rules/ |
| Output hook (advisory)         | `Stop`      | N/A         | N/A           | N/A    |
| Managed settings (HARD)        | MDM paths   | N/A         | N/A           | N/A    |
| Tool restrictions              | `disallowedTools`, permissions | N/A | N/A | N/A |
| Permission lockdown            | `disableBypassPermissionsMode` | N/A | N/A | N/A |

**Honest assessment:** Full defense-in-depth is only achievable on Claude Code. All
other platforms are limited to instruction-based advisory controls plus MCP-level
integration. AgentBoot documents these gaps per platform rather than promising
universal enforcement.

---

## 9. Cross-Platform Strategy

### 9.1 Architecture Principle

**Content is agent-agnostic; delivery is CC-first.**

The same source definitions (traits, personas, instructions, gotchas) produce output
for every supported platform. But the output fidelity varies significantly:

```
                    Feature Richness
                    ────────────────

Claude Code ████████████████████████████████ 100%
  Full: agents, skills, rules, hooks, MCP,
  managed settings, @imports, worktrees,
  memory, plugins, subagent isolation

Copilot     ██████████████████░░░░░░░░░░░░░░  55%
  Have: instructions, path-scoped rules,
  prompt files, SKILL.md, MCP
  Missing: hooks, managed settings, memory,
  agent model, isolation

Cursor      ████████████░░░░░░░░░░░░░░░░░░░░  40%
  Have: rules, SKILL.md, MCP
  Missing: hooks, managed settings, memory,
  agent model, isolation, org distribution

Gemini CLI  ████████░░░░░░░░░░░░░░░░░░░░░░░░  30%
  Have: GEMINI.md, SKILL.md, MCP
  Missing: nearly everything else
```

### 9.2 What's Portable

| Content Type         | Format                    | Works On                    |
|----------------------|---------------------------|-----------------------------|
| Traits (behavioral)  | Markdown prose            | All platforms (via instruction files) |
| Personas (SKILL.md)  | agentskills.io standard   | 26+ platforms               |
| Gotchas rules        | Markdown with glob patterns | All platforms (path-scoped) |
| Always-on instructions | Markdown prose          | All platforms (instruction files) |
| MCP servers          | `.mcp.json`               | CC, Copilot, Cursor, Gemini CLI |
| Domain layers        | Directory structure       | All (via different output formats) |

### 9.3 What's CC-Only

| Feature                        | CC Mechanism                | Non-CC Alternative        |
|--------------------------------|-----------------------------|---------------------------|
| Agent CLAUDE.md (rich frontmatter) | `.claude/agents/`       | SKILL.md (subset)         |
| Hooks (deterministic enforcement) | `settings.json`          | None                      |
| Managed settings               | MDM system paths            | None                      |
| `context: fork` (isolation)    | Skills with subagent fork   | None                      |
| `permissionMode: plan`         | Agent frontmatter           | None                      |
| `@import` composition          | CLAUDE.md native            | Inlined traits            |
| Plugin marketplace             | CC plugin system            | None (file sync only)     |
| Agent memory                   | `memory: project`           | None                      |
| Worktree isolation             | `isolation: worktree`       | None                      |

### 9.4 Per-Platform Output Generation

Each platform gets its own self-contained folder under `dist/`. Zip any one and it has
everything needed for that platform, nothing it doesn't. Scope hierarchy (core → groups
→ teams) is preserved within each platform folder. Duplication across platforms is
intentional — generated files are cattle not pets. Diffing across platforms (e.g.,
`diff dist/claude/ dist/copilot/`) shows exactly what's different between distributions.

```
agentboot build --format all

dist/
├── claude/                      # Self-contained Claude Code distribution
│   ├── core/
│   │   ├── agents/code-reviewer.md
│   │   ├── skills/review-code.md
│   │   ├── traits/critical-thinking.md
│   │   ├── rules/baseline.md
│   │   ├── CLAUDE.md (with @imports)
│   │   └── settings.json (hooks)
│   ├── groups/{group}/
│   └── teams/{group}/{team}/
│
├── copilot/                     # Self-contained Copilot distribution
│   ├── core/
│   │   ├── .github/copilot-instructions.md
│   │   └── .github/prompts/review-code.md
│   ├── groups/...
│   └── teams/...
│
├── cursor/                      # Self-contained Cursor distribution
│   ├── core/
│   │   └── .cursor/rules/*.md
│   ├── groups/...
│   └── teams/...
│
├── skill/                       # Cross-platform SKILL.md (agentskills.io)
│   ├── core/
│   │   ├── code-reviewer/SKILL.md (traits inlined)
│   │   └── PERSONAS.md
│   ├── groups/...
│   └── teams/...
│
└── gemini/                      # Self-contained Gemini CLI distribution
    ├── core/
    │   └── GEMINI.md
    ├── groups/...
    └── teams/...
```

### 9.5 Per-Repo Platform Selection

The sync engine uses each repo's `platform` field to select which `dist/{platform}/`
folder to read from:

```json
// repos.json
[
  { "name": "org/api-service",   "platform": "claude" },
  { "name": "org/web-app",       "platform": "copilot" },
  { "name": "org/ml-pipeline",   "platform": "cursor" },
  { "name": "org/data-service",  "platform": "skill" },
  { "name": "org/infra-tools",   "platform": "gemini" }
]
```

When `platform` is not specified, the default is `claude`.

### 9.6 The MCP Bridge

For organizations with mixed tooling, the MCP server provides uniform governance
across all platforms:

```
                    MCP Server
                    (@agentboot/mcp-server)
                         |
         +───────────────+───────────────+
         |               |               |
    Claude Code      Copilot         Cursor
    (.mcp.json)     (.mcp.json)     (.mcp.json)

    Same MCP tools, same persona definitions,
    same invocation, same output format.
```

The MCP server is the only delivery channel where all platforms receive identical
capabilities. However, it requires a running process and adds latency compared to
static file delivery.

### 9.7 Honest Limitations

1. **Compliance enforcement degrades significantly on non-CC platforms.** Without
   hooks, managed settings, and tool restrictions, compliance is advisory-only.
   Organizations with strict compliance requirements should prioritize Claude Code.

2. **Agent isolation is CC-only.** `context: fork` and worktree isolation have no
   equivalent on other platforms. Review personas on non-CC platforms share context
   with the generation conversation.

3. **The plugin ecosystem is CC-only.** Copilot, Cursor, and Gemini CLI users must
   use file sync or MCP. There is no marketplace experience for non-CC platforms.

4. **Self-improvement reflections require CC agent memory.** The reflection system
   (`memory: project`) is CC-specific. Non-CC personas cannot maintain persistent
   memory across sessions.

---

## 10. Key Architectural Decisions

### AD-01: Build-Time Composition (Not Runtime)

**Decision:** Traits are composed into personas at build time. The compiled output is
complete and standalone. No runtime resolution, no dynamic includes.

**Rationale:** Runtime trait inclusion (e.g., `@include` directives resolved during
sessions) breaks on platforms that don't support file inclusion (Copilot, Cursor) and
wastes tokens re-reading trait files on every invocation. Build-time composition
ensures portability and efficiency.

**Exception:** CC-native output uses `@import` syntax, which is resolved by Claude
Code at load time (not during the session). This is a CC-specific optimization that
provides live-editability while maintaining the "compiled output" model for all other
platforms.

**Status:** Locked.

---

### AD-02: agentskills.io as Format Standard

**Decision:** SKILL.md (agentskills.io format) is the canonical persona definition
format. Vendor-specific formats are generated as secondary output.

**Rationale:** agentskills.io is supported by 26+ agent platforms. Vendor-specific
formats (Copilot `.prompt.md`, Cursor `.cursorrules`) are platform-locked and cannot
serve as the authoritative definition. Using an open standard ensures that the persona
source of truth is portable.

**Status:** Locked.

---

### AD-03: CC-First, Agent-Agnostic Content

**Decision:** Claude Code is the primary target platform. Content (traits, personas,
instructions) is authored in agent-agnostic formats. CC-specific features (hooks,
managed settings, agent memory) are declared in metadata, not in content.

**Rationale:** The richest governance capabilities exist in Claude Code today. But
content should not be locked to CC. An organization that writes a `critical-thinking`
trait should be able to use it in Copilot and Cursor without modification. CC-specific
enhancements are layered on top during output generation.

**Status:** Locked.

---

### AD-04: Hub-and-Spoke Distribution

**Decision:** A single personas repository (hub) is the source of truth. Target
repositories (spokes) receive compiled output via sync. Spokes do not hold source
of truth and do not produce governance artifacts.

**Rationale:** Centralized governance prevents drift. Without a hub, each team would
maintain its own persona definitions, diverging over time. The hub model ensures that
improvements propagate automatically and that governance is reviewable in a single
location.

**Status:** Locked.

---

### AD-05: Privacy -- Raw Prompts Never Collected

**Decision:** Raw prompts are never collected, transmitted, or exfiltrated. This is a
design invariant, not a configuration option. Telemetry captures structured metadata
(persona ID, token counts, findings). The `/insights` feature sends transcripts to
the Claude API (same trust boundary) but extracts patterns, not transcripts.

**Rationale:** Collecting raw prompts would violate developer trust and create a
compliance liability. The three-tier privacy model (Private, Privileged,
Organizational) ensures that data stays at the appropriate trust level.

**Status:** Locked.

---

### AD-06: Apache 2.0 Licensing

**Decision:** AgentBoot core is licensed under Apache 2.0. Domain layers carry their
own licenses but must be Apache 2.0 or MIT compatible for Verified marketplace
listing.

**Rationale:** Apache 2.0 is permissive, enterprise-friendly, and compatible with
corporate contribution policies. It allows organizations to create private
extensions without open-sourcing them. GPL-family licenses were rejected because
they would prevent private domain layers.

**Status:** Locked.

---

### AD-07: MCP as the Cross-Platform Bridge

**Decision:** MCP (Model Context Protocol) is the recommended integration mechanism
for tool access, knowledge bases, and cross-platform persona serving. AgentBoot
builds MCP servers, not platform-specific tool integrations.

**Rationale:** MCP is supported by Claude Code, Copilot (VS Code), Cursor, and
Gemini CLI. An MCP server built once works on all supporting platforms. The MCP
interface also provides a clean abstraction boundary -- the backing store can change
(flat files to SQLite to vector DB) without changing the persona definitions.

**Status:** Locked.

---

### AD-08: SQLite for Structured Knowledge (Not Postgres)

**Decision:** The Stage 2 knowledge store uses SQLite (local file). Not PostgreSQL,
not a hosted database.

**Rationale:** Zero infrastructure. SQLite ships with the MCP server as a single
file. It handles thousands of knowledge items with sub-millisecond queries. No
server to run, no connection to configure, no credentials to manage. Stage 3
extends SQLite with sqlite-vss for vector search. Migration to PostgreSQL/pgvector
is available if the organization outgrows SQLite, but most will never need it.

**Status:** Locked for Stage 2. Revisable for Stage 3.

---

### AD-09: Composition Over Inheritance

**Decision:** Personas compose traits. They do not inherit from each other. No
persona extends another persona. Shared behavior belongs in traits.

**Rationale:** Object-oriented inheritance applied to personas creates fragile chains
where changes to a parent have unpredictable effects on children. This was rejected
as Design Principle #1. Composition is explicit, predictable, and independently
testable.

**Status:** Locked.

---

### AD-10: Managed Settings for Compliance, Not Convenience

**Decision:** Managed settings (deployed via MDM) carry HARD guardrails only --
compliance hooks, credential blocking, audit logging. Personas and skills are
delivered via plugin or sync, not managed settings.

**Rationale:** Mixing governance and convenience in managed settings makes both
harder to manage. Managed settings should change rarely (compliance regime changes).
Personas and skills change frequently (calibration, new features). Keeping them in
separate channels reduces IT burden and governance friction.

**Status:** Locked.

---

### AD-11: Plugin as Primary CC Delivery, Sync as Fallback

**Decision:** The Claude Code plugin is the primary delivery method for CC users.
Direct `.claude/` sync is the fallback for repos that can't use plugins or for
cross-platform output.

**Rationale:** Plugins use the native CC distribution mechanism, support force-enable
via managed settings, get updates via `/reload-plugins`, and isolate via namespace.
Sync is simpler but lacks polish, creates noise in target repos, and can drift.

**Status:** Locked.

---

### AD-12: Structured Telemetry From Day One

**Decision:** Persona invocations emit structured JSON (GELF/NDJSON) from day one.
No plain text logs.

**Rationale:** Plain text logs cannot be queried, aggregated, or analyzed without
custom parsing. Structured JSON is queryable with `jq` immediately, and can be
ingested into any log aggregation system without transformation. The upfront cost
is trivial; the analysis benefit is permanent.

**Status:** Locked.

---

### AD-13: Non-Destructive Discovery and Uninstall

**Decision:** `agentboot discover` never modifies existing files. `agentboot uninstall`
removes only files tracked in `.agentboot-manifest.json`. Both operations are
reversible.

**Rationale:** Easy exit builds trust for easy entry. Organizations evaluating
AgentBoot need confidence that trying it cannot break their existing setup and that
removing it is a one-command operation. The manifest tracking system ensures
precision.

**Status:** Locked.

---

### AD-14: Four-Level Scope Hierarchy

**Decision:** Configuration follows a four-level hierarchy: Org > Group > Team > Repo.
Mandatory behaviors propagate top-down (org wins). Optional behaviors resolve
bottom-up (team wins).

**Rationale:** Mirrors real organizational structure and governance. The org enforces
compliance universally. Groups manage horizontal concerns. Teams customize for their
domain. Repos add path-scoped context. Without this hierarchy, governance would
either be too rigid (org-level only) or too fragmented (per-repo only).

**Status:** Locked.

---

### AD-15: Async Telemetry Hooks

**Decision:** All telemetry hooks run asynchronously. They do not block the developer
workflow.

**Rationale:** Telemetry that slows down the developer experience will be disabled.
Async hooks ensure zero performance impact. The tradeoff is that telemetry may be
slightly delayed, but this is acceptable for aggregate metrics.

**Status:** Locked.

---

## 11. Open Questions

Open questions discovered during architecture design have been resolved or deferred.
See the internal tracking document for remaining items.
