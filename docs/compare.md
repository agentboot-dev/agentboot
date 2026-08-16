---
id: compare
title: Compare — where are you now?
description: An honest, named comparison of every way to manage AI agent config — hand-maintained files, a homegrown settings repo, and real tools like Ruler, rulesync, and Packmind — and when each is the better choice than AgentBoot.
---

# Compare — where are you now?

Most people arrive here from one of three places: hand-maintaining a file per tool,
running a settings repo and a copy script they wrote, or evaluating real tools against
each other. This page covers all three honestly, including the cases where the answer
is **don't adopt AgentBoot**.

Two ground rules for reading it.

**First, these are all legitimate approaches**, and several are the right choice in
situations named below. A comparison page that concludes "and that's why you should pick
us" every time isn't a comparison, it's an ad. Where something else wins, we say so.

**Second, this is dated July 2026.** This category moves monthly. We'd rather you
re-verify a claim than trust a stale one — if we've gotten something wrong or out of
date, [open an issue](https://github.com/agentboot-dev/agentboot/issues) and we'll fix it.

---

## Find yourself

| If this is you… | Go to | Short answer |
|---|---|---|
| "I keep a `CLAUDE.md`, some Cursor rules, and a `copilot-instructions.md`, and I edit them by hand." | [1 · Per-tool files](#1--per-tool-files-by-hand) | Fine at one tool or one repo. Breaks on repetition. |
| "We have a settings repo and a script that copies it around." | [2 · A hand-rolled settings repo](#2--a-hand-rolled-settings-repo) | Genuinely good until you start adding a manifest, a hash check, and per-team overrides. |
| "I'm choosing between real tools for my org." | [3 · Real tools](#3--real-tools) | Read the capability table. Several of them may beat us for your case. |
| "My engineers each installed their own thing." | [Adjacent: personal harness frameworks](#personal-harness-frameworks) | Not an org solution and doesn't claim to be — but it's your real starting point. |

---

## 1 · Per-tool files, by hand

The default: one file per tool, each in its own format, each maintained by hand. A
`CLAUDE.md` for Claude Code, `.cursor/rules` for Cursor,
`.github/copilot-instructions.md` for Copilot, an `AGENTS.md` for whatever reads that.

### When this is fine

- **You use one tool.** One tool means one file. A compiler that emits one output format
  is overhead, not leverage.
- **The content is small and stable.** Two short files you touch quarterly don't need a
  build step. Copy-paste is annoying twice a year; it's a crisis twice a week.
- **The file is genuinely repo-specific.** Notes about *this* codebase's layout belong in
  that repo's own file. This whole category is for the content you keep re-explaining
  across repos and tools — not for everything.

### Where it stops working

The failure is repetition, and it's gradual enough to miss:

1. **Same rule, N dialects.** "Never write raw SQL against the reporting DB" now lives in
   three files in three formats. Each rewrite is a chance to say it slightly differently.
2. **They diverge silently.** You fix the wording in `CLAUDE.md` and forget
   `.cursor/rules`. Nothing diffs them against each other; nothing ever will. Your tools
   are now getting different instructions and nobody decided that.
3. **New lessons pay a distribution tax.** A production incident teaches you something
   worth encoding. That lesson is only real once it's in *every* file in *every* repo —
   so it usually ends up in one.
4. **There is no canonical copy.** When two files disagree, which is right? In a
   hand-maintained setup that question has no answer.

### What compiling from one source changes

Author once as personas, traits, and gotchas; compile to every format with one command.
The rule has one home, the dialects are generated, and "which file is right" becomes a
question with an answer.

**The honest trade-off:** you gain a build step and a set of artifact conventions to
learn. Per-tool files are WYSIWYG — the file you read is the file you edit. With a
compiler, the file in the repo is build output and the thing you edit lives in the hub.
That indirection is the price of having one source, and if you edit the output directly
you've created drift.

**The crossover heuristic:** roughly **(number of tools) × (number of repos) × (how often
the content changes)**. When that product is small, hand-maintained files are simpler and
you should keep them. When it grows, every unit of it is a copy you're maintaining by
hand — and [import](./import.md) will pull the files you already have into a hub without
making you start over.

---

## 2 · A hand-rolled settings repo

A shared repo with your config in it and a script that copies it into each project. This
is the most common homegrown answer and it is a genuinely reasonable engineering
decision.

### When this is fine

- **One repo.** A checked-in `CLAUDE.md` is fine for one repo. Full stop. It's versioned,
  it's reviewed, it travels with the code.
- **One platform.** Same tool everywhere means one file format and no translation problem.
- **A handful of repos that rarely change.** If the shared config changes twice a year and
  someone remembers to re-copy it, a script is honestly enough.
- **You want zero new dependencies.** A settings repo needs nothing installed. That's a
  real advantage; don't discount it.

If that's you, keep the settings repo.

### Where it stops working

Each of these is something a copy script was never designed to answer:

**The copies diverge and nobody can see it.** The script pushes files out; nothing checks
them afterward. Six weeks later someone hand-edits a copy in one repo — a reasonable
local fix — and that repo silently runs different rules than the rest of the org. There
is no signal.

*What changes:* every synced file is tracked in a content-hash manifest, and a modified
managed file surfaces as **drift**, per repo, per file. To be precise: this is
*detection*, not prevention. The edit isn't blocked; it stops being invisible.

**A second platform doubles the maintenance.** The moment one team adopts a second tool,
your single source of truth becomes two hand-maintained dialects — then three. Every
lesson now needs N edits, and the dialects drift from each other exactly like the copies
did.

*What changes:* one set of artifacts compiles to native output per platform. See the
[platform capability matrix](./platform-capability-matrix.md) for exactly what each
platform gets — the difference between enforced and advisory is stated there, not glossed.

**Per-team differences have nowhere to live.** A copy script copies the same thing
everywhere. The moment one team needs something different, you're forking the file or
adding conditionals to the script.

*What changes:* scopes layer — org, then group, then team — by **merge**, not
replacement, so a team addition doesn't silently drop org policy.

**A settings file states policy; nothing binds it.** A distributed `settings.json` or
`CLAUDE.md` is a statement of intent. An agent — or a hurried human — can work around it,
and you find out in review, or later.

*What changes:* on the three officially supported CLI surfaces, blocking compliance hooks
are emitted from one canonical script set (exit code 2 stops the action). That's the
difference between "we documented the rule" and "the rule fires." Scope stays honest here
too: hooks bind the supported CLI surfaces — they don't constrain someone who uninstalls
the tooling, which is what branch protections and CI are for.

**Distribution happens without review.** A copy script overwrites files in place. Nobody
sees a diff, and there's no record of who changed what.

*What changes:* `sync` delivers changes as **pull requests** — every config change lands
with a diff, an author, and a review, the same audit trail as code.

### What the hand-rolled repo still does better

Honest scorekeeping in the other direction:

- **Simplicity.** No build step, no hub layout, no new tool to learn. AgentBoot asks you
  to adopt a compile-and-distribute model and its conventions. That's a real cost.
- **Total flexibility.** Your script does exactly what you wrote, nothing else.
- **No dependency.** Worth noting that AgentBoot's output is plain files that keep working
  if you remove AgentBoot — the dependency is on the build loop, not the runtime.

### The bottom line

"Could I just script it?" — yes, and at small scale you should. But if you find yourself
adding a manifest so you know what was copied where, a hash check so you notice edits, a
merge layer for per-team overrides, and per-platform emitters, you're no longer scripting
a copy — you're rebuilding this category. At that point it's worth comparing your
afternoon project against tools whose whole job this is. Start with
[import](./import.md), which pulls an existing settings repo into a hub without rewriting
it.

---

## 3 · Real tools

The serious alternatives aren't hand-maintained files — they're real tools with real
communities, and in several cases real companies. If you're evaluating this space you'll
rightly ask: *why not `AGENTS.md` as the single source of truth? Why not
[Ruler](https://github.com/intellectronica/ruler) or
[rulesync](https://github.com/dyoshikawa/rulesync)? Why not
[Packmind](https://packmind.com/), which has a company behind it? Why not manage rules
from our developer portal?*

Here's the capability answer.

| Capability | AGENTS.md as SSOT | Ruler / rulesync | Packmind | Portal-managed | AgentBoot |
|---|---|---|---|---|---|
| One source → many tool formats | thin per-tool wrappers | **yes — their core job** (rulesync targets 40+) | yes (8 incl. AGENTS.md) | AGENTS.md-centric | yes (8 platforms + AGENTS.md) |
| Org → group → team → repo scoping | nested files; v1.1 *proposes* accumulation, per-tool in practice | directory nesting / concatenation | file-pattern + subdirectory scoping | scoped rules with *override* precedence | **merge composition** — scopes layer; hard guardrails can't be silently overridden below (soft preferences stay adaptable) |
| Delivery to many repos | manual / DIY | local apply per repo | **yes — centralized, unlimited repos** | sync (PR-based in the portal we reviewed) | PRs from the hub, per scope |
| Drift detection | none | re-apply and diff (DIY in CI) | **yes — code-vs-standards linter** | portal-side regeneration only | content-hash manifests + `drift-check` on the *delivered files*, exceptions with expiry |
| Verification / tamper evidence | — | — | — | — | signed manifests, `verify-manifest`, optional in-toto/DSSE attestation |
| Enforcement (hooks that block) | none — instructions only | none | none | none | compiled hooks, empirically probed by a conformance harness |
| Audit evidence | — | — | governance + audit trail (paid tier) | — | `evidence-pack` (signed governance-state bundle) |
| Access control, SSO/SCIM | — | — | **yes (paid tier)** | yes | — (git permissions only) |
| Company behind it | Linux Foundation (spec) | community | **yes — SOC 2 Type II** | yes | no — single maintainer |

### AGENTS.md as your single source of truth

Now Linux Foundation infrastructure under the Agentic AI Foundation, adopted by 60k+
projects and read by 30+ tools. If you're standardizing on one file, this is the one.

Its scoping model is nested files. The [v1.1 proposal](https://github.com/agentsmd/agents.md/issues/135)
describes guidance as **accumulating** down the tree — a local file extends its ancestors and
takes precedence only where instructions actually conflict — but that proposal is not yet
accepted, and **each tool decides for itself what it does with the files it finds.** So what an
org actually gets is the behaviour of whichever agents its engineers run, which may be
accumulation, may be nearest-wins replacement, and is not verified anywhere.

That variance is the real gap, and it is narrower than an earlier version of this page claimed:
we described replacement as the standard's model, which overstated it. The composition argument
does not need that. Even under full accumulation, nothing checks that a team-level file has not
contradicted an org-level rule, and nothing tells you which behaviour your fleet is actually
getting.

**When it's the right choice:** one file per repo genuinely covers your needs, your tools
all read it, and you don't need composition, delivery, or verification.

### Ruler and rulesync — format fan-out CLIs

[Ruler](https://github.com/intellectronica/ruler) applies centralized rule files across
agents; [rulesync](https://github.com/dyoshikawa/rulesync) generates unified rule files
into a very wide set of output formats. Both are well regarded and actively developed,
and **rulesync in particular covers more output formats than AgentBoot does** — 40+
against our 8 plus AGENTS.md. If breadth of format support is your binding constraint,
that difference is real and it favors them.

What they're not: neither is a distribution system. They apply locally, per repo. Getting
one to run across sixty repos, open PRs, and tell you afterward what drifted is work you
do yourself.

**When they're the right choice:** you want format fan-out, you're comfortable wiring the
distribution and checking into your own CI, and you'd rather own that glue than adopt a
hub model.

### Packmind

An open-core context-engineering platform: author a central playbook, distribute it to
eight agent formats across unlimited repos, with versioning, conformity checking, and a
drift linter. The core is Apache-2.0 and free for unlimited users and repos; the paid
tier adds RBAC, SSO/SAML/SCIM, audit, and data-residency options. Self-hostable on
Kubernetes, including air-gapped.

This is the closest thing to AgentBoot's overall shape, and it comes with things a
single-maintainer open-source project does not have: **a company, a support contract, and
SOC 2 Type II certification.** For a regulated organization that is frequently the whole
decision, and we'd rather say that plainly than have you find out later.

Two differences worth understanding precisely, because the words overlap but the
mechanisms don't:

- **Their drift is code-vs-standards; ours is file-vs-manifest.** Theirs asks "does this
  code follow our rules?" — a linter. Ours asks "is the config we shipped still the
  config that's there?" — a tamper check. Both are useful; they answer different
  questions, and neither substitutes for the other.
- **They document no blocking enforcement, and no cryptographic verification** of what
  was distributed — no hooks that deny an action, no signed manifests, no attestation.
  Their heritage is code review and practice adoption, and it shows in what they're
  excellent at.

**When it's the right choice:** you need a vendor relationship, a certification, RBAC and
SSO, or a supported product with a roadmap you don't own. That's most enterprises, and
it's a good reason.

### Portal-managed rules (internal developer portals)

At least one commercial internal developer portal now manages AI coding rules alongside
the rest of the service catalog, with three-tier scoping and PR-based sync. If your org
already runs on a portal, keeping agent config next to your service metadata is coherent
and reduces the number of places engineers look.

The limits: it's AGENTS.md-centric with *override* rather than merge precedence, nothing
watches the repos for drift or verifies what's deployed, and pricing is enterprise-portal
pricing.

**When it's the right choice:** you're standardized on the portal, your rules fit one
AGENTS.md per repo, and governance-grade verification isn't a requirement.

---

## Adjacent

Two kinds of tool come up in evaluations that answer a different question. Both are worth
knowing about.

### Personal harness frameworks

Frameworks like [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework)
give one developer a much better Claude Code: curated commands, cognitive personas,
methodology. There's no hub, no distribution to other repos, no scoping, no drift
detection — and no claim to any of it.

We name it explicitly because AgentBoot's trait model owes it a debt: SuperClaude
independently developed trait-based behavioral composition, which we adopted and extended
for multi-org governance (see
[ACKNOWLEDGMENTS](https://github.com/agentboot-dev/agentboot/blob/main/ACKNOWLEDGMENTS.md)).

**The honest framing for an org:** these aren't alternatives to a distribution tool —
they're what your engineers have already installed individually. The org-level question
is whether you're content to leave it there. For a single developer, or a team that wants
better personal tooling rather than governed distribution, a personal harness framework is
the simpler answer and AgentBoot is overkill.

### Attestation and supply-chain tooling

Tools that bind build artifacts to builder identity via in-toto, DSSE, and Sigstore define
the bar for the word "attested." AgentBoot's SSH-signature posture is honestly graded as
*signed, not attested* — credible integrity and known-key authenticity, roughly
git-commit-signing grade, without CI-identity binding or a transparency log. If your
requirement is true attestation, that's a real gap and you should evaluate dedicated
tooling for it.

---

## What the combination buys — and what it costs

AgentBoot exists for the case where AI-agent configuration is an **org governance
surface**: security guardrails that must reach every repo and must not be silently
weakened; per-team specialization that layers on top of rather than replaces org policy;
proof — not assumption — that what's deployed is what was decided; enforcement hooks whose
behavior is probed by a conformance harness instead of asserted; and an
auditor-consumable evidence export.

The costs, stated plainly:

- **A hub repo and a build step** to adopt, plus artifact conventions to learn.
- **8 platforms + AGENTS.md**, narrower than rulesync's 40+.
- **No RBAC, no SSO/SCIM, no web UI, no hosted service.** Access control is your git
  permissions. This is deliberate and not on the roadmap.
- **A single maintainer.** No company, no support contract, no certifications. The
  mitigations are real — Apache-2.0, no proprietary formats, output is plain files you
  already own, and `uninstall` restores what was there — but they are mitigations, not
  an answer. If your procurement process needs a vendor, we are not one.

If your situation doesn't need the governance loop, those costs buy you little. Use the
simpler tool and revisit if the questions change.

## Still not sure?

A rough decision order that matches how most orgs actually get here:

1. **One repo or one tool?** Stay hand-maintained.
2. **A few repos, rare changes, no appetite for dependencies?** A settings repo and a
   script is genuinely enough.
3. **Need format breadth above all?** Ruler or rulesync.
4. **Need a vendor, a certification, RBAC, or SSO?** Packmind or a portal.
5. **Need composed scopes, delivery, drift detection on the delivered files, cryptographic
   verification, and probed enforcement — and can live without a vendor?** That's the
   case AgentBoot is built for.

If you land on 1 through 4, that's a good outcome and we'd rather you get there quickly.
