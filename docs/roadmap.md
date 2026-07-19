---
sidebar_label: "Roadmap"
sidebar_position: 2
---

# Roadmap

Where AgentBoot is headed. This page is forward‑looking — themes and intent, **not dated
commitments**; priorities shift with what teams actually need. For the full record of what has
already shipped, see the [CHANGELOG](https://github.com/agentboot-dev/agentboot/blob/main/CHANGELOG.md).

## Where we are today — v0.13.0 (public Beta)

**AgentBoot v0.13.0 is a public Beta.** The full pipeline works end to end today: it compiles your
team's AI behavior — personas, traits, rules, gotchas, and domain layers — from one hub repo into
native config for the **CLI surfaces** of **Claude Code**, **OpenAI Codex**, and **GitHub
Copilot**, and delivers it to every repo as a reviewable pull request, with drift detection,
managed settings, blocking compliance hooks, an MCP server, harness templates, user‑level install,
and the `/ab` natural‑language interface. Cursor, Windsurf, Gemini, and JetBrains are supported at
a **community tier** (native output, but advisory — not an enforced control).

Beta means the surface is real and usable, and we want it tested in the wild before we call it
**v1.0 GA**. Expect a few rough edges — and tell us where you hit them.

> **Support is scoped to the CLI surface today.** Broadening to the IDE and editor extensions of
> these tools — and to additional platforms — is on the roadmap below.

### Help shape v1.0

AgentBoot is open source (Apache‑2.0) and built in the open. During the Beta, the most useful
things you can do:

- **Try it on a real repo** and [open an issue](https://github.com/agentboot-dev/agentboot/issues)
  for anything that breaks, confuses, or surprises you — bug reports and rough‑edge reports are
  gold right now.
- **Tell us about your platform** — especially if you live in an IDE/editor extension or a
  community‑tier tool. Real usage shapes what graduates to enforced support first.
- **Contribute** — traits, gotchas, harness templates, and platform emitters are all welcome.
  Start a [discussion](https://github.com/agentboot-dev/agentboot/discussions) or send a pull request.

Your feedback during v0.11 is what turns it into a v1.0 you can standardize on.

---

## What's next

### Now — harden the surface and release v1.0 GA

The near‑term goal is to take the Beta to **v1.0 GA**: make the shipped surface rock‑solid on real
teams, close the gaps Beta feedback surfaces, and earn the "you can standardize on this" bar.

- **Beta feedback loop** — triage and fix what real‑world Beta use turns up. The fastest path to
  1.0 is issues from actual repos.
- **Windows support hardening** — promote the Windows CI leg from advisory to enforced as the
  remaining git‑bash/path edge cases are closed with real‑world feedback.
- **Empirical hook verification** — prove blocking‑hook enforcement (exit‑code‑2 deny) end‑to‑end
  on each of the three official CLIs, not just the emitted shape.
- **Import & onboarding refinement** — smoother first run and a sharper import classifier so
  pulling an existing `CLAUDE.md` / `AGENTS.md` / rules files into a hub is close to one step.

### Next — reach and depth

- **Broader platform surfaces** — official support for the **IDE and editor extensions** of the
  supported tools (beyond today's CLI surface), plus a path for community‑tier platforms (Cursor,
  Windsurf, Gemini, JetBrains) to graduate toward enforced support as their hook and settings
  surfaces allow.
- **More harness templates** — additional ready‑to‑tune bundles beyond `sdlc-orchestrator`
  (e.g., API‑service, event‑processor, and data‑pipeline topologies) via `add template`.
- **Promotion lifecycle** — `proposed → incubating → stable → deprecated` stages for shared
  artifacts, so contributions can mature in the open, with smart‑sync defaults that touch only
  affected repos.
- **Behavioral evaluation** — a working behavioral test runner for "does the persona actually
  behave this way" assertions, wired into CI.
- **Deeper hook coverage** — more lifecycle events per platform as each tool's hook surface grows.
- **Distributed repo operations** — run a git operation (e.g., pull) across every registered repo
  from one command, a natural extension of hub‑and‑spoke management.

### Later — org scale & governance

- **Domain layers** — packaged, opinionated compliance domains (healthcare, fintech, govtech):
  traits + personas + gotchas + instructions, ready to adopt and tune.
- **ADR governance** — an exception lifecycle for architectural decisions, with expiry validation
  so stale exceptions surface instead of lingering.
- **Agent‑to‑Agent (A2A)** — expose personas as A2A‑callable services, complementing MCP for
  multi‑agent enterprise architectures.
- **Autonomy progression** — an explicit ladder from advisory → auto‑approve → autonomous, with
  promotion gated on telemetry and trust rather than a flag flip.
- **Org insights** — aggregate, anonymized signals that help a team improve *its harness*
  (where guardrails fire, where prompts get rephrased, where cost concentrates). Designed to
  improve the configuration, **never to score individuals** — and raw prompts never leave the
  machine.
- **Expanded user‑scope installs** — build on the v1.0 user‑level install so a solo developer can
  run a personal setup scoped to their OS user, without a formal org hub.
- **Additional community platforms** — assess integrations for further editors and agent runtimes
  (e.g., OpenCode, Cline) at the community tier.

---

## Release history

The short version — full detail in the
[CHANGELOG](https://github.com/agentboot-dev/agentboot/blob/main/CHANGELOG.md):

- **v0.13.0 — org-scale import (current).** Multi-repo import sweeps now converge
  boilerplate shared across repos onto one promoted org artifact carrying provenance
  from every contributing repo — duplicate content is never re-appended and never
  silently overwritten, and repo-specific residuals import normally.
- **v0.12 — enterprise hardening.** The adopting‑organization batch: pluggable
  content scanners + blocking output scan; MCP read‑only profile + identity pinning; policy
  exceptions with owners and expiry; merged managed artifacts per scope; `claude.settings`
  pass‑through; import‑first sync safety; telemetry contract + `telemetry-inspect`;
  prompt‑size CI gates; SBOM + checksums on releases; the `/review-ai-security` persona;
  healthcare starter pack; enterprise operations guide; scope‑layout unification; Agent
  Skills + plugin spec conformance (validated in CI).
- **v0.11.** The public Beta. The full compile → deliver‑by‑PR pipeline for the CLI
  surfaces of Claude Code, OpenAI Codex, and GitHub Copilot; cross‑platform compliance hooks; drift
  detection; managed settings / HARD guardrails; the `/ab` interface; MCP server; the
  `sdlc-orchestrator` harness template; user‑level install; security hardening.
- **v0.10.** The `/ab` skill + MCP server; harness templates; remote‑repo import; global hub
  registry; smart sync.
- **v0.7–v0.9.** Trait‑weight calibration; multi‑platform output (Gemini, Windsurf, JetBrains);
  monorepo support; `cost-estimate`; optimization tooling; evaluation maturity.
- **v0.5–v0.6.** Cross‑platform output and richer import; enterprise governance, validation,
  testing, and CI.
- **v0.1–v0.4.** The build pipeline (validate → compile → sync); plugin packaging; the N‑tier
  scope model; composition types, lexicon, and `AGENTS.md`.
