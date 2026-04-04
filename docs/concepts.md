---
sidebar_label: "Core Concepts"
sidebar_position: 2
---

# AgentBoot Concepts

AgentBoot is a harness engineering build tool. It compiles agentic personas — the
behavioral definitions that make AI agents reliable — into platform-native formats for
every major coding agent (Claude Code, Copilot, Cursor, Codex) and the universal AGENTS.md
standard.

This document explains the conceptual foundation. Read this before the configuration
reference or getting-started guide. The concepts here inform every design decision.

---

## What is a trait

A trait is a reusable behavioral building block for an AI persona. It captures a single
aspect of how an agent should think or communicate — a cognitive stance, an output
discipline, or an epistemic commitment.

The analogy from software engineering is the DRY principle applied to AI behavior. Before
traits, every persona had to independently specify its approach to things like skepticism,
output structure, and evidence requirements. In practice, this meant the same concepts
were expressed slightly differently in every persona — sometimes well, sometimes poorly,
always inconsistently. When you wanted to improve how all your personas handle uncertainty,
you had to touch every file.

Traits solve this. You write `critical-thinking` once. Every persona that needs skeptical
review simply composes it with a weight. Improve the trait definition, and all composing
personas improve automatically.

A trait is not:
- A checklist of domain rules. "Verify that GDPR consent is captured" is not a trait;
  it is a domain-specific requirement that belongs in a domain layer.
- A persona. A persona has identity, purpose, and scope. A trait has neither — it only
  modulates behavior.
- A prompt template. Traits are building blocks, not invocation patterns.

The trait files in `core/traits/` are the authoritative definitions. Each one defines
the behavior, the anti-patterns to avoid, and the interaction effects with other traits.
(The trait weight system supports HIGH / MEDIUM / LOW / MAX / OFF calibration — see below.)

---

## What is a lexicon

A lexicon is a set of domain term definitions — ubiquitous language that establishes
shared vocabulary between humans and agents. Inspired by Domain-Driven Design, a lexicon
ensures that when you say "full-build" or "spoke" or "NIQ," the agent resolves these to
the exact same meaning you intend.

Lexicons are **context compression primitives**. Once defined, every trait, gotcha,
instruction, and persona can reference lexicon terms without re-explaining them. This
saves tokens on every turn — and since CLAUDE.md content costs money per turn (it's
injected as a system-reminder, not in the cached system prompt), compression compounds
across every session.

Lexicons compile **first** in the pipeline. They appear at the top of compiled output
so the LLM has term definitions resolved before encountering traits and rules that
reference them. The compilation order is:

```
lexicon → traits → instructions → gotchas → personas
```

Lexicon entries can reference other lexicon entries, enabling hierarchical compression.
A `deployment` entry references `canary`, `blue-green`, `rollback` — each defined once,
the full semantic tree unpacked from minimal tokens.

The lexicon files in `core/lexicon/` use a structured format:

```yaml
# core/lexicon/project-terms.yaml
terms:
  full-build:
    definition: Complete validation pipeline. Must pass before any PR.
    includes: lint, typecheck, test, build
  NIQ:
    definition: Project tracking prefix.
    format: "NIQ-{N}"
    usage: commit messages, branch names
  spoke:
    definition: A target repo that receives compiled personas from the hub.
    see: hub-and-spoke distribution
```

Composition type: `rule` by default. Org-level term definitions cannot be silently
redefined by teams. Teams can **add** terms at their scope level, but cannot replace
org definitions. (A future abstract/binding mode will allow orgs to define term
contracts with team-specific implementations — see roadmap.)

---

## What is a persona

A persona is a complete, deployable agent: a composition of traits plus a specialized
system prompt that defines the agent's identity, operating context, and mandate.

AgentBoot uses the [agentskills.io](https://agentskills.io) SKILL.md format for persona
files. This means every persona is a Markdown file with YAML frontmatter that specifies
its ID, version, traits, scope, and output format — followed by the system prompt in
prose. The frontmatter is machine-readable (the build and sync tooling uses it); the
prose is human-readable and is what the model receives.

The frontmatter trait block is where trait composition happens:

```yaml
traits:
  critical-thinking: HIGH
  structured-output: true
  source-citation: true
  confidence-signaling: true
```

Each trait listed here is resolved from the trait definitions at build time and woven
into the persona's effective system prompt. This means the persona author writes what
makes their persona unique — the domain knowledge, the operating context, the mandate —
and inherits the generic behavioral discipline from the trait definitions.

A persona is not:
- A chat conversation. Personas are always-on agents that operate within a defined scope,
  not one-off system prompts.
- An extension of another persona. Personas compose traits; they do not inherit from
  each other.
- A configuration file. The SKILL.md prose is the primary artifact. The frontmatter
  is metadata, not the definition.

---

## The scope hierarchy

AgentBoot models your organization as a four-level hierarchy:

```
org
 └── group
       └── team
             └── repo
```

This mirrors the way real organizations are actually structured — and the way
responsibility and governance work in them.

**Org level** is where universal rules live. Code review standards that apply to every
engineer, security guardrails that the CISO requires on all codebases, output discipline
that the organization wants from every AI interaction. Org-level configuration is always
active in every repo that is registered with the org.

**Group level** is for horizontal concerns that cross teams but do not apply to the whole
org. A platform engineering group might deploy additional infrastructure review personas
to all platform teams. A product group might add user-facing copy review personas that
the platform group doesn't need.

**Team level** is where team-specific customization happens. A team that works in a
specific framework, owns a specific kind of system, or has team-level standards that
differ from the group default can add configuration at this level. Team-level
configuration layers on top of group and org, never replacing it.

**Repo level** is where path-scoped instructions live. Repos can add instructions that
activate only when specific file types or directories are touched. A Lambda functions
directory might activate additional serverless-specific review guidance. A database
migrations directory might activate schema review guardrails.

**Precedence and composition types:** Each artifact has a composition type that determines
how scope conflicts are resolved. **Rule** composition (top-down): the highest scope wins
— an org-level gotcha cannot be overridden by a team. **Preference** composition
(bottom-up): the lowest scope wins — a team can customize an org default. Defaults:
gotchas and persona-rules are `rule` (enforced top-down); traits and instructions are
`preference` (customizable by teams). Individual artifacts can override their default
composition type via frontmatter (`composition: rule`).

This hierarchy matters for two reasons. First, it ensures that governance propagates
downward automatically — a new team that registers with the org immediately gets all
org-level and group-level configuration without any manual setup. Second, it preserves
team autonomy on things that are genuinely team-specific.

---

## Multi-platform output

AgentBoot generates platform-native output for every major coding agent. The same
personas, traits, gotchas, and instructions compile into the right format for each
platform — developers use whichever tool they prefer without losing governance.

Output formats (see [Output Structure](../CLAUDE.md#output-structure)):
- **AGENTS.md** — universal cross-tool standard (Codex, Cursor, Copilot, Gemini CLI)
- **Claude Code** — full `.claude/` directory with agents, skills, rules, traits, hooks
- **Copilot** — `copilot-instructions.md`, `.github/agents/`, scoped instructions
- **Cursor** — `.cursor/rules/*.mdc` with `alwaysApply`/`globs` frontmatter
- **SKILL.md** — agentskills.io cross-platform format

### Claude Code-native output

Claude Code is the most feature-rich platform. Its native output uses the full
feature surface — agents with tool restrictions, path-scoped rules that re-inject
on every matching file access, lifecycle hooks, managed settings, and MCP servers.

Key architectural insight: CLAUDE.md content is injected as `<system-reminder>` tags
(not in the cached system prompt). Rules in `.claude/rules/` are re-injected every
time a matching file is touched. This makes gotchas (path-scoped rules) the
highest-impact artifact AgentBoot produces.

### What Claude Code reads natively (no build step required)

```
.claude/
├── CLAUDE.md                          # Project instructions (supports @imports)
├── settings.json                      # Hooks, permissions, env vars
├── settings.local.json                # Local overrides (gitignored)
├── agents/
│   └── {name}/CLAUDE.md               # Custom subagents (not SKILL.md)
├── skills/
│   └── {name}/SKILL.md                # Invocable skills (agentskills.io format)
├── rules/
│   └── {topic}.md                     # Path-scoped rules (paths: frontmatter)
└── .mcp.json                          # MCP server configuration
```

### @import: the key Claude Code feature AgentBoot must use

Claude Code's CLAUDE.md supports `@path/to/file` imports that expand inline at load
time. This changes the compilation model fundamentally:

**Cross-platform output (current):** Traits are inlined into SKILL.md at build time.
Each compiled persona is a standalone file with all trait content baked in. This is
necessary for platforms that don't support file inclusion.

**Claude Code-native output (new):** Traits stay as separate files. The generated
CLAUDE.md uses `@imports` to compose them at load time:

```markdown
# Code Reviewer

@.claude/traits/critical-thinking.md
@.claude/traits/structured-output.md
@.claude/traits/source-citation.md

You are a code reviewer. Your job is to find bugs, quality issues...
```

This has three advantages over inlined output:
1. **Maintainability** — traits are maintained in one place. Updates propagate to all
   composing personas automatically without rebuilding.
2. **Live editing** — changing a trait file takes effect immediately without rebuilding.
3. **Transparency** — developers can read each trait file independently instead of
   wading through a monolithic system prompt.

The build system generates **one self-contained folder per platform** under `dist/`.
Each platform folder (e.g., `dist/claude/`, `dist/copilot/`, `dist/cursor/`, `dist/skill/`,
`dist/agents/`) contains everything needed for that platform and nothing it doesn't.
Gemini and JetBrains output folders are planned for a future phase.
The Claude Code folder uses @import-based files; the skill folder uses inlined SKILL.md
for cross-platform distribution.

### Agent frontmatter: much richer than SKILL.md

Claude Code's `.claude/agents/{name}/CLAUDE.md` supports frontmatter fields that the
generic SKILL.md format does not:

```yaml
---
name: review-security
description: Deep security review — OWASP, auth, data handling, PHI
model: opus                              # Per-agent model selection
permissionMode: default                  # default | acceptEdits | bypassPermissions
maxTurns: 25                             # Agentic turn limit
disallowedTools: Edit, Write, Agent      # Tool restrictions (read-only reviewer)
tools: Read, Grep, Glob, Bash            # Tool allowlist (alternative to denylist)
skills:                                  # Preload these skills into agent context
  - hipaa-check
  - review-security
mcpServers:                              # Scoped MCP servers
  - compliance-kb
hooks:                                   # Agent-specific hooks
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./hooks/validate-no-phi.sh"
memory: project                          # Persistent memory scope
isolation: worktree                      # Git worktree isolation
---
```

AgentBoot's `persona.config.json` should map to these fields. The compile step should
generate Claude Code agent CLAUDE.md files with the full native frontmatter — not just
the subset that agentskills.io supports.

### Rules use `paths:`, not `globs:`

Claude Code's `.claude/rules/` files use `paths:` in frontmatter (not `globs:`). The
An earlier implementation used `globs:` which was valid at the time but the
current Claude Code documentation specifies `paths:`:

```yaml
---
paths:
  - "src/api/**/*.ts"
  - "**/*.sql"
  - "**/migrations/**"
---
```

AgentBoot's gotchas rules and path-scoped instructions should generate `paths:`
frontmatter for Claude Code output and `globs:` where other platforms expect it.

### Hooks belong in settings.json

Claude Code hooks are configured in `.claude/settings.json`, not in standalone files.
AgentBoot's compliance hooks should generate settings.json entries:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/phi-input-scan.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/phi-output-scan.sh"
          }
        ]
      }
    ]
  }
}
```

The available hook events cover the full agent lifecycle: `SessionStart`,
`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStart`,
`SubagentStop`, `Notification`, and more. AgentBoot should generate hook
configurations for compliance, audit logging, and guardrail enforcement as part
of the sync output.

### Managed settings = HARD guardrails

Claude Code's managed settings (`/Library/Application Support/ClaudeCode/` on macOS,
`/etc/claude-code/` on Linux) are deployed by MDM and **cannot be overridden by any
user or project setting**. This is the native mechanism for HARD guardrails:

```
/Library/Application Support/ClaudeCode/
├── managed-settings.json    # Non-overridable settings + hooks
├── managed-mcp.json         # Non-overridable MCP servers
└── CLAUDE.md                # Non-overridable instructions
```

AgentBoot should generate managed settings artifacts for organizations that deploy
via MDM. These map directly to the HARD guardrail tier — PHI scanning hooks,
credential blocking, audit logging that no developer can disable.

### MCP configuration in .mcp.json

When personas need external tool access (knowledge bases, data detection, domain
lookup), AgentBoot should generate `.mcp.json` entries:

```json
{
  "mcpServers": {
    "compliance-kb": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@my-org/compliance-kb-server"]
    }
  }
}
```

This is synced to target repos alongside the persona files. Agents that reference
MCP servers in their frontmatter (`mcpServers: [compliance-kb]`) will automatically
have access.

### Skills with context forking

Claude Code skills support `context: fork` which delegates the skill to a subagent
with an isolated context. This is the native mechanism for reviewer isolation — the
reviewer doesn't see the generation conversation:

```yaml
---
name: review-code
description: Code review against team standards
context: fork
agent: code-reviewer
allowed-tools: Read, Grep, Glob, Bash
---
```

AgentBoot's review personas should use this pattern for Claude Code output. The skill
is the invocation surface (`/review-code`), and it forks to the agent, which runs in
isolation with its own tools and permissions.

### Summary: per-platform compilation targets

AgentBoot's compile step produces one self-contained folder per platform under `dist/`.
Each folder has everything needed for that platform, nothing it doesn't. Scope hierarchy
(core → groups → teams) is preserved within each platform folder. Duplication across
platforms is intentional — generated files are cattle not pets. Diffing across platforms
(e.g., `diff dist/claude/ dist/copilot/`) shows exactly what's different between
distributions.

```
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
│   │   └── .cursor/rules/*.mdc
│   ├── groups/...
│   └── teams/...
│
└── skill/                       # Cross-platform SKILL.md (agentskills.io)
    ├── core/
    │   ├── code-reviewer/SKILL.md (traits inlined)
    │   └── PERSONAS.md
    ├── groups/...
    └── teams/...
```

The sync engine reads from `dist/{platform}/` and writes to target repos in
platform-native locations. Organizations choose which platform to deploy per repo
based on their agent toolchain.

---

## Prompts as code

AgentBoot treats AI agent behavior as infrastructure: defined in files, stored in version
control, reviewed in pull requests, with a complete audit history.

This is the same shift that happened with Infrastructure as Code (Terraform, Pulumi) and
Configuration as Code (Kubernetes manifests, GitHub Actions workflows). Before IaC, every
environment was a snowflake — you could not reproduce it, you could not review changes to
it, and you could not trace the history of decisions. After IaC, every change is a commit.

Prompts as Code applies the same discipline to AI behavior. Before it, every team's
CLAUDE.md was written in isolation, improved informally, and never reviewed. When
something went wrong with an agent, there was no diff to examine. When best practice
evolved, there was no way to propagate the update.

With AgentBoot:
- Every change to an agent's behavior is a pull request with a description and a review.
- Traits and personas have version numbers. You can pin a repo to `critical-thinking@1.2`
  and upgrade deliberately.
- The sync pipeline means the update propagates to all registered repos automatically
  after the PR merges.
- The `PERSONAS.md` registry is generated from the source files — it is always accurate
  because it cannot drift from the actual definitions.

This is not bureaucracy for its own sake. It is the mechanism by which a small team can
govern AI agent behavior across dozens or hundreds of repos without heroic manual effort.

---

## The distribution model

AgentBoot follows a hub-and-spoke distribution model:

```
github.com/acme/personas (hub)
  └── agentboot build && agentboot sync
        ├── repo-A/.claude/
        ├── repo-B/.claude/
        └── repo-N/.claude/
```

### Personas hub naming convention

The hub repo is the org's single source of truth for all agentic personas, traits,
and instructions. The recommended naming convention:

| Priority | Name | When to use |
|---|---|---|
| Default | `personas` | Use this. The GitHub org already namespaces it (`github.com/acme/personas`). |
| Fallback | `agent-personas` | If `personas` is already taken (e.g., marketing/UX personas). |

Avoid redundant prefixes — `github.com/acme/acme-personas` repeats the org name.
Avoid tool-specific names — `acme-agentboot` implies a fork of the build tool.
Use short names or abbreviations — "ACME Technologies LLC" is just `acme`.

The `agentboot install` wizard checks for existing `personas` repos and suggests
`agent-personas` as the fallback when there's a collision.

### Hub contents

The hub is a single private repository that your organization owns, created from the
AgentBoot template. It contains:
- Your `agentboot.config.json`
- Any org-specific persona extensions (traits, gotchas, instructions)
- `repos.json` listing the spoke repos that receive compiled output

The spoke repos are your actual codebases. They receive compiled persona files, always-on
instruction fragments, and path-scoped instructions via the sync script. They do not
contain the source of truth — only the compiled output. If a team wants to understand why
an agent behaves a certain way, they look at the hub, not their own repo.

The build step (`npm run build`) resolves all trait compositions, validates frontmatter,
generates `PERSONAS.md`, and produces the compiled output. The sync step (`npm run sync`)
pushes the compiled output to each registered repo and opens a PR. Human review of that
PR is the governance checkpoint.

This model has a deliberate property: the spokes are passive. They receive governance;
they do not produce it. Teams can add repo-level extensions through the hub's team
configuration — they do not commit persona files directly to their own repos. This
prevents drift and keeps the hub authoritative.

### Public repo pattern

For private repos, sync creates a PR and the compiled `.claude/` content is committed
normally. But for **public repos**, committing org-specific personas would leak private
content (org traits, internal gotchas, compliance rules) into a public repository.

The public repo pattern solves this:

1. **Compiled output is gitignored** in the public repo (`.claude/` in `.gitignore`)
2. **Repo-specific enrichments live in the hub**, not in the target repo, under a
   `public-repos/{repo}/` directory
3. **Sync still writes locally** — developers get the files, they just aren't committed
4. **New developers run `agentboot install --connect`** to pull content from the hub on first clone

The prompts-as-code invariant holds: all content is in version control, reviewed, and
audited — it's just in the hub's private git instead of the spoke's public git.

**Hub structure with public repos:**
```
acme/personas/
├── core/                          # org-wide (all repos)
├── groups/
├── teams/
├── public-repos/                  # only if org has public repos
│   ├── agentboot/
│   │   ├── rules/no-runtime.md
│   │   └── gotchas/jsonc-parser.md
│   └── oss-library/
│       └── gotchas/wasm-compat.md
├── agentboot.config.json
└── repos.json
```

**Scope merge order with public repos:**
`core/` → `groups/{g}/` → `teams/{g}/{t}/` → `public-repos/{repo}/`

The `public-repos/` scope is the most specific — it wins on filename conflict.

**Developer experience is identical.** A developer inside a public repo runs the same
commands as in a private repo:

```bash
agentboot add gotcha "JSONC parser doesn't handle block comments"
```

AgentBoot detects the repo is public (from `repos.json` or git remote), confirms the
hub is available and writable, and routes the content to `public-repos/{repo}/` in the
hub. The developer never changes directories or thinks about where the file goes.

**If the hub is not available or not writable, the command errors:**
```
ERROR: Hub repo not found or not writable. Your gotcha cannot be persisted.
       Run `agentboot install --connect` to link your hub, or check permissions.
```

This is a hard error, not a warning. Content never falls through to the public repo's
git. There is no "write it anyway" option.

**repos.json marks public repos explicitly:**
```json
[
  { "path": "../api", "label": "API", "platform": "claude" },
  { "path": "../agentboot", "label": "AgentBoot", "platform": "claude", "public": true }
]
```

---

## LLM and deterministic commands

AgentBoot's CLI has two classes of commands, separated by whether they invoke an LLM.

**Deterministic commands** are pure Node.js — fast, free, predictable, and work offline.
They never call an LLM, never cost money, and never require a login beyond npm:

`install`, `uninstall`, `build`, `validate`, `sync`, `doctor`, `add`, `lint`, `status`,
`config`, `export`, `publish`

**LLM-powered commands** use `claude -p` (Claude Code's non-interactive mode) to invoke
the user's existing Claude Code session. They cost money (billed to the user's Claude
subscription), produce non-deterministic output, and require an active Claude Code login:

`import`, `test --behavioral`, `review`, `cost-estimate`

The same features are also available as **interactive skills** (`/agentboot import`,
`/agentboot test`) inside Claude Code sessions, using AgentBoot's MCP server as a bridge.
The CLI versions are batch-oriented; the skill versions are conversational. Both use the
same personas repo and the same non-destructive guarantees.

This separation is a deliberate architectural decision. A user running `agentboot build`
should never be surprised by an LLM call, a cost, or a login prompt. LLM features are
always opt-in and clearly labeled.

---

## The trait weight system

> **Implemented (Phase 7, AB-134).** `persona.config.json` supports both array format
> (backward compatible, all traits at MEDIUM) and object format with named weights.
> Compile-time calibration preambles are implemented for `critical-thinking`. Other
> traits will gain calibration text incrementally.

Several core traits — `critical-thinking` is the primary example — expose a weight axis:
`HIGH`, `MEDIUM`, and `LOW`. This is not a priority system; it is a calibration system.

The same underlying logic applies at every weight. At HIGH, the threshold for surfacing
a concern is very low — the persona speaks up about anything it notices. At LOW, the
threshold is high — the persona surfaces only things that clearly matter. MEDIUM is the
calibrated default for ordinary review.

Why not just write separate personas for "strict" and "lenient" review? Because the
behavioral logic is identical; only the threshold differs. Separate personas would
duplicate that logic and diverge over time. The weight system keeps the logic in one
place (the trait definition) while letting persona authors calibrate the stance.

In practice: security reviewers use `critical-thinking: HIGH` because the cost of missing
a vulnerability is high. A documentation reviewer might use `critical-thinking: MEDIUM`
because it needs to flag genuine problems without making authors feel attacked by minor
nit feedback. A first-pass code review persona for learning environments might use
`critical-thinking: LOW` to reduce noise and keep the feedback focused.

The weight does not override the severity floor. At any weight, CRITICAL findings must
always surface. `critical-thinking: LOW` reduces noise; it does not create blind spots.

---

## Gotchas rules

A gotchas rule is a path-scoped instruction that encodes hard-won operational knowledge —
the kind of information that lives in one engineer's head until they leave and the team
rediscovers it the hard way. Every organization has these. AgentBoot makes them a
first-class concept.

A gotchas file is a Markdown file with `paths:` frontmatter that limits when the rule
activates. When a developer is working on a file that matches the glob pattern, the
gotchas content is automatically included in the agent's context. When working on
unrelated files, the gotchas are invisible — zero context cost.

```markdown
---
paths:
  - "db/**"
  - "**/*.sql"
  - "**/migrations/**"
description: "PostgreSQL and RDS gotchas"
---

# PostgreSQL / RDS Gotchas

- **Partitions do NOT inherit `relrowsecurity`.** Enable RLS explicitly on each
  partition.
- **Always verify `relrowsecurity` is ON, not just that policies exist.** Policies
  without enforcement = no protection.
- **UUID PK causes exponential INSERT slowdown.** Drop ALL indexes before bulk load,
  recreate after.
```

Gotchas rules belong in your domain layer or in team-level extensions — they are
organization-specific by nature. AgentBoot core does not ship gotchas because they are
inherently tied to your stack and your production incidents.

The pattern is powerful because it captures knowledge at the exact moment it is needed.
A developer writing a database migration sees the PostgreSQL gotchas. A developer
writing a Lambda handler sees the serverless gotchas. No one has to remember to consult
a wiki page or ask the right person.

---

## Compliance hooks

AgentBoot supports a defense-in-depth model for compliance enforcement, using the hook
system provided by the target agent platform.

The model has three layers, in decreasing order of enforcement strength:

1. **Input hook (deterministic):** A pre-prompt hook that scans user input before the
   model sees it. If the hook detects a violation (PHI, credentials, internal URLs),
   it blocks the request with a non-zero exit code. This is the strongest available
   technical control.

2. **Instruction-based refusal (advisory):** An always-on instruction fragment that
   tells the model to refuse to process sensitive content. This is prompt-level, not
   deterministic — the model may not recognize all violations. But it is active in
   every interaction and costs nothing when not triggered.

3. **Output hook (advisory):** A post-response hook that scans the model's output for
   compliance violations. This layer can log and warn but **cannot block** — in Claude
   Code, the Stop hook fires after the response has already rendered to the developer.
   This is an architectural constraint, not a bug. Document it honestly.

The three layers are complementary. The input hook catches what it can deterministically.
The instruction catches what the model can recognize. The output hook provides audit
evidence and catches leakage that the instruction missed. No single layer is sufficient
alone.

AgentBoot generalizes this from healthcare PHI to any sensitive data pattern — PII,
credentials, internal API keys, production URLs, customer data. The hook templates are
configurable per organization through the domain layer.

**Honest limitation:** Not all agent platforms support hooks. Claude Code has full
hook support (PreToolUse, PostToolUse, Stop). GitHub Copilot CLI has limited pre-prompt
hooks. IDE-based agents generally have no hook mechanism. AgentBoot documents these gaps
per platform rather than promising universal enforcement.

---

## ADR governance

When a persona flags something, and the developer intentionally chose to do it
differently, the organization needs a mechanism to say "this is an approved exception."
Without this, every guardrail violation becomes a battle, and engineers start ignoring
review findings.

AgentBoot supports Architecture Decision Records (ADRs) as the exception governance
mechanism. The lifecycle is:

1. **Review** — a persona flags a finding during review
2. **Propose** — the developer uses `/create-adr` or `/propose-exception` to draft a
   formal exception with rationale
3. **Approve** — a designated reviewer (CODEOWNERS, tech lead) reviews the exception
   PR and approves or rejects it
4. **Commit** — the approved exception becomes a permanent record in the ADR index,
   and the persona learns to accept the deviation for that specific case

ADRs live in the personas repo (not the target repo) because they are governance
artifacts, not code artifacts. They are tracked in an `adrs/index.json` that the
build system can reference.

This is complementary to the temporary elevation pattern (where a developer needs a
one-time bypass for debugging). ADRs handle *permanent, approved deviations*. Temporary
elevation handles *emergency access with audit trail and auto-expiry*. A mature
governance system needs both.

---

## Numeric trait weights

> **Implemented (Phase 7, AB-134).** Numeric weights (0.0–1.0) are supported alongside
> named weights. `resolveWeight()` in config.ts handles both forms.

The HIGH / MEDIUM / LOW weight system described earlier is the simplified interface.
Under the hood, traits that support calibration use a numeric 0.0–1.0 scale that maps
to finer-grained behavior:

| Numeric | Named | Typical Use |
|---------|-------|-------------|
| 0.0 | OFF | Trait inactive |
| 0.3 | LOW | Light review — trust the author, flag only clear defects |
| 0.5 | MEDIUM | Standard — question choices, verify claims |
| 0.7 | HIGH | Thorough — actively look for hidden issues |
| 1.0 | MAX | Adversarial — assume hostile input, verify everything |

In `persona.config.json`, you can use either form:

```json
{
  "traits": {
    "critical-thinking": "HIGH",
    "creative-suggestion": 0.3
  }
}
```

The build system resolves named weights to their numeric equivalents. The persona's
compiled SKILL.md receives the calibration instructions appropriate for its weight.

The `creative-suggestion` trait (**planned**) is the counterpart to `critical-thinking`.
Where critical thinking is the tear-down dial (skepticism), creative suggestion is the
build-up dial (proactive improvement suggestions). Security reviewers typically use
high critical thinking and low creative suggestion. Code reviewers use moderate
levels of both.

---

## Self-improvement reflections

Personas can optionally write a brief reflection after completing their task. The
reflection is saved to `.claude/reflections/{persona-name}/{timestamp}.md` and captures:
what the persona was asked to do, what it found, what it was uncertain about, and what
it would do differently next time.

Over time, these reflections accumulate into a dataset that reveals patterns: which
findings are most common, which areas have the most uncertainty, which personas are
invoked most frequently. A `/review-reflections` skill can summarize these patterns
for human review — identifying trait calibration opportunities, missing rules, or
personas that need additional training data.

The self-improvement loop progresses through three phases:
- **Phase A (current):** Humans edit persona definitions based on observed behavior
- **Phase B (design target):** Reflections + `/review-reflections` skill
- **Phase C (future):** Automated accuracy tracking

This is opt-in — not all agent platforms support file write-back, and not all
organizations want the overhead. Enable it in `agentboot.config.json` when ready.

---

## Reviewer selection

When a codebase has multiple reviewer personas (code, security, architecture, cost),
developers should not have to decide which one to invoke. A reviewer selection config
maps file paths and change types to the appropriate reviewer(s):

```json
{
  "rules": [
    { "glob": "**/*.sql", "reviewers": ["code-reviewer", "security-reviewer"] },
    { "glob": "infra/**", "reviewers": ["code-reviewer", "cost-reviewer"] },
    { "glob": "src/auth/**", "reviewers": ["security-reviewer"] }
  ],
  "default": ["code-reviewer"]
}
```

A `/review` meta-skill reads this config, inspects the current diff, and routes to
the appropriate persona(s). The developer invokes `/review` and the system decides
which specialists are needed. This is the orchestrator pattern from the origin designs
— a lightweight routing layer, not a complex agent-to-agent messaging system.

---

## HARD/SOFT guardrail elevation

Not all guardrails are equal. Some rules must never be bypassed — a PHI scrubber in a
healthcare org, a credential scanner in a fintech. Others are important defaults that a
senior engineer may need to temporarily override for debugging or experimentation.

AgentBoot distinguishes two tiers:

**HARD guardrails** are deployed via MDM (managed device management) or marked
`required: true` in the org config. They cannot be elevated, overridden, or disabled at
any scope level. The build system enforces this — a team-level config that attempts to
disable a HARD guardrail causes a build failure. HARD guardrails are for rules where
violation is a compliance incident, not a judgment call.

**SOFT guardrails** are deployed via the shared repo and can be temporarily elevated.
The elevation mechanism:

1. Developer invokes `/elevate {guardrail-name}` with a reason
2. The skill grants a time-bounded bypass (default TTL: 30 minutes)
3. An audit log entry is created: who elevated, what, why, when, TTL
4. When the TTL expires, the guardrail automatically re-engages
5. All actions taken during the elevation window are logged

For larger organizations where automated elevation creates audit risk, AgentBoot also
supports a manual escalation model: the developer files a GitHub issue requesting
bypass, a designated approver grants or denies it, and the decision is recorded. This
is the pattern used in a large enterprise design, where the team size and
compliance requirements made automated elevation inappropriate.

A mature governance system needs both HARD/SOFT tiers and both temporary elevation
(for debugging) and permanent exceptions (ADRs, described above).

---

## Team champions

Technical distribution of personas is necessary but not sufficient. Adoption requires
a human governance layer — someone on each team who understands the persona system,
syncs updates, files quality feedback, and answers questions from teammates.

AgentBoot calls this role the **Team Champion**. Each team designates one engineer
(typically a tech lead or senior IC) who:

- Runs `npm run sync` to pull the latest persona updates into team repos
- Reviews sync PRs before merging (the governance checkpoint)
- Files GitHub issues against the personas repo when a persona produces poor findings
  or misses something it should have caught
- Onboards new team members on how to use the persona system
- Proposes new gotchas rules, trait calibration changes, or team-level extensions based
  on their team's experience

The Team Champion is not a full-time role — it is a rotating responsibility that takes
minutes per week in steady state. The value is having a named person accountable for
the feedback loop between the team and the personas repo.

This pattern was validated in a large engineering organization, where the studio has
multiple siloed development teams. Without Team Champions, persona updates would land
in team repos without anyone understanding what changed or why. With them, each team
has a human bridge between the governance system and the developers who use it daily.

---

## SME discoverability

When an organization has domain expert personas (compliance SMEs, FHIR experts,
architecture advisors), developers need to know they exist before they can use them.
A persona that no one knows about delivers no value.

AgentBoot addresses this with a discoverability fragment — a lightweight always-on
CLAUDE.md section (~100 tokens) that lists all available personas and how to invoke
them:

```markdown
## Available Personas

| Command | What it does |
|---------|-------------|
| `/review-code` | Code review against team standards |
| `/review-security` | Security-focused review (OWASP, auth, data handling) |
| `/gen-tests` | Generate unit and integration tests |
| `/gen-testdata` | Generate realistic synthetic test data |
| `/sme-compliance` | HIPAA/GDPR/SOC2 compliance questions |
```

This fragment is auto-generated by the build system from the compiled persona registry.
It costs virtually nothing per session (the token count is trivial) but makes personas
discoverable without consulting external documentation. A developer who did not know
the test data expert existed will see it listed and try it.

The fragment is regenerated on every build, so it stays in sync with the actual persona
inventory automatically. Personas that are disabled at a scope level are excluded from
that scope's fragment.

---

## MCP-first tool integrations

When personas need to interact with external systems — knowledge bases, data detection
services, domain lookup APIs, test data generators — AgentBoot recommends building
these as MCP (Model Context Protocol) servers from day one.

MCP is now GA in Claude Code, VS Code (Copilot), and the CLI. It is also supported by
Cursor, Gemini CLI, and other agent platforms. An MCP server built for one agent works
identically in all of them — with no modification.

This matters for two reasons:

1. **Investment protection.** If your organization builds a knowledge base MCP server
   for Claude Code, it works in Copilot agent mode and Cursor without rework. If you
   build it as a Claude Code-specific tool, you rebuild from scratch for every platform.

2. **Clean migration path.** An MCP server that reads markdown files today can be
   swapped for one backed by pgvector or a vector DB tomorrow — the persona definitions
   don't change. The MCP interface is the abstraction boundary.

The alternative — having personas read files directly via Grep/Glob — is simpler for V1
but creates migration work later. The upfront cost of an MCP wrapper is a thin server;
the long-term benefit is zero-change migration and multi-platform compatibility.

For AgentBoot, this means: domain layers that need external data access should define
MCP server specifications alongside their persona definitions. The build system can
generate MCP configuration stanzas that get synced to target repos.

---

## Structured telemetry

Persona invocations should emit structured JSON logs from day one — not plain text.
The difference matters when you need to answer questions like "which persona is invoked
most often?", "what is the average token cost per review?", or "which teams use the
security reviewer least?"

AgentBoot specifies a telemetry format based on GELF (Graylog Extended Log Format) /
NDJSON with defined fields:

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

This is emitted by the audit-trail trait (which all review personas should compose).
The log is human-queryable with `jq` from day one — no dashboarding infrastructure
required to start getting value.

Telemetry enables:
- **Cost optimization** — identify which personas and models cost the most per finding
- **Coverage tracking** — ensure security reviews are happening on every repo
- **Quality feedback** — correlate finding severity with actual bug rates
- **Adoption metrics** — measure which teams are using the system and which aren't

Plain text log lines (`PERSONA_START agent=review-code`) are an anti-pattern. They
cannot be queried, aggregated, or analyzed without parsing. Start structured.

---

## Persona arbitrator

When multiple reviewer personas examine the same code, they may produce conflicting
findings. A security reviewer might flag a pattern as risky while an architecture
reviewer considers it the correct approach for the domain. A code reviewer might
suggest refactoring something that the cost reviewer flags as an unnecessary token
expenditure.

The persona arbitrator is a dedicated persona that resolves these conflicts. It:

1. Receives the conflicting findings from both personas
2. Understands the scope hierarchy and which persona has authority in the conflict
3. Produces a reasoned resolution — either accepting one finding over the other with
   an explanation, or escalating to human review when the conflict is genuinely
   ambiguous

The arbitrator is not invoked on every review — only when the `/review` meta-skill
detects that two or more reviewers produced contradictory findings on the same code
location. This keeps it lightweight.

Without an arbitrator, conflict resolution falls to the developer, who may not have
the context to judge between a security concern and an architecture rationale. The
arbitrator provides that context by reading both personas' reasoning and the relevant
rules at each scope level.

This is a V2+ feature for organizations running multiple reviewer personas. For V1
with a single code reviewer and security reviewer, conflicts are rare enough that
human resolution is sufficient.

---

## Autonomy progression

Not all personas should operate at the same level of independence. A documentation
generator might be fully autonomous (generate and commit without human review), while
a security reviewer should always require human sign-off on its findings.

AgentBoot models this as a three-phase autonomy progression, tracked per persona:

| Phase | Name | Behavior |
|-------|------|----------|
| 1 | **Advisory** | Persona produces findings. Human reviews and decides what to act on. No automated actions. |
| 2 | **Auto-approve** | Persona produces findings and applies low-risk fixes automatically (formatting, import ordering, missing type annotations). High-risk findings still require human review. |
| 3 | **Autonomous** | Persona operates independently — produces findings, applies fixes, commits changes. Human reviews the output post-hoc. |

The current autonomy phase is declared in `persona.config.json`:

```json
{
  "autonomy": "advisory"
}
```

Promotion from one phase to the next is a governance decision, not a technical
configuration change. It should require evidence: the persona has been operating at
Phase 1 for N weeks with an acceptable false-positive rate, so the team approves
promotion to Phase 2. This evidence-based progression prevents premature automation
and builds trust in the persona system.

Phase 3 (Autonomous) should be reserved for personas with high confidence scores,
extensive behavioral test coverage, and explicit team approval. Most organizations
will run most personas at Phase 1 indefinitely — and that is fine. Advisory mode
is the right default for critical review personas.

---

## Two-channel MDM distribution

For enterprise organizations with managed device fleets, AgentBoot supports a
two-channel distribution model that separates non-negotiable enforcement from
team-customizable configuration:

**Channel 1: MDM (Managed Device Management)**
Deploys via JumpCloud, Jamf, Intune, or equivalent to:
- `managed-settings.json` — Claude Code settings that cannot be overridden by any user
- `managed-mcp.json` — MCP server configurations that are always active

This channel carries HARD guardrails only — the rules where organizational compliance
requires zero possibility of developer override. PHI scanning hooks, credential
blocking, audit logging requirements. MDM-deployed settings take precedence over all
other configuration sources.

**Channel 2: Git (Shared Repo)**
Distributes via the standard hub-and-spoke model:
- SOFT guardrails, traits, personas, skills
- Team-level customizations
- Always-on instructions

This channel carries everything that benefits from version control, code review, and
team-level customization.

The two channels serve different trust levels. MDM is "the organization enforces this
on your machine." Git is "the team agreed to use this in their repos." Both are
necessary for enterprise governance; neither is sufficient alone.

This is an enterprise add-on, not a core requirement. Most organizations start with
Channel 2 only and add MDM enforcement when compliance requirements or team size
demand it. AgentBoot documents the pattern so organizations that need it know exactly
how to implement it.

---

## Proactive human action notifications

When AgentBoot performs an action that requires human follow-up to take effect, it
must tell the user what to do. The user should never have to guess why something
isn't working after running a command. This is a core value-add.

Examples:
- After `dev-sync` or `sync` changes `.claude/` files: "Restart Claude Code to pick
  up persona changes"
- After `sync` changes files in target repos: list which repos were updated
- After any config change affecting runtime behavior: tell the user what to
  restart or reload
- After `publish`: "Plugin published. Developers run `claude plugin install ...`"
- After `uninstall`: "Removed N files. Restart Claude Code if a session is active."

Every command that produces side effects ends with a "next steps" line if human
action is needed. No silent state changes.

---

## Anti-patterns

These patterns were tried in AgentBoot's origin implementations and should be
avoided. Each was rejected for a specific reason.

### Overcommitting on V1 scope

An early design specified 25 V1 personas and 8 milestones.
For a 2-person founding team, this would have taken months and risked V1 never
shipping. A revised design scoped V1 to 6 personas and 6 milestones — buildable
in weeks.

**Rule:** Start with 3-6 personas that address your highest-value use cases. Add more
after the first ones are deployed, used, and refined. A shipped persona system with 4
personas beats a designed system with 25 that never launches.

### Plain text log lines

An early design used plain text log output (`PERSONA_START agent=review-code`).
This cannot be queried, aggregated, or analyzed without custom parsing. When you need
to answer "how many security reviews ran last week?", plain text requires grep and
regex. Structured JSON requires `jq '.persona_id == "review-security"' | wc -l`.

**Rule:** Use structured telemetry (GELF/NDJSON) from day one. The upfront cost is
trivial; the analysis benefit is permanent.

### Runtime trait inclusion

Early designs proposed `@include` directives that would resolve trait references
at runtime — the agent would read and compose trait files during each session. This
breaks on platforms that don't support file inclusion (Copilot, Cursor) and wastes
tokens re-reading trait files on every invocation.

**Rule:** Traits are composed at build time. The compiled output is complete and
standalone. The agent receives a single file with all trait content already inlined.
No runtime resolution.

### Vendor-locked persona formats

An enterprise Copilot deployment explicitly rejected Copilot-proprietary prompt
files as the primary persona definition format (decision D-01). Prompt files
(`*.prompt.md`) are VS Code-specific and not recognized by CLI agent mode or other
tools. The agentskills.io SKILL.md format was chosen instead because it works across
26+ platforms.

**Rule:** Use open standards for persona definitions. Vendor-specific formats can
coexist as convenience layers (e.g., IDE slash commands) but must not be the
authoritative definition.

### Forking base personas for customization

When a product team needs to add domain-specific rules to a reviewer, the temptation
is to copy the base persona, modify it, and maintain the fork. This creates divergence
— improvements to the base persona never reach the fork, and the fork accumulates
product-specific cruft that makes it unmaintainable.

**Rule:** Use the per-persona extension pattern instead. The base persona reads its
extension file at setup time and incorporates the additional rules. The base definition
stays unmodified and receives upstream improvements automatically.

### Deep inheritance hierarchies

Object-oriented inheritance applied to personas ("security-reviewer extends
code-reviewer extends base-reviewer") creates fragile chains where changes to a
parent persona have unpredictable effects on children. This was explicitly rejected
as Design Principle #1 in AgentBoot's earliest design: composition over inheritance.

**Rule:** Personas compose traits. They do not inherit from each other. If two
personas share behavior, that behavior belongs in a trait that both compose.

---

## Monorepo design considerations

> **Status:** Future consideration (Phase 5+). Not currently supported.

AgentBoot's distribution model assumes one repo = one sync target. Each entry in
`repos.json` is a repo with its own `.git/` directory, and sync writes a single
`.claude/` directory to the repo root. This works well for multi-repo organizations,
which is the primary target.

Monorepos pose a different challenge:

```
monorepo/                  ← single .git/
├── packages/
│   ├── api-service/       ← wants API-specific personas
│   ├── web-app/           ← wants frontend-specific personas
│   └── shared-lib/        ← wants library-specific personas
```

In this layout, there is one repo but multiple teams with different persona needs.
Claude Code scopes to the repo root — it reads `.claude/` from the top level, not
from subdirectories. This means:

**What works today:**
- One set of personas for the entire monorepo (deploy to `.claude/` at root)
- Gotchas with `paths:` frontmatter can target specific packages (e.g.,
  `paths: ["packages/api-service/**"]`) — this gives per-package rules without
  per-package personas

**What does not work today:**
- Per-package persona sets (e.g., API team gets `api-contract-reviewer` but
  web team does not)
- Per-package trait composition (same persona behaves differently per package)
- Treating subdirectories as independent sync targets

**Design questions for future phases:**
- Should `repos.json` support a `scope` field that maps a subdirectory within a
  repo to a specific group/team in the hierarchy?
- Should AgentBoot generate a single merged `.claude/` that contains all
  package-specific personas, relying on `paths:` frontmatter to activate them
  contextually?
- Or should monorepo support be a documentation-only concern — recommend that
  monorepo teams use gotchas for package-specific rules and share a single
  persona set?

The gotchas-based approach (path-scoped rules, shared personas) covers most
monorepo needs without new infrastructure. Per-package personas may not be
necessary if the persona is well-designed and the path-scoped gotchas carry the
domain knowledge.

---

*See also:*
- [`docs/getting-started.md`](getting-started.md) — hands-on walkthrough from zero to first sync
- [`docs/configuration.md`](configuration.md) — complete `agentboot.config.json` reference
- [`docs/extending.md`](extending.md) — building a domain layer on top of core
