# AgentBoot — Product Requirements Document

**Version:** 1.0.0-draft
**Date:** 2026-03-19
**Author:** AgentBoot Team
**License:** Apache 2.0
**Status:** Draft — awaiting review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users](#3-target-users)
4. [Product Vision](#4-product-vision)
5. [Design Principles](#5-design-principles)
6. [Feature Requirements](#6-feature-requirements)
7. [Non-Goals](#7-non-goals)
8. [Success Metrics](#8-success-metrics)
9. [Open Questions](#9-open-questions)
10. [Glossary](#10-glossary)

---

## 1. Executive Summary

### What AgentBoot Is

AgentBoot is a build tool and governance framework for AI agent behavior in software
engineering organizations. It provides convention-over-configuration defaults for
composing, distributing, and managing AI personas across development teams — so that
every engineer in an organization gets consistent, high-quality AI agent behavior
from day one without building it themselves.

### The Problem

Organizations adopting agentic development tools (Claude Code, GitHub Copilot, Cursor,
Gemini CLI) face a fragmentation crisis. Every team writes its own CLAUDE.md, its own
rules, its own agents — independently, inconsistently, and without governance. There is
no standard for distributing agent behavior across repos, no mechanism for enforcing
compliance guardrails, no way to measure whether AI personas are delivering value, and
no path for sharing improvements across teams. The result is duplicated effort, drifting
quality, compliance gaps, and developer frustration.

### The Solution

AgentBoot applies the same discipline to AI agent behavior that Spring Boot applied to
Java application configuration: sensible defaults, composable building blocks, a scope
hierarchy that mirrors organizational structure, and a build-then-distribute pipeline
that propagates governance automatically. Persona definitions are treated as code —
version-controlled, reviewed in pull requests, tested, linted, and distributed through
a hub-and-spoke model. The framework is agent-agnostic in content (using open standards
like agentskills.io) while being Claude Code-first in delivery (leveraging the richest
extensibility surface available).

### Target User

AgentBoot serves six distinct user segments across the organization — from individual
developers who consume personas, to platform/DevEx teams who build and distribute them,
to IT/Security teams who enforce compliance, to engineering leaders who measure ROI.
Each segment interacts with AgentBoot through a different surface (plugin, CLI, managed
settings, dashboard) tailored to their role.

### Origin

AgentBoot started with personal and family projects — building AI personas for small
codebases where the author needed structured review, test generation, and domain
expertise. The patterns grew organically as the number of projects increased, then
were adapted for workplace use when it became clear that the same governance gaps
existed at organizational scale. What began as a personal toolkit evolved into a
framework when the realization hit: every team adopting agentic development was going
to build this anyway, and most would build it poorly.

---

## 2. Problem Statement

### 2.1 The Fragmentation Problem

Every team that adopts AI coding tools ends up doing the same thing: writing a
CLAUDE.md, defining some rules, maybe adding a few custom agents. Most of these are
mediocre. New teams do not know where to start. Teams in the same organization drift
apart. Nobody shares anything.

Meanwhile, the teams that invest in building it well — composable traits, structured
reviewers, compliance guardrails, a distribution pipeline — cannot share their work
because it is buried in proprietary context.

### 2.2 Specific Pain Points

**Scattered, inconsistent agent configuration.** In a typical organization with 20+
repositories, each repo has its own CLAUDE.md written independently. An audit of such
organizations typically reveals that 67% or more of repos have some version of the same
instructions (e.g., "use TypeScript strict mode"), but expressed in 4+ different
wordings, maintained independently, and never synchronized. When best practice evolves,
there is no mechanism to propagate the improvement.

**No governance structure.** Agent behavior is not reviewed, versioned, or audited. A
developer can change a CLAUDE.md with no pull request, no review, and no record of what
changed or why. When an agent produces a bad result, there is no diff to examine. When a
compliance rule needs to be added, there is no guarantee it reaches every repo.

**No distribution mechanism.** Organizations lack a way to push agent behavior updates
to all their repos simultaneously. Each repo is an island. A platform team that writes
a better code reviewer has no standard path to deploy it across 50 repos without
manually touching each one.

**No compliance enforcement.** Regulated industries (healthcare, finance, government)
need non-negotiable guardrails — PHI scanning, credential blocking, audit logging — that
cannot be disabled by any developer. Current agent platforms offer this capability
(managed settings, hooks), but there is no framework for generating, testing, and
deploying these guardrails systematically.

**No metrics or measurement.** Organizations cannot answer basic questions: Which
personas are used most? What do they cost? What is the false positive rate? Are they
improving over time? Without measurement, prompt optimization is guesswork, budget
justification is impossible, and the investment case for agentic development is based
on anecdote rather than evidence.

**Developer resistance.** Skeptics and hold-outs will not adopt AI tools voluntarily.
Without a mechanism for zero-friction deployment (managed settings, repo-embedded
configuration) and a privacy model that builds trust (no prompt surveillance), a
significant fraction of the engineering organization will never engage.

**No sharing or reuse.** Knowledge that one team gains — a PostgreSQL gotcha, a
compliance trait, a well-tuned reviewer — stays siloed. There is no marketplace, no
contribution model, and no standard format that enables sharing across teams or across
organizations.

**Context bloat.** CLAUDE.md files grow unbounded because no one prunes them. An audit
of a typical mid-size organization reveals average CLAUDE.md files of 230+ lines, with
the longest exceeding 800 lines. Most of this content is duplicated across repos, vague
("follow best practices"), or stale ("TODO: update this section").

**Vendor lock-in anxiety.** Teams hesitate to invest deeply in agent configuration for
one platform because they worry about being locked in. If the organization switches
from Claude Code to Copilot (or vice versa), will they have to rebuild everything?

**No onboarding path.** New developers join the organization and face a wall of AI
tooling they have never used. They type vague prompts, get vague results, conclude
"AI does not work for me," and abandon the tools. There is no guided path from
first interaction to productive use.

### 2.3 Why These Problems Persist

These problems persist because they are coordination problems, not technology problems.
Any single team can solve them for themselves — but the solution does not scale without
a framework. Writing a good CLAUDE.md is easy. Writing a governance system that keeps
50 repos consistent, enforces compliance, measures effectiveness, and onboards new
developers is hard. That is what AgentBoot provides.

---

## 3. Target Users

AgentBoot serves six distinct user segments. Each has different needs, different pain
points, and a different definition of success.

### 3.1 Developer

**Profile:** Individual contributor who writes code daily. May or may not already use
AI coding tools. Ranges from junior to staff level.

**Needs:**
- AI personas that work immediately when they clone a repo — zero setup
- Clear invocation patterns (`/review-code`, `/gen-tests`) that give structured results
- Privacy: confidence that their conversations, questions, and false starts are private
- The ability to ask follow-up questions about persona findings
- Control over their experience: disable tips, choose models, set preferences

**Pain points:**
- Does not know where to start with AI tools
- Gets vague results from vague prompts but does not know how to improve
- Fears being judged for questions asked to AI ("what is a foreign key?")
- Persona output is confusing — unclear severity levels, no actionable suggestions
- Multiple tools (Claude Code, Copilot, Cursor) with different configuration mechanisms

**What success looks like:**
- Clones a repo, types `/review-code`, gets a structured review with actionable findings
- Trusts that their AI conversations are private (the "IDE vs PR" mental model)
- Gradually discovers more personas and becomes more effective over weeks
- Never runs `agentboot` directly — the framework is invisible to them

### 3.2 Platform / DevEx Team

**Profile:** Engineers responsible for developer tooling, productivity, and
infrastructure. Typically 1-5 people in a mid-size org. May be a dedicated DevEx team
or a platform engineering team with tooling responsibilities.

**Needs:**
- A central repository for managing all AI persona definitions
- A build pipeline that compiles, validates, and distributes personas
- Multi-platform support (some teams use Claude Code, others use Copilot)
- Scaffolding tools for creating new personas, traits, domains, and gotchas
- Discovery tools for finding and consolidating existing agentic content across repos
- Testing tools that validate persona behavior before deployment
- A marketplace for sharing and discovering community content

**Pain points:**
- Every team has written their own CLAUDE.md independently — massive duplication
- No way to push an update to 50 repos without touching each one
- No standard format for defining agent behavior
- Cannot test whether a persona change improves or regresses behavior
- Teams resist centralization because they fear losing control of their configuration

**What success looks like:**
- Single `agentboot build && agentboot sync` deploys updates to every registered repo
- New personas and traits go through PR review with automated validation
- `agentboot discover` consolidates scattered agentic content into a governed hub
- Teams can extend (but not break) the org-wide configuration through the scope hierarchy
- Monthly testing cost under $200 for the entire persona suite

### 3.3 Engineering Leader

**Profile:** VP of Engineering, CTO, Director of Engineering. Responsible for
engineering investment decisions, team productivity, and technical strategy.

**Needs:**
- Evidence that AI tool investment is delivering ROI
- Adoption metrics: how many developers are using the tools, how often
- Cost metrics: total spend, spend per team, spend per persona
- Quality metrics: are bug escape rates improving? Is review turnaround faster?
- Confidence that governance scales as the organization grows

**Pain points:**
- Cannot justify AI tool budgets without data
- Does not know whether teams are actually using the tools or ignoring them
- Worries about compliance exposure in regulated domains
- Has seen AI initiatives fail because of poor adoption and lack of governance

**What success looks like:**
- Monthly dashboard showing adoption rates, cost breakdown, and ROI indicators
- Evidence of improved PR review turnaround, test coverage, and bug escape rates
- Confidence that compliance guardrails are active on every repo
- Can demonstrate value to the board with concrete metrics, not anecdotes

### 3.4 IT / Security

**Profile:** IT operations, security engineering, or compliance team. Responsible for
device management, security policy, and regulatory compliance.

**Needs:**
- Non-overridable guardrails that no developer can disable (HARD guardrails)
- Deployment via MDM (Jamf, Intune, JumpCloud) or server-managed settings
- Audit trail for compliance reporting
- PHI/PII scanning hooks that run on every interaction
- Credential blocking and secret detection
- Zero-touch deployment: developers should not have to opt in to compliance

**Pain points:**
- No way to enforce AI compliance across the organization
- Developer-configured AI tools are a compliance blind spot
- Cannot guarantee that PHI scanning runs on every Claude Code session
- No audit evidence of AI governance for regulatory reporting

**What success looks like:**
- Managed settings deployed via MDM — compliance hooks active on every machine
- HARD guardrails that cannot be overridden at any scope level
- Audit trail of persona invocations (without individual prompt content)
- Clean compliance audits with evidence of AI governance
- Escalation mechanism for genuinely harmful content (flags, not transcripts)

### 3.5 Skeptic / Hold-out

**Profile:** Experienced engineer who is resistant to AI tools. May have philosophical
objections, may have had bad experiences, or may simply prefer their existing workflow.
This segment exists in every organization and will never be zero.

**Needs:**
- Proof of value without disrupting their workflow
- Opt-in experience with no forced adoption
- Honest assessment of AI limitations, not hype
- Assurance that AI usage is not monitored or judged

**Pain points:**
- Feels pressured to use AI tools they do not trust
- Fears that AI metrics will be used in performance reviews
- Finds AI output noisy, inaccurate, or unhelpful
- Does not want to learn yet another tool

**What success looks like:**
- Compliance guardrails activate automatically without their action (managed settings)
- Persona-generated PR reviews appear in their workflow without them invoking anything
- Over time, sees the value in structured AI review and begins invoking personas manually
- Is never shamed, ranked, or penalized for low AI usage
- Can cleanly remove AgentBoot with one command if they decide it is not for them

### 3.6 Non-Engineer

**Profile:** Product manager, designer, compliance officer, marketing professional.
Does not use the terminal. Needs AI assistance for structured tasks (document review,
compliance checking, content analysis).

**Needs:**
- GUI-first experience with structured forms, not slash commands
- Role-specific personas (compliance review, document analysis, content checking)
- Same privacy protections as engineers

**Pain points:**
- Terminal-based tools are inaccessible
- Does not understand "install a plugin" or "run a command"
- AI tools feel designed exclusively for engineers

**What success looks like:**
- Opens a desktop application (Cowork), sees role-specific tools in a sidebar
- Fills out a form, gets structured output — never touches a terminal
- Same personas, same quality, same governance as the engineering tools

---

## 4. Product Vision

### 4.1 Positioning

AgentBoot is the Spring Boot of AI agent governance: an opinionated, drop-in foundation
that gives engineering organizations consistent AI agent behavior from day one without
building it themselves.

The analogy is precise:

| Spring Boot | AgentBoot |
|---|---|
| Convention over configuration for Java apps | Convention over configuration for AI agent behavior |
| Sensible defaults, override what is different | Sensible persona defaults, extend for your domain |
| Starter dependencies compose features | Traits compose behavioral building blocks |
| Auto-configuration detects and configures | `agentboot setup` detects role, tools, org and configures |
| Spring Boot Actuator for observability | Structured telemetry and `/insights` for measurement |
| Spring Initializr for scaffolding | `agentboot setup` and `agentboot add` for scaffolding |

### 4.2 The Build Tool Mental Model

AgentBoot is a build tool, not a runtime framework. It produces artifacts that are
consumed by AI agent platforms. The pipeline is: validate, compile, distribute.

```
Source files              Build step              Distributed artifacts
(traits, personas,   →    agentboot build    →    (.claude/, copilot-
 instructions, gotchas)                           instructions.md, plugins)
```

This distinction matters because:
- AgentBoot has zero runtime footprint — it produces files and exits
- The distributed artifacts work without AgentBoot installed
- Any platform that reads Markdown, YAML, or JSON can consume the output
- The build step is where governance happens (validation, composition, linting)
- Teams can inspect, understand, and modify the distributed output

### 4.3 Where AgentBoot Is Going

**Phase 1 (Foundation):** Build system, CLI, core personas, hub-and-spoke distribution,
scope hierarchy. The minimum viable governance system.

**Phase 2 (Native Distribution):** Claude Code plugin packaging, private marketplace,
managed settings generation. Native delivery through the platform's own mechanisms.

**Phase 3 (Cross-Platform and Enterprise):** MCP server for multi-agent organizations,
cross-platform output generation (Copilot, Cursor, Gemini), structured knowledge store.

**Phase 4 (Ecosystem):** Public marketplace, community contributions, domain layers for
regulated industries, SuperClaude partnership for trait format standardization.

### 4.4 The Long-Term Vision

AgentBoot becomes the place where AI agent governance content lives — the "npm of AI
personas." Not because of marketing, but because that is where the traits, personas,
gotchas, and domain layers are. Organizations that need governance adopt AgentBoot
because it is the standard. Contributors share their knowledge because it reaches the
most people. The ecosystem grows because useful content attracts users who become
contributors who add more useful content.

---

## 5. Design Principles

Ordered by priority. These principles inform every design decision and resolve
ambiguity when requirements conflict.

### 5.1 Composition Over Inheritance (Priority: Highest)

Personas compose traits. They do not inherit from each other. If two personas share
behavior, that behavior belongs in a trait that both compose.

This is the foundational design constraint, established as Design Principle #1 from
the earliest AgentBoot designs. Object-oriented inheritance applied to personas
("security-reviewer extends code-reviewer extends base-reviewer") creates fragile
chains where changes to a parent have unpredictable effects on children. Composition
is flat, predictable, and inspectable.

**Implication:** There is no persona hierarchy. There is no `extends` keyword. Traits
are the unit of reuse. Personas are the unit of deployment.

### 5.2 Scoped Conventions (Priority: Highest)

AgentBoot models organizations as a four-level hierarchy: Org, Group, Team, Repo.
More specific scopes layer on top of general ones. For optional behaviors, team
overrides group overrides core. For mandatory behaviors, inheritance is top-down
(org wins).

This hierarchy mirrors how real organizations structure responsibility and governance.
It ensures that governance propagates downward automatically (a new team gets all
org-level and group-level configuration without manual setup) while preserving team
autonomy on things that are genuinely team-specific.

**Implication:** The scope hierarchy is not optional. Every piece of configuration has
a scope. Conflict resolution is deterministic: mandatory rules cascade down, optional
rules override up.

### 5.3 Prompts as Code (Priority: High)

AI agent behavior is infrastructure: defined in files, stored in version control,
reviewed in pull requests, with a complete audit history. This is the same shift that
happened with Infrastructure as Code (Terraform, Pulumi) and Configuration as Code
(Kubernetes manifests, GitHub Actions workflows).

Every change to an agent's behavior is a pull request with a description and a review.
Traits and personas have version numbers. The sync pipeline propagates updates
automatically after the PR merges.

**Implication:** All persona definitions live in a Git repository. All changes go
through PR review. The build system enforces validation rules that block invalid
configurations from merging.

### 5.4 Privacy First (Priority: High)

AgentBoot will never collect, transmit, or surface raw developer prompts to
organizational dashboards, managers, or analytics pipelines. This is a design
invariant, not a configuration option.

The organization gets aggregate patterns, not transcripts. High rephrase rates are
framed as persona quality problems, not developer intelligence problems. The
`rawPrompts` configuration section contains three `false` fields that cannot be set
to `true`. They exist to make the design intent explicit.

AgentBoot is honest about the boundaries: this commitment covers what AgentBoot does.
It does not and cannot override what the API provider or the organization does
independently through other channels (Compliance API, network monitoring, data exports).

**Implication:** No telemetry field contains prompt text. No dashboard shows individual
developer activity. No feature ranks, shames, gamifies, or surveys developer AI usage.
The escalation exception (genuinely harmful content) flags the category, never the
transcript.

### 5.5 Agent-Agnostic Content, Claude Code-First Delivery (Priority: High)

Content (traits, personas, gotchas, instructions) is written in agent-agnostic formats
(Markdown, agentskills.io SKILL.md). Delivery (plugins, managed settings, hooks,
native agent frontmatter) leverages Claude Code's extensibility surface to the fullest.

If a feature "just does not work without Claude Code" — that is acceptable. Non-CC
platforms get the content (SKILL.md, instruction files, MCP servers); CC platforms get
the full governance surface (hooks, managed settings, subagent isolation, agent memory).
AgentBoot documents this gap honestly rather than pretending all agents are equal.

**Implication:** Marketplace content is stored in agent-agnostic format. The build
system produces platform-specific output. CC-specific enhancements go in metadata
(persona.config.json), not in the content itself.

### 5.6 Easy Exit Builds Trust for Easy Entry (Priority: High)

`agentboot uninstall` is a first-class command, not an afterthought. It tracks what it
manages (via a manifest), archives what it replaces, and restores what was there before.
An organization that knows they can cleanly remove the tool in one command is more
willing to try it.

No vendor lock-in, no orphaned files, no scavenger hunt. The uninstall command removes
exactly the files AgentBoot manages and preserves everything the team authored locally.

**Implication:** Every synced file is tracked in `.agentboot-manifest.json`. Original
files are archived during setup. The uninstall path is tested in integration tests.

### 5.7 Convention Over Configuration (Priority: Medium-High)

AgentBoot ships with sensible defaults for everything. Organizations configure what is
different about their organization, not everything from scratch. A single config file
(`agentboot.config.json`) and a `build && sync` command are sufficient to get started.

**Implication:** Core personas and traits ship ready to deploy. The setup wizard
determines the right configuration based on role detection, not manual specification.
The "happy path" requires minimal configuration.

### 5.8 Build-Time Composition, Not Runtime Resolution (Priority: Medium)

Traits are composed into personas at build time. The compiled output is complete and
standalone. Agents receive a single file (or a set of files with @imports for CC-native
output) with all trait content already resolved. No runtime resolution, no dynamic
includes on platforms that do not support them.

The exception is Claude Code-native output, where `@import` in CLAUDE.md composes
trait files at load time — but these files are pre-generated by the build system,
not resolved dynamically.

**Implication:** The cross-platform SKILL.md output is fully self-contained. The
CC-native output uses @imports but all imported files are generated and present.
No runtime API calls to resolve trait definitions.

### 5.9 Honest Limitations (Priority: Medium)

AgentBoot documents what works, what does not, and what the actual limitations are on
each platform. Compliance hooks exist on Claude Code but not on Copilot or Cursor.
Managed settings are CC-only. Subagent isolation requires `context: fork`, which is
CC-only. These gaps are documented per platform rather than hidden.

**Implication:** Per-platform feature matrices are part of the documentation.
Non-CC delivery is labeled "best-effort." No feature is marketed as cross-platform
unless it actually works cross-platform.

### 5.10 Hub-and-Spoke Distribution (Priority: Medium)

One central repository (the hub) contains the source of truth for all persona
definitions. Target repositories (spokes) receive compiled artifacts via the sync
pipeline. Spokes are passive — they receive governance, they do not produce it.
Teams customize through the hub's scope hierarchy, not by committing persona files
directly to their repos.

**Implication:** The sync pipeline is one-way (hub to spoke). Local modifications
to synced files are detected and warned about. The hub repository is the authoritative
source for governance decisions.

---

## 6. Feature Requirements

### 6.1 Build System

#### 6.1.1 Validation (`agentboot validate`)

Pre-build validation that catches configuration errors before compilation. Runs five
checks: persona existence (every persona referenced in config has a directory),
trait reference resolution (every trait referenced by a persona exists), SKILL.md
frontmatter validity (required fields present, values in allowed ranges), PERSONAS.md
synchronization (generated registry matches actual persona definitions), and secret
scanning (no credentials, API keys, or internal URLs in persona content).

**Who it serves:** Platform teams and CI pipelines. Validation runs automatically as
the first stage of the build pipeline and as a standalone CI gate on every PR to the
personas repository.

**Why it matters:** Without validation, invalid configurations silently produce broken
output. A missing trait reference could result in an empty persona. A credential
accidentally included in a trait file could be synced to every repo in the
organization. Validation catches these errors before they propagate.

#### 6.1.2 Compilation (`agentboot build`)

The core build step. Loads `agentboot.config.json`, resolves trait references from
each persona's `persona.config.json`, and produces two distinct compilation targets:
cross-platform output and Claude Code-native output.

**Cross-platform output** produces standalone SKILL.md files (agentskills.io format
with traits inlined), copilot-instructions.md, and generic CLAUDE.md. This output
works on any platform that reads Markdown instruction files.

**Claude Code-native output** produces the full `.claude/` directory structure:
agents with rich frontmatter (model, permissionMode, maxTurns, disallowedTools,
mcpServers, hooks, memory, isolation), skills with `context: fork`, rules with
`paths:` frontmatter, separate trait files for `@import` composition, a CLAUDE.md
using `@imports`, settings.json with hook entries, and `.mcp.json` with server
configurations.

**Who it serves:** Platform teams running the build pipeline. CI systems that produce
artifacts on merge.

**Why it matters:** The two-target compilation is what makes AgentBoot both
cross-platform and CC-optimized. Organizations choose which format to deploy per repo.
Claude Code users get the full governance surface (hooks, managed settings, isolation).
Non-CC users get the content (personas, instructions, rules) without the enforcement
mechanisms.

#### 6.1.3 Sync (`agentboot sync`)

Distributes compiled output to target repositories. Reads `repos.json`, which lists
each target repo with its platform and team assignment. Merges scopes according to the
four-level hierarchy (org, group, team, repo), with team-level configuration layering
on top of group and org configuration. Writes the appropriate output format based on
each repo's declared platform.

Sync supports multiple modes: local filesystem writes, GitHub API (creates PRs via
the API), and GitLab API (creates merge requests). A dry-run mode shows what would
change without writing anything. Each sync writes an `.agentboot-manifest.json`
tracking every managed file and its content hash, enabling clean uninstall and
drift detection.

**Who it serves:** Platform teams and CI pipelines. In steady state, sync runs
automatically on merge to the personas repo's main branch.

**Why it matters:** Sync is the mechanism that turns the hub-and-spoke model from
theory into practice. Without it, every repo update is manual. With it, a single
PR to the personas repo propagates governance to every registered repo
automatically — with human review at the PR merge point as the governance checkpoint.

#### 6.1.4 Scope Merging

The scope merge algorithm implements the four-level hierarchy. For each target repo,
the sync step composes: org-level configuration (always active), group-level
configuration (based on the repo's group assignment), team-level configuration (based
on the repo's team assignment), and repo-level overrides.

Optional behaviors follow "most specific wins" — a team can override a group default.
Mandatory behaviors follow "most general wins" — an org can mark traits or personas
as required, and no lower scope can disable them. A team-level configuration that
attempts to disable a mandatory org-level guardrail causes a build failure.

**Who it serves:** Organizations with multiple groups and teams that need both
centralized governance and team-level customization.

**Why it matters:** Without scope merging, organizations face a false choice between
centralized control (which frustrates teams) and team autonomy (which breaks
governance). The scope hierarchy provides both: mandatory rules propagate down,
optional customization layers up.

### 6.2 CLI

#### 6.2.1 Interactive Setup Wizard (`agentboot setup`)

The primary entry point for all users. An interactive wizard that asks a series of
questions to determine the user's role (developer, platform team, IT/security,
exploring), their AI tools (Claude Code, Copilot, Cursor, mixed), their organization
context (existing AgentBoot setup, no setup, solo), team size, compliance requirements,
and device management infrastructure.

Based on the answers, the wizard executes the appropriate setup: Quick Start (solo
developer — deploys files directly to the current repo), Standard Setup (platform
team — scaffolds the org personas repo with config, personas, and traits), or
Enterprise Setup (IT — generates managed settings for MDM deployment plus marketplace
template).

The wizard auto-detects as much as possible before asking: git remote for org name,
`.claude/` in the current repo for existing setup, managed settings on disk for
existing governance, installed Claude Code version, and platform tools in PATH.

**Who it serves:** Every first-time user, regardless of role.

**Why it matters:** The setup wizard is the difference between "read the docs for
30 minutes then configure" and "answer 3-7 questions and you are running." Progressive
disclosure ensures that solo developers are not overwhelmed with enterprise options,
while platform teams get the full scaffolding they need.

#### 6.2.2 Discovery (`agentboot discover`)

Scans repositories, machines, and configurations for existing AI agent content —
CLAUDE.md files, Copilot instructions, Cursor rules, MCP servers, hooks, skills,
agents, and anything else that represents agentic maturity the organization already
has. Supports scanning a single repo, a directory of repos, all repos in a GitHub
organization (via API), local machine configuration, and managed settings paths.

Discovery produces five actions: a detailed inventory report (Markdown), a classify-
and-ingest pipeline (decompose existing content into traits, personas, gotchas, and
instructions), an overlap analysis (find near-duplicate content across repos), a
migration plan (what becomes what, with estimated reduction), and a config export
(generate `agentboot.config.json` from the discovered repo structure).

Discovery and migration are non-destructive. They never modify, move, or delete
existing files. They create new files in the AgentBoot personas repo. The originals
stay untouched. The organization reviews, tests, and deploys at their pace via PR.

**Who it serves:** Platform teams evaluating AgentBoot for an organization that already
has scattered agentic content.

**Why it matters:** Most organizations adopting AgentBoot are not starting from zero.
They have 20+ repos with independent CLAUDE.md files, custom agents, and instruction
files. Without discovery, consolidation is a manual audit. With it, AgentBoot finds
everything, identifies duplication, and produces a migration plan that typically
achieves 80-85% line reduction through deduplication and centralization.

#### 6.2.3 Build and Distribution Commands

`agentboot build` compiles personas with options for specific output formats
(claude-code, copilot, cross-platform, plugin, all) and a validate-only dry run.
`agentboot sync` distributes to repos with support for local filesystem, GitHub API,
and GitLab API modes, plus single-repo targeting and dry-run. `agentboot export`
generates distributable artifacts (plugin directory, marketplace scaffold, managed
settings for MDM, reusable GitHub Actions workflow, MCP server package).
`agentboot publish` pushes the plugin to a configured marketplace with version bumping.

**Who it serves:** Platform teams managing the build and distribution pipeline.

**Why it matters:** These commands form the core build pipeline. They are designed to
work in both interactive (developer workstation) and non-interactive (CI/CD) modes,
with every command supporting `--non-interactive` flags.

#### 6.2.4 Scaffolding (`agentboot add`)

Scaffolds new components: personas, traits, domains, gotchas, hooks, and repo
registrations. Each scaffold creates the appropriate directory structure with template
files that follow the format standards.

The `add prompt` subcommand ingests raw prompt text from multiple sources (inline text,
file, clipboard, URL, batch decomposition of an existing CLAUDE.md). It classifies the
content (trait, gotcha, persona rule, or always-on instruction), formats it to the
appropriate standard, and saves it to the correct location. A dry-run mode previews
without writing.

**Who it serves:** Platform teams creating new content and anyone contributing to the
personas repository.

**Why it matters:** Scaffolding reduces the barrier to adding new governance content.
The `add prompt` command is particularly valuable during migration: it takes the
scattered, unstructured content found by `discover` and transforms it into properly
formatted AgentBoot content.

#### 6.2.5 Diagnostics (`agentboot doctor`, `agentboot status`)

`agentboot doctor` checks environment health: Claude Code version, Node.js version,
git version, configuration validity, persona completeness, sync status, plugin state,
and managed settings status. Every problem includes a fix command.

`agentboot doctor --diagnose` runs a layered isolation test to pinpoint whether a
problem is in AgentBoot core, org config, org traits, org personas, or org extensions.
Each layer adds one piece of the stack; the layer where it breaks is the layer that
has the bug.

`agentboot status` provides a deployment dashboard: enabled personas and traits, repo
registration status with platform and sync version, plugin state, and managed settings
status.

**Who it serves:** Anyone troubleshooting issues. Platform teams monitoring deployment.

**Why it matters:** "Is this my bug or AgentBoot's bug?" is a question every
organization will ask. The diagnostic tools answer it systematically rather than
requiring manual investigation.

#### 6.2.6 Linting (`agentboot lint`)

Static analysis of persona definitions. Checks for vague language ("be thorough",
"try to"), token budget violations, credentials in prompt text, conflicting
instructions across traits, unused traits, and security issues. Configurable severity
thresholds (error, warning, info).

Token budget analysis calculates per-persona context cost and flags personas that
exceed configurable limits. This prevents context bloat — the gradual growth of prompt
content that wastes tokens without adding value.

**Who it serves:** Platform teams authoring personas, and CI pipelines gating merges.

**Why it matters:** Prompt quality is the product. A governance framework that produces
vague, bloated, or conflicting prompts is actively wasting money and developer trust.
Linting enforces a minimum quality bar automatically.

#### 6.2.7 Testing (`agentboot test`)

Multi-type test runner supporting deterministic tests (free, every commit),
behavioral tests (LLM invocation, ~$0.50/test), snapshot regression tests (compare
output across versions), and LLM-as-judge evaluation (Opus evaluates quality on
multiple dimensions). Supports cost caps, per-persona targeting, CI mode with exit
codes and JSON output, and flake tolerance (2-of-3 pass).

Full details in section 6.7 (Testing).

**Who it serves:** Platform teams validating persona behavior before deployment.

**Why it matters:** AI persona output is non-deterministic. Traditional testing
approaches (exact output matching) do not work. The multi-layer test pyramid provides
confidence at each level: schema tests are free and fast, behavioral tests verify
that personas catch known bugs, snapshot tests detect regressions, and LLM-as-judge
evaluates qualitative dimensions that pattern matching cannot assess.

#### 6.2.8 Additional Commands

`agentboot connect` provides developer self-service for connecting to an organization's
marketplace (CLI equivalent of `/agentboot:connect`). `agentboot upgrade` pulls the
latest AgentBoot core into an organization's personas repo. `agentboot validate` is the
CI-friendly validation-only command with strict mode. `agentboot search` queries the
marketplace for traits, gotchas, personas, and domains. `agentboot metrics` reads
telemetry and reports per-persona, per-team, and per-period statistics.
`agentboot cost-estimate` projects per-persona monthly cost across the organization.
`agentboot review` generates guided human review sessions with curated samples.
`agentboot issue` streamlines bug reporting with auto-attached diagnostics and
privacy-safe redaction. `agentboot uninstall` provides clean removal with manifest
tracking, original file restoration, and mixed content handling.

**Who it serves:** Various segments depending on the command.

**Why it matters:** Each command addresses a specific workflow gap. Together, they form
a complete CLI that covers the full lifecycle from setup through daily use to removal.

### 6.3 Persona System

#### 6.3.1 Traits

Reusable behavioral building blocks. Each trait captures a single aspect of how an
agent should think or communicate — a cognitive stance, an output discipline, or an
epistemic commitment. Traits support weight configurations (HIGH / MEDIUM / LOW,
mapping to a 0.0-1.0 numeric scale) and are composed at build time.

Core traits include: critical-thinking (skepticism calibration), structured-output
(consistent output formatting), source-citation (evidence requirements), confidence-
signaling (uncertainty communication), audit-trail (compliance logging), and
schema-awareness (data structure understanding). Additional traits include
creative-suggestion (proactive improvement ideas) and cost-awareness (resource
efficiency).

The trait weight system is a calibration system, not a priority system. At HIGH, the
threshold for surfacing a concern is very low. At LOW, the threshold is high. The
weight does not override the severity floor — at any weight, CRITICAL findings always
surface. The numeric scale (0.0-1.0) provides finer calibration for advanced use cases
while the named weights (HIGH/MEDIUM/LOW) serve as the simplified interface.

**Who it serves:** Platform teams authoring personas, and the marketplace community
sharing behavioral building blocks.

**Why it matters:** Before traits, every persona independently specified its approach
to things like skepticism, output structure, and evidence requirements. In practice,
this meant the same concepts were expressed slightly differently in every persona.
Traits solve this: write the behavior once, compose it everywhere, improve it in one
place.

#### 6.3.2 Personas

Complete, deployable agents composed from traits plus a specialized system prompt that
defines identity, operating context, and mandate. Use the agentskills.io SKILL.md
format (Markdown with YAML frontmatter). The frontmatter specifies ID, version, traits,
scope, and output format. The prose is the system prompt.

Core V1 personas: code-reviewer (code review against team standards), security-
reviewer (vulnerability analysis, OWASP, auth, data handling), test-generator
(unit and integration test generation from function signatures), and test-data-expert
(realistic synthetic test data generation).

Each persona has a `persona.config.json` that specifies build metadata: which traits
to compose, at what weight, the target model, permission mode, tool restrictions,
MCP servers, hooks, and autonomy level.

**Who it serves:** All developers (as consumers) and platform teams (as authors).

**Why it matters:** Personas are the user-facing product. Everything else in AgentBoot
— traits, the build system, the scope hierarchy, the distribution pipeline — exists to
make personas work well. A persona that catches SQL injection, explains the risk,
suggests the fix, and cites the relevant standard is the experience that makes
developers trust and adopt the system.

#### 6.3.3 Gotchas Rules

Path-scoped instructions that encode hard-won operational knowledge. Each gotchas file
is a Markdown file with `paths:` frontmatter that limits when the rule activates. When
a developer is working on files that match the glob pattern, the gotchas content is
automatically included in the agent's context. When working on unrelated files, the
gotchas are invisible — zero context cost.

Gotchas capture the kind of information that lives in one engineer's head until they
leave: "PostgreSQL partitions do NOT inherit `relrowsecurity`," "UUID primary keys
cause exponential INSERT slowdown," "Lambda cold starts are 10x worse with VPC
networking." Technology-specific, not org-specific — making them highly shareable.

**Who it serves:** All developers (as consumers), platform teams and individual
contributors (as authors), and the marketplace community (as shareable knowledge).

**Why it matters:** Gotchas rules capture knowledge at the exact moment it is needed.
A developer writing a database migration sees the PostgreSQL gotchas. A developer
writing a Lambda handler sees the serverless gotchas. No one has to remember to consult
a wiki page or ask the right person.

#### 6.3.4 Always-On Instructions

Universal guardrails distributed to every repo regardless of persona configuration.
These are the org-wide rules that apply to every AI interaction: security baselines,
output format standards, coding conventions. They load at session start and remain
active throughout.

**Who it serves:** The entire organization. IT/Security teams who need guarantees
that certain rules are always active.

**Why it matters:** Some rules should never be opt-in. A security baseline, a coding
standard, a compliance requirement — these must apply everywhere. Always-on
instructions are the mechanism for universal governance.

#### 6.3.5 Domain Layers

Complete packages of traits, personas, gotchas, and instructions for a specific
compliance regime or technology stack. A healthcare domain layer includes PHI-awareness
traits, HIPAA reviewer personas, patient data gotchas, and compliance-specific
always-on instructions. A fintech domain layer includes PCI-DSS compliance traits,
financial data reviewers, and transaction security gotchas.

Domain layers are the highest-effort contribution to the marketplace but also the
highest value. They package everything an organization needs to govern AI behavior
in a regulated domain.

**Who it serves:** Organizations in regulated industries (healthcare, finance,
government) that need domain-specific compliance guardrails.

**Why it matters:** Regulated industries cannot adopt AI tools without compliance
guardrails. Building these guardrails from scratch is expensive and error-prone.
Domain layers provide a tested, community-maintained foundation that organizations
can adopt and extend.

#### 6.3.6 Per-Persona Extensions

Teams can extend base personas without forking them. An extension file adds
domain-specific rules to a base persona. The base definition stays unmodified and
receives upstream improvements automatically. This prevents the anti-pattern of
copying a persona, modifying it, and maintaining a fork that diverges over time.

**Who it serves:** Teams that need team-specific customization of org-wide personas.

**Why it matters:** Without extensions, teams face a false choice: use the org persona
as-is (too generic) or fork it (diverges and rots). Extensions provide the middle path:
customize behavior while staying on the upstream upgrade path.

### 6.4 Delivery and Distribution

#### 6.4.1 Claude Code Plugin

The primary delivery method for Claude Code users. AgentBoot output is packaged as a
CC plugin — a directory containing agents, skills, hooks, rules, MCP configuration,
and settings — distributable through a private marketplace.

The organization creates a private marketplace (a Git repository with a
marketplace.json catalog). Engineers install with a single command:
`/plugin marketplace add org/personas` and `/plugin install org-plugin`. IT can
force-enable the plugin via managed settings, requiring zero developer action.

Plugin packaging is produced by `agentboot export --format plugin`. The plugin name
becomes the namespace prefix for all skills (e.g., `/acme:review-code`).

**Who it serves:** All Claude Code users in the organization.

**Why it matters:** The plugin is the native CC distribution mechanism. It supports
namespace isolation (preventing conflicts), version pinning, force-enable via managed
settings, and live reload without restart. It is the path of least resistance for CC
organizations.

#### 6.4.2 Marketplace

Three-layer marketplace ecosystem: Core (maintained by AgentBoot, Apache 2.0),
Verified (community-contributed, reviewed by maintainers, meets quality standards),
and Community (unreviewed, valid format only, buyer-beware).

Full details in section 6.9 (Marketplace).

**Who it serves:** All users who need pre-built governance content.

**Why it matters:** The marketplace is the mechanism that turns AgentBoot from a
framework into an ecosystem. A framework solves the governance problem for one
organization. An ecosystem solves it for the industry.

#### 6.4.3 Managed Settings

AgentBoot generates managed settings artifacts for deployment via MDM (Jamf, Intune,
JumpCloud, Kandji) or Anthropic's server-managed settings. Managed settings are
deployed to OS-level paths and cannot be overridden by any user or project
configuration.

Managed settings carry HARD guardrails only: compliance hooks, credential blocking,
audit logging, and forced plugin installation. They are not used for persona delivery
(that is what the plugin and sync are for). This separation keeps compliance and
convenience in distinct channels.

`agentboot export --format managed` produces the artifacts. IT deploys them through
their existing MDM infrastructure.

**Who it serves:** IT/Security teams responsible for compliance enforcement.

**Why it matters:** HARD guardrails must be non-overridable. A PHI scanning hook in a
healthcare organization cannot be disabled by a developer who finds it inconvenient.
Managed settings are the only mechanism that provides OS-level enforcement.

#### 6.4.4 MCP Server

AgentBoot exposed as an MCP (Model Context Protocol) server that any MCP-compatible
agent can consume. Provides persona invocation, trait lookup, governance status, and
knowledge base access as MCP tools and resources.

The MCP server is the cross-platform bridge. It works in Claude Code, Copilot, Cursor,
Gemini CLI, and any other MCP client. Organizations with mixed toolchains use the MCP
server to ensure everyone gets governed personas regardless of which tool they use.

**Who it serves:** Multi-agent organizations with engineers using different AI tools.

**Why it matters:** Without MCP, each platform needs its own delivery mechanism (plugin
for CC, instruction files for Copilot, rules for Cursor). MCP provides a single
channel that serves all platforms identically with the same persona definitions and
invocation interface.

#### 6.4.5 Direct Sync

The fallback/bootstrap delivery method. AgentBoot's sync script writes compiled files
directly to target repos' `.claude/`, `.github/`, and `.cursor/` directories. When a
developer clones the repo, the personas are already there with zero setup.

This is the simplest mental model (files in a directory), works offline, and requires
no plugin system dependency. It scales well to dozens of repos but creates sync PR
noise at hundreds.

**Who it serves:** All developers in repos registered for sync, and organizations that
cannot use the plugin system.

**Why it matters:** The "repo already has it" model provides the lowest-friction
developer experience. The developer never installs anything — governance is in the
repo they are already working in.

#### 6.4.6 Non-Claude Code Delivery

For Copilot: generates `copilot-instructions.md`, path-scoped `.instructions.md`
files, `.prompt.md` slash command files, and agentskills.io SKILL.md files. For
Cursor: generates `.cursor/rules/` files, `.cursorrules`, and SKILL.md files. For
Gemini CLI: generates `GEMINI.md` and SKILL.md files.

The `repos.json` platform field determines which format each repo receives. The MCP
server is the equalizer for multi-platform organizations.

**Who it serves:** Organizations using tools other than Claude Code.

**Why it matters:** Honest cross-platform support is a competitive differentiator.
AgentBoot does not pretend all platforms are equal — it documents the governance gaps
per platform — but it does provide the best possible experience on each one.

### 6.5 Privacy and Telemetry

#### 6.5.1 Three-Tier Privacy Model

**Tier 1 (Private):** Raw prompts, conversation history, session transcripts, files
read during exploration. These stay on the developer's machine. AgentBoot does not
read, transmit, or reference them. Retention is session duration or developer's
choice.

**Tier 2 (Privileged):** Aggregated patterns extracted by LLM analysis via the
`/insights` skill. The analysis uses the same Claude API trust boundary the developer
already uses for every prompt. The developer sees insights first and approves what gets
shared. Patterns, not transcripts, are the output.

**Tier 3 (Organizational):** Persona output metrics — invocation counts, cost,
findings severity distribution, model usage, and duration. Anonymized by default (no
developer ID). Team-level attribution via the scope field enables budget tracking
without identifying individuals.

**Who it serves:** All users. Developers get privacy. The organization gets metrics.

**Why it matters:** The privacy model is a product differentiator. In a market where
enterprises are deploying AI monitoring tools, AgentBoot takes the opposite stance:
it helps organizations improve their AI governance without being the tool that surveys
their developers. The best prompt optimization system is one that developers feed
willingly because they trust it.

#### 6.5.2 `/insights` Skill

A skill that sends session transcripts to the Claude API (Haiku for speed/cost) for
pattern extraction. Presents personal prompt insights to the developer: session counts,
most-used personas, common topics, rephrase rates, cost, and improvement suggestions.
The developer optionally approves sharing anonymized patterns to the org aggregate.

The analysis prompt is explicitly designed to extract patterns, not judge. It frames
everything as persona improvement opportunities, not developer deficiencies. It does
not quote developer prompts, judge question quality, identify knowledge deficiencies,
or produce output that could embarrass the developer if shared.

**Who it serves:** Developers (personal analytics) and the organization (aggregate
patterns for persona optimization).

**Why it matters:** Without insights, prompt optimization is guesswork. With insights,
the organization knows "auth patterns are asked about 89 times across 23 developers"
and can act on it (create an auth-patterns skill). The mechanism respects privacy while
enabling organizational learning.

#### 6.5.3 Org Dashboard

Aggregate metrics visible to engineering leaders and platform teams: active seats,
persona invocations, cost per team, model mix, persona effectiveness (rephrase rates,
false positive rates), common knowledge gaps, and cost efficiency analysis.

The dashboard shows investment metrics (cost, adoption, ROI) and outcome metrics (PR
quality, bug rates, coverage). It never shows process metrics (what developers typed,
how many times they rephrased, what they asked about).

Optional per-developer usage tracking with three formats: `false` (no developer
identity, the default), `hashed` (consistent anonymous ID), and `email` (full
attribution). Full attribution requires clear communication to the team and is
intended for cost allocation and license optimization, not surveillance.

**Who it serves:** Engineering leaders, platform teams, and org owners.

**Why it matters:** Leaders need evidence that the AI investment is delivering value.
The dashboard provides it without violating developer privacy.

#### 6.5.4 Escalation Exception

One exception to prompt privacy: genuinely harmful content (attempted exfiltration,
guardrail circumvention, harassment, malware generation). The system flags the
category locally first (the developer sees the flag), then reports the flag (category
and date, not the transcript) to a designated compliance contact. The compliance team
can request the transcript through a formal process (like a legal hold), not through
the analytics pipeline.

Implemented via a `UserPromptSubmit` hook using Haiku for fast evaluation. The prompt
is explicitly scoped to harmful categories only — not quality, intelligence, or
competence.

**Who it serves:** IT/Security and compliance teams.

**Why it matters:** Complete privacy absolutism is irresponsible in an enterprise
context. The escalation exception provides a narrow, transparent mechanism for
genuinely harmful content while maintaining the broader privacy commitment.

#### 6.5.5 Telemetry Configuration

Privacy configuration in `agentboot.config.json` includes telemetry settings (enabled,
includeDevId, devIdFormat, includeCost, includeScope, destination), insights settings
(enabled, autoShareAnonymized, escalation categories and contact), and rawPrompts
settings (collect: false, transmit: false, surfaceToOrg: false — fields that cannot be
set to true, existing to make design intent explicit).

**Who it serves:** Platform teams configuring privacy settings for their organization.

**Why it matters:** Privacy is not a binary. Different organizations have different
requirements. The configuration provides a spectrum from fully anonymous to fully
attributed, with clear documentation of the implications of each setting.

### 6.6 Knowledge Layer

#### 6.6.1 Stage 1: Flat Files (Default)

The current and default knowledge system. Markdown files loaded into context:
always-on instructions at session start, path-scoped rules when matching files are
read, trait content composed at build time, and skills loaded on invocation.

Works for 5-50 knowledge items. Zero infrastructure. Version-controlled in git.
Human-readable and editable. Most organizations stay at this stage permanently.

**Who it serves:** All organizations.

**Why it matters:** Flat files are the right default. They require no infrastructure,
no databases, no embedding APIs. They work immediately and scale to the needs of most
teams.

#### 6.6.2 Stage 2: Structured Knowledge Store

A queryable layer on top of flat files. Files gain optional frontmatter for structured
fields (type, technology, tags, severity, domain, learned_from). The build system
generates a SQLite index from this frontmatter. An MCP server exposes tag/category
queries: search by technology and severity, get by ID, find related items, and list
by type and tag.

Handles 50-500 knowledge items. Zero new infrastructure (SQLite is a single file
shipped with the MCP server). The flat files remain the source of truth — the index
is derived, not authoritative.

**Who it serves:** Mature organizations with extensive accumulated knowledge (gotchas,
ADRs, incident learnings, standards, patterns).

**Why it matters:** When an organization has 200 gotchas and 50 ADRs, loading
everything into context is wasteful. Structured queries allow personas to retrieve
only the relevant knowledge for the current task.

#### 6.6.3 Stage 3: Vector / RAG

Semantic retrieval via embeddings. Instead of querying by tags and categories, the
persona describes what it is looking at and the knowledge base returns the most
semantically relevant items. Built on sqlite-vss (vector search extension for SQLite),
keeping zero new infrastructure.

The key use case is context-aware review: "this code is doing token refresh validation"
retrieves the incident report about token expiry race conditions, even though the code
does not mention "race condition." The connection is semantic, not keyword-based.

Handles 500+ knowledge items. Requires embedding API calls (incremental, only changed
items). Cost is minimal (~$0.20 for 1,000 items).

**Who it serves:** Compliance-heavy industries where accumulated knowledge (incidents,
ADRs, patterns) is as valuable as the code itself.

**Why it matters:** The progression from rules to knowledge to organizational memory
is the long-term value of the knowledge layer. A security reviewer that cites last
year's incident report is qualitatively different from one that only checks rules.

#### 6.6.4 Stable MCP Interface

The MCP interface stays identical across all three stages. Personas do not know or care
whether the backing store is flat files, SQLite, or pgvector. They call the same MCP
tools. An organization can upgrade from Stage 2 to Stage 3 without rewriting any
persona definitions.

**Who it serves:** Platform teams managing knowledge infrastructure.

**Why it matters:** The abstraction boundary between personas and the knowledge store
means organizations can evolve their knowledge infrastructure without touching their
persona definitions. This is why MCP-first matters — the interface is the contract.

### 6.7 Testing

#### 6.7.1 Unit and Schema Tests (Layer 1)

Config validation against JSON schema, frontmatter parsing for all persona SKILL.md
files, trait composition (injection markers, weight resolution, missing references,
circular dependencies), lint rules (vague language, token budget, credentials,
conflicts), and sync logic (scope merging, output format selection, manifest generation,
PERSONAS.md registry).

Free. Runs on every commit. Must pass to merge. Uses vitest.

**Who it serves:** AgentBoot core maintainers and platform teams with custom content.

**Why it matters:** The foundation of the test pyramid. Catches configuration errors,
format violations, and composition bugs before they reach compilation.

#### 6.7.2 Integration Tests (Layer 2)

Full build pipeline (validate, compile, sync produces expected output), CC-native
output validation (agent frontmatter, @imports, paths: frontmatter, settings.json
hooks, .mcp.json), cross-platform output validation (standalone SKILL.md, copilot-
instructions.md), plugin export validation (structure, claude plugin validate),
discover and ingest (finds files, identifies duplicates, generates migration plan,
non-destructive guarantee), and uninstall (removes managed files only, preserves
local files, handles mixed content, restores archive).

Free. Runs on every commit and PR. Uses vitest with temp directories and test repo
fixtures.

**Who it serves:** AgentBoot core maintainers.

**Why it matters:** Integration tests verify that the full pipeline works end-to-end.
A unit test might pass on trait composition, but the integration test catches when the
compiled output misses a hook entry in settings.json.

#### 6.7.3 Behavioral Tests (Layer 3)

LLM invocation with known inputs, asserting on output patterns. Test cases defined in
YAML format specifying persona, model (Haiku for cost), setup files, prompts, and
assertions (findings_min/max, severity_includes/excludes, text_matches/excludes,
confidence_min, output_contains, output_structure, json_schema, token_max,
duration_max_ms).

Uses `claude -p` with structured JSON output, bypass permissions, and no session
persistence. Flake tolerance (2-of-3 runs) handles non-determinism. Cost: ~$5/PR
for 4 personas.

**Who it serves:** Platform teams validating persona behavior before deployment.

**Why it matters:** The core novel challenge in testing AI personas. Traditional
tests cannot verify that a persona catches a SQL injection vulnerability. Behavioral
tests use the cheapest model (Haiku) to verify that the prompt structure elicits the
right behavior — if it works on Haiku, it will work better on Sonnet/Opus.

#### 6.7.4 Snapshot / Regression Tests (Layer 4)

Compare persona output across versions to detect regressions. Snapshots store
structured summaries (finding counts, patterns, tokens, duration), not full prose.
Run after persona prompt changes, trait updates, model changes, and weekly for provider
drift detection.

Flags differences for human review: MATCH (identical), CHANGED (new findings — is the
change correct?), and REGRESSION (previously caught findings now missed — investigate).

Cost: ~$5 per persona change.

**Who it serves:** Platform teams managing persona quality over time.

**Why it matters:** Without regression testing, a persona improvement might silently
break an existing capability. Snapshot tests make these regressions visible before
deployment.

#### 6.7.5 LLM-as-Judge (Layer 5)

A separate LLM call (Opus as judge) evaluates persona output on qualitative dimensions:
completeness, accuracy, specificity, prioritization, and tone. Test cases include
ground truth (known issues in the code) so the judge can evaluate whether the persona
found what it should have found.

Run on major persona rewrites, new personas, model migrations, and quarterly quality
audits. Cost: ~$20 per run.

**Who it serves:** Platform teams making major persona changes.

**Why it matters:** Pattern matching cannot evaluate whether a review is "thorough" or
whether the tone is "professional." LLM-as-judge applies consistent qualitative
evaluation at scale, filling the gap between structural assertions and human review.

#### 6.7.6 Human Review (Layer 6)

Guided human review sessions via `agentboot review`. Presents randomly sampled persona
outputs from the last 7 days with structured questions (accuracy, severity, additions,
removals). Takes 10-15 minutes per persona.

Triggers: new persona ships (3-5 real PRs), major trait change (before/after), quarterly
audit (random sample of 20 outputs), quality escalation (specific disputed finding).

**Who it serves:** Platform teams and domain experts.

**Why it matters:** Humans make judgment calls that no automated test can make. The
review tool makes this sustainable (structured, guided, 1 hour/month for 4 personas)
rather than ad hoc.

#### 6.7.7 Mutation Testing

Deliberately introduces known bugs into persona prompts and verifies that tests catch
the regressions. Validates that the test suite actually detects the problems it claims
to detect.

**Who it serves:** Platform teams validating test suite quality.

**Why it matters:** "Who tests the tests?" Mutation testing answers this question by
proving that behavioral tests catch regressions when they should.

### 6.8 Developer Onboarding

#### 6.8.1 First-Session Welcome

A brief orientation (~80 tokens) generated as part of the CLAUDE.md that AgentBoot
syncs. Lists available personas with invocation commands, provides 3-4 tips for
effective use, mentions the privacy commitment, and directs new users to `/learn`.
Loads once per session and fades into background context after a few sessions.

**Who it serves:** Developers opening Claude Code in an AgentBoot-governed repo for
the first time.

**Why it matters:** The first interaction determines whether a developer engages or
abandons. A wall of text loses them. A brief, actionable orientation converts them.

#### 6.8.2 `/learn` Skill

A context-aware training assistant, not a static tutorial. Provides a topic browser
(Getting Started, Going Deeper, Quick Reference), answers specific questions
("how do I review one file?"), and delivers contextual explanations (severity levels,
persona concepts, prompting tips).

The skill uses `disable-model-invocation: true` for static content and normal model
invocation for free-form questions.

**Who it serves:** Developers at any skill level who want to understand the persona
system better.

**Why it matters:** The `/learn` skill provides help at the moment of need. Instead of
sending developers to documentation, it answers their question in context.

#### 6.8.3 Curated External Resources

AgentBoot does not build training content. It curates links to the best existing
resources organized by skill level (Beginner, Intermediate, Advanced, Cost Management).
Sources include Anthropic documentation, community guides, and AgentBoot's own
reference documentation.

The resource list lives in a skill (updatable without rebuilding) and is checked
periodically for link freshness.

**Who it serves:** Developers who want to go deeper than `/learn` covers.

**Why it matters:** AgentBoot should not duplicate existing high-quality training
content. Curation is the right approach — point people to the best resources rather
than building inferior alternatives.

#### 6.8.4 Onboarding Checklist

A generated checklist (`agentboot onboarding-checklist`) built from the organization's
actual AgentBoot configuration. Includes: Claude Code installation verification,
plugin installation check, first code review, first test generation, persona
exploration, personal preference setup, and first `/insights` run.

Exportable as Markdown or email format for sharing with new team members.

**Who it serves:** Platform teams onboarding new developers.

**Why it matters:** A generic onboarding guide is less effective than one built from
the organization's actual configuration. The generated checklist uses real persona
names, real skill invocations, and real marketplace information.

#### 6.8.5 Contextual Tips

Optional tips that appear in persona output when patterns suggest the developer is new:
first invocation of a persona, vague prompts, repeated rephrasing. Rate-limited (max
1 per session), disable-able by the developer, and generated by the persona itself
(part of the persona prompt, not a separate system).

**Who it serves:** New developers learning to use personas effectively.

**Why it matters:** Tips at the moment of need are more effective than documentation.
A developer who types "review this" and gets a tip about being more specific learns
faster than one who reads a guide about prompting.

#### 6.8.6 Org-Authored Tips

The organization's platform team can add custom onboarding content in an `onboarding/`
directory in the personas repo: welcome messages, tips specific to the org's stack and
conventions, and links to internal resources. This content is synced alongside persona
files.

**Who it serves:** Organizations with institutional knowledge to transfer.

**Why it matters:** Org-authored tips capture what a senior engineer would tell a new
hire sitting next to them: "the security reviewer is strict about SQL parameterization
because we had a production incident." This knowledge transfer is version-controlled,
available 24/7, and scales beyond one-on-one conversations.

### 6.9 Marketplace

#### 6.9.1 Core Layer (Layer 1)

Traits and personas maintained by the AgentBoot project. The reference implementations.
Apache 2.0 licensed. Tested in CI on every commit. Included when you run
`agentboot setup`.

Contents: core traits (critical-thinking, structured-output, source-citation,
confidence-signaling, audit-trail, schema-awareness), core personas (code-reviewer,
security-reviewer, test-generator, test-data-expert), and baseline instructions.

**Who it serves:** Every AgentBoot user.

**Why it matters:** The core layer is the foundation. It provides immediate value
without any community contribution and establishes the quality bar for the ecosystem.

#### 6.9.2 Verified Layer (Layer 2)

Community-contributed content reviewed by AgentBoot maintainers and meeting quality
standards. Listed in the official marketplace.

Quality requirements: reviewed by at least one maintainer, follows format standards,
has behavioral tests (at least deterministic), documentation (README, use case,
configuration), Apache 2.0 or MIT license, no org-specific content, and attribution
to contributor.

Review process: contributor opens PR, automated checks run (lint, test, format, license
scan), maintainer reviews for quality, generalizability, and overlap, accepted content
is merged with attribution.

**Who it serves:** Organizations looking for pre-built governance content for common
use cases.

**Why it matters:** The Verified layer is where the marketplace becomes valuable beyond
core. A healthcare organization can install a PHI-awareness trait that has been reviewed,
tested, and used by other healthcare organizations — rather than building it from scratch.

#### 6.9.3 Community Layer (Layer 3)

Anything published to a public marketplace. Not reviewed by AgentBoot maintainers.
Only requirement: valid frontmatter / `agentboot.domain.json` and declared license.

**Who it serves:** Anyone looking for specialized or experimental governance content.

**Why it matters:** Low barrier to entry enables experimentation and niche use cases.
Community content may be excellent or terrible — the explicit labeling ensures users
understand the trust level.

#### 6.9.4 Contribution Model

Contributions flow through `agentboot publish` (one-command sharing that strips
org-specific content, validates format, generates README, and opens a PR). Attribution
is permanent and visible in content frontmatter, contributor profiles, and build output.

Motivations served: professional reputation (usage stats, linkable profiles), reciprocity
(attribution on everything installed), content improvement (feedback from production
usage), and org visibility (contributing organizations listed publicly).

AgentBoot does not gamify contributions — no leaderboards, badges, streak counters,
or points. These attract gaming behavior, not quality.

**Who it serves:** Anyone with governance knowledge to share.

**Why it matters:** The biggest barrier to contribution is friction, not motivation.
A developer who has a great PostgreSQL gotchas file will share it if it takes 30
seconds. They will not if it takes 30 minutes. `agentboot publish` makes sharing
as close to zero-friction as possible.

#### 6.9.5 Plugin Packaging

Each logical marketplace grouping (core, healthcare domain, fintech domain,
infrastructure gotchas) becomes a CC plugin installable independently. Cross-listing
with complementary projects (such as SuperClaude) enables ecosystem convergence without
bundling dependencies.

**Who it serves:** Claude Code users who want to pick and choose governance content.

**Why it matters:** Plugin packaging turns marketplace content into one-command
installations. A developer can install `ab-healthcare` and immediately have PHI-aware
review personas.

#### 6.9.6 Trust and Quality

Quality mechanisms: version pinning (orgs pin to specific versions of marketplace
content), license scanning (incompatible licenses block the build), trait isolation
(a bad community trait cannot break a core persona), trust signals (badges, download
count, update freshness, test coverage, compatible versions).

**Who it serves:** Organizations evaluating marketplace content for production use.

**Why it matters:** Trust is the currency of a marketplace. Without quality signals,
organizations will not use community content in production. The three-layer structure
(Core, Verified, Community) with explicit trust levels addresses this.

---

## 7. Non-Goals

AgentBoot explicitly does not do the following. These boundaries are intentional
design decisions, not missing features.

### 7.1 AgentBoot Is Not a Learning Management System

AgentBoot provides contextual assists and curated resource links, not courses, modules,
progress tracking, or certificates. It does not track who completed what training. It
does not gate persona access behind training completion. The `/learn` skill is a
helpful assistant, not a course catalog.

The onboarding problem is real, but the solution is lightweight help at the moment of
need, not a formal training program. Organizations that need formal AI training should
use dedicated LMS platforms.

### 7.2 AgentBoot Is Not a Surveillance Tool

AgentBoot does not collect, transmit, or surface raw developer prompts. It does not
rank developers by AI skill or prompt quality. It does not gamify usage with
leaderboards, badges, or streaks. It does not correlate AI usage with performance
reviews. It does not make AI usage mandatory.

The privacy model is a design invariant, not a configuration option. An organization
that wants conversation monitoring has that capability through their API provider's
Compliance API and enterprise data governance tools. AgentBoot is not that channel.

### 7.3 AgentBoot Does Not Compete with Content Libraries

AgentBoot is the governance and distribution layer, not a content library competing
with projects like SuperClaude, ArcKit, spec-kit, or Trail of Bits configurations.
These projects produce content (traits, agents, skills). AgentBoot distributes,
governs, and orchestrates content.

The recommended relationship is marketplace curation (point to upstream, cross-list)
rather than bundling. AgentBoot works without any third-party content; third-party
content works without AgentBoot. They are complementary, not competitive.

### 7.4 AgentBoot Is Not a Runtime Framework

AgentBoot is a build tool. It produces artifacts and exits. It has zero runtime
footprint. The distributed output works without AgentBoot installed. There is no
"AgentBoot runtime" that must be running for personas to function.

The exception is the MCP server, which is a separate, optional package
(`@agentboot/mcp-server`) that runs as a process. Even this is opt-in and not required
for core functionality.

### 7.5 AgentBoot Does Not Promise Universal Platform Parity

AgentBoot is honest about platform capabilities. Claude Code gets the full governance
surface (hooks, managed settings, subagent isolation, agent memory, plugin system).
Non-CC platforms get the content (personas, instructions, rules) but not the
enforcement mechanisms.

AgentBoot documents these gaps per platform rather than pretending all agents are equal
or promising features it cannot deliver. The compliance story for non-CC platforms is:
instruction-based refusal plus CI-based review plus organizational policy.

### 7.6 AgentBoot Does Not Manage AI Models

AgentBoot specifies which model a persona should use (in persona.config.json and agent
frontmatter), but it does not manage model access, API keys, billing, or rate limiting.
Those are the responsibility of the AI platform (Anthropic Console, GitHub Settings,
Cursor settings).

### 7.7 AgentBoot Does Not Replace Code Review

AI code review is a complement to human code review, not a replacement. AgentBoot
personas produce findings that humans evaluate and act on. Even at the highest autonomy
level (Phase 3: Autonomous), the output is reviewed post-hoc by humans.

The test plan explicitly states: "Agents test agents, but humans always decide.
Automation removes burden, not judgment."

### 7.8 AgentBoot Does Not Do Dynamic Agent Orchestration

AgentBoot does not provide a runtime agent orchestration system with message passing,
state machines, or complex multi-agent workflows. The `/review` meta-skill is a
lightweight routing layer that reads a configuration file and dispatches to the
appropriate persona. The persona arbitrator (V2+) resolves conflicts between
concurrent reviewers. Neither constitutes a full orchestration framework.

---

## 8. Success Metrics

### 8.1 Adoption Metrics

| Metric | Measurement | Target |
|---|---|---|
| Organizations using AgentBoot | GitHub template uses, marketplace installs | Growth rate |
| Active developers per org | Persona invocation telemetry (anonymous) | 70%+ of licensed seats |
| Persona invocations per day (org-wide) | Telemetry aggregate | Trending upward |
| Time from setup to first persona invocation | Wizard completion to first `/review-code` | Under 10 minutes |
| Repos governed per org | `agentboot status` repo count | Growth rate |
| Skeptic conversion rate | Developers who start at zero usage and reach 1+ sessions/week | 30%+ within 90 days |

### 8.2 Contribution Metrics

| Metric | Measurement | Target |
|---|---|---|
| Marketplace items (Verified) | Marketplace repo count | Growth rate |
| Community contributors | Unique PR authors to marketplace | Growth rate |
| Contribution-to-install ratio | Items contributed vs. items installed | Healthy ratio (not vanity) |
| Domain layers available | Complete domain packages in marketplace | 3+ by V2 |
| Trait reuse rate | How many personas compose each trait (average) | 3+ personas per core trait |

### 8.3 Quality Metrics

| Metric | Measurement | Target |
|---|---|---|
| Persona false positive rate | Rephrase rates, finding dismissal rates | Under 20% |
| Bug escape rate delta | Production bugs that a persona should have caught (before/after) | Measurable reduction |
| Test coverage delta | Coverage change in repos with test-generator persona | Measurable increase |
| PR review turnaround | Time from PR open to first AI review | Under 5 minutes |
| Behavioral test pass rate | CI test results | 95%+ |
| Lint pass rate on first commit | How often persona changes pass lint without fixes | 80%+ |

### 8.4 Cost Metrics

| Metric | Measurement | Target |
|---|---|---|
| Avg cost per persona invocation | Telemetry (tokens * model rate) | Trending downward |
| Model mix efficiency | % of invocations on Haiku/Sonnet vs. Opus | 80%+ on Sonnet or cheaper |
| Automated test cost per month | CI billing | Under $200 for 4 personas |
| Token budget compliance | % of personas within token budget | 95%+ |
| Cost per finding | Total cost / total findings | Trending downward |

### 8.5 Governance Metrics

| Metric | Measurement | Target |
|---|---|---|
| Sync coverage | % of repos receiving governance updates | 100% of registered repos |
| Managed settings deployment | % of developer machines with HARD guardrails | 100% of managed machines |
| Compliance hook activation | % of sessions where compliance hooks are active | 100% on managed machines |
| ADR exception count | Approved exceptions via ADR governance | Low and stable |
| Escalation flag rate | Harmful content flags per period | Low (zero is ideal) |

### 8.6 Developer Experience Metrics

| Metric | Measurement | Target |
|---|---|---|
| Setup completion rate | % of users who complete `agentboot setup` | 90%+ |
| Uninstall rate | % of orgs that uninstall within 90 days | Under 10% |
| `/learn` invocations | How often developers seek help | Trending downward (learning) |
| Tip dismissal rate | How often contextual tips are disabled | Under 30% |
| NPS (Net Promoter Score) | Developer survey | Positive |

---

## 9. Open Questions

These are issues, ambiguities, conflicts, and undefined areas discovered during the
writing of this PRD. Each requires resolution before the relevant feature can be
finalized.

### 9.1 Build System and Architecture

**Q1: How does the build system handle circular trait dependencies?**
The concepts document mentions traits composing into personas but does not specify
behavior when Trait A references Trait B which references Trait A. The test plan
mentions a test for circular dependencies. Resolution: the validate step should
detect and reject circular references with a clear error message. But: can traits
reference other traits, or is this architecturally prevented? The current design
implies traits are flat and only composed by personas, not by each other. This
should be explicitly documented.

**Q2: What happens when a trait update breaks a persona behavioral test?**
If the platform team updates `critical-thinking` and it causes the `code-reviewer`
behavioral test to regress (snapshot test shows REGRESSION), what is the governance
process? Is the trait update blocked? Rolled back? Accepted with documentation?
The test plan identifies this scenario but does not prescribe the resolution workflow.

**Q3: How are persona.config.json files created and maintained?**
The CLAUDE.md notes that `persona.config.json` is missing from all 4 personas as a
known gap. The document says this "blocks trait composition." But the CLI design does
not include a dedicated command for creating persona.config.json — only
`agentboot add persona` for the full scaffold. Resolution: either `agentboot add
persona-config` should exist as a command, or `agentboot build --fix` should generate
missing configs (as `agentboot doctor` suggests). This needs to be decided.

**Q4: What is the repos.json format and lifecycle?**
repos.json is referenced throughout (sync reads it, status displays it, discover
exports it) but its schema is only partially defined. The delivery methods document
shows a `platform` field. The CLAUDE.md mentions it can start as `[]`. But: how are
repos added (manual edit? `agentboot add repo`? auto-discovery)? How are repos removed?
What happens when a repo is renamed or transferred? The full lifecycle is undocumented.

**Q5: How does AgentBoot handle JSONC (JSON with comments)?**
The CLAUDE.md states that `agentboot.config.json` uses "JSONC format." JSON does not
natively support comments. Does the build system use a JSONC parser? What parser
specifically? Is JSONC used only in the config file or also in persona.config.json
and repos.json? This should be consistent and documented.

### 9.2 Scope Hierarchy and Distribution

**Q6: How does scope merging handle conflicting trait weights?**
If org-level sets `critical-thinking: MEDIUM` and team-level sets
`critical-thinking: HIGH`, which wins? The concepts document says "more specific scopes
win on optional behaviors." But is a trait weight optional or mandatory? Can the org
mark a specific weight as mandatory (not just the trait itself)? The merging semantics
for weights need explicit specification.

**Q7: What constitutes a "mandatory" behavior?**
The scope hierarchy distinguishes mandatory (org wins) from optional (team wins)
behaviors. But: how is a behavior marked as mandatory? Is it `required: true` in the
config? Per trait? Per persona? Per instruction? The enforcement mechanism (build
failure on override) is described but the declaration mechanism is not fully specified.

**Q8: How does sync handle repo-level overrides?**
The scope hierarchy includes a "repo level" for path-scoped instructions. But the
distribution model says spokes are passive and do not produce governance. Can a repo
have its own `.claude/rules/` files that coexist with synced files? How are conflicts
resolved between synced rules and locally-authored rules? Does the manifest track
which rules are synced vs. local?

**Q9: How does sync handle branch strategies?**
When sync creates PRs via GitHub API, what branch does it target? main? A designated
branch? What if the target repo uses trunk-based development vs. gitflow? What if the
sync PR conflicts with an in-flight PR? The sync mechanism is described but the
branching strategy is not.

### 9.3 Privacy and Telemetry

**Q10: How is the escalation exception enforced against abuse?**
The escalation mechanism uses a `UserPromptSubmit` hook with Haiku to classify prompts
into harmful categories. But: who decides what qualifies as "genuinely harmful"? The
categories are listed (exfiltration, circumvention, harassment, malware), but the
boundary is fuzzy. A developer debugging a security vulnerability might trigger the
"malware" category. How are false positive escalations handled? What is the appeal
process? The mechanism is defined but the governance around it is not.

**Q11: What is the data retention policy for telemetry?**
Telemetry events (persona invocations, cost, findings) are described but retention
is not. How long is telemetry stored? Who has access? Can individual events be deleted?
Is there a GDPR data subject access request (DSAR) process? The document says
retention follows the "org's data retention policy" but AgentBoot should provide
guidance or defaults.

**Q12: How does the /insights skill handle session transcripts that include sensitive data?**
The /insights skill sends session transcripts to the Claude API for pattern extraction.
But session transcripts may contain code snippets, internal URLs, database schemas, or
other sensitive content that the developer typed or that the agent read. The insights
analysis is within the same API trust boundary, but the output patterns are
potentially sharable with the org. How are patterns that inadvertently reveal sensitive
information filtered?

### 9.4 Delivery and Distribution

**Q13: Plugin namespace collision: what if two plugins use the same name?**
The org connection document recommends short plugin names ("acme"). What prevents
collision if two organizations both name their plugin "acme"? In private marketplaces
this is not an issue, but in the public marketplace it could be. Is there a namespace
registry? First-come-first-served? Org-scoped namespaces?

**Q14: How does the MCP server handle authentication and authorization?**
The MCP server is described as exposing persona invocation, trait lookup, and knowledge
base access. But: who can invoke personas via MCP? Can any process on the machine call
the MCP server? Is there authentication? Authorization per persona? Rate limiting?
The MCP server section describes the tools and resources but not the security model.

**Q15: What happens when a managed settings update conflicts with a plugin update?**
Managed settings can force-enable a plugin. The plugin can be updated via the
marketplace. If the managed settings pin a plugin version and the marketplace has a
newer version, which wins? The two-channel distribution model describes separation
of concerns but not conflict resolution.

**Q16: How does AgentBoot handle organizations with multiple Git hosting platforms?**
repos.json supports GitHub API and GitLab API for sync. But what about organizations
using both? Or organizations using Bitbucket, self-hosted GitLab, or Azure DevOps?
The sync mechanism needs to support multiple hosting platforms simultaneously.

### 9.5 Knowledge Layer

**Q17: How does the knowledge MCP server handle concurrent access?**
If multiple developers on the same machine (or multiple persona invocations in the
same session) query the SQLite knowledge database simultaneously, are there locking
issues? SQLite has known limitations with concurrent writes. If the MCP server is
read-only during use (writes only happen during build), this is fine — but this
constraint should be documented.

**Q18: How are knowledge embeddings versioned?**
When knowledge content changes and embeddings are regenerated, how does the system
handle the transition? Are old embeddings invalidated? Is there a migration path?
What happens if the embedding model changes (different dimensions, different provider)?
The Stage 3 description covers cost but not lifecycle.

### 9.6 Testing

**Q19: How are behavioral test fixtures kept realistic?**
Behavioral tests use crafted code with known bugs. But code examples age: a test
case using Express.js v4 patterns may not be relevant when the team uses v5. Who
maintains test fixtures? How often are they updated? Is there a mechanism for
community-contributed test cases?

**Q20: What model should behavioral tests use when the persona specifies a model?**
The test plan says "use cheapest model for tests (Haiku)." But if a persona is
specifically designed for Opus (e.g., a complex architecture reviewer), testing on
Haiku may not validate the actual behavior. When should tests respect the persona's
model specification vs. overriding for cost?

### 9.7 Marketplace and Ecosystem

**Q21: How is the SuperClaude partnership governed?**
The marketplace document proposes a shared trait format standard and cross-listing.
But: who owns the format specification? How are disagreements resolved? What happens
if SuperClaude changes their format? Is there a formal partnership agreement or is
this informal cooperation? The proposal is described but the governance is not.

**Q22: What is the license compatibility matrix for marketplace content?**
The marketplace requires Apache 2.0 or MIT for Verified content. But the
third-party ecosystem document notes that Trail of Bits skills use CC-BY-SA-4.0
(ShareAlike), which cannot be relicensed. How does AgentBoot handle content with
ShareAlike licenses? Can it be included in the marketplace? Can it be composed with
Apache 2.0 content? The license scanning feature needs explicit rules.

**Q23: What is the monetization governance model?**
The marketplace document lists monetization paths (paid domains, managed marketplace,
consulting, certification) as "V2+ considerations." But: if an organization contributes
a domain layer for free and it is later commercialized, what are their rights? What
is the revenue sharing model? What prevents a fork of the marketplace with the
free content? These questions become urgent once monetization is considered.

### 9.8 Cross-Cutting Concerns

**Q24: How does AgentBoot handle versioning across the system?**
The system has multiple versioned components: AgentBoot core, individual traits,
individual personas, the org plugin, the marketplace, and domain layers. How do version
numbers relate to each other? Does a trait version bump require a persona version bump?
A plugin version bump? Is there semantic versioning across the system? The versioning
strategy is mentioned but not fully specified.

**Q25: What is the backward compatibility guarantee?**
When AgentBoot core ships a new version, what is the compatibility contract with
existing personas repos? Can an org upgrade AgentBoot core without modifying their
config? Are breaking changes in the config schema handled via migration scripts?
What is the deprecation policy?

**Q26: How does AgentBoot handle air-gapped environments?**
Some regulated organizations (government, defense, financial) operate in air-gapped
environments with no internet access. Can AgentBoot work entirely offline? The CLI
install via brew requires internet. The MCP server via npx requires internet. The
marketplace requires internet. What is the air-gap story?

**Q27: What is the performance budget for the build system?**
How long should `agentboot build` take for an organization with 20 personas, 50 traits,
and 200 gotchas? How long should `agentboot sync` take for 100 repos? Are there
performance targets? Benchmark tests? The build system is described functionally but
not in terms of performance.

**Q28: How does AgentBoot handle multi-language organizations?**
The documentation and persona content are in English. What about organizations with
non-English developers? Can traits be localized? Can persona output be in languages
other than English? Is internationalization in scope?

**Q29: What is the accessibility story?**
The CLI uses interactive prompts (the setup wizard). Are these accessible with screen
readers? The Cowork plugin uses structured forms. Are these forms accessible? The
non-engineer user segment implies accessibility matters. What are the requirements?

**Q30: Who is the initial target market?**
The PRD describes features for organizations ranging from 2-person teams to 100+
developer enterprises. But go-to-market requires focus. Is the initial target small
teams (2-20 developers) who can adopt immediately? Or enterprise teams (100+) who
need MDM and compliance? The feature set suggests enterprise, but the complexity
budget suggests small teams.

**Q31: What is the relationship between the SKILL.md format and Claude Code agents?**
The concepts document describes both SKILL.md (agentskills.io format) and Claude Code
agent CLAUDE.md (rich frontmatter). For CC-native output, personas become agents
(`.claude/agents/{name}/CLAUDE.md`), not skills. But skills are the invocation surface
(`/review-code`). The relationship between the agent (the definition) and the skill
(the invocation) is described but could be confused. The skill uses `context: fork` and
`agent:` to delegate to the agent. This two-file pattern should be more explicitly
documented as a core architectural pattern.

**Q32: How are compliance hooks tested in CI?**
Compliance hooks (PHI scanning, credential blocking) are critical governance features.
But the test plan does not specifically address hook testing. How do you verify that a
`UserPromptSubmit` hook correctly blocks PHI? In CI, there is no Claude Code session.
The hooks are shell scripts that can be unit-tested, but the integration with CC's
hook system can only be tested in a live CC session.

---

## 10. Glossary

### Agent

A Claude Code concept. An agent is a custom AI assistant defined in
`.claude/agents/{name}/CLAUDE.md` with rich frontmatter (model, permissionMode,
maxTurns, disallowedTools, mcpServers, hooks, memory, isolation). Agents are distinct
from the base Claude Code assistant. In AgentBoot, personas are compiled into agents
for CC-native output.

### ADR (Architecture Decision Record)

A formal exception governance mechanism. When a developer intentionally deviates from
a persona's recommendation, an ADR documents the rationale, gets reviewer approval,
and becomes a permanent record. The persona learns to accept the deviation for that
specific case. ADRs handle permanent, approved deviations (as opposed to temporary
elevation for debugging).

### Agent-Agnostic

Content that works across multiple AI agent platforms without modification. Traits
(Markdown), personas (SKILL.md via agentskills.io), and gotchas (Markdown with glob
patterns) are agent-agnostic. Hooks, managed settings, and agent frontmatter are
agent-specific (Claude Code only).

### agentskills.io

An open standard for AI agent skill definitions. Uses SKILL.md format (Markdown with
YAML frontmatter). Supported by 26+ agent platforms. AgentBoot uses agentskills.io as
the cross-platform persona format.

### Always-On Instructions

Universal guardrails distributed to every repo regardless of persona configuration.
These load at session start and remain active throughout. Used for org-wide rules that
apply to every AI interaction (security baselines, coding standards, compliance
requirements).

### Autonomy Progression

A three-phase model for persona independence. Phase 1 (Advisory): persona produces
findings, human decides. Phase 2 (Auto-approve): persona applies low-risk fixes
automatically, high-risk findings require human review. Phase 3 (Autonomous): persona
operates independently, human reviews post-hoc. Promotion between phases is a
governance decision requiring evidence (false-positive rates, test coverage, team
approval).

### Build Pipeline

The three-stage process: validate (pre-build checks), compile (resolve traits, produce
output), sync (distribute to repos). The pipeline is: validate, compile, sync.

### CC-First Delivery

The principle that Claude Code is the primary delivery target. Content is agent-agnostic
(portable Markdown). Delivery leverages CC's full feature surface (plugins, hooks,
managed settings, MCP, agents, skills, rules). Non-CC platforms get the content but
not the enforcement mechanisms.

### Cowork

Anthropic's desktop application for non-technical users. Cowork plugins are the same
format as Claude Code plugins but appear in a GUI with form-based input rather than
slash commands. AgentBoot personas packaged as plugins work in both CC and Cowork.

### Compilation Target

One of two output formats produced by `agentboot build`. The cross-platform target
produces standalone SKILL.md files with traits inlined. The CC-native target produces
the full `.claude/` directory structure with @imports, rich frontmatter, hooks, and
MCP configuration.

### Convention Over Configuration

The principle that AgentBoot ships with sensible defaults for everything. Organizations
configure what is different about their situation, not everything from scratch. Borrowed
from the Spring Boot design philosophy.

### Domain Layer

A complete package of traits, personas, gotchas, and instructions for a specific
compliance regime or technology stack. Examples: healthcare-compliance (PHI, HIPAA,
FHIR), fintech-compliance (PCI-DSS, SOX), govtech-fedramp. Domain layers are the
highest-value, highest-effort marketplace contribution.

### Gotcha (Gotchas Rule)

A path-scoped instruction that encodes hard-won operational knowledge. Activated when
a developer works on files matching the glob pattern. Invisible (zero context cost)
when working on unrelated files. Technology-specific, not org-specific — making them
highly shareable. Example: "PostgreSQL partitions do NOT inherit relrowsecurity."

### HARD Guardrail

A non-overridable compliance rule deployed via MDM (managed settings) or marked
`required: true` in the org config. Cannot be elevated, overridden, or disabled at any
scope level. A team-level config that attempts to disable a HARD guardrail causes a
build failure. Used for rules where violation is a compliance incident (PHI scanning,
credential blocking, audit logging).

### Hub-and-Spoke Distribution

The distribution model. One central repository (the hub, the personas repo) contains
the source of truth. Target repositories (spokes, the actual codebases) receive
compiled artifacts via the sync pipeline. One-way flow: hub publishes, spokes receive.
Spokes do not produce governance.

### Managed Settings

Claude Code configuration files deployed to OS-level paths
(`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux)
via MDM. Cannot be overridden by any user or project setting. Used for HARD guardrails
and forced plugin installation.

### Marketplace

The three-layer ecosystem for sharing governance content. Core (maintained by AgentBoot),
Verified (community-contributed, reviewed), Community (unreviewed, buyer-beware).
Physically, a marketplace is a Git repository with a marketplace.json catalog.

### MCP (Model Context Protocol)

A protocol for AI agents to interact with external tools and data sources. MCP servers
expose tools and resources that agents can consume. Supported by Claude Code, Copilot,
Cursor, and Gemini CLI. AgentBoot uses MCP for cross-platform persona serving and
knowledge base access.

### Persona

A complete, deployable agent. A composition of traits plus a specialized system prompt
that defines the agent's identity, operating context, and mandate. Personas compose
traits; they do not inherit from each other. In AgentBoot, personas are defined as
SKILL.md files and compiled into platform-specific output.

### persona.config.json

Build metadata for a persona. Specifies which traits to compose, at what weight, the
target model, permission mode, tool restrictions, MCP servers, hooks, and autonomy
level. Read by the compile step to generate output.

### Persona Arbitrator

A dedicated persona (V2+) that resolves conflicts when multiple reviewer personas
produce contradictory findings on the same code. Only invoked when the `/review`
meta-skill detects conflicting findings. Not invoked on every review.

### Plugin

A Claude Code distribution unit that bundles agents, skills, hooks, rules, MCP
configuration, and settings into a single installable package. Distributed via
marketplaces (public or private). The primary delivery method for CC users.

### Prompts as Code

The principle that AI agent behavior is treated as infrastructure: defined in files,
stored in version control, reviewed in pull requests, tested, linted, and measured.
Analogous to Infrastructure as Code (Terraform) and Configuration as Code (Kubernetes).

### Scope Hierarchy

The four-level organizational model: Org, Group, Team, Repo. More specific scopes
layer on top of general ones. Optional behaviors follow "most specific wins." Mandatory
behaviors follow "most general wins." Determines how configuration is merged during
sync.

### Self-Improvement Reflections

An optional mechanism where personas write brief reflections after completing their
task. Reflections accumulate into a dataset revealing patterns. Three phases:
Phase A (humans edit personas from observation), Phase B (reflections + review skill),
Phase C (automated accuracy tracking).

### SKILL.md

The agentskills.io format for persona definitions. Markdown with YAML frontmatter
(name, description, traits, scope, output format) followed by the system prompt in
prose. The cross-platform persona format.

### SME Discoverability Fragment

A lightweight always-on CLAUDE.md section (~100 tokens) auto-generated by the build
system. Lists all available personas and how to invoke them. Makes personas
discoverable without consulting external documentation.

### SOFT Guardrail

An important default that can be temporarily elevated. Deployed via the shared repo
(not MDM). Elevation mechanism: developer invokes `/elevate` with a reason, receives
time-bounded bypass (default 30 minutes), audit log entry created, guardrail
automatically re-engages on TTL expiry.

### Structured Telemetry

Persona invocation metrics emitted as structured JSON (GELF/NDJSON format). Fields
include persona_id, model, scope, input/output tokens, cost, findings, duration, and
timestamp. No developer ID by default. No prompt text. Human-queryable with `jq`.

### Team Champion

A designated engineer on each team (typically tech lead or senior IC) who runs sync,
reviews sync PRs, files quality feedback, onboards teammates, and proposes governance
improvements. A rotating responsibility taking minutes per week in steady state.

### Trait

A reusable behavioral building block for an AI persona. Captures a single aspect of
how an agent should think or communicate. Supports weight configurations
(HIGH/MEDIUM/LOW or 0.0-1.0). Composed at build time. The DRY principle applied to
AI behavior. Write once, compose everywhere, improve in one place.

### Trait Weight

A calibration system for traits that support variable intensity. Named weights
(HIGH/MEDIUM/LOW) map to numeric values (0.7/0.5/0.3). Additional values: OFF (0.0)
and MAX (1.0). The weight adjusts the threshold for action, not the type of action.
At any weight, CRITICAL findings always surface.

### Two-Channel MDM Distribution

Enterprise distribution model separating non-negotiable enforcement (Channel 1: MDM-
deployed managed settings for HARD guardrails) from team-customizable configuration
(Channel 2: Git-based hub-and-spoke for SOFT guardrails, traits, personas, skills).

---

*End of Product Requirements Document.*
