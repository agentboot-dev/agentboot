---
sidebar_label: "Glossary"
sidebar_position: 1
---

# Glossary

Key terms used throughout AgentBoot documentation.

**Adopt-Existing (`sync --adopt-existing`)** — The flag that lets a **first** sync replace pre-existing hand-written instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, Copilot instructions) in a repo. Without it, a first sync onto such a repo hard-stops. With it, everything the sync overwrites is archived to the repo's `.agentboot-archive/` first (restorable via `agentboot uninstall`). Running `agentboot import` first is the recommended alternative.

**ADR (Architecture Decision Record)** — A design-intent exception governance mechanism (not yet shipped): an ADR would document an intentional deviation, get reviewer approval, and become a permanent record the persona learns to respect. The shipped exception mechanism today is the policy-exception file — see **Exception**.

**Agent** — A custom AI assistant defined with rich configuration (model, permissions, tools, hooks, memory). In AgentBoot, personas are compiled into agents for Claude Code output.

**Agent-Agnostic** — Content that works across multiple AI agent platforms without modification. Traits, personas (SKILL.md), and gotchas are agent-agnostic. Hooks, managed settings, and agent frontmatter are platform-specific.

**AGENTS.md** — The universal standard for cross-tool agent configuration, stewarded by the Agentic AI Foundation (Linux Foundation). Natively consumed by Codex, Copilot, Cursor, Windsurf, Gemini CLI, Junie, and 60K+ projects. AgentBoot generates AGENTS.md as an **officially supported, advisory-enforcement output** — the industry-standard cross-tool instruction file. Support tier is not enforcement tier: the standard has no hook mechanism, so AGENTS.md is advisory by nature and never carries blocking enforcement (that remains a Claude Code / Codex / Copilot capability).

**agentskills.io** — An open standard for AI agent skill definitions using SKILL.md format (Markdown with YAML frontmatter). Supported by 26+ agent platforms. AgentBoot uses agentskills.io as its cross-platform persona format.

**Always-On Instructions** — Universal guidance distributed to every repo regardless of persona configuration. These load at session start and remain active throughout, stating org-wide rules like security baselines and compliance requirements. They are instructions, not hooks — they do not block; pair them with compiled hooks where a rule must be mechanically enforced.

**Autonomy Progression** — A three-phase model for persona independence: Advisory (persona produces findings, human decides), Auto-approve (low-risk fixes applied automatically), and Autonomous (persona operates independently, human reviews post-hoc).

**Build Pipeline** — The three-stage process that produces deployable output: validate (pre-build checks), compile (resolve traits, produce output), sync (distribute to repos).

**CC-First Delivery** — The principle that Claude Code is the primary delivery target. Content is agent-agnostic and portable, but delivery leverages Claude Code's full feature surface (plugins, hooks, managed settings, MCP).

**Compilation Target** — One of the output formats produced by `agentboot build`. Officially supported: the CC-native `.claude/` directory, Codex `.codex/` output, Copilot `.github/` instructions, and the AGENTS.md universal standard (officially supported, advisory-enforcement). Community tier: Cursor rules, Windsurf, Gemini, JetBrains, and cross-platform SKILL.md.

**Composition Type** — Determines precedence when the same artifact exists at multiple scope levels. `rule` = top-down (org wins, cannot be overridden by teams). `preference` = bottom-up (team wins, can customize org defaults). Defaults: gotcha=rule, persona=rule, persona-rule=rule, lexicon=rule, trait=preference, instruction=preference.

**Conformance (`agentboot conformance`)** — The empirical enforcement test harness. It executes the compiled hook scripts per platform with crafted probes (clean, secret-bearing, malformed, oversized, deny-listed tool) and compares observed blocking behavior against the platform's declared enforcement level, writing the result to the enforcement manifest. Exits non-zero on any declared-vs-observed divergence — a CI gate that keeps the capability matrix a tested contract. Controls that cannot be probed are reported untested, never assumed to pass.

**Convention Over Configuration** — The principle that AgentBoot ships with sensible defaults for everything. Organizations configure only what is different about their situation, not everything from scratch.

**Cowork** — Anthropic's desktop application for non-technical users. Cowork plugins use the same format as Claude Code plugins but appear in a GUI with form-based input rather than slash commands.

**Domain Layer** — A complete package of traits, personas, gotchas, and instructions for a specific compliance regime or technology stack (e.g., healthcare-compliance, fintech-compliance).

**Enforcement Manifest** — The machine-readable record written by `agentboot conformance` to `dist/<platform>/enforcement-manifest.json`: the platform's declared enforcement level, each control's mechanism, and per-probe expected vs observed outcomes. Advisory platforms get a manifest stating plainly that no enforcement mechanism exists.

**Exception (`agentboot-exceptions.json`)** — The shipped policy-exception workflow: owned, expiring, reviewable JSON recording approved deviations from policy. Lives at the hub root (`agentboot-exceptions.json`, validated by `agentboot validate`) and at spoke repo roots (`.agentboot-exceptions.json`, consumed by `agentboot drift-check`). Each entry requires `id`, `policy` (e.g. `"drift:<path-or-glob>"`), `reason`, `approver`, `owner`, `created`, and `expires`. Covered drift reports as `excepted` rather than failing; an expired exception is treated as absent, so the failure resurfaces and names the owner.

**Frontmatter** — A YAML metadata block at the top of a Markdown file, delimited by `---`. Used in SKILL.md files for persona metadata (name, version, traits, scope) and in gotchas for path-scoping configuration.

**GELF (Graylog Extended Log Format)** — A structured log format referenced in AgentBoot's telemetry design discussion as a possible aggregation-friendly format. The shipped telemetry output is NDJSON only.

**Gotcha (Gotchas Rule)** — An instruction encoding hard-won operational knowledge, carrying a `paths:` glob in its frontmatter. **Whether that glob actually activates the rule depends on the target.** Copilot expresses it natively, and Cursor, Windsurf and JetBrains receive it translated — on those, the gotcha loads only for matching files and costs nothing otherwise. Claude Code, Codex, Gemini, plugin and `SKILL.md` output have no scoping mechanism, so the gotcha is delivered **always-on**: Claude Code writes it to `.claude/rules/` and restates the glob as an `Applies to:` line, which *tells* the agent the scope rather than enforcing it. See the [platform capability matrix](platform-capability-matrix.md).

**HARD Guardrail** — A compliance rule a lower scope may not weaken: shadowing it, downgrading it to soft, or zeroing its trait weight are all errors under `validate --strict`. That is a *composition* property, enforced at compile time. Whether it is also a *mechanical* control at runtime depends on the target — blocking hooks on the three official CLI surfaces, advisory text everywhere else (including the officially supported `AGENTS.md` output). The three are not equal: Claude Code is hard-enforced; Codex blocks with known bypasses (hooks need a trust review unless deployed as managed, and tool coverage is partial); Copilot's command-hook timeouts **fail open** and its exit-2 blocking is documented platform behaviour not yet verified end to end. See the [platform capability matrix](platform-capability-matrix.md). Used for rules where violation is a compliance incident.

**Harness Engineering** — The discipline of designing the infrastructure that wraps around an AI model to make it reliable: system prompts, tool definitions, permission boundaries, feedback loops, validation gates, and context retrieval. AgentBoot is a harness engineering build tool. The term was formalized by Birgitta Bockeler (Thoughtworks) and operationalized by OpenAI in 2026.

**Harness Template** — A topology-specific bundle of traits, gotchas, personas, and compliance hooks for a common service pattern (API service, event processor, data pipeline). Follows Ashby's Law: regulators must possess variety matching the systems they govern.

**Hub-and-Spoke Distribution** — The distribution model where one central repository (the hub) contains the source of truth and target repositories (spokes) receive compiled artifacts via the sync pipeline. One-way flow: hub publishes, spokes receive.

**Lexicon** — A ubiquitous language artifact: domain term definitions that establish shared vocabulary between humans and agents. Lexicon entries are context compression primitives — once defined, every trait, gotcha, and instruction can reference the term without re-explaining it. Stored in `core/lexicon/`, compiled first in the pipeline so all other artifacts benefit. Composition type: rule (org defines terms, teams extend but don't redefine). See also: Ubiquitous Language (DDD).

**JSONC** — JSON with Comments. The format used by `agentboot.config.json`, allowing inline comments for documentation within configuration files.

**Managed Settings** — Claude Code configuration files deployed to OS-level paths via MDM; they override user and project settings. **Claude Code only** — no other supported platform has a non-overridable settings layer, so on Codex and Copilot a HARD guardrail rides in the compiled hooks instead (see the [platform capability matrix](platform-capability-matrix.md)). Used for HARD guardrails. Not for plugin installation: `managed.guardrails.forcePlugins` is typed and accepted but read by no code path on any platform, and setting it fails the build.

**MCP (Model Context Protocol)** — A protocol for AI agents to interact with external tools and data sources. MCP servers expose tools and resources that agents can consume. AgentBoot uses MCP for cross-platform persona serving.

**MDM (Mobile Device Management)** — Enterprise device management tooling (e.g., Jamf, Intune) used to deploy managed settings files to developer machines. The enforcement channel for HARD guardrails **on Claude Code**; Codex and Copilot have no managed-settings layer and carry guardrails in their compiled hooks, and the community tier carries them as advisory text only.

**NDJSON (Newline-Delimited JSON)** — A format where each line is a valid JSON object, used for structured telemetry output. Human-queryable with tools like `jq`.

**Persona** — A complete, deployable AI agent. A composition of traits plus a specialized system prompt that defines the agent's identity, operating context, and mandate. Personas compose traits; they do not inherit from each other.

**persona.config.json** — Build metadata for a persona. Specifies which traits to compose, the target model, permission mode, tool restrictions, MCP servers, hooks, and autonomy level.

**Persona Arbitrator** — A dedicated persona that resolves conflicts when multiple reviewer personas produce contradictory findings on the same code. Only invoked when conflicting findings are detected.

**Plugin** — A Claude Code distribution unit that bundles agents, skills, hooks, rules, MCP configuration, and settings into a single installable package. The primary delivery method for Claude Code users.

**Prompts as Code** — The principle that AI agent behavior is treated as infrastructure: defined in files, stored in version control, reviewed in pull requests, tested, linted, and measured. Analogous to Infrastructure as Code.

**Scope Hierarchy** — An N-tier scope tree (`nodes`) of arbitrary depth; the common shape is Org → Group → Team → Repo (the legacy flat `groups`/`teams` config still works and is converted to nodes). More specific scopes layer on top of general ones. Optional behaviors follow "most specific wins." Mandatory behaviors follow "most general wins."

**Self-Improvement Reflections** — An optional mechanism where personas write brief reflections after completing their task. Reflections accumulate into a dataset revealing patterns for persona improvement.

**SKILL.md** — The agentskills.io format for persona definitions. A Markdown file with YAML frontmatter (name, description, traits, scope, output format) followed by the system prompt in prose.

**SME Discoverability Fragment** — A lightweight always-on section (~100 tokens) auto-generated by the build system that lists all available personas and how to invoke them.

**SOFT Guardrail** — An important default that can be temporarily elevated. Elevation is time-bounded (default 30 minutes), creates an audit log entry, and automatically re-engages on expiry.

**Structured Telemetry** — Persona invocation events emitted as structured NDJSON against a deliberately minimal, versioned schema (`scripts/lib/telemetry-schema.ts`): event type, persona ID, status, timestamp, schema version, hash-chain link, and an optional developer ID. Content-bearing fields (prompts, tokens, cost, file paths) are prohibited by schema. Contains no developer identity or prompt text by default; run `agentboot telemetry-inspect` to see exactly what would be emitted.

**Team Champion** — A designated engineer on each team (typically tech lead or senior IC) who manages sync, reviews sync PRs, files quality feedback, onboards teammates, and proposes governance improvements.

**Trait** — A reusable behavioral building block for an AI persona. Captures a single aspect of how an agent should think or communicate. Composed at build time, never at runtime.

**Trait Weight** — A calibration system for traits supporting variable intensity. Named weights (OFF/LOW/MEDIUM/HIGH/MAX) map to numeric values (0.0 / 0.3 / 0.5 / 0.7 / 1.0). The weight adjusts the threshold for action, not the type of action.

**Two-Channel MDM Distribution** — Enterprise distribution model separating non-negotiable enforcement (Channel 1: MDM-deployed managed settings for HARD guardrails — Claude Code only) from team-customizable configuration (Channel 2: Git-based hub-and-spoke for everything else, which is the only channel that reaches Codex, Copilot and the community tier).

**Verify-Manifest (`agentboot verify-manifest`)** — Verification of a synced `.agentboot-manifest.json`: the manifest's content digest, every listed file's hash, and the SSH signature when present. Exits non-zero on any mismatch — suitable as a CI step in spoke repos. Signature validity proves the digest was signed; pinning *who* may sign is done by checking the signer's public key against an `allowed_signers` trust root.
