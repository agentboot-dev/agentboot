---
sidebar_label: "Roadmap"
sidebar_position: 2
---

# Roadmap

## Current Status

**v0.4.6** is the current release. Phases 1 through 4 are complete. Phase 5 is next.

---

## Phase 1: "AgentBoot Builds Itself" -- COMPLETE

AgentBoot compiles its own personas and uses them when developing itself.

What shipped:
- 6 core traits authored and composed into 4 personas
- Build pipeline: validate, compile, sync (all end-to-end)
- Configuration schema (`agentboot.config.json`)
- Claude Code native output: agents, skills, rules, CLAUDE.md with `@imports`
- Always-on instructions (baseline and security)
- Unit and integration tests for the build pipeline

---

## Phase 2: "Usable by Others" -- COMPLETE

Any repo can install AgentBoot personas via CLI. Install, scaffolding, diagnostics, and uninstall all work.

What shipped:
- Scope merging (org to group to team to repo)
- Full CLI: `build`, `validate`, `sync`, `install`, `status`, `doctor`, `uninstall`
- Scaffolding: `add persona`, `add trait`
- Cross-platform output: standalone SKILL.md, copilot-instructions.md
- PERSONAS.md auto-generation
- Gotchas rules (path-scoped knowledge)
- Static prompt linting (`agentboot lint`)
- Token budget calculation at build time
- Prompt style guide baked into scaffolding templates
- Repo platform switching (`agentboot config repo platform`)
- First-session welcome fragment for developer onboarding
- Manifest tracking for managed files (`.agentboot-manifest.json`)

---

## Phase 3: "Ship It" -- COMPLETE

AgentBoot is distributable as a Claude Code plugin with compliance and privacy foundations in place.

What shipped:
- Plugin packaging (plugin.json, agents, skills, hooks)
- `agentboot export --format plugin` and `agentboot publish`
- Private marketplace template (marketplace.json)
- N-tier scope model (flexible node hierarchy replaces fixed groups/teams)
- Extended scaffolding: `add gotcha`, `add domain`, `add hook`
- Per-persona extensions (extend without modifying base)
- Domain layers (agentboot.domain.json)
- Compliance hooks: input scanning (UserPromptSubmit) and output scanning (Stop)
- Audit trail hooks (SubagentStart/Stop, PostToolUse)
- Telemetry: NDJSON output with canonical schema, configurable developer identity
- Three-tier privacy model (Private, Privileged, Organizational)
- Managed settings artifact generation
- Sync via GitHub API with PR creation mode
- MCP configuration generation (.mcp.json)
- Brew tap distribution
- Model selection matrix documentation
- ACKNOWLEDGMENTS.md (prior art credit)

---

## Phase 4: "Core Pipeline" -- COMPLETE

Establish the foundational systems that everything else builds on: composition types for scope merging, lexicon for context compression, AGENTS.md for universal reach, provider abstraction for import, and install completion.

Shipped:
- **Two-path install** -- interactive onboarding with tab-completing directory selection, agent tool discovery, org slug inference, inline import
- **Import system** -- scan, LLM classify, composition type assignment, prompts as code
- **Composition type classification** -- `rule`/`preference` defaults per artifact, `composition_type` in staging files, frontmatter injection on apply
- **Lexicon classification** -- `lexicon` as artifact type in import classifier, prompt, and schema
- **Persona classification** -- `persona` as artifact type in import classifier
- **Agent tool discovery** -- install learns which tools the org uses, derives output formats
- **Multi-provider foundation** -- `agents` config section, Claude auth flow, billing disclosure
- **Prompts as code** -- `scripts/prompts/` directory with loader, `--isolated` testing mode
- **Doctor --fix** and **config writes**

Planned:
- **Composition type core** -- `composition` frontmatter field parser, `CompositionConfig` in config, `composition-manifest.json` generation in compile, composition-aware `mergeScopes()` in sync
- **Lexicon artifact** -- `core/lexicon/` directory with YAML term definitions, compilation first in pipeline, compact glossary block output
- **AGENTS.md output** -- generate the universal cross-tool agent config standard
- **Persona-as-subagent** -- compile personas to `.claude/agents/*.md` with tool restrictions
- **LLM provider abstraction** -- `LLMProvider` interface, `ClaudeCodeProvider`, `ManualProvider`, `resolveProvider()` from config
- **Install completion** -- same-org repo registration, type reference cleanup
- **Token budget enforcement** -- `agentboot lint` token counting per persona
- **Expand `AgentBootConfig.agents`** -- `llmModel`, `billingAcknowledged` fields

---

## Phase 5: "Cross-Platform & Import" -- DONE (v0.5.0, 2026-04-04)

Reach every major agent platform. Import everything, not just markdown. 497 tests, 0 TS errors.

Delivered:
- **Cursor output** (AB-109) -- `.cursor/rules/*/RULE.md` with YAML list globs from gotchas `paths:` frontmatter
- **Copilot agents output** (AB-110) -- `.github/agents/*.agent.md` custom agent definitions
- **Managed settings fragments** (AB-111) -- `managed-settings.d/00-org.json` drop-in files
- **AGENTS.md sync** (AB-116) -- synced to repo root during sync, regardless of platform
- **Expanded import: whole-file strategy** (AB-112) -- deterministic import for agents→personas, traits→core/traits/, rules-with-paths→gotchas (no LLM, instant, free)
- **Expanded import: config merge** (AB-113) -- settings.json permissions extraction (union merge), MCP config import with entropy-based secret detection, hook import with per-hook security confirmation (default NO)
- **Skill import with agent linking** (AB-114) -- skills linked to imported agents or standalone personas; staging file v2 with `whole_file_imports[]`, `config_merges[]`, `deduplication{}`
- **Cross-platform deduplication** (AB-115) -- Jaccard similarity, claude > cursor > copilot priority, `--parent` flag wired to 3-strategy expanded pipeline
- **Security hardening** -- path traversal validation on generates[], trusted-source checks, ALLOWED_CLASSIFICATION_DIRS enforcement, symlink detection, word-boundary secret detection, JSONC-safe comment stripping
- **TS error cleanup** -- fixed all 45 pre-existing TypeScript errors across 5 files

---

## Phase 6: "Governance & Quality" -- PLANNED

Enterprise governance, validation, testing, and CI. Make AgentBoot auditable and reliable at scale.

Planned:
- **Composition validation** -- check 5 (composition type consistency across scopes) and check 6 (rule override detection)
- **Doctor composition diagnostics** -- missing manifests, orphaned overrides, shadow detection
- **Doctor tool/format consistency** -- warn when `agents.tools` and `outputFormats` diverge
- **`--strict` promotion** -- sync composition warnings become errors with `--strict`
- **PreToolUse compliance hooks** -- compile compliance rules to lifecycle hooks that block operations before execution
- **Behavioral testing** -- YAML-defined test cases run against personas via `claude -p` with assertions
- **Snapshot and regression testing** -- detect unintended persona drift across versions
- **CI integration** -- reusable GitHub Actions workflow and CI template for personas repos
- **Hub migration** -- `agentboot migrate` converts existing repos into AgentBoot hubs with `--revert`
- **API providers** -- `AnthropicAPIProvider`, `OpenAIAPIProvider`, `GoogleAPIProvider` for import
- **Provider fallback chooser** -- interactive selection when configured provider unavailable

---

## Phase 7: "Ecosystem" -- PLANNED

Marketplace, harness templates, multi-agent coordination, knowledge layer, and advanced platform integrations.

Planned:
- **Harness template library** -- topology-specific bundles (API service, event processor, data pipeline) packaging traits, gotchas, personas, and hooks
- **Public marketplace** -- core layer (bundled), verified layer (reviewed), web catalog
- **agentskills.io listing** -- publish compiled skills to the Agent Skills marketplace
- **MCP server** -- cross-platform persona serving (`@agentboot/mcp-server`)
- **Team compositions** -- persona sets with handoff protocols for multi-agent coordination
- **Blueprint integration** -- workflows mixing deterministic nodes (lint, test) with agentic nodes (implement, review)
- **`agentboot audit`** -- periodic consistency checks (garbage collection pattern)
- **Knowledge layer** -- SQLite index with MCP server (Stage 2), vector/RAG (Stage 3)
- **JetBrains output** -- `.junie/guidelines.md` and `.aiassistant/rules/*.md`
- **Gemini output** -- dedicated output format for Gemini CLI
- **ADR governance** -- architectural decision records with exception lifecycle
- **Autonomy progression** -- per-persona independence levels (Advisory to Autonomous)
- **Abstract/binding composition** -- org defines semantic contracts, teams provide implementations
- **Global hub registry** -- `~/.agentboot/config.json` mapping org slugs to hub paths
- **Private prompt analytics** -- `/insights` skill for self-improvement
- **Monorepo support** -- per-package persona deployment
- **LLM-powered semantic dedup** -- beyond Jaccard, use LLM for content similarity
- **Import from remote repos** -- `agentboot import --url github.com/org/repo`
