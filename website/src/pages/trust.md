---
title: Trust & Architecture
description: The data-flow boundary, the threat model including AgentBoot's own limits, and a verification path for every trust claim on this site.
---

# Trust & Architecture

This page exists so you don't have to take our word for anything. Every trust claim AgentBoot makes comes in three parts: the claim, the mechanism that makes it true, and how you verify it yourself. If a claim on this site ever arrives without its verification path, treat that as a bug and file it.

## The data-flow boundary

**There is no AgentBoot server.** Not a telemetry endpoint, not an update service, not an account system. AgentBoot is a build-time CLI: it runs on your machine, reads artifacts from your hub repository, writes plain files, and exits.

The only network activity in the entire system is `agentboot sync` talking to **your own git hosting, with your own credentials**, to open pull requests on repos you control. Draw the boundary around your machines and your git host: nothing crosses it, because there is nothing on the other side to cross to.

Consequences of that architecture, rather than promises layered on top of it:

- Your prompts, personas, and org knowledge never leave your machines.
- No AI-provider account is required for core features — the compiler doesn't call a model.
- Signals read by the CLI (for example, by `agentboot optimize`) are local-only. There is no phone-home, and there is no per-developer scoring of any kind.

## Claim, mechanism, verification

| Claim | Mechanism | How you verify it |
|---|---|---|
| Nothing is transmitted to AgentBoot | There is no server to receive anything; the CLI has no telemetry endpoint | Run `agentboot build` with networking disabled — it completes. Monitor traffic during `sync` — every connection is to your own git host. Or search the source for outbound calls. |
| The output is plain files with no runtime dependency | AgentBoot is a compiler; it emits each platform's native config format and exits | Open the emitted files and read them. Uninstall AgentBoot — the config keeps working. |
| Sync never touches application code | Sync writes agent-config files only — never source, app config, or dependencies | Read any sync PR diff. The touched paths are the whole story; there is no other channel. |
| Sync PRs are safe to auto-merge under your own branch protections | Content-hash manifests make re-syncs idempotent, and the diff footprint is confined to agent-config paths | Inspect the manifest committed to a synced repo; re-run `sync` and observe a no-op. Your branch protections remain the gate — AgentBoot never bypasses them. |
| Drift is visible | Managed files are tracked by content hash; status and repo-listing checks compare current hashes against the manifest | Hand-edit a managed file in a synced repo, then run `/ab` status. The repo is flagged. |
| A lower scope cannot silently disable a HARD guardrail | Compile-time override detection, case-insensitive and JSONC-aware | Add an override for a HARD guardrail in a team scope and build. The attempt is surfaced, not buried. |
| Enforcement is blocking on the official CLI surfaces | Hooks are emitted into `.claude/settings.json`, `.codex/hooks.json`, and `.github/hooks/agentboot.json` from one canonical script set, blocking on exit code 2 | Read the emitted hook files in a compiled repo; trigger a guarded action in a supported CLI and watch it block. |
| Every change to org policy is attributable | Policy lives in a git repo and moves only by commit and pull request | `git log` on the hub; the PR history on any spoke. |

## Threat model — including our own limits

A trust page that only lists strengths is a marketing page. These are the boundaries of what AgentBoot defends, stated as plainly as we can state them:

- **AgentBoot is not a sandbox for agent execution.** It configures agent behavior at build time; it does not contain, isolate, or supervise an agent at runtime. If you need execution isolation, use your platform's sandboxing and permission systems — AgentBoot emits into those mechanisms; it doesn't replace them.
- **Blocking hooks bind supported CLI surfaces, not people.** A developer who uninstalls the tool, edits the emitted config, or works through an unsupported client is not constrained by AgentBoot. Drift detection makes such changes *visible* at the next check; it does not prevent them. Preventing them is an organizational-policy problem, and we think tools that claim otherwise are misdescribing what software can do.
- **Drift is detected, not prevented.** There is a window between a modification and the next status check. Size that window with how often you run checks; do not size it at zero, because we can't.
- **Enforcement depth varies by platform, even within the official tier.** GitHub Copilot CLI's hook ceiling is lower than Claude Code's and Codex's. The community-tier platforms get advisory output and drift checking, with no blocking enforcement at all.
- **The hub is a trust root.** Whoever can merge to your hub repository defines agent behavior for every connected repo. Protect the hub with the same branch protections, review requirements, and access controls you apply to production code — the delivery-by-PR model assumes you will.

## Supply chain and provenance

AgentBoot is Apache-2.0 and developed fully in the open. There is no binary you have to trust on faith: clone the repository, `npm install`, build it yourself, and the artifact you run is the artifact you audited. The dependency tree is pinned in the lockfile and visible in the repo; the test suite ships alongside the source and runs with the standard test command, so "does this do what the docs say" is an afternoon of reading and one command, not a procurement questionnaire.

You'll notice what isn't on this page: no badges, no logos, no case studies, no named adopters. Claims like those can't be verified from your chair, so they don't belong on a page whose one rule is that everything on it can be.

## Questions

If your evaluation turns up a claim we haven't backed with a mechanism and a verification path — or a boundary we haven't stated — [open an issue](https://github.com/agentboot-dev/agentboot/issues). Hard questions from security reviewers improve this page, and this page is part of the product.
