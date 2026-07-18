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

**Community tier (advisory):** Cursor, Windsurf, Gemini, JetBrains, the universal
`AGENTS.md` standard, and agentskills.io `SKILL.md` output. AgentBoot emits native
instruction files for these, and drift detection still covers the files — but
AgentBoot does not emit enforcement hooks for them, so nothing *enforces* the
content. (Several of these tools — Cursor, Windsurf, Gemini — do have hook surfaces
of their own; AgentBoot just doesn't bind them today.) Guidance an agent can ignore
is not a control.

## The matrix

| Capability | Claude Code | OpenAI Codex CLI | GitHub Copilot CLI | Community tier |
|---|---|---|---|---|
| **Compiled instructions** (personas, traits, gotchas → native config) | ✅ `CLAUDE.md`, skills, `settings.json` | ✅ `AGENTS.md`, `.agents/skills/` | ✅ `copilot-instructions.md`, path-scoped `.instructions.md`, agents, prompt files | ✅ Native files emitted (Cursor rules, Gemini, JetBrains, `AGENTS.md`, `SKILL.md`) — **advisory only** |
| **Blocking pre-tool-use / lifecycle hooks** | ✅ Full hook lifecycle (`PreToolUse`, `PostToolUse`, `Stop`, …), blocking on exit code 2, via `.claude/settings.json` | ✅ Blocking on exit code 2, via `.codex/hooks.json` — hooks require a trust review unless deployed as managed; tool coverage is partial (shell/patch/MCP, not WebSearch); `SessionEnd` unsupported | ⚠️ Blocking on exit code 2, via `.github/hooks/agentboot.json` — **lower ceiling**: fewer hook types; command-hook **timeouts fail open** (a slow hook does not block); exit-2 blocking is documented but **not yet empirically verified for GA** | ❌ AgentBoot emits no enforcement here — instructions only. (Cursor/Windsurf/Gemini have hook surfaces of their own; AgentBoot does not bind them today.) |
| **Drift detection** | ✅ Content-hash manifest comparison flags any managed file that's been modified | ✅ Same mechanism | ✅ Same mechanism | ✅ Same mechanism — the files are still drift-checked, but nothing enforces their content |
| **Managed settings** (non-overridable) | ✅ `managed-settings.json` — MDM-deployable; overrides user and project settings | ❌ No native non-overridable settings layer. HARD guardrails are protected at build time (a lower scope cannot silently disable one) and ride in the emitted hooks/config | ❌ Same as Codex | ❌ Not available |
| **MCP** | ✅ `.mcp.json` compiled and synced, with an approved-server allowlist filter | ✅ `.codex/config.toml` emitted with the AgentBoot MCP server entry (`[mcp_servers.agentboot]`) automatically | ⚠️ No MCP config emitted for Copilot — point it at the AgentBoot MCP server manually | ⚠️ Varies by tool; manual setup |

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
