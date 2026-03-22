---
sidebar_label: "Prompt Authoring"
sidebar_position: 3
---

# Prompt & Cost Optimization

AgentBoot's core claim is "prompts as code." If prompts are code, they need the same
discipline as code: linting, testing, measurement, optimization, and review. This doc
covers how AgentBoot helps organizations write better prompts, spend less on tokens,
and measure the effectiveness of their personas.

---

## The Problem

Most organizations adopting AI agents have no prompt discipline:

- Persona prompts are written once and never measured
- No one knows which personas cost the most or deliver the least value
- Trait definitions are vague ("be thorough") instead of specific ("check for null safety on every nullable parameter")
- Context bloat goes unnoticed — CLAUDE.md files grow to 800 lines because no one prunes
- Model selection is vibes-based ("use Opus for everything" or "use Sonnet for everything")
- There's no feedback loop — a persona that produces 90% false positives keeps running

AgentBoot must close these gaps because **the prompts it generates are the product.**
A governance framework that produces poor prompts is worse than no framework — it's
actively wasting money and developer trust.

---

## The Local-First Principle

Every optimization tool in AgentBoot follows the same model that developers already
use for code: **run it locally first, gate it in CI second.**

```
Developer's machine (private)          CI / shared (visible)
─────────────────────────────          ─────────────────────

agentboot lint                         agentboot validate --strict
  "Your prompt has vague language"       PR blocked: trait reference missing
  "Token budget exceeded by 800"         PR blocked: schema validation failed
  Nobody sees this but you.              Fair game — you submitted it.

agentboot test --type behavioral       agentboot test --ci
  "Security reviewer missed SQLi"        Test results posted to PR
  Fix it before you push.                Team sees pass/fail, not your drafts.

agentboot cost-estimate                agentboot metrics (aggregate)
  "This persona costs $0.56/run"         "Team cost: $8,200/mo"
  Personal planning tool.                Org-level, anonymized.

/insights                              Org dashboard
  "You rephrase auth questions often"    "Auth patterns asked 89 times (team)"
  Private to you.                        No individual attribution.
```

This mirrors exactly how code works:
- `eslint` locally → fix before anyone sees → CI catches what you missed → fair game
- `npm test` locally → fix failures privately → CI runs on PR → results are public
- Your local git history is messy → your PR is clean

### Two Types of Prompts, Two Different Models

**Type 1: Persona definitions** (SKILL.md, traits, instructions, gotchas rules).
These are code. They live in the personas repo. They go through PRs.

- "Submit" = open the PR to the personas repo
- Before submit: lint, test, cost-estimate locally — private, iterate freely
- After submit: CI validates, team reviews — fair game
- This is identical to the code workflow. No new model needed.

**Type 2: Developer prompts** (what someone types into Claude Code during their
workday). These are conversations. They have **no submit moment.** There is no PR
for "explain this function" or "what is a mutex."

- These are **always private**. There is no "after submit" state.
- AgentBoot's optimization tools for developer prompts (`/insights`, telemetry)
  operate on aggregates and patterns, never on the prompts themselves.
- The only "output" that crosses the private→public boundary is what the developer
  **chooses to publish**: a PR comment, committed code, a filed issue. The
  conversation that produced that output stays private.

```
Persona definitions (Type 1)         Developer prompts (Type 2)
─────────────────────────────        ─────────────────────────────

Local editing (private)              Always private
    │                                    │
    ▼                                    ▼
agentboot lint (private)             /insights (private)
agentboot test (private)             Telemetry: aggregates only
    │                                    │
    ▼                                    ▼
PR to personas repo (submit)         Developer CHOOSES to publish
    │                                    │
    ▼                                    ▼
CI validates (fair game)             PR comment, committed code,
Team reviews (fair game)             filed issue (fair game)
                                     Everything else stays private
```

The optimization tools in this doc mostly target **Type 1** (persona definitions) —
linting, testing, cost estimation for the prompts that the platform team authors.
For **Type 2** (developer conversations), see
[`docs/privacy.md`](privacy.md) for the privacy model.

This isn't just about privacy — it's about **learning without humiliation.** A
developer who's new to prompt engineering needs to be able to write a bad persona
definition, see the linter tell them it's vague, fix it, and submit the good version.
If the linter's feedback were visible to the team, they'd never experiment. And a
developer asking Claude "what is a foreign key" for the third time needs to know
that question will never surface anywhere.

---

## 1. Prompt Linting (`agentboot lint`)

Static analysis of persona prompts, trait definitions, and instructions — catching
problems before they reach production.

### Lint Rules

**Token budget rules:**

| Rule | Severity | What it catches |
|------|----------|----------------|
| `prompt-too-long` | WARN at 500 lines, ERROR at 1000 | Persona prompts that exceed context budgets |
| `claude-md-too-long` | WARN at 200 lines, ERROR at 500 | Generated CLAUDE.md exceeding CC's effective limit |
| `trait-too-long` | WARN at 100 lines | Individual traits that should be split |
| `total-context-estimate` | WARN at 30% of context window | Combined persona + traits + instructions exceed budget |

**Quality rules:**

| Rule | Severity | What it catches |
|------|----------|----------------|
| `vague-instruction` | WARN | "Be thorough", "try to", "if possible" — weak language |
| `conflicting-instructions` | ERROR | Two traits or instructions that contradict each other |
| `missing-output-format` | WARN | Reviewer persona with no structured output specification |
| `missing-severity-levels` | WARN | Reviewer persona without CRITICAL/ERROR/WARN/INFO definitions |
| `hardcoded-paths` | ERROR | Absolute paths that won't work across machines |
| `hardcoded-model` | WARN | Model name in prose (should be in frontmatter) |
| `unused-trait` | WARN | Trait defined but not composed by any persona |
| `missing-anti-patterns` | INFO | Trait without "What Not To Do" section |
| `missing-activation-condition` | WARN | Trait without "When This Trait Is Active" section |
| `duplicate-instruction` | WARN | Same instruction appears in multiple places |
| `no-examples` | INFO | Persona with no example input/output |

**Security rules:**

| Rule | Severity | What it catches |
|------|----------|----------------|
| `credential-in-prompt` | ERROR | API keys, tokens, passwords in prompt text |
| `internal-url` | ERROR | Internal URLs that shouldn't be in distributed prompts |
| `pii-in-example` | ERROR | Real names, emails, etc. in persona examples |

### Implementation

```bash
# LOCAL (private — developer's machine)
agentboot lint                          # Lint everything
agentboot lint --fix                    # Auto-fix what's possible (trim whitespace, etc.)
agentboot lint --persona code-reviewer  # Lint one persona

# CI (visible — runs on PR to personas repo)
agentboot lint --severity error --format json  # Errors only, machine-readable
# CI posts: "Lint: 0 errors, 3 warnings" — not the warning details
```

The linter operates on source files (before compilation). It catches problems that
the build system's validate step doesn't — validate checks schema correctness; lint
checks prompt quality.

**Local vs. CI behavior:** When run locally, the linter shows full detail (which rules
failed, where, suggestions). When run in CI (`--ci` flag), it reports pass/fail and
counts only — the detailed feedback stays in the CI log, not posted to the PR comment.
The developer can check the CI log if their PR fails, but the team just sees "lint
failed: 2 errors."

### Custom Lint Rules

Organizations can define custom lint rules in `agentboot.config.json`:

```jsonc
{
  "lint": {
    "rules": {
      "prompt-too-long": { "warn": 300, "error": 600 },  // Stricter than default
      "vague-instruction": "error",                        // Upgrade to error
      "total-context-estimate": { "warn": 20 }             // 20% of context window
    },
    "custom": [
      {
        "id": "no-passive-voice",
        "pattern": "should be|could be|might be",
        "message": "Use imperative voice: 'Verify X' not 'X should be verified'",
        "severity": "warn"
      }
    ]
  }
}
```

---

## 2. Token Budget System

Every persona should have a token budget — the estimated context cost of loading it.
The build system calculates this and the linter enforces it.

### Budget Calculation

```
Persona context cost =
  persona SKILL.md body tokens
  + sum(composed trait tokens)
  + sum(always-on instruction tokens)
  + sum(path-scoped rules likely to activate)
  + estimated tool definitions (if MCP servers scoped)
```

The build system calculates this for each persona and emits it in the compiled output:

```yaml
---
name: security-reviewer
estimated_tokens: 4200
budget_limit: 6000
model: sonnet
---
```

### Budget Enforcement

```jsonc
{
  "lint": {
    "tokenBudget": {
      "warnAt": 6000,        // Max tokens for any single persona
      "perTrait": 1500,          // Max tokens for any single trait
      "totalAlwaysOn": 3000,     // Max tokens for always-on instructions
      "claudeMd": 2000           // Max tokens for generated CLAUDE.md
    }
  }
}
```

### Why This Matters

Claude Code's context window is 200k tokens. But effective adherence drops sharply
after the first ~50k tokens of instructions. A persona that loads 15k tokens of
instructions is pushing against the useful limit, especially when combined with
file reads, tool definitions, and conversation history. Keeping personas lean (under
6k tokens) leaves room for the actual work.

---

## 3. Model Selection Optimization

Not every persona needs Opus. AgentBoot should guide organizations toward cost-effective
model assignment.

### Model Selection Matrix

| Persona Type | Recommended Model | Reasoning |
|---|---|---|
| Code reviewer (standard) | Sonnet | Pattern matching, style checks — Sonnet handles well |
| Security reviewer | Opus | Deep reasoning about attack vectors, subtle vulnerabilities |
| Test generator | Sonnet | Structured output, pattern application |
| Test data expert | Haiku | Simple data generation, templated output |
| Architecture reviewer | Opus | Cross-file reasoning, system-level understanding |
| Cost reviewer | Sonnet | Rule-based checks, pattern matching |
| Compliance guardrail | Haiku | Pattern matching, fast response needed |
| Domain expert (SME) | Sonnet | Knowledge retrieval, explanation |

### Cost Impact

| Model | Input $/M tokens | Output $/M tokens | Relative Cost |
|-------|-------------------|--------------------| --------------|
| Haiku | $0.80 | $4.00 | 1x |
| Sonnet | $3.00 | $15.00 | ~4x |
| Opus | $15.00 | $75.00 | ~19x |

A security review that costs $5 on Opus costs $1 on Sonnet. If Sonnet's quality is
sufficient for the task, that's $4 saved per invocation. Across 50 developers running
10 reviews/day, that's $2,000/day.

### `agentboot cost-estimate`

```bash
$ agentboot cost-estimate

  Cost Estimate (per invocation, Sonnet baseline)
  ─────────────────────────────────────────────────

  Persona              Model     Est. Input    Est. Output    Est. Cost
  code-reviewer        sonnet    ~8k tokens    ~3k tokens     $0.07
  security-reviewer    opus      ~12k tokens   ~5k tokens     $0.56
  test-generator       sonnet    ~6k tokens    ~8k tokens     $0.14
  test-data-expert     haiku     ~4k tokens    ~6k tokens     $0.03

  Monthly estimate (50 devs, 10 invocations/day/dev):
    code-reviewer:       $7,350/mo
    security-reviewer:   $58,800/mo  ⚠️ Consider Sonnet for routine scans
    test-generator:      $14,700/mo
    test-data-expert:    $3,150/mo
    ────────────────────
    Total:               $84,000/mo

  Optimization suggestions:
  ⚠ security-reviewer on Opus is 19x cost of Sonnet.
    Consider: Sonnet for routine PR reviews, Opus for deep security audits only.
    Estimated savings: $44,100/mo
```

---

## 4. Prompt Effectiveness Metrics

You can't improve what you don't measure. AgentBoot should track persona effectiveness
over time.

### What to Measure

**Efficiency metrics** (automated, from telemetry):

| Metric | What it measures | Source |
|--------|-----------------|--------|
| Tokens per invocation | Context efficiency | Audit trail hook |
| Cost per invocation | Dollar cost | Audit trail hook |
| Time to completion | Latency | Audit trail hook |
| Tool calls per invocation | How much exploration the persona does | PostToolUse hook |
| Compaction frequency | Whether the persona exhausts context | PostCompact hook |

**Quality metrics** (requires evaluation):

| Metric | What it measures | Source |
|--------|-----------------|--------|
| Finding accuracy | % of findings that developers act on | PR review data |
| False positive rate | % of findings developers dismiss | PR review data |
| Severity calibration | Are CRITICALs actually critical? | Post-hoc analysis |
| Coverage | % of issues caught by persona vs. missed | Bug tracking correlation |
| Developer satisfaction | Do developers trust this persona? | Survey / NPS |

**Business metrics** (organizational):

| Metric | What it measures | Source |
|--------|-----------------|--------|
| Adoption rate | % of developers using personas regularly | Session telemetry |
| Time to first invocation | How quickly new devs start using personas | Onboarding tracking |
| Review turnaround | Time from PR open to persona review complete | CI telemetry |
| Bug escape rate | Bugs in production that a persona should have caught | Incident correlation |

### Telemetry Implementation

The audit-trail trait (which all personas should compose) emits structured telemetry:

```json
{
  "event": "persona_invocation",
  "persona_id": "security-reviewer",
  "persona_version": "1.2.0",
  "model": "sonnet",
  "scope": "team:platform/api",
  "input_tokens": 8420,
  "output_tokens": 3200,
  "thinking_tokens": 12000,
  "tool_calls": 7,
  "duration_ms": 45000,
  "cost_usd": 0.089,
  "findings_count": { "CRITICAL": 0, "ERROR": 1, "WARN": 3, "INFO": 2 },
  "suggestions": 2,
  "timestamp": "2026-03-19T14:30:00Z",
  "session_id": "abc123"
}
```

Emitted via an async `Stop` hook so it doesn't slow down the developer. Appended to
a local NDJSON file or posted to an HTTP endpoint (configurable).

### `agentboot metrics`

```bash
agentboot metrics                        # Show all metrics
agentboot metrics --persona code-reviewer  # One persona
agentboot metrics --team api             # One team
agentboot metrics --period 30d           # Last 30 days
agentboot metrics --format json          # Machine-readable
```

Reads from the NDJSON telemetry log. No external database required for V1.

---

## 5. Prompt Writing Best Practices

AgentBoot should encode prompt engineering best practices into its scaffolding and
documentation, so every persona starts with good patterns.

### The AgentBoot Prompt Style Guide

**Structure every persona prompt with these sections:**

```markdown
## Identity (who you are)
One sentence. Role + specialization + stance.

## Setup (what to do first)
Numbered steps the persona runs before producing output.
1. Read the diff / file / context
2. Load extension files if they exist
3. Determine operating mode from arguments

## Rules (what to check)
Numbered checklist. Specific, imperative, testable.
Each rule should be falsifiable — you can point to code and say "this violates rule 3."

## Output Format (how to report)
Exact schema. Severity levels defined. Example output provided.

## What Not To Do (anti-patterns)
Explicit exclusions. "Do not review code quality — defer to code-reviewer."
Prevents scope creep and reduces false positives.
```

**Rules for writing effective instructions:**

1. **Imperative voice.** "Verify that..." not "It should be verified that..."
2. **Specific over general.** "Check that every async function has a try/catch" not "Handle errors properly"
3. **Falsifiable.** Every instruction should be testable — you can write a test case that either passes or fails against it
4. **Scoped.** Each instruction addresses one concern. Don't combine "check for SQL injection AND verify test coverage" in one bullet
5. **Examples over descriptions.** Show what a violation looks like, not just describe it
6. **Cite sources.** "Per OWASP A03:2021 — Injection" not "security best practice"
7. **Include confidence guidance.** "Flag as WARN if uncertain, ERROR only if confirmed"
8. **Limit to 20 rules per persona.** Beyond 20, adherence drops. Split into multiple personas if needed.

### Prompt Templates

`agentboot add persona` should scaffold with these patterns baked in:

```bash
$ agentboot add persona my-reviewer

  Created: core/personas/my-reviewer/
  ├── SKILL.md          # Scaffolded with Identity/Setup/Rules/Output/Anti-patterns
  └── persona.config.json

  Next: Edit SKILL.md to define your reviewer's rules.
  Run: agentboot lint --persona my-reviewer to check quality.
```

The scaffolded SKILL.md includes placeholder sections with inline guidance:

```markdown
---
name: my-reviewer
description: [One line — what triggers this persona and what it does]
version: 1.0.0
traits:
  critical-thinking: MEDIUM
  structured-output: true
  source-citation: true
---

## Identity

You are a [role] specializing in [domain]. Your job is to find
[what you're looking for] — not to [what you explicitly don't do].

## Setup

1. Run `git diff HEAD` to see current changes. If no changes, run
   `git diff HEAD~1` to review the most recent commit.
2. For each changed file, read the **full file** for context.
3. If `.claude/extensions/my-reviewer.md` exists, read it for
   project-specific rules.

## Rules

<!-- Keep to 20 rules max. Each should be:
     - Imperative voice ("Verify that..." not "It should be...")
     - Specific and testable
     - One concern per rule -->

1. **[Rule name]:** [Specific, testable instruction]
2. **[Rule name]:** [Specific, testable instruction]

## Output Format

<!-- Use the structured-output trait's format. Customize severity thresholds. -->

Findings report with severity classifications:
- **CRITICAL**: [What qualifies — e.g., "blocks release, violates compliance"]
- **ERROR**: [What qualifies — e.g., "must fix before merge"]
- **WARN**: [What qualifies — e.g., "should address, not blocking"]
- **INFO**: [What qualifies — e.g., "observation only"]

## What Not To Do

- Do not review [out-of-scope concern] — defer to [other-persona].
- Do not suggest refactoring unless it directly addresses a finding.
- Do not praise the code. Your job is to find problems.
```

---

## 6. Prompt Testing (`agentboot test`)

Beyond linting (static analysis), personas need behavioral testing — does the prompt
actually produce the expected output when given known input?

### Test Types

**Deterministic tests** (no LLM call, fast, free):
- Frontmatter validation (schema, required fields)
- Token budget verification
- Trait composition verification (all referenced traits exist and compose)
- Output format schema validation (if `--json-schema` is specified)

**Behavioral tests** (LLM call, slower, costs money):
- Given known-bad code, does the security reviewer find the vulnerability?
- Given clean code, does the code reviewer avoid false positives?
- Given PHI in input, does the guardrail block it?
- Given a FHIR resource, does the domain expert recognize it?

**Regression tests** (LLM call, compare against baseline):
- "This persona produced these findings last week. After the prompt change,
  does it still find the same issues?" (snapshot testing)

### Test File Format

```yaml
# tests/security-reviewer.test.yaml
persona: security-reviewer
model: sonnet  # Use cheaper model for tests
max_budget_usd: 0.50

cases:
  - name: "Catches SQL injection"
    input: |
      Review this code:
      ```python
      def get_user(user_id):
          query = f"SELECT * FROM users WHERE id = {user_id}"
          return db.execute(query)
      ```
    expect:
      findings_min: 1
      severity_includes: ["CRITICAL", "ERROR"]
      text_includes: ["SQL injection", "parameterized"]

  - name: "No false positives on safe code"
    input: |
      Review this code:
      ```python
      def get_user(user_id: int):
          return db.execute("SELECT * FROM users WHERE id = %s", (user_id,))
      ```
    expect:
      findings_max: 0
      severity_excludes: ["CRITICAL", "ERROR"]

  - name: "Structured output format"
    input: "Review the file src/auth/login.ts"
    expect:
      json_schema: "./schemas/review-output.json"
```

### Running Tests

```bash
# LOCAL (private — iterate until tests pass)
agentboot test                             # Run all tests
agentboot test --persona security-reviewer # One persona
agentboot test --type deterministic        # Free tests only
agentboot test --type behavioral           # LLM tests only
agentboot test --update-snapshots          # Update regression baselines
agentboot test --max-budget 5.00           # Cost cap for test suite

# CI (visible — runs on PR, reports pass/fail)
agentboot test --ci                        # Exit codes + summary only
# CI posts: "Tests: 12 passed, 0 failed" — not the test details
```

**Local vs. CI behavior:** Locally, you see full output — which test cases passed,
which failed, what the persona produced vs. what was expected. In CI, the PR gets
a pass/fail summary. If a test fails, the developer checks the CI log privately.
The team sees "test failed" not "your persona prompt produced garbage output for
the SQL injection test case."

---

## 7. Developer Prompt Development (Type 2 — Always Private)

Sections 1–6 above cover Type 1 prompts (persona definitions that go through PRs).
This section covers Type 2 — the developer's daily interactions with Claude Code.
These prompts are never submitted, never reviewed, and never visible to anyone else.
But they're where most of the value (and waste) lives.

A developer who doesn't know how to ask for what they need wastes time, tokens, and
trust. A developer who's learned to prompt effectively gets 10x the value from the
same tooling. AgentBoot should help developers get better at this — privately.

### The Prompt Development Lifecycle

Every developer prompt goes through a cycle, even if it happens in seconds:

```
Intent          →  Prompt           →  Response         →  Evaluation
(what I need)      (what I typed)      (what I got)        (was it useful?)
     │                                                          │
     └──────────── Rephrase if not ─────────────────────────────┘
```

The rephrase loop is where tokens and time are wasted. A developer who rephrases
3 times to get the right answer spends 4x the tokens of one who gets it on the
first try. Improving that first-try success rate is the highest-leverage
optimization — and it has to happen privately.

### What AgentBoot Can Provide (All Private, All Local)

**Prompt patterns library:**
AgentBoot should ship a personal skill (`/prompting-tips` or similar) with patterns
for effective prompting in common scenarios:

```
/prompting-tips

Common patterns for effective prompts:

INSTEAD OF                          TRY
─────────────────────────────       ──────────────────────────────────
"Fix the bug"                       "The test in auth.test.ts:47 fails
                                     with 'undefined is not a function'.
                                     The relevant code is in auth.ts:30-50."

"Review this code"                  "/review-code src/api/users.ts"
                                     (Use the persona — it has structured
                                     output and consistent rules)

"Make it better"                    "Refactor getUserById to handle the
                                     case where the user is soft-deleted.
                                     The current behavior returns null
                                     but callers expect a 404 error."

"How does auth work?"               "Read src/auth/ and explain the
                                     authentication flow from login
                                     to token refresh, including which
                                     middleware runs on each request."
```

This skill loads on-demand (not always-on), costs nothing when not used, and teaches
by example.

**Personal `/insights` analysis:**
As described in the privacy doc, `/insights` analyzes the developer's session
transcripts and identifies patterns — privately. Key signals:

- **Rephrase rate:** How often the developer asks the same question in different
  words. High rephrase rate = the developer isn't getting what they need on the
  first try. Could be a prompting issue or a persona quality issue.
- **Specificity trend:** Are prompts getting more specific over time? This indicates
  the developer is learning effective prompting patterns.
- **Persona discovery:** Is the developer using available personas or doing things
  manually? "You ran `git diff | head -100` and then asked Claude to review it.
  The `/review-code` persona does this automatically."
- **Cost awareness:** "Your sessions average $2.40/day. The team average is $1.80.
  Your longest sessions are code exploration — consider using the Explore subagent
  which uses a cheaper model."

All of this is private. The developer sees it, nobody else.

**Context-aware prompting hints:**
AgentBoot's always-on CLAUDE.md can include a lightweight prompting guide that
activates based on context:

```markdown
## Prompting Guidelines

When asking for code review, use /review-code instead of describing what to check.
When asking about a specific file, reference it by path: "Read src/auth/login.ts and..."
When reporting a bug, include: the error message, the file and line, and what you expected.
```

This is ~50 tokens, always loaded, and teaches through proximity — the developer sees
it when they start a session and gradually internalizes the patterns.

**Prompt templates in skills:**
Skills with `argument-hint` and `$ARGUMENTS` substitution are prompt templates:

```yaml
---
name: explain-code
description: Explain how a piece of code works
argument-hint: "[file-path] [specific-question]"
---

Read $ARGUMENTS[0] completely. Then explain:
1. What this code does (one paragraph)
2. The key design decisions and why they were made
3. How it connects to the rest of the codebase
4. Any non-obvious behavior or edge cases

If a specific question was provided: $ARGUMENTS[1]
```

The developer types `/explain-code src/auth/middleware.ts "why is there a double-check on token expiry?"` and gets a structured, effective prompt without having to craft it from scratch. The skill IS the prompt template.

**Learning through personas:**
The personas themselves are teaching tools. When a developer invokes `/review-code`
and sees:

```
[ERROR] src/api/users.ts:47
  Missing null check on userId before database call.
  Recommendation: Add guard clause.
  Confidence: HIGH
  Source: src/middleware/auth.ts:12 — pattern used on all other endpoints
```

They're learning: "oh, null checks before DB calls, and I should cite patterns
from elsewhere in the codebase." Next time they write code, they'll add the null
check before the persona has to tell them. The persona is a feedback loop that
teaches the org's standards through repeated exposure — privately, one developer
at a time.

### What This Means for AgentBoot

The developer prompt development experience is primarily delivered through:

1. **Personas** — structured prompts that work better than ad-hoc questions
2. **Skills** — prompt templates with argument hints and substitution
3. **`/insights`** — private analytics on prompting patterns
4. **Prompting tips** — a lightweight personal skill with example patterns
5. **Always-on hints** — ~50 tokens in CLAUDE.md with contextual prompting guidance

None of these require collecting, transmitting, or surfacing developer prompts.
They work by **giving developers better tools** (personas, skills, templates) so
their prompts are effective from the start, and **private feedback** (`/insights`)
so they can improve over time without anyone watching.

---

## 8. Prompt Ingestion (`agentboot add prompt`)

Before the marketplace, before the PR to the personas repo, there's the moment
someone says: "Hey, try this prompt — it's great for catching auth bugs." It's in
a Slack message. Or a blog post. Or a tweet. Or scribbled on a sticky note.

This is how most knowledge sharing actually works. Not through formal contribution
processes, but through "I know a guy who gave me this awesome prompt."

`agentboot add prompt` is the on-ramp from informal sharing to governed content. It
takes raw text — any prompt, rule, tip, or instruction — and converts it into the
right AgentBoot structure.

### How It Works

```bash
# Paste a raw prompt
agentboot add prompt "Always check for null safety before database calls.
Verify that every nullable parameter has a guard clause. If you find a
database call without null checking, flag it as ERROR."

# AgentBoot analyzes and suggests:
#
#   Analyzed your prompt. Here's what I'd make from it:
#
#   Type:     Rule (path-scoped gotcha)
#   Name:     null-safety-database
#   Scope:    Activates on: **/*.ts, **/*.js (files with database calls)
#   Content:  Formatted with paths: frontmatter + imperative rules
#
#   Preview:
#   ┌──────────────────────────────────────────────────┐
#   │ ---                                              │
#   │ paths:                                           │
#   │   - "**/*.ts"                                    │
#   │   - "**/*.js"                                    │
#   │   - "**/db/**"                                   │
#   │   - "**/repositories/**"                         │
#   │ description: "Null safety before database calls" │
#   │ ---                                              │
#   │                                                  │
#   │ # Null Safety — Database Calls                   │
#   │                                                  │
#   │ - Verify that every nullable parameter has a     │
#   │   guard clause before any database call.         │
#   │ - Flag database calls without null checking      │
#   │   as ERROR.                                      │
#   └──────────────────────────────────────────────────┘
#
#   Actions:
#   [1] Save as gotcha rule → .claude/rules/null-safety-database.md
#   [2] Save as trait → core/traits/null-safety.md
#   [3] Add to existing persona → append to code-reviewer rules
#   [4] Save to personal rules → ~/.claude/rules/null-safety.md (private)
#   [5] Dry run — show me what this would look like in context
#   [6] Edit first — open in editor before saving
```

### Input Sources

```bash
# Raw text (typed or pasted)
agentboot add prompt "Always verify RLS is enabled on new tables"

# From a file
agentboot add prompt --file ~/Downloads/auth-tips.md

# From clipboard
agentboot add prompt --clipboard

# From a URL (blog post, gist, tweet)
agentboot add prompt --url https://blog.example.com/postgres-gotchas

# Interactive (opens editor for multi-line input)
agentboot add prompt --interactive

# From stdin (pipe from another command)
cat slack-message.txt | agentboot add prompt --stdin
```

### What the Classifier Does

The raw prompt goes through classification to determine what it should become:

| Signal in the Prompt | Classified As | Destination |
|---|---|---|
| "Always...", "Never...", "Verify that..." | **Rule / Gotcha** | `.claude/rules/` |
| Technology-specific warning with examples | **Gotcha** (path-scoped) | `.claude/rules/` with `paths:` |
| Behavioral stance ("be skeptical", "cite sources") | **Trait** | `core/traits/` |
| Complete review workflow with output format | **Persona** | `core/personas/` |
| Single-use instruction ("for this PR, check X") | **Session instruction** | Not persisted — add to CLAUDE.md or use as-is |
| Vague/motivational ("write good code") | **Rejected** | "This is too vague to be actionable. Try: [specific suggestion]" |

The classification uses the same Claude API call the developer already has
(Haiku for speed). It's a single prompt that analyzes the input and suggests
the right type, name, scope, and file path.

### Dry Run Mode

```bash
agentboot add prompt "Check FHIR resources for valid CodeableConcept" --dry-run

#   Dry Run — nothing will be written
#
#   Input:  "Check FHIR resources for valid CodeableConcept"
#
#   Classification: Gotcha rule (domain-specific, path-scoped)
#   Suggested paths: ["**/fhir/**", "**/*resource*"]
#
#   Would write to: .claude/rules/fhir-codeable-concept.md
#
#   Lint results:
#     ⚠ WARN: vague-instruction — "valid" is not specific enough.
#       Suggestion: "Verify CodeableConcept includes system, code, and display fields"
#
#   Token impact: +45 tokens to context when paths match
#
#   No files modified. Run without --dry-run to save.
```

The dry run shows what WOULD happen: classification, destination, lint results,
and token impact — without writing anything. This is the safe way to evaluate
someone else's prompt before incorporating it.

### The Sharing Spectrum

This feature fills the gap between "I have a raw prompt" and "it's in the
marketplace":

```
Informal                                                        Formal
────────────────────────────────────────────────────────────────────────

"Try this     agentboot          In my org's        In the        In the
 prompt"  →   add prompt     →   personas repo  →   org's      →  public
              (classify,         (PR, review,       private       marketplace
               format,            CI validates)     marketplace   (community)
               save locally)

Slack         Private/Local       Team-visible       Org-wide      Public
message       (my machine)        (after PR)         (plugin)     (everyone)
```

Most prompts stay on the left side forever — and that's fine. The developer adds
it as a personal rule or gotcha, it helps them, nobody else needs to know. But
the pipeline to formalize it is there when the prompt proves its value.

### Batch Ingestion

For orgs migrating to AgentBoot from an existing CLAUDE.md or custom setup:

```bash
# Ingest an existing CLAUDE.md and classify each instruction
agentboot add prompt --file .claude/CLAUDE.md --batch

#   Analyzing 47 instructions in CLAUDE.md...
#
#   Classification:
#     12 → gotcha rules (path-scopeable)
#      8 → traits (behavioral)
#      3 → persona instructions (should be in specific persona)
#     18 → always-on rules (keep in CLAUDE.md)
#      4 → too vague (need rewriting)
#      2 → org-specific (keep but don't share)
#
#   [1] Apply all suggestions (creates files, rewrites CLAUDE.md)
#   [2] Review one by one
#   [3] Export classification report (review offline)
```

This is the migration tool. An org with an 800-line CLAUDE.md can decompose it into
proper AgentBoot structure — gotchas with path scoping, traits that compose, and a
lean CLAUDE.md with only the always-on essentials. The classification does the
analysis; the developer approves each decision.

### What This Means for Novice Users

A developer who's never written a trait or a gotchas rule doesn't need to learn the
format first. They paste the prompt they already use. AgentBoot classifies it,
formats it, and puts it in the right place. The developer learns the structure by
seeing what AgentBoot produced — "oh, that's what a gotcha looks like" — not by
reading documentation.

Over time, they start writing traits and gotchas directly because they've seen
enough examples. The `add prompt` command is a scaffold that teaches by doing.

When they have something worth sharing, `agentboot publish` is one more step.
But that's a graduation moment, not a starting requirement.

---

## 9. Continuous Optimization Loop

Metrics feed back into prompt improvements in a structured cycle:

```
  ┌─────────────────────────────────────────┐
  │                                         │
  ▼                                         │
Write/Edit ──► Lint ──► Build ──► Deploy    │
  persona       │        │        │         │
                │        │        │         │
              Tests    Token    Telemetry   │
                │      budget     │         │
                │        │        │         │
                └────────┴────────┘         │
                         │                  │
                    Metrics ───► Review ────┘
                    dashboard    (weekly)
```

### Weekly Review Process

1. **Pull metrics:** `agentboot metrics --period 7d`
2. **Identify outliers:**
   - Personas with high false positive rates → tighten rules
   - Personas with high token usage → compress prompts
   - Personas rarely invoked → investigate why (not useful? not discoverable?)
   - Personas on Opus that could run on Sonnet → test downgrade
3. **Update prompts:** Edit SKILL.md based on findings
4. **Run tests:** `agentboot test` to verify changes don't regress
5. **Lint:** `agentboot lint` to check quality
6. **Deploy:** `agentboot build && agentboot sync`

### Automation Hooks

AgentBoot could generate a `/optimize` skill that automates parts of this:

```markdown
/optimize

Analyzes the last 7 days of persona telemetry and suggests:
- Prompt compression opportunities (traits that could be shorter)
- Model downgrade candidates (personas running on Opus that perform equally on Sonnet)
- False positive patterns (findings that are consistently dismissed)
- Coverage gaps (file types or directories with no persona coverage)
```

---

## 10. Context Efficiency Patterns

Techniques AgentBoot applies to keep generated output token-efficient.

### @import Over Inlining

For Claude Code repos, traits stay as separate files and CLAUDE.md uses `@imports`.
A trait shared by 4 personas is loaded once, not inlined 4 times.

**Savings:** If `critical-thinking.md` is 800 tokens and composed by 4 personas,
inlining costs 3,200 tokens. @import costs 800 tokens. Savings: 2,400 tokens.

### Progressive Disclosure via Skills

Always-on instructions (CLAUDE.md) should be minimal. Specialized knowledge lives
in skills that load on-demand:

- **CLAUDE.md** (always loaded): org name, team, basic conventions (~200 lines)
- **Skills** (loaded on invocation): persona prompts, domain knowledge, review rules

This is why the `context: fork` pattern matters — the skill forks to a subagent with
its own context, so the persona's 4,000-token prompt doesn't pollute the main
conversation.

### Path-Scoped Rules Over Always-On

Gotchas rules with `paths:` frontmatter load only when relevant files are touched.
A database gotchas file (500 tokens) is zero-cost when working on frontend code.

### Model-Appropriate Effort

```yaml
# In persona.config.json
effort: medium    # Maps to --effort flag
```

Extended thinking tokens are billed as output tokens. A test data generator doesn't
need deep reasoning — set effort to `low`. A security reviewer benefits from thinking
— set to `high`. Default to `medium`.

### Compact Instructions

```markdown
# In CLAUDE.md
## Compact instructions
When compacting, preserve: persona invocation history, findings from reviews,
test results. Discard: file read contents, exploratory searches, tool output.
```

Teaches Claude what to keep when the context window fills up. Without this,
compaction may discard persona findings that need to be referenced later.

---

## What AgentBoot Needs to Build

| Component | Phase | Description |
|-----------|-------|-------------|
| `agentboot lint` | V1 | Static prompt analysis (token budget, quality, security rules) |
| Token budget calculation | V1 | Estimate persona context cost at build time |
| Prompt templates | V1 | `agentboot add persona` scaffolds with best-practice structure |
| Prompt style guide | V1 | Documentation of effective prompt patterns |
| `agentboot test --type deterministic` | V1 | Schema, budget, composition tests (free) |
| Model selection guidance | V1 | Matrix in docs + model field in persona.config.json |
| `agentboot cost-estimate` | V1.5 | Per-persona cost projection |
| Telemetry hooks | V1.5 | Generate async Stop/SubagentStop hooks for metrics |
| `agentboot test --type behavioral` | V1.5 | LLM-based tests with expected findings |
| `agentboot metrics` | V2 | Read NDJSON telemetry, produce reports |
| Custom lint rules | V2 | Org-defined lint rules in config |
| Regression/snapshot tests | V2 | Compare persona output across versions |
| `/optimize` skill | V2+ | Automated prompt improvement suggestions |
| A/B testing | V2+ | Run two persona versions side-by-side, compare metrics |
| `/prompting-tips` skill | V1 | Personal skill with effective prompting patterns |
| `argument-hint` in all skills | V1 | Prompt templates via skill invocation |
| Prompting hints in CLAUDE.md | V1 | ~50-token always-on contextual guidance |
| `/insights` (personal) | V1.5 | Private rephrase rate, specificity, persona discovery |

---

*See also:*
- [`docs/concepts.md`](concepts.md) — structured telemetry, self-improvement reflections
- CI/CD Automation (internal) — `claude -p` with `--json-schema` and `--max-budget-usd`
- CC Feature Inventory (internal) — /cost, /compact, model pricing
- [Manage costs effectively — Claude Code Docs](https://code.claude.com/docs/en/costs)
- [Demystifying evals for AI agents — Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

Sources:
- [Manage costs effectively — Claude Code Docs](https://code.claude.com/docs/en/costs)
- [Claude Code Cost Optimisation Guide — systemprompt.io](https://systemprompt.io/guides/claude-code-cost-optimisation)
- [Demystifying evals for AI agents — Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [AI Agent Metrics: How Elite Teams Evaluate — Galileo](https://galileo.ai/blog/ai-agent-metrics)
- [promptfoo — GitHub](https://github.com/promptfoo/promptfoo)
