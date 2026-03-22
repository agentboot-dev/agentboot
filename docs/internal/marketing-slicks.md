# Marketing Slicks — One Per Audience

Short-form messaging designed to pique interest and drive a "let me try this"
reaction. Each is ~half a page, tailored to what that audience cares about.

---

## 1. For the Developer

### Your AI agent doesn't know your codebase. AgentBoot fixes that.

You've used Claude Code. You've typed `/review-code` and gotten generic advice
that misses the point. You've written the same CLAUDE.md rules in three repos.
You've asked the AI "how does auth work in this project?" and gotten a guess
instead of an answer.

AgentBoot gives your AI agent your team's actual knowledge:

- **Gotchas rules** that activate when you touch database code — because your
  team already learned that PostgreSQL partitions don't inherit RLS. The agent
  warns you before you make the same mistake.
- **Code review** that checks YOUR standards, not generic best practices. The
  reviewer knows your API versioning convention, your error handling patterns,
  and your naming rules.
- **Test generation** that understands your schemas, your fixtures, and your
  domain. Not boilerplate — tests that actually exercise the edge cases.

You don't configure anything. Your platform team sets it up once. You clone the
repo, open Claude Code, and it just works. The personas are there. The knowledge
is there. Your first `/review-code` produces findings that reference your actual
codebase.

```
brew install agentboot && agentboot setup
```

---

## 2. For the Platform / DevEx Team

### Stop maintaining 30 copies of CLAUDE.md.

You've got 30 repos. Each one has a CLAUDE.md that someone wrote months ago.
Some are 800 lines. Some are 40. None are the same. When your team agrees on a
new convention, you have to update all of them manually. You don't. They drift.

AgentBoot is a build system for AI agent behavior:

- **Write once, deploy everywhere.** Define your code review rules, security
  standards, and gotchas in one repo. AgentBoot compiles them into personas
  and syncs them to every target repo automatically.
- **Scope hierarchy.** Org-wide rules apply to everyone. Team-specific rules
  layer on top. Repo-specific gotchas activate only where they're relevant.
  One config file controls the whole structure.
- **Composable traits.** "Critical thinking" is written once. Your code reviewer
  uses it at medium intensity. Your security reviewer uses it at high. Change
  the trait definition, and every persona that composes it improves.
- **Plugin distribution.** Package your personas as a Claude Code plugin. Devs
  install with one command. IT can force-enable it via managed settings. Updates
  push automatically.

The pitch to your team: "We went from 5,600 lines of scattered CLAUDE.md to
800 lines of governed, composable content. Every repo gets the same review
quality. Every new hire is productive on day one."

```
agentboot discover --github-org acme-corp
agentboot build && agentboot sync
```

---

## 3. For the Engineering Leader / VP / CTO

### Your AI tool investment is ungoverned. You're paying for chaos.

You bought 50 Claude Code seats. Some developers get 10x value. Others tried it
once and went back to their IDE. Nobody knows which AI rules are in which repos.
There's no consistency in code review quality across teams. Your compliance team
is nervous because there's no audit trail for AI-assisted development.

AgentBoot turns AI agents from individual experiments into organizational
infrastructure:

- **Adoption metrics without surveillance.** See which teams are using personas,
  what it costs per team, and where the ROI is — without reading anyone's prompts.
  Developers trust the tool because it respects their privacy.
- **Compliance built in.** Hooks scan for credentials and sensitive data before
  the AI sees them. Audit trails log every persona invocation. Managed settings
  enforce guardrails that developers can't override. Your compliance team sleeps
  better.
- **Measurable ROI.** PR review turnaround drops. Bug escape rates drop. Test
  coverage goes up. New hire onboarding accelerates. These aren't promises —
  they're metrics the dashboard tracks.
- **One investment, every repo.** Your platform team defines the standards once.
  AgentBoot distributes them to every repo, every team, every developer. The
  next repo your org creates inherits the full governance stack automatically.

The question isn't whether your developers should use AI. They already are.
The question is whether you govern it — or hope for the best.

---

## 4. For the IT / Security Admin

### Enforce AI guardrails the same way you enforce device policies.

Your developers are sending code to the Claude API. Some of them are pasting
production data into prompts. Your CISO wants guardrails. You want something
that works with your existing MDM, not another tool to manage.

AgentBoot generates the artifacts you already know how to deploy:

- **Managed settings for Claude Code.** A JSON file deployed via Jamf, Intune,
  or JumpCloud — the same way you deploy any managed configuration. Hooks that
  scan for credentials and PII before the model sees them. Permission rules
  that block dangerous commands. Non-overridable by any user or project setting.
- **Audit trail.** Every persona invocation logged in structured JSON —
  who invoked what, when, and what it cost. Feeds into your existing SIEM
  or compliance dashboard.
- **Plugin control.** Force-enable the org's approved plugin for all developers.
  Lock down the marketplace so they can only install approved sources. Same
  policy-based control model you use for everything else.
- **Clean uninstall.** If it doesn't work out, `agentboot uninstall` removes
  everything it added. Tracks what it manages, restores what was there before.
  No orphaned config. No scavenger hunt.

You don't need to understand AI personas. You need to deploy a managed settings
profile and know that guardrails are active. AgentBoot gives you that.

---

## 5. For the Skeptical Developer

### You don't have to use it. But you should know what it does.

Nobody is forcing you to type `/review-code`. Your workflow is your workflow.
AgentBoot respects that.

But here's what's happening in the background: when your team turns on AgentBoot,
the repo you work in gets a `.claude/` directory with some files. If you use
Claude Code, those files give it context about your project's standards, common
pitfalls, and review expectations. If you don't use Claude Code, they sit there
doing nothing. Zero impact on your workflow.

What some of your colleagues are finding:

- The gotchas rules have saved them hours. "I didn't know that about RLS on
  partitions. I would have hit that in production."
- The code reviewer catches things that human reviewers miss in the mechanical
  details — null checks, missing error handling, naming inconsistencies — so
  the human review can focus on design and architecture.
- The test generator produces tests that actually run, against the real schema,
  with realistic data. Not boilerplate.

Your prompts are private. Nobody sees what you type into Claude Code — not your
manager, not the platform team, not AgentBoot. The privacy model is documented
and the architecture enforces it.

Try it once: open Claude Code in any repo and type `/review-code`. If the findings
are useful, use it again. If not, don't. No tracking. No judgment.

---

## 6. For the Non-Technical User (PM, Compliance, Marketing)

### AI that knows your company's rules — no terminal required.

You've heard about the engineering team using AI coding tools. You're curious but
the command line isn't your thing. AgentBoot works in the Claude desktop app too.

What it looks like for you:

- **Compliance review.** Paste a document into Claude. Ask "does this meet our
  data handling policy?" The AI knows your company's actual policies — not
  generic advice from the internet — because AgentBoot loaded them.
- **Standards check.** "Does this API specification follow our versioning
  convention?" The AI has the convention on file. It gives you a specific
  yes or no with citations.
- **Domain questions.** "What are our HIPAA obligations for this feature?"
  The AI draws from your organization's compliance knowledge base, not a
  Google search.

It works through the Claude desktop app (Cowork). No terminal. No installation.
Your IT team sets it up. You open Claude and the knowledge is there.

The same personas that review code for engineers review documents for you.
Same standards. Same knowledge. Different interface.
