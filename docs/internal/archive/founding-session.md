# AgentBoot — Work in Progress

**Read this first when starting a new session on this repo.**

This document transfers complete context from the founding session.
Delete it or archive it to `docs/` once v0.1.0 is released.

---

## What this project is

AgentBoot is **convention over configuration for agentic development teams** — the Spring Boot of Claude Code governance.

The positioning: when a team adopts Claude Code, they inevitably build their own CLAUDE.md, their own rules, maybe some agents. Most are mediocre. New teams don't know where to start. Teams in the same org drift apart. Nobody shares.

AgentBoot is the shared foundation everyone was going to build anyway, done once, done well.

**Tagline:** "Convention over configuration for agentic development teams."
**Primary analogy:** Spring Boot is to Java as AgentBoot is to Claude Code.
**Target user:** Team champions, DevEx teams, engineering leadership adopting Claude Code.
**Primary tool:** Claude Code (Anthropic). Also compatible with GitHub Copilot, Cursor, Gemini CLI via the agentskills.io open standard.

---

## Origin story

AgentBoot started as a personal project — managing AI personas across family hobby projects (lots of developers in the family). The same CLAUDE.md rules, review prompts, and gotchas kept getting copied between projects, so a system was built to share them. As the number of projects grew, the system naturally took on organizational structure (scope hierarchy, trait composition, distribution). Friends and former colleagues dealing with the same problems at work saw the patterns and the tool grew from there.

AgentBoot is the **generic, open-source, domain-agnostic** version of those patterns. Apache 2.0 licensed. The goal is that this could be used by any engineering org.

**Note:** Do not reference specific org names, real people, or domain-specific content anywhere in this repo.

---

## Identity and accounts

- **GitHub:** `saavyone/agentboot` (public)
- **Author:** Mike Saavedra
- **Email:** `saavyone@users.noreply.github.com`
- **SSH remote alias:** `git@github-saavyone:saavyone/agentboot.git`
  - Requires `Host github-saavyone` in `~/.ssh/config` pointing to `~/.ssh/id_ed25519_saavyone`
  - Run `ssh-add ~/.ssh/id_ed25519_saavyone` before pushing if the key isn't loaded
- **npm name:** `agentboot` (reserved, not yet published)
- **Domains registered:** `agentboot.io`, `agentboot.dev`
- **License:** Apache 2.0

**CRITICAL:** Every commit must use `saavyone <saavyone@users.noreply.github.com>`. The machine's default git identity is for a different account. Always verify `git config user.email` in this repo before committing.

---

## Current state (end of founding session)

### What is complete and committed

| Component | Location | Status |
|---|---|---|
| README | `README.md` | ✅ Complete — positioning, quickstart, table of personas, config example |
| License | `LICENSE` | ✅ Apache 2.0, Mike Saavedra |
| Contributing | `CONTRIBUTING.md` | ✅ Complete |
| Personas registry | `PERSONAS.md` | ✅ Complete — V1 persona cards, traits table, governance |
| 6 core traits | `core/traits/` | ✅ Complete — see Traits section below |
| 4 V1 personas | `core/personas/` | ⚠️ SKILL.md exists but missing persona.config.json — see Known Gaps |
| 2 always-on instructions | `core/instructions/` | ✅ baseline + security |
| Build script | `scripts/compile.ts` | ✅ Complete — ~750 lines, fully implemented |
| Validate script | `scripts/validate.ts` | ✅ Complete |
| Sync script | `scripts/sync.ts` | ✅ Complete |
| package.json | `package.json` | ✅ Complete — deps: chalk, glob, zod |
| tsconfig | `tsconfig.json` | ✅ Complete |
| Main config | `agentboot.config.json` | ✅ Complete JSONC with comments |
| Example configs | `examples/` | ✅ minimal + enterprise |
| Docs | `docs/` | ✅ concepts, getting-started, configuration, extending |
| Domain template | `domains/compliance-template/` | ✅ Placeholder/template, no real compliance rules |
| GitHub templates | `.github/` | ✅ workflow + 2 issue templates |

### What is NOT done (must do before v0.1.0)

1. **`persona.config.json` missing from all 4 personas** — The build pipeline reads this file to know which traits to inject. Without it, `npm run build` runs but injects no traits. See Known Gaps for fix instructions.
2. **Two trait files referenced in config but don't exist:** `minimal-diff` and `explain-reasoning` are listed in `agentboot.config.json` under `traits.enabled` but have no corresponding `.md` files in `core/traits/`. Either write the trait files or remove them from the config.
3. **`repos.json` doesn't exist** — Required by `sync.ts`. Create it (even as `[]`) before `npm run full-build` works end-to-end.
4. **`npm install` has never been run** — No `node_modules`. Run it before any `npm run` commands.
5. **Build has never been run** — No `dist/` directory. The pipeline is untested on this scaffold.
6. **Tests don't exist** — `package.json` declares `vitest` but there are no test files.
7. **CLI entrypoint** — `package.json` declares `"bin": {"agentboot": "./dist/scripts/cli.js"}` but `scripts/cli.ts` doesn't exist.

---

## Architecture

### Core concepts

**Traits** (`core/traits/`) — Reusable behavioral building blocks. Each trait captures one aspect of how a persona thinks or communicates: skepticism level, output format discipline, evidence requirements, etc. Traits are composed into personas at build time. Change a trait once, all composing personas update on next build.

**Personas** (`core/personas/`) — Complete, deployable agents. Each is a directory containing `SKILL.md` (the agent definition) and optionally `persona.config.json` (build metadata: which traits to inject, invocation command, description).

**Always-on instructions** (`core/instructions/`) — Markdown fragments distributed to every repo regardless of persona configuration. These are behavioral guardrails that run before any slash command.

**Scope hierarchy** — `org → group → team → repo`. Configured in `agentboot.config.json`. More specific scopes layer on top of, but do not replace, more general scopes.

**agentskills.io** — The open standard for AI agent skill files. AgentBoot uses the `skills/{name}/SKILL.md` directory format with YAML frontmatter. This makes personas portable across Claude Code, GitHub Copilot, Cursor, Gemini CLI, and any other agentskills.io-compatible tool.

### Build pipeline

```
agentboot.config.json
       │
       ▼
scripts/validate.ts    ← checks trait/persona frontmatter, no secrets, required fields
       │
       ▼
scripts/compile.ts     ← injects traits, generates SKILL.md + CLAUDE.md + copilot-instructions.md
       │                  output: dist/core/, dist/groups/{group}/, dist/teams/{group}/{team}/
       ▼
scripts/sync.ts        ← merges dist layers (core → group → team), writes to each repo in repos.json
       │                  core wins on mandatory behaviors; team wins on optional behaviors
       ▼
target repos receive: .claude/ directory, .github/copilot-instructions.md, PERSONAS.md
```

### Trait injection mechanism

`compile.ts` looks for two HTML comment markers in `SKILL.md`:

```
<!-- traits:start -->
(content here is replaced on each build)
<!-- traits:end -->
```

If markers are absent, traits are appended at the end of the file.

Trait resolution order (persona's `persona.config.json`):
```json
{
  "traits": ["critical-thinking", "structured-output"],   // base traits
  "groups": {
    "platform": { "traits": ["schema-awareness"] }        // added for platform group
  },
  "teams": {
    "appsec": { "traits": ["audit-trail"] }               // added for appsec team
  }
}
```

### Output formats

The build generates three output formats per persona (configurable via `outputFormats` in config):
- `SKILL.md` — agentskills.io-compatible, for Claude Code agent mode and cross-tool use
- `CLAUDE.md` — Claude Code slash command fragment
- `copilot-instructions.md` — GitHub Copilot instructions fragment (HTML comments stripped)

---

## The 6 core traits

| Trait | File | What it does |
|---|---|---|
| `critical-thinking` | `core/traits/critical-thinking.md` | Skepticism calibration: HIGH/MEDIUM/LOW weight. Controls threshold for surfacing concerns. |
| `structured-output` | `core/traits/structured-output.md` | Enforces CRITICAL/ERROR/WARN/INFO JSON schema for all findings. |
| `source-citation` | `core/traits/source-citation.md` | Anti-hallucination: every finding must cite code location or standard. |
| `schema-awareness` | `core/traits/schema-awareness.md` | Data modeling, schema contracts, migration safety. |
| `confidence-signaling` | `core/traits/confidence-signaling.md` | Explicit uncertainty marking: HIGH/MEDIUM/LOW confidence per finding. |
| `audit-trail` | `core/traits/audit-trail.md` | Decision logging, alternatives considered, rejected approaches documented. |

**Missing traits** (referenced in config, not yet written):
- `minimal-diff` — prefer targeted changes over wholesale rewrites
- `explain-reasoning` — narrate decisions for reviewability

---

## The 4 V1 personas

| Persona | Invocation | Traits (intended) |
|---|---|---|
| `code-reviewer` | `/review-code` | critical-thinking:MEDIUM, structured-output, source-citation |
| `security-reviewer` | `/review-security` | critical-thinking:HIGH, structured-output, source-citation, audit-trail |
| `test-generator` | `/gen-tests` | schema-awareness, structured-output, source-citation |
| `test-data-expert` | `/gen-testdata` | schema-awareness, confidence-signaling |

**Note:** The SKILL.md files as currently written contain the full behavioral instructions inline (as prose). They are functional as-is. However, they do not currently demonstrate trait composition because `persona.config.json` files are missing. The behavioral content *describes* that it uses certain traits but doesn't wire them through the build pipeline. This needs to be fixed before the "change a trait, all personas update" promise holds.

---

## Known gaps (prioritized)

### 1. Add `persona.config.json` to each persona (BLOCKING for trait composition)

Create `core/personas/{name}/persona.config.json` for each persona:

**code-reviewer:**
```json
{
  "name": "Code Reviewer",
  "description": "Reviews code changes for correctness, readability, naming, error handling, test coverage, and adherence to repo conventions.",
  "invocation": "/review-code",
  "traits": ["critical-thinking", "structured-output", "source-citation"]
}
```

**security-reviewer:**
```json
{
  "name": "Security Reviewer",
  "description": "Flags vulnerabilities, exposed secrets, risky patterns, and security anti-patterns. Blocks merge on CRITICAL findings.",
  "invocation": "/review-security",
  "traits": ["critical-thinking", "structured-output", "source-citation", "audit-trail"]
}
```

**test-generator:**
```json
{
  "name": "Test Generator",
  "description": "Writes unit and integration tests from function signatures, type definitions, and existing code.",
  "invocation": "/gen-tests",
  "traits": ["schema-awareness", "structured-output", "source-citation"]
}
```

**test-data-expert:**
```json
{
  "name": "Test Data Expert",
  "description": "Generates realistic synthetic test data. Never uses real PII. Provides 5 canonical row archetypes per entity.",
  "invocation": "/gen-testdata",
  "traits": ["schema-awareness", "confidence-signaling"]
}
```

### 2. Write missing trait files or remove from config

Either write `core/traits/minimal-diff.md` and `core/traits/explain-reasoning.md`, or remove them from `agentboot.config.json` traits.enabled. They're referenced but don't exist.

### 3. Create `repos.json`

Create `repos.json` at repo root (used by sync.ts):
```json
[]
```
(Empty for now; users populate this with their own repos.)

### 4. Run `npm install` and `npm run build`

First run to verify the pipeline actually works end-to-end. Expected result: `dist/core/` is populated with compiled persona output.

### 5. Write the CLI (`scripts/cli.ts`)

`package.json` declares `"bin": {"agentboot": "./dist/scripts/cli.js"}` but the file doesn't exist. This is the `npx agentboot init` entrypoint. Minimum viable CLI:
- `agentboot init` — scaffold a new org config from a template
- `agentboot build` — alias for compile
- `agentboot sync` — alias for sync

### 6. Write tests

No tests exist. At minimum: unit tests for `compile.ts` (trait injection logic, JSONC parser, provenance headers) and `validate.ts`.

---

## Key design decisions (locked)

**D1: Convention over configuration.** `agentboot.config.json` is the only file you need to edit. Everything else has a sensible default.

**D2: agentskills.io format.** Skills are directories (`skills/{name}/SKILL.md`), not flat `.skill.md` files. This is the official agentskills.io standard. It enables bundling related files (SKILL.md, examples, tests) in one directory.

**D3: Build-time trait composition.** Traits are inlined at build time, not at runtime. The output files are complete and standalone. No runtime dependency on AgentBoot. This is important: spokes receive compiled output, not a runtime agent framework.

**D4: Three output formats.** Every persona generates SKILL.md + CLAUDE.md + copilot-instructions.md. This is what enables the "lock-in is optional" positioning. Teams can switch tools and their personas come with them.

**D5: Hub-and-spoke distribution.** The org creates one `my-org-personas` repo from the AgentBoot template. That repo syncs to all registered repos. Spokes receive compiled output only; they don't hold the source of truth.

**D6: Mandatory vs optional behaviors.** Org-level traits marked required propagate downward and cannot be disabled. Optional behaviors can be extended or overridden by more specific scopes. This is the governance model.

**D7: No runtime framework.** AgentBoot is a build tool and content library. It does not run inside the AI tool; it generates the files that the AI tool reads. No npm package needs to be installed in target repos.

**D8: Generic only.** No domain-specific compliance layers in core. Healthcare, finance, defense compliance is in `domains/` as templates. Core stays usable by any team.

---

## What to build next (suggested order)

1. **Fix persona.config.json** (gap #1 above) — unblocks the "traits compose" story
2. **Write missing trait files or prune config** (gap #2) — required for clean build
3. **Create repos.json** (gap #3) — required for full-build to not error
4. **Run `npm install` + `npm run build`** (gap #4) — smoke test the whole pipeline
5. **Write tests** (gap #6) — validate compile/inject/validate logic
6. **Write CLI** (gap #5) — required before publishing to npm
7. **Set up GitHub Actions** (already scaffolded at `.github/workflows/validate.yml`, may need tweaks)
8. **Publish to npm** — `npm publish --access public`
9. **Set up agentboot.dev / agentboot.io** — landing page

---

## Competitive context (from dry-run analysis)

Public prior art examined before designing AgentBoot:

| Project | Stars | What to cherry-pick |
|---|---|---|
| SuperClaude | ~28k | Composable flags/personas concept, slash command patterns |
| trailofbits/claude-code-config | — | Hook patterns for pre-tool guardrails |
| arc-kit | — | `hooks.json` manifest pattern |

**What is novel in AgentBoot** (not in public prior art):
- MDM-style scope hierarchy (org → group → team → repo) with merge semantics
- Two-channel distribution (hub publishes → spokes receive compiled artifacts via PR)
- Build-time trait composition with configurable weights (HIGH/MEDIUM/LOW)
- Cross-tool output (same source generates Claude + Copilot + agentskills.io simultaneously)
- `agentboot.config.json` convention-over-config entry point

---

## File map

```
agentboot/
├── README.md                        # Public-facing, Spring Boot positioning
├── LICENSE                          # Apache 2.0, Mike Saavedra
├── CONTRIBUTING.md
├── PERSONAS.md                      # Developer registry, V1 persona cards
├── agentboot.config.json            # JSONC, fully commented, the only config file users need
├── package.json                     # scripts: build/validate/sync/full-build/test
├── tsconfig.json
├── repos.json                       # MISSING — must create before sync works
│
├── core/
│   ├── traits/                      # 6 trait files (missing: minimal-diff, explain-reasoning)
│   │   ├── critical-thinking.md     # HIGH/MEDIUM/LOW weight system
│   │   ├── structured-output.md     # CRITICAL/ERROR/WARN/INFO JSON schema
│   │   ├── source-citation.md       # Anti-hallucination, confidence levels
│   │   ├── schema-awareness.md      # Data modeling, migration safety
│   │   ├── confidence-signaling.md  # Explicit uncertainty marking
│   │   └── audit-trail.md           # Decision logging
│   ├── personas/
│   │   ├── code-reviewer/
│   │   │   ├── SKILL.md             # ✅ Complete behavioral instructions
│   │   │   └── persona.config.json  # ❌ MISSING — add to enable trait injection
│   │   ├── security-reviewer/       # same gap
│   │   ├── test-generator/          # same gap
│   │   └── test-data-expert/        # same gap
│   └── instructions/
│       ├── baseline.instructions.md  # applyTo: **, always-on
│       └── security.instructions.md  # applyTo: .env*, secrets/, auth/, crypto/
│
├── scripts/
│   ├── compile.ts    # ~750 lines. Loads config, resolves traits, injects into SKILL.md,
│   │                 # generates SKILL.md + CLAUDE.md + copilot-instructions.md per persona
│   ├── validate.ts   # 5 checks, exits 1 on failure
│   └── sync.ts       # Three-layer merge (core/group/team), --dry-run flag
│
├── docs/
│   ├── concepts.md         # Traits, personas, scope hierarchy, prompts-as-code, distribution model
│   ├── getting-started.md  # Hands-on quickstart
│   ├── configuration.md    # Full agentboot.config.json reference
│   └── extending.md        # Building a domain layer
│
├── domains/
│   └── compliance-template/  # Example domain layer, no real compliance rules
│
├── examples/
│   ├── minimal/agentboot.config.json
│   └── enterprise/agentboot.config.json
│
└── .github/
    ├── workflows/validate.yml
    └── ISSUE_TEMPLATE/
        ├── persona-request.md
        └── quality-feedback.md
```

---

## How to pick up development

```bash
cd ~/saavyone/agentboot

# Verify identity before any commit
git config user.email   # must be saavyone@users.noreply.github.com

# Install deps (first time only)
npm install

# Smoke test the build
npm run build           # expect: dist/core/ populated

# Run validation
npm run validate

# Run full pipeline (needs repos.json to exist first)
echo "[]" > repos.json
npm run full-build
```

After fixing `persona.config.json` for each persona, re-run `npm run build` and inspect `dist/core/code-reviewer/SKILL.md` — the trait content should be injected at the bottom.

---

*Session: founding. Scaffold complete, pipeline untested. Primary blocker: persona.config.json missing.*
