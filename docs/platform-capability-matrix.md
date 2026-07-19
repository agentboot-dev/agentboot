---
id: platform-capability-matrix
title: Platform capability matrix
description: Exactly what AgentBoot can and cannot enforce on each platform — Claude Code, OpenAI Codex CLI, GitHub Copilot CLI, and the community tier.
---

# Platform capability matrix

This page states exactly what AgentBoot can and cannot do on each platform, because
a governance claim that's true on one platform and assumed on the others isn't a
governance claim.

**Officially supported (enforcement-grade):** the CLI surfaces of **Claude Code**,
**OpenAI Codex CLI**, and **GitHub Copilot CLI**. On these three, AgentBoot emits
blocking compliance hooks from one canonical set of portable hook scripts, kept in
lock-step.

**Officially supported output (advisory-enforcement):** the universal **`AGENTS.md`**
standard — the industry-standard cross-tool instruction file. AgentBoot generates and
maintains it as a first-class, officially supported output. Support tier is not
enforcement tier: AGENTS.md is advisory by nature (the standard has no hook
mechanism), so it never carries blocking enforcement — that remains a Claude Code /
Codex / Copilot capability.

**Community tier (advisory):** Cursor, Windsurf, Gemini, JetBrains, and
agentskills.io `SKILL.md` output. AgentBoot emits native
instruction files for these, and drift detection still covers the files — but
AgentBoot does not emit enforcement hooks for them, so nothing *enforces* the
content. (Several of these tools — Cursor, Windsurf, Gemini — do have hook surfaces
of their own; AgentBoot just doesn't bind them today.) Guidance an agent can ignore
is not a control.

## The matrix

| Capability | Claude Code | OpenAI Codex CLI | GitHub Copilot CLI | Community tier |
|---|---|---|---|---|
| **Compiled instructions** (personas, traits, gotchas → native config) | ✅ `CLAUDE.md`, skills, `settings.json` | ✅ `AGENTS.md`, `.agents/skills/` | ✅ `copilot-instructions.md`, path-scoped `.instructions.md`, agents | ✅ Native files emitted (Cursor rules, Gemini, JetBrains, `SKILL.md`) — **advisory only**. The universal `AGENTS.md` file is an **officially supported output** (not community tier), but its enforcement class is the same: advisory |
| **Blocking pre-tool-use / lifecycle hooks** | ✅ Full hook lifecycle (`PreToolUse`, `PostToolUse`, `Stop`, …), blocking on exit code 2, via `.claude/settings.json` | ✅ Blocking on exit code 2, via `.codex/hooks.json` — hooks require a trust review unless deployed as managed; tool coverage is partial (shell/patch/MCP, not WebSearch); `SessionEnd` unsupported | ⚠️ Blocking on exit code 2, via `.github/hooks/agentboot.json` — **lower ceiling**: fewer hook types; command-hook **timeouts fail open** (a slow hook does not block); exit-2 blocking is documented but **not yet empirically verified for GA** | ❌ AgentBoot emits no enforcement here — instructions only. (Cursor/Windsurf/Gemini have hook surfaces of their own; AgentBoot does not bind them today.) |
| **Drift detection** | ✅ Content-hash manifest comparison flags any managed file that's been modified | ✅ Same mechanism | ✅ Same mechanism | ✅ Same mechanism — the files are still drift-checked, but nothing enforces their content |
| **Managed settings** (non-overridable) | ✅ `managed-settings.json` — MDM-deployable; overrides user and project settings | ❌ No native non-overridable settings layer. HARD guardrails are protected at build time (a lower scope cannot silently disable one) and ride in the emitted hooks/config | ❌ Same as Codex | ❌ Not available |
| **MCP** | ✅ `.mcp.json` compiled and synced, with an approved-server allowlist filter | ✅ `.codex/config.toml` emitted with the AgentBoot MCP server entry (`[mcp_servers.agentboot]`) automatically | ⚠️ No MCP config emitted for Copilot — point it at the AgentBoot MCP server manually | ⚠️ Varies by tool; manual setup |

## Enforcement classification

Every security-relevant control above falls into exactly one of these classes per
platform — when evaluating AgentBoot as a control, use the class, not the feature name:

| Class | Meaning | Where it applies |
|---|---|---|
| **Hard-enforced** | The platform mechanically blocks the action; a developer cannot override it locally | Claude Code managed settings via MDM; Claude Code blocking hooks |
| **Enforced, known bypasses** | Blocks in the normal path, but a documented gap exists | Codex hooks (partial tool coverage, trust-review requirement); Copilot exit-2 blocking (not yet empirically GA-verified) |
| **Fail-open** | Enforces when healthy; a failure/timeout allows the action | Copilot command-hook timeouts; any hook if its runtime dependency (node) is missing |
| **Advisory** | The agent receives the policy as instructions; nothing enforces it | Entire community tier; the officially supported `AGENTS.md` output; output-scan in default (warn) mode |
| **Unsupported** | The control does not exist on the platform | Managed settings outside Claude Code; MCP allowlisting outside compiled configs |

**Prompt instructions are not a security boundary.** An instruction saying "never do
X" is behavior shaping; prompt injection or simple non-compliance can bypass it. Hard
controls live outside the prompt: hooks, managed settings, platform permissions, and
your organization's own perimeter (network egress, DLP, branch protection).
`agentboot doctor` prints an **Enforcement** section that applies this classification
to your actual config: if you have hard org policy configured and an output platform
can only receive it as advisory instructions, doctor says so.

## Reading the matrix honestly

- **Drift detection detects; it does not prevent.** A content-hash mismatch tells
  you a synced repo has modified managed files — visibly, in `/ab` status and
  `list_repos`. It does not stop the modification from happening. What AgentBoot
  gives you is drift you can *see*, not drift that cannot occur.
- **Copilot's ceiling is real and stated on purpose.** Its hooks block on exit
  code 2 like the other two, but it exposes fewer hook types, its command-hook
  **timeouts fail open** (a slow hook does not block), and exit-2 blocking is
  documented but not yet empirically verified for GA. If your control depends on a
  specific lifecycle event, verify it exists on your target platform before you rely on it.
- **Codex hooks aren't zero-config.** They require a trust review unless deployed
  as managed, and cover shell/patch/MCP calls (not WebSearch) — confirm the tool
  call you want to gate is in scope.
- **Support is scoped to the CLI surface — for now.** Official support covers each
  tool's **command-line surface**. The IDE and editor extensions of these same
  tools, and additional platforms, are on the [roadmap](/docs/roadmap) — not
  shipped today. If your team lives primarily in an IDE extension, plan around the
  CLI surface for the enforcement guarantees above.
- **Enforcement lives on the agent surface, not around it.** Blocking hooks bind
  the three official CLI surfaces. They do not constrain a developer who
  uninstalls the tooling or works outside it — pair them with your normal
  repo-level controls (branch protections, CI, review).
- **Sync PRs touch only agent-config files**, so they're safe to auto-merge —
  *under your own branch protections.* AgentBoot never asks you to weaken them.

> If a cell says advisory, treat it as advisory.

> **Tested, not just documented:** `agentboot conformance` executes the compiled
> hook scripts per platform and writes `dist/<platform>/enforcement-manifest.json`
> recording declared level vs observed behavior. The classification in this matrix
> is the same single source of truth the harness tests and `doctor` reports.
