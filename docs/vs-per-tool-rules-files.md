---
id: vs-per-tool-rules-files
title: AgentBoot vs. per-tool rules files
description: Maintaining CLAUDE.md, Cursor rules, and copilot-instructions.md by hand versus compiling them all from one source — including the honest trade-off.
---

# AgentBoot vs. per-tool rules files

The default way to configure AI coding tools is one file per tool: a `CLAUDE.md`
for Claude Code, `.cursor/rules` for Cursor, `.github/copilot-instructions.md` for
Copilot, an `AGENTS.md` for whatever reads that. Each in its own format, each
maintained by hand.

AgentBoot's alternative: author the content once — as personas, traits, and
gotchas in a hub repo — and compile it to every format with one command. This page
is the honest comparison.

## When per-tool files are fine

- **You use one tool.** One tool means one file. A compiler that emits one output
  format is overhead, not leverage.
- **The content is small and stable.** Two short files you touch quarterly don't
  need a build step. Copy-paste is annoying twice a year; it's a crisis twice a
  week.
- **The file is genuinely repo-specific.** Notes about *this* codebase's layout
  belong in that repo's own file. AgentBoot is for the content you keep
  re-explaining across repos and tools — not for everything.

## The failure mode, concretely

Per-tool files fail on repetition, and the failure is gradual enough to miss:

1. **Same rule, N dialects.** "Never write raw SQL against the reporting DB" now
   lives in three files in three formats. Each rewrite is a chance to say it
   slightly differently.
2. **They diverge silently.** You fix the wording in `CLAUDE.md` and forget
   `.cursor/rules`. Nothing diffs them against each other; nothing ever will.
   Your tools are now getting different instructions and nobody decided that.
3. **New lessons pay a distribution tax.** A production incident teaches you
   something worth encoding. That lesson is only real once it's in *every* file,
   in *every* repo — so it usually ends up in one.
4. **There is no canonical copy.** When two files disagree, which one is right?
   In a hand-maintained setup that question has no answer.

## What compiling from one source changes

```bash
# edit the trait once, in the hub
vim core/traits/defensive-logging.md

agentboot build   # every platform format regenerates
agentboot sync    # every repo gets the update as a PR
```

- **One edit, every format.** Traits compose into personas; change a trait once
  and every persona — and every platform output it compiles to — rebuilds.
- **Divergence becomes visible.** Synced files are tracked by content hash. A
  hand-edited copy in some repo shows up as drift in `/ab` status — detection,
  not prevention, but silent divergence is the actual killer, and it stops being
  silent.
- **The canonical copy is structural.** The hub is the source; everything else is
  build output. "Which file is right?" stops being a question.
- **Updates arrive as PRs**, with a diff and an author, not as mystery overwrites.
- **A gotcha is written once** — path-scoped, with the incident context — and
  lands everywhere it applies.

The output stays plain files in your repos. If you delete AgentBoot tomorrow, the
compiled `CLAUDE.md` and friends keep working; you're back to hand-maintaining
them, not locked out of them.

## The honest trade-off

Name it plainly, because it's real:

- **You add a build step and a hub repo.** Per-tool files are WYSIWYG — the file
  you read is the file you edit. With AgentBoot, the file in the repo is compiled
  output; the thing you edit lives in the hub. That indirection is the price of
  having one source, and if you edit the output directly, you've created drift
  (which AgentBoot will flag — at you).
- **You adopt an artifact model.** Personas, traits, gotchas, and scopes are more
  structure than "a markdown file." The structure is what makes reuse and
  composition work, but it's a learning curve.
- **Platform fidelity is tiered, not uniform.** Official support is the Claude
  Code, OpenAI Codex, and GitHub Copilot CLI surfaces, plus the universal
  `AGENTS.md` standard as an officially supported, advisory-enforcement output —
  the industry-standard cross-tool instruction file (no hook mechanism, so it
  carries no blocking enforcement). Other formats (Cursor, Windsurf, Gemini,
  JetBrains) are community-tier output — your content arrives, but on an advisory
  basis. The [platform capability matrix](./platform-capability-matrix.md) has the
  exact breakdown.

The crossover point is roughly: **(number of tools) × (number of repos) × (how
often the content changes).** When that product is small, hand-maintained files
are simpler and you should keep them. When it grows, every unit of it is a copy
you're maintaining by hand — and [import](./import.md) will pull the files you
already have into a hub without making you start over.
