---
description: AgentBoot hub authoring conventions — how to create and edit personas, traits, gotchas, and lexicons
applyTo: "core/**"
id: 01KZH2QM0CCJRF0EMPBHPBH8DA
slug: agentboot-authoring
hash: sha256:55f92dee8643a113
---

# AgentBoot Hub Authoring Instructions

These instructions are active when editing hub content. They define the conventions
for creating and modifying AgentBoot artifacts: traits, gotchas, personas, lexicons,
and always-on instructions.

---

## Artifact Types

Use the correct artifact type for the job. Misclassifying content causes build failures,
silent non-activation, or wasted tokens.

**Trait** (`core/traits/`) — a reusable behavioral building block that composes into
personas at build time. Use when: a behavior should apply to multiple personas, weight
calibration is meaningful (HIGH/MEDIUM/LOW/MAX/OFF), and the instruction is context-free
(not scoped to specific file paths). Traits modulate how an agent thinks or communicates.
They are not checklists, domain rules, or persona definitions.

**Gotcha** (`core/gotchas/`) — a path-scoped knowledge rule encoding battle-tested
operational knowledge. Use when: advice applies only when working in specific file paths
or file types. Must have `paths:` frontmatter. Compiles into `.claude/rules/` and
activates contextually. Without `paths:` frontmatter, a gotcha will not activate on
any file — this is a silent failure.

**Persona** (`core/personas/{name}/`) — a complete agent definition with a specific job,
identity, and mandate. Each persona has a `SKILL.md` (the agent prompt with trait
injection markers) and a `persona.config.json` (build metadata specifying which traits
to inject and at what weight). Invoked via slash command.

**Lexicon** (`core/lexicon/`) — a domain term definition establishing shared vocabulary.
Use when: a term needs a precise org-specific meaning that all agents should resolve
identically. Lexicons are context compression primitives — defined once, referenced
everywhere, saving tokens on every turn. Compiled first in the pipeline so all other
artifacts benefit.

**Instruction** (`core/instructions/`) — a universal guardrail distributed to every repo
regardless of persona. Use when: behavior must apply everywhere, in every session, before
any slash command. Never use for persona-specific guidance — that belongs in the persona's
SKILL.md or in a trait.

---

## Frontmatter Requirements

Every artifact requires YAML frontmatter. Missing or malformed frontmatter fails
validation.

### Trait frontmatter

```yaml
---
type: trait
weight: HIGH  # HIGH | MEDIUM | LOW | MAX | OFF
scope: core   # core | groups/{name} | teams/{group}/{name}
---
```

### Gotcha frontmatter

```yaml
---
type: gotcha
paths:
  - "src/auth/**"
  - "**/*.middleware.ts"
description: One-line summary of the rule
scope: core
contributor: author@org.com
source: repo-name  # if imported from a spoke repo
---
```

The `paths:` field is mandatory for gotchas. A gotcha without `paths:` will not
activate contextually and will not be compiled into `.claude/rules/`.

### Persona SKILL.md frontmatter

```yaml
---
name: Code Reviewer
description: Senior code reviewer — finds real bugs, not style nits
invocation: /review-code
---
```

### Instruction frontmatter

```yaml
---
description: One-line summary of what this instruction enforces
applyTo: "**"  # glob pattern for activation scope
---
```

---

## Scope Hierarchy

Four levels, from broadest to narrowest:

- `core` — org-wide, applies to every team and repo
- `groups/{name}` — a division or product area (e.g., `groups/platform`)
- `teams/{group}/{name}` — one squad (e.g., `teams/platform/auth-team`)
- Repo-level — path-scoped rules within a single repo

More specific scopes override less specific for optional behaviors (composition type
`preference`). For mandatory behaviors (composition type `rule`), the org scope wins
and lower scopes cannot override.

Place files in the correct directory for their scope:
- `core/` — org-wide artifacts
- `groups/{name}/` — group-level overrides
- `teams/{group}/{name}/` — team-level overrides

---

## The PR Model

All hub content changes are proposed as pull requests — never direct commits to main.
Use the branch naming convention `ab/{type}-{artifact-name}` (e.g., `ab/trait-critical-thinking`,
`ab/gotcha-lambda-cold-start`).

Hub maintainers review and merge. The build pipeline runs `agentboot validate --strict`
on every PR. A failing validation blocks merge.

---

## Promotion Pathways

When a developer's personal prompt pattern proves valuable, it can be promoted up the
scope chain:

```
personal → team → group → org
```

Track promotion history in frontmatter:

```yaml
promoted_from: teams/platform/auth-team
promoted_by: jane@acme.com
promoted_at: 2026-04-12
```

Demotion (scope narrowing) is also valid. Record the reason as root-cause analysis:

```yaml
demotion_reason: "Too aggressive for org-wide use; auth-team-specific pattern"
```

---

## Attribution

Every artifact should carry provenance. Include these frontmatter fields where applicable:

```yaml
contributor: mike@acme.com
source: auth-service        # if imported from a spoke repo
promoted_from: teams/auth   # if promoted from a narrower scope
promoted_by: jane@acme.com
promoted_at: 2026-04-12
```

Attribution enables traceability, credit, and impact measurement across the org.

---

## Build Pipeline Awareness

Understand the pipeline before editing hub content:

- `agentboot validate` — runs 7 pre-build checks (persona existence, trait references,
  SKILL.md frontmatter, secret scanning, composition consistency, rule override detection,
  MCP governance). Run before submitting PRs.
- `agentboot build` — compiles traits into personas, emits `dist/` with one self-contained
  folder per platform.
- `agentboot sync` — distributes compiled `dist/` to spoke repos.

Traits are composed at build time, never at runtime. The compilation order is:
`lexicon → traits → instructions → gotchas → personas`.

Edit source files in `core/`, never in `dist/` directly. The `dist/` directory is
generated output that gets overwritten on every build.

---

## Common Mistakes

**Never put secrets, API keys, or credentials in any artifact.** Validation scans for
secret patterns and blocks the build. This includes test credentials, internal hostnames,
and account IDs.

**Gotchas without `paths:` frontmatter do not activate contextually.** They compile
but never trigger. Always verify the `paths:` field matches the intended file patterns.

**Traits with conflicting composition types fail validation.** A trait cannot be both
`rule` (top-down, org wins) and `preference` (bottom-up, team wins) at the same scope.
Decide which composition model applies and be consistent.

**Editing `dist/` directly is wasted work.** The next build overwrites everything in
`dist/`. Edit source files in `core/`, `groups/`, or `teams/`.

**Forking a base persona instead of using trait weight overrides creates drift.** If a
team needs different behavior from an org persona, override the trait weights in
`persona.config.json` at the team scope. Do not copy and modify the persona's SKILL.md.

**Deep inheritance hierarchies are an anti-pattern.** Prefer flat composition. A persona
composes traits directly — traits do not inherit from other traits.
