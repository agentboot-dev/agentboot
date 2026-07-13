---
id: import
title: Import your existing AI config into a hub
description: Pull your existing CLAUDE.md, Cursor rules, Copilot instructions, and skills into an AgentBoot hub with a scan-first, review-everything import.
---

# Import your existing AI config into a hub

You already have AI config. A `CLAUDE.md` that took months to get right, a
`.cursorrules` file someone tuned last spring, Copilot instructions, a handful of
skills. Import brings that content into your hub **without asking you to rewrite
anything and without touching the originals**.

The flow is scan-first: AgentBoot finds candidate content, classifies it, shows you
the full plan, and writes **nothing** until you approve it.

## What the scanner detects

`agentboot import` scans a repo (or a whole directory of repos) for:

| Location | Detected as |
|---|---|
| `.claude/` directory contents | skills, agents, rules, `settings.json`, `.mcp.json` |
| Root `CLAUDE.md` | project instructions |
| `.cursorrules` | Cursor rules |
| `.github/copilot-instructions.md` | Copilot instructions |
| `.github/prompts/*.prompt.md` | Copilot prompt files |
| `skills/<name>/SKILL.md` | Agent Skills (agentskills.io convention) |
| Any `.md` with `paths:` frontmatter | path-scoped rule (gotcha candidate) |

Binary files and symlinked directories are skipped — the scanner never follows a
symlink out of the repo.

**Not auto-detected:** a root-level `AGENTS.md`. To classify one (or any single
file), point the classifier at it directly:

```bash
agentboot add prompt ./AGENTS.md
```

## The CLI flow

```bash
# Scan the current repo
agentboot import

# Scan a specific repo, or every repo under a parent directory
agentboot import --path ~/work/auth-service
agentboot import --parent ~/work/ --hub-path ~/work/personas

# Review the generated plan, then apply it
agentboot import --apply
```

Import is a two-step commit: the scan produces a plan file
(`.agentboot-import-plan.json`) describing what would be created — types, names,
target paths. Nothing lands in the hub until you run `--apply`.

Useful flags:

| Flag | What it does |
|---|---|
| `--non-interactive` | Auto-apply classifications above 0.8 confidence; everything else is left for review |
| `--overlap` | Heuristic overlap analysis — flags imports that look like near-duplicates of existing hub content |
| `--retry-failed` | Retry files that timed out on a previous run |
| `--isolated` | Classify using a temporary Claude config, leaving your personal settings untouched |

Classification is LLM-powered (it runs `claude -p` under the hood), so `import`
requires an active Claude Code login. The deterministic parts — scanning,
planning, applying — don't.

## Import from a GitHub URL

```bash
agentboot import --url https://github.com/some-org/some-repo
```

`--url` accepts a repo URL (shallow-cloned) or a raw/blob file URL (fetched, with a
size cap). Either way the content lands in a temp directory, and AgentBoot prints
the `agentboot import --path <tempdir>` command to classify it. Download and
classification are deliberately separate steps — you can look at what was fetched
before any LLM reads it.

## The `/ab` flow

Inside Claude Code, `/ab` drives the same pipeline conversationally:

1. **Scan** — you name the repos; the `agentboot_scan_for_import` MCP tool returns
   two buckets: `highConfidence` (recognized file types — CLAUDE.md, skills, rules,
   Cursor/Copilot files) and items that need a human look.
2. **Review the uncertain items first**, one at a time, with an excerpt and a
   proposed type. Accept, reclassify, rename, or skip.
3. **Confirm the confident batch** as a table — proceed with all, or review
   individually.
4. **Duplicate check** — each item is compared against existing hub content; near
   duplicates are flagged with the choice to import as new, update the existing
   artifact, or skip.
5. **Pattern promotion** — if essentially the same content shows up in three or
   more repos, `/ab` suggests promoting it to core scope so there's one maintained
   version.
6. **Apply as pull requests** — every write goes through a PR, so the import is
   reviewed like any other change. Each imported artifact carries attribution
   frontmatter (contributor and source repo) so credit and provenance survive
   the move.

## Limits, honestly

- **Classification is a draft, not a verdict.** The LLM proposes persona / trait /
  gotcha / instruction; you confirm. Expect to reclassify some items — that's what
  the review step is for.
- **Originals are never modified or deleted.** Import copies content into the hub;
  cleaning up the source repos afterward is your call (and usually a follow-up PR).
- **It imports what exists, as it exists.** Import won't deduplicate wording,
  merge overlapping rules into one, or improve prose. `--overlap` flags likely
  duplicates; deciding is on you.
- **`AGENTS.md` needs the explicit route** described above.

## When not to use this

If you have one repo with one `CLAUDE.md` that works, leave it alone — a checked-in
file needs no hub. Import earns its keep when the same hard-won rules live in
several repos or several tools' formats and you want one maintained source instead
of N drifting copies.
