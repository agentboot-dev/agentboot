---
title: For Organizations
description: The AgentBoot control model — set policy once, enforce it on supported CLI surfaces, and verify it stays in place, all by pull request.
---

# AI behavior as code

Five teams adopt AI coding agents five different ways, and you answer for all of it. The questions you're accountable for are the classic governance three: **what is our policy, is it actually in effect, and how would we know if it stopped being in effect?**

AgentBoot answers those three questions with a build tool. Policy is authored as versioned artifacts in a central hub repository, compiled to each platform's native configuration, delivered to every repository as a reviewable pull request, and verified afterward by content-hash comparison. There is no server, no dashboard, and no agent runtime — the entire control surface is files in git, which means your existing review, audit, and access controls apply to it automatically.

The model decomposes the way a security reviewer would decompose it: **Set → Enforce → Verify.**

## Set: one policy, layered scopes

Behavior is defined once in the hub and merged down a scope hierarchy (commonly four levels; the scope tree supports arbitrary depth):

```
org  →  group  →  team  →  repo
```

A team scope extends its group; a group extends the org. The payments team can tighten the org baseline without forking it; a repo can add local rules without losing upstream updates. What gets defined at each scope:

- **Personas** — agent role definitions (a code reviewer, a security reviewer, a test generator) composed from reusable **traits**. Change a trait once and every persona that uses it rebuilds.
- **Gotchas** — path-scoped incident rules: the hard-won "never do X in this directory" knowledge that otherwise lives in one senior engineer's head.
- **Domains** — an optional overlay for grouping domain-specific traits, personas, and gotchas (`agentboot add domain`). A generic healthcare starter pack ships today; fuller packaged, opinionated compliance domains are on the [roadmap](/docs/roadmap).
- **Guardrails, marked HARD or SOFT.** SOFT guardrails are defaults a lower scope may adapt. **HARD guardrails cannot be silently disabled downstream** — the compiler detects attempted overrides (including case variations and comments-in-JSON tricks) and refuses to bury them. This is the MDM-style managed-settings property: the org's floor is the floor.

Because policy is markdown and configuration in a git repo, changing policy *is* a pull request — attributed, reviewed, and permanently in history. Your audit trail is `git log`.

## Enforce: honest tiering, stated plainly

Enforcement claims are where tools in this space tend to inflate. Here is the actual support matrix:

| Tier | Platforms | What you get |
|---|---|---|
| **Official** (enforcement-grade) | **Claude Code**, **OpenAI Codex CLI**, **GitHub Copilot CLI** | Compiled compliance hooks emitted into each platform's native mechanism (`.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/agentboot.json`), from one canonical set of portable hook scripts, all blocking on exit code 2 and kept in lock-step across the three platforms. |
| **Official** (advisory) | **`AGENTS.md`** | The industry-standard cross-tool instruction file, compiled and drift-checked as a first-class output. Officially supported — but it is instructions, not hooks, so it carries no blocking enforcement by design. |
| **Community** (advisory) | Cursor, Windsurf, Gemini Code Assist, JetBrains AI, agentskills.io | Native config output is emitted and drift-checked, but there is no blocking-hook enforcement. Advisory means advisory. |

Two caveats we'd rather you hear from us than discover in evaluation:

- **Copilot's hook ceiling is lower than Claude Code's and Codex's.** The hooks are real and blocking within what the platform exposes, but Copilot command-hooks **fail open on timeout** — a hung or slow hook allows the action instead of blocking it. The three platforms do not enforce identically, and we won't imply they do.
- **Enforcement binds tool surfaces, not people.** Blocking hooks constrain the supported CLIs. A developer working outside them isn't constrained by AgentBoot — that's a policy matter for your org, and it's why the third leg exists. The full statement of what AgentBoot does and doesn't defend against is on the [Trust & Architecture page](/trust).

## Verify: drift you can see

Configuration that was correct at rollout and silently modified afterward is the failure mode that makes point-in-time controls worthless. AgentBoot's answer is continuous, mechanical, and checkable:

- **Every synced file is tracked by a content-hash manifest** committed to the repo. `/ab` status and repo listing report **real drift** — a repo where a managed file has been modified is flagged, by hash comparison, not by assumption.
- **AgentBoot detects drift; it does not prevent it.** We won't sell you "zero drift" — no tool that writes files into repos other people control can honestly claim that. What you get is drift you can *see*, on demand, across every connected repo, so "is our policy actually in effect?" has a checkable answer instead of a hopeful one.
- **Delivery is by pull request.** Sync PRs touch only agent-config files — never application code, dependencies, or app config — and re-syncs are idempotent. That narrow, hash-tracked footprint is what makes them safe to auto-merge **under your own branch protections**; the repo owner's review policy always remains the gate.

## Your engineers keep their own setups

The fastest way to lose an AI rollout is to take away the tools your best engineers built for themselves. AgentBoot is the *work* harness — what the org runs — and it is explicitly not a replacement for anyone's personal configuration. Personal setups stay personal; org policy arrives alongside, by PR, in the open. If your engineers ask what this means for them, send them to [Why AgentBoot](/why) — it's written in their vocabulary, and the coexistence answer is the same one printed here.

## How you evaluate this

AgentBoot is built to be evaluated the way your security team already evaluates things — by inspection, not by demo call:

1. **It's self-hosted and serverless.** There is no AgentBoot service. The CLI runs on your machines, reads your hub repo, and talks only to your own git hosting with your own credentials. Nothing to send data to; nothing to sign up for.
2. **The output is plain files.** Compile a hub and read what comes out. The output works even with AgentBoot uninstalled — there's no runtime dependency and no lock-in to evaluate around.
3. **Your first evaluation artifact is a diff.** Connect one low-stakes repo and read the sync PR. Everything AgentBoot will ever do to a repo is visible in that diff format.
4. **The deep answers are written down.** The [Trust & Architecture page](/trust) states the data-flow boundary, the threat model including AgentBoot's own limits, and — for every trust claim — the mechanism behind it and how you verify it yourself.

Apache-2.0, full source on GitHub, no AI-provider account required for core features.

**Start here:** [Delivery methods](/docs/delivery-methods) · [Connecting an org](/docs/org-connection) · [Privacy & data handling](/docs/privacy) · [Trust & Architecture](/trust)
