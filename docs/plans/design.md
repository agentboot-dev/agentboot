# AgentBoot Design Document

User experience, interaction design, and non-technical design decisions.

**Status:** Draft
**Last updated:** 2026-03-19

---

## Table of Contents

1. [Summary](#1-summary)
2. [User Experience Design](#2-user-experience-design)
3. [Privacy Design](#3-privacy-design)
4. [Marketplace & Community Design](#4-marketplace--community-design)
5. [Prompt Development Lifecycle](#5-prompt-development-lifecycle)
6. [Onboarding Design](#6-onboarding-design)
7. [Uninstall Design](#7-uninstall-design)
8. [Brand & Positioning](#8-brand--positioning)
9. [Licensing & Attribution Design](#9-licensing--attribution-design)
10. [Open Questions](#10-open-questions)

---

## 1. Summary

AgentBoot is a build tool for AI agent governance. It compiles behavioral personas
from composable traits and distributes them across an organization's repositories,
providing structured AI agent behavior without requiring developers to think about
governance. The tool follows a hub-and-spoke model: a central personas repository
(the hub) compiles and syncs governed artifacts to target repositories (the spokes).

The design philosophy rests on three pillars:

**Privacy as architecture.** Developer prompts are private by design invariant, not
by configuration toggle. The system collects aggregate persona effectiveness metrics
and never individual conversation content. This is the single most important design
decision in AgentBoot because developer trust determines adoption, and adoption
determines whether the entire investment produces value. If developers believe their
AI conversations are being monitored, they stop asking questions, stop experimenting,
and stop trusting the tool. A governance framework that makes developers afraid to
use AI is worse than no framework.

**Convention over configuration.** AgentBoot follows the Spring Boot model: strong
defaults that work immediately, with escape hatches for customization. A developer
who clones a repo with `.claude/` already populated should be able to invoke
`/review-code` and get useful output without reading documentation, running setup
commands, or understanding the governance system behind it. The framework should be
invisible to the end developer.

**Agent-agnostic content, Claude Code-first delivery.** Personas, traits, and
gotchas rules are written in portable markdown. The build system produces
platform-specific output for Claude Code, Copilot, and Cursor. Claude Code users
get the richest experience (hooks, managed settings, plugin marketplace, subagent
isolation); other platforms get the content with weaker enforcement. This is
documented honestly rather than hidden.

The design serves six user segments (developers, platform teams, org leaders, IT
admins, skeptics, and non-engineers) through different interfaces to the same
underlying system. Each segment has different needs, different trust thresholds,
and different definitions of "value." The UX design addresses each segment on its
own terms while maintaining a single, coherent privacy model that protects all of
them equally.

This document covers the interaction design, privacy decisions, marketplace
community model, prompt development lifecycle, onboarding flows, uninstall
guarantees, brand positioning, and licensing strategy. It flags every gap,
ambiguity, and open question discovered during writing. The Open Questions section
(Section 10) is as valuable as the design itself.

---

## 2. User Experience Design

### 2.1 Developer UX

The developer is the primary consumer of AgentBoot's output but should never need
to know AgentBoot exists. They experience personas, skills, and rules -- not a
governance framework.

#### First Encounter

The ideal first encounter is invisible:

```
git clone git@github.com:acme-corp/my-service.git
cd my-service
claude
# .claude/ is already populated via sync
# /review-code just works
```

The developer did not install AgentBoot. They did not run a setup command. They
did not read a README about governance. They cloned a repo, opened Claude Code,
and personas were already there. This is the "it just works" path that repo sync
enables.

For the first session, CLAUDE.md includes a lightweight welcome fragment (~80
tokens) that orients without overwhelming:

```markdown
## Welcome -- Quick Start

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

This fragment loads once per session. After a few sessions, it fades into background
context -- Claude knows about it but does not repeat it unsolicited.

**Alternative first encounters:**

- **Managed settings path:** IT has force-enabled the org plugin via MDM. The
  developer opens Claude Code on any repo and the plugin is already active. No
  action required.

- **Plugin install path:** The developer's onboarding doc says "run this command":
  `/plugin marketplace add acme-corp/acme-personas` followed by
  `/plugin install acme`. Two commands, then done.

- **Self-service path:** The developer has heard about AgentBoot from a colleague
  and runs `agentboot connect acme-corp` or `/agentboot:connect`. The skill
  auto-detects the org from the git remote and connects them.

Each path converges on the same result: the developer has personas available and
can invoke them. The governance infrastructure is invisible.

#### Daily Workflow

A typical day for a developer using AgentBoot personas:

1. **Write code.** No AgentBoot involvement. The developer works normally.

2. **Ready to review.** The developer invokes `/review-code` (or
   `/review-code src/api/users.ts` for a targeted review). The persona runs as a
   subagent with its own context, reads the diff, and produces structured findings
   with severity levels and citations.

3. **Act on findings.** The developer reads CRITICAL and ERROR findings, fixes
   what needs fixing, asks follow-up questions about findings they disagree with
   ("Why is this an ERROR? I think this is intentional because..."), and marks INFO
   findings as acknowledged.

4. **Generate tests.** The developer invokes `/gen-tests src/services/user-service.ts`
   to generate test cases for new code. The test generator persona uses structured
   output and cites patterns from existing tests in the codebase.

5. **Open PR.** The developer commits their code. If CI runs `claude -p` with the
   code-reviewer agent, the persona runs again in CI and posts findings to the PR.
   The developer sees the findings in the PR comment, not in their private session.

6. **End of week (optional).** The developer runs `/insights` to see their personal
   usage patterns -- which personas they use most, their rephrase rate, cost -- and
   optionally shares anonymized patterns with the org.

The daily workflow involves invoking personas by name. The developer never runs
`agentboot` commands, never thinks about traits or composition, and never interacts
with the governance layer.

#### Learning Curve

The learning curve follows a natural progression:

**Stage 1: Vague prompts.** The developer types "review this" and gets a broad,
not-very-useful response. Contextual tips (rate-limited to one per session, disableable)
nudge them toward specificity:

```
[TIP] Your prompt "review this" could be more effective as:
"Review src/api/users.ts for the changes I made to the pagination logic."
Specific prompts -> specific, useful findings.
```

**Stage 2: Discovery via /learn.** The developer runs `/learn` and discovers the
topic browser -- how to write effective prompts, how code review personas work, how
to read findings, how to do their first AI-assisted PR. The `/learn` skill is
context-aware ("how do I review one file?" produces a specific, actionable answer)
rather than a static tutorial.

**Stage 3: Effective prompting.** The developer has internalized the patterns.
They invoke personas by name with targeted arguments. They ask follow-up questions
about findings. Their rephrase rate drops. Their `/insights` shows improvement
trends -- privately, only to them.

**Stage 4: Persona contributor.** The developer has domain expertise that is not
captured by existing personas. They paste a raw prompt into
`agentboot add prompt "Always verify RLS is enabled on new tables"`. AgentBoot
classifies it as a path-scoped gotcha, formats it with proper frontmatter, and
saves it. Eventually, they open a PR to the personas repo. They have graduated
from consumer to contributor without ever reading a contribution guide -- the
tooling taught them the format by example.

#### Privacy Experience

What the developer sees:
- Persona findings in their Claude Code session (private until they publish via PR)
- `/insights` personal analytics (private, opt-in to share anonymized patterns)
- The privacy policy in `/learn resources` or linked from the welcome fragment

What the developer does not see:
- Telemetry data (it is about the persona, not the developer)
- Org dashboard metrics
- Other developers' usage patterns

What the developer trusts:
- Raw prompts never leave their machine via AgentBoot channels
- `/insights` sends transcripts to the same Claude API they already use (same
  trust boundary, not a new data flow)
- Sharing is always opt-in with preview before submission
- The `rawPrompts` config section has three `false` fields that cannot be set to
  `true` -- this is a design invariant visible in the schema

---

### 2.2 Platform Team UX

The platform team (DevEx, developer productivity, or engineering tooling) is the
primary operator of AgentBoot. They configure, build, distribute, and maintain
personas for the organization.

#### Setup

```bash
brew install agentboot
agentboot setup
```

The setup wizard detects the platform team role from the first question and adjusts
the question flow accordingly:

```
Q1: What's your role?
  > Platform / DevEx team
Q5: How many developers will use this?
  > Department (20-100)
Q6: What AI tools does your team use?
  > Claude Code only
Q6.5: Want me to scan for existing agentic content?
  > Yes
Q7: Do you have compliance requirements?
  > SOC 2
```

Setup produces:
- `agentboot.config.json` with org structure
- `repos.json` (empty, ready for population)
- Core personas (4), traits (6), baseline instructions
- SOC 2 compliance hooks (if selected)

The platform team then:
1. Edits `agentboot.config.json` with team structure and scope hierarchy
2. Adds target repos to `repos.json`
3. Runs `agentboot build` to compile
4. Runs `agentboot sync` to distribute

#### Discovery

Before building new content, the platform team discovers what already exists.
`agentboot discover` scans the org's repos, local machines, and configuration for
existing AI agent content:

```bash
agentboot discover --path ~/work/ --local
```

This produces:
- An inventory of every CLAUDE.md, custom agent, skill, rule, hook, and MCP server
  across all scanned repos
- An overlap analysis showing duplicate content across repos
- A migration plan that classifies every instruction as trait, gotcha, persona rule,
  or always-on instruction
- An estimated result ("Before: 74 files, 5,600 lines, no governance. After: 6
  traits, 3 gotchas, 3 personas, ~800 lines total, centralized.")

Discovery is non-destructive. It never modifies, moves, or deletes existing files.
The migration plan produces new files in the AgentBoot personas repo. Originals
stay untouched. The platform team reviews the plan, tests it, and only deploys
when ready -- via PR, with review, at their pace.

#### Ongoing Governance

The weekly governance cycle:

1. **Pull metrics:** `agentboot metrics --period 7d`
2. **Identify outliers:**
   - Personas with high false positive rates (tune rules tighter)
   - Personas with high token usage (compress prompts, split personas)
   - Personas rarely invoked (investigate: not useful? not discoverable?)
   - Personas on Opus that could run on Sonnet (test model downgrade)
3. **Update prompts:** Edit SKILL.md based on findings
4. **Run tests:** `agentboot test` to verify changes do not regress
5. **Lint:** `agentboot lint` to check prompt quality
6. **Deploy:** `agentboot build && agentboot sync`

The metrics dashboard shows persona-level data (rephrase rates, false positive
rates, cost by team) without individual developer attribution. High rephrase rates
are framed as persona quality problems ("developers need to rephrase 23% of the
time" means the persona's output is unclear), not developer intelligence problems.

#### Marketplace Contribution

When the platform team has content worth sharing:

```bash
agentboot publish gotcha postgres-rls --to marketplace
```

AgentBoot strips org-specific content (internal URLs, paths, proprietary names),
validates format and lint, generates a README, and opens a PR to the marketplace
repository. The contributor's name goes in the PR and in the content's frontmatter.
Attribution is permanent and travels with the content.

---

### 2.3 Org Owner / Leader UX

The org owner (VP Engineering, CTO, or engineering director) needs to justify the
AI tooling investment, measure ROI, and ensure compliance -- without understanding
the technical details of persona composition.

#### Dashboard

The org dashboard shows investment metrics, not surveillance metrics:

```
AgentBoot Org Dashboard (Monthly)

Investment Summary:
  Total AI spend:          $8,200 (52 developers)
  Avg spend/developer:     $158/mo
  Median spend/developer:  $120/mo

ROI Indicators:
  PR review turnaround:    -34% (faster since deployment)
  Bug escape rate:         -22% (fewer prod bugs)
  Test coverage:           +15% (from test generation personas)
  Onboarding time:         -40% (new hires productive faster)

Adoption:
  Active seats:            47/52 (90%)
  Daily active users:      38 (73%)
  Persona usage rate:      68% of sessions invoke at least one persona

Cost Efficiency:
  Opus usage:              12% of invocations, 68% of cost
  Recommendation: audit Opus usage for model downgrade candidates
```

What the dashboard shows:
- Cost, adoption, and ROI indicators at team level
- Persona effectiveness (aggregate rephrase rates, false positive rates)
- Common knowledge gaps ("authentication patterns asked about 89 times" with
  action: "improve auth documentation")
- Model usage mix with cost optimization suggestions
- Attention items (zero-usage developers, high-cost teams, low persona adoption)

What the dashboard explicitly does not show:
- Individual developer prompts or conversations
- Individual developer rephrase rates or question topics
- Rankings of developers by prompt quality or AI skill
- Session transcripts or conversation excerpts
- Any metric that could be used to judge an individual developer's intelligence

#### ROI Metrics

The dashboard provides before/after comparison for key outcome metrics:

| Metric | Before AgentBoot | After AgentBoot | Delta |
|--------|------------------|-----------------|-------|
| PR review turnaround | 4.2 hours | 2.8 hours | -34% |
| Bug escape rate | 12/quarter | 9/quarter | -22% |
| Test coverage | 62% | 71% | +15% |
| New hire time-to-first-commit | 8 days | 5 days | -40% |

These are outcome metrics sourced from existing systems (GitHub API, CI coverage
reports, incident tracking) -- not from AI conversation monitoring. They measure
whether the investment is producing better engineering outcomes.

Cost tracking:
- Total spend by team per month
- Cost per persona per invocation (average)
- Model mix (% Haiku/Sonnet/Opus) with cost correlation
- Month-over-month trends

#### Compliance Posture

What is enforced (HARD guardrails, via hooks and managed settings):
- Credential blocking (PreToolUse hooks prevent committing secrets)
- PHI scanning (UserPromptSubmit hooks flag protected health information)
- Permission restrictions (deny dangerous tool patterns)

What is advisory (SOFT guardrails, via persona instructions):
- Code style guidelines
- Architecture patterns
- Best practices

The org owner sees which HARD guardrails are active across the org and which repos
have them deployed. They do not see individual guardrail trigger events unless
the escalation exception applies (see Section 3.7).

---

### 2.4 IT Admin UX

The IT admin manages device policies, compliance requirements, and enterprise
software deployment.

#### MDM Deployment

AgentBoot generates managed settings files for common MDM platforms:

```bash
agentboot export --format managed
```

This produces:
- `dist/managed/managed-settings.json` (Claude Code configuration)
- `dist/managed/managed-mcp.json` (MCP server configuration)
- `dist/managed/CLAUDE.md` (organization-wide instructions)

The IT admin deploys these via their MDM tool:

| MDM Platform | Deploy Path |
|---|---|
| Jamf | Configuration Profiles > Claude Code |
| Intune | Device Configuration > macOS/Windows |
| JumpCloud | Policies > Script Deployment |
| Kandji | Library > Custom Profiles |

The managed settings carry HARD guardrails only -- compliance hooks, credential
blocking, and forced plugin installation. They do not carry persona definitions
(that is the plugin and sync channel's job).

#### Plugin Control

Managed settings support plugin force-enable and marketplace lockdown:

```json
{
  "extraKnownMarketplaces": {
    "acme-personas": {
      "source": { "source": "github", "repo": "acme-corp/acme-personas" }
    }
  },
  "enabledPlugins": {
    "acme@acme-personas": true
  },
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "acme-corp/acme-personas" }
  ]
}
```

`strictKnownMarketplaces` locks down the marketplace to only approved sources.
Developers cannot add unauthorized marketplaces. This is the IT admin's compliance
control for preventing unapproved AI tooling.

#### Audit Trail

What is logged:
- Persona invocation events (persona ID, model, tokens, cost, scope, findings
  count, timestamp)
- Compliance hook trigger events (category, timestamp -- not the prompt that
  triggered it)
- Sync events (what was deployed where, when)

Where logs live:
- Local NDJSON files (default) or HTTP webhook (configurable)
- Format is machine-readable, compatible with SIEM ingestion

What is explicitly not logged:
- Developer prompts or conversation content
- Developer identity (default; configurable to hashed or email if org policy
  requires it)
- Files read during sessions
- Session transcripts

---

### 2.5 Skeptic UX

The skeptic is a developer who is resistant to AI tooling, either from past bad
experiences, philosophical objections, or simple inertia. AgentBoot's design for
skeptics is: deliver value without requiring buy-in, then let the value speak for
itself.

#### Zero-Touch Activation

Managed settings + repo sync = personas active without opt-in. The skeptic does not
install anything, does not run any commands, and does not change their workflow.
They clone a repo and the governance is already there.

This is not about forcing AI on unwilling developers. It is about ensuring that
compliance hooks (credential blocking, PHI scanning) are active regardless of
individual preferences. The personas are available; the developer is not required
to invoke them.

#### First Value Moment

The skeptic's conversion typically happens when a gotchas rule saves them from a
production bug:

```
[ERROR] src/db/migrations/007-add-user-roles.ts:23
  Missing RLS policy on new table. The users_roles table has no
  row-level security policy. All previous tables in this schema have
  RLS enabled.
  Recommendation: Add RLS policy before deploying.
  Confidence: HIGH
  Source: .claude/rules/gotchas-postgres.md
```

The skeptic was not invoking a persona. The gotchas rule activated because of
path-scoped rules matching the migration file. The finding was specific, correct,
and would have caused a real problem in production. This is the "huh, that was
actually useful" moment.

#### Gradual Adoption

The progression:
1. **Passive value:** Gotchas rules and always-on instructions help without being
   invoked. The skeptic benefits from the governance without interacting with it.
2. **Curiosity:** After a few saves, the skeptic starts reading persona output more
   carefully. They ask follow-up questions about findings.
3. **Manual invocation:** The skeptic starts invoking `/review-code` before opening
   PRs. They see structured findings instead of ad-hoc review comments.
4. **Advocacy:** The skeptic tells colleagues "that database gotchas rule saved me
   from a production bug." They become an advocate.

This progression cannot be forced or gamified. It happens organically when the
tooling delivers genuine, visible value. AgentBoot's role is to make the first
value moment as likely as possible (through path-scoped gotchas and always-on
instructions that activate without invocation) and then get out of the way.

#### What AgentBoot Must Not Do for Skeptics

- Never make AI usage mandatory or tracked at the individual level by default
- Never surface "developer X has zero AI sessions" to management
- Never gamify adoption (no leaderboards, no badges, no "prompt of the week")
- Never shame non-adoption ("your team's AI usage is below average")

The skeptic's opt-out must be genuine. If management wants adoption metrics, they
configure `includeDevId` and communicate the policy to the team in advance.
Surprise surveillance destroys the trust that gradual adoption depends on.

---

### 2.6 Non-Engineer UX

Non-engineers (product managers, designers, technical writers, compliance officers)
use the same personas through a different interface.

#### Cowork Desktop App

Cowork is Anthropic's desktop application for non-terminal users. It supports the
same Claude Code plugin system, which means AgentBoot personas work in Cowork
without modification.

The non-engineer experience:
- GUI application, no terminal
- Same org plugin installed (via managed settings or IT)
- Structured forms for input (paste a document, select a review type)
- Same persona output (findings, suggestions, structured reports)

#### Same Personas, Different Interface

The code-reviewer persona in Cowork might be invoked as:
- "Review this API specification for consistency" (paste document)
- "Check this compliance report against our SOC 2 controls" (paste report)

The persona definition is identical. The invocation interface is graphical instead
of CLI. The privacy model is identical (conversations are private, same three-tier
model).

#### Structured Forms

For non-engineers, the most effective UX is structured forms rather than free-text
prompting:

```
+------------------------------------------+
|  Document Review                         |
|                                          |
|  Paste document:    [              ]     |
|  Review type:       [Compliance v  ]     |
|  Focus areas:       [x] Accuracy         |
|                     [x] Completeness     |
|                     [ ] Formatting       |
|                                          |
|  [Review]                                |
+------------------------------------------+
```

This translates to a persona invocation under the hood. The non-engineer never
writes a prompt; they fill in a form. The form maps to the same skill arguments
that a developer would type in the terminal.

---

## 3. Privacy Design

The privacy model is the most important design in AgentBoot. Every other design
decision is downstream of it. If the privacy model fails, developers stop trusting
the tool, stop using it, and the entire investment produces zero value.

This section goes deep on every privacy decision, the reasoning behind it, and the
explicit trade-offs.

### 3.1 The Core Tension

Organizations need data to optimize AI investment. What are developers asking? Where
do personas succeed and fail? Which personas deliver value? Without this data,
prompt optimization is guesswork and investment justification is impossible.

Developers need psychological safety. The path from "I do not know how this works"
to "I understand it deeply" is paved with embarrassing questions, false starts, and
wrong turns. If developers believe their interactions are being watched, judged,
and reported, they:

1. Stop asking questions (pretend to know things they do not)
2. Stop experimenting (stick to safe, known prompts)
3. Stop trusting the tool (AI becomes a surveillance instrument)
4. Game the metrics (optimize for looking smart, not getting help)

This kills the value proposition. The privacy model must resolve this tension.

### 3.2 The PR Analogy

Every developer understands this distinction intuitively:

| Your IDE | Your PR |
|----------|---------|
| Private | Public |
| Messy, full of false starts | Clean, only the final result |
| You talk to yourself | You present to the team |
| "Wait, how does this work again?" | "Implemented X using Y pattern" |
| No judgment | Reviewed by peers |

Nobody reviews your IDE history. Nobody sees the 47 times you typed something,
deleted it, and tried again. Nobody sees the Stack Overflow tabs.

AgentBoot applies this principle to AI interactions. The persona's output (findings,
reviews, generated code) is the PR -- visible, reviewable, measurable. The
developer's prompts and conversation are the IDE -- private, protected, not reported.

### 3.3 The Three Tiers of Data

```
+-----------------------------------------------------------+
|  Tier 1: PRIVATE (Developer's Workshop)                    |
|                                                            |
|  - Raw prompts typed by the developer                      |
|  - Conversation history with AI                            |
|  - Questions asked ("what does this function do?")         |
|  - False starts and deleted attempts                       |
|  - Session transcripts                                     |
|  - Files read during exploration                           |
|                                                            |
|  WHO SEES THIS: The developer. No one else.                |
|  WHERE IT LIVES: Developer's machine only.                 |
|  RETENTION: Session duration (or developer's choice).      |
|                                                            |
+-----------------------------------------------------------+
|  Tier 2: PRIVILEGED (Non-Human Analysis)                   |
|                                                            |
|  - Aggregated patterns extracted by LLM analysis           |
|  - "Developers frequently ask about auth patterns"         |
|  - "The security reviewer's false positive rate is 34%"    |
|  - "Average prompt length is increasing over time"         |
|  - Token usage and cost (anonymized)                       |
|                                                            |
|  WHO SEES THIS: The developer first. Then aggregated       |
|  anonymized insights shared with the org if developer      |
|  opts in. Never raw prompts, never attributed.             |
|  WHERE IT LIVES: Local analysis -> anonymized aggregate.   |
|                                                            |
+-----------------------------------------------------------+
|  Tier 3: ORGANIZATIONAL (Persona Output)                   |
|                                                            |
|  - Review findings posted to PRs                           |
|  - Generated test files committed to repos                 |
|  - Compliance audit logs (required by policy)              |
|  - Persona invocation counts (not who, just how many)      |
|  - Persona effectiveness metrics (aggregate)               |
|                                                            |
|  WHO SEES THIS: The team, the org, compliance.             |
|  WHERE IT LIVES: PR comments, repos, telemetry.            |
|  RETENTION: Org's data retention policy.                   |
|                                                            |
+-----------------------------------------------------------+
```

The tiers are not configurable. Data does not move between tiers except through
explicit mechanisms:

- Tier 1 -> Tier 2: Only through `/insights` analysis (Claude API call using the
  developer's existing auth, extracting patterns not transcripts, developer reviews
  first)
- Tier 2 -> Tier 3: Only through developer opt-in (sharing anonymized patterns with
  the org dashboard)
- Tier 1 -> Tier 3: Never. There is no mechanism for raw prompts to reach the
  organizational tier.

### 3.4 The Key Design Invariant

**AgentBoot will never collect, transmit, or surface raw developer prompts.**

This is not optional or configurable. The configuration schema contains:

```jsonc
{
  "privacy": {
    "rawPrompts": {
      "collect": false,
      "transmit": false,
      "surfaceToOrg": false
    }
  }
}
```

These three fields cannot be set to `true`. They exist in the schema to make
AgentBoot's design intent explicit and auditable. An org reviewing AgentBoot's
configuration can see -- in code, not in marketing materials -- that prompt
collection is structurally impossible.

### 3.5 Two Types of Prompts, Two Privacy Models

There are two fundamentally different types of prompts in AgentBoot. They have
different privacy models because they have different "submit" boundaries.

**Type 1: Persona definitions** (SKILL.md, traits, instructions, gotchas rules).

These are code. They live in the personas repo. They go through PRs. The standard
local-first, CI-gate model applies:

| Tool | Local (private) | CI (visible after PR) |
|------|----------------|----------------------|
| `agentboot lint` | Full detail: which rules failed, where, why | Pass/fail + error count |
| `agentboot test` | Full output: expected vs. actual | Pass/fail summary |
| `agentboot cost-estimate` | Per-persona cost projection | Not run in CI |

The "submit" boundary is opening the PR to the personas repo. Before that, the
platform engineer iterates privately. After that, CI validation and team review
are fair game. This is identical to how code works.

**Type 2: Developer prompts** (conversations with Claude Code).

These are conversations. They have no submit moment. There is no PR for "explain
this function" or "I do not understand this codebase."

These are always private. The only thing that crosses the private-to-public
boundary is what the developer chooses to publish: a PR comment, committed code,
a filed issue. The conversation that produced the output stays private.

| Tool | What the developer sees | What the org sees |
|------|------------------------|-------------------|
| `/insights` | Personal patterns and suggestions | Nothing (unless developer opts in) |
| Telemetry | N/A (developer does not see telemetry) | Persona invocation counts, cost, findings count -- no prompts, no developer IDs |

There is no "after submit" state for developer prompts. They are always in the
private zone. This distinction is fundamental to the entire privacy architecture.

### 3.6 The /insights Flow

The challenge: extract optimization value from private data without exposing it.

The solution: a non-human intermediary (Claude API) analyzes private data and
outputs only aggregate, anonymized insights.

**The trust boundary argument.** The developer already trusts Anthropic's API
with their prompts -- that is what happens every time they type in Claude Code.
The `/insights` analysis uses that same trust boundary (a Claude API call via
Haiku or Sonnet). It is not a new data flow. It is another API call using the
developer's existing authentication.

What the developer is protected from is their employer/org seeing their raw
prompts. The privacy boundary is between the developer and the organization,
not between the developer and the API provider.

**The flow:**

```
Developer -> Claude API (already trusted, already happening)
                |
                v
         /insights analysis
         (pattern extraction via Haiku/Sonnet)
                |
                v
         Developer sees insights FIRST
                |
                v (developer approves)
         Anonymized aggregate -> Org Dashboard
```

There is no local LLM requirement. No new infrastructure. The same API the
developer uses for coding is used for insights analysis.

**What the developer sees:**

```
$ /insights

  Personal Prompt Insights (last 7 days)

  Sessions: 23
  Total prompts: 187
  Avg prompt length: 42 words
  Most-used personas: code-reviewer (34), gen-tests (28)

  Patterns:
  - You frequently ask about authentication patterns (12 times).
    Consider: the auth-patterns skill has this context built in.
  - Your security reviews take 2.3x longer than average.
    This is likely because you review larger diffs.
  - You often rephrase when the first answer is not useful.
    The code-reviewer has a 23% rephrase rate for you.
    This suggests the persona's output may not match expectations.

  Cost: $14.20 this week (vs. $18.50 team average)

  Share anonymized insights with your team? [y/N]
  (This shares PATTERNS only, never your actual prompts)
```

**What the org sees (aggregate dashboard):**

```
  Persona Effectiveness:
    code-reviewer:     18% rephrase rate
    security-reviewer: 34% false positive rate (too aggressive)
    test-generator:    8% rephrase rate (working well)

  Common Knowledge Gaps (anonymized):
    - "Authentication patterns" asked about 89 times across 23 developers
      Action: Create an auth-patterns skill or improve CLAUDE.md context
    - "Database migration rollback" asked about 34 times across 12 developers
      Action: Add to gotchas-database.md
```

**What the org NEVER sees:**

- "Developer X asked 'what is a foreign key?' 4 times" -- NO
- "Here is developer Y's conversation transcript" -- NO
- Individual prompt texts, attributed or not -- NO
- Per-developer rephrase rates (only aggregate) -- NO

**The analysis prompt design.** The prompt sent to Claude API for `/insights`
analysis is explicitly designed to extract patterns, not judge:

```markdown
Analyze these session transcripts and extract:
1. Most frequently asked topics (not the questions themselves)
2. Persona rephrase rate
3. Knowledge gaps (topics where the developer asks the same
   type of question repeatedly)
4. Persona friction points

Do NOT:
- Quote any developer prompt
- Judge the quality or intelligence of any question
- Identify specific knowledge deficiencies
- Produce output that could embarrass the developer if shared

Frame everything as PERSONA improvement opportunities,
not developer deficiencies.
```

This prompt design is itself a design decision. The framing ("persona improvement
opportunities, not developer deficiencies") ensures that even the LLM analysis
treats high rephrase rates as persona quality problems, not developer intelligence
problems.

### 3.7 Org Dashboard Design

The org dashboard shows investment metrics and outcome metrics. It never shows
process metrics.

**Investment metrics** (from telemetry):
- Total AI spend by team per month
- Active seats vs. licensed seats
- Sessions per day (org-wide)
- Persona invocations per day
- Model mix (% Haiku/Sonnet/Opus)

**Outcome metrics** (from existing systems, not AI monitoring):
- PR review turnaround (GitHub/GitLab API)
- Findings-to-fix ratio (PR comment resolution)
- Bug escape rate (incident tracking)
- Test coverage delta (CI coverage reports)
- Time to first commit for new hires (git history)

**Process metrics** (never shown):
- What developers typed
- How many times they rephrased
- What they asked about
- Which developers asked "dumb" questions

The dashboard informs management actions. It does not automate them. When the
dashboard shows an outlier (5 developers with zero usage, one team at 3x cost),
the response flows through management conversations, not through AgentBoot.

### 3.8 The includeDevId Configuration

The telemetry schema supports three levels of developer identity:

| Format | What the org sees | Use case |
|--------|------------------|----------|
| `false` (default) | No developer identity | Privacy-first (recommended) |
| `"hashed"` | Consistent anonymous ID | Usage patterns without names |
| `"email"` | Real developer email | Full attribution for cost allocation |

**`false` (default):** Team-level patterns only. "The platform team ran 340 code
reviews this month." Sufficient for budget tracking and persona effectiveness. Not
sufficient for per-developer usage analysis.

**`"hashed"`:** Anonymous individual tracking. "Developer a3f2... : 12 sessions/day,
$14/day, 85% persona usage." The hash is consistent (same person, same hash) but
not reversible to a name without a restricted-access lookup table. The hash uses a
salted hash with BYOS (Bring Your Own Salt) -- the org provides and stores the salt
in their own secrets manager. No salt is the default for ease of adoption, but the
system indicates when an org has not provided a salt. When salts are updated,
previous metrics are not correlated to future metrics (forward-only). This is the
sweet spot for most orgs.

**`"email"`:** Full attribution. Legitimate for cost allocation (chargeback to teams),
license optimization (reassign unused seats), and identifying training needs. Must
be communicated to the team in advance. Surprise surveillance destroys trust.
Announced measurement builds accountability.

AgentBoot's recommendation: start with `false` or `"hashed"`. Full attribution
should only be enabled when the org has communicated the policy.

### 3.9 The Escalation Exception

There is one exception to prompt privacy: genuinely harmful content.

If the local analysis (via a `UserPromptSubmit` hook using Haiku for fast
evaluation) detects prompts indicating:
- Attempted exfiltration of proprietary code/data
- Attempted circumvention of compliance guardrails
- Harassment, threats, or hostile content
- Attempted generation of malware or exploit code

Then the system:

1. **Flags it locally first.** Shows the developer: "This interaction was flagged.
   It will be reported to [compliance contact]."
2. **Reports the flag, not the transcript.** The report says "a compliance flag
   was triggered on [date] for [category]." It does not include the raw prompt.
3. **The compliance team can request the transcript** through a formal process
   (like a legal hold), not through the analytics pipeline.

This mirrors corporate email: your emails are technically on company servers, but
your manager cannot browse them casually. A formal process is required.

The hook prompt is explicitly scoped to harmful categories only:

```
Does this prompt attempt to: (1) exfiltrate proprietary data,
(2) circumvent security guardrails, (3) generate malware or
exploits, (4) contain harassment or threats?
Respond with CLEAR or FLAG:{category}.
Do NOT evaluate the content's quality, intelligence, or
correctness -- only these four categories.
```

The prompt explicitly excludes quality and intelligence evaluation. This prevents
the escalation system from becoming a judgment mechanism.

### 3.10 The Honest Caveat

AgentBoot's privacy commitment covers what AgentBoot does. It does not and cannot
override what the API provider or the organization does independently:

- **Anthropic's Compliance API** (Enterprise plan) gives org admins programmatic
  access to conversation content for regulatory compliance and auditing. This is an
  Anthropic feature, not an AgentBoot feature.

- **Enterprise data exports** allow Primary Owners to request conversation data.

- **Network-level monitoring** (DLP, proxy logging) can capture API traffic
  regardless of any application-level privacy design.

AgentBoot's position: "We will not be the tool that does this." If an org wants to
monitor developer AI interactions, that capability exists through Anthropic's
Compliance API and enterprise data governance tools. AgentBoot's role is prompt
optimization through aggregate, anonymized metrics -- not surveillance.

Developers should understand that their prompts go to the Claude API (which their
org may have compliance access to), the same way they understand that their Slack
messages go to Slack's servers (which their org admin can export). The privacy
boundary AgentBoot enforces is between the developer and AgentBoot's analytics --
not between the developer and the universe.

This honesty is itself a design decision. Overpromising privacy ("your prompts are
completely private!") and then having developers discover the Compliance API destroys
trust more thoroughly than being upfront about the boundaries. AgentBoot documents
both what it guarantees and what it does not control.

### 3.11 How Privacy Builds Trust Which Drives Adoption

The privacy model is not altruistic. It is strategic.

```
Strong privacy guarantees
        |
        v
Developers trust the tool
        |
        v
Developers use the tool honestly
(ask real questions, experiment, make mistakes)
        |
        v
The tool delivers real value
(because it is used for real work, not performance theater)
        |
        v
Org gets genuine ROI data
(because the usage is authentic)
        |
        v
Org invests more in the tooling
        |
        v
Better personas, more domains, deeper governance
```

The alternative -- surveillance-driven adoption -- produces:

```
Weak privacy / surveillance
        |
        v
Developers distrust the tool
        |
        v
Developers use it performatively
(safe prompts, avoid asking questions)
        |
        v
The tool delivers superficial value
(usage metrics look good, actual value is low)
        |
        v
Org sees usage but not outcomes
        |
        v
"Why are we spending $8,200/month on AI that doesn't move the needle?"
```

The best prompt optimization system is one that developers feed willingly because
they trust it with their worst questions.

### 3.12 Privacy Configuration Summary

```jsonc
{
  "privacy": {
    "telemetry": {
      "enabled": true,
      "includeDevId": false,        // Default: no developer identity
      "devIdFormat": "hashed",      // If includeDevId: true
      "includeCost": true,
      "includeScope": true,
      "destination": "local"        // "local" = NDJSON; "http" = webhook
    },
    "insights": {
      "enabled": true,
      "autoShareAnonymized": false, // Developer must opt-in
      "escalation": {
        "enabled": true,
        "categories": [
          "exfiltration",
          "guardrail-circumvention",
          "malware",
          "harassment"
        ],
        "contact": "security@acme-corp.com"
      }
    },
    "rawPrompts": {
      "collect": false,             // Cannot be true
      "transmit": false,            // Cannot be true
      "surfaceToOrg": false         // Cannot be true
    }
  }
}
```

### 3.13 What AgentBoot Must Never Do

These are anti-patterns that AgentBoot commits to avoiding:

- Never surface individual developer prompts to anyone other than that developer
- Never rank developers by prompt quality, question frequency, or AI usage
- Never gamify (no leaderboards, badges, or "prompt of the week")
- Never shame ("your prompts are below team average")
- Never correlate AI usage with performance reviews
- Never make AI usage mandatory (skeptics opt out without penalty)
- Never frame knowledge gaps as individual deficiencies

When the system detects that "developers frequently ask about auth patterns," the
action item is "improve the auth documentation," not "find out who does not know
auth."

---

## 4. Marketplace & Community Design

### 4.1 Three Layers

The marketplace has three layers with progressively lower quality bars:

**Layer 1: Core** (maintained by AgentBoot project):
- Core traits: critical-thinking, structured-output, source-citation,
  confidence-signaling, audit-trail, schema-awareness
- Core personas: code-reviewer, security-reviewer, test-generator, test-data-expert
- Core instructions: baseline.instructions.md, security.instructions.md
- Quality bar: tested in CI on every commit, documented, versioned with the
  framework, Apache 2.0 licensed
- How to get it: included when you `agentboot setup`

**Layer 2: Verified** (reviewed + attributed community contributions):
- Examples: phi-awareness trait, postgres-rls gotcha, accessibility-reviewer persona,
  healthcare-compliance domain
- Quality bar: reviewed by at least one maintainer, follows format standards, has
  behavioral tests, documentation, Apache 2.0 or MIT license, no org-specific
  content, attribution to contributor
- How to get it: `agentboot add trait phi-awareness --from marketplace` or via CC
  plugin marketplace

**Layer 3: Community** (unreviewed, use at your own risk):
- Examples: brand-voice-casual trait, unity-reviewer persona, redis-clustering gotcha
- Quality bar: valid frontmatter/metadata and declared license. That is it.
- How to get it: `agentboot add trait some-trait --from github:user/repo`

The three layers serve different trust needs. An enterprise that can only use
reviewed content installs Layer 1 + Layer 2. An individual experimenting can pull
from Layer 3. Version pinning works at all layers.

### 4.2 Contribution UX

**Individual trait or gotcha (easiest path):**

```bash
# Fork agentboot/marketplace
# Add your trait
agentboot add trait my-trait
# Edit core/traits/my-trait.md
agentboot lint --trait my-trait
agentboot test --trait my-trait
# Open PR to agentboot/marketplace
```

**Publishing from an org's existing content:**

```bash
agentboot publish gotcha postgres-rls --to marketplace
```

AgentBoot:
1. Strips org-specific content (internal URLs, paths, names)
2. Validates format and lint
3. Generates README from content
4. Opens PR to agentboot/marketplace
5. Contributor's name in the PR; review handles the rest

The `--to marketplace` flag does the generalization work. It scans for org-specific
content and either strips it or warns the contributor.

**Complete domain layer (highest effort, highest value):**

```bash
agentboot add domain my-domain
agentboot build
agentboot test --domain my-domain
# Publish to own marketplace first (test in production)
agentboot publish --marketplace my-github/my-marketplace
# When stable, open PR to agentboot/marketplace
```

**Review process for Verified (Layer 2):**

1. Contributor opens PR to `agentboot/marketplace`
2. Automated checks: lint, test, format validation, license scan
3. Maintainer review: quality, generalizability, overlap with existing content
4. If accepted: merged with attribution, listed in marketplace index
5. Contributor credited in CONTRIBUTORS.md and in content frontmatter

### 4.3 Discoverability

**In CLI:**
```bash
agentboot search traits "gdpr"
agentboot search gotchas "postgres"
agentboot search domains "healthcare"
```

**In Claude Code:**
```
/plugin search agentboot gdpr
```

**On the web:** A static site (agentboot.dev/marketplace) generated from the
marketplace repo, showing available traits, personas, gotchas, and domains with
usage stats, README previews, and install commands.

**Trust signals on every marketplace item:**
- Core / Verified / Community badge
- Download count (how many orgs are using it)
- Last updated date
- Test coverage indicator
- Compatible AgentBoot versions
- License
- Author with link to profile

### 4.4 Motivation Model

The marketplace contribution model is built on understanding what actually motivates
sustained, high-quality contributions:

**What works:**

| Motivation | How AgentBoot serves it |
|---|---|
| Professional reputation | Permanent attribution in frontmatter, contributor profiles on agentboot.dev, usage stats visible to contributors |
| Reciprocity | Visible attribution on everything you install; you see who helped you |
| Content improvement | When 50 orgs use your trait, they file issues and submit PRs; your content gets better than you could make it alone |
| Org visibility | "Acme Corp contributed the healthcare compliance domain" is a recruiting signal |
| Low friction | `agentboot publish` makes sharing a one-command action |

**What does not work (and AgentBoot will not use):**

- Stars/likes (dopamine hit on day one, forgotten by day three)
- Gamification (badges, leaderboards, streaks -- attracts gaming, not quality)
- Points/tokens (creates mercenary contributors who optimize for quantity)
- Forced contribution ("you must contribute to use the marketplace")

AgentBoot will not gamify contributions. The motivation hierarchy is:
professional reputation > reciprocity > altruism. No leaderboards. No badges.
No streak counters.

**Attribution that matters professionally:**

Every marketplace item has permanent, visible attribution:

```yaml
---
trait: gdpr-awareness
version: 2.1.0
author:
  name: Jane Doe
  github: janedoe
  org: Acme Corp
attribution:
  - name: Jane Doe
    contribution: "Initial implementation"
  - name: Bob Smith
    contribution: "Added right-to-deletion rules"
---
```

This attribution travels with the content. When an org installs `gdpr-awareness`,
the build output includes: `# Contributed by Jane Doe (@janedoe) / Acme Corp`.
The contributor's name is in every repo that uses their work.

### 4.5 Cross-Listing with Third-Party Tools

AgentBoot's marketplace lists third-party plugins by pointing to upstream, not
copying:

```json
{
  "name": "agentboot-marketplace",
  "plugins": [
    { "name": "ab-core", "source": "./plugins/core" },
    {
      "name": "superclaude-traits",
      "source": {
        "source": "github",
        "repo": "SuperClaude-Org/SuperClaude_Plugin"
      },
      "description": "SuperClaude composable traits (cross-listed)"
    },
    {
      "name": "arckit",
      "source": {
        "source": "github",
        "repo": "tractorjuice/arc-kit"
      },
      "description": "Enterprise architecture governance (cross-listed)"
    }
  ]
}
```

The recommended partnership model is marketplace curation (point to upstream) over
bundling. AgentBoot acts as curator, not distributor. This avoids license
complexity, ensures users always get the latest upstream version, and positions
AgentBoot as the governance layer rather than the content layer.

---

## 5. Prompt Development Lifecycle

### 5.1 Type 1: Persona Definitions

Persona definitions follow the same lifecycle as code:

```
Write -> Lint -> Test -> PR -> CI -> Deploy

Locally (private):
  1. Write or edit SKILL.md, traits, instructions
  2. agentboot lint (static analysis: token budgets, vague language,
     conflicts, security)
  3. agentboot test --type deterministic (free: schema, composition)
  4. agentboot test --type behavioral (LLM: does the persona catch
     the SQL injection?)
  5. agentboot cost-estimate (projected monthly cost)

Submit (PR to personas repo):
  6. Open PR
  7. CI runs: agentboot validate --strict && agentboot lint --severity error
  8. CI runs: agentboot test --ci (pass/fail summary, not full output)
  9. Team reviews (the prompt IS the code)
  10. Merge

Deploy:
  11. CI runs: agentboot build && agentboot sync
  12. Target repos get updated .claude/ via sync PRs
  13. Plugin marketplace gets updated via agentboot publish
```

Before the PR, everything is private. After the PR, CI validation and team review
are fair game. This is not a new model -- it is the code workflow applied to prompts.

### 5.2 Type 2: Developer Conversations

Developer conversations are always private. There is no submit moment. The
optimization tools for developer prompts work through:

1. **Personas** -- structured prompts that work better than ad-hoc questions
2. **Skills** -- prompt templates with argument hints (`/explain-code src/auth/middleware.ts "why is there a double-check on token expiry?"`)
3. **`/insights`** -- private analytics on prompting patterns (rephrase rate,
   specificity trend, persona discovery, cost awareness)
4. **`/prompting-tips`** -- a lightweight personal skill with example patterns
   (INSTEAD OF "fix the bug" TRY "the test in auth.test.ts:47 fails with...")
5. **Always-on hints** -- ~50 tokens in CLAUDE.md with contextual prompting guidance

None of these require collecting, transmitting, or surfacing developer prompts.
They work by giving developers better tools so their prompts are effective from
the start, and private feedback so they can improve over time.

### 5.3 Prompt Ingestion

`agentboot add prompt` is the on-ramp from informal sharing to governed content:

```bash
# Raw text
agentboot add prompt "Always check null safety before DB calls"

# From a file
agentboot add prompt --file ~/Downloads/tips.md

# From clipboard
agentboot add prompt --clipboard

# From a URL
agentboot add prompt --url https://blog.example.com/gotchas

# Interactive
agentboot add prompt --interactive
```

The classifier analyzes the input and suggests the right type:

| Signal in the Prompt | Classified As | Destination |
|---|---|---|
| "Always...", "Never...", "Verify that..." | Rule / Gotcha | `.claude/rules/` |
| Technology-specific warning with examples | Gotcha (path-scoped) | `.claude/rules/` with `paths:` |
| Behavioral stance ("be skeptical", "cite sources") | Trait | `core/traits/` |
| Complete review workflow with output format | Persona | `core/personas/` |
| Single-use instruction | Session instruction | Not persisted |
| Vague/motivational ("write good code") | Rejected | Suggestion for improvement |

The classification uses a Haiku API call (fast, cheap). The developer sees a preview
with actions: save as gotcha, save as trait, add to existing persona, save to
personal rules, or dry run to see it in context.

Dry run mode shows what would happen without writing anything: classification,
destination, lint results, and token impact. This is the safe way to evaluate
someone else's prompt before incorporating it.

### 5.4 Batch Ingestion

For orgs migrating from existing CLAUDE.md files:

```bash
agentboot add prompt --file .claude/CLAUDE.md --batch
```

This decomposes an 800-line CLAUDE.md into proper AgentBoot structure:
- 12 instructions become path-scoped gotcha rules
- 8 become composable traits
- 3 belong in specific persona definitions
- 18 stay as always-on rules in CLAUDE.md
- 4 are too vague and need rewriting
- 2 are org-specific and should not be shared

The developer reviews each classification before any files are written.

`agentboot discover` performs this at scale across the entire org, scanning all
repos and producing a consolidated migration plan.

### 5.5 Continuous Optimization Loop

Metrics feed back into prompt improvements in a structured weekly cycle:

```
Write/Edit -> Lint -> Build -> Deploy
  persona                       |
                            Telemetry
                                |
                           Metrics -> Review (weekly) -> Repeat
```

1. Pull metrics: `agentboot metrics --period 7d`
2. Identify outliers (high false positive rates, high token usage, low invocation,
   Opus usage that could be Sonnet)
3. Update prompts based on findings
4. Run tests to verify no regression
5. Lint to check quality
6. Deploy: `agentboot build && agentboot sync`

The `/optimize` skill (planned for V2+) automates parts of this: analyzing
telemetry and suggesting prompt compression opportunities, model downgrade
candidates, false positive patterns, and coverage gaps.

---

## 6. Onboarding Design

### 6.1 Setup Wizard Question Flow

The `agentboot setup` wizard adapts to the user's role:

**Solo developer (3 questions):**
```
Q1: What's your role? -> Developer
Q2: What AI coding tool? -> Claude Code
Q3: Does your org have AgentBoot? -> I'm solo
-> Quick Start: creates .claude/ with core personas in current repo
```

**Developer joining existing org (4 questions):**
```
Q1: Role -> Developer
Q2: Tool -> Claude Code
Q3: Org has AgentBoot? -> Yes (or auto-detected)
Q4: How to connect? -> Auto-detect (managed settings, .claude/, marketplace)
-> Connected. Try /review-code.
```

**Platform team (7 questions):**
```
Q1: Role -> Platform team
Q5: How many developers? -> Department (20-100)
Q6: What tools? -> Claude Code only
Q6.5: Scan existing content? -> Yes (runs agentboot discover)
Q7: Compliance requirements? -> SOC 2
-> Standard Setup with org scaffold + SOC 2 hooks
```

**IT admin (4 questions):**
```
Q1: Role -> IT / Security
Q8: What MDM? -> Jamf
-> Enterprise Setup with managed settings for Jamf deployment
```

The wizard auto-detects as much as possible before asking: git remote for org name,
`.claude/` for existing setup, managed settings on disk, `claude --version` for CC
installation.

### 6.2 First-Session Experience

The first session in a repo with AgentBoot personas presents:

1. **Welcome fragment** (~80 tokens in CLAUDE.md): persona names with one-line
   descriptions, invocation examples, and privacy assurance
2. **Available personas**: listed via the `/` slash command interface, each with
   a description and argument hint
3. **Privacy note**: "Your conversations are private" linked to the privacy policy

The welcome fragment is not a pop-up, modal, or separate tutorial. It is part of
the CLAUDE.md that loads as context, so Claude Code naturally incorporates it into
its first response if relevant. After a few sessions, it fades into background
context.

### 6.3 /learn Skill Interaction Design

The `/learn` skill provides contextual help, not a static tutorial:

**Topic browser (no arguments):**
```
$ /learn

  What would you like to learn about?

  Getting Started
  +-- How to write effective prompts
  +-- How code review personas work
  +-- How to read persona findings
  +-- Your first AI-assisted PR

  Going Deeper
  +-- Customizing personas for your team
  +-- Writing your own gotchas rules
  +-- Understanding traits and composition
  +-- Cost optimization tips

  Quick Reference
  +-- All available personas
  +-- Privacy model
  +-- Getting help

  Or ask me anything: /learn how do I review only one file?
```

**Contextual answer (with argument):**
```
$ /learn how do I review only one file?

  To review a specific file:
    /review-code src/auth/login.ts

  You can also review a specific function:
    "Review the getUserById function in src/services/user-service.ts
     for null safety and error handling"

  Tip: specific requests give better results.
```

**Resources (curated external links):**
```
$ /learn resources

  Beginner
  +-- Anthropic: "Getting Started with Claude Code"
  +-- Anthropic: "Common Workflows"

  Intermediate
  +-- Anthropic: "Using CLAUDE.md Files"
  +-- Anthropic: "Skills and Agent Skills"

  Advanced
  +-- Anthropic: "Hooks Reference"
  +-- Trail of Bits: "Claude Code Config"
```

The `/learn` skill has `disable-model-invocation: true` in its frontmatter,
meaning it provides structured content without making an additional LLM call.
The responses are pre-authored in the skill content, organized by topic.

### 6.4 Contextual Tips

AgentBoot can generate optional tips in persona output when patterns suggest the
developer is new:

**First invocation of a persona:**
```
[INFO] First time using /review-code? Tip: ask follow-up questions
about any finding. "Why is this an ERROR?" or "Show me how to fix this."
```

**Vague prompt detected:**
```
[TIP] Your prompt "review this" could be more effective as:
"Review src/api/users.ts for the changes I made to pagination."
Specific prompts -> specific, useful findings.
```

**Rephrase pattern detected:**
```
[TIP] You might be looking for a more specific answer. Try:
- Pointing to a specific file or function
- Describing what you expected vs. what happened
- Asking for an example instead of an explanation
```

Design constraints on contextual tips:
- Generated by the persona itself (part of the persona prompt, not a separate system)
- Triggered by pattern matching, not surveillance
- Rate-limited: maximum one tip per session to avoid annoyance
- Disableable by the developer (`/config` -> tips: off)

### 6.5 Team Onboarding Checklist

For platform teams rolling out AgentBoot, a generated checklist:

```bash
$ agentboot onboarding-checklist

  New Developer Onboarding Checklist

  [ ] Claude Code installed and authenticated
      Run: claude --version

  [ ] Org plugin installed (or managed settings active)
      Run: /plugin list | grep acme

  [ ] Try your first code review
      Make a small change, then: /review-code

  [ ] Try your first test generation
      Pick a file: /gen-tests src/services/user-service.ts

  [ ] Explore available personas
      Type / in Claude Code to see all skills

  [ ] (Optional) Set up personal preferences
      ~/.claude/CLAUDE.md for personal instructions

  [ ] (Optional) Run /insights after your first week
```

This checklist is generated from the org's actual AgentBoot config -- the persona
names, skill invocations, and plugin names are real, not generic examples. It can
be exported as markdown or email for distribution.

### 6.6 Org-Authored Onboarding Content

The org's platform team can add custom onboarding content specific to their stack:

```
org-personas/
+-- onboarding/
    +-- welcome.md      # First-session content (added to CLAUDE.md)
    +-- tips.md         # Tips for /learn skill
    +-- resources.md    # Org-specific resource links
```

Example org tips:

```markdown
## Acme-Specific Tips

- Our code reviewer checks for our API versioning convention. If you get
  a WARN about missing version headers, see: confluence.acme.com/api-versioning

- The security reviewer is strict about SQL parameterization. This is
  because we had a production incident. It is not optional.

- For database work, the Postgres gotchas rules activate automatically.
  Read them: .claude/rules/gotchas-postgres.md
```

This is institutional knowledge transfer encoded, version-controlled, and available
around the clock.

---

## 7. Uninstall Design

### 7.1 Non-Destructive Guarantee

If someone asks "how do I get rid of AgentBoot?", the answer should be one command,
not a scavenger hunt.

```bash
agentboot uninstall --repo my-org/api-service    # Single repo
agentboot uninstall --all-repos                  # All synced repos
agentboot uninstall --plugin                     # Remove CC plugin
agentboot uninstall --managed                    # Generate IT removal instructions
agentboot uninstall --everything                 # Full removal
agentboot uninstall --dry-run                    # Preview what would change
```

The uninstall command removes exactly what AgentBoot manages and nothing else.
Files authored locally by the team are never touched.

### 7.2 Manifest Tracking

During sync, AgentBoot writes `.claude/.agentboot-manifest.json` listing every file
it manages:

```json
{
  "managed_by": "agentboot",
  "version": "1.2.0",
  "synced_at": "2026-03-19T14:30:00Z",
  "files": [
    { "path": "agents/code-reviewer/CLAUDE.md", "hash": "a3f2..." },
    { "path": "skills/review-code/SKILL.md", "hash": "7b1c..." },
    { "path": "traits/critical-thinking.md", "hash": "e4d8..." }
  ]
}
```

Uninstall removes exactly the files in the manifest. If a managed file was modified
after sync (hash mismatch), uninstall warns: "This file was synced by AgentBoot but
has been modified locally. Remove anyway? [y/N]"

### 7.3 Pre-AgentBoot Archive

When `agentboot discover` + migrate first runs, it archives the repo's original
agentic files to `.claude/.agentboot-archive/`. Uninstall can restore them:

```
Restore pre-AgentBoot state:
  AgentBoot discovered and archived your original files during setup.
  Archive location: .claude/.agentboot-archive/
  +-- CLAUDE.md.pre-agentboot          (original, 812 lines)
  +-- copilot-instructions.md.pre-agentboot

  [1] Restore originals from archive
  [2] Don't restore (start fresh)
  [3] Show diff between original and current
```

This is the "undo" for the entire AgentBoot adoption. The org gets back exactly
what they had before.

### 7.4 Mixed Content Handling

If CLAUDE.md has both AgentBoot-generated `@imports` and manually authored content,
uninstall separates them:

```
Requires attention:
  .claude/CLAUDE.md contains both AgentBoot content AND manual edits.
  +-- Lines 1-45: AgentBoot @imports and generated content
  +-- Lines 46-78: Manually added by your team

  [1] Remove AgentBoot content, keep manual edits
  [2] Keep entire file as-is (manual cleanup later)
  [3] Show me the diff
```

The developer reviews the result before anything is written.

### 7.5 Managed Settings Removal

AgentBoot cannot remove MDM-deployed files (that requires IT). The `--managed` flag
generates instructions:

```
Managed settings removal requires IT action:

macOS (Jamf):
  Remove profile: "AgentBoot Managed Settings"
  Files to remove:
    /Library/Application Support/ClaudeCode/managed-settings.json
    /Library/Application Support/ClaudeCode/managed-mcp.json
    /Library/Application Support/ClaudeCode/CLAUDE.md

Paste these instructions into a ticket to your IT team.
```

### 7.6 "Easy Exit Builds Trust for Easy Entry"

This principle is not just a tagline. It is a strategic design decision.

An org evaluating AgentBoot has a legitimate concern: "What if this does not work
out? How hard is it to remove?" The answer needs to be: "One command. It tracks
what it manages, archives what it replaces, and restores what was there before.
No vendor lock-in, no orphaned files, no scavenger hunt."

An org that knows they can cleanly remove the tool in one command is more willing
to try it. The uninstall experience is part of the sales pitch, not an afterthought.

---

## 8. Brand & Positioning

### 8.1 "The Easy Button for Agentic Development Teams"

Primary tagline (to be workshopped): **"The Easy Button for Agentic Development Teams."**
Audience-specific alternatives are used when the audience is known (e.g., "The Spring
Boot of AI Agent Governance" for Java-familiar audiences).

Spring Boot took opinionated defaults and convention-over-configuration to the
Java ecosystem. Before Spring Boot, configuring a Java web application required
hundreds of lines of XML. After Spring Boot, a single annotation got you a working
application with sensible defaults and escape hatches for customization.

AgentBoot applies the same philosophy to AI agent governance. Before AgentBoot,
governing AI behavior across an org requires manually maintaining CLAUDE.md files
in every repo, writing custom hooks from scratch, and hoping developers follow
guidelines. After AgentBoot, `agentboot setup` gets you working personas with
built-in governance, distributed automatically.

The analogy communicates:
- **Opinionated defaults.** AgentBoot ships with strong opinions about how personas
  should work, how privacy should be handled, and how content should be structured.
  These opinions are overridable, not mandatory.
- **Convention over configuration.** Standard directory structures, standard trait
  format, standard build pipeline. You do not need to configure what you do not
  customize.
- **It is a build tool, not a runtime.** AgentBoot compiles and distributes. It does
  not run at query time. This is a strength, not a limitation.

### 8.2 Agent-Agnostic Content, CC-First Delivery

The name is "AgentBoot," not "ClaudeBoot." The content (traits, personas, gotchas)
is intentionally agent-agnostic. The delivery is honestly CC-first.

This means:
- Traits are pure markdown behavioral instructions with no agent-specific syntax
- Personas use the agentskills.io cross-platform standard
- Gotchas use glob-based path patterns supported by all major tools
- The build system produces CC-native, Copilot, and Cursor output from the same
  source

But also:
- CC users get hooks, managed settings, plugin marketplace, subagent isolation
- Non-CC users get the content with advisory-only enforcement
- Some of the most valuable features (compliance hooks, managed settings,
  `context: fork`) are CC-only
- This is documented honestly rather than hidden

The positioning acknowledges this tension without apologizing for it: "AgentBoot
works best with Claude Code. It also works with Copilot and Cursor. The content is
the same; the enforcement is stronger on CC."

### 8.3 Privacy as Differentiator

In a market where enterprises are deploying AI monitoring tools, AgentBoot takes
the opposite stance: "We will not be the tool that does this."

This is a competitive differentiator, not just a policy:
- Enterprises evaluating AI governance tools will compare AgentBoot's privacy
  architecture against competitors that collect prompts
- Developers who have a choice of tooling will prefer the one that does not
  report their questions
- The privacy stance is verifiable (the `rawPrompts` config fields, the telemetry
  schema with no prompt fields, the open-source code)

The positioning: "Your developers will trust AgentBoot because we optimize from
aggregates, not transcripts."

### 8.4 Prior Art Acknowledgment

AgentBoot's core concepts (composable traits, scope hierarchy, persona governance,
hook-based compliance) were developed independently through real-world use across
personal and family projects that grew organically and were adapted for professional
use. The third-party tools were discovered after the design was complete.

This is parallel evolution, not derivation. Multiple teams independently arrived at
similar patterns because these are natural solutions to the same underlying problems.

Specific acknowledgments:
- **SuperClaude**: Composable trait architecture and cognitive persona patterns.
  The most mature public implementation of the composable-trait approach. MIT
  licensed.
- **ArcKit**: Enterprise governance via hooks, with the most mature public
  hook-as-governance architecture. MIT licensed.
- **Trail of Bits**: Production-hardened hook patterns and the "guardrails, not
  walls" philosophy. Their config work articulates what AgentBoot independently
  concluded. Their skills are licensed CC-BY-SA-4.0.

The tone is respectful and honest: "They got there first and in several cases did
it better. We acknowledge their prior art and seek to partner rather than compete."

### 8.5 Origin Story

AgentBoot grew from personal and family projects -- practical AI tooling built for
real use, not as an academic exercise. Those projects evolved organically, handling
increasingly complex scenarios. When similar needs appeared at work, the patterns
were adapted for professional engineering teams with multi-repo governance, compliance
requirements, and organizational scale.

This origin matters for positioning because:
- It explains why the tool handles both simple (personal project) and complex
  (enterprise org) use cases
- It grounds the design in actual use rather than theoretical planning
- It establishes that the patterns were validated before being generalized

---

## 9. Licensing & Attribution Design

### 9.1 Apache 2.0 for Core

AgentBoot core is licensed under Apache 2.0 for these reasons:
- Maximum adoption (no friction for enterprise legal teams)
- Explicit patent grant (enterprise legal appreciates this over MIT)
- Compatible with all tools in the ecosystem (SuperClaude MIT, ArcKit MIT,
  spec-kit MIT)
- Allows orgs to create proprietary domain layers on top
- Standard for developer tooling

### 9.2 Domain Layers Carry Their Own Licenses

Domain layers are opt-in and can have different licenses than core:

| Layer | License | Reason |
|-------|---------|--------|
| AgentBoot core | Apache 2.0 | Maximum adoption + patent grant |
| Org-specific layers | Proprietary (org's choice) | Contains org IP |
| Community domain layers | Apache 2.0 or MIT | Community contribution |
| Trail of Bits security skills (if bundled) | CC-BY-SA-4.0 | Required by upstream |
| Healthcare compliance domain | Contributor's choice | Depends on contributor |

Key rule: AgentBoot core must never depend on non-permissive code. Domain layers
are opt-in. The build system includes license metadata in compiled output so orgs
know what they are distributing.

### 9.3 License Compatibility Matrix

| Upstream License | Can AgentBoot bundle it? | Requirements |
|-----------------|------------------------|-------------|
| MIT | Yes | Include license text |
| Apache 2.0 | Yes (same license) | Include license + NOTICE |
| CC-BY-4.0 | As domain layer only | Attribution |
| CC-BY-SA-4.0 | As domain layer only | Attribution + ShareAlike (derivatives must use same license) |
| GPL-3.0 | No (core) | Viral -- cannot be composed with Apache 2.0 core |

### 9.4 ACKNOWLEDGMENTS.md Structure

AgentBoot maintains an ACKNOWLEDGMENTS.md at the repo root with four categories:

```markdown
# Acknowledgments

AgentBoot was developed independently through real-world use across
personal projects and engineering teams.

## Prior Art
Projects that independently developed overlapping patterns.
- SuperClaude Framework (MIT) -- composable traits, cognitive personas
- ArcKit (MIT) -- hook-as-governance architecture
- Trail of Bits claude-code-config -- "guardrails, not walls" philosophy

## Complementary Tools
Adjacent projects that work alongside AgentBoot.
- spec-kit (MIT) -- spec-driven development
- Trail of Bits skills (CC-BY-SA-4.0) -- security audit skills

## Standards
- agentskills.io -- open standard for agent skills

## Community
- awesome-claude-code -- community curation
```

### 9.5 Contributor Attribution in Content Frontmatter

Every marketplace item carries attribution in its frontmatter:

```yaml
---
trait: gdpr-awareness
version: 2.1.0
license: Apache-2.0
author:
  name: Jane Doe
  github: janedoe
  org: Acme Corp
attribution:
  - name: Jane Doe
    contribution: "Initial implementation"
  - name: Bob Smith
    contribution: "Added right-to-deletion rules"
---
```

Attribution is permanent and travels with the content through compilation and
distribution.

### 9.6 CC-BY-SA-4.0 Handling for Trail of Bits Skills

Trail of Bits skills are licensed CC-BY-SA-4.0, which requires:
- Attribution (credit Trail of Bits in any distribution)
- ShareAlike (any derivative work must use the same license)

This means AgentBoot cannot relicense ToB skills as Apache 2.0. If AgentBoot
distributes them as a domain layer, that domain layer must carry CC-BY-SA-4.0.
The build system must include the full CC-BY-SA notice in any output that contains
ToB content.

This is fine -- domain layers can have different licenses than core. The license
metadata in compiled output makes this transparent to orgs.

---

## 10. Open Questions

Open questions discovered during design have been resolved or deferred.
See the internal tracking document for remaining items.

Key resolved decisions applied to this design:
- Escalation and /insights are separate processes
- includeDevId transitions are forward-only and intentionally onerous
- CI-mode is a different privacy context — attribute to CI user with PR traceability
- Hashed developer ID uses salted hash (BYOS — org provides salt via secrets manager)
- Welcome fragment includes removal-after-first-use when implemented
- Non-interactive CLI outputs config file for CI use
- Telemetry offered as option to keep or delete on uninstall
- In-flight sync PRs: best effort close via gh, report if unable
- Audience-specific catchphrases. Default: "The Easy Button for Agentic Development Teams"
- No public opinions on AI regulation outside the already opinionated product
