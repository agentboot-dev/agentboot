---
sidebar_label: "Roadmap"
sidebar_position: 2
---

# Roadmap

## Current Status

**v0.2.0** is the current release. Phases 1 through 3 are complete. Phases 4 and 5 are planned.

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

## Phase 4: "Migration & Adoption" -- PLANNED

Organizations can import existing agentic content, generate a migration plan, and onboard developers. Behavioral tests validate persona quality.

Planned features:
- **Two-path install** -- `agentboot install` guides architects (create hub) and developers (connect to hub) through the right flow
- **Import and migration** -- `agentboot import` scans repos for existing agentic content, classifies into personas/traits/gotchas (LLM-powered via `claude -p`)
- **Prompt ingestion** -- classify raw prompts into traits/personas, batch-decompose existing CLAUDE.md files
- **Solo mode** -- solo developers use the same flow as orgs; GitHub username as org name
- **Behavioral testing** -- YAML-defined test cases run against personas via `claude -p` with assertions
- **Snapshot and regression testing** -- detect unintended persona drift across versions
- **CI integration** -- reusable GitHub Actions workflow and CI template for personas repos
- **Cost estimation** -- projected monthly cost per persona across the org
- **Metrics reporting** -- read telemetry data, report per-persona effectiveness
- **Developer onboarding** -- `/learn` contextual help skill, generated onboarding checklist

---

## Phase 5: "Ecosystem & Advanced" -- PLANNED

Public marketplace, knowledge layer beyond flat files, advanced governance, and cross-platform output for non-CC agents.

Planned features:
- **Private prompt analytics** -- `/insights` skill for developer self-improvement
- **Public marketplace** -- core layer (bundled traits and personas), verified layer (community review), contribution guide, web catalog
- **LLM-as-judge evaluations** -- automated persona quality measurement
- **Knowledge layer progression** -- SQLite index with MCP server (Stage 2), vector embeddings and RAG (Stage 3)
- **MCP server** -- cross-platform persona serving (`@agentboot/mcp-server`)
- **ADR governance** -- create and manage architectural decision records with exception lifecycle
- **Autonomy progression** -- per-persona independence levels (Advisory to Autonomous)
- **Cross-platform output** -- dedicated output formats for Copilot, Cursor, and Gemini
