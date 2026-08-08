---
title: Why AgentBoot
description: Why AI behavior belongs in a compiler — and what the usual alternatives teach you when they stop working.
---

# The compiler for AI behavior as code

Your team knows things your AI tools don't. Which service is deprecated. Why that migration is half-finished. What a good PR looks like here. How the security reviewer thinks. Right now that knowledge lives in scattered rules files, per-tool settings, and the heads of your senior engineers — and every AI coding agent in your org starts from zero.

AgentBoot treats that knowledge the way you treat everything else you depend on: **as code**. You author it once in a central hub repo — personas, reusable traits, path-scoped gotchas, compliance overlays. `agentboot build` compiles it into native configuration for Claude Code, OpenAI Codex CLI, and GitHub Copilot CLI. `agentboot sync` delivers it to every repo as a reviewable pull request, and verifies later that it's still intact.

That's the whole idea. It's a build tool, not a runtime — it produces plain files and exits.

If you're evaluating this, you've probably already thought of three simpler answers. They're good instincts. Here's where each one goes, honestly.

## "But I could just script it"

You could. A shell script or a CI job that copies config files into every repo is a reasonable first move, and for one file format across a handful of repos it works.

Here's where it stops:

- **Formats multiply.** Claude Code wants `.claude/settings.json` and skills; Codex wants its own layout; Copilot wants another. Your script becomes a hand-rolled transpiler with N output targets — the exact program you were trying not to write.
- **Scope has no semantics.** When the payments team needs a stricter rule than the org default, a copy script has no answer. You either fork the script per team or bolt on merge logic — and now you're maintaining an inheritance model in bash.
- **Nothing verifies afterward.** The script pushes files and forgets them. Six weeks later someone has hand-edited the config in three repos and you have no way to know which ones.
- **Delivery is a force-push, not a conversation.** A script overwrites; it doesn't produce a diff a repo owner can review, question, or reject.

The failure points at what's actually needed: **compilation** to multiple native formats, a **scope hierarchy** with real merge semantics, **delivery as pull requests**, and **verification over time**. That's a compiler with a distribution step — not a bigger script.

## "But my AI tool has built-in settings"

It does, and you should use them. Managed and enterprise settings in the major CLIs are genuinely good at what they're for — permissions, allowed tools, what the agent *can't* do.

Two things they don't do:

- **They're constraint-shaped, not instruction-shaped.** Settings tell an agent what's forbidden. They can't teach it what a code reviewer at your org looks for, which patterns are landmines in this codebase, or how your test-data conventions work. "Can't" is a permissions problem; "should" is a knowledge problem, and it's the larger of the two.
- **They're single-platform by design.** Each tool's settings govern that tool. The moment your org runs more than one agent CLI — and most do — you're maintaining parallel policies by hand, and they drift apart quietly.

AgentBoot doesn't replace built-in settings; it emits into them. Compiled hooks land in each platform's native mechanism (`.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/agentboot.json`), from one canonical source. The failure points at what's needed: something that expresses *should*, not just *can't*, and compiles it to every platform you actually run.

## "But I could just copy the rules file into each repo"

The honest answer: on day one, this works perfectly. A good `CLAUDE.md` copied into ten repos is ten repos running the same instructions.

The problem is day ninety:

- **Every copy is a fork.** The moment the files land, they start diverging. Someone improves the copy in one repo; the other nine never hear about it.
- **Nobody knows which version is current.** There's no source of truth — just ten files with a shared ancestor.
- **A hard-won lesson reaches one repo.** Your team hits a production incident, writes the gotcha down… in the repo where it happened. The other repos get to rediscover it.
- **Changes have no review trail.** Rules files edited ad hoc in each repo carry no attribution and no history of *why*.

This failure points at the most important piece: a **hub as the single source of truth**, with changes flowing outward through pull requests, tracked by content-hash manifests so re-syncs are idempotent and modifications are visible. Fix a trait once in the hub and every persona that composes it rebuilds; every repo gets the update as a PR.

## What the three failures have in common

Each alternative is missing a build step. Line them up and the shape of the category is hard to unsee:

| You need | Script | Built-in settings | Copy-paste | AgentBoot |
|---|---|---|---|---|
| One source of truth | — | — | — | Hub repo |
| Multiple native formats | Hand-rolled | Single platform | Hand-copied | Compiled |
| Org → group → team → repo merging | — | — | — | Scope hierarchy |
| Reviewable delivery | Overwrites | N/A | Ad hoc | Pull requests |
| Verified later | — | — | — | Drift detection |

We've treated application code this way for decades: source of truth, compiler, versioned artifacts, review, verification. AI behavior is code. It's overdue for the same treatment.

## When you don't need this

One person, one repo, one AI tool: a hand-maintained rules file is the right answer, and AgentBoot would be overhead. The category exists at team and multi-repo scale — the point where "just keep the file updated" quietly becomes a distribution and verification problem nobody owns.

## Next step

- **See it work:** [first win in five minutes →](/docs/getting-started) — `npm install -g agentboot`, scaffold a hub, open your first sync PR.
- **Evaluating for a team or org:** the [control model for organizations →](/for-organizations) covers scopes, enforcement, and verification in the vocabulary your platform and security leads will want.
