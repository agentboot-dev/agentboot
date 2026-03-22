---
sidebar_label: "Glossary"
sidebar_position: 1
---

# Glossary

Key terms used throughout AgentBoot documentation.

**ADR (Architecture Decision Record)** — A formal exception governance mechanism. When a developer intentionally deviates from a persona's recommendation, an ADR documents the rationale, gets reviewer approval, and becomes a permanent record the persona learns to respect.

**Agent** — A custom AI assistant defined with rich configuration (model, permissions, tools, hooks, memory). In AgentBoot, personas are compiled into agents for Claude Code output.

**Agent-Agnostic** — Content that works across multiple AI agent platforms without modification. Traits, personas (SKILL.md), and gotchas are agent-agnostic. Hooks, managed settings, and agent frontmatter are platform-specific.

**agentskills.io** — An open standard for AI agent skill definitions using SKILL.md format (Markdown with YAML frontmatter). Supported by 26+ agent platforms. AgentBoot uses agentskills.io as its cross-platform persona format.

**Always-On Instructions** — Universal guardrails distributed to every repo regardless of persona configuration. These load at session start and remain active throughout, enforcing org-wide rules like security baselines and compliance requirements.

**Autonomy Progression** — A three-phase model for persona independence: Advisory (persona produces findings, human decides), Auto-approve (low-risk fixes applied automatically), and Autonomous (persona operates independently, human reviews post-hoc).

**Build Pipeline** — The three-stage process that produces deployable output: validate (pre-build checks), compile (resolve traits, produce output), sync (distribute to repos).

**CC-First Delivery** — The principle that Claude Code is the primary delivery target. Content is agent-agnostic and portable, but delivery leverages Claude Code's full feature surface (plugins, hooks, managed settings, MCP).

**Compilation Target** — One of the output formats produced by `agentboot build`. The cross-platform target produces standalone SKILL.md files with traits inlined. The CC-native target produces the full `.claude/` directory structure with imports, frontmatter, hooks, and MCP configuration.

**Convention Over Configuration** — The principle that AgentBoot ships with sensible defaults for everything. Organizations configure only what is different about their situation, not everything from scratch.

**Cowork** — Anthropic's desktop application for non-technical users. Cowork plugins use the same format as Claude Code plugins but appear in a GUI with form-based input rather than slash commands.

**Domain Layer** — A complete package of traits, personas, gotchas, and instructions for a specific compliance regime or technology stack (e.g., healthcare-compliance, fintech-compliance). Domain layers are the highest-value marketplace contribution.

**Frontmatter** — A YAML metadata block at the top of a Markdown file, delimited by `---`. Used in SKILL.md files for persona metadata (name, version, traits, scope) and in gotchas for path-scoping configuration.

**GELF (Graylog Extended Log Format)** — A structured log format used alongside NDJSON for persona telemetry output. Provides standardized fields for log aggregation systems.

**Gotcha (Gotchas Rule)** — A path-scoped instruction encoding hard-won operational knowledge. Activated only when a developer works on files matching the glob pattern, invisible otherwise. Technology-specific and highly shareable.

**HARD Guardrail** — A non-overridable compliance rule deployed via MDM or marked `required: true` in the org config. Cannot be elevated, overridden, or disabled at any scope level. Used for rules where violation is a compliance incident.

**Hub-and-Spoke Distribution** — The distribution model where one central repository (the hub) contains the source of truth and target repositories (spokes) receive compiled artifacts via the sync pipeline. One-way flow: hub publishes, spokes receive.

**JSONC** — JSON with Comments. The format used by `agentboot.config.json`, allowing inline comments for documentation within configuration files.

**Managed Settings** — Claude Code configuration files deployed to OS-level paths via MDM. Cannot be overridden by any user or project setting. Used for HARD guardrails and forced plugin installation.

**Marketplace** — The three-layer ecosystem for sharing governance content: Core (maintained by AgentBoot), Verified (community-contributed and reviewed), and Community (unreviewed).

**MCP (Model Context Protocol)** — A protocol for AI agents to interact with external tools and data sources. MCP servers expose tools and resources that agents can consume. AgentBoot uses MCP for cross-platform persona serving and knowledge base access.

**MDM (Mobile Device Management)** — Enterprise device management tooling (e.g., Jamf, Intune) used to deploy managed settings files to developer machines. The enforcement channel for HARD guardrails.

**NDJSON (Newline-Delimited JSON)** — A format where each line is a valid JSON object, used for structured telemetry output. Human-queryable with tools like `jq`.

**Persona** — A complete, deployable AI agent. A composition of traits plus a specialized system prompt that defines the agent's identity, operating context, and mandate. Personas compose traits; they do not inherit from each other.

**persona.config.json** — Build metadata for a persona. Specifies which traits to compose, the target model, permission mode, tool restrictions, MCP servers, hooks, and autonomy level.

**Persona Arbitrator** — A dedicated persona that resolves conflicts when multiple reviewer personas produce contradictory findings on the same code. Only invoked when conflicting findings are detected.

**Plugin** — A Claude Code distribution unit that bundles agents, skills, hooks, rules, MCP configuration, and settings into a single installable package. The primary delivery method for Claude Code users.

**Prompts as Code** — The principle that AI agent behavior is treated as infrastructure: defined in files, stored in version control, reviewed in pull requests, tested, linted, and measured. Analogous to Infrastructure as Code.

**Scope Hierarchy** — The four-level organizational model: Org, Group, Team, Repo. More specific scopes layer on top of general ones. Optional behaviors follow "most specific wins." Mandatory behaviors follow "most general wins."

**Self-Improvement Reflections** — An optional mechanism where personas write brief reflections after completing their task. Reflections accumulate into a dataset revealing patterns for persona improvement.

**SKILL.md** — The agentskills.io format for persona definitions. A Markdown file with YAML frontmatter (name, description, traits, scope, output format) followed by the system prompt in prose.

**SME Discoverability Fragment** — A lightweight always-on section (~100 tokens) auto-generated by the build system that lists all available personas and how to invoke them.

**SOFT Guardrail** — An important default that can be temporarily elevated. Elevation is time-bounded (default 30 minutes), creates an audit log entry, and automatically re-engages on expiry.

**Structured Telemetry** — Persona invocation metrics emitted as structured JSON. Fields include persona ID, model, scope, token counts, cost, findings, duration, and timestamp. Contains no developer identity or prompt text by default.

**Team Champion** — A designated engineer on each team (typically tech lead or senior IC) who manages sync, reviews sync PRs, files quality feedback, onboards teammates, and proposes governance improvements.

**Trait** — A reusable behavioral building block for an AI persona. Captures a single aspect of how an agent should think or communicate. Composed at build time, never at runtime.

**Trait Weight** — A calibration system for traits supporting variable intensity. Named weights (HIGH/MEDIUM/LOW) map to numeric values. The weight adjusts the threshold for action, not the type of action.

**Two-Channel MDM Distribution** — Enterprise distribution model separating non-negotiable enforcement (Channel 1: MDM-deployed managed settings for HARD guardrails) from team-customizable configuration (Channel 2: Git-based hub-and-spoke for everything else).
