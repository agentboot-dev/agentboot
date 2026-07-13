---
id: vs-a-hand-rolled-settings-repo
title: AgentBoot vs. a hand-rolled settings repo
description: When a checked-in CLAUDE.md and a copy script are genuinely enough — and the specific points where a hand-rolled setup stops working.
---

# AgentBoot vs. a hand-rolled settings repo

The most common alternative to AgentBoot isn't another tool — it's the repo you'd
build yourself: a `settings` repo holding a `CLAUDE.md`, a `settings.json`, maybe
some rules files, plus a script or CI job that copies them into your other repos.

That setup is not a mistake. For a lot of teams it's the right call. This page is
about where the line actually is.

## When the hand-rolled repo is fine

- **One repo.** A checked-in `CLAUDE.md` is fine for one repo. Full stop. It's
  versioned, it's reviewed, it travels with the code. Adding a build tool here is
  overhead with no payoff.
- **One platform.** If everyone is on the same tool, you have one file format to
  maintain and no translation problem.
- **A handful of repos that rarely change.** If the shared config changes twice a
  year and someone remembers to re-copy it, a script is honestly enough.
- **You want zero new dependencies.** A settings repo needs nothing installed.
  That's a real advantage; don't discount it.

If that's you, keep the settings repo. Revisit this page when one of the following
starts happening.

## Where it stops working

Each of these failure points is a thing the hand-rolled setup has no answer for —
not because it was built badly, but because a copy script was never designed to
answer it.

### 1. The copies diverge, and nobody can see it

The copy script pushes files out; nothing checks them afterward. Six weeks later
someone hand-edits the copy in one repo — a reasonable local fix — and now that
repo silently runs different rules than the rest of the org. There is no signal.

AgentBoot tracks every synced file in a content-hash manifest. A modified managed
file shows up as **drift** in `/ab` status and `list_repos` — flagged, per repo,
per file. To be precise about the claim: this is *detection*, not prevention.
AgentBoot doesn't stop the edit; it makes the edit visible instead of silent.
Drift you can see.

### 2. A second platform doubles your maintenance

The moment one team adopts a second tool, your single source of truth becomes two
hand-maintained dialects of the same rules — then three. Every lesson learned now
needs N edits, and the dialects drift from each other exactly like the copies did.

AgentBoot compiles one set of artifacts into native output per platform — with
enforcement-grade support on the Claude Code, OpenAI Codex, and GitHub Copilot CLI
surfaces and community-tier (advisory) output for the rest. The
[platform capability matrix](./platform-capability-matrix.md) states exactly what
each platform gets; the difference between enforced and advisory is stated there,
not glossed.

### 3. A settings file states policy; nothing binds it

A distributed `settings.json` or `CLAUDE.md` is a statement of intent. An agent —
or a hurried human — can work around it, and you'll find out in review, or later.

On the three officially supported CLI surfaces, AgentBoot emits **blocking
compliance hooks** (exit code 2 stops the action) from one canonical script set.
That's the difference between "we documented the rule" and "the rule fires."
Scope stays honest here too: hooks bind the supported CLI surfaces — they don't
constrain someone who uninstalls the tooling, which is what your branch
protections and CI are for.

### 4. "One config for everyone" stops being true

The payments team needs stricter rules than the prototypes repo. In a hand-rolled
setup that means forking the config — and forks are where shared config goes to
die. AgentBoot's scope hierarchy (**org → group → team → repo**) merges instead of
forking: a team extends its group, which extends the org, and HARD guardrails
can't be silently disabled by a lower scope.

### 5. Distribution without review

A copy script overwrites files in place. AgentBoot's `sync` delivers changes as
**pull requests**, so every config change lands with a diff, an author, and a
review — the same audit trail as code. Sync PRs touch only agent-config files,
which makes them safe to auto-merge **under your own branch protections**.

## What the hand-rolled repo still does better

Honest scorekeeping in the other direction:

- **Simplicity.** No build step, no hub layout, no new tool to learn. AgentBoot
  asks you to adopt a compile-and-distribute model and its artifact conventions
  (personas, traits, gotchas); that's a real cost.
- **Total flexibility.** Your script does exactly what you wrote, nothing else.
- **No dependency.** Worth noting, though, that AgentBoot's output is plain files
  that keep working if you remove AgentBoot — the dependency is on the build
  loop, not the runtime.

## The bottom line

"Could I just script it?" — yes, and at small scale you should. But if you find
yourself adding a manifest so you know what was copied where, a hash check so you
notice edits, a merge layer for per-team overrides, and per-platform emitters —
you're no longer scripting a copy; you're rebuilding this category. At that point
it's worth comparing your afternoon project against a tool whose whole job this
is: start with [import](./import.md), which pulls your existing settings repo into
a hub without rewriting it.
