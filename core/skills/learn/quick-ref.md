---
id: 01KZRGW0EVGMKPWGZ8TYFDAVT5
slug: quick-ref
hash: sha256:d7423d6efc1902f8
---

# AgentBoot Quick Reference

## CLI Commands

| Command | Description | Common Flags |
|---|---|---|
| `npx agentboot build` | Validate + compile to `dist/` | `-c <config>` |
| `npx agentboot validate` | Run pre-build checks only | `--strict` |
| `npx agentboot sync` | Distribute `dist/` to target repos | `--dry-run`, `--repos-file <path>` |
| `npx agentboot test` | Run test suite | `--behavioral`, `--snapshot`, `--regression` |
| `npx agentboot migrate` | Run schema migrations | `--path <dir>`, `--revert`, `--dry-run` |
| `npx agentboot dev-build` | clean + validate + build + dev-sync | |
| `npx agentboot install` | Install AgentBoot into a repo | `--non-interactive` |
| `npx agentboot clean` | Remove `dist/` directory | |

## Persona Invocations

| Command | Persona | Purpose |
|---|---|---|
| `/review-code` | Code Reviewer | PR reviews, code quality, correctness |
| `/review-security` | Security Reviewer | Vulnerabilities, secrets, auth, crypto |
| `/gen-tests` | Test Generator | Write tests, audit coverage, find gaps |
| `/gen-testdata` | Test Data Expert | Synthetic, constraint-respecting test data |
| `/learn` | Learn | Contextual help and onboarding |

## Config File Locations

| File | Location | Purpose |
|---|---|---|
| `agentboot.config.json` | Repo root | Main configuration (JSONC) |
| `repos.json` | Repo root | Target repos for sync |
| `persona.config.json` | `core/personas/{name}/` | Per-persona metadata and trait list |
| `SKILL.md` | `core/personas/{name}/` | Persona behavioral definition |

## Source Directories

| Directory | Contents |
|---|---|
| `core/personas/` | Persona definitions (SKILL.md + persona.config.json) |
| `core/traits/` | Reusable behavioral building blocks |
| `core/instructions/` | Always-on guardrails (distributed to every repo) |
| `core/gotchas/` | Path-scoped operational knowledge rules |
| `core/lexicon/` | Domain term definitions (ubiquitous language) |

## Output Directories

| Directory | Platform | Format |
|---|---|---|
| `dist/skill/` | Cross-platform | SKILL.md (agentskills.io) |
| `dist/claude/` | Claude Code | `.claude/` native format |
| `dist/copilot/` | GitHub Copilot | `.github/` format |
| `dist/codex/` | OpenAI Codex CLI | AGENTS.md + `.codex/` |
| `dist/agents/` | Universal | AGENTS.md standard |
| `dist/cursor/` | Cursor | `.cursor/rules/` |
| `dist/windsurf/` | Windsurf | `.windsurf/rules/` |
| `dist/gemini/` | Gemini | `GEMINI.md` |
| `dist/jetbrains/` | JetBrains AI Assistant | `.aiassistant/rules/` |
| `dist/plugin/` | Claude Code plugin | plugin bundle (not syncable) |

All of the above are emitted today. Which ones a build produces is
`personas.outputFormats`; the default when that key is absent is `skill`, `claude`,
`copilot`, `agents`. Emission is not enforcement — only the Claude Code, Codex and
Copilot CLI surfaces receive blocking hooks.

## Scope Hierarchy

```
Org (core/)  →  Group (groups/{group}/)  →  Team (teams/{group}/{team}/)  →  Repo
```

More specific scopes override less specific ones for optional behaviors.
Mandatory behaviors (compliance) inherit top-down — org wins.

## Available Traits

| Trait | Effect |
|---|---|
| `critical-thinking` | Challenges assumptions, identifies logical flaws |
| `structured-output` | Severity levels, consistent formatting |
| `source-citation` | References files, lines, docs |
| `confidence-signaling` | HIGH/MEDIUM/LOW confidence markers |
| `audit-trail` | Traceable reasoning chains |
| `schema-awareness` | Validates schemas and type definitions |

## Common Flags

| Flag | Used with | Effect |
|---|---|---|
| `--strict` | `validate` | Treat warnings as errors |
| `--dry-run` | `sync`, `migrate` | Preview changes without writing |
| `-c <path>` | `build` | Use alternate config file |
| `--repos-file <path>` | `sync` | Use alternate repos file |
| `--non-interactive` | `install` | Skip interactive prompts (CI mode) |
| `--behavioral` | `test` | Run behavioral (LLM) tests |
| `--snapshot` | `test` | Run snapshot regression tests |
| `--revert` | `migrate` | Undo a migration |
