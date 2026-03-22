# Marketing Plan (Internal — .gitignored)

Strategy for building AgentBoot's public presence while navigating the
dual-employment situation.

---

## Employment Constraints

- Two concurrent jobs: Health Gorilla (Org2) and Ascension Technologies (Org3)
- Neither knows about the other
- Both know about "some personas system thing" — will be introduced to AgentBoot
  next week as "here's this tool I wrote, we should use it"
- Employment is at-will; discovery of dual employment = likely termination
- IP/conflict-of-interest already cleared in a prior session
- AgentBoot is a personal project, not employer IP

### Channel Risk Assessment

| Channel | Risk Level | Why |
|---------|-----------|-----|
| **LinkedIn** | HIGH — OFF LIMITS | Professional network overlap. Colleagues from both jobs see same posts. Profile shows (or can reveal) employment. Algorithm cross-pollinates networks. |
| **GitHub** | LOW | Profile doesn't show employer. Tech-only audience. Pseudonym-friendly. |
| **X (Twitter)** | LOW | No professional network overlap. Tech community. Can use project account. |
| **Dev.to / Hashnode** | LOW | Developer audience. No employer visibility. |
| **Medium** | MEDIUM | Can be linked to LinkedIn. Use without LinkedIn integration. |
| **Hacker News** | LOW | Anonymous. No profile linkage. |
| **Reddit** | LOW | Pseudonymous. |
| **Conferences** | HIGH — DEFER | High visibility. Colleagues from both jobs could attend/see recordings. Revisit when employment situation resolves. |

### The Rule

**No LinkedIn. No conferences (for now). Everything else is fine.**

GitHub + X + Dev.to + community forums is sufficient for an OSS developer tool.
LinkedIn becomes viable when: (a) the dual-employment resolves, or (b) AgentBoot
is established enough to not need it.

---

## Origin Story

The real story, naturally told:

> "It started as a personal project — I have a lot of developers in my family
> and we were all building with Claude Code on hobby projects. I kept writing
> the same CLAUDE.md rules, the same review prompts, the same gotchas. So I
> built a system to share them across projects. Pretty quickly it took on an
> org-like structure just because we had so many projects going. Then I started
> hearing the same pain points from friends and former colleagues trying to
> introduce agentic tools at work. I realized the patterns I'd built for family
> projects were exactly what engineering teams needed — just with governance
> and distribution on top. That's AgentBoot."

This is true. It's relatable. It doesn't reference any employer. And it explains
why the tool has both personal simplicity and organizational depth — because it
grew from one to the other.

### Scripted Answers

**"Who else is using this?"**
> "My wife and I have been using it on our personal projects for a while —
> that's where it started. A bunch of developers in the family, lots of side
> projects. It's also been spreading through my network — friends, former
> colleagues. You'd be one of the first teams to use it at work though."

True. Christie's projects were first. The employer is the first *work* deployment,
not the first deployment. That honor goes to Christie.

**"Is anyone else using this at their company?"**
> "Not formally at a company yet — that's what I'm proposing here. It's been
> used across personal and family projects, and people in my network are
> picking it up. But a real team deployment? You'd be first."

Also true. Positions them as the first work deployment (which they are on their
respective timelines), without revealing the other employer.

**"How did you come up with this?"**
> "My wife has a startup and I was helping her set up AI tooling. Between her
> projects and other family side projects, I kept copying the same AI rules
> everywhere. Built a system to manage it. Then I realized it's the same
> problem at work, just bigger."

Simple. Authentic. Gives Christie credit without naming the startup. No one
asks follow-up questions about family side projects.

**"How mature is this?"**
> "The persona system has been running on personal projects for a few months.
> The open-source framework is newer — I'm still building out the CLI and
> marketplace. The core concepts (traits, personas, scope hierarchy) are
> solid. The tooling around them is early."

Honest about maturity. Sets appropriate expectations.

---

## GitHub Strategy

### Profile

`saavyone` is the public author. The profile should have:
- AgentBoot pinned as the top repo
- Bio: "Building AgentBoot — AI persona governance for engineering teams"
- No employer mentioned (standard for OSS authors)

### README as Landing Page

The AgentBoot README is the first thing anyone sees. It should:
- Lead with the problem (scattered CLAUDE.md, no governance, no distribution)
- Show the solution (one config, build, sync)
- Include a quick demo (30-second gif or terminal recording)
- Have clear "Get Started" CTAs
- Show the persona registry (proof of substance)

### GitHub Activity

| Activity | Frequency | Purpose |
|----------|-----------|---------|
| Commits to main | Regular (shows project is alive) | Credibility |
| Issues (self-filed) | Roadmap items, feature ideas | Shows direction |
| Releases with changelogs | At milestones | Shows progress |
| Discussions enabled | Community Q&A | Engagement |
| Contributing guide | Once | Invites contribution |
| Good first issues labeled | As needed | Onboards contributors |

### Stars and Early Adoption

1. Post to relevant communities with genuine value, not spam
2. Submit to awesome-claude-code and similar curated lists
3. Submit to Anthropic's official plugin marketplace when plugin is ready
4. Write a detailed launch blog post that provides value independent of AgentBoot
5. Reach out to 3P tool authors (SuperClaude, ArcKit) for cross-referencing
6. Don't buy stars. Don't beg for stars. Stars follow value.

---

## X (Twitter) Strategy

### Content Themes

**Thread-worthy topics (high engagement):**
- "The 5 patterns every org reinvents when adopting AI coding agents"
- "Why your CLAUDE.md is 800 lines and how to fix it"
- "The privacy problem with AI agent governance that nobody talks about"
- "How to test AI agents: agents testing agents, humans always in the loop"
- "The marketplace model that could do for AI traits what npm did for packages"

**Quick posts (consistent presence):**
- Claude Code tips and tricks
- AgentBoot feature highlights
- Responses to others in the CC community
- Sharing relevant posts from Anthropic, SuperClaude, ArcKit, etc.

### Engagement

Follow and engage with:
- Anthropic employees who post about Claude Code
- SuperClaude, ArcKit, spec-kit maintainers
- Claude Code community (awesome-claude-code contributors)
- Engineering leaders posting about AI adoption
- Developer experience / platform engineering community

---

## Blog / Long-Form Content

### Where to Publish

| Platform | Audience | Best For |
|----------|----------|---------|
| **Dev.to** | Developers | Technical tutorials, how-tos |
| **Hashnode** | Developers | Technical deep dives |
| **agentboot.dev** (future) | Direct traffic | Canonical reference, docs |
| **Medium** | Mixed tech | Conceptual posts (use WITHOUT LinkedIn integration) |

### Launch Content Plan

| # | Title | Platform | Angle |
|---|-------|----------|-------|
| 1 | "Introducing AgentBoot: The Spring Boot of AI Agent Governance" | Dev.to | Launch announcement with the problem + solution |
| 2 | "Why Every Org Reinvents the Same AI Agent Patterns (And How to Stop)" | Medium | Thought leadership — the patterns that keep appearing |
| 3 | "Composable Traits: DRY for AI Behavior" | Dev.to | Technical deep dive on the trait system |
| 4 | "The Privacy Model AI Agent Tools Won't Talk About" | Dev.to | Provocation — most tools surveil developers; AgentBoot doesn't |
| 5 | "Testing AI Agents: A 6-Layer Approach" | Dev.to | Technical — the test pyramid |
| 6 | "From 5,600 Lines of Scattered CLAUDE.md to 800 Lines of Governed Content" | Dev.to | The discover/migrate story |

### The Privacy Article (#4) as a Marketing Differentiator

Most AI governance tools are surveillance tools. AgentBoot is explicitly not.
This is provocative, shareable, and generates discussion. Publish on Dev.to
(not LinkedIn).

---

## Private Network / Word of Mouth

The most effective marketing channel that doesn't appear on any channel risk table:
your personal network of friends, former colleagues, and family.

**Why this works:**
- Trust is pre-established (they know you)
- No public visibility (no LinkedIn post for colleagues to stumble on)
- Direct feedback loop (they tell you what's broken, not a GitHub issue)
- Organic growth (they tell their friends/colleagues)
- Honest conversations ("here's what works, here's what doesn't yet")

**How to work it:**
- Direct messages, texts, phone calls — not public posts
- "Hey, I built this thing for managing AI personas across projects. Want to try it?"
- Share the GitHub link privately, not broadcast
- Ask for feedback, not stars
- When they share it with their teams, that's organic word of mouth — the best kind

**Who to reach out to:**
- Former colleagues who are now at other companies using AI tools
- Developer friends and family (already using it — they're the origin story)
- People who've complained to you about AI tool adoption at their org
- Engineers you respect who would give honest feedback

**What this looks like at scale:**
- 10 people in your network try it → 3 like it → they show their team
- Their team adopts it → that's a real deployment without any public marketing
- When you DO go public (GitHub, X, Dev.to), you already have real users and
  real feedback. The public launch is backed by substance, not just a README.

This is the pre-launch growth engine. By the time AgentBoot is "launched" publicly,
it should already have a handful of real users from your network who can validate
that the tool works.

---

## Community Strategy

### Where the Audience Is

| Community | How to Engage | Tone |
|-----------|--------------|------|
| **Claude Code Discord / Forums** | Answer questions, share tips, mention AgentBoot when relevant | Helpful, not salesy |
| **awesome-claude-code** | Submit AgentBoot for listing | One-time submission |
| **r/ClaudeAI** | Share launch post, participate in discussions | Community member |
| **Hacker News** | Show HN post at launch | Technical, concise |
| **r/programming** | Only if content is genuinely interesting | Technical |
| **DevOps / Platform Eng communities** | The governance angle resonates here | Platform engineering lens |

### Partnership Outreach

| Who | How | When |
|-----|-----|------|
| **SuperClaude maintainers** | GitHub discussion or issue: propose trait format alignment + cross-listing | Pre-launch |
| **ArcKit (Mark Craddock)** | Direct message: acknowledge prior art, propose complementary positioning | Pre-launch |
| **Trail of Bits** | GitHub issue or social: reference their hook philosophy in AgentBoot's docs | At launch |
| **Anthropic DevRel** | Submit to official plugin marketplace; share what you're building | When plugin is ready |
| **awesome-claude-code curators** | PR to add AgentBoot to the list | At launch |

---

## Metrics

| Metric | Target (6 months) | Why it matters |
|--------|-------------------|---------------|
| GitHub stars | 500+ | Social proof for adoption |
| npm installs / brew installs | 100+/month | Actual usage |
| Plugin installs (CC marketplace) | 50+ | CC ecosystem presence |
| Contributors (non-author) | 5+ | Community validation |
| Marketplace contributions | 3+ verified items | Ecosystem flywheel |
| Blog post views | 5k+ total | Reach |
| X followers (project account) | 300+ | Audience |

---

## Narrative Arc

**Months 1-3:** "Here's a real problem I solved, open-sourced as AgentBoot."
Focus on the problem and the design. Establish credibility through depth.

**Months 3-6:** "Here's what the community is building with it." Shift to
community voice. Highlight contributions, use cases, marketplace content.

**Months 6-12:** "Here's where agentic governance is going." Thought leadership.
AgentBoot as the reference implementation. The project speaks for itself.

---

## When Constraints Change

If the dual-employment situation resolves (one job ends, both find out, or you
go independent):
- **LinkedIn unlocks** — the highest-value professional channel
- **Conference talks unlock** — highest-value marketing for credibility
- **Case studies unlock** — "Acme Corp deployed AgentBoot across 30 repos" (with permission)
- **The origin story can include specifics** — "built at a healthcare company, then adapted for enterprise"

Until then: GitHub + X + Dev.to + community. That's enough to build an OSS project.
