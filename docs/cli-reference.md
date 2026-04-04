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

Run pre-build validation checks (6 checks):
1. Persona existence — all enabled personas found in `core/personas/`
2. Trait references — all traits in persona configs exist in `core/traits/`
3. SKILL.md frontmatter — required fields present
4. Secret scanning — no credentials in definitions
5. Composition consistency — no scope conflicts between rule/preference types
6. Rule override detection — lower scopes shadowing rule-type core artifacts

```
agentboot validate
agentboot validate --strict
```

| Flag | Description |
|------|-------------|
| `-s, --strict` | Treat warnings as errors |

Exit codes: `0` = pass, `1` = errors, `2` = warnings (with `--strict`).

---

## `agentboot test`

Run behavioral and snapshot tests for personas.

```
agentboot test --behavioral              # Run YAML behavioral tests (LLM-powered)
agentboot test --snapshot                 # Create/update snapshot baseline from dist/
agentboot test --regression               # Compare dist/ against saved snapshot
agentboot test --behavioral --test-dir tests/behavioral
agentboot test --regression --snapshot-file .agentboot-snapshot.json
```

| Flag | Description |
|------|-------------|
| `--behavioral` | Run behavioral tests (requires LLM, costs money) |
| `--snapshot` | Create or update snapshot baseline from current `dist/` |
| `--regression` | Compare current `dist/` against saved snapshot |
| `--test-dir <dir>` | Directory with behavioral test YAML files (default: `tests/behavioral`) |
| `--snapshot-file <path>` | Path to snapshot baseline file (default: `.agentboot-snapshot.json`) |

---

## `agentboot migrate`

Convert an existing repo with agentic content into an AgentBoot hub. Scans for `.claude/`, `.cursorrules`, `copilot-instructions.md`, classifies content, scaffolds the hub structure, and imports whole-file content deterministically.

```
agentboot migrate                         # Migrate current directory
agentboot migrate --path /path/to/repo    # Migrate specific repo
agentboot migrate --dry-run               # Preview changes
agentboot migrate --revert                # Undo migration from backup
agentboot migrate --org my-org            # Specify org slug
```

| Flag | Description |
|------|-------------|
| `--path <dir>` | Repo directory to migrate (default: cwd) |
| `--revert` | Undo a previous migration using saved backup |
| `--dry-run` | Preview what would change without modifying files |
| `--org <name>` | Org slug for the new hub (default: directory name) |

LLM classification is NOT run during migration. Run `agentboot import` after migration for files needing LLM classification.

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
| `--non-interactive` | Skip all interactive prompts; use env var defaults (see below) |
| `--skip-sync` | Skip the optional sync step after connecting |

**Two paths:**
- **Path 1 (architect):** Creates a new personas repo with config, traits, personas,
  and instructions. Auto-runs `agentboot build`. Optionally registers and syncs the
  first target repo.
- **Path 2 (developer):** Finds the org's personas repo (scans siblings, checks GitHub
  org via `gh`), creates a branch with the `repos.json` change, and offers to open a PR.

**Content detection:** During install, the wizard scans nearby directories for existing
agentic content — `.claude/` directories, root `CLAUDE.md`, `.cursorrules`,
`.github/copilot-instructions.md`, and `.github/prompts/*.prompt.md` files. For each
directory with content, the wizard offers to note it for import and prints the
`agentboot import --path <dir>` command to run after install. Import is not executed
during install (it requires LLM access). You can also check additional directories
interactively.

**Same-org repo registration (Path 1):** After registering the first target repo, the
wizard extracts the git org from that repo and scans sibling directories for other repos
with matching org. Each match is offered for individual registration. You can also
register additional repos by path interactively.

If `agentboot.config.json` already exists in cwd, exits with a message to use `doctor`.

`setup` is a hidden alias for `install` (deprecated).

**Non-interactive mode environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTBOOT_ORG` | `my-org` | Organization slug |
| `AGENTBOOT_ORG_DISPLAY` | `My Organization` | Organization display name |
| `AGENTBOOT_HOOKS` | `false` | Set to `true` to enable hooks |
| `AGENTBOOT_SYNC` | `false` | Set to `true` to enable sync |
| `AGENTBOOT_PERSONAS` | all defaults | Comma-separated persona names |

Example CI usage:
```bash
AGENTBOOT_ORG=acme npx agentboot install --non-interactive
```

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
| `--non-interactive` | Auto-apply high-confidence (>0.8) classifications without prompting |

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
agentboot doctor --fix
agentboot doctor --fix --dry-run
agentboot doctor --format json
```

| Flag | Description |
|------|-------------|
| `--fix` | Attempt to auto-fix issues (e.g., rebuild stale dist/, set missing config fields) |
| `-d, --dry-run` | Preview what `--fix` would do without making changes |
| `--format <fmt>` | Output format: `text` (default), `json` |

When `--fix` is used, doctor reports `issuesFound`, `issuesFixed`, and `issuesRemaining`
counts. Issues that cannot be auto-fixed (e.g., missing Node.js) are reported with
manual remediation steps.

Exit code `1` if any issues remain after fixing.

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

## `agentboot config [key] [value]`

Read or write configuration values. Prints the full config, a specific dotted key path,
or sets a string value.

```
agentboot config                    # Print full config
agentboot config org                # Print org name
agentboot config personas.enabled   # Print enabled personas list
agentboot config org my-new-org     # Set org to "my-new-org"
```

**Writing:** When a value argument is provided, the command updates `agentboot.config.json`
in place. JSONC comments in the config file are preserved — if the file contains comments,
the write is rejected with a message to edit manually (to prevent comment destruction).
Only string values can be written via the CLI; arrays and objects must be edited directly.

**Type safety:** The CLI validates that the new value matches the expected type for the
key. Writing a string to an array field (e.g., `agentboot config personas.enabled foo`)
is rejected.
