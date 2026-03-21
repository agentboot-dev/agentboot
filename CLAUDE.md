# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (required before anything else)
npm run validate     # Run pre-build validation checks
npm run build        # Compile traits into persona output files
npm run sync         # Distribute compiled output to target repos
npm run clean        # Remove dist/
npm run full-build   # clean → validate → build → dev-sync pipeline
npm run dev-sync     # Copy dist/ to local repo for dogfooding (gitignored)
npm run lint         # TypeScript type checking + lint
npm run test         # Run vitest
npm run test:watch   # Watch mode testing
npm run typecheck    # TypeScript type checking (tsc --noEmit)
```

Run a single test file: `npx vitest run <path-to-test-file>`

## Architecture

AgentBoot is a **build tool** (not a runtime framework) that compiles agentic personas for distribution to target repos. The pipeline is: validate → compile → sync.

### Core Concepts

**Traits** (`core/traits/`) are reusable behavioral building blocks (e.g., `critical-thinking.md`, `source-citation.md`). They are composed at build time — never at runtime. (Trait weight configurations are a Phase 2 feature.)

**Personas** (`core/personas/{name}/`) each contain:
- `SKILL.md` — the agent definition with `<!-- traits:start -->` / `<!-- traits:end -->` injection markers
- `persona.config.json` — build metadata specifying which traits to inject

**Always-on Instructions** (`core/instructions/`) are universal guardrails distributed to every repo regardless of persona configuration.

### Build Pipeline

1. **`scripts/validate.ts`** — 4 pre-build checks: persona existence, trait references, SKILL.md frontmatter, secret scanning
2. **`scripts/compile.ts`** — loads `agentboot.config.json`, resolves trait references from `persona.config.json`, and emits **one self-contained folder per platform** under `dist/`:
   - **`dist/skill/`** — cross-platform SKILL.md (agentskills.io format, traits inlined) + PERSONAS.md
   - **`dist/claude/`** — CC-native: agents, skills, rules, traits, CLAUDE.md (`@imports`), settings.json, .mcp.json
   - **`dist/copilot/`** — per-persona copilot-instructions.md fragments + instructions
3. **`scripts/sync.ts`** — reads `repos.json`, reads from `dist/{platform}/`, merges scopes (core → group → team, team wins on conflicts), writes to target repos in platform-native locations, generates `.agentboot-manifest.json` with file hashes
4. **`scripts/dev-sync.ts`** — copies `dist/{platform}/core/` to platform-native locations in the current repo for local dogfooding (gitignored output only, not the production sync)

Each `dist/{platform}/` folder is self-contained. Scope hierarchy (core → groups → teams) is preserved within each platform folder. Duplication across platforms is intentional (generated files are cattle not pets). `full-build` runs dev-sync (not sync) to load compiled personas locally.

### Scope Hierarchy

Four-level hierarchy: Org → Group → Team → Repo. More specific scopes layer on top of general ones. For optional behaviors, team overrides group overrides core. For mandatory behaviors, inheritance is top-down (org wins). Scope merging happens in `sync.ts`. For public repos, repo-specific enrichments live in the hub under `public-repos/{repo}/` (not committed to the public repo) — see "Public repo pattern" in concepts.md.

### Output Structure

Compiled artifacts go to `dist/`, organized by platform first, then by scope:
- `dist/skill/` — cross-platform SKILL.md (agentskills.io format, traits inlined) + persona.config.json + PERSONAS.md
- `dist/claude/` — CC-native: agents, skills, rules, traits, CLAUDE.md (@imports), settings.json, .mcp.json, PERSONAS.md
- `dist/copilot/` — per-persona copilot-instructions.md fragments + instructions + PERSONAS.md

Cursor and Gemini output are planned for Phase 2.

Within each platform folder, scope hierarchy is preserved:
- `dist/{platform}/core/` — org-level personas
- `dist/{platform}/groups/{group}/` — group-level overrides
- `dist/{platform}/teams/{group}/{team}/` — team-level overrides

### Distribution Model (Hub-and-Spoke)

This repo acts as the **hub**. Target repos listed in `repos.json` are **spokes**. One-way flow: hub publishes compiled artifacts → spokes receive them. Spokes don't hold source of truth.

### Configuration

Everything is driven by `agentboot.config.json` (JSONC format). Key sections: `org`, `groups`, `personas.enabled`, `traits.enabled`, `instructions.enabled`, `sync.repos`, `sync.dryRun`.

### Key Design Concepts

All design ideas are documented in `docs/concepts.md`:

**Core (Tier 1):** agentskills.io format, build-time trait composition, scope hierarchy, hub-and-spoke distribution, multi-format output. (Trait weight system — HIGH/MEDIUM/LOW — is designed but not yet implemented.)

**High Value (Tier 2):** per-persona extensions, gotchas rules (path-scoped battle-tested knowledge), compliance hooks (3-layer defense-in-depth), ADR governance (permanent exception lifecycle), behavioral tests, self-improvement reflections (A→B→C), reviewer selection config.

**V2+ (Tier 3):** HARD/SOFT guardrail elevation, team champions, SME discoverability fragment, MCP-first integrations, structured telemetry (GELF/NDJSON), persona arbitrator, autonomy progression (Advisory→Auto-approve→Autonomous), two-channel MDM distribution.

**Anti-patterns:** overcommitting V1 scope, plain text logs, runtime trait inclusion, vendor-locked formats, forking base personas, deep inheritance hierarchies.

See `docs/concepts.md` for full design rationale.

### Delivery Methods

`docs/delivery-methods.md` analyzes 8 delivery channels. Key decisions:
- **CC Plugin** is the primary delivery method (native marketplace, force-enable via managed settings)
- **CLI** (`agentboot`) is the build tool, not the end-user tool
- **Managed settings** carry HARD guardrails only (compliance, not convenience)
- **MCP server** is the cross-platform bridge for multi-agent orgs
- **Cowork** extends reach to non-engineers via the same plugin format
- `docs/org-connection.md` — how developers get their org's customizations (three-path strategy: managed settings, repo sync, self-service)

### Privacy & Psychological Safety

`docs/privacy-and-safety.md` — the prompt confidentiality model:
- **Three tiers:** Private (raw prompts, never leave machine) → Privileged (LLM analysis via Claude API, developer approves sharing) → Organizational (persona output metrics, anonymized)
- Raw prompts are NOT collected, transmitted, or exfiltrated. This is a design invariant, not a config option.
- `/insights` sends transcripts to Claude API (same trust boundary already in use), extracts patterns not transcripts, developer sees first and approves sharing
- Org dashboard shows persona effectiveness (rephrase rates, false positives, cost by team) — never individual prompts
- Escalation exception for genuinely harmful content (exfiltration, guardrail circumvention, harassment) — flag category only, not transcript
- High rephrase rates are framed as persona quality problems, not developer intelligence problems

### Prompt & Cost Optimization

`docs/prompt-optimization.md` — 8 sections covering the full optimization lifecycle:
- `agentboot lint` — static prompt analysis (token budgets, vague language, conflicts, security)
- Token budget system — per-persona context cost calculation and enforcement
- Model selection matrix — Haiku/Sonnet/Opus guidance per persona type
- `agentboot cost-estimate` — projected monthly cost per persona across the org
- Effectiveness metrics — efficiency (tokens, cost, latency), quality (accuracy, false positive rate), business (adoption, bug escapes)
- Prompt style guide — imperative voice, 20-rule max, falsifiable instructions, examples over descriptions
- `agentboot test` — deterministic (free) + behavioral (LLM) + regression (snapshot) testing
- Continuous optimization loop — weekly review process with metrics-driven prompt improvements

### CLI Design

`docs/cli-design.md` — standalone binary via `brew install agentboot`:
- `agentboot setup` — interactive wizard that detects role/tools/org and executes the right setup
- `agentboot build/sync/export/publish` — build pipeline for platform teams
- `agentboot connect` — developer self-service org connection
- `agentboot doctor/status` — diagnostics and deployment dashboard
- `agentboot add` — scaffold personas, traits, domains, gotchas, hooks; `add prompt` ingests raw prompts
- `agentboot discover` — scan repos/machines for existing agentic content, overlap analysis, migration plan
- Distributed via brew/apt/choco (zero runtime deps), npm/npx as fallback

### Knowledge Layer

`docs/knowledge-layer.md` — three-stage progression from flat files to RAG:
- **Stage 1 (Flat files):** Current default. Markdown gotchas/traits with path scoping. Works for 5-50 items.
- **Stage 2 (Structured store):** SQLite index generated from frontmatter. MCP server exposes tag/category queries. Handles 50-500 items. Zero new infrastructure.
- **Stage 3 (Vector/RAG):** Embeddings + semantic retrieval via sqlite-vss. Personas find knowledge by relevance, not keywords. "This code is similar to an incident last year." Handles 500+ items.
- MCP interface stays stable across all three stages — personas don't change when the backing store upgrades.
- Killer use case: context-aware review that brings organizational memory (incidents, ADRs, patterns) to every PR.
- Most orgs stay at Stage 1 forever. Stage 2 is the sweet spot for mature orgs. Stage 3 is for compliance-heavy industries.

### Test Plan

`docs/test-plan.md` — 6-layer test pyramid:
- **Unit/Schema** (free, every commit): config validation, frontmatter, trait composition, lint rules
- **Integration** (free, every commit): full build pipeline, plugin export, sync, uninstall
- **Behavioral** (~$5/PR): `claude -p` with known-buggy code, assert on findings patterns, 2-of-3 flake tolerance
- **Snapshot/Regression** (~$5, persona changes): compare output across versions, detect regressions
- **LLM-as-Judge** (~$20, major changes): Opus evaluates persona quality on 5 dimensions
- **Human Review** (monthly): `agentboot review` with guided questions on curated samples, 15min/persona
- Agents test agents, but humans always decide. Automation removes burden, not judgment.
- Mutation testing validates that tests catch the regressions they should.
- Monthly automated testing budget: ~$165 for 4 personas (less than 1 hour of manual review)

### Developer Onboarding

`docs/developer-onboarding.md` — lightweight agentic training assist (not an LMS):
- First-session welcome (~80 tokens in CLAUDE.md — try these personas now)
- `/learn` skill — contextual help ("how do I review one file?", "what do severity levels mean?")
- Curated external resource links (Anthropic docs, community guides) — AgentBoot curates, doesn't build content
- Contextual tips in persona output (first-invocation hints, vague-prompt nudges, rate-limited, disable-able)
- Generated onboarding checklist from org's actual config
- Org-authored tips (`onboarding/` dir in personas repo — institutional knowledge transfer)

### Marketplace & Community Sharing

`docs/marketplace.md` — three-layer marketplace (Core → Verified → Community):
- Traits are the most shareable unit (context-free behavioral blocks)
- Gotchas rules are technology-specific, not org-specific (universally useful)
- Domain layers package traits + personas + gotchas for compliance regimes (healthcare, fintech, govtech)
- SuperClaude partnership: shared trait format standard + cross-listing in marketplaces
- Contribution model with review process for Verified tier
- CC plugin packaging: each domain/category = one installable plugin
- Monetization paths documented for V2+ (premium domains, managed marketplace, consulting, certification)

### Third-Party Ecosystem

`docs/third-party-ecosystem.md` — 5 key tools analyzed (SuperClaude, ArcKit, spec-kit, Trail of Bits config + skills):
- AgentBoot is the governance/distribution layer, not competing with content tools
- All ideas developed independently; 3P tools are prior art (parallel evolution, not derivation)
- Marketplace curation (point to upstream) is the recommended partnership model over bundling
- Apache 2.0 license for core; domain layers carry their own licenses
- ACKNOWLEDGMENTS.md with prior art / complementary / integrated / includes categories
- CC-BY-SA-4.0 (ToB skills) requires ShareAlike — cannot be relicensed as MIT

### CI/CD & Automation

`docs/ci-cd-automation.md` covers 5 CI methods:
- `claude -p --agent --output-format json` is the primary CI interface (cost-bounded, schema-enforced)
- Hook scripts for deterministic compliance gates (free, <1s, no LLM)
- `agentboot validate/build/sync` for the personas repo pipeline
- MCP server for non-CC CI environments
- Reusable GitHub Actions workflow for lowest-friction integration

### Claude Code Reference

`docs/claude-code-reference/` is the living knowledge base of every CC feature:
- `feature-inventory.md` — exhaustive reference (35 tools, 25 hook events, all settings, all frontmatter fields)
- `agentboot-coverage.md` — gap analysis with 24 prioritized action items

### Planning Documents

`docs/plans/` contains the formal planning docs synthesized from all design work:
- `prd.md` (2,090 lines) — problem, users, vision, 52 feature requirements across 9 subsystems, 8 non-goals, success metrics, 32 open questions, 40+ term glossary
- `architecture.md` (2,658 lines) — system context, 8 component diagrams, data schemas, scope merge semantics, build pipeline, distribution, security, cross-platform, 15 architectural decisions (AD-01–AD-15), 20 open questions
- `technical-spec.md` (2,943 lines) — all 21 CLI commands specified, build system algorithms, persona.config.json schema (newly designed), 15 lint rules, canonical test YAML format, telemetry schema, MCP tools, plugin packaging, 20 open questions
- `design.md` (2,213 lines) — UX per user segment, privacy deep dive (13 subsections), marketplace/community, prompt lifecycle, onboarding flows, uninstall, brand, licensing, 31 open questions

Total: ~9,900 lines of planning documentation with ~103 open questions to resolve.

## Known Gaps

- `scripts/cli.ts` doesn't exist — blocks `agentboot setup` bin command (Phase 2)
- No cursor or gemini output formats (Phase 2)
- Trait weight system (HIGH/MEDIUM/LOW) not yet implemented — traits are included or not (Phase 2)
- No runtime config schema validation (zod planned but not wired in) (Phase 2)
- Extension path `./personas` in config warns but doesn't block
- `repos.json` is empty — production sync path untested in real workflow (uses dev-sync for dogfooding)
- This repo is the build tool, not a personas hub — orgs create a separate `personas` repo that uses AgentBoot as the build tool
