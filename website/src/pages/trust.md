---
title: Trust & Architecture
description: The data-flow boundary, the threat model including AgentBoot's own limits, and a verification path for every trust claim on this site.
---

# Trust & Architecture

This page exists so you don't have to take our word for anything. Every trust claim AgentBoot makes comes in three parts: the claim, the mechanism that makes it true, and how you verify it yourself. If a claim on this site ever arrives without its verification path, treat that as a bug and file it.

## The data-flow boundary

**There is no AgentBoot server.** Not a telemetry endpoint, not an update service, not an account system. AgentBoot is a build-time CLI: it runs on your machine, reads artifacts from your hub repository, writes plain files, and exits.

The only network activity in the entire system is `agentboot sync` talking to **your own git hosting, with your own credentials**, to open pull requests on repos you control — plus, if and only if your org configures it, `agentboot telemetry-ship` posting to **your org's own collector** (see below). Draw the boundary around your machines and your own infrastructure: nothing crosses it, because there is nothing on the other side to cross to.

Consequences of that architecture, rather than promises layered on top of it:

- Your prompts, personas, and org knowledge never leave your machines.
- No AI-provider account is required for core features — the compiler doesn't call a model.
- Signals read by the CLI (for example, by `agentboot optimize`) stay local by default, and **nothing ever goes to AgentBoot's servers — no default telemetry endpoint exists**. An org may configure its *own* collector (`telemetry.sink`, shipped via `agentboot telemetry-ship`), and that configuration is visible in every synced repo as `telemetry-sink.json` — there is no hidden destination. There is no per-developer scoring of any kind.

## Claim, mechanism, verification

| Claim | Mechanism | How you verify it |
|---|---|---|
| Nothing is transmitted to AgentBoot | There is no AgentBoot server to receive anything and no default telemetry endpoint; the only telemetry destination is a sink your org explicitly configures (`telemetry.sink`), on your own infrastructure | Run `agentboot build` with networking disabled — it completes. Monitor traffic during `sync` — every connection is to your own git host. Check `telemetry-sink.json` in any synced repo — the configured destination (or its absence) is right there. Or search the source for outbound calls. |
| The output is plain files with no runtime dependency | AgentBoot is a compiler; it emits each platform's native config format and exits | Open the emitted files and read them. Uninstall AgentBoot — the config keeps working. |
| Sync never touches application code | Sync writes agent-config files only — never source, app config, or dependencies | Read any sync PR diff. The touched paths are the whole story; there is no other channel. |
| Sync PRs are safe to auto-merge under your own branch protections | Content-hash manifests make re-syncs idempotent, and the diff footprint is confined to agent-config paths | Inspect the manifest committed to a synced repo; re-run `sync` and observe a no-op. Your branch protections remain the gate — AgentBoot never bypasses them. |
| Drift is visible | Managed files are tracked by content hash; status and repo-listing checks compare current hashes against the manifest | Hand-edit a managed file in a synced repo, then run `/ab` status. The repo is flagged. |
| A lower scope cannot silently disable a HARD guardrail | Compile-time override detection, case-insensitive and JSONC-aware | Add an override for a HARD guardrail in a team scope and build. The attempt is surfaced, not buried. |
| Enforcement is blocking on the official CLI surfaces | Hooks are emitted into `.claude/settings.json`, `.codex/hooks.json`, and `.github/hooks/agentboot.json` from one canonical script set, blocking on exit code 2. One stated exception: Copilot CLI command-hooks **fail open on timeout** — a hung or slow hook does not block there | Read the emitted hook files in a compiled repo; trigger a guarded action in a supported CLI and watch it block. |
| The enforcement level is measured, not assumed | `agentboot conformance` probes each platform's hooks empirically and records the result in `dist/<platform>/enforcement-manifest.json` | Run `agentboot conformance` against a compiled hub and read the per-platform enforcement manifest — the declared level is what the probes demonstrated, not what we assert. |
| Sync integrity is verifiable, with an honest trust posture | Content-hash manifests can be signed (`sync.signing`); `agentboot verify-manifest` checks them and states plainly what the check proves — unsigned digests detect corruption only, signed manifests verified with `--require-signed --allowed-signers` are tamper-evident | Run `agentboot verify-manifest` in a synced repo and read its trust-posture readout; strip or forge a signature and watch `--require-signed --allowed-signers` reject it. |
| Releases are attributable to this source tree | npm provenance (Sigstore attestation), SHA-256 checksums, and a completeness-guarded CycloneDX SBOM attached to each release | Follow the step-by-step verification procedure in [SECURITY.md](https://github.com/agentboot-dev/agentboot/blob/main/SECURITY.md): `npm audit signatures`, compare checksums, inspect the SBOM. |
| Compliance evidence is exportable, not screenshot-able | `agentboot evidence-pack` exports a signed bundle of the current enforcement and sync state | Run `agentboot evidence-pack` and verify the bundle's signature yourself before handing it to an auditor. |
| Every change to org policy is attributable | Policy lives in a git repo and moves only by commit and pull request | `git log` on the hub; the PR history on any spoke. |

## Threat model — including our own limits

A trust page that only lists strengths is a marketing page. These are the boundaries of what AgentBoot defends, stated as plainly as we can state them:

- **AgentBoot is not a sandbox for agent execution.** It configures agent behavior at build time; it does not contain, isolate, or supervise an agent at runtime. If you need execution isolation, use your platform's sandboxing and permission systems — AgentBoot emits into those mechanisms; it doesn't replace them.
- **Blocking hooks bind supported CLI surfaces, not people.** A developer who uninstalls the tool, edits the emitted config, or works through an unsupported client is not constrained by AgentBoot. Drift detection makes such changes *visible* at the next check; it does not prevent them. Preventing them is an organizational-policy problem, and we think tools that claim otherwise are misdescribing what software can do.
- **Drift is detected, not prevented.** There is a window between a modification and the next status check. Size that window with how often you run checks; do not size it at zero, because we can't.
- **Enforcement depth varies by platform, even within the official tier.** GitHub Copilot CLI's hook ceiling is lower than Claude Code's and Codex's — specifically, Copilot command-hook timeouts **fail open**: a hung or slow hook allows the action instead of blocking it. The community-tier platforms get advisory output and drift checking, with no blocking enforcement at all.
- **The hub is a trust root.** Whoever can merge to your hub repository defines agent behavior for every connected repo. Protect the hub with the same branch protections, review requirements, and access controls you apply to production code — the delivery-by-PR model assumes you will.

## Supply chain and provenance

AgentBoot is Apache-2.0 and developed fully in the open. There is no binary you have to trust on faith: clone the repository, `npm install`, build it yourself, and the artifact you run is the artifact you audited. The dependency tree is pinned in the lockfile and visible in the repo; the test suite ships alongside the source and runs with the standard test command, so "does this do what the docs say" is an afternoon of reading and one command, not a procurement questionnaire.

You'll notice what isn't on this page: no badges, no logos, no case studies, no named adopters. Claims like those can't be verified from your chair, so they don't belong on a page whose one rule is that everything on it can be.

## Questions

If your evaluation turns up a claim we haven't backed with a mechanism and a verification path — or a boundary we haven't stated — [open an issue](https://github.com/agentboot-dev/agentboot/issues). Hard questions from security reviewers improve this page, and this page is part of the product.
