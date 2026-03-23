---
sidebar_label: "Marketplace"
sidebar_position: 1
---

# AgentBoot Marketplace — Community Sharing & Curation

How developers and organizations contribute, discover, and share traits, personas,
rules, and domain layers through AgentBoot's marketplace ecosystem.

---

## The Vision

Every org building with AgentBoot will eventually write traits, gotchas rules, and
personas that would be useful to other orgs. A healthcare org writes PHI-awareness
traits. A fintech org writes PCI-DSS compliance rules. A platform team writes
Kubernetes deployment gotchas. Today, this knowledge is siloed. The marketplace
makes it shareable.

```
Individual orgs (private)              AgentBoot marketplace (public)
─────────────────────────              ────────────────────────────────

acme-corp/acme-personas                agentboot/marketplace
  └── acme-specific stuff                ├── traits/
                                         │   ├── critical-thinking (core)
healthco/healthco-personas               │   ├── phi-awareness (community)
  └── HIPAA compliance stuff             │   ├── gdpr-awareness (community)
                                         │   └── pci-compliance (community)
fintechco/fintech-personas              ├── gotchas/
  └── PCI-DSS stuff                      │   ├── postgres-rls (community)
                                         │   ├── lambda-coldstart (community)
                                         │   └── k8s-networking (community)
                                         ├── personas/
                                         │   ├── code-reviewer (core)
                                         │   ├── api-contract-reviewer (community)
                                         │   └── accessibility-reviewer (community)
                                         └── domains/
                                             ├── healthcare (community)
                                             ├── fintech (community)
                                             └── govtech (community)
```

---

## Agent-Agnostic Content, CC-First Delivery

AgentBoot is not ClaudeBoot. The name is intentional. But honesty matters: Claude Code
is the primary target, and the marketplace will always work best with CC. If a feature
"just doesn't work without CC" — that's acceptable. We tried. Sorry, non-CC orgs.

The principle: **content is agent-agnostic; delivery is CC-first.**

### What's Naturally Agent-Agnostic

| Content Type | Why It's Portable | Format |
|---|---|---|
| **Traits** | Pure markdown behavioral instructions. No agent-specific syntax. | `trait.md` |
| **Gotchas rules** | Technology knowledge, not agent knowledge. Postgres RLS is Postgres RLS. | `gotcha.md` with glob patterns |
| **Personas (SKILL.md)** | agentskills.io is a cross-platform standard (26+ agents). | `SKILL.md` |
| **Domain layers** | Traits + personas + gotchas + instructions. All portable. | Directory structure |
| **MCP servers** | MCP is supported by CC, Copilot, Cursor, Gemini CLI. | `.mcp.json` |

### What's CC-Only

| Content Type | Why It's CC-Specific | Non-CC Equivalent |
|---|---|---|
| **Agent CLAUDE.md** (rich frontmatter) | model, permissionMode, maxTurns, hooks, memory | SKILL.md (subset of features) |
| **Hooks** | CC's hook system has no equivalent | None (advisory instructions only) |
| **Managed settings** | CC's MDM enforcement | None |
| **`context: fork`** | CC's subagent isolation | None |
| **CC plugin packaging** | marketplace.json, /plugin install | N/A |

### How the Marketplace Handles This

Marketplace content is stored in the **agent-agnostic format** (markdown traits,
SKILL.md personas, gotchas with globs). This is the source of truth. The build
system produces agent-specific output:

```
Marketplace content (agent-agnostic)
├── traits/phi-awareness.md                    ← Portable markdown
├── personas/hipaa-reviewer/SKILL.md           ← agentskills.io standard
├── gotchas/postgres-rls.md                    ← Technology knowledge
│
│   agentboot build
│   ┌─────────┴──────────┐
│   │                    │
│   ▼                    ▼
CC-native output       Cross-platform output
├── .claude/agents/    ├── skills/hipaa-reviewer/SKILL.md  (Copilot, Cursor, Gemini)
│   └── CLAUDE.md      ├── .github/copilot-instructions.md
│     (full frontmatter)├── .cursor/rules/
├── .claude/skills/    └── GEMINI.md
├── .claude/rules/
├── .claude/settings.json
│   (hooks, permissions)
└── .claude/.mcp.json
```

**CC users get everything.** Rich agent frontmatter, hooks, managed settings,
MCP, plugin packaging. The full governance surface.

**Non-CC users get the content.** SKILL.md personas, instruction files, MCP servers,
gotchas. No hooks, no managed settings, no subagent isolation. The content is the
same; the enforcement is weaker.

### What Contributors Should Know

When contributing to the marketplace:

1. **Write content in the agent-agnostic format.** Traits are markdown. Personas
   are SKILL.md. Gotchas have glob patterns. Don't use CC-specific syntax in the
   source content.

2. **CC-specific enhancements go in metadata.** If a persona benefits from
   `permissionMode: plan` or `context: fork`, declare it in `persona.config.json`
   — the build system will include it in CC-native output and ignore it for
   cross-platform output.

3. **Don't test only on CC.** If you can, verify that the SKILL.md output works
   in at least one other agent (Copilot CLI agent mode is the easiest to test).

4. **Hooks are CC-only features, not content.** A gotchas rule is content (portable).
   A compliance hook is a CC feature (not portable). Keep them separate. The
   marketplace stores the content; the build system generates the hooks.

### The Honest Limitation

Some of the most valuable AgentBoot features — compliance hooks, managed settings,
`permissionMode: plan` for reviewers, `context: fork` for isolation, agent memory
for self-improvement — are CC-only. No other agent platform has these capabilities
today.

Non-CC orgs get:
- Persona definitions (SKILL.md) — useful
- Always-on instructions — useful
- Path-scoped rules — useful (Copilot and Cursor both support this)
- MCP servers — useful (supported broadly)
- Hooks, enforcement, isolation, memory — **not available**

AgentBoot documents this gap honestly (see `docs/delivery-methods.md`) rather than
pretending all agents are equal. CC is the primary target. Cross-platform is a
best-effort that gets better as other agents add features.

---

## Marketplace Layers

AgentBoot has three marketplace layers, from most trusted to most open:

### Layer 1: Core (Maintained by AgentBoot)

Traits and personas that ship with AgentBoot. The reference implementations.

| Content | Examples |
|---------|---------|
| Core traits | critical-thinking, structured-output, source-citation, confidence-signaling, audit-trail, schema-awareness |
| Core personas | code-reviewer, security-reviewer, test-generator, test-data-expert |
| Core instructions | baseline.instructions.md, security.instructions.md |

**Quality bar:** Maintained by the AgentBoot project. Tested, documented, versioned
with the framework. Apache 2.0 licensed.

**How to get it:** Included when you `agentboot install`. Always available.

### Layer 2: Verified (Reviewed + Attributed)

Community-contributed content that's been reviewed by AgentBoot maintainers and
meets quality standards. Listed in the official AgentBoot marketplace.

| Content | Examples |
|---------|---------|
| Verified traits | phi-awareness, gdpr-awareness, pci-compliance, accessibility-standards |
| Verified personas | api-contract-reviewer, accessibility-reviewer, documentation-reviewer |
| Verified gotchas | postgres-rls, lambda-coldstart, k8s-networking, terraform-state |
| Verified domains | healthcare-compliance, fintech-compliance, govtech-fedramp |

**Quality bar:**
- Reviewed by at least one AgentBoot maintainer
- Follows the trait/persona format standards
- Has behavioral tests (at least deterministic)
- Documentation (README, when to use, configuration)
- Licensed Apache 2.0 or MIT (compatible with AgentBoot core)
- No org-specific content (generalized for broad use)
- Attribution to contributor

**How to get it:**
```bash
agentboot add trait phi-awareness --from marketplace
agentboot add domain healthcare-compliance --from marketplace
agentboot add gotcha postgres-rls --from marketplace
```

Or via the CC plugin marketplace:
```
/plugin marketplace add agentboot/marketplace
/plugin install agentboot-healthcare
```

### Layer 3: Community (Unreviewed, Use at Your Own Risk)

Anything published to a public marketplace. Not reviewed by AgentBoot maintainers.
May be excellent; may be terrible. Caveat emptor.

| Content | Examples |
|---------|---------|
| Community traits | brand-voice-casual, seo-optimization, game-dev-patterns |
| Community personas | unity-reviewer, react-native-expert, solidity-auditor |
| Community gotchas | redis-clustering, aws-iam-gotchas, docker-networking |
| Community domains | gaming, ecommerce, edtech |

**Quality bar:** Has valid `agentboot.domain.json` / frontmatter. That's it.

**How to get it:**
```bash
agentboot add trait some-trait --from github:user/repo
agentboot add domain some-domain --from github:user/repo
```

Or via any CC plugin marketplace:
```
/plugin marketplace add user/their-marketplace
/plugin install their-plugin
```

---

## What Can Be Shared

### Traits (Highest Value for Sharing)

Traits are the most shareable unit because they're **context-free behavioral building
blocks**. A `critical-thinking` trait works in healthcare, fintech, and gaming. A
`phi-awareness` trait works at any healthcare org. Traits don't reference org-specific
code, paths, or systems.

**Shareable traits pattern:**
```markdown
# Trait: GDPR Data Awareness

## When This Trait Is Active
You are working with or near personally identifiable information in a system
subject to GDPR (EU General Data Protection Regulation).

## Rules
1. Flag any data storage that lacks a defined retention period.
2. Flag any cross-border data transfer without an adequacy assessment.
3. Verify consent collection before processing personal data.
4. Check for right-to-deletion capability on any new user data table.
...
```

No org names, no internal paths, no proprietary systems. Pure behavioral rules that
any GDPR-regulated org can compose into their personas.

### Gotchas Rules (High Value for Sharing)

Gotchas are technology-specific, not org-specific. PostgreSQL RLS behaves the same
at every company. Lambda cold starts hit everyone. These are universal lessons.

**Shareable gotchas pattern:**
```markdown
---
paths:
  - "**/*.tf"
  - "terraform/**"
description: "Terraform state gotchas"
---

# Terraform State Gotchas

- **Never `terraform apply` without a plan file.** `terraform plan -out=plan.tfplan`
  then `terraform apply plan.tfplan`. Raw `apply` can drift from what you reviewed.
- **State locking is not enabled by default.** If using S3 backend, add a DynamoDB
  table for locking or you'll get corrupted state on concurrent runs.
- **`terraform destroy` destroys resources in the wrong order if you have
  dependencies terraform doesn't know about.** Always review the plan.
```

### Personas (Medium Value for Sharing)

Personas are more opinionated than traits — they encode a specific review philosophy
and output format. But generic personas (code-reviewer, security-reviewer) are broadly
useful. Specialized personas (accessibility-reviewer, API-contract-reviewer) are
useful to any team working in that domain.

### Domain Layers (High Value for Sharing)

Complete domain packages — traits + personas + gotchas + instructions for a specific
compliance regime or technology stack. These are the highest-effort contribution but
also the highest value.

**Example: healthcare-compliance domain layer:**
```
domains/healthcare-compliance/
├── agentboot.domain.json
├── README.md
├── traits/
│   ├── phi-awareness.md
│   ├── hipaa-enforcement.md
│   └── fhir-awareness.md
├── personas/
│   ├── hipaa-reviewer/SKILL.md
│   └── compliance-checker/SKILL.md
├── instructions/
│   ├── always-on.md
│   └── path-scoped/
│       └── patient-data.md
└── gotchas/
    ├── hipaa-audit-logging.md
    └── phi-in-test-data.md
```

---

## Contribution Model

### How to Contribute

**Individual traits/gotchas (easiest):**
```bash
# Fork agentboot/marketplace
# Add your trait
agentboot add trait my-trait
# Edit core/traits/my-trait.md
agentboot lint --trait my-trait
agentboot test --trait my-trait
# Open PR to agentboot/marketplace
```

**Complete domain layer:**
```bash
# Create domain locally
agentboot add domain my-domain
# Build and test
agentboot build
agentboot test --domain my-domain
# Publish to your own marketplace first (test in production)
agentboot publish --marketplace my-github/my-marketplace
# When stable, open PR to agentboot/marketplace
```

### Contribution Requirements

**For Verified (Layer 2) listing:**

| Requirement | Why |
|-------------|-----|
| Apache 2.0 or MIT license | Compatibility with core and org private layers |
| No org-specific content | Must be generalizable |
| README with use case and configuration | Discoverability |
| Behavioral tests (at least 3 test cases) | Quality assurance |
| Follows trait/persona format standards | Consistency |
| `agentboot lint` passes with zero errors | Quality bar |
| Token budget within limits | Cost discipline |
| No credentials, internal URLs, PII in examples | Security |

**For Community (Layer 3):**

| Requirement | Why |
|-------------|-----|
| Valid frontmatter / agentboot.domain.json | Machine-readable |
| License declared | Legal clarity |
| That's it | Low barrier to entry |

### Review Process (Verified)

1. Contributor opens PR to `agentboot/marketplace`
2. Automated checks: lint, test, format validation, license scan
3. Maintainer review: quality, generalizability, overlap with existing content
4. If accepted: merged with attribution, listed in marketplace index
5. Contributor credited in CONTRIBUTORS.md and in the content's frontmatter

---

## SuperClaude Partnership

SuperClaude has 12 composable traits and 16 agents — the most mature public trait
library. AgentBoot has 6 core traits with a governance/distribution layer.
Partnership makes sense because the value propositions are complementary.

### What a Partnership Could Look Like

**Shared trait format standard:**

Both projects use markdown traits with behavioral directives. If we align on a
common format, traits authored in either project work in both:

```yaml
# Proposed shared trait frontmatter
---
trait: critical-thinking
version: 1.0.0
format: agentboot-trait/v1        # Shared format identifier
weight: configurable              # Supports HIGH/MEDIUM/LOW or 0.0-1.0
compatible:
  - agentboot: ">=1.0.0"
  - superclaude: ">=4.0.0"
---
```

**Cross-listing in marketplaces:**

AgentBoot's marketplace lists SuperClaude's traits (pointing to their repo, not
copying). SuperClaude's documentation references AgentBoot for organizational
governance. Neither project bundles the other — they're peers.

```json
// agentboot/marketplace/.claude-plugin/marketplace.json
{
  "plugins": [
    {
      "name": "superclaude-traits",
      "source": { "source": "github", "repo": "SuperClaude-Org/SuperClaude_Plugin" },
      "description": "SuperClaude's 12 composable traits — install via AgentBoot marketplace",
      "category": "traits"
    }
  ]
}
```

**Joint trait development:**

For new traits that both communities need (e.g., `cost-awareness`, `testing-standards`,
`documentation-quality`), develop them jointly with dual attribution:

```markdown
# Trait: Cost Awareness

**Authors:** AgentBoot + SuperClaude communities
**License:** Apache 2.0
```

### What This Requires

1. **Conversation with SuperClaude maintainers** — reach out to NomenAK, propose
   format alignment and cross-listing
2. **Format compatibility RFC** — document the shared trait format, get feedback
   from both communities
3. **Neither project depends on the other** — cross-listing is additive, not required.
   AgentBoot works without SuperClaude; SuperClaude works without AgentBoot.

### Why This Matters

The Claude Code ecosystem is fragmenting into isolated trait/agent libraries.
Every framework invents its own format. If AgentBoot and SuperClaude (the two
largest trait-based projects) align on a format, it becomes a de facto standard.
Other projects adopt it because it's where the content is. The ecosystem converges
instead of fragmenting.

This is how npm won — not by being the best package manager, but by being where
all the packages were.

---

## Marketplace Architecture

### Repository Structure

```
agentboot/marketplace/
├── .claude-plugin/
│   └── marketplace.json              # Plugin catalog
├── traits/
│   ├── core/                         # Layer 1: maintained by AgentBoot
│   │   ├── critical-thinking/
│   │   │   ├── trait.md
│   │   │   ├── tests/
│   │   │   └── README.md
│   │   └── structured-output/
│   │       └── ...
│   └── verified/                     # Layer 2: reviewed community contributions
│       ├── phi-awareness/
│       ├── gdpr-awareness/
│       └── pci-compliance/
├── gotchas/
│   ├── verified/
│   │   ├── postgres-rls.md
│   │   ├── lambda-coldstart.md
│   │   └── k8s-networking.md
│   └── README.md
├── personas/
│   ├── core/
│   │   ├── code-reviewer/
│   │   └── security-reviewer/
│   └── verified/
│       ├── accessibility-reviewer/
│       └── api-contract-reviewer/
├── domains/
│   ├── healthcare-compliance/
│   ├── fintech-compliance/
│   └── govtech-fedramp/
├── CONTRIBUTORS.md
└── CONTRIBUTING.md
```

### How the Marketplace Connects to CC Plugins

Each logical grouping becomes a CC plugin that can be installed independently:

```json
{
  "name": "agentboot-marketplace",
  "plugins": [
    {
      "name": "ab-core",
      "source": "./plugins/core",
      "description": "AgentBoot core traits and personas"
    },
    {
      "name": "ab-healthcare",
      "source": "./domains/healthcare-compliance",
      "description": "Healthcare compliance domain (PHI, HIPAA, FHIR)"
    },
    {
      "name": "ab-fintech",
      "source": "./domains/fintech-compliance",
      "description": "Fintech compliance domain (PCI-DSS, SOX)"
    },
    {
      "name": "ab-gotchas-infra",
      "source": "./plugins/gotchas-infra",
      "description": "Infrastructure gotchas (Postgres, Lambda, K8s, Terraform)"
    },
    {
      "name": "superclaude-traits",
      "source": { "source": "github", "repo": "SuperClaude-Org/SuperClaude_Plugin" },
      "description": "SuperClaude composable traits (cross-listed)"
    }
  ]
}
```

Developers pick what they need:
```
/plugin marketplace add agentboot/marketplace
/plugin install ab-core                    # Core personas + traits
/plugin install ab-healthcare              # Healthcare domain
/plugin install ab-gotchas-infra           # Infrastructure gotchas
/plugin install superclaude-traits         # SuperClaude's traits
```

### Discovery and Search

**In CLI:**
```bash
agentboot search traits "gdpr"
agentboot search gotchas "postgres"
agentboot search domains "healthcare"
agentboot search personas "accessibility"
```

**In CC:**
```
/plugin search agentboot gdpr
```

**On the web:**
A static site (agentboot.dev/marketplace) generated from the marketplace repo,
showing all available traits, personas, gotchas, and domains with usage stats,
README previews, and install commands.

---

## Quality and Trust

### How to Prevent "npm Left-Pad" Problems

1. **Core (Layer 1) is stable.** AgentBoot's core traits and personas don't break.
   They're tested in CI on every commit. Orgs can pin to a core version.

2. **Verified (Layer 2) has review.** A maintainer reads every PR. Automated tests
   run. Bad contributions are rejected. This is the "curated" tier.

3. **Community (Layer 3) is buyer-beware.** Explicitly labeled. AgentBoot doesn't
   vouch for quality. This is where experimentation happens.

4. **Version pinning.** Orgs can pin any marketplace content to a specific version:
   ```jsonc
   {
     "extend": {
       "domains": [
         { "name": "healthcare-compliance", "version": "1.2.0" }
       ]
     }
   }
   ```

5. **License scanning.** The build system validates that all composed content has
   compatible licenses. GPL in a trait blocks the build.

6. **Trait isolation.** A bad community trait can't break a core persona. Traits
   compose additively — they don't modify each other.

### Trust Signals

Each marketplace item shows:

| Signal | What it means |
|--------|-------------|
| `core` badge | Maintained by AgentBoot project |
| `verified` badge | Reviewed by AgentBoot maintainer |
| `community` badge | Unreviewed — use at own risk |
| Download count | How many orgs are using it |
| Last updated | Is it maintained? |
| Test coverage | Does it have behavioral tests? |
| Compatible versions | Which AgentBoot versions it works with |
| License | Apache 2.0, MIT, CC-BY-SA, etc. |
| Author | Who contributed it, with link to profile |

---

## Why People Contribute (And How AgentBoot Maximizes It)

### The Actual Motivations

| Motivation | What drives it | How AgentBoot serves it |
|---|---|---|
| **It solves my problem and sharing is free** | The contributor already wrote it for their org. Generalizing it takes 30 minutes. Why not? | `agentboot publish` makes sharing a one-command action. Low friction = more contributions. |
| **Professional reputation** | "I wrote the GDPR compliance domain that 400 orgs use" goes on a resume, a blog post, a conference talk. | Contributor profiles with usage stats. Permanent attribution in content frontmatter. |
| **Reciprocity** | "I used someone's Postgres gotchas and saved 2 hours. I'll contribute my Lambda gotchas." | Visible attribution on everything you install — you see who helped you, you want to help back. |
| **The content improves** | When 50 orgs use your trait, they file issues, suggest edge cases, submit PRs. Your trait gets better than you could make it alone. | GitHub-native contribution (issues, PRs). Feedback flows back to the author. |
| **Org visibility** | "Acme Corp contributed the healthcare compliance domain" is good press. Signals engineering maturity. | Org-level attribution alongside individual attribution. |
| **Hiring signal** | Companies that contribute are signaling "we take engineering seriously." Engineers notice. | Contributor page on agentboot.dev lists orgs and individuals. |

### What Does NOT Motivate Sustained Contribution

- **Stars/likes** — dopamine hit on day one, forgotten by day three
- **Gamification** (badges, leaderboards, streaks) — attracts gaming behavior, not quality
- **Points/tokens** — creates mercenary contributors who optimize for quantity
- **Forced contribution** ("you must contribute to use the marketplace") — creates resentment

AgentBoot will not gamify contributions. No leaderboards. No badges. No streak
counters. These attract low-quality volume. We want high-quality contributions from
people who have real knowledge to share.

### How AgentBoot Maximizes Contribution Value

**1. Attribution that matters professionally:**

Every marketplace item has permanent, visible attribution:

```yaml
---
trait: gdpr-awareness
version: 2.1.0
author:
  name: Jane Doe
  github: janedoe
  org: Acme Corp                    # Optional — org-level credit
attribution:
  - name: Jane Doe                  # Original author
    contribution: "Initial implementation"
  - name: Bob Smith                 # Co-contributor
    contribution: "Added right-to-deletion rules"
  - name: Acme Corp                 # Org credit
    contribution: "Production-validated at scale"
---
```

This attribution travels with the content. When an org installs `gdpr-awareness`,
the build output includes: `# Contributed by Jane Doe (@janedoe) / Acme Corp`.
The contributor's name is in every repo that uses their work.

**2. Usage metrics visible to contributors:**

Contributors can see (anonymized) how their content is used:

```
Your Contributions — gdpr-awareness trait
─────────────────────────────────────────
Installs: 412 orgs
Active usage: 89% (367 orgs used it in the last 30 days)
Issues filed: 3 (1 bug, 2 feature requests)
PRs received: 2 (1 merged, 1 open)
Composed by: 6 verified personas
```

This isn't vanity — it's evidence. "My trait is used by 412 organizations" is a
concrete, verifiable career credential. The contributor can link to it.

**3. Feedback loop back to contributors:**

When an org encounters a problem with a marketplace trait:
- They file a GitHub issue on the marketplace repo
- The issue is tagged with the trait name and routed to the author
- The author gets feedback from real production usage
- The trait improves

This is the "your content gets better when others use it" motivation made concrete.
Contributors aren't just giving — they're getting a QA team for free.

**4. Contributor profiles on agentboot.dev:**

The marketplace website includes contributor profiles:

```
Jane Doe (@janedoe) — Acme Corp
────────────────────────────────

Contributions:
  gdpr-awareness (trait)       — 412 orgs, v2.1.0
  pci-compliance (trait)       — 89 orgs, v1.0.0
  fintech-compliance (domain)  — 34 orgs, v1.2.0

Total reach: 535 orgs
Member since: 2026-06
```

This is a public, linkable page. Jane puts it on her profile. Recruiters see it.
Conference talk submissions reference it. It's professional capital, not internet
points.

**5. Org-level recognition:**

Organizations that contribute get listed:

```
Contributing Organizations
──────────────────────────

Acme Corp          3 traits, 1 domain    healthcare, fintech
MegaTech Inc       5 gotchas             infrastructure
StartupCo          1 persona             accessibility
```

This serves the org's motivation: "we contribute to the ecosystem" is a
recruiting signal and a brand signal. It costs the org nothing (the content was
already written for internal use) and buys goodwill.

**6. Make sharing a one-command action:**

The biggest barrier to contribution isn't motivation — it's friction. The developer
has a great Postgres gotchas file. They'd share it if it took 30 seconds. They
won't if it takes 30 minutes.

```bash
# Developer has a gotcha in their org's repo
agentboot publish gotcha postgres-rls --to marketplace

# AgentBoot:
# 1. Strips org-specific content (internal URLs, paths, names)
# 2. Validates format and lint
# 3. Generates README from content
# 4. Opens PR to agentboot/marketplace
# 5. Done. Developer's name in the PR. Review handles the rest.
```

The `--to marketplace` flag does the generalization work. It scans for org-specific
content (internal URLs, proprietary names, hardcoded paths) and either strips it or
warns the contributor. The goal: sharing should be easier than not sharing.

### The Virtuous Cycle

```
Org writes trait for internal use
         │
         ▼
agentboot publish (30 seconds)
         │
         ▼
Marketplace PR → reviewed → merged
         │
         ▼
Other orgs install and use it
         │
         ├──► Issues filed → trait improves
         │
         ├──► Contributor gets usage stats → professional credit
         │
         └──► More people see the marketplace → more contributions
                    │
                    ▼
              Marketplace grows → more valuable → more adoption
                    │
                    ▼
              AgentBoot becomes "where the traits are"
              (the npm effect)
```

The flywheel: useful content attracts users. Users become contributors. Contributors
add more useful content. The marketplace becomes the default place to look for AI
governance content — not because of marketing, but because that's where everything is.

---

## Monetization Considerations

The marketplace itself is free and open. But there are legitimate monetization
paths for the ecosystem:

| Model | What | Who pays |
|-------|------|---------|
| **Free core + paid domains** | Core traits/personas are free. Premium domain layers (SOC 2 automation, HIPAA pre-audit) are paid. | Orgs that need compliance |
| **Free self-host + paid managed** | Self-host the marketplace for free. Pay for a managed marketplace with automatic updates, quality monitoring, and SLA. | Enterprise orgs |
| **Consulting marketplace** | Marketplace lists consulting partners who implement AgentBoot for orgs. AgentBoot takes a referral fee. | Orgs that need help |
| **Certification** | "AgentBoot Certified" trait/domain authors who meet advanced quality standards. | Trait authors who want credibility |

These are future considerations. V1 is free and open. Monetization is a V2+
conversation based on what the community actually values.

---

## Phased Rollout

| Phase | What | When |
|-------|------|------|
| V1 | Core traits + personas in a public marketplace repo. `agentboot add --from marketplace`. | At launch |
| V1.5 | Contribution guide. First community PRs. Verified review process. | Post-launch |
| V2 | SuperClaude cross-listing. Domain layers (healthcare, fintech). Web catalog at agentboot.dev. | Growth phase |
| V2+ | Community marketplace (Layer 3). Search. Trust signals. Monetization exploration. | Scale phase |

---

## Ecosystem

AgentBoot is the **governance and distribution layer**, not a content framework. It
does not compete with tools that produce traits, agents, or skills — it governs and
distributes them. An org could use SuperClaude's traits, ArcKit's architecture commands,
and Trail of Bits' security skills, all composed and distributed through AgentBoot's
scope hierarchy.

### Tool Profiles

| Tool | Problem It Solves | Audience | License | Relationship |
|------|-------------------|----------|---------|-------------|
| [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework) | Better Claude Code behavior via composable traits and agents | Individual developer | MIT | Prior art — composable trait architecture |
| [ArcKit](https://github.com/tractorjuice/arc-kit) | Systematic enterprise architecture governance | Enterprise architects | MIT | Prior art — hook-as-governance patterns |
| [spec-kit](https://github.com/github/spec-kit) | Specifications before coding (spec-driven development) | Teams starting projects | MIT | Complementary — operates in planning phase, AgentBoot in development phase |
| [Trail of Bits config](https://github.com/trailofbits/claude-code-config) | Security-first Claude Code configuration | Security teams | Check repo | Prior art — "guardrails, not walls" philosophy |
| [Trail of Bits skills](https://github.com/trailofbits/skills) | Security audit skills (CodeQL, Semgrep, variant analysis) | Security researchers | CC-BY-SA-4.0 | Domain layer — consumable via AgentBoot's scope hierarchy |

### Licensing Compatibility

AgentBoot core is Apache 2.0. Domain layers carry their own licenses.

| Upstream License | Can AgentBoot bundle it? | Requirements |
|-----------------|------------------------|-------------|
| MIT | Yes | Include license text |
| Apache-2.0 | Yes | Include license + NOTICE |
| CC-BY-4.0 | As domain layer only | Attribution |
| CC-BY-SA-4.0 | As domain layer only | Attribution + ShareAlike (cannot relicense) |
| GPL-3.0 | No (core); isolated domain layer only | Viral — infects composed output |

### Partnership Models

**Marketplace curation (recommended).** AgentBoot's marketplace points to upstream
repos rather than copying content. No bundling, no license complexity. The user
installs directly from the upstream project. AgentBoot acts as curator, not distributor.

**Domain layer distribution.** Third-party tools packaged as optional domain layers
(`agentboot add domain superclaude`). Thin wrappers that map upstream files into
AgentBoot's directory structure. Upstream license preserved. Requires maintainer
permission (courteous even for MIT).

**Co-development.** Joint trait format standards, shared hook recipes, architecture
integration. Requires active maintainer relationships and is not feasible until
AgentBoot has users and credibility.

**Upstream contribution.** When AgentBoot develops reusable patterns (trait format spec,
governance patterns, cross-platform compilation), contribute them back to the ecosystem.

### Attribution

AgentBoot's core concepts were developed independently. The third-party tools listed
here were discovered after the design was complete. This is parallel evolution — multiple
teams arrived at composable traits, hook-based governance, and agent personas because
these are natural solutions to the same problems. AgentBoot acknowledges prior art,
respects the work, and seeks to partner rather than compete.

Attribution levels:

| Level | When to Use | Format |
|-------|-------------|--------|
| Prior art | Independent parallel development; they shipped first | "See also \[Project\](link)" |
| Complementary | Adjacent tool we recommend | "Works well with \[Project\](link)" |
| Integrated | Direct integration (domain layer, marketplace listing) | Attribution in README + ACKNOWLEDGMENTS.md |
| Includes | Bundled content | Full license text + attribution in distribution |

See `ACKNOWLEDGMENTS.md` for the full attribution record.

---

*See also:*
- [`docs/delivery-methods.md`](delivery-methods.md) — CC plugin marketplace mechanics
- [`docs/org-connection.md`](org-connection.md) — private marketplace hosting for orgs
- [`docs/extending.md`](extending.md) — domain layer structure

Sources:
- [Create and distribute a plugin marketplace — Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces)
- [Official Claude Code Plugins — GitHub](https://github.com/anthropics/claude-plugins-official)
- [SuperClaude Framework — GitHub](https://github.com/SuperClaude-Org/SuperClaude_Framework)
- [ArcKit — GitHub](https://github.com/tractorjuice/arc-kit)
- [spec-kit — GitHub](https://github.com/github/spec-kit)
- [Trail of Bits claude-code-config — GitHub](https://github.com/trailofbits/claude-code-config)
- [Trail of Bits skills — GitHub](https://github.com/trailofbits/skills)
- [Claude Code Plugin Marketplace — claudemarketplaces.com](https://claudemarketplaces.com/)
