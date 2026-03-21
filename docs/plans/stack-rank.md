# Feature Stack Rank

Legend:
- **[BUILD]** = build system / compile pipeline
- **[CLI]** = command-line tool
- **[PERSONA]** = persona/trait/content system
- **[DELIVER]** = delivery and distribution
- **[PRIVACY]** = privacy, telemetry, metrics
- **[TEST]** = testing infrastructure
- **[KNOWLEDGE]** = knowledge layer / MCP
- **[ONBOARD]** = developer onboarding
- **[MARKET]** = marketplace and community

---

## Phase 1: "AgentBoot Builds Itself"

**Definition of done:** `npm run dev-build` compiles all 4 personas and syncs them back
into the AgentBoot repo. Claude Code uses AgentBoot's own personas when working on
AgentBoot code.

| # | Feature | Category | Jira |
|---|---------|----------|------|
| 1 | Core trait files complete and well-authored (6 exist) | [PERSONA] | AB-49 |
| 2 | persona.config.json for all 4 personas | [PERSONA] | AB-50 |
| 3 | agentboot.config.json schema finalized | [BUILD] | AB-13 |
| 4 | Validation script works end-to-end | [BUILD] | AB-11 |
| 5 | Compile script works end-to-end (CC-native + cross-platform output) | [BUILD] | AB-12 |
| 6 | repos.json created (self-referencing) | [BUILD] | AB-14 |
| 7 | Sync script works end-to-end (local mode) | [BUILD] | AB-15 |
| 8 | Always-on instructions (baseline + security) | [PERSONA] | AB-51 |
| 9 | CC-native output: .claude/agents/ with full frontmatter | [BUILD] | AB-17 |
| 10 | CC-native output: .claude/CLAUDE.md with @imports | [BUILD] | AB-19 |
| 11 | CC-native output: .claude/rules/ with paths: frontmatter | [BUILD] | AB-20 |
| 12 | Unit tests for config validation + frontmatter parsing | [TEST] | AB-67 |
| 13 | Integration tests for build pipeline | [TEST] | AB-68 |

---

## Phase 2: "Usable by Others"

**Definition of done:** A second repo can install AgentBoot personas via CLI. Setup wizard,
scaffolding, doctor, and uninstall all work. Basic prompt quality checks in place.

| # | Feature | Category | Jira | Status |
|---|---------|----------|------|--------|
| 14 | Scope merging (org → group → team → repo) | [BUILD] | AB-16 | ✓ Done |
| 15 | CLI scaffolding (commander, entry point, --help) | [CLI] | AB-29 | ✓ Done |
| 16 | `agentboot build` command | [CLI] | AB-30 | ✓ Done |
| 17 | `agentboot validate` command | [CLI] | AB-31 | ✓ Done |
| 18 | `agentboot sync` command | [CLI] | AB-32 | ✓ Done |
| 19 | `agentboot setup` wizard (interactive) | [CLI] | AB-33 | ✓ Done |
| 20 | `agentboot add persona` scaffolding | [CLI] | AB-34 | ✓ Done |
| 21 | `agentboot add trait` scaffolding | [CLI] | AB-35 | ✓ Done |
| 22 | `agentboot doctor` | [CLI] | AB-36 | ✓ Done |
| 23 | `agentboot uninstall` | [CLI] | AB-45 | ✓ Done |
| 24 | .agentboot-manifest.json (track managed files) | [BUILD] | AB-24 | ✓ Done |
| 25 | CC-native output: .claude/skills/ with context:fork | [BUILD] | AB-18 | ✓ Done |
| 26 | Cross-platform output: standalone SKILL.md (traits inlined) | [BUILD] | AB-21 | ✓ Done |
| 27 | Cross-platform output: copilot-instructions.md | [BUILD] | AB-22 | ✓ Done |
| 28 | PERSONAS.md auto-generation | [BUILD] | AB-23 | ✓ Done |
| 29 | Gotchas rules concept (path-scoped knowledge) | [PERSONA] | AB-52 | ✓ Done |
| 30 | Prompt style guide in scaffolding templates | [PERSONA] | AB-55 | ✓ Done |
| 31 | `agentboot lint` (static prompt analysis) | [CLI] | AB-38 | ✓ Done |
| 32 | Token budget calculation at build time | [BUILD] | AB-25 | ✓ Done |
| 33 | `agentboot status` | [CLI] | AB-37 | ✓ Done |
| 34 | `agentboot config repo platform <name>` (switch repo platform) | [CLI] | — | ✓ Done |
| 35 | First-session welcome fragment in CLAUDE.md | [ONBOARD] | AB-77 | ✓ Done |

---

## Phase 3: "Distribution & Trust"

**Definition of done:** Personas can be packaged as CC plugins and published. Privacy model
and compliance hooks are in place. Sync creates PRs instead of direct writes.

| # | Feature | Category | Jira | Status |
|---|---------|----------|------|--------|
| 35 | Plugin structure (plugin.json, agents/, skills/, hooks/) | [DELIVER] | AB-57 | |
| 36 | `agentboot export --format plugin` | [CLI] | AB-40 | |
| 37 | `agentboot publish` | [CLI] | AB-41 | |
| 38 | Private marketplace template (marketplace.json) | [DELIVER] | AB-58 | |
| 39 | Brew tap distribution | [CLI] | AB-39 | |
| 40 | CC-native output: .claude/settings.json (hooks) | [BUILD] | AB-26 | ✓ Done |
| 41 | Compliance hooks — input scanning (UserPromptSubmit) | [DELIVER] | AB-59 | |
| 42 | Compliance hooks — output scanning (Stop) | [DELIVER] | AB-60 | |
| 43 | Three-tier privacy model (config: rawPrompts false) | [PRIVACY] | AB-62 | |
| 44 | Telemetry config (includeDevId: false/hashed/email) | [PRIVACY] | AB-65 | |
| 45 | Audit trail hooks (SubagentStart/Stop, PostToolUse) | [PRIVACY] | AB-63 | |
| 46 | Telemetry NDJSON output (canonical schema) | [PRIVACY] | AB-64 | |
| 47 | Managed settings artifact generation | [DELIVER] | AB-61 | |
| 48 | Sync via GitHub API (PR creation mode) | [BUILD] | AB-28 | ✓ Done |
| 49 | CC-native output: .mcp.json generation | [BUILD] | AB-27 | ✓ Done |
| 50 | Per-persona extensions (extend without modify) | [PERSONA] | AB-54 | |
| 51 | Domain layer structure (agentboot.domain.json) | [PERSONA] | AB-53 | |
| 52 | `agentboot add gotcha/domain/hook` scaffolding | [CLI] | AB-46 | |

---

## Phase 4: "Migration & Adoption"

**Definition of done:** Organizations can discover existing agentic content, generate a
migration plan, and onboard developers. Behavioral tests validate persona quality.

| # | Feature | Category | Jira |
|---|---------|----------|------|
| 53 | `agentboot connect` (developer self-service) | [CLI] | AB-42 |
| 54 | `agentboot discover` scan + overlap + migration plan | [CLI] | AB-43 |
| 55 | `agentboot add prompt` classify + --batch decompose | [CLI] | AB-44 |
| 56 | Behavioral tests (claude -p, YAML, assertions) | [TEST] | AB-69 |
| 57 | Snapshot / regression tests | [TEST] | AB-70 |
| 58 | CI workflow template for personas repo | [TEST] | AB-72 |
| 59 | Reusable GitHub Actions workflow (agentboot-review) | [TEST] | AB-71 |
| 60 | `agentboot cost-estimate` | [CLI] | AB-47 |
| 61 | `agentboot metrics` | [CLI] | AB-48 |
| 62 | Model selection matrix in docs | [PERSONA] | AB-56 |
| 63 | /learn skill (contextual help) | [ONBOARD] | AB-78 |
| 64 | Onboarding checklist generator | [ONBOARD] | AB-79 |

---

## Phase 5: "Ecosystem & Advanced"

**Definition of done:** Public marketplace, knowledge layer beyond flat files, advanced
governance features, cross-platform output for non-CC agents.

| # | Feature | Category | Jira |
|---|---------|----------|------|
| 65 | /insights skill (private prompt analytics) | [PRIVACY] | AB-66 |
| 66 | Marketplace core layer (bundled traits + personas) | [MARKET] | AB-80 |
| 67 | Marketplace verified layer (review process) | [MARKET] | AB-81 |
| 68 | Marketplace contribution guide + PR template | [MARKET] | AB-82 |
| 69 | Marketplace web catalog (agentboot.dev) | [MARKET] | AB-83 |
| 70 | LLM-as-judge evaluations | [TEST] | AB-73 |
| 71 | Knowledge Stage 2: SQLite index + MCP server | [KNOWLEDGE] | AB-74 |
| 72 | Knowledge Stage 3: Vector embeddings / RAG | [KNOWLEDGE] | AB-75 |
| 73 | MCP server (@agentboot/mcp-server) | [KNOWLEDGE] | AB-76 |
| 74 | ADR governance (create-adr, propose-exception) | [GOVERNANCE] | AB-84 |
| 75 | Autonomy progression (Advisory → Autonomous) | [GOVERNANCE] | AB-85 |
| 76 | Cross-platform: Copilot/Cursor/Gemini specific output | [BUILD] | AB-86 |

---

## Full Stack Rank (all features)

| # | Feature | Category | Rationale |
|---|---------|----------|-----------|
| 1 | Core trait files complete and well-authored (6 exist) | [PERSONA] | Everything depends on good traits |
| 2 | persona.config.json for all 4 personas | [PERSONA] | Blocks trait composition — the whole system |
| 3 | Validation script works end-to-end | [BUILD] | Gate before anything compiles |
| 4 | Compile script works end-to-end (CC-native + cross-platform output) | [BUILD] | The core value — traits composed into personas |
| 5 | agentboot.config.json schema finalized | [BUILD] | Every command reads this |
| 6 | repos.json created and schema defined | [BUILD] | Sync needs targets |
| 7 | Sync script works end-to-end (local mode) | [BUILD] | Content must reach repos |
| 8 | Scope merging (org → group → team → repo) | [BUILD] | Differentiator — without this it's just file copy |
| 9 | CLI scaffolding (commander, entry point, --help) | [CLI] | Every user interaction goes through CLI |
| 10 | `agentboot build` command | [CLI] | Wraps compile pipeline |
| 11 | `agentboot validate` command | [CLI] | Wraps validation |
| 12 | `agentboot sync` command | [CLI] | Wraps sync pipeline |
| 13 | Always-on instructions (baseline + security) | [PERSONA] | Universal guardrails distributed to every repo |
| 14 | CC-native output: .claude/agents/ with full frontmatter | [BUILD] | Use CC's full feature surface |
| 15 | CC-native output: .claude/skills/ with context:fork | [BUILD] | Skill invocation surface |
| 16 | CC-native output: .claude/CLAUDE.md with @imports | [BUILD] | Token-efficient trait delivery |
| 17 | CC-native output: .claude/rules/ with paths: frontmatter | [BUILD] | Path-scoped gotchas |
| 18 | Cross-platform output: standalone SKILL.md (traits inlined) | [BUILD] | Copilot/Cursor/Gemini support |
| 19 | Cross-platform output: copilot-instructions.md | [BUILD] | Copilot support |
| 20 | PERSONAS.md auto-generation | [BUILD] | Registry of what's available |
| 21 | Unit tests for config validation + frontmatter parsing | [TEST] | Prevent regressions from day one |
| 22 | Integration tests for build pipeline | [TEST] | Verify compile output is correct |
| 23 | `agentboot setup` wizard (interactive) | [CLI] | First-time entry point for all users |
| 24 | `agentboot add persona` scaffolding | [CLI] | Best-practice template for new personas |
| 25 | `agentboot add trait` scaffolding | [CLI] | Best-practice template for new traits |
| 26 | Gotchas rules concept (path-scoped knowledge) | [PERSONA] | High-value, immediate developer benefit |
| 27 | Domain layer structure (agentboot.domain.json) | [PERSONA] | Extensibility foundation |
| 28 | Per-persona extensions (extend without modify) | [PERSONA] | Product-level customization |
| 29 | .agentboot-manifest.json (track managed files) | [BUILD] | Required for clean uninstall and sync safety |
| 30 | `agentboot doctor` | [CLI] | Diagnosability from day one |
| 31 | `agentboot status` | [CLI] | What's deployed where |
| 32 | Prompt style guide in scaffolding templates | [PERSONA] | Baked-in quality from `agentboot add` |
| 33 | `agentboot lint` (static prompt analysis) | [CLI] | Catch quality issues before build |
| 34 | Token budget calculation at build time | [BUILD] | Warn on context bloat |
| 35 | Brew tap distribution | [CLI] | Primary install method |
| 36 | `agentboot export --format plugin` | [CLI] | Generate CC plugin from personas repo |
| 37 | Plugin structure (plugin.json, agents/, skills/, hooks/) | [DELIVER] | Native CC distribution |
| 38 | Private marketplace template (marketplace.json scaffold) | [DELIVER] | Org distribution |
| 39 | `agentboot publish` | [CLI] | Push plugin to marketplace |
| 40 | CC-native output: .claude/settings.json (hooks) | [BUILD] | Compliance enforcement |
| 41 | Compliance hooks — input scanning (UserPromptSubmit) | [DELIVER] | Defense-in-depth layer 1 |
| 42 | Compliance hooks — output scanning (Stop) | [DELIVER] | Defense-in-depth layer 3 |
| 43 | Audit trail hooks (SubagentStart/Stop, PostToolUse) | [PRIVACY] | Telemetry foundation |
| 44 | Telemetry NDJSON output (canonical schema) | [PRIVACY] | Measurement foundation |
| 45 | `agentboot connect` (developer self-service) | [CLI] | Org onboarding path 3 |
| 46 | `agentboot discover` (scan for existing content) | [CLI] | Migration from scattered to governed |
| 47 | `agentboot discover` overlap analysis | [CLI] | "12 repos have TypeScript strict mode in 4 wordings" |
| 48 | `agentboot discover` migration plan | [CLI] | "Before: 5600 lines, After: 800 lines" |
| 49 | `agentboot add prompt` (classify + format raw prompt) | [CLI] | On-ramp from informal to governed |
| 50 | `agentboot add prompt --batch` (decompose existing CLAUDE.md) | [CLI] | Migration tool |
| 51 | Behavioral tests (claude -p, YAML format, assertions) | [TEST] | Persona quality verification |
| 52 | First-session welcome fragment in CLAUDE.md | [ONBOARD] | Zero-effort onboarding |
| 53 | Three-tier privacy model (config: rawPrompts false) | [PRIVACY] | Trust foundation |
| 54 | Telemetry config (includeDevId: false/hashed/email) | [PRIVACY] | Org metrics without surveillance |
| 55 | `agentboot uninstall` | [CLI] | Easy exit builds trust |
| 56 | Non-destructive archive during discover/sync | [CLI] | Safety net for adoption |
| 57 | `agentboot add gotcha` scaffolding | [CLI] | Template for battle-tested knowledge |
| 58 | `agentboot add domain` scaffolding | [CLI] | Template for compliance layers |
| 59 | `agentboot add hook` scaffolding | [CLI] | Template for compliance hooks |
| 60 | Managed settings artifact generation | [DELIVER] | HARD guardrails for MDM |
| 61 | CC-native output: .mcp.json generation | [BUILD] | MCP server configs in target repos |
| 62 | Sync via GitHub API (PR creation mode) | [BUILD] | Automated distribution |
| 63 | `agentboot cost-estimate` | [CLI] | ROI visibility |
| 64 | Model selection matrix in docs | [PERSONA] | Cost optimization guidance |
| 65 | `agentboot metrics` | [CLI] | Read telemetry, report per-persona |
| 66 | `/insights` skill (private prompt analytics) | [PRIVACY] | Developer self-improvement |
| 67 | Org dashboard design (aggregate metrics) | [PRIVACY] | Leadership visibility |
| 68 | Snapshot / regression tests | [TEST] | Detect persona drift |
| 69 | `/learn` skill (contextual help) | [ONBOARD] | "How do I review one file?" |
| 70 | Curated external resource links | [ONBOARD] | Anthropic docs, community guides |
| 71 | Onboarding checklist generator | [ONBOARD] | Generated from org config |
| 72 | Contextual tips in persona output | [ONBOARD] | First-invocation hints |
| 73 | Org-authored onboarding content (onboarding/ dir) | [ONBOARD] | Institutional knowledge transfer |
| 74 | Reusable GitHub Actions workflow (agentboot-review) | [TEST] | Lowest-friction CI integration |
| 75 | CI workflow template for personas repo | [TEST] | Build/validate/sync on merge |
| 76 | `agentboot upgrade` | [CLI] | Pull latest core |
| 77 | Marketplace core layer (core traits + personas) | [MARKET] | Public baseline |
| 78 | Marketplace verified layer (community review process) | [MARKET] | Curated quality |
| 79 | Marketplace contribution guide + PR template | [MARKET] | Community onboarding |
| 80 | Contributor profiles + attribution in frontmatter | [MARKET] | Professional reputation incentive |
| 81 | `agentboot search` (marketplace search) | [CLI] | Discovery |
| 82 | Marketplace web catalog (agentboot.dev) | [MARKET] | Public discovery |
| 83 | ACKNOWLEDGMENTS.md | [MARKET] | Prior art credit |
| 84 | SuperClaude cross-listing in marketplace | [MARKET] | Ecosystem growth |
| 85 | Escalation exception (harmful content flagging) | [PRIVACY] | Compliance safety valve |
| 86 | HARD/SOFT guardrail elevation (/elevate with TTL) | [PRIVACY] | Emergency bypass |
| 87 | ADR governance (create-adr, propose-exception skills) | [PERSONA] | Permanent exception management |
| 88 | Reviewer selection config (JSON routing) | [PERSONA] | Auto-route to right reviewer |
| 89 | `/review` meta-skill (orchestrate multiple reviewers) | [PERSONA] | Single invocation, multiple reviews |
| 90 | Self-improvement reflections (.claude/reflections/) | [PERSONA] | Personas get better over time |
| 91 | Creative-suggestion trait (counterpart to critical-thinking) | [PERSONA] | Build-up dial for reviewers |
| 92 | LLM-as-judge evaluations | [TEST] | Quality measurement |
| 93 | Human review tool (`agentboot review`) | [TEST] | Guided quality assessment |
| 94 | Mutation testing | [TEST] | Test the tests |
| 95 | Knowledge Stage 2: SQLite index + MCP server | [KNOWLEDGE] | Structured queries at scale |
| 96 | Knowledge Stage 3: Vector embeddings / RAG | [KNOWLEDGE] | Semantic retrieval |
| 97 | MCP server (`@agentboot/mcp-server`) | [KNOWLEDGE] | Cross-platform persona serving |
| 98 | SME discoverability fragment (auto-generated) | [ONBOARD] | Persona discovery in CLAUDE.md |
| 99 | Autonomy progression (Advisory → Auto-approve → Autonomous) | [PERSONA] | Per-persona independence levels |
| 100 | Persona arbitrator (conflict resolution) | [PERSONA] | Cross-reviewer conflict handling |
| 101 | Team champions governance model (documentation) | [DELIVER] | Human governance layer |
| 102 | Two-channel MDM distribution (managed + git) | [DELIVER] | Enterprise enforcement |
| 103 | Marketplace community layer (unreviewed, open) | [MARKET] | Ecosystem scale |
| 104 | Marketplace monetization exploration | [MARKET] | Revenue paths |
| 105 | Cowork plugin surface for non-engineers | [DELIVER] | Desktop GUI for PMs, compliance |
| 106 | Copilot-specific output: .github/prompts/ generation | [BUILD] | Copilot slash commands |
| 107 | Cursor-specific output: .cursor/rules/ generation | [BUILD] | Cursor support |
| 108 | Gemini-specific output: GEMINI.md generation | [BUILD] | Gemini CLI support |
| 109 | AgentBoot as MCP server (expose personas to any client) | [KNOWLEDGE] | Universal agent interface |
| 110 | `agentboot issue` (streamlined bug reporting) | [CLI] | Bug attribution helper |
| 111 | `agentboot review` samples tool | [TEST] | Guided persona review |
| 112 | Prompt hook type for LLM-evaluated compliance | [DELIVER] | Haiku-based input scanning |
| 113 | A/B testing for persona versions | [TEST] | Compare persona variants |
| 114 | `/optimize` skill (automated improvement suggestions) | [PRIVACY] | AI-driven prompt tuning |
