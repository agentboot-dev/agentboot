# New Ideas (Exploratory)

These ideas emerged from scratch notes and are not yet on the roadmap. Each needs
design work before it can be stack-ranked or assigned a Jira ticket.

---

## 1. N-Tier Composable Scope Model

**Status:** Exploratory — architectural rethink of scope merging

### Current state

The scope model is a fixed 4-tier hierarchy: Org → Group → Team → Repo. More specific
scopes layer on top of general ones. This is implemented and working (Phase 2, AB-16).

### The idea

Replace the fixed 4-tier model with an N-tier model where N >= 2. Org and Project are
required tiers. Team is optional. Groups become composable graph nodes rather than a
fixed layer in the hierarchy.

This introduces **guilds** (working name, needs workshopping) — cross-cutting
communities of practice that span groups. Example: "All frontend teams at Acme use the
same tech stack, conventions, and rules, regardless of which business group they belong
to." A frontend guild shares personas, traits, and conventions across groups without
duplicating content in each group's config.

Real-world precedent: a microservices guild supports various teams, helps them adopt
patterns, and is responsible for governance and design patterns. The guild says "all
service properties must start with X prefix" — teams can't override that. But if SOC 2
rules from org MDM say otherwise, the guild should get an error when trying to
introduce a conflicting rule.

### Why this matters

The current inheritance model works well for personas (team overrides group overrides
org). But guilds don't fit cleanly into a strict hierarchy — they cut across groups.
A frontend guild might span the Platform group and the Product group.

For **personas and traits**, guild composition works naturally — a guild contributes
additional content that layers in.

For **governance and rules**, the key insight is that guilds don't introduce a new
precedence level. They are authors, not tiers.

### Guilds as authors, not tiers

**The scope hierarchy stays unchanged:** Org → Group → Team → Repo → User. Precedence
follows the same top-down rules it always has. Nothing changes about how scopes
resolve.

**Guilds are first-class authors that can inject content at any scope level.** A
microservices guild could:
- Write an org-level rule: "all services must use spaces, not tabs" — this follows
  org-level precedence, meaning nothing below can override it
- Write a team-level naming convention: "Team API properties must start with `api_`"
  — this follows team-level precedence and can be overridden at repo level (unless
  marked HARD)
- Write a repo-level gotcha for a specific service

The guild decides *where* in the hierarchy its content lands. The scope level
determines the precedence, not the guild's identity.

**Conflict resolution is unchanged.** A rule scoped to org-level follows org-level
rules whether it was authored by the platform team or the frontend guild. If a guild
tries to introduce a rule at org-level that conflicts with existing org MDM, it gets
an error — same as any other author would.

**Accountability via `git blame`.** This is a core design benefit of prompts-as-code.
When a rule causes chaos or spikes token cost, `git blame` shows which guild authored
it, when, and in what commit. No special attribution system needed — version control
provides it. Guilds are first-class citizens for accountability precisely because
their contributions are versioned files, not runtime config.

This is what "composition enhancing inheritance" means concretely: the scope hierarchy
(inheritance) is preserved for precedence. Guilds (composition) add the ability for
cross-cutting concerns to contribute content at any level without requiring a
dedicated tier in the hierarchy. The org structures their hierarchy however it suits
them — guilds layer in without constraining the shape.

### Hub repo structure implications

Guild authorship must happen in the hub repo for `git blame` to work. This means
guild content lives under its own top-level directory, with the target scope encoded
in the path:

```
guilds/
  microservices/
    groups/
      platform/
        rules.md        # guild-authored rule targeting platform group
    teams/
      api/
        gotchas/
          naming.md     # guild-authored gotcha targeting team api
    org/
      spacing.md        # guild-authored rule targeting org-level
```

**Unique names or IDs required.** The hub repo file structure should not have to
mirror the org's actual hierarchy. With a flexible N-tier model, the org structure
can be deep, wide, or oddly shaped — forcing a file tree to match would be fragile.
Scope nodes need unique identifiers so that `guilds/microservices/teams/api/` resolves
unambiguously even if multiple groups have a team called "api."

### Decision: organizational nodes

**Decided.** Interior scope levels are **nodes**. Not groups, not teams — nodes.

- **Org** — always the root (required)
- **Node** — any intermediate scope. Nodes can nest arbitrarily. Optional — an org
  with flat structure can go straight from org to repos.
- **Repo** — always a leaf (required)

```
org (root)
  └── node "platform" (type: "department")
        ├── node "api" (type: "team")
        │     └── repo service-a (leaf)
        └── node "infra" (type: "team")
              └── repo terraform-modules (leaf)
```

**Names must be unique** across the entire org. This is enforced by validation. No
two nodes can share a name, regardless of where they sit in the hierarchy. This
enables unambiguous targeting (guilds, config references, CLI commands) without
requiring full paths.

**Type is a free-form string.** Nodes have an optional `type` field — whatever the
org wants: "team," "department," "studio," "tower," "group," "squad." AgentBoot
doesn't interpret the type; it's organizational metadata for humans. Large enterprises
need this to make sense of their own structure. Small orgs can ignore it entirely.

**Rationale.** The build system never asks "is this a group or a team?" — it only
asks "what content is scoped here and what's the parent?" The semantic distinction
belongs in metadata, not the type system. Orgs name their tiers however they want
(and in practice, naming is wildly inconsistent — groups, departments, teams, studios,
towers, and worse). AgentBoot shouldn't prescribe organizational vocabulary beyond
what's structurally necessary: org (root), node (interior), repo (leaf).

Forcing orgs and repos is already more prescriptive than ideal, but necessary. Adding
a third forced concept ("teams" or "groups") crossed the line. Nodes are optional and
orgs use them at their own peril.

**Migration note.** The current implementation uses `groups` and `teams` in
`agentboot.config.json`. This will need a migration path — likely supporting the old
keys with a deprecation warning while introducing `nodes`.

Since guilds target nodes by name (not by type), the node abstraction makes guilds
simpler — `guilds/microservices/nodes/api/rules.md` rather than needing to know
whether "api" is a group or team.

### Open design questions

- How does `agentboot.config.json` represent nodes and guild membership? Nodes need a
  schema that supports arbitrary nesting with optional `type` and unique `name`.
- Is "guild" the right name? It resonates with engineering culture but may not
  translate well to non-engineering orgs. Alternatives worth considering: "community,"
  "practice," "circle," "chapter."
- Performance: does graph-based scope resolution add meaningful complexity to the
  compile step? This needs objective measurement before committing to the design.
- Should guilds declare which scope levels they're allowed to target? An org might
  want to say "the frontend guild can write node-level rules but not org-level" as a
  governance control. Potentially over-engineering — keep on the table.

### User-scope

User-scope is the lowest tier — personal config not checked into git. It can never
override anything above it.

The deeper tension is with **prompts-as-code**. AgentBoot's philosophy is that prompts
are version-controlled artifacts. User-scope config lives outside git, which means it
doesn't get the benefits of version control, code review, or reproducibility.

But requiring user-scope in git creates problems:
- Privacy concerns — personal preferences shouldn't be visible to the team
- Scaling — user config in the hub repo doesn't scale
- Sync complexity — distributing per-user config to the right machine is error-prone

The Maven `~/.m2/settings.xml` pattern is familiar but not beloved. Every solution
considered so far (committing personal settings, syncing from the hub) feels
cumbersome. This remains genuinely undecided.

**Followup questions:**

- Could user-scope be a local-only file (`~/.agentboot/preferences.json`) that
  AgentBoot reads at build/compile time but never syncs? This sidesteps the
  prompts-as-code tension by treating user preferences as environment, not source.
- Should user-scope config be limited to a narrow set of knobs (fidelity level, model
  preference, UI hints) rather than allowing arbitrary persona/trait overrides? A
  constrained surface area reduces the risk of user config silently changing behavior.
- Is there a middle ground where user-scope is version-controlled in a *personal*
  repo (like dotfiles) rather than the org hub? The user gets git benefits without
  polluting the shared repo.

---

## 2. Compact on Compile (Persona Quantization)

**Status:** Exploratory — new compiler capability

### The idea

Support multiple fidelity levels for compiled personas: **min**, **default**, and
**max**. Humans curate the max version (full detail, all examples, verbose guidance).
An LLM quantizes the max into default and min variants by removing examples,
compressing prose, and preserving semantic intent.

Developers switch between variants based on context:
- **max** — new to a persona, learning, or debugging persona behavior
- **default** — daily use, good balance of guidance and token cost
- **min** — tight context windows, fast sessions, experienced users

### Why this matters

Token budget is a real constraint. A well-authored persona with rich examples and
detailed guidance can consume significant context. Today, the choice is binary:
include the trait or don't. Quantization adds a middle ground — keep the behavioral
intent, reduce the token cost.

This also creates a clean authoring model: always write the max version. Let the
compiler derive the others. No one has to maintain three copies of the same persona.

### Fidelity as a configuration concept

Fidelity (working name) follows bottom-up precedence like personas — not top-down like
rules. The resolution order:

1. **AgentBoot core default:** medium (safe middle-ground)
2. **Scope node config:** each org/group/guild/team can set a default fidelity
3. **User override:** final say, via user-scope

User-facing CLI:
```
agentboot config persona.fidelity review-code high    # one persona
agentboot config persona.fidelity [all] low           # all personas (e.g., over budget)
agentboot config persona.fidelity reset               # clear all user-scoped fidelities
```

Use case: "I'm not happy with the code reviewer output. Before touching the persona
itself, I bump fidelity to high as a quick experiment." This is a user-scope setting —
exploratory, non-permanent, doesn't affect the team.

Use case: "I've burned too many tokens and I'm over budget. Drop everything to min in
one command." Quick recovery without changing org config.

### Quantization mechanics

**LLM choice:** Haiku by default (cost-effective for compression). The org can
configure a different model.

**Timing:** Build-time, one-shot, cached. All fidelity variants are built and deployed
once. The active variant is selected at prompt-time based on the fidelity config.

**No manual editing of compacted variants.** If the quantized output isn't right, the
levers are:
1. Improve the max (hi-fi) source
2. Write better **compaction focus prompts** that guide what the quantizer preserves
3. Adjust **trait weights** — a HIGH-weight trait resists compaction more (trait
   weights are essentially compaction focus prompts in structured form)

If a user makes a one-time edit to a compacted variant, the system analyzes the diff
and helps the user write a better hi-fi prompt or compaction focus prompt instead of
preserving the edit. The edit is a signal, not a source of truth.

### Token reduction targets

Initial targets (50%/25% of max) are fine as starting points, but hitting specific
numbers is low priority. The real value is in empirical testing:

- Behavioral tests (Phase 4, AB-69) compare output quality across fidelity levels on
  the same inputs
- Testing may reveal that some personas benefit from many fidelity levels while others
  get little gain from compaction or verbosity
- The optimal number of levels may differ per persona — some might only need 2 (high/
  low), others might benefit from several
- If testing proves the whole concept isn't worth it, that's still valuable knowledge

This testing data may be some of the most valuable non-deterministic test output in the
entire system. The goal is optimizing the ratio: most behavioral context per token.

Longer term, this becomes less critical if/when the system advances to RAG (Knowledge
Stage 3), which can specialize persona efficiency through retrieval rather than
compression.

### Inspiration

The note references "Christie's compaction prompt" — session management techniques
from prior work that could inform how compaction focus prompts work.

### LLM usage permissions model

AgentBoot uses the **org's own LLM** for quantization. No data is ever sent to
AgentBoot, its affiliates, or any AgentBoot-operated LLM. The design principle:
AgentBoot improves the org's outcomes by leveraging the LLMs already available to the
personas it manages, solely for the org's benefit.

**Opt-in by default (convention over configuration):**
- All features requiring LLM invocation require explicit opt-in
- Modeled after CC's permission guardrails:
  - Opt-in per occurrence
  - Allow all of a certain type
  - Allow by scope (bottom-up precedence)
  - Deny by scope (top-down precedence)
  - Full permissive mode (equivalent to `--dangerously-skip-permissions`)
- LLM usage is surfaced in the admin dashboard alongside other token metrics:
  "How much is AgentBoot costing us, and which features are driving the cost?"
- Transparency is non-negotiable

### Relationship to existing features

- Token budget calculation (AB-25, done) — would need to report per-variant budgets
- `/optimize` skill (#114, Phase 5) — related but different; optimize suggests
  improvements, quantize produces compressed variants
- Prompt style guide (AB-55, done) — quantization should follow the same style rules
- Trait weights (Phase 2 planned) — weights inform compaction resistance

---

## 3. Jira Workflow Persona

**Status:** Exploratory — new persona (org-specific, not core)

### The idea

A persona that helps teams manage their Jira workflow: epic auditing, grooming
assistance, stale ticket cleanup, consistency checks, status hygiene. Not a
governance/compliance auditor — a workflow quality tool.

### Not a core persona

This is an example of what an org would create in their own personas repo. It could
evolve in multiple directions simultaneously — this is the beauty of the AgentBoot
design:

1. The org perfects it for their specific Jira workflow
2. They genericize the reusable parts into a product-owner or project-management persona
3. They contribute the generic version to AgentBoot core or the marketplace
4. Their org-specific customizations become a thin layer on top of the shared persona,
   reducing their maintenance burden

This demonstrates the full lifecycle: org-specific → marketplace candidate → core
candidate.

### Capabilities (sketch)

- **Epic audit:** Are epics well-structured? Do stories have acceptance criteria? Are
  estimates consistent? Flag epics with no stories, stories with no epic, orphaned
  subtasks.
- **Grooming assist:** Before a grooming session, summarize what's in the backlog,
  flag tickets that need refinement, suggest groupings.
- **Staleness detection:** Tickets in "In Progress" for N days with no updates.
  Tickets in "Ready" that have been passed over for M sprints.
- **Consistency checks:** Naming conventions, label usage, component assignments,
  fix version hygiene.

### Trait composition

Composes core traits (`structured-output`, `schema-awareness`, `critical-thinking`)
with **domain-specific traits** for Jira, Agile methodology, and project management.
This exercises the org-traits-composed-with-core-traits pattern — a key proof point
for the trait system.

### Autonomy and access

- **Read-write from day one** if the org chooses. As a custom persona, the org decides
  its autonomy level. The Advisory → Autonomous progression (AB-85) is available but
  not mandatory — flexibility and user empowerment matter more than prescribed caution
  for org-authored personas.
- **MCP primary, REST API fallback.** Authentication flows through the existing
  Atlassian MCP server config. REST/curl is the backup when MCP is unavailable.
- **Scope:** Org-level for the authoring org's use case, but configurable per
  deployment.

### Token budget concern

A Jira persona loaded org-wide consumes context in every session, including sessions
that never use it. This is a concrete instance of the broader question: how does
AgentBoot handle personas that are valuable to the org but wasteful in most individual
sessions?

Options:
- Lazy loading (don't inject until invoked) — requires CC skill `context: fork`
- Fidelity levels (Idea #2) — run at min fidelity when not actively used
- Session-type detection — only inject for sessions that touch Jira-related files

**Followup questions:**

- Does `context: fork` already solve this? Skills with `context: fork` only consume
  tokens when invoked. If the Jira persona is a skill (not always-on), the cost is
  zero in sessions that don't use it.
- If so, is the real question about always-on personas specifically? Should AgentBoot
  distinguish between "always-on" and "on-demand" personas more explicitly in config?

---

## 4. AgentBoot Inside Claude Code (`/agentboot` or `!agentboot`)

**Status:** Exploratory — UX/delivery question

### The idea

Run AgentBoot commands from inside a Claude Code session without switching to the
terminal. The original vision was a `/agentboot` skill that accepts the same arguments
as the CLI (`/agentboot build`, `/agentboot status`, `/agentboot sync --dry-run`).

### The tension

Using a CC skill to wrap a shell command feels like a waste of LLM tokens. The skill
would just parse arguments and shell out — no LLM reasoning needed. CC already
supports `!` prefix for running shell commands inline (`!agentboot build`), which
achieves the same result without burning tokens on a skill invocation.

### Options

| Approach | Pros | Cons |
|----------|------|------|
| **`!agentboot build`** (shell prefix) | Zero token cost, already works, no new code | User must remember `!` syntax, no contextual help |
| **`/agentboot` skill** | Intuitive, discoverable via `/`, could add LLM smarts | Token waste for simple commands, skill boilerplate |
| **Hybrid: skill for smart commands, `!` for simple ones** | Best of both — `/agentboot doctor` gets LLM analysis of output, `!agentboot build` just runs | Two invocation patterns to learn |
| **Hook-based** | AgentBoot hooks react to CC events automatically | Not user-invoked, different use case |

### Where a skill adds value beyond shell execution

Some commands would genuinely benefit from LLM interpretation:
- `agentboot doctor` — the skill could analyze the output and suggest fixes
- `agentboot status` — the skill could summarize what's deployed and what's stale
- `agentboot lint` — the skill could explain findings in context of the current session
- `agentboot discover` — the skill could help the user decide what to migrate

For `build`, `sync`, `validate` — pure execution, no LLM value. `!` prefix is better.

### Recommendation (tentative)

Don't build a generic `/agentboot` skill that wraps every CLI command. Instead:
1. Document `!agentboot <command>` as the standard way to run AgentBoot from CC
2. Build targeted skills only where LLM interpretation adds value (e.g., `/agentboot
   doctor` or `/agentboot discover`)
3. Revisit if CC adds a mechanism for skills to shell out without LLM overhead

### Skill system research needed

Several questions require research into CC's skill system:

- **Pass-through mode:** Does CC's skill system support a mode that skips LLM
  processing? If so, a thin `/agentboot` wrapper becomes viable at zero token cost.
- **Pre-LLM exit:** Can a skill command exit before calling the LLM for any reason?
  Specifically, if the argument passed was invalid? Are there hooks between the skill
  command invocation and LLM processing?
- **Plugin skills vs regular skills:** What are the pros/cons? If AgentBoot is a CC
  plugin, skills would be prefixed (`/agentboot:build`). As regular skills (no plugin),
  they're just `/build` or `/agentboot-build`. The plugin prefix creates the same
  namespacing awkwardness that makes `/agentboot` feel like the wrong UX.

### Plugin naming

Related but distinct: we missed claiming "agentboot" as a CC plugin name (and
equivalent naming/namespacing in other agents' ecosystems). This should be tracked as
an ops task alongside the GitHub org and domain claims.

### Open design questions

- Would a single `/agentboot` skill with subcommand routing feel more coherent than
  separate skills? This is related to the plugin prefix question — if the plugin is
  `agentboot`, then `/agentboot:doctor` is natural, but `/agentboot:build` is wasteful.
- Does the plugin model allow mixing LLM-interpreted skills and pass-through skills
  within the same plugin?
- If the CLI is installed globally (`brew install agentboot`), is `!agentboot build`
  always available in CC regardless of plugin installation? If so, the plugin is only
  needed for the LLM-enhanced commands.
