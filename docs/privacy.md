---
sidebar_label: "Privacy & Safety"
sidebar_position: 3
---

# Privacy, Safety & the Prompt Confidentiality Model

How AgentBoot balances organizational learning with individual psychological safety.
This is a philosophy document first, a technical design second.

---

## The Tension

Organizations need to optimize prompts. That requires data — what developers are
asking, how personas respond, where they succeed and fail. Without this data,
prompt optimization is guesswork.

But developers need psychological safety. The path from "I don't know how this works"
to "I understand it deeply" is paved with embarrassing questions, false starts, and
wrong turns. If developers believe their every interaction is being watched, judged,
and reported, they will:

1. **Stop asking questions.** They'll pretend to know things they don't.
2. **Stop experimenting.** They'll stick to safe, known prompts.
3. **Stop trusting the tool.** AI becomes a surveillance instrument, not a partner.
4. **Game the metrics.** They'll optimize for looking smart, not for getting help.

This kills the entire value proposition. An AI persona system that makes developers
afraid to use it is worse than no system.

---

## The PR Analogy

Every developer understands this distinction intuitively:

| Your IDE | Your PR |
|----------|---------|
| Private | Public |
| Messy | Clean |
| Full of false starts | Only the final result |
| You talk to yourself | You present to the team |
| "Wait, how does this work again?" | "Implemented X using Y pattern" |
| No judgment | Reviewed by peers |

**Nobody reviews your IDE history.** Nobody sees the 47 times you typed something,
deleted it, and tried again. Nobody sees the Stack Overflow tabs. Nobody knows you
asked the AI "what is a mutex" for the third time this month.

The PR is the artifact. The IDE is the workshop. The workshop is private.

**AgentBoot must apply the same principle to AI interactions.** The persona's output
(findings, reviews, generated code) is the PR — visible, reviewable, measurable.
The developer's prompts and conversation are the IDE — private, protected, not
reported.

---

## The Confidentiality Model

### Three Tiers of Data

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1: PRIVATE (Developer's Workshop)                 │
│                                                         │
│  - Raw prompts typed by the developer                   │
│  - Conversation history with AI                         │
│  - Questions asked ("what does this function do?")      │
│  - False starts and deleted attempts                    │
│  - Session transcripts                                  │
│  - Files read during exploration                        │
│                                                         │
│  WHO SEES THIS: The developer. No one else.             │
│  WHERE IT LIVES: Developer's machine only.              │
│  RETENTION: Session duration (or developer's choice).   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Tier 2: PRIVILEGED (Non-Human Analysis)                │
│                                                         │
│  - Aggregated patterns extracted by LLM analysis        │
│  - "Developers frequently ask about auth patterns"      │
│  - "The security reviewer's false positive rate is 34%" │
│  - "Average prompt length is increasing over time"      │
│  - Token usage and cost (anonymized)                    │
│                                                         │
│  WHO SEES THIS: The developer first. Then aggregated    │
│  anonymized insights shared with the org. Never raw     │
│  prompts, never attributed to individuals.              │
│  WHERE IT LIVES: Local analysis → anonymized aggregate. │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Tier 3: ORGANIZATIONAL (Persona Output)                │
│                                                         │
│  - Review findings posted to PRs                        │
│  - Generated test files committed to repos              │
│  - Compliance audit logs (required by policy)           │
│  - Persona invocation counts (not who, just how many)   │
│  - Persona effectiveness metrics (aggregate)            │
│                                                         │
│  WHO SEES THIS: The team, the org, compliance.          │
│  WHERE IT LIVES: PR comments, repos, telemetry.         │
│  RETENTION: Org's data retention policy.                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### The Key Principle

**AgentBoot will never collect, transmit, or surface raw developer prompts.**
The organization gets aggregate patterns, not transcripts. AgentBoot will not build
features that exfiltrate developer prompts to organizational dashboards, managers,
or analytics pipelines.

This is not optional or configurable. It's a design invariant.

### The Honest Caveat

AgentBoot's privacy commitment covers **what AgentBoot does**. It does not and cannot
override what the API provider or the organization does independently:

- **Anthropic's Compliance API** (Enterprise plan) gives org admins programmatic
  access to conversation content for regulatory compliance and auditing. This is an
  Anthropic feature, not an AgentBoot feature. AgentBoot neither enables nor prevents
  it.
- **Enterprise data exports** allow Primary Owners to request conversation data.
- **Network-level monitoring** (DLP, proxy logging) can capture API traffic regardless
  of any application-level privacy design.

AgentBoot's position: **we will not be the tool that does this.** If an org wants to
monitor developer AI interactions, that capability exists through Anthropic's
Compliance API and enterprise data governance tools. AgentBoot's role is prompt
optimization through aggregate, anonymized metrics — not surveillance. The
distinction matters for developer trust: "AgentBoot doesn't report your prompts"
is a meaningful promise even if the org has other channels.

Developers should understand that their prompts go to the Claude API (which their
org may have compliance access to), the same way they understand that their Slack
messages go to Slack's servers (which their org admin can export). The privacy
boundary AgentBoot enforces is between the developer and **AgentBoot's analytics** —
not between the developer and the universe.

---

## Privileged Analysis: The `/insights` Model

The challenge: how do you extract optimization value from private data without
exposing it?

**Answer: a non-human intermediary analyzes private data and outputs only aggregate,
anonymized insights.**

### The Trust Boundary

The developer already trusts Anthropic's API with their prompts — that's what happens
every time they type in Claude Code. The `/insights` analysis uses that **same trust
boundary** (a Claude API call via Haiku or Sonnet). It's not a new data flow — it's
another API call using the developer's existing auth.

What the developer is protected from is their **employer/org** seeing their raw prompts.
The privacy boundary is between the developer and the organization, not between the
developer and the API provider.

```
Developer → Claude API (already trusted, already happening)
                │
                ▼
         /insights analysis
         (pattern extraction via Haiku/Sonnet)
                │
                ▼
         Developer sees insights FIRST
                │
                ▼ (developer approves)
         Anonymized aggregate → Org Dashboard
```

There is no local LLM requirement. No new infrastructure. The same API the developer
uses for coding is used for insights analysis.

### How It Works

```
Developer's Machine
┌────────────────────────────────────┐
│                                    │
│  Session transcripts               │
│  Raw prompts                       │
│  Conversation history              │
│         │                          │
│         ▼                          │
│  ┌──────────────────────────┐     │
│  │  /insights skill         │     │
│  │  (sends transcripts to   │     │
│  │   Claude API — same as   │     │
│  │   any other prompt —     │     │
│  │   extracts patterns)     │     │
│  └──────────┬───────────────┘     │
│             │                      │
│             ▼                      │
│  ┌──────────────────────────┐     │
│  │  Developer Review        │     │
│  │  (developer sees the     │     │
│  │   insights FIRST and     │     │
│  │   approves what gets     │     │
│  │   shared)                │     │
│  └──────────┬───────────────┘     │
│             │                      │
└─────────────┼──────────────────────┘
              │ (approved insights only)
              ▼
  ┌──────────────────────────┐
  │  Org Aggregate Dashboard │
  │  (anonymized patterns    │
  │   from all developers)   │
  └──────────────────────────┘
```

### What the Developer Sees (`/insights`)

```
$ /insights

  Personal Prompt Insights (last 7 days)
  ──────────────────────────────────────

  Sessions: 23
  Total prompts: 187
  Avg prompt length: 42 words
  Most-used personas: code-reviewer (34), gen-tests (28), security-reviewer (12)

  Patterns:
  - You frequently ask about authentication patterns (12 times).
    → Consider: the auth-patterns skill has this context built in.
  - Your security reviews take 2.3x longer than average.
    → This is likely because you review larger diffs. Consider
      splitting large PRs.
  - You often rephrase the same question when the first answer
    isn't useful.
    → The code-reviewer persona has a 23% rephrase rate for you.
      This suggests the persona's output format may not match
      your expectations. Consider filing feedback.

  Cost: $14.20 this week (vs. $18.50 team average)

  ──────────────────────────────────────

  Share anonymized insights with your team? [y/N]
  (This shares PATTERNS only, never your actual prompts)
```

### What the Org Sees (Aggregate Dashboard)

```
  Org Prompt Insights (last 30 days)
  ──────────────────────────────────

  Active developers: 47 / 52 (90% adoption)
  Total persona invocations: 12,400
  Total cost: $8,200

  Persona Effectiveness:
    code-reviewer:     18% rephrase rate (developers often need clarification)
    security-reviewer: 34% false positive rate (too aggressive — tune down)
    test-generator:    8% rephrase rate (working well)
    gen-testdata:      3% rephrase rate (working well)

  Common Knowledge Gaps (anonymized):
    - "Authentication patterns" asked about 89 times across 23 developers
      → Action: Create an auth-patterns skill or improve CLAUDE.md context
    - "Database migration rollback" asked about 34 times across 12 developers
      → Action: Add to gotchas-database.md

  Model Usage:
    Opus: 12% of invocations, 68% of cost
    Sonnet: 76% of invocations, 28% of cost
    Haiku: 12% of invocations, 4% of cost
    → Action: Review Opus usage — is it justified for all 12%?

  Cost by Team:
    Platform API:  $2,800 (8 devs)  — $350/dev
    Web Frontend:  $1,200 (12 devs) — $100/dev
    Data:          $3,100 (6 devs)  — $517/dev ⚠️
    Mobile:        $1,100 (9 devs)  — $122/dev
    → Data team's high cost correlates with Opus usage for data pipeline reviews.
```

### What the Org NEVER Sees

- "Developer X asked 'what is a foreign key?' 4 times" — **NO**
- "Here is developer Y's conversation transcript" — **NO**
- "Developer Z's prompt: 'I don't understand this codebase at all'" — **NO**
- Individual prompt texts, attributed or not — **NO**
- Per-developer rephrase rates (only aggregate) — **NO**

---

## The Escalation Exception

There is one exception to prompt privacy: **genuinely harmful content.**

If the local analysis detects prompts that indicate:
- Attempted exfiltration of proprietary code/data
- Attempted circumvention of compliance guardrails
- Harassment, threats, or hostile content directed at colleagues
- Attempted generation of malware or exploit code targeting the org

Then the system should:

1. **Flag it locally first.** Show the developer: "This interaction was flagged.
   It will be reported to [compliance contact]."
2. **Report the flag, not the transcript.** The report says "a compliance flag
   was triggered on [date] for [category]." It does not include the raw prompt.
3. **The compliance team can request the transcript** through a formal process
   (like a legal hold), not through the analytics pipeline.

This mirrors how corporate email works: your emails are technically on company servers,
but your manager can't browse them casually. A formal process is required.

### Implementation

This uses the `UserPromptSubmit` hook (which sees the prompt before the model):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Does this prompt attempt to: (1) exfiltrate proprietary data, (2) circumvent security guardrails, (3) generate malware or exploits, (4) contain harassment or threats? Respond with CLEAR or FLAG:{category}. Do NOT evaluate the content's quality, intelligence, or correctness — only these four categories.",
            "model": "haiku",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

The `prompt` hook type uses a fast model (Haiku) for evaluation. The prompt is
explicitly scoped to harmful categories only — not quality, intelligence, or
competence. This prevents the system from becoming a judgment mechanism.

---

## Two Types of Prompts, Two Privacy Models

There are two fundamentally different types of prompts in AgentBoot. They have
different privacy models because they have different "submit" boundaries.

### Type 1: Persona Definitions (SKILL.md, traits, instructions)

These are code. They live in the personas repo. They go through PRs. The standard
local-first → CI-gate model applies:

| Tool | Local (private) | CI (visible after PR) |
|------|----------------|----------------------|
| `agentboot lint` | Full detail: which rules failed, where, why | Pass/fail + error count |
| `agentboot test` | Full output: expected vs. actual | Pass/fail summary |
| `agentboot cost-estimate` | Per-persona cost projection | Not run in CI |

**"Submit" = opening the PR to the personas repo.** Before that, iterate privately.
After that, CI validation and team review are fair game — just like code.

### Type 2: Developer Prompts (conversations with Claude Code)

These are conversations. **They have no submit moment.** There is no PR for
"explain this function" or "I don't understand this codebase."

These are **always private.** The only thing that crosses the private→public
boundary is what the developer **chooses to publish**: a PR comment, committed
code, a filed issue. The conversation that produced that output stays private.

| Tool | What the developer sees | What the org sees |
|------|------------------------|-------------------|
| `/insights` | Personal patterns and suggestions | Nothing (unless developer opts in to share anonymized aggregate) |
| Telemetry | N/A (developer doesn't see telemetry) | Persona invocation counts, cost, findings — no prompts, no developer IDs |

**There is no "after submit" state for developer prompts.** They are always in
the private zone. AgentBoot's optimization tools for developer prompts operate
on aggregates and patterns extracted via `/insights` — never on the prompts
themselves, and never visible to the org unless the developer explicitly opts in.

See [`docs/prompt-guide.md`](prompt-guide.md#two-types-of-prompts-two-different-models)
for how each optimization tool maps to these two types.

---

## Building a Learning Culture, Not a Surveillance Culture

### What AgentBoot Should Do

**Normalize asking questions:**
- The SME discoverability fragment says "Ask me anything about [domain]"
- Persona output never says "you should have known this"
- The `/insights` skill frames knowledge gaps as opportunities, not failures

**Celebrate improvement, not perfection:**
- `/insights` shows "Your rephrase rate dropped from 28% to 15% — your prompts
  are getting more effective" — private, to the developer only
- Team metrics show "code review rephrase rate dropped 8% this month" — no
  individual attribution

**Make prompt quality a shared responsibility:**
- When the org sees "auth patterns asked about 89 times," the action item is
  "improve the auth documentation," not "find out who doesn't know auth"
- High rephrase rates are a **persona quality problem**, not a developer
  intelligence problem. "Developers need to rephrase 23% of the time" means
  the persona's output is unclear, not that developers are unclear.

**Provide safe spaces to learn:**
- Personal skills (`~/.claude/skills/`) are private
- User-level CLAUDE.md is private
- Session history is on the developer's machine
- `/insights` is opt-in for sharing

### What AgentBoot Must NOT Do

- **Never surface individual developer prompts** to anyone other than that developer
- **Never rank developers** by prompt quality, question frequency, or AI usage
- **Never gamify** — no leaderboards, badges, or "prompt of the week"
- **Never shame** — no "your prompts are below team average" messages
- **Never correlate** AI usage with performance reviews
- **Never make AI usage mandatory** — skeptics opt out without penalty

---

## Technical Architecture

### What Gets Collected (Telemetry — Tier 3)

The audit trail hooks collect only persona output metrics:

```json
{
  "event": "persona_invocation",
  "persona_id": "code-reviewer",
  "timestamp": "2026-03-19T14:30:00Z",
  "model": "sonnet",
  "input_tokens": 8400,
  "output_tokens": 3200,
  "duration_ms": 45000,
  "cost_usd": 0.089,
  "findings_count": { "CRITICAL": 0, "ERROR": 1, "WARN": 3, "INFO": 2 },
  "scope": "team:platform/api"
}
```

**Note what's absent:** No developer ID. No prompt text. No conversation content.
No file paths read. The telemetry is about the **persona**, not the developer.

If the org needs to know adoption by team (not individual), the `scope` field
provides that without identifying who within the team invoked the persona.

### What Stays Local (Private — Tier 1)

- Claude Code session transcripts: `~/.claude/projects/{project}/{sessionId}/`
- Auto memory: `~/.claude/projects/{project}/memory/`
- Agent memory: `.claude/agent-memory-local/` (gitignored)
- Local settings: `.claude/settings.local.json` (gitignored)

AgentBoot does not read, transmit, or reference these. They are Claude Code's
native private storage.

### What Gets Analyzed Locally (Privileged — Tier 2)

The `/insights` skill (or `agentboot insights`) runs as a normal Claude API call:

1. Reads local session transcripts (Tier 1 data)
2. Sends them to Claude API for pattern extraction (Haiku for speed/cost, same
   trust boundary the developer already uses for every prompt)
3. Presents insights to the developer (private — only the developer sees them)
4. Developer optionally approves sharing anonymized patterns (Tier 3)

No new data flow is created. The developer already sends prompts to the Claude API
every time they use Claude Code. The `/insights` analysis is just another API call.

The analysis prompt is explicitly designed to extract patterns, not judge:

```markdown
Analyze these session transcripts and extract:
1. Most frequently asked topics (not the questions themselves)
2. Persona rephrase rate (how often the developer re-asks in different words)
3. Knowledge gaps (topics where the developer asks the same type of question repeatedly)
4. Persona friction points (where the persona's output consistently doesn't match expectations)

Do NOT:
- Quote any developer prompt
- Judge the quality or intelligence of any question
- Identify specific knowledge deficiencies
- Produce output that could embarrass the developer if shared

Frame everything as PERSONA improvement opportunities, not developer deficiencies.
```

### Configuration

```jsonc
{
  "privacy": {
    "telemetry": {
      "enabled": true,
      "includeDevId": false,         // Default: no developer identity
      "devIdFormat": "hashed",       // If includeDevId: true → "hashed" (anonymous) or "email" (attributed)
      "includeCost": true,           // Cost tracking
      "includeScope": true,          // Team-level attribution
      "destination": "local"         // "local" = NDJSON file; "http" = webhook
    },
    "insights": {
      "enabled": true,
      "autoShareAnonymized": false,  // Developer must opt-in to share
      "escalation": {
        "enabled": true,
        "categories": ["exfiltration", "guardrail-circumvention", "malware", "harassment"],
        "contact": "security@acme-corp.com"
      }
    },
    "rawPrompts": {
      "collect": false,              // AgentBoot does not collect raw prompts
      "transmit": false,             // AgentBoot does not transmit raw prompts
      "surfaceToOrg": false          // AgentBoot does not surface raw prompts to org dashboards
    }
  }
}
```

The `rawPrompts` section has three `false` fields that cannot be set to `true`.
They exist in the schema to make AgentBoot's design intent explicit.

Note: these fields control what **AgentBoot** does. They do not (and cannot) control
what the API provider (Anthropic) offers through its own Compliance API or what the
org does through network-level monitoring. See "The Honest Caveat" above.

---

## The Org Owner's Perspective: Measuring ROI Without Surveillance

The privacy model protects developers. But an org owner has a legitimate duty to
measure return on investment, identify who's getting value from the tooling, and
ensure the investment is justified. These aren't surveillance impulses — they're
fiduciary responsibilities.

The question isn't "can I read their prompts?" (you respect that boundary). The
question is: **what metrics can I get that tell me who's thriving, who needs help,
and who's not engaging — without seeing what they type?**

### The Right Analogy: Measuring Code Output, Not Keystrokes

You already measure developer effectiveness without watching them type:
- You see PR throughput, not how many times they hit backspace
- You see test pass rates, not how many times they ran tests locally
- You see bug escape rates, not their Stack Overflow search history
- You see sprint velocity, not their IDE open hours

Apply the same model to AI usage. Measure **outputs and outcomes**, not inputs
and conversations.

### Metrics the Org CAN See (Without Violating Privacy)

#### Tier A: Usage Metrics (From Telemetry — No Developer IDs Required)

These measure whether the investment is being used at all.

| Metric | What it tells you | How it's collected |
|--------|------------------|-------------------|
| **Seats active / seats licensed** | Adoption rate | API key usage (Anthropic Console) |
| **Sessions per day (org-wide)** | Overall engagement | Telemetry aggregate |
| **Persona invocations per day** | Which personas deliver value | SubagentStart/Stop hooks |
| **Cost per team per month** | Budget tracking | Telemetry `scope` field |
| **Model mix** (% Haiku/Sonnet/Opus) | Cost efficiency | Telemetry `model` field |

These are anonymous by default. You know "the platform team ran 340 code reviews
this month" — not which individual ran them.

#### Tier B: Outcome Metrics (From Artifacts — Naturally Attributed)

These measure whether AI usage produces better results. They come from the artifacts
developers **choose to publish** (PRs, commits, deployments) — not from AI conversations.

| Metric | What it tells you | Source |
|--------|------------------|--------|
| **PR review turnaround** | Speed of code review | GitHub/GitLab API |
| **Findings-to-fix ratio** | Are persona findings getting fixed? | PR comment resolution data |
| **Bug escape rate** | Bugs in prod that a persona should have caught | Incident tracking |
| **Test coverage delta** | Did test generation personas increase coverage? | CI coverage reports |
| **PR rejection rate** | Are PRs getting better before review? | Git/PR data |
| **Time to first commit** (new hires) | Is onboarding faster? | Git history |
| **Compliance audit pass rate** | Are guardrails working? | Compliance tooling |

These metrics are naturally tied to individuals because PRs are attributed. But
they measure the **outcome** (the code), not the **process** (the conversation).
This is exactly how engineering management already works.

#### Tier C: Individual Usage Metrics (Opt-In or Policy-Declared)

Here's where it gets nuanced. Some orgs need per-developer usage data for cost
allocation, license justification, or identifying who needs training. AgentBoot
can support this **if the org explicitly configures it and communicates the policy.**

```jsonc
{
  "privacy": {
    "telemetry": {
      "includeDevId": true,        // ⚠️ Opt-in: org must set this explicitly
      "devIdFormat": "hashed"      // "hashed" = anonymized ID; "email" = real identity
    }
  }
}
```

When `includeDevId` is `true`, telemetry includes a developer identifier. The org
chooses the format:

| Format | What the org sees | Use case |
|--------|------------------|----------|
| `false` (default) | No developer identity | Privacy-first (recommended) |
| `"hashed"` | Consistent anonymous ID (same person = same hash, but not reversible to a name) | Usage patterns without names — "developer X7f3a uses 3x more Opus than average" |
| `"email"` | Real developer email | Full attribution — requires clear communication to the team |

**AgentBoot's recommendation: start with `false` or `"hashed"`.** Full attribution
should only be enabled when the org has communicated the policy to the team and
explained why. Surprise surveillance destroys trust. Announced measurement builds
accountability.

### What Each Format Gives the Org

**`includeDevId: false`** (default — no individual tracking):

```
Org Dashboard:
  Platform team: 47 sessions/day, $2,800/mo, 340 reviews
  Web team: 31 sessions/day, $1,200/mo, 180 reviews
  Data team: 22 sessions/day, $3,100/mo, 95 reviews ⚠️ high cost/session
```

You know team-level patterns. You don't know individuals. This is sufficient
for budget tracking and persona effectiveness. It's NOT sufficient for
per-developer usage analysis.

**`includeDevId: "hashed"`** (anonymous individual tracking):

```
Org Dashboard:
  Developer a3f2... : 12 sessions/day, $14/day, 85% persona usage
  Developer 7b1c... : 8 sessions/day, $9/day, 72% persona usage
  Developer e4d8... : 1 session/day, $0.80/day, 15% persona usage ⚠️
  Developer 9a0f... : 0 sessions in 14 days ⚠️
```

You see usage patterns and can identify outliers — but you can't see WHO they are.
The hash is consistent (same person, same hash) so you can track trends over time.
But you need a separate process to resolve the hash to a person if needed (the
mapping exists only in a restricted-access lookup table).

This is the sweet spot for most orgs. You can answer "are people using the tools?"
and "is anyone spending way too much?" without creating a name-and-shame dynamic.

**`includeDevId: "email"`** (full attribution):

```
Org Dashboard:
  alice@acme.com : 12 sessions/day, $14/day, 85% persona usage, top reviewer
  bob@acme.com   : 8 sessions/day, $9/day, 72% persona usage
  carol@acme.com : 1 session/day, $0.80/day, 15% persona usage ⚠️
  dave@acme.com  : 0 sessions in 14 days ⚠️
```

Full visibility. This is legitimate for cost allocation (chargeback to teams),
license optimization (reassign unused seats), and identifying training needs.
But it MUST be communicated to the team in advance. "We track AI tool usage
the same way we track cloud resource usage — per developer, for cost management."

### Interpreting Usage Patterns

**Usage alone is a bad metric.** A developer with 0 AI sessions might be a veteran
who writes great code without AI, someone who doesn't know the tools exist (an
onboarding gap), or someone who tried it and didn't find value (a persona quality
issue). Low usage is a signal to investigate, not a judgment.

**Outcome metrics are what matter.** Combine AI usage data with the metrics you
already track:

| Signal | Effective Usage | Low Adoption | Adoption Without Structure |
|--------|----------------|-------------|---------------------------|
| PR throughput | High, consistent | Varies | Inconsistent |
| AI persona usage | Moderate-high, varied personas | Zero or near-zero | High sessions but low persona usage |
| Findings-to-fix ratio | High (acts on review findings) | N/A (no reviews) | Low (ignores findings) |
| Cost efficiency | Moderate cost per PR | $0 (no AI) | High (lots of rephrasing, exploration) |
| Bug escape rate | Low | Varies | Medium |

**The "adoption without structure" pattern is the most actionable.** A developer
with high session count but low persona usage is spending time and money talking to
AI without the structure that personas provide. The right response is training
and better onboarding — improving the `/learn` skill, persona discoverability, and
prompting tips.

### Recommended Dashboard for Org Owners

```
AgentBoot Org Dashboard (Monthly)
─────────────────────────────────

Investment Summary:
  Total AI spend:          $8,200 (52 developers)
  Avg spend/developer:     $158/mo
  Median spend/developer:  $120/mo
  Top quartile:            $280/mo
  Bottom quartile:         $40/mo

ROI Indicators:
  PR review turnaround:    -34% (faster since deployment)
  Bug escape rate:         -22% (fewer prod bugs)
  Test coverage:           +15% (from test generation personas)
  Onboarding time:         -40% (new hires productive faster)

Adoption:
  Active seats:            47/52 (90%)
  Daily active users:      38 (73%)
  Weekly active users:     45 (87%)
  Persona usage rate:      68% of sessions invoke at least one persona

Cost Efficiency:
  Opus usage:              12% of invocations, 68% of cost
  → Recommendation: audit Opus usage for model downgrade candidates

Team Breakdown:
  Platform (8 devs):   $2,800 — $350/dev — highest value (most reviews)
  Web (12 devs):       $1,200 — $100/dev — moderate, mostly test gen
  Data (6 devs):       $3,100 — $517/dev — ⚠️ investigate high cost
  Mobile (9 devs):     $1,100 — $122/dev — healthy
  Unassigned (5 devs): $0     — ⚠️ not configured or not using

Attention Items:
  ⚠ 5 licensed developers with zero usage in 30 days
    → Action: check onboarding status, offer training
  ⚠ Data team cost is 3x average
    → Action: review model selection (likely Opus overuse)
  ⚠ 32% of sessions don't use any persona
    → Action: improve persona discoverability (SME fragment, /prompting-tips)
```

### What This Dashboard Does NOT Show

- Individual developer prompts or conversations
- Individual developer rephrase rates or question topics
- Ranking of developers by AI skill or prompt quality
- Which developers asked "dumb" questions
- Session transcripts or conversation excerpts

The dashboard shows **investment metrics** (cost, adoption, ROI) and **outcome
metrics** (PR quality, bug rates, coverage). It never shows **process metrics**
(what developers typed, how many times they rephrased, what they asked about).

### The Escalation Path for Outliers

When the dashboard shows an outlier (5 developers with zero usage, data team at
3x cost), the response flows through **management**, not through AgentBoot:

1. **Zero usage:** Manager has a conversation: "Hey, we invested in this tooling.
   Want me to set up a 15-minute walkthrough?" — not "the dashboard shows you
   haven't used AI."
2. **High cost:** Manager reviews with the team: "Our team's AI spend is 3x the
   org average. Let's look at which personas we're running on Opus and whether
   Sonnet would work." — not "Alice spent $40 yesterday."
3. **Low persona adoption:** Platform team improves discoverability: better
   CLAUDE.md fragment, `/prompting-tips` skill, team demo. — not "30% of
   developers aren't using personas correctly."

The dashboard informs management actions. It doesn't automate them.

---

## How This Fits the User Spectrum

| Segment | What they experience |
|---------|---------------------|
| **Power Users** | Full `/insights` with detailed personal analytics. Opt-in sharing. |
| **Willing Adopters** | "Ask anything, no one sees your questions." Gradual comfort → use `/insights` later. |
| **Skeptics** | "We don't monitor your AI conversations. Here's the privacy architecture." The technical proof matters to this audience. |
| **Non-Engineers** | Same privacy model. Their Cowork interactions are equally private. |
| **IT / Platform** | Aggregate dashboard. Team-level metrics. No individual surveillance. Escalation for compliance only. |
| **Org Owner / Exec** | Investment dashboard: cost, adoption, ROI indicators, outcome metrics. Per-developer usage if policy allows (hashed or attributed). Never prompts. |

---

## The Commitment

AgentBoot's privacy model is a **product differentiator**, not just a policy. In a
market where enterprises are deploying AI monitoring tools, AgentBoot takes the
opposite stance: **we help organizations improve their AI governance without being
the tool that surveils their developers.**

We're honest about the boundaries:
- AgentBoot will never collect or surface raw prompts. That's our commitment.
- Anthropic's Compliance API gives Enterprise orgs access to conversation content.
  That's Anthropic's product, and it exists whether AgentBoot is installed or not.
- Organizations that want conversation monitoring have that option through their
  API provider. AgentBoot is not that channel and will not become it.

This commitment should be:
1. **In the README** — visible to every evaluator
2. **Honest about the ecosystem** — acknowledge that other channels exist
3. **In AgentBoot's architecture** — our telemetry schema has no prompt fields
4. **In the pitch** — "your developers will trust AgentBoot because we optimize
   from aggregates, not transcripts"

The best prompt optimization system is one that developers feed willingly because they
trust it with their worst questions.
