---
sidebar_label: "CLI Reference"
sidebar_position: 2
---

# AgentBoot CLI Reference

Reference for all implemented CLI commands. Run `agentboot --help` for a summary
or `agentboot <command> --help` for command-specific help.

---

## Global Options

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to `agentboot.config.json` |
| `--verbose` | Show detailed output |
| `--quiet` | Suppress non-error output |
| `-v, --version` | Print version |

---

## `agentboot build`

Compile traits into persona output files. Reads `agentboot.config.json`, resolves
trait references, and emits self-contained output under `dist/`.

```
agentboot build
agentboot build -c path/to/config.json
```

---

## `agentboot validate`

Run pre-build validation checks: persona existence, trait references, SKILL.md
frontmatter, and secret scanning.

```
agentboot validate
agentboot validate --strict
```

| Flag | Description |
|------|-------------|
| `-s, --strict` | Treat warnings as errors |

Exit codes: `0` = pass, `1` = errors, `2` = warnings (with `--strict`).

---

## `agentboot sync`

Distribute compiled output from `dist/` to target repositories listed in `repos.json`.

```
agentboot sync
agentboot sync --repos-file path/to/repos.json
agentboot sync --dry-run
```

| Flag | Description |
|------|-------------|
| `--repos-file <path>` | Path to repos.json (default: `./repos.json`) |
| `-d, --dry-run` | Preview changes without writing |

---

## `agentboot dev-build`

Run the full local development pipeline: clean, validate, build, dev-sync.

```
agentboot dev-build
```

This is equivalent to running `clean -> validate -> build -> dev-sync` in sequence.
Exits on the first failure.

---

## `agentboot install`

Interactive onboarding wizard. Establishes the personas repo (the org's prompt
source code) or connects a code repo to an existing one.

```
agentboot install
agentboot install --hub --org acme
agentboot install --connect --hub-path ~/work/personas
```

| Flag | Description |
|------|-------------|
| `--hub` | Create a new personas repo (architect path) |
| `--connect` | Connect this repo to an existing personas hub (developer path) |
| `--org <name>` | Organization name (auto-detected from git remote if omitted) |
| `--path <dir>` | Where to create the personas repo (default: recommended based on cwd) |
| `--hub-path <dir>` | Path to existing personas repo (for `--connect`) |
| `--non-interactive` | Not yet implemented — planned for Phase 5 |
| `--skip-sync` | Skip the optional sync step after connecting |

**Two paths:**
- **Path 1 (architect):** Creates a new personas repo with config, traits, personas,
  and instructions. Auto-runs `agentboot build`. Optionally registers and syncs the
  first target repo.
- **Path 2 (developer):** Finds the org's personas repo (scans siblings, checks GitHub
  org via `gh`), creates a branch with the `repos.json` change, and offers to open a PR.

If `agentboot.config.json` already exists in cwd, exits with a message to use `doctor`.

`setup` is a hidden alias for `install` (deprecated).

---

## `agentboot import`

Scan and classify existing AI agent content (`.claude/`, CLAUDE.md, `.cursorrules`,
Copilot instructions) into personas, traits, gotchas, and instructions in the
personas repo. Never modifies or deletes original files.

```
agentboot import
agentboot import --path ~/work/
agentboot import --overlap
agentboot import --apply
```

| Flag | Description |
|------|-------------|
| `--path <dir>` | Directory or repo to scan (default: cwd) |
| `--hub-path <dir>` | Path to personas repo (auto-detected from siblings if omitted) |
| `--overlap` | Run heuristic overlap analysis against hub and cross-import content |
| `--apply` | Apply a previously generated import plan (`.agentboot-import-plan.json`) |

This is an **LLM-powered command** — it uses `claude -p` to classify content.
Requires an active Claude Code login. See [concepts](./concepts.md#llm-and-deterministic-commands)
for the command classification model.

---

## `agentboot add <type> <name>`

Scaffold a new component. The `name` argument must be 1-64 lowercase alphanumeric
characters with hyphens (e.g., `my-new-persona`).

```
agentboot add persona my-reviewer
agentboot add trait my-trait
agentboot add gotcha database-rls
agentboot add domain healthcare
agentboot add hook compliance-gate
```

### Supported types

| Type | Creates |
|------|---------|
| `persona` | `core/personas/<name>/SKILL.md` + `persona.config.json` |
| `trait` | `core/traits/<name>.md` |
| `gotcha` | `core/gotchas/<name>.md` (with `paths:` frontmatter) |
| `domain` | `domains/<name>/` directory with manifest, README, and subdirectories |
| `hook` | `hooks/<name>.sh` (executable shell script with hook template) |

---

## `agentboot doctor`

Check environment and diagnose configuration issues. Validates Node.js version,
git, Claude Code availability, config parsing, persona/trait existence, repos.json,
and dist/ status.

```
agentboot doctor
agentboot doctor --format json
```

| Flag | Description |
|------|-------------|
| `--format <fmt>` | Output format: `text` (default), `json` |

Exit code `1` if any issues are found.

---

## `agentboot status`

Show deployment status: org info, enabled personas, traits, output formats, registered
repos with sync state, and last build time.

```
agentboot status
agentboot status --format json
```

| Flag | Description |
|------|-------------|
| `--format <fmt>` | Output format: `text` (default), `json` |

---

## `agentboot lint`

Static analysis for prompt quality. Checks token budgets, vague language, hardcoded
secrets, line counts, missing output format sections, and unused traits.

```
agentboot lint
agentboot lint --persona code-reviewer
agentboot lint --severity info
agentboot lint --format json
```

| Flag | Description |
|------|-------------|
| `--persona <name>` | Lint a specific persona only |
| `--severity <level>` | Minimum severity to report: `info`, `warn` (default), `error` |
| `--format <fmt>` | Output format: `text` (default), `json` |

Exit code `1` if any errors are found.

### Lint rules

| Rule | Severity | Description |
|------|----------|-------------|
| `prompt-too-long` | error/warn | Token estimate exceeds budget, or line count > 500/1000 |
| `vague-instruction` | warn | Phrases like "be thorough", "try to", "best practice" |
| `credential-in-prompt` | error | API keys, tokens, JWTs, hardcoded passwords |
| `missing-output-format` | info | No `## Output Format` section in SKILL.md |
| `trait-too-long` | warn | Trait exceeds 100 lines |
| `unused-trait` | info | Trait file exists but is not in `traits.enabled` |

---

## `agentboot export`

Export compiled output in a distributable format.

```
agentboot export
agentboot export --format plugin
agentboot export --format managed --output ./out
agentboot export --format marketplace
```

| Flag | Description |
|------|-------------|
| `--format <fmt>` | Export format: `plugin` (default), `managed`, `marketplace` |
| `--output <dir>` | Output directory (defaults vary by format) |

### Export formats

| Format | Output | Default path |
|--------|--------|--------------|
| `plugin` | Claude Code plugin directory | `.claude-plugin/` |
| `managed` | Managed settings for MDM deployment | `managed-output/` |
| `marketplace` | `marketplace.json` scaffold | current directory |

Requires `agentboot build` to have been run first (for `plugin` and `managed` formats).

---

## `agentboot publish`

Publish a compiled plugin to a marketplace manifest. Reads the plugin from
`.claude-plugin/` or `dist/plugin/`, computes a SHA-256 hash, updates
`marketplace.json`, and copies the plugin to a versioned release directory.

```
agentboot publish
agentboot publish --bump patch
agentboot publish --bump minor
agentboot publish --marketplace path/to/marketplace.json
agentboot publish --dry-run
```

| Flag | Description |
|------|-------------|
| `--marketplace <path>` | Path to marketplace.json (default: `marketplace.json`) |
| `--bump <level>` | Version bump before publishing: `major`, `minor`, `patch` |
| `-d, --dry-run` | Preview changes without writing |

---

## `agentboot uninstall`

Remove AgentBoot-managed files from a repository. Uses the `.agentboot-manifest.json`
written during sync to identify managed files. Files modified after sync (hash mismatch)
are skipped with a warning.

```
agentboot uninstall
agentboot uninstall --repo /path/to/repo
agentboot uninstall --dry-run
```

| Flag | Description |
|------|-------------|
| `--repo <path>` | Target repository path (default: current directory) |
| `-d, --dry-run` | Preview what would be removed |

---

## `agentboot config [key]`

View configuration (read-only). Prints the full config or a specific dotted key path.
Writing config values is not supported; edit `agentboot.config.json` directly.

```
agentboot config                    # Print full config
agentboot config org                # Print org name
agentboot config personas.enabled   # Print enabled personas list
```
