---
sidebar_label: "Roadmap"
sidebar_position: 2
---

# Roadmap

## Current Status

**v0.9.0** is the current release. Phases 1 through 9 are complete.

### Version Architecture

| Version | Phase(s) | Target | Description |
|---|---|---|---|
| **v0.9.0** | 1–9 | Now (stealth) | Full build pipeline, 8 platforms, marketplace infra |
| **v1.0 GA** | 10–11 | June 2026 | Knowledge layer (brain index), marketplace live, org scale |
| **v1.x** | 12 | Aug–Oct 2026 | Org scale: ADR governance, A2A, domain layers |
| **v2.0** | 13 | Q1 2027 | ADLC governance: agent registry, approval workflows, compliance scoring, full UI |
| **v2.x** | 14+ | H1 2027+ | Platform/OEM: non-coding agent compilation, white-labeled hub |

See `docs/internal/plans/commercialization-roadmap.md` for full business model and go-to-market strategy.

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

## Phase 6: "Governance & Quality" -- DONE (v0.6.0, 2026-04-04)

Enterprise governance, validation, testing, and CI. Make AgentBoot auditable and reliable at scale.

Delivered:
- **Composition validation** (AB-118, AB-119) -- check 5 (composition type consistency across scopes) and check 6 (rule override detection). Warnings in normal mode, errors in `--strict`.
- **Doctor composition diagnostics** (AB-120) -- missing manifests, orphaned overrides, scope shadow detection
- **Doctor tool/format consistency** (AB-121) -- warns when `agents.tools` and `personas.outputFormats` diverge
- **PreToolUse compliance hooks** (AB-122) -- compiles `managed.guardrails.denyTools` to PreToolUse bash hooks that block denied tools. Fail-closed (blocks if jq missing).
- **Behavioral testing** (AB-123) -- YAML-defined test cases with `contains`, `not-contains`, `regex` assertions. 2-of-3 flake tolerance. `agentboot test --behavioral`.
- **Snapshot and regression testing** (AB-124) -- SHA-256 hashing of dist/ with diff reporting. `agentboot test --snapshot` and `--regression`.
- **CI integration** (AB-125) -- reusable GitHub Actions workflow (`workflow_call`) with configurable version, snapshot, behavioral, and strict inputs.
- **Hub migration** (AB-126) -- `agentboot migrate` converts repos to hubs with `--revert` (safety-checked against post-migration content) and `--dry-run`.
- **API providers** (AB-127) -- `AnthropicAPIProvider`, `OpenAIAPIProvider`, `GoogleAPIProvider` with secure stdin-based prompt passing, TLS enforcement, API error checking, and automatic fallback via `resolveProviderWithFallback()`.

---

## Phase 7: "Production Ready" -- COMPLETE

Platform completeness, trait calibration, developer velocity, and harness intelligence.

**Delivered (v0.7.0):**
- **Cursor .mdc output** — flat `.cursor/rules/*.mdc` files with `alwaysApply`/`globs` frontmatter (AB-129)
- **Copilot scoped instructions** — `.github/instructions/*.instructions.md` with `applyTo` (AB-130)
- **CC Plugin validation** — manifest validation on export (AB-131)
- **`--non-interactive` mode** — CI-safe install/import with env var defaults (AB-132)
- **Real YAML parser** — js-yaml in test-runner with backward compat (AB-133)
- **Trait weight system** — HIGH/MEDIUM/LOW/MAX/OFF calibration per persona (AB-134)
- **Harness SME personas** — 5 internal domain experts (AB-135)
- **Nightly intelligence pipeline** — GitHub Actions workflow + scripts (AB-136)
- **`/learn` skill** — contextual help for AgentBoot users (AB-137)
- **Production sync testing** — multi-platform integration tests (AB-138)

---

## Phase 8: "Multi-Platform Coverage & Enterprise" -- COMPLETE

Multi-platform output to counter competitive threats, enterprise compliance enforcement,
and infrastructure improvements.

**Delivered (v0.8.0):**
- **Gemini output** — GEMINI.md project instructions + `.gemini/` rules directory (AB-144)
- **Windsurf output** — `.windsurfrules` flat text file (AB-146)
- **AGENTS.md scope awareness** — per-scope AGENTS.md for group/team nodes (AB-145)
- **Compliance hook compilation** — per-persona hooks from persona.config.json (AB-147)
- **MCP connection governance** — approved/required server validation (AB-143)
- **`agentboot cost-estimate`** — projected monthly costs per persona (AB-139)
- **MCP server** — JSON-RPC stdio server for cross-platform persona serving (AB-140)
- **Strategic analysis layer** — cross-cutting intelligence synthesis persona (AB-141)
- **Monorepo support** — per-package persona deployment via `packages[]` in repos.json (AB-142)

Total: 7 output platforms (skill, claude, copilot, cursor, agents, gemini, windsurf).
711 tests across 15 files.

---

## Phase 9: "Marketplace & Optimization" — COMPLETE

Marketplace infrastructure, optimization tooling, JetBrains output, and evaluation maturity.

**Delivered (v0.9.0):**
- **Marketplace infrastructure** — `agentboot search`, `agentboot pull`, `agentboot publish`. Three-layer registry: Core/Verified/Community. Web catalog at `agentboot.dev/marketplace`. Contribution validation workflow. (AB-150–151)
- **agentskills.io export** — `agentboot export --format agentskills` generates `skills-index.json` from compiled SKILL.md files. (AB-152)
- **`agentboot optimize`** — Reads GELF telemetry, aggregates per-persona metrics (invocations, token cost, rephrase rate, finding distribution). LLM-powered trait weight recommendations. HTML report generation. `--apply` flag writes recommendations to `persona.config.json`. (AB-153–154)
- **Trait weight calibration — all traits** — Calibration preambles (OFF/LOW/MEDIUM/HIGH/MAX) authored for all 6 traits: critical-thinking, structured-output, source-citation, audit-trail, confidence-signaling, schema-awareness. (AB-155)
- **JetBrains output** — 8th output platform. Personas → `.junie/guidelines.md`. Instructions and gotchas → `.aiassistant/rules/*.md`. (AB-156)
- **Copilot agent output** — `.github/agents/{name}.agent.md` with `name`, `model`, `tools` frontmatter. Higher-fidelity than `copilot-instructions.md`. (AB-157)
- **Agent pattern selection** — `pattern` field in `persona.config.json`: `react`, `rewoo`, `router`, `sequential`, `tool-calling`. Validation warns on misuse. (AB-158)
- **Managed settings group/team fragments** — `10-group.json` per group and `20-team.json` per team alongside existing `00-org.json`. Full MDM scope coverage. (AB-159)
- **LLM-as-Judge evaluation** — 5-dimension persona quality scoring (accuracy, precision, recall, specificity, actionability). `agentboot test --judge --min-score 0.7`. (AB-160)
- **Intelligence-driven roadmap** — Nightly synthesis generates prioritized roadmap suggestions to `docs/internal/plans/roadmap-suggestions.md`. Human review gated. (AB-161)

Total: 8 output platforms (skill, claude, copilot, cursor, agents, gemini, windsurf, jetbrains). 944 tests across 18 files.

---

---

## Phase 10: "Engineer Traction" — NEXT (v0.10.0)

Make the harness worth using every day. The Second Brain is the centerpiece.

What's planned:
- **Second Brain Stage 2** — SQLite knowledge index + `agentboot-brain` MCP server + `agentboot brain` CLI (index/query/add/stats). Queryable org memory at the file level.
- **Second Brain Stage 2.5** — ADR and incident ingestion as first-class knowledge types. `agentboot add adr` / `agentboot add incident` scaffolding.
- **`/ask` skill** — natural language queries against the Second Brain. "Why does the session middleware not use Redis directly?" → ADR surface, zero prompting.
- **Harness template library** — `agentboot add template api-service|event-processor|data-pipeline`. Traits + gotchas + personas pre-bundled for common topologies. Ships in Core marketplace tier.
- **Import from remote repos + interop** — `agentboot import --url github.com/org/repo`. Supports AGENTS.md repos, Google Conductor repos, Context Hub repos, SuperClaude repos.
- **`agentboot audit`** — periodic consistency checks: orphaned traits, dead gotchas, stale ADRs, scope shadows, manifest drift.
- **Global hub registry** — `~/.agentboot/config.json`, `agentboot connect`, `agentboot use`, `agentboot hubs`.
- **Agentboot authoring instruction** — `core/instructions/agentboot-authoring.instructions.md` compiled into every hub's `.claude/rules/`. Teaches Claude the trait format, weight semantics, validation rules, and anti-patterns so free-form assistance produces artifacts that pass `agentboot validate --strict` without correction.
- **MCP server + `/ab` skill (built together)** — these ship as a unit because `/ab` depends on live hub state from MCP to be useful.
  - *MCP server*: `agentboot mcp-server` entry added to the compiled `.mcp.json` in `core/`. Tools: `get_repos`, `get_personas`, `get_traits`, `get_build_status`, `get_validate_warnings`. Sets up the Second Brain query path when Stage 2 lands.
  - *`/ab` skill*: single NL-driven entry point in `core/skills/`, compiled to every repo (hub and spoke). Natural language intent → clarify with user → confirm plan → execute. Replaces the separate `/add-trait`, `/add-gotcha`, `/add-persona`, and `/agentboot` meta-skill concepts — those become internal routing, not user-facing commands.
  - *Interaction model*: clarify ambiguity first, then present a concrete plan, then execute with `agentboot` CLI calls. Yolo mode (skip confirm step) planned as a configurable flag in a later release.
  - *Scope*: `/ab` teaches scope vocabulary (org / group / team / repo / path) through repeated clarification questions rather than requiring the user to know it upfront. Users learn the model by being asked, not by reading docs.
  - *Examples*: `/ab add a rule for the team that requires structured logging`, `/ab what traits does the code-reviewer persona use?`, `/ab show me what's registered`, `/ab create a persona for data engineers at the group level`.
  - *Architecture — orchestrator, not monolith*: `ab.md` is a thin orchestrator that classifies intent and handles clarification. It dispatches to specialist sub-agents in `core/skills/ab/` that carry only the context relevant to that operation: `ab/author.md` (trait/gotcha/persona/instruction authoring), `ab/diagnose.md` (doctor, validate, audit), `ab/query.md` (read hub state via MCP), `ab/manage.md` (sync, build, import). Sub-agents receive a clean context fork — the parent passes only what they need. This keeps `/ab`'s per-invocation context cost flat regardless of how many specialists exist. Adding a capability means adding a specialist file, not growing `ab.md`. The MCP server call happens in the orchestrator before dispatch, so sub-agents receive live hub state as input rather than needing to know how to fetch it.
  - *Artifact type classifier*: between intent detection and specialist dispatch, the orchestrator infers the correct artifact type from what the user described — not just what they called it. If the inferred type differs from the user's language, `/ab` surfaces the mismatch as a teaching moment before routing. Example: `/ab add a rule that when I say gtd you always know that refers to David Allen's Getting Things Done` — the user said "rule" but the pattern ("when I say X it means Y") is a lexicon entry. The classifier catches it: *"This looks like a lexicon entry — a domain term definition that teaches Claude vocabulary without using up rule space. Want me to create it as a lexicon entry instead?"* The user learns what a lexicon is by being corrected, not by reading docs. Classifier covers the full artifact taxonomy: lexicon (term definitions), gotcha (path-scoped operational knowledge), trait (behavioral building blocks), instruction (always-on guardrails), persona (role definitions).

---

## Phase 11: "org scale" — (v0.11.0)

Target: AI Engineer World's Fair, June 29–July 2, 2026. Come out of stealth with a live marketplace, a working Second Brain demo, and competitive positioning.

What's planned:
- **agentboot.dev/marketplace live** — hosted registry; `agentboot publish` functional; Core/Verified/Community tiers; web catalog.
- **Community launch** — Dev.to, Hacker News Show HN, AI Engineer World's Fair, Latent Space Discord. Messaging: "context engineering, not prompt engineering."
- **SuperClaude cross-listing** — shared portable trait format standard; cross-list in both marketplaces; submit to AAIF/AGENTS.md working group.
- **MCP marketplace listing** — list `agentboot-brain` and `agentboot` MCP servers on mcp.so, pulsemcp, Smithery.
- **Security hardening** — CVE audit against CVE-2025-59536/CVE-2026-21852/DXT patterns; security advisory; new `agentboot validate` check for dangerous hook patterns.
- **OpenCode / Cline research** — integration viability assessment for 9th/10th output platforms.
- **Competitive positioning** — internal docs: Google Conductor, Context Hub, SuperClaude, Copilot Cowork.

---

## Phase 12: "Org Scale" — (v0.12.0)

Gated on engineer adoption landing. Goals: compliance differentiators, governance lifecycle, multi-agent enterprise architecture.

What's planned:
- **ADR governance** -- exception lifecycle, expired ADR validation errors, `agentboot adr` CLI.
- **`/insights` skill + org dashboard** -- personal prompt pattern extraction; anonymized org metrics (rephrase rates, false positives, cost by team). Raw prompts never leave the machine.
- **Domain layers: healthcare/fintech/govtech** -- complete compliance packages (traits + personas + gotchas + instructions); Verified marketplace tier.
- **A2A protocol support** -- Agent-to-Agent server/client; personas as A2A-callable services; complements MCP.
- **Autonomy progression** -- Advisory → Auto-approve → Autonomous, with telemetry-gated promotion.
- **Abstract/binding composition** -- org semantic contracts, team implementations, validation check 9.
- **Second Brain Stage 3** -- sqlite-vec semantic retrieval for 500+ knowledge item hubs.
- **OpenCode + Cline output platforms** -- if Phase 11 research confirms viability.
