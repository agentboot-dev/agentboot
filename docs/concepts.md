# AgentBoot Concepts

This document explains the conceptual foundation of AgentBoot. Read this before reading
the configuration reference or the getting-started guide. The concepts here inform every
design decision in the system.

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
the behavior at each applicable configuration level (HIGH / MEDIUM / LOW, or whatever
axes of variation the trait exposes), the anti-patterns to avoid, and the interaction
effects with other traits.

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

**Precedence:** More specific scopes win on optional behaviors; more general scopes win
on mandatory behaviors. The org can mark certain traits or personas as required — those
cannot be disabled at group or team level. Everything else, lower scopes can add to or
override.

This hierarchy matters for two reasons. First, it ensures that governance propagates
downward automatically — a new team that registers with the org immediately gets all
org-level and group-level configuration without any manual setup. Second, it preserves
team autonomy on things that are genuinely team-specific.

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
my-org-personas (hub)
  └── scripts/sync.ts
        ├── repo-A/.claude/
        ├── repo-B/.claude/
        └── repo-N/.claude/
```

The hub is a single private repository that your organization owns, created from the
AgentBoot template. It contains:
- Your `agentboot.config.json`
- Any org-specific persona extensions
- The build and sync scripts inherited from AgentBoot

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

---

## The trait weight system

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

*See also:*
- [`docs/getting-started.md`](getting-started.md) — hands-on walkthrough from zero to first sync
- [`docs/configuration.md`](configuration.md) — complete `agentboot.config.json` reference
- [`docs/extending.md`](extending.md) — building a domain layer on top of core
