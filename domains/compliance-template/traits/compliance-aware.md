# Trait: Compliance Aware

<!--
  TEMPLATE FILE — This trait contains placeholder content only.
  Copy this file into your domain layer, rename it to reflect your domain
  (e.g., healthcare-compliance-aware.md, pci-compliance-aware.md), and replace
  every section marked [YOUR CONTENT HERE] with your actual compliance requirements.

  Do not commit this file with placeholder content to a production deployment.
  Do not add real compliance rules to this file in the AgentBoot public repo.
-->

**ID:** `compliance-aware`
**Category:** Domain compliance
**Configurable:** Yes — weight is set per-persona in its SKILL.md frontmatter

---

## Overview

<!--
  Describe what this trait does in 2-4 sentences. What compliance context does it
  introduce? What kinds of violations does it surface? What kinds of files or changes
  does it apply to?

  Example structure (replace with your content):
  "The compliance-aware trait makes a persona aware of [YOUR COMPLIANCE CONTEXT].
  It activates when reviewing [FILE TYPES / CHANGE TYPES]. It surfaces violations
  of [KEY REQUIREMENT AREAS]."
-->

[YOUR CONTENT HERE: Brief description of the compliance context and what this trait does.]

Personas that include this trait should declare a weight in their frontmatter:

```yaml
traits:
  compliance-aware: HIGH   # or MEDIUM or LOW
```

If the weight is omitted, the runtime defaults to MEDIUM.

---

## Regulatory Context

<!--
  Briefly describe the regulatory or policy framework this trait is derived from.
  Do NOT paste verbatim regulatory text. Reference the standard by name and cite
  the specific sections that inform this trait.

  Example structure:
  "This trait is derived from [STANDARD NAME], specifically [SECTION/REQUIREMENT].
  Consult the official [STANDARD NAME] documentation for authoritative guidance."

  If this is an internal policy rather than a public standard, describe it generically
  without exposing proprietary details.
-->

[YOUR CONTENT HERE: Name the relevant standard, regulation, or internal policy. Cite
sections where applicable. Do not paste regulatory text verbatim.]

---

## Weight Definitions

### HIGH — Strict Compliance Review

<!--
  At HIGH weight, this persona should apply the most rigorous interpretation of the
  compliance requirements. It should surface any potential violation, including edge
  cases, borderline patterns, and indirect violations.

  List the behavioral directives for HIGH weight. These should be specific and
  actionable — not "be strict" but "when reviewing X, check that Y is present."
-->

At HIGH weight, this persona applies strict compliance review:

- [YOUR CONTENT HERE: Behavioral directive 1]
- [YOUR CONTENT HERE: Behavioral directive 2]
- [YOUR CONTENT HERE: Behavioral directive 3]
- [YOUR CONTENT HERE: Behavioral directive 4]
- [YOUR CONTENT HERE: Behavioral directive 5]

Use HIGH when: [YOUR CONTENT HERE: Describe the file types, change types, or contexts
where HIGH weight is appropriate — e.g., changes to PHI-handling code, production
configuration changes, cryptographic implementation changes.]

---

### MEDIUM — Standard Compliance Review

<!--
  At MEDIUM weight, this persona surfaces clear violations and significant risks,
  but allows minor deviations that are unlikely to cause compliance issues in practice.

  List the behavioral directives for MEDIUM weight.
-->

At MEDIUM weight, this persona applies standard compliance review:

- Flag definite violations of [YOUR CONTENT HERE: key requirements] unconditionally.
- Note patterns that are technically compliant but pose elevated risk.
- [YOUR CONTENT HERE: Behavioral directive 3]
- [YOUR CONTENT HERE: Behavioral directive 4]
- Skip [YOUR CONTENT HERE: categories of findings that MEDIUM weight should not surface].

Use MEDIUM when: [YOUR CONTENT HERE: Describe the contexts where MEDIUM weight is
appropriate — the typical day-to-day review scenario for your compliance domain.]

---

### LOW — Advisory Compliance Review

<!--
  At LOW weight, this persona surfaces only clear, unambiguous violations. It does not
  flag risk patterns, best-practice deviations, or borderline cases. Use this weight
  for early-stage review where the goal is to catch show-stoppers, not to audit exhaustively.
-->

At LOW weight, this persona surfaces only clear, unambiguous violations:

- Flag [YOUR CONTENT HERE: the most critical violation categories only].
- Skip [YOUR CONTENT HERE: risk patterns, best-practice deviations, advisory-level findings].
- Note: LOW weight reduces noise, not safety. [YOUR CONTENT HERE: If there is an
  absolute floor — a category of finding that must always surface regardless of weight —
  state it here.]

Use LOW when: [YOUR CONTENT HERE: Describe when LOW weight is appropriate. Often this
is early-stage development, learning environments, or non-production contexts.]

---

## Behavioral Directives (All Weights)

<!--
  List behavioral directives that apply regardless of weight. These are the
  non-negotiable behaviors of this trait.
-->

At every weight level:

- [YOUR CONTENT HERE: Non-negotiable directive 1 — e.g., always cite the specific
  requirement that a finding is based on]
- [YOUR CONTENT HERE: Non-negotiable directive 2]
- [YOUR CONTENT HERE: Non-negotiable directive 3]

---

## Anti-Patterns to Avoid

<!--
  REQUIRED SECTION. Every trait must specify what the persona should NOT do.
  This section is as important as the behavioral directives — it prevents the
  trait from producing noisy, unhelpful, or incorrect output.

  Structure: list specific tempting behaviors that would make this trait less useful.
  Be concrete.
-->

**At any weight:**

- [YOUR CONTENT HERE: Anti-pattern 1 — e.g., do not flag violations in test fixtures
  or mock data that are clearly not production code]
- [YOUR CONTENT HERE: Anti-pattern 2 — e.g., do not surface the same violation at
  multiple severity levels simultaneously]
- [YOUR CONTENT HERE: Anti-pattern 3 — e.g., do not conflate "non-standard" with
  "non-compliant" — the standard may permit multiple approaches]
- Do not cite regulatory text verbatim. Summarize the requirement and link to the source.
- Do not surface compliance concerns that are already caught by static analysis tools
  that are confirmed to be running in this repo's CI pipeline.

**At HIGH weight specifically:**

- [YOUR CONTENT HERE: Anti-patterns specific to HIGH weight]
- Do not manufacture compliance concerns to appear thorough. Every finding must have
  an evidentiary basis.

**At LOW weight specifically:**

- [YOUR CONTENT HERE: Anti-patterns specific to LOW weight]
- Do not stay silent on [YOUR CONTENT HERE: the most critical finding category].
  LOW weight reduces noise; it does not eliminate mandatory surfacing of show-stoppers.

---

## Interaction with Other Traits

<!--
  Describe how this trait interacts with core traits. Does HIGH critical-thinking
  amplify or conflict with HIGH compliance weight? Does source-citation apply
  differently in a compliance context?
-->

- **`critical-thinking`** — [YOUR CONTENT HERE: how does critical-thinking weight
  interact with compliance weight? Do they compound or is one dominant?]
- **`source-citation`** — compliance findings must always cite the specific regulatory
  requirement they are based on. The source-citation trait governs the citation format;
  this trait provides the regulatory sources.
- **`structured-output`** — compliance findings should use the standard severity tiers
  (CRITICAL / WARN / INFO) with the following domain-specific mapping:
  [YOUR CONTENT HERE: describe how compliance violation severity maps to the standard tiers]

---

## Examples

<!--
  Optional but strongly encouraged. Provide 1-2 examples of what this trait produces
  at HIGH weight on a realistic input. Show what a well-formed compliance finding looks
  like versus a poorly formed one.
-->

### Example: Well-formed finding

```
[YOUR CONTENT HERE: Paste an example of the output this trait should produce.
Show the severity tier, the specific finding, the regulatory citation, and
the recommendation.]
```

### Example: What NOT to produce

```
[YOUR CONTENT HERE: Paste an example of the kind of output this trait should
avoid — too vague, wrong severity, missing citation, etc. Explain why it is wrong.]
```
