# Contributing to AgentBoot

AgentBoot is a community project. This document explains what we are building together,
what belongs in the core versus a domain layer, and the quality bar for contributions.

---

## What is in scope

### New core personas
A persona belongs in core if it addresses a universal development concern — something
any engineering team in any industry would benefit from. Good examples: an architecture
reviewer, a documentation reviewer, a dependency audit persona.

A persona does NOT belong in core if it assumes specific frameworks, compliance regimes,
business domains, or organizational structures. Those belong in a domain layer.

### New core traits
Traits are behavioral building blocks. A trait belongs in core if it describes a
reusable cognitive stance or output discipline that is domain-agnostic — the way
`critical-thinking` or `structured-output` are. If the trait only makes sense in the
context of a specific domain, it belongs in a domain layer instead.

### Domain templates
New domain templates under `domains/` are welcome. A domain template shows teams in
a specific vertical (healthcare, fintech, defense, government) how to build a compliance
layer on top of AgentBoot core without modifying core itself. Domain templates must
be generic enough that any team in that vertical can use them as a starting point.
They must not include real regulatory text, proprietary content, or org-specific rules.

### Bug fixes
Any defect in a persona, trait, instruction fragment, build script, sync script, or
CI configuration is in scope.

### Documentation
Improvements to any file under `docs/`, the main `README.md`, or inline documentation
inside trait and persona files are always welcome.

---

## What is NOT in scope

- **Org-specific personas.** A persona built for one company's engineering standards is
  not useful to anyone else. Fork the repo or use the `extend` field in
  `agentboot.config.json` to keep it private.
- **Proprietary domain content.** Do not contribute traits or personas that contain
  internal compliance rules, internal coding standards, or references to non-public
  specifications.
- **Opinions about coding styles.** AgentBoot ships agnostic on tabs vs. spaces,
  semicolons, naming conventions, etc. Personas that enforce any particular style
  convention belong in org forks, not in core.
- **Tool-specific integrations that are not widely applicable.** An integration with
  a niche internal tool is not core material.

---

## How to propose a new persona

**Issue first, then PR.** Do not open a PR for a new persona without a corresponding
issue that has been acknowledged by a maintainer.

1. Open an issue using the [Persona Request](.github/ISSUE_TEMPLATE/persona-request.md)
   template.
2. Describe the use case clearly. What problem does this persona solve? What does a
   team look like before and after deploying it?
3. List the traits it would compose. If it requires a new trait, say so and explain why
   existing traits are insufficient.
4. Provide an example invocation — a realistic prompt a developer would give it and
   the output they would expect.
5. Explain why this belongs in core rather than a domain extension (see scope rules above).
6. Wait for maintainer acknowledgment before writing code. This prevents wasted effort
   on proposals that don't fit the project direction.

---

## Trait design principles

Traits are the foundation of AgentBoot's composability. Bad traits make the whole system
worse. Good traits follow these principles:

**Generic, not specific.** A trait describes a cognitive stance or output discipline, not
a checklist of domain rules. `critical-thinking` is a stance. "Check that HIPAA audit
logs are present" is a domain rule and belongs in a domain layer.

**Composable, not monolithic.** A trait does one thing. If you are writing a trait that
covers two unrelated concerns, split it. Traits that try to do everything end up doing
nothing well.

**No domain assumptions.** A trait must not assume any particular framework, language,
industry, compliance regime, or organizational structure. If your trait works for a
Java API team but not for a React frontend team, it is not a core trait.

**Configurable where it matters.** Look at `critical-thinking` as the model: the trait
defines the behavior at each weight level, and the persona that composes it sets the
weight. Traits that have meaningful axes of variation should expose them in frontmatter
rather than hardcoding a single behavior.

**Negative space matters.** Every trait must include a "what not to do" section. Personas
that lack this section tend to produce output that is exhaustive but not useful.

---

## Persona quality bar

A persona is not ready to merge until it meets all of these requirements.

**Frontmatter.** Every persona file must include a YAML frontmatter block with:
- `id`: the slash-command identifier (e.g., `review-code`)
- `name`: human-readable display name
- `version`: semantic version starting at `1.0.0`
- `traits`: list of trait IDs with weights where applicable
- `scope`: one of `file`, `pr`, `repo`, `session`
- `output_format`: one of `structured`, `prose`, or `mixed`

**System prompt.** The persona must have a clear, complete system prompt that defines
its role, its operating assumptions, and its mandate. The system prompt should not be
a list of rules — it should read like a job description.

**Output format specification.** The persona must specify exactly what its output looks
like. If the output is structured, show the schema. If it is prose, describe the
sections. Ambiguous output specs lead to inconsistent persona behavior across models.

**What-not-to-do section.** Every persona must have a section describing anti-patterns —
things the persona must not do, tempting behaviors that would make it less useful, and
scope boundaries it must not cross.

**Example.** Every new persona must include at least one worked example: a realistic
input and the expected output. This is the primary way reviewers verify that the persona
does what it claims.

---

## Contributor License Agreement

First-time contributors must sign our CLA. When you open your first pull request,
the CLA bot will post a comment with instructions. This is a one-time process that
takes about 30 seconds — you sign by posting a comment on the PR.

The CLA grants the project maintainers the right to relicense your contributions if
needed for the long-term sustainability of the project. Your contributions remain
attributed to you. The full agreement is in [`CLA.md`](CLA.md).

---

## PR checklist

Before opening a PR, verify:

- [ ] `npm run validate` passes with no errors
- [ ] `npm run build` passes with no errors
- [ ] `PERSONAS.md` is updated if you added or changed a persona
- [ ] `README.md` is updated if the change affects the project overview
- [ ] An example is included if you added a new persona
- [ ] The trait design principles are satisfied if you added a new trait
- [ ] The persona quality bar is met if you added a new persona
- [ ] The issue number is referenced in the PR description

---

## Code of conduct

AgentBoot follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)
version 2.1. By contributing, you agree to uphold these standards. Report violations
to the project maintainers.

---

*Thank you for making AgentBoot better.*
