# Developer Onboarding — Agentic Training Assist

Lightweight help for developers who are new to agentic development. Not an LMS.
Not a course. Just the right tip at the right moment, plus a curated path for
people who want to go deeper.

---

## Why This Matters

The #1 barrier to agentic adoption is not tooling — it's humans.

- Developer installs Claude Code. Opens it. Types "help me". Gets a wall of text.
  Closes it. Goes back to their IDE. **Lost them.**
- Developer tries `/review-code`. Gets findings they don't understand. Doesn't know
  how to act on them. Stops using it. **Lost them.**
- Developer sees a colleague get 10x value from AI. Tries to replicate it. Types
  vague prompts. Gets vague results. Concludes "AI doesn't work for me." **Lost them.**

AgentBoot personas are useless if developers don't know how to work with them.
A small investment in onboarding — the right tip at the right time — pays for
itself in adoption.

---

## What AgentBoot Provides (Not What It Builds)

> **Note:** This document describes the planned onboarding experience. Items marked
> with a phase in the "What AgentBoot Needs to Build" table at the end are not yet
> implemented. The designs here guide implementation.

AgentBoot is not an LMS. It doesn't build courses, track completions, or issue
certificates. It provides **contextual assists** — tips that appear when and where
they're useful — and **curated links** to external resources for people who want depth.

### 1. First-Session Orientation

When a developer first opens Claude Code in a repo with AgentBoot personas, they
see a brief orientation. This is generated as part of the CLAUDE.md that AgentBoot
syncs:

```markdown
## Welcome — Quick Start

This repo uses AgentBoot personas for code review, security, and testing.

Try these now:
  /review-code          Review your current changes
  /review-security      Security-focused review
  /gen-tests            Generate tests for a file

Tips:
  - Be specific: "/review-code src/auth/login.ts" beats "/review-code"
  - Personas give structured findings (CRITICAL/ERROR/WARN/INFO)
  - You can ask follow-up questions about any finding
  - Your conversations are private (see privacy policy)

New to AI coding tools? Run: /learn
```

This is ~80 tokens. It's in the CLAUDE.md so it loads once per session. After a
developer has seen it a few times, it fades into background context (Claude still
knows about it but doesn't repeat it unsolicited).

### 2. `/learn` Skill — Contextual Training

A skill that provides tips based on what the developer is doing right now. Not a
static tutorial — a context-aware assistant.

```yaml
---
name: learn
description: Tips and guidance for working with AI coding tools and AgentBoot personas
argument-hint: "[topic]"
disable-model-invocation: true
---
```

```
$ /learn

  What would you like to learn about?

  Getting Started
  ├── How to write effective prompts
  ├── How code review personas work
  ├── How to read persona findings
  └── Your first AI-assisted PR

  Going Deeper
  ├── Customizing personas for your team
  ├── Writing your own gotchas rules
  ├── Understanding traits and composition
  └── Cost optimization tips

  Quick Reference
  ├── All available personas (what each one does)
  ├── Keyboard shortcuts
  ├── Privacy model (what's private, what's not)
  └── Getting help

  Or ask me anything: /learn how do I review only one file?
```

```
$ /learn how do I review only one file?

  To review a specific file:

    /review-code src/auth/login.ts

  You can also review a specific function:

    "Review the getUserById function in src/services/user-service.ts
     for null safety and error handling"

  Tip: specific requests give better results. Instead of reviewing an
  entire file, point to what changed or what concerns you:

    "I just added rate limiting to the login endpoint. Review my
     implementation in src/api/auth-controller.ts lines 45-80"
```

```
$ /learn how do I read persona findings?

  Persona findings use severity levels:

  CRITICAL  Something that blocks release or violates compliance.
            Action: Stop. Fix immediately.
            Example: "SQL injection vulnerability in user input handling"

  ERROR     Must fix before merge. A bug or significant issue.
            Action: Fix before opening PR.
            Example: "Missing null check before database call"

  WARN      Should address but not blocking. A concern worth noting.
            Action: Consider fixing. OK to merge with justification.
            Example: "Error handler swallows the exception silently"

  INFO      Observation. Not a problem.
            Action: Read and acknowledge. No fix needed.
            Example: "This function could be simplified with optional chaining"

  Each finding includes:
  - Location (file:line)
  - Description (what's wrong)
  - Suggestion (how to fix)
  - Confidence (HIGH/MEDIUM/LOW — how sure the persona is)
  - Citation (where the rule comes from)

  If you disagree with a finding, you can ask: "Explain why this is an ERROR.
  I think this is intentional because..."
  The persona will either clarify or acknowledge the exception.
```

### 3. Contextual Tips (Passive, Low-Cost)

AgentBoot can generate optional tips that appear in persona output when the system
detects patterns suggesting the developer is new:

**First invocation of a persona:**
```
[INFO] First time using /review-code? Tip: ask follow-up questions about
any finding. "Why is this an ERROR?" or "Show me how to fix this."
```

**Developer types a vague prompt:**
```
[TIP] Your prompt "review this" could be more effective as:
"Review src/api/users.ts for the changes I made to the pagination logic."
Specific prompts → specific, useful findings.
```

**Developer rephrases the same question:**
```
[TIP] You might be looking for a more specific answer. Try:
- Pointing to a specific file or function
- Describing what you expected vs. what happened
- Asking for an example instead of an explanation
```

These tips are:
- Generated by the persona itself (part of the persona prompt, not a separate system)
- Triggered by pattern matching, not surveillance
- Rate-limited (show max 1 tip per session to avoid annoyance)
- Disable-able by the developer (`/config` → tips: off)

### 4. Curated External Resources

AgentBoot doesn't build training content. It curates links to the best existing
resources, organized by skill level.

```
$ /learn resources

  Curated Resources for Agentic Development
  ──────────────────────────────────────────

  Beginner (start here)
  ├── Anthropic: "Getting Started with Claude Code"
  │   https://code.claude.com/docs/en/quickstart
  ├── Anthropic: "Common Workflows"
  │   https://code.claude.com/docs/en/common-workflows
  └── AgentBoot: "Getting Started"
      docs/getting-started.md

  Intermediate
  ├── Anthropic: "Using CLAUDE.md Files"
  │   https://claude.com/blog/using-claude-md-files
  ├── Anthropic: "Skills and Agent Skills"
  │   https://code.claude.com/docs/en/skills
  ├── systemprompt.io: "Claude Code Organisation Rollout Playbook"
  │   https://systemprompt.io/guides/claude-code-organisation-rollout
  └── AgentBoot: "Extending with Domain Layers"
      docs/extending.md

  Advanced
  ├── Anthropic: "Hooks Reference"
  │   https://code.claude.com/docs/en/hooks
  ├── Anthropic: "Demystifying Evals for AI Agents"
  │   https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
  ├── Trail of Bits: "Claude Code Config"
  │   https://github.com/trailofbits/claude-code-config
  └── AgentBoot: "Claude Code Feature Inventory"
      docs/claude-code-reference/feature-inventory.md

  Cost Management
  └── Anthropic: "Manage Costs Effectively"
      https://code.claude.com/docs/en/costs
```

This list lives in a skill (updatable without rebuilding) and links to external
resources so AgentBoot doesn't have to maintain training content.

### 5. Team Onboarding Checklist

For platform teams rolling out AgentBoot, a generated checklist for new developer
onboarding:

```
$ agentboot onboarding-checklist

  New Developer Onboarding Checklist
  ───────────────────────────────────

  □ Claude Code installed and authenticated
    → Run: claude --version

  □ Org plugin installed (or managed settings active)
    → Run: /plugin list | grep acme
    → Or: check for .claude/ in your repo

  □ Try your first code review
    → Make a small change, then: /review-code
    → Read the findings. Ask a follow-up question about one.

  □ Try your first test generation
    → Pick a file with low coverage: /gen-tests src/services/user-service.ts

  □ Explore available personas
    → Type / in Claude Code to see all available skills
    → Try /learn for tips

  □ (Optional) Set up personal preferences
    → ~/.claude/CLAUDE.md for personal instructions
    → /config to adjust model, theme, etc.

  □ (Optional) Run /insights after your first week
    → Private analytics on your usage patterns

  Print this checklist: agentboot onboarding-checklist --format markdown
  Share with your team: agentboot onboarding-checklist --format email
```

This is generated from the org's actual AgentBoot config — the persona names,
skill invocations, and marketplace info are real, not generic examples.

### 6. Org-Authored Tips

The org's platform team can add custom onboarding content that's specific to their
stack, conventions, and personas. This goes in the personas repo and gets synced:

```
org-personas/
└── onboarding/
    ├── welcome.md                # First-session content (added to CLAUDE.md)
    ├── tips.md                   # Tips for /learn skill
    └── resources.md              # Org-specific resource links
```

```markdown
<!-- onboarding/tips.md -->

## Acme-Specific Tips

- Our code reviewer checks for our API versioning convention. If you get a
  WARN about missing version headers, see: confluence.acme.com/api-versioning

- The security reviewer is strict about SQL parameterization. This is because
  we had a production incident in Q3 2025. It's not optional.

- For database work, the Postgres gotchas rules activate automatically.
  Read them: .claude/rules/gotchas-postgres.md — they'll save you hours.
```

This is the "institutional knowledge transfer" that happens when a senior engineer
sits with a new hire — except it's encoded, version-controlled, and available 24/7.

---

## What This is NOT

- **Not an LMS.** No courses, modules, progress tracking, or certificates.
- **Not mandatory.** Developers who don't want tips disable them. No tracking of
  who completed what.
- **Not a gatekeeper.** Nobody is blocked from using personas until they "complete
  training." The personas work from day one; the training helps you get more from them.
- **Not built by AgentBoot.** AgentBoot curates and delivers. The actual training
  content comes from Anthropic's docs, community resources, and the org's own
  institutional knowledge.

---

## What AgentBoot Needs to Build

| Component | Phase | Description |
|-----------|-------|-------------|
| First-session welcome in CLAUDE.md | V1 | ~80 tokens with quick start commands and tips |
| `/learn` skill | V1 | Contextual help, topic browser, "ask me anything" |
| Curated resource links | V1 | Static list in `/learn resources`, updatable |
| Onboarding checklist generator | V1 | `agentboot onboarding-checklist` from org config |
| Contextual tips in persona output | V1.5 | First-invocation hints, vague-prompt nudges |
| Org-authored onboarding content | V1.5 | `onboarding/` directory in personas repo |
| Resource link freshness checking | V2 | Verify external links still work |

---

*See also:*
- [`docs/prompt-optimization.md`](prompt-optimization.md#7-developer-prompt-development-type-2--always-private) — developer prompt development tools
- [`docs/privacy-and-safety.md`](privacy-and-safety.md) — all training tools are private
- [`docs/delivery-methods.md`](delivery-methods.md) — per-segment user journeys
