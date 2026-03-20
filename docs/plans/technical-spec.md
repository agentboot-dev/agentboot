# AgentBoot Technical Specification

Version: 0.1.0-draft
Status: Implementation Blueprint
License: Apache-2.0

---

## 1. Summary

AgentBoot is a build tool that compiles agentic personas into distributable artifacts for engineering teams. It operates on a hub-and-spoke model: a central personas repository (hub) produces compiled persona definitions that are synced to target repositories (spokes). The pipeline is validate, compile, sync.

The system manages four core primitives: **personas** (agent definitions with structured prompts), **traits** (reusable behavioral building blocks with weight-based composition), **instructions** (always-on guardrails), and **rules** (path-scoped gotchas). These primitives are composed at build time into platform-specific output formats: a native format using `@import`-based CLAUDE.md with full agent frontmatter, and a cross-platform format using standalone inlined SKILL.md files compatible with the agentskills.io specification.

The CLI (`agentboot`) is the primary interface for all operations: interactive onboarding, persona compilation, distribution, linting, testing, cost estimation, telemetry aggregation, marketplace publishing, and diagnostics. It is distributed as a compiled binary via native package managers (brew, apt, choco) with an npm/npx fallback.

AgentBoot enforces a four-level scope hierarchy (Org, Group, Team, Repo) where more specific scopes layer on top of general ones. Optional behaviors follow team-wins-on-conflict semantics; mandatory behaviors follow org-wins inheritance. The sync system writes a manifest tracking every managed file, enabling clean uninstall and non-destructive upgrades.

The optimization subsystem provides static prompt analysis (lint), behavioral testing against known inputs, snapshot regression detection, LLM-as-judge evaluation, token budget enforcement, cost projection, and structured telemetry collection. All developer-facing optimization tools run locally first; CI gates run on PR submission.

---

## 2. Technology Stack

### Language and Runtime

| Component | Technology | Notes |
|-----------|-----------|-------|
| Source language | TypeScript (ES modules) | `"type": "module"` in package.json |
| Runtime | Node.js 18+ | `"engines": {"node": ">=18"}` |
| Script executor | tsx 4.16+ | Used for `scripts/*.ts` execution |
| Type checking | TypeScript 5.5+ | `tsc --noEmit` for type validation |
| Package manager | npm | Lockfile committed |

### Dependencies (Production)

| Package | Version | Purpose |
|---------|---------|---------|
| chalk | ^5.3.0 | Terminal colorized output |
| glob | ^11.0.0 | File pattern matching |
| zod | ^3.23.8 | Schema validation for configs and frontmatter |

### Dependencies (Development)

| Package | Version | Purpose |
|---------|---------|---------|
| @types/node | ^22.0.0 | Node.js type definitions |
| tsx | ^4.16.0 | TypeScript execution without pre-compilation |
| typescript | ^5.5.0 | Type checking and compilation |
| vitest | ^2.0.0 | Test framework |

### Planned Dependencies (Not Yet Installed)

| Package | Purpose | Required For |
|---------|---------|-------------|
| inquirer or @inquirer/prompts | Interactive setup wizard prompts | `agentboot setup` |
| commander or yargs | CLI argument parsing and subcommand routing | CLI binary |
| js-yaml | YAML parsing for test files | `agentboot test` |
| tiktoken or gpt-tokenizer | Token counting without API calls | `agentboot lint`, `agentboot cost-estimate` |
| better-sqlite3 | SQLite for knowledge layer Stage 2 | `agentboot build --index` |
| semver | Version comparison for upgrades | `agentboot upgrade` |

### Terminal UI Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Colored output | chalk | Severity indicators, status messages |
| Interactive prompts | inquirer (recommended) | Setup wizard question flow, confirmations |
| Spinners | ora (recommended) | Progress indicators for build/sync |
| Tables | cli-table3 (recommended) | Status dashboard, metrics display |

### Build and Distribution

| Target | Method | Binary Size | Runtime Dependency |
|--------|--------|-------------|-------------------|
| npm/npx | `npm publish` | N/A (source) | Node.js 18+ |
| brew (macOS) | `agentboot/homebrew-tap` formula pointing to GitHub Releases | ~50MB (bundled) | None |
| apt (Debian/Ubuntu) | `.deb` package from GitHub Releases | ~50MB (bundled) | None |
| dnf (RHEL/Fedora) | `.rpm` package from GitHub Releases | ~50MB (bundled) | None |
| choco (Windows) | Chocolatey package | ~50MB (bundled) | None |
| winget (Windows) | Windows Package Manager manifest | ~50MB (bundled) | None |

**Build strategy (V1):** TypeScript compiled via `bun build --compile` or `pkg` to produce a single executable with Node.js runtime embedded. The binary is uploaded to GitHub Releases. Package manager formulae download and install the pre-built binary.

**Future migration path:** If binary size (~50MB) or startup time becomes a problem, migrate the CLI to Go (cobra for CLI, bubbletea for TUI). The core logic (validate, compile, sync) is I/O-bound, not CPU-bound, so language performance is not a bottleneck.

### Test Framework

| Component | Tool |
|-----------|------|
| Test runner | vitest 2.0+ |
| Assertions | vitest built-in matchers |
| Custom matchers | Frontmatter validation, token counting |
| Fixtures | `tests/fixtures/` directory |
| Coverage | vitest c8 provider |
| CI | GitHub Actions |

---

## 3. CLI Specification

The CLI binary is registered at `./dist/scripts/cli.js` in package.json under `"bin": {"agentboot": ...}`. All commands support `--non-interactive` mode (auto-detected when stdout is not a TTY). All commands support `--help` and `--version` flags.

### Global Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--help` | boolean | false | Show help text |
| `--version` | boolean | false | Print version and exit |
| `--non-interactive` | boolean | auto-detect | Disable interactive prompts |
| `--verbose` | boolean | false | Show detailed output |
| `--quiet` | boolean | false | Suppress non-error output |
| `--format` | string | `"text"` | Output format: `text`, `json` |
| `--config` | string | `"./agentboot.config.json"` | Path to config file |

### Exit Code Convention

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid input, build failure, test failure) |
| 2 | Warning (with `--strict` flag, warnings become errors) |

---

### 3.1 `agentboot setup`

Interactive onboarding wizard that determines role, tooling, and organizational context, then executes the appropriate setup.

**Signature:**
```
agentboot setup [--role <role>] [--tool <tool>] [--org <org>] [--compliance <type>] [--skip-detect]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--role` | string | (prompt) | `developer`, `platform`, `it-security`, `exploring` |
| `--tool` | string | (prompt) | `claude-code`, `copilot`, `cursor`, `mixed`, `none` |
| `--org` | string | (auto-detect) | Organization identifier |
| `--compliance` | string[] | (prompt) | `hipaa`, `soc2`, `pci-dss`, `gdpr`, `none` |
| `--skip-detect` | boolean | false | Skip auto-detection of existing infrastructure |
| `--mdm` | string | (prompt) | MDM platform: `jamf`, `intune`, `jumpcloud`, `kandji`, `other`, `none` |

**Input:**
- Interactive TTY prompts (questions Q1-Q8 per the decision tree in cli-design.md)
- Auto-detection reads: git remote, `.claude/` directory, managed settings paths, `claude --version`

**Output (Quick Start -- solo developer):**
- `.claude/agents/{name}/CLAUDE.md` for each default persona
- `.claude/skills/{name}/SKILL.md` for each default skill
- `.claude/traits/{name}.md` for each default trait
- `.claude/CLAUDE.md` with `@import` references

**Output (Standard Setup -- platform team):**
- `agentboot.config.json` with org structure
- `repos.json` (empty array)
- `core/personas/` with 4 default persona directories
- `core/traits/` with default trait files
- `core/instructions/` with baseline always-on instructions

**Output (Enterprise Setup -- IT/MDM):**
- `agentboot.config.json` (enterprise template)
- `domains/compliance/` with applicable domain layer
- `dist/managed/managed-settings.json`
- `dist/managed/managed-mcp.json`
- `dist/managed/CLAUDE.md`
- Marketplace template directory

**Exit Codes:**
- 0: Setup completed successfully
- 1: Setup failed (filesystem error, invalid input)

**Error Handling:**
- If git remote detection fails, prompt for org name manually
- If `.claude/` already exists, warn and offer to merge or skip
- If managed settings are detected, inform user they are already governed
- All filesystem writes are atomic: create temp files then rename

**Example:**
```bash
# Non-interactive quick start
agentboot setup --role exploring

# Non-interactive platform team setup
agentboot setup --role platform --tool claude-code --org acme --compliance soc2

# Non-interactive enterprise with MDM
agentboot setup --role it-security --mdm jamf --compliance hipaa,soc2
```

---

### 3.2 `agentboot connect`

Developer self-service command to connect to an organization's existing AgentBoot marketplace.

**Signature:**
```
agentboot connect <org-or-marketplace> [--marketplace <repo>] [--url <url>]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `<org-or-marketplace>` | string | Yes (unless `--marketplace` or `--url`) | Org identifier for auto-detection |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--marketplace` | string | (auto-detect) | Explicit marketplace repository slug (e.g., `acme/personas`) |
| `--url` | string | none | Full URL for self-hosted or non-GitHub marketplaces |

**Input:**
- Organization name or marketplace identifier
- Reads current git remote for context

**Output:**
- Adds marketplace to the local configuration
- Installs the organization plugin
- Prints verification status

**Algorithm:**
1. Resolve marketplace location:
   - If `--marketplace` or `--url` provided, use directly
   - Else, attempt to resolve `<org>` by checking `https://github.com/<org>/<org>-personas`
   - Fall back to prompting for the marketplace URL
2. Run `claude plugin install <marketplace>` (or equivalent API call)
3. Verify installation by checking plugin presence in config
4. Print success message with available personas

**Exit Codes:**
- 0: Connected successfully
- 1: Connection failed (marketplace not found, network error, plugin install failed)

**Error Handling:**
- If marketplace repository does not exist, print: `Marketplace not found at <url>. Check the URL or ask your platform team.`
- If plugin install fails, print the underlying error and suggest `agentboot doctor`
- If already connected, print: `Already connected to <org>. Plugin <name> is active.`

**Example:**
```bash
agentboot connect acme
agentboot connect --marketplace acme/personas
agentboot connect --url https://gitlab.internal/platform/personas
```

---

### 3.3 `agentboot build`

Compile personas with trait composition, producing platform-specific output artifacts.

**Signature:**
```
agentboot build [--format <format>] [--validate-only] [--persona <name>] [--index] [--embeddings]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | string | `"all"` | Output format: `claude-code`, `copilot`, `cross-platform`, `plugin`, `all` |
| `--validate-only` | boolean | false | Dry run: check for errors without writing files |
| `--persona` | string | all | Build a specific persona only |
| `--index` | boolean | false | Generate SQLite knowledge index (Stage 2) |
| `--embeddings` | boolean | false | Generate vector embeddings (Stage 3) |
| `--fix` | boolean | false | Auto-generate missing `persona.config.json` files |

**Input:**
- `agentboot.config.json` (root config)
- `core/personas/{name}/SKILL.md` (persona definitions)
- `core/personas/{name}/persona.config.json` (trait composition config)
- `core/traits/*.md` (trait files)
- `core/instructions/*.md` (always-on instructions)
- Domain layer directories (from `extend.domains`)

**Output:**
- `dist/core/` -- org-level compiled personas
- `dist/groups/{group}/` -- group-level overrides
- `dist/teams/{group}/{team}/` -- team-level overrides
- `PERSONAS.md` -- human-readable registry (if `output.personas_registry` is true)

**Output structure per persona (claude-code format):**
```
dist/core/{persona-name}/
  .claude/
    agents/{persona-name}/CLAUDE.md    # Full agent frontmatter
    skills/{skill-name}/SKILL.md       # With context: fork
    rules/{topic}.md                   # With paths: frontmatter
    traits/{trait-name}.md             # Separate files for @import
    CLAUDE.md                          # Using @imports
    settings.json                      # Hook entries
    .mcp.json                          # MCP server configs
```

**Output structure per persona (cross-platform format):**
```
dist/core/{persona-name}/
  SKILL.md                             # Standalone, traits inlined
  copilot-instructions.md              # Copilot-compatible output
```

**Exit Codes:**
- 0: Build succeeded
- 1: Build failed (missing traits, invalid config, schema errors)
- 2: Build succeeded with warnings (missing optional fields)

**Error Handling:**
- Missing `persona.config.json`: error with message `persona.config.json missing for: {name}. Run: agentboot add persona-config {name}`
- Missing trait reference: error with message `Trait '{trait}' referenced by persona '{persona}' does not exist in core/traits/`
- Circular trait dependency: error with message `Circular trait dependency detected: {A} -> {B} -> {A}`
- Invalid SKILL.md frontmatter: error with schema validation details

**Example:**
```bash
agentboot build
agentboot build --format claude-code
agentboot build --validate-only
agentboot build --persona code-reviewer
agentboot build --index
```

---

### 3.4 `agentboot sync`

Distribute compiled output to target repositories.

**Signature:**
```
agentboot sync [--repo <slug>] [--dry-run] [--mode <mode>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--repo` | string | all repos | Sync to a specific repo only |
| `--dry-run` | boolean | false | Show what would change without writing |
| `--mode` | string | from config | `local`, `github-api`, `gitlab-api` |

**Input:**
- `dist/` directory (compiled output from `agentboot build`)
- `repos.json` or inline repo config from `agentboot.config.json`
- `agentboot.config.json` (for scope hierarchy resolution)

**Output (local mode):**
- Files written to `{repo.path}/{output.dir}/` for each registered repo
- `.claude/.agentboot-manifest.json` written in each target repo
- Git branch created and PR opened (if `sync.pr.enabled` is true)

**Output (github-api mode):**
- PRs created in each target repo via GitHub API
- Branch name: `{sync.pr.branch_prefix}{date-or-version}`
- PR title: rendered from `sync.pr.title_template`

**Exit Codes:**
- 0: Sync completed (all repos succeeded)
- 1: Sync failed (at least one repo failed)

**Error Handling:**
- Repo path does not exist (local mode): error `Repo path not found: {path}. Is the repo cloned?`
- Dirty working tree (local mode with PR): error `Repo {name} has uncommitted changes. Commit or stash first.`
- GitHub API auth failure: error `GITHUB_TOKEN not set or insufficient permissions for {repo}.`
- Repo not in repos.json: error `Repo '{slug}' not found in repos.json.`

**Example:**
```bash
agentboot sync
agentboot sync --repo acme/api-service
agentboot sync --dry-run
agentboot sync --mode github-api
```

---

### 3.5 `agentboot export`

Generate distributable artifacts in specific formats.

**Signature:**
```
agentboot export --format <format> [--output <dir>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | string | required | `plugin`, `marketplace`, `managed`, `github-action`, `mcp-server` |
| `--output` | string | `"dist/"` | Output directory |

**Input:**
- Compiled `dist/` directory
- `agentboot.config.json`

**Output by format:**

| Format | Output |
|--------|--------|
| `plugin` | `.claude-plugin/plugin.json`, `agents/`, `skills/`, `hooks/` |
| `marketplace` | Full marketplace repo scaffold with `marketplace.json` |
| `managed` | `managed-settings.json`, `managed-mcp.json`, `CLAUDE.md` for MDM paths |
| `github-action` | `.github/workflows/agentboot-review.yml` reusable workflow |
| `mcp-server` | MCP server package with tool definitions |

**Exit Codes:**
- 0: Export succeeded
- 1: Export failed (missing dist/, invalid config)

**Error Handling:**
- `dist/` does not exist: error `No compiled output found. Run 'agentboot build' first.`
- Unknown format: error `Unknown export format: '{format}'. Valid: plugin, marketplace, managed, github-action, mcp-server`

**Example:**
```bash
agentboot export --format plugin
agentboot export --format managed --output ./deploy/
```

---

### 3.6 `agentboot publish`

Push compiled plugin to a marketplace repository.

**Signature:**
```
agentboot publish [--marketplace <path>] [--bump <level>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--marketplace` | string | from config | Path to marketplace repository |
| `--bump` | string | none | Version bump level: `patch`, `minor`, `major` |
| `--dry-run` | boolean | false | Preview what would be published |

**Input:**
- Plugin output from `agentboot export --format plugin`
- `marketplace.json` from marketplace repository
- `package.json` for current version

**Output:**
- Updated `marketplace.json` with new version entry
- Plugin files copied to marketplace directory
- Git commit and push (if not `--dry-run`)

**Algorithm:**
1. If `--bump` specified, increment version in `package.json` and `plugin.json`
2. Copy plugin artifacts to marketplace directory
3. Update `marketplace.json` with new entry (version, hash, timestamp)
4. Commit: `chore: publish agentboot plugin v{version}`
5. Push to remote

**Exit Codes:**
- 0: Published successfully
- 1: Publish failed (no plugin output, git error, push rejected)

**Error Handling:**
- No plugin output: error `No plugin found. Run 'agentboot export --format plugin' first.`
- Marketplace repo not clean: error `Marketplace repo has uncommitted changes.`
- Push rejected: error with git push output

**Example:**
```bash
agentboot publish
agentboot publish --bump patch
agentboot publish --marketplace ./acme-personas --bump minor
```

---

### 3.7 `agentboot add`

Scaffold new components.

**Signature:**
```
agentboot add <type> <name> [options]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `persona <name>` | Scaffold a new persona directory |
| `trait <name>` | Scaffold a new trait file |
| `domain <name>` | Add a domain layer template |
| `gotcha <name>` | Add a gotchas rule template |
| `hook <name>` | Add a compliance hook template |
| `repo <slug>` | Register a repo for sync |

**Output per subcommand:**

| Subcommand | Files Created |
|------------|--------------|
| `persona` | `core/personas/{name}/SKILL.md`, `core/personas/{name}/persona.config.json` |
| `trait` | `core/traits/{name}.md` |
| `domain` | `domains/{name}/` with template structure |
| `gotcha` | `.claude/rules/{name}.md` with `paths:` frontmatter template |
| `hook` | `.claude/hooks/{name}.sh` with hook script template |
| `repo` | Appends entry to `repos.json` |

**Exit Codes:**
- 0: Component created
- 1: Component already exists or invalid name

**Error Handling:**
- Name already exists: error `Persona '{name}' already exists at core/personas/{name}/`
- Invalid name (non-lowercase, special chars): error `Name must be lowercase alphanumeric with hyphens: got '{name}'`

**Example:**
```bash
agentboot add persona api-reviewer
agentboot add trait cost-awareness
agentboot add domain healthcare
agentboot add repo acme/new-service
```

---

### 3.8 `agentboot add prompt`

Ingest raw prompts: classify, format, and save as proper AgentBoot content.

**Signature:**
```
agentboot add prompt <text> [--file <path>] [--clipboard] [--url <url>] [--batch] [--dry-run] [--stdin]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--file` | string | none | Read prompt from file |
| `--clipboard` | boolean | false | Read prompt from system clipboard |
| `--url` | string | none | Fetch prompt from URL |
| `--batch` | boolean | false | Decompose multi-instruction file into individual components |
| `--dry-run` | boolean | false | Preview classification without writing |
| `--stdin` | boolean | false | Read from stdin |
| `--interactive` | boolean | false | Open editor for multi-line input |

**Input:**
- Raw text from one of: argument, file, clipboard, URL, stdin, or editor

**Classification Algorithm:**
1. Send raw text to LLM (Haiku for speed) with classification prompt
2. LLM analyzes and returns:
   - `type`: `rule`, `gotcha`, `trait`, `persona`, `session-instruction`, `rejected`
   - `name`: suggested kebab-case name
   - `scope`: suggested path patterns (for gotchas)
   - `content`: formatted markdown with appropriate frontmatter
3. Present classification to user for confirmation
4. On approval, write to appropriate location

**Classification Signals:**

| Signal in Prompt | Classified As | Destination |
|-----------------|---------------|-------------|
| "Always...", "Never...", "Verify that..." | Rule / Gotcha | `.claude/rules/` |
| Technology-specific warning with examples | Gotcha (path-scoped) | `.claude/rules/` with `paths:` |
| Behavioral stance ("be skeptical", "cite sources") | Trait | `core/traits/` |
| Complete review workflow with output format | Persona | `core/personas/` |
| Single-use instruction | Session instruction | Not persisted |
| Vague/motivational | Rejected | User feedback with improvement suggestion |

**Output:**
- One or more files written to the appropriate location
- Lint results for the generated content
- Token impact estimate

**Exit Codes:**
- 0: Prompt ingested successfully
- 1: Failed to classify or write
- 2: Dry run completed (no files written)

**Error Handling:**
- URL fetch fails: error `Could not fetch content from {url}: {http-error}`
- Clipboard empty: error `Clipboard is empty.`
- Classification rejected: print `This prompt is too vague to be actionable. Try: {suggestion}`

**Example:**
```bash
agentboot add prompt "Always check null safety before DB calls"
agentboot add prompt --file ~/tips.md --batch
agentboot add prompt --clipboard --dry-run
agentboot add prompt --url https://blog.example.com/gotchas
```

---

### 3.9 `agentboot discover`

Scan repositories and local configuration for existing agentic content.

**Signature:**
```
agentboot discover [--path <dir>] [--repos <slugs...>] [--github-org <org>] [--local] [--all] [--format <fmt>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--path` | string | `.` | Directory containing repos to scan |
| `--repos` | string[] | none | Specific repo slugs to scan |
| `--github-org` | string | none | Scan all repos in a GitHub org via API |
| `--local` | boolean | false | Scan local machine config (`~/.claude/`) |
| `--all` | boolean | false | Full scan: repos + local + managed settings |
| `--format` | string | `"text"` | Output: `text`, `json`, `markdown` |

**Scan Targets:**

| Target | Files Scanned | Method |
|--------|--------------|--------|
| `.claude/` | CLAUDE.md, agents, skills, rules, hooks, settings, .mcp.json | Filesystem |
| `.github/` | copilot-instructions.md, prompts/*.prompt.md | Filesystem |
| `.cursor/` | .cursorrules, rules/ | Filesystem |
| Repo root | CLAUDE.md, GEMINI.md, .mcp.json | Filesystem |
| Subdirectories | Nested CLAUDE.md files | Recursive scan |
| `~/.claude/` | User agents, skills, rules, CLAUDE.md, settings | Filesystem |
| Managed paths | managed-settings.json, managed-mcp.json | OS-specific paths |
| GitHub API | Repo contents via `gh api` | HTTP |
| package.json | Scripts referencing AI tools | Pattern match |
| Git history | Recent .claude/ changes | `git log` |

**Non-Destructive Guarantee:** Discovery never modifies, moves, or deletes existing files. All actions create new files in the AgentBoot personas repo. Originals stay untouched.

**Output (interactive):**
After scanning, presents 5 action options:
1. Generate detailed report (Markdown)
2. Classify and ingest (batch `add prompt` on each file)
3. Show overlap analysis (duplicate/similar content across repos)
4. Show migration plan (what becomes traits, gotchas, personas, always-on)
5. Export as `agentboot.config.json` (infer org structure from repos)

**Exit Codes:**
- 0: Scan completed
- 1: Scan failed (filesystem permission, API error)

**Error Handling:**
- Path does not exist: error `Directory not found: {path}`
- GitHub API rate limit: warn and continue with partial results
- Permission denied on file: skip with warning

**Example:**
```bash
agentboot discover
agentboot discover --path ~/work/
agentboot discover --github-org acme --local
agentboot discover --all --format json > report.json
```

---

### 3.10 `agentboot validate`

CI-friendly schema and config validation.

**Signature:**
```
agentboot validate [--personas] [--traits] [--config] [--strict]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--personas` | boolean | false | Validate personas only |
| `--traits` | boolean | false | Validate traits only |
| `--config` | boolean | false | Validate config only |
| `--strict` | boolean | false | Treat warnings as errors |

When no scope flag is provided, validates everything.

**Validation Checks (5 checks from validate.ts):**

| Check | ID | What It Verifies |
|-------|----|-----------------|
| Persona existence | `persona-exists` | Every persona in `personas.enabled` has a directory under `core/personas/` |
| Trait references | `trait-refs` | Every trait referenced in `persona.config.json` exists in `core/traits/` or extension dirs |
| SKILL.md frontmatter | `frontmatter` | Every persona SKILL.md has valid YAML frontmatter with required fields |
| PERSONAS.md sync | `registry-sync` | PERSONAS.md is up to date with the current set of compiled personas |
| Secret scanning | `no-secrets` | No API keys, tokens, passwords, or internal URLs in any persona or trait file |

**Input:**
- `agentboot.config.json`
- All files under `core/personas/`, `core/traits/`, `core/instructions/`
- Extension directories referenced in config

**Output:**
- Line-by-line pass/fail for each check
- Error messages with fix suggestions

**Exit Codes:**
- 0: All checks passed
- 1: At least one error
- 2: Warnings only (fails when `--strict` is set)

**Error Handling:**
- Missing config file: error `agentboot.config.json not found. Run 'agentboot setup' first.`
- Each validation failure includes a fix command suggestion

**Example:**
```bash
agentboot validate
agentboot validate --strict
agentboot validate --personas
```

---

### 3.11 `agentboot lint`

Static prompt analysis covering token budgets, language quality, and security.

**Signature:**
```
agentboot lint [--fix] [--persona <name>] [--severity <level>] [--ci] [--format <fmt>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--fix` | boolean | false | Auto-fix what is possible (trim whitespace, formatting) |
| `--persona` | string | all | Lint a specific persona only |
| `--severity` | string | `"warn"` | Minimum severity to report: `info`, `warn`, `error` |
| `--ci` | boolean | false | CI mode: summary counts only, full detail in log |
| `--format` | string | `"text"` | Output: `text`, `json` |

**Input:**
- Source files in `core/personas/`, `core/traits/`, `core/instructions/`
- `agentboot.config.json` (for custom rule overrides and token budget config)

**Output:**
- List of findings with rule ID, severity, file, line, message, and fix suggestion
- Summary counts by severity

See Section 6 (Lint Specification) for the full rule catalog.

**Exit Codes:**
- 0: No errors (warnings allowed)
- 1: At least one error
- 2: Warnings present (with `--severity error`, warnings do not cause non-zero exit)

**Example:**
```bash
agentboot lint
agentboot lint --fix
agentboot lint --persona code-reviewer
agentboot lint --severity error --format json --ci
```

---

### 3.12 `agentboot test`

Persona testing across multiple layers: deterministic, behavioral, snapshot, eval, and mutation.

**Signature:**
```
agentboot test [--type <type>] [--persona <name>] [--model <model>] [--max-budget <usd>] [--ci] [--update-snapshots]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--type` | string | `"all"` | Test type: `deterministic`, `behavioral`, `snapshot`, `eval`, `mutation`, `all` |
| `--persona` | string | all | Test a specific persona only |
| `--model` | string | from test file | Override model for behavioral tests |
| `--max-budget` | number | 5.00 | Maximum USD spend for the test run |
| `--ci` | boolean | false | CI mode: exit codes + JSON summary only |
| `--update-snapshots` | boolean | false | Update snapshot baselines |
| `--skip-if-behavioral-passed` | boolean | false | Skip eval tests if behavioral passed |

**Input:**
- `tests/*.test.yaml` (behavioral test definitions)
- `tests/eval/*.eval.yaml` (LLM-as-judge definitions)
- `tests/snapshots/*.json` (snapshot baselines)
- `tests/fixtures/` (known-buggy code samples)

See Section 7 (Test Specification) for the canonical test file format and assertion types.

**Exit Codes:**
- 0: All tests passed
- 1: At least one test failed
- 2: Budget exceeded before all tests completed

**Example:**
```bash
agentboot test
agentboot test --type deterministic
agentboot test --type behavioral --persona security-reviewer --max-budget 2.00
agentboot test --type snapshot --update-snapshots
agentboot test --type eval --persona code-reviewer
```

---

### 3.13 `agentboot search`

Search the marketplace for traits, gotchas, personas, and domains.

**Signature:**
```
agentboot search <query> [--type <type>] [--marketplace <url>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--type` | string | `"all"` | Filter: `trait`, `gotcha`, `persona`, `domain`, `all` |
| `--marketplace` | string | default registry | Marketplace URL to search |

**Input:**
- Query string
- Marketplace index (fetched from marketplace URL or cached locally)

**Output:**
- List of matching items with name, description, type, author, version, install command

**Exit Codes:**
- 0: Results found (or no results, still success)
- 1: Marketplace unreachable

**Example:**
```bash
agentboot search "sql injection"
agentboot search "react" --type trait
agentboot search "hipaa" --type domain
```

---

### 3.14 `agentboot metrics`

Read telemetry data and produce per-persona, per-team, per-period reports.

**Signature:**
```
agentboot metrics [--persona <name>] [--team <name>] [--period <duration>] [--format <fmt>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--persona` | string | all | Filter to one persona |
| `--team` | string | all | Filter to one team |
| `--period` | string | `"30d"` | Time window: `7d`, `30d`, `90d`, `all` |
| `--format` | string | `"text"` | Output: `text`, `json`, `csv` |

**Input:**
- NDJSON telemetry log file(s) (default location: `.agentboot/telemetry.ndjson`)

**Output:**
- Aggregated metrics per persona: invocation count, avg tokens, avg cost, avg duration, findings distribution
- Per-team rollup
- Cost trends over time

See Section 8 (Telemetry Specification) for the canonical event schema.

**Exit Codes:**
- 0: Report generated
- 1: No telemetry data found

**Example:**
```bash
agentboot metrics
agentboot metrics --persona code-reviewer --period 7d
agentboot metrics --team api --format json
```

---

### 3.15 `agentboot cost-estimate`

Project per-persona costs across the organization.

**Signature:**
```
agentboot cost-estimate [--developers <n>] [--invocations <n>] [--format <fmt>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--developers` | number | 50 | Number of developers |
| `--invocations` | number | 10 | Average invocations per developer per day |
| `--format` | string | `"text"` | Output: `text`, `json` |

**Input:**
- Compiled persona output (for token estimates)
- Model assignments from `persona.config.json`

**Algorithm:**
1. For each persona, estimate input tokens (persona prompt + traits + instructions + average file context)
2. For each persona, estimate output tokens (based on persona type: reviewer ~3k, generator ~8k)
3. Look up model pricing (Haiku: $0.80/$4.00 per M tokens, Sonnet: $3.00/$15.00, Opus: $15.00/$75.00)
4. Calculate per-invocation cost: `(input_tokens * input_price + output_tokens * output_price) / 1_000_000`
5. Calculate monthly cost: `per_invocation * developers * invocations * 21 (working days)`
6. Flag personas where Opus is used but Sonnet might suffice

**Output:**
- Per-persona table: model, estimated input/output tokens, estimated cost per invocation
- Monthly projection with developer count and invocation rate
- Optimization suggestions (model downgrade candidates)

**Exit Codes:**
- 0: Estimate generated
- 1: No compiled personas found

**Example:**
```bash
agentboot cost-estimate
agentboot cost-estimate --developers 100 --invocations 5
agentboot cost-estimate --format json
```

---

### 3.16 `agentboot review`

Guided human review of persona output samples.

**Signature:**
```
agentboot review --persona <name> [--sample <n>] [--period <duration>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--persona` | string | required | Persona to review |
| `--sample` | number | 5 | Number of samples to review |
| `--period` | string | `"7d"` | Time window for sampling |

**Input:**
- Telemetry log (to identify recent invocations)
- Persona output samples (from session transcripts or CI artifacts)

**Output:**
- Interactive review session with guided questions per sample:
  - Accuracy assessment (Yes / Partially / No)
  - Severity calibration check
  - Missing findings
  - Unnecessary findings
- Overall quality score and recommendation (Ship as-is / Needs tuning / Needs rewrite)

**Exit Codes:**
- 0: Review completed
- 1: No samples found

**Example:**
```bash
agentboot review --persona code-reviewer --sample 5
agentboot review --persona security-reviewer --period 30d
```

---

### 3.17 `agentboot issue`

Streamlined bug reporting against AgentBoot core.

**Signature:**
```
agentboot issue <title>
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `<title>` | string | Yes | Issue title |

**Input:**
- Environment: AgentBoot version, Node.js version, OS
- Diagnosis output (if `agentboot doctor --diagnose` was run)
- `agentboot.config.json` (field names and types, values redacted)

**Output:**
- Opens GitHub issue creation in browser with pre-filled template
- Auto-attaches: version info, OS, diagnosis output, redacted config structure
- Never attaches: persona content, trait content, developer prompts, session transcripts

**Exit Codes:**
- 0: Issue page opened in browser
- 1: Could not construct issue URL

**Example:**
```bash
agentboot issue "Build produces empty output on missing trait"
```

---

### 3.18 `agentboot doctor`

Diagnose issues with configuration, personas, sync, and environment.

**Signature:**
```
agentboot doctor [--diagnose]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--diagnose` | boolean | false | Run layered isolation test to pinpoint bug location |

**Standard checks:**

| Category | Check |
|----------|-------|
| Environment | Claude Code installed, Node.js version, git version, gh CLI version |
| Configuration | `agentboot.config.json` exists and validates, `repos.json` exists |
| Personas | Each enabled persona has valid SKILL.md, persona.config.json, all traits resolve |
| Sync Status | Each registered repo: last sync date, version, staleness |
| Plugin | Plugin generated (yes/no), last publish date |
| Managed Settings | Generated (yes/no), deployment target |

**Diagnose mode (5-layer isolation):**

| Layer | What it tests | If it fails |
|-------|--------------|-------------|
| 1: Core only | Core persona with zero customization | AgentBoot bug |
| 2: Core + org config | Core persona with org config | Config issue |
| 3: Core + config + org traits | Custom traits compose | Trait issue |
| 4: Core + config + traits + org personas | Custom personas compile and lint | Persona issue |
| 5: Full stack | Everything including extensions | Extension issue |

**Exit Codes:**
- 0: All checks passed
- 1: Issues found (with fix suggestions)

**Example:**
```bash
agentboot doctor
agentboot doctor --diagnose
```

---

### 3.19 `agentboot status`

Dashboard of what is deployed where.

**Signature:**
```
agentboot status [--format <fmt>]
```

**Input:**
- `agentboot.config.json`
- `repos.json`
- `.agentboot-manifest.json` in each registered repo (if accessible)
- `package.json` for version

**Output:**
- Org name and version
- Enabled personas (count and names)
- Enabled traits (count and names)
- Registered repos grouped by team, with sync status (version, date, staleness)
- Plugin status (name, version, marketplace URL, last published)
- Managed settings status (generated, deployment target)

**Exit Codes:**
- 0: Status retrieved

**Example:**
```bash
agentboot status
agentboot status --format json
```

---

### 3.20 `agentboot upgrade`

Update AgentBoot core.

**Signature:**
```
agentboot upgrade [--check] [--version <ver>]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--check` | boolean | false | Check for updates without applying |
| `--version` | string | latest | Upgrade to a specific version |

**Algorithm:**
1. Check current version from `package.json`
2. Fetch latest version from npm registry (or GitHub Releases for binary installs)
3. If `--check`, print comparison and exit
4. Download and install new version
5. Run `agentboot doctor` to verify post-upgrade health

**Exit Codes:**
- 0: Upgrade successful (or already up to date)
- 1: Upgrade failed

**Example:**
```bash
agentboot upgrade
agentboot upgrade --check
agentboot upgrade --version 2.0.0
```

---

### 3.21 `agentboot uninstall`

Clean removal of AgentBoot from repos, plugins, and managed settings.

**Signature:**
```
agentboot uninstall [--repo <slug>] [--all-repos] [--plugin] [--managed] [--everything] [--dry-run]
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--repo` | string | none | Remove from a specific repo |
| `--all-repos` | boolean | false | Remove from all synced repos |
| `--plugin` | boolean | false | Uninstall the plugin |
| `--managed` | boolean | false | Generate IT instructions for managed settings removal |
| `--everything` | boolean | false | Full removal |
| `--dry-run` | boolean | false | Preview what would be removed |

**Algorithm:**
1. Read `.agentboot-manifest.json` from target repo to identify managed files
2. For each managed file:
   a. Compare file hash against manifest hash
   b. If hash matches: remove silently
   c. If hash differs: warn "modified after sync" and prompt for confirmation
3. Check for mixed content in CLAUDE.md (both AgentBoot-generated and manual edits)
   a. If mixed: offer to remove only AgentBoot lines, or keep entire file
4. Check for `.agentboot-archive/` with pre-AgentBoot originals
   a. If present: offer to restore originals
5. For `--plugin`: run `claude plugin uninstall <plugin-name>`
6. For `--managed`: generate IT instructions for MDM removal (cannot remove directly)

**Exit Codes:**
- 0: Uninstall completed
- 1: Uninstall failed

**Example:**
```bash
agentboot uninstall --repo acme/api-service --dry-run
agentboot uninstall --all-repos
agentboot uninstall --everything
```

---

## 4. Build System Specification

### 4.1 validate.ts

The validation script runs 5 pre-build checks. Each check is independent and produces pass/fail with actionable error messages.

**Check 1: Persona Existence (`persona-exists`)**

| Property | Value |
|----------|-------|
| Input | `agentboot.config.json` `personas.enabled[]`, filesystem `core/personas/` |
| Algorithm | For each ID in `personas.enabled`, verify `core/personas/{id}/` directory exists and contains `SKILL.md` |
| Error message | `Persona '{id}' is enabled in config but directory core/personas/{id}/ does not exist.` |
| Fix suggestion | `Run: agentboot add persona {id}` |

**Check 2: Trait References (`trait-refs`)**

| Property | Value |
|----------|-------|
| Input | All `persona.config.json` files, filesystem `core/traits/` |
| Algorithm | For each trait referenced in any `persona.config.json`, verify file `core/traits/{trait}.md` exists |
| Error message | `Trait '{trait}' referenced by persona '{persona}' does not exist in core/traits/` |
| Fix suggestion | `Create core/traits/{trait}.md or remove the reference from core/personas/{persona}/persona.config.json` |

**Check 3: SKILL.md Frontmatter (`frontmatter`)**

| Property | Value |
|----------|-------|
| Input | All `core/personas/{name}/SKILL.md` files |
| Algorithm | Parse YAML frontmatter, validate against zod schema requiring: `name` (string), `description` (string) |
| Error message | `SKILL.md frontmatter validation failed for '{persona}': {zod error details}` |
| Fix suggestion | `Edit core/personas/{persona}/SKILL.md and fix the frontmatter` |

**Check 4: PERSONAS.md Sync (`registry-sync`)**

| Property | Value |
|----------|-------|
| Input | `PERSONAS.md` in repo root, compiled persona list |
| Algorithm | Generate expected PERSONAS.md content, compare against actual file (if `output.personas_registry` is true) |
| Error message | `PERSONAS.md is out of date. Expected {n} personas, found {m}.` |
| Fix suggestion | `Run: agentboot build to regenerate PERSONAS.md` |

**Check 5: Secret Scanning (`no-secrets`)**

| Property | Value |
|----------|-------|
| Input | All `.md` files in `core/`, all `*.json` config files |
| Algorithm | Regex scan for patterns: API keys (`sk-`, `ghp_`, `AKIA`, `xox[bpsa]-`), tokens (JWT `eyJ`), passwords (`password\s*[:=]`), internal URLs (`https?://.*\.internal\.`, `https?://10\.`, `https?://192\.168\.`) |
| Error message | `Potential secret found in {file}:{line}: matches pattern '{pattern}'` |
| Fix suggestion | `Remove the secret from {file}. Use environment variables for sensitive values.` |

### 4.2 compile.ts

The compilation script loads config, resolves trait references, and emits output artifacts.

**Trait Resolution Algorithm:**

```
function resolveTraits(persona: PersonaConfig, config: AgentBootConfig):
  1. Read persona.config.json for the persona
  2. For each trait entry in persona.config.json:
     a. Resolve trait file path: core/traits/{trait-id}.md
        - If not found, check extension directories
        - If not found, throw TraitNotFoundError
     b. Parse trait file content (strip frontmatter if present)
     c. Map weight string to numeric value:
        - "HIGH" -> 0.7
        - "MEDIUM" -> 0.5
        - "LOW" -> 0.3
        - Numeric (0.0-1.0) -> use as-is
        - Boolean true -> 1.0
        - Boolean false -> 0.0 (excluded)
     d. Store: { id, content, weight, filePath }
  3. Sort traits by declaration order (preserve order from persona.config.json)
  4. Return resolved trait list
```

**Weight Mapping:**

| Input | Numeric Value | Semantic |
|-------|--------------|----------|
| `"HIGH"` | 0.7 | Strong emphasis in persona prompt |
| `"MEDIUM"` | 0.5 | Standard inclusion |
| `"LOW"` | 0.3 | Light inclusion, may be abbreviated |
| `true` | 1.0 | Full inclusion |
| `false` | 0.0 | Excluded |
| `0.0-1.0` | as-is | Direct numeric weight |

**Weight Application:** Weights currently affect the `emphasis` directive prepended to each trait in the compiled output. A trait at weight 0.7 is prefixed with `<!-- weight: 0.7 — apply this trait with HIGH emphasis -->`. The LLM interprets this as guidance for how strongly to follow the trait's instructions. Future: weights may control token budget allocation per trait.

**@import Generation (Claude Code native output):**

For each persona, instead of inlining trait content into the agent CLAUDE.md:

```
// Generated .claude/CLAUDE.md
@.claude/traits/critical-thinking.md
@.claude/traits/structured-output.md
@.claude/traits/source-citation.md

[always-on instructions from core/instructions/]
```

Traits are written as separate files under `.claude/traits/` so they are loaded once regardless of how many personas reference them.

**Claude Code Native Output Generation:**

For each persona, compile.ts generates:

1. **`.claude/agents/{persona}/CLAUDE.md`** -- Agent definition with YAML frontmatter:
   ```yaml
   ---
   name: {persona-id}
   description: {from SKILL.md frontmatter}
   model: {from persona.config.json, default: inherit}
   permissionMode: {from persona.config.json, default: default}
   maxTurns: {from persona.config.json, default: 50}
   disallowedTools: {from persona.config.json, default: []}
   tools: {from persona.config.json, default: all}
   skills: {list of preloaded skills}
   mcpServers: {from persona.config.json}
   hooks: {from persona.config.json or domain layer}
   memory: {from persona.config.json, default: none}
   ---

   [Persona system prompt from SKILL.md body]
   ```

2. **`.claude/skills/{skill}/SKILL.md`** -- Skill definition:
   ```yaml
   ---
   name: {skill-name}
   description: {from SKILL.md}
   context: fork
   agent: {persona-name}
   argument-hint: {if defined}
   ---

   [Skill instructions]
   ```

3. **`.claude/rules/{topic}.md`** -- Rules with path scoping:
   ```yaml
   ---
   paths:
     - "pattern/**"
   ---

   [Rule content]
   ```

4. **`.claude/traits/{name}.md`** -- Trait files as standalone markdown.

5. **`.claude/CLAUDE.md`** -- Using `@import` references.

6. **`.claude/settings.json`** -- Hook entries:
   ```json
   {
     "hooks": {
       "PreToolUse": [...],
       "PostToolUse": [...],
       "Stop": [...]
     }
   }
   ```

7. **`.claude/.mcp.json`** -- MCP server configurations from domain layers.

**Cross-Platform Output Generation:**

For each persona, compile.ts generates:

1. **`SKILL.md`** -- Standalone file with traits inlined (no @imports):
   ```yaml
   ---
   name: {persona-id}
   description: {from frontmatter}
   version: {from config}
   ---

   [Persona prompt with traits inlined between injection markers]
   ```

2. **`copilot-instructions.md`** -- Copilot-compatible format with all instructions flattened.

**Inline Trait Injection:** For cross-platform output, traits are injected between markers in SKILL.md:
```markdown
<!-- traits:start -->
[trait content, one after another, separated by blank lines]
<!-- traits:end -->
```

**PERSONAS.md Generation:**

compile.ts generates a human-readable registry:

```markdown
# Personas Registry

Generated by AgentBoot v{version} on {date}.

## {persona-name}
- **Description:** {description}
- **Model:** {model}
- **Traits:** {trait-list with weights}
- **Token estimate:** {estimated_tokens}

[... for each enabled persona]
```

### 4.3 sync.ts

The sync script reads compiled output and distributes it to target repos.

**Repo Targeting Algorithm:**

```
function resolveReposForSync(config, cliRepoFilter):
  1. Load repo list from config.sync.repos (file path or inline array)
  2. If cliRepoFilter specified, filter to matching repos
  3. For each repo:
     a. Resolve scope: match repo.team to config.groups[*].teams
     b. Determine output format from repo.platform (default: "claude-code")
     c. Determine output source directory:
        - Start with dist/core/
        - If repo.group exists: overlay dist/groups/{group}/
        - If repo.team exists: overlay dist/teams/{group}/{team}/
  4. Return list of { repo, scopeChain, outputFormat, sourceDirs }
```

**Scope Merging Algorithm:**

```
function mergeScopes(core, group, team):
  result = deepClone(core)

  // Group layer: additive for enabled lists, override for scalar values
  if group:
    result.personas.enabled = union(core.personas.enabled, group.personas.enabled)
    result.traits.enabled = union(core.traits.enabled, group.traits.enabled)
    // Group extensions layered on top

  // Team layer: team wins on conflicts for optional behaviors
  if team:
    result.personas.enabled = union(result.personas.enabled, team.personas.enabled)
    result.traits.enabled = union(result.traits.enabled, team.traits.enabled)
    // Team overrides group for scalar config values
    // Mandatory behaviors (marked required in config) are NOT overridable

  return result
```

**Mandatory vs. Optional:** Behaviors marked as `required: true` in the org-level config follow top-down inheritance (org wins). All other behaviors follow bottom-up overriding (team wins).

**Platform Detection:**

| `repo.platform` Value | Output Written |
|-----------------------|---------------|
| `"claude-code"` (default) | `.claude/` directory with agents, skills, rules, traits, CLAUDE.md, settings.json, .mcp.json |
| `"copilot"` | `.github/copilot-instructions.md` |
| `"cross-platform"` | SKILL.md files + copilot-instructions.md |

**File Writing (local mode):**

```
function syncToRepo(repo, outputFiles):
  1. Verify repo.path exists and is a git repository
  2. Read existing .agentboot-manifest.json (if present) for diff comparison
  3. For each output file:
     a. Compute file hash (SHA-256)
     b. Write file to {repo.path}/{output.dir}/{relative-path}
  4. Write new .agentboot-manifest.json with all managed file paths and hashes
  5. If sync.pr.enabled:
     a. Create branch: {sync.pr.branch_prefix}{ISO-date}
     b. Stage all written files
     c. Commit: rendered sync.pr.title_template
     d. Push branch
     e. Create PR via gh CLI or GitHub API
```

**Manifest Tracking:**

The manifest (`.claude/.agentboot-manifest.json`) tracks every file AgentBoot manages:

```json
{
  "managed_by": "agentboot",
  "version": "1.2.0",
  "synced_at": "2026-03-19T14:30:00Z",
  "source_commit": "abc123",
  "files": [
    {
      "path": "agents/code-reviewer/CLAUDE.md",
      "hash": "sha256:a3f2..."
    }
  ]
}
```

**PR Creation (github-api mode):**

```
function syncViaGitHubApi(repo, outputFiles):
  1. Require GITHUB_TOKEN env var
  2. Use GitHub API (via gh or octokit):
     a. Create branch from default branch HEAD
     b. For each file, create/update blob via API
     c. Create tree with all blobs
     d. Create commit on the new tree
     e. Update branch ref to new commit
     f. Create PR with rendered title template
  3. Return PR URL
```

---

## 5. Persona Configuration Specification

### 5.1 `persona.config.json` Schema

This file does not yet exist in the codebase. The following is the canonical schema definition.

**Location:** `core/personas/{persona-name}/persona.config.json`

**JSON Schema:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://agentboot.dev/schema/persona-config/v1",
  "title": "AgentBoot Persona Configuration",
  "type": "object",
  "required": ["traits"],
  "additionalProperties": false,
  "properties": {
    "traits": {
      "type": "object",
      "description": "Trait composition map. Keys are trait IDs; values are weight configurations.",
      "additionalProperties": {
        "oneOf": [
          { "type": "boolean" },
          { "type": "number", "minimum": 0.0, "maximum": 1.0 },
          { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] }
        ]
      }
    },
    "model": {
      "type": "string",
      "description": "Model to use for this persona.",
      "enum": ["haiku", "sonnet", "opus", "inherit"],
      "default": "inherit"
    },
    "permissionMode": {
      "type": "string",
      "description": "Permission mode for this persona's agent.",
      "enum": ["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"],
      "default": "default"
    },
    "maxTurns": {
      "type": "integer",
      "description": "Maximum agentic turns for this persona.",
      "minimum": 1,
      "maximum": 1000,
      "default": 50
    },
    "disallowedTools": {
      "type": "array",
      "description": "Tools this persona cannot use.",
      "items": { "type": "string" },
      "default": []
    },
    "tools": {
      "type": "array",
      "description": "Explicit tool allowlist. If set, only these tools are available.",
      "items": { "type": "string" }
    },
    "effort": {
      "type": "string",
      "description": "Extended thinking effort level.",
      "enum": ["low", "medium", "high", "max"],
      "default": "medium"
    },
    "autonomy": {
      "type": "string",
      "description": "Autonomy progression level (V2+).",
      "enum": ["advisory", "auto-approve", "autonomous"],
      "default": "advisory"
    },
    "skills": {
      "type": "array",
      "description": "Skills to preload when this persona is invoked.",
      "items": { "type": "string" },
      "default": []
    },
    "mcpServers": {
      "type": "object",
      "description": "MCP servers scoped to this persona.",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["stdio", "http", "ws", "sse"] },
          "command": { "type": "string" },
          "args": { "type": "array", "items": { "type": "string" } },
          "url": { "type": "string" },
          "env": { "type": "object", "additionalProperties": { "type": "string" } }
        }
      }
    },
    "hooks": {
      "type": "object",
      "description": "Hooks scoped to this persona's agent.",
      "additionalProperties": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "matcher": { "type": "string" },
            "hooks": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["type", "command"],
                "properties": {
                  "type": { "type": "string", "enum": ["command", "http", "prompt", "agent"] },
                  "command": { "type": "string" },
                  "url": { "type": "string" },
                  "timeout": { "type": "integer" },
                  "async": { "type": "boolean", "default": false }
                }
              }
            }
          }
        }
      }
    },
    "memory": {
      "type": "string",
      "description": "Persistent memory scope for this persona.",
      "enum": ["user", "project", "local"],
      "default": null
    },
    "background": {
      "type": "boolean",
      "description": "Whether this persona runs as a background agent.",
      "default": false
    },
    "isolation": {
      "type": "string",
      "description": "Isolation mode for this persona.",
      "enum": ["none", "worktree"],
      "default": "none"
    },
    "tokenBudget": {
      "type": "integer",
      "description": "Maximum token budget for this persona's full context.",
      "default": 6000
    },
    "required": {
      "type": "boolean",
      "description": "When true, this persona cannot be disabled by group/team overrides.",
      "default": false
    }
  }
}
```

### 5.2 Example persona.config.json

```json
{
  "traits": {
    "critical-thinking": "HIGH",
    "structured-output": true,
    "source-citation": "MEDIUM",
    "confidence-signaling": "LOW"
  },
  "model": "sonnet",
  "permissionMode": "plan",
  "maxTurns": 30,
  "disallowedTools": ["Write", "Edit", "Agent"],
  "effort": "high",
  "skills": ["review-code"],
  "memory": "project",
  "tokenBudget": 6000
}
```

### 5.3 Mapping to Claude Code Agent CLAUDE.md Frontmatter

| persona.config.json field | Agent CLAUDE.md frontmatter field | Transformation |
|--------------------------|----------------------------------|----------------|
| `model` | `model` | Direct pass-through |
| `permissionMode` | `permissionMode` | Direct pass-through |
| `maxTurns` | `maxTurns` | Direct pass-through |
| `disallowedTools` | `disallowedTools` | Direct pass-through (comma-separated in YAML) |
| `tools` | `tools` | Direct pass-through |
| `skills` | `skills` | List of skill names |
| `mcpServers` | `mcpServers` | Nested YAML map |
| `hooks` | `hooks` | Nested YAML structure |
| `memory` | `memory` | Direct pass-through |
| `background` | `background` | Direct pass-through |
| `isolation` | `isolation` | Direct pass-through |
| `effort` | not in frontmatter | Emitted as instruction in body: `Use effort level: {effort}` |
| `autonomy` | not in frontmatter | V2+ feature, emitted as instruction |
| `traits` | not in frontmatter | Resolved and composed into body or @import references |
| `tokenBudget` | `estimated_tokens` (informational) | Calculated and emitted as comment |
| `required` | not in frontmatter | Build-time metadata only |

### 5.4 Mapping to Cross-Platform SKILL.md Frontmatter

| persona.config.json field | SKILL.md frontmatter field | Transformation |
|--------------------------|---------------------------|----------------|
| `model` | not emitted | Cross-platform SKILL.md does not set model |
| `traits` | inlined in body | Traits are injected between `<!-- traits:start -->` and `<!-- traits:end -->` |
| `permissionMode` | not emitted | Platform-specific |
| `maxTurns` | not emitted | Platform-specific |
| All other fields | not emitted | Only `name`, `description`, `version` in cross-platform frontmatter |

---

## 6. Lint Specification

### 6.1 Lint Rule Catalog

#### Token Budget Rules

**Rule: `prompt-too-long`**

| Property | Value |
|----------|-------|
| ID | `prompt-too-long` |
| Description | Persona prompt exceeds recommended line count |
| Severity | WARN at 500 lines, ERROR at 1000 lines |
| What it checks | Line count of SKILL.md body (excluding frontmatter) |
| Auto-fixable | No |
| Configurable thresholds | `lint.rules.prompt-too-long: { warn: N, error: N }` |

**Rule: `claude-md-too-long`**

| Property | Value |
|----------|-------|
| ID | `claude-md-too-long` |
| Description | Generated CLAUDE.md exceeds effective limit for adherence |
| Severity | WARN at 200 lines, ERROR at 500 lines |
| What it checks | Line count of generated CLAUDE.md (after @import expansion) |
| Auto-fixable | No |
| Configurable thresholds | `lint.rules.claude-md-too-long: { warn: N, error: N }` |

**Rule: `trait-too-long`**

| Property | Value |
|----------|-------|
| ID | `trait-too-long` |
| Description | Individual trait file is too large and should be split |
| Severity | WARN at 100 lines |
| What it checks | Line count of each trait file |
| Auto-fixable | No |
| Configurable threshold | `lint.rules.trait-too-long: { warn: N }` |

**Rule: `total-context-estimate`**

| Property | Value |
|----------|-------|
| ID | `total-context-estimate` |
| Description | Combined persona + traits + instructions exceed context budget |
| Severity | WARN when estimated tokens exceed configured percentage of context window |
| What it checks | Token estimate for full persona context (SKILL.md + all traits + always-on instructions + path-scoped rules) |
| Auto-fixable | No |
| Configurable | `lint.rules.total-context-estimate: { warn: 30 }` (percentage of 200k context window) |

#### Quality Rules

**Rule: `vague-instruction`**

| Property | Value |
|----------|-------|
| ID | `vague-instruction` |
| Description | Instruction uses weak, non-actionable language |
| Severity | WARN |
| What it checks | Regex patterns: `/\b(be thorough|try to|if possible|as needed|best practices|when appropriate|good code|clean code|high quality)\b/i` |
| Auto-fixable | No (requires human judgment to make specific) |
| Configurable severity | `lint.rules.vague-instruction: "error"` |

**Rule: `conflicting-instructions`**

| Property | Value |
|----------|-------|
| ID | `conflicting-instructions` |
| Description | Two traits or instructions contradict each other |
| Severity | ERROR |
| What it checks | Known contradiction patterns: "always X" in one file + "never X" in another; "use framework A" + "do not use framework A" |
| Algorithm | Build instruction index, detect opposing directives on same topic |
| Auto-fixable | No |

**Rule: `missing-output-format`**

| Property | Value |
|----------|-------|
| ID | `missing-output-format` |
| Description | Reviewer persona does not define structured output format |
| Severity | WARN |
| What it checks | Persona SKILL.md body contains "Output Format" or "Output Schema" section header |
| Auto-fixable | No |

**Rule: `missing-severity-levels`**

| Property | Value |
|----------|-------|
| ID | `missing-severity-levels` |
| Description | Reviewer persona does not define severity classifications |
| Severity | WARN |
| What it checks | Persona SKILL.md body contains at least two of: CRITICAL, ERROR, WARN, INFO |
| Auto-fixable | No |

**Rule: `hardcoded-paths`**

| Property | Value |
|----------|-------|
| ID | `hardcoded-paths` |
| Description | Absolute filesystem paths that will not work across machines |
| Severity | ERROR |
| What it checks | Regex: `/(?:^|\s)(\/(?:Users|home|var|tmp|opt)\/\S+)/` |
| Auto-fixable | No |

**Rule: `hardcoded-model`**

| Property | Value |
|----------|-------|
| ID | `hardcoded-model` |
| Description | Model name appears in prose text instead of frontmatter |
| Severity | WARN |
| What it checks | Regex in SKILL.md body: `/\b(claude-opus|claude-sonnet|claude-haiku|gpt-4|gpt-3\.5)\b/i` |
| Auto-fixable | No |

**Rule: `unused-trait`**

| Property | Value |
|----------|-------|
| ID | `unused-trait` |
| Description | Trait file exists but is not referenced by any persona |
| Severity | WARN |
| What it checks | Cross-reference `core/traits/` files against all `persona.config.json` trait entries |
| Auto-fixable | No |

**Rule: `missing-anti-patterns`**

| Property | Value |
|----------|-------|
| ID | `missing-anti-patterns` |
| Description | Trait does not include a "What Not To Do" section |
| Severity | INFO |
| What it checks | Trait markdown contains heading with "Not" or "Anti" or "Don't" |
| Auto-fixable | No |

**Rule: `missing-activation-condition`**

| Property | Value |
|----------|-------|
| ID | `missing-activation-condition` |
| Description | Trait does not specify when it should be active |
| Severity | WARN |
| What it checks | Trait markdown contains heading with "When" or "Activation" or "Applies" |
| Auto-fixable | No |

**Rule: `duplicate-instruction`**

| Property | Value |
|----------|-------|
| ID | `duplicate-instruction` |
| Description | Same instruction appears in multiple files |
| Severity | WARN |
| What it checks | Normalized instruction text comparison across all persona and trait files (case-insensitive, whitespace-normalized) |
| Auto-fixable | No |

**Rule: `no-examples`**

| Property | Value |
|----------|-------|
| ID | `no-examples` |
| Description | Persona has no example input/output to guide behavior |
| Severity | INFO |
| What it checks | SKILL.md body contains "Example" heading or code block with input/output labels |
| Auto-fixable | No |

#### Security Rules

**Rule: `credential-in-prompt`**

| Property | Value |
|----------|-------|
| ID | `credential-in-prompt` |
| Description | API key, token, or password detected in prompt text |
| Severity | ERROR |
| What it checks | Regex patterns: `/sk-[a-zA-Z0-9]{20,}/`, `/ghp_[a-zA-Z0-9]{36}/`, `/AKIA[A-Z0-9]{16}/`, `/xox[bpsa]-[a-zA-Z0-9-]+/`, `/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/`, `/password\s*[:=]\s*["'][^"']+["']/i` |
| Auto-fixable | No |

**Rule: `internal-url`**

| Property | Value |
|----------|-------|
| ID | `internal-url` |
| Description | Internal URL that should not appear in distributed prompts |
| Severity | ERROR |
| What it checks | Regex: `/https?:\/\/[^\s]*\.(internal|local|corp|intranet)\b/`, private IP ranges |
| Auto-fixable | No |

**Rule: `pii-in-example`**

| Property | Value |
|----------|-------|
| ID | `pii-in-example` |
| Description | Real names, emails, or identifiers in persona examples |
| Severity | ERROR |
| What it checks | Email regex in non-config files, common name patterns adjacent to "example" or "sample" |
| Auto-fixable | No |

### 6.2 Custom Rule Format

Organizations define custom rules in `agentboot.config.json`:

```json
{
  "lint": {
    "rules": {
      "prompt-too-long": { "warn": 300, "error": 600 },
      "vague-instruction": "error"
    },
    "custom": [
      {
        "id": "no-passive-voice",
        "pattern": "should be|could be|might be",
        "message": "Use imperative voice: 'Verify X' not 'X should be verified'",
        "severity": "warn",
        "scope": "persona"
      }
    ]
  }
}
```

**Custom rule fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique rule identifier (kebab-case) |
| `pattern` | string | Yes | Regex pattern to match (case-insensitive) |
| `message` | string | Yes | Human-readable error message |
| `severity` | string | Yes | `info`, `warn`, `error` |
| `scope` | string | No | Where to apply: `persona`, `trait`, `instruction`, `all` (default: `all`) |

### 6.3 Token Counting Algorithm

Token estimation is performed locally without an API call. AgentBoot uses a character-based approximation calibrated against the `cl100k_base` tokenizer (used by Claude models).

**Algorithm:**

```
function estimateTokens(text: string): number {
  // Approximation: 1 token ~= 4 characters for English text
  // Calibrated against cl100k_base tokenizer on a corpus of
  // CLAUDE.md files, trait definitions, and persona prompts.
  //
  // For code-heavy content, ratio is closer to 1:3.5
  // For prose-heavy content, ratio is closer to 1:4.5
  // We use 4 as a balanced default.

  const charCount = text.length;
  const baseEstimate = Math.ceil(charCount / 4);

  // Adjust for markdown formatting overhead
  const headingCount = (text.match(/^#{1,6}\s/gm) || []).length;
  const codeBlockCount = (text.match(/```/g) || []).length / 2;
  const listItemCount = (text.match(/^[\s]*[-*]\s/gm) || []).length;

  const formattingOverhead = headingCount * 2 + codeBlockCount * 4 + listItemCount;

  return baseEstimate + formattingOverhead;
}
```

**Accuracy:** This approximation is within +/-15% of the actual tokenizer output for typical AgentBoot content. For exact counting, organizations can install `tiktoken` or `gpt-tokenizer` and AgentBoot will use them if available (runtime detection).

**Budget calculation per persona:**

```
total_tokens =
  estimateTokens(SKILL.md body)
  + sum(estimateTokens(trait) for each composed trait)
  + sum(estimateTokens(instruction) for each always-on instruction)
  + sum(estimateTokens(rule) for likely-to-activate path-scoped rules)
  + estimateTokens(generated frontmatter YAML)
```

---

## 7. Test Specification

### 7.1 Test YAML Format (Canonical Schema)

This section resolves inconsistencies between `prompt-optimization.md` and `test-plan.md`. The canonical format is defined here.

**File location:** `tests/behavioral/{persona-name}.test.yaml` for behavioral tests, `tests/eval/{persona-name}.eval.yaml` for LLM-as-judge.

**Canonical behavioral test schema:**

```yaml
# Required fields
persona: string              # Persona ID to test
model: string                # Model override for tests (default: haiku)
max_turns: integer            # Max turns per test case (default: 5)
max_budget_usd: number        # Cost cap per test case (default: 0.50)

# Optional
flake_tolerance: string       # Pass threshold: "2 of 3" (default), "3 of 3", "1 of 3"

# Test file setup (shared across cases unless overridden)
setup:
  files:                      # Files to create in the test workspace
    - path: string            # Relative file path
      content: string         # File content (multi-line via | or >)

# Test cases
cases:
  - name: string              # Test case identifier (kebab-case)
    prompt: string             # Prompt to send to the persona

    # Optional per-case setup override
    setup_override:
      files:
        - path: string
          content: string

    # Assertions (all optional; at least one required)
    expect:
      findings_min: integer          # Minimum number of findings
      findings_max: integer          # Maximum number of findings
      severity_includes: string[]    # At least one finding has this severity
      severity_excludes: string[]    # No finding has this severity
      text_matches:                  # Regex patterns that must match
        - pattern: string            # Regex
          in: string                 # Where to match: "findings", "output", "all"
      text_excludes:                 # Regex patterns that must NOT match
        - pattern: string
          in: string
      confidence_min: number         # All findings have confidence >= N
      output_contains: string[]      # Literal strings in output
      output_structure:              # Structural assertions
        has_sections: string[]       # Named sections must be present
      json_schema: string            # Path to JSON schema file for output validation
      token_max: integer             # Output token budget
      duration_max_ms: integer       # Maximum execution time
```

**Resolution of inconsistencies:**

| Inconsistency | prompt-optimization.md | test-plan.md | Canonical Decision |
|---------------|----------------------|--------------|-------------------|
| Prompt field name | `input` | `prompt` | **`prompt`** -- more descriptive for the test's purpose |
| Text assertion name | `text_includes` | `text_matches` with `pattern` | **`text_matches`** with `pattern` and `in` fields -- more flexible |
| Setup mechanism | Inline code in `input` | `setup.files` with separate paths | **Both supported**: `setup.files` for file-based tests, inline code in `prompt` for simple cases |
| Flake tolerance syntax | Not specified | `flake_tolerance: 2 of 3` | **`flake_tolerance: "2 of 3"`** -- human-readable string |

### 7.2 Assertion Types (Canonical List)

| Assertion | Type | Semantics |
|-----------|------|-----------|
| `findings_min` | integer | Output must contain at least N findings. Findings are detected by structured output parsing (severity labels). |
| `findings_max` | integer | Output must contain at most N findings. Used for false positive checks. |
| `severity_includes` | string[] | At least one finding must have a severity from this list. Values: `CRITICAL`, `ERROR`, `WARN`, `INFO`. |
| `severity_excludes` | string[] | No finding may have a severity from this list. |
| `text_matches` | array of `{pattern, in}` | Regex pattern must match somewhere in the specified scope. `in` values: `findings` (finding text only), `output` (full output), `all` (default). |
| `text_excludes` | array of `{pattern, in}` | Regex pattern must NOT match in the specified scope. |
| `confidence_min` | number (0.0-1.0) | Every finding with a confidence score must have confidence >= N. |
| `output_contains` | string[] | Each literal string must appear somewhere in the output. |
| `output_structure` | object | Structural checks. `has_sections`: list of section names (headers) that must be present. |
| `json_schema` | string | Path to a JSON schema file. Output is parsed as JSON and validated against the schema. |
| `token_max` | integer | Output must not exceed N tokens (estimated). |
| `duration_max_ms` | integer | Test execution must complete within N milliseconds. |
| `judge_score_min` | object | (Eval tests only) Minimum scores from LLM judge. Keys are dimension names, values are minimum scores (1-5) or `"pass"`. |

### 7.3 Test Runner Algorithm

**Behavioral test execution:**

```
function runBehavioralTests(testFile, options):
  config = parseYaml(testFile)
  results = []

  for each case in config.cases:
    // Determine retry count from flake_tolerance
    [requiredPasses, totalRuns] = parseFlakeTolerance(config.flake_tolerance || "2 of 3")
    passCount = 0
    runResults = []

    for run in 1..totalRuns:
      // Set up test workspace
      workspace = createTempDir()
      if case.setup_override:
        writeFiles(workspace, case.setup_override.files)
      else if config.setup:
        writeFiles(workspace, config.setup.files)

      // Invoke persona
      output = exec(
        `claude -p \
          --agent ${config.persona} \
          --output-format json \
          --max-turns ${config.max_turns} \
          --max-budget-usd ${config.max_budget_usd} \
          --permission-mode bypassPermissions \
          --no-session-persistence \
          "${case.prompt}"`,
        { cwd: workspace }
      )

      // Parse output
      parsed = parseJsonOutput(output)

      // Evaluate assertions
      assertionResults = evaluateAssertions(case.expect, parsed)
      passed = assertionResults.every(a => a.passed)

      if passed: passCount++
      runResults.push({ run, passed, assertionResults, cost: parsed.cost })

      // Cleanup
      removeTempDir(workspace)

      // Early exit: if enough passes already, skip remaining runs
      if passCount >= requiredPasses: break

      // Early exit: if impossible to reach required passes, skip remaining
      remainingRuns = totalRuns - run
      if passCount + remainingRuns < requiredPasses: break

    results.push({
      name: case.name,
      passed: passCount >= requiredPasses,
      passCount,
      totalRuns: runResults.length,
      runs: runResults,
      totalCost: sum(runResults.map(r => r.cost))
    })

    // Check budget
    runningCost += results.last().totalCost
    if runningCost > options.maxBudget:
      results.push({ name: "BUDGET_EXCEEDED", passed: false })
      break

  return results
```

**Cost tracking:**

Every test run tracks its cost via the JSON output from `claude -p`. The runner maintains a running total and aborts when the budget cap is reached. Partial results are reported.

**Flake tolerance parsing:**

```
function parseFlakeTolerance(s: string): [required: number, total: number]
  // "2 of 3" -> [2, 3]
  // "3 of 3" -> [3, 3]  (strict, no flake tolerance)
  // "1 of 3" -> [1, 3]  (very lenient)
  match = s.match(/(\d+)\s+of\s+(\d+)/)
  return [parseInt(match[1]), parseInt(match[2])]
```

### 7.4 Snapshot Format

Snapshots store structural summaries for regression comparison:

```json
{
  "persona": "code-reviewer",
  "test_case": "sql-injection-detection",
  "snapshot_date": "2026-03-19",
  "model": "haiku",
  "findings_count": {
    "CRITICAL": 1,
    "ERROR": 0,
    "WARN": 0,
    "INFO": 0
  },
  "finding_patterns": ["SQL injection", "parameterized"],
  "total_tokens": 1200,
  "duration_ms": 8500,
  "output_hash": "sha256:abc123..."
}
```

**Snapshot comparison algorithm:**

```
function compareSnapshots(baseline, current):
  diffs = []

  // Compare finding counts
  for severity in [CRITICAL, ERROR, WARN, INFO]:
    if baseline.findings_count[severity] != current.findings_count[severity]:
      diffs.push({
        field: `findings_count.${severity}`,
        baseline: baseline.findings_count[severity],
        current: current.findings_count[severity],
        type: current > baseline ? "REGRESSION_CANDIDATE" : "IMPROVEMENT_CANDIDATE"
      })

  // Compare finding patterns
  missingPatterns = baseline.finding_patterns.filter(p => !current.finding_patterns.includes(p))
  newPatterns = current.finding_patterns.filter(p => !baseline.finding_patterns.includes(p))

  if missingPatterns.length > 0:
    diffs.push({ type: "MISSING_PATTERNS", patterns: missingPatterns })
  if newPatterns.length > 0:
    diffs.push({ type: "NEW_PATTERNS", patterns: newPatterns })

  // Compare token usage (significant change = >20% difference)
  tokenDelta = abs(current.total_tokens - baseline.total_tokens) / baseline.total_tokens
  if tokenDelta > 0.20:
    diffs.push({ type: "TOKEN_CHANGE", baseline: baseline.total_tokens, current: current.total_tokens })

  return { match: diffs.length === 0, diffs }
```

### 7.5 LLM-as-Judge Eval Format

```yaml
persona_under_test: string       # Persona ID
judge_model: string              # Model for the judge (typically opus)
max_budget_usd: number           # Cost cap for the full eval

cases:
  - name: string                 # Eval case name
    input_file: string            # Path to code fixture
    persona_prompt: string        # Prompt sent to persona under test
    judge_prompt: string          # Evaluation prompt sent to judge model
                                  # Supports placeholders: {input}, {persona_output}
    ground_truth:                 # Optional: known issues in the code
      - string
    expect:
      judge_score_min:            # Minimum scores per dimension
        completeness: integer     # 1-5 scale
        accuracy: integer
        specificity: integer
        prioritization: integer
        tone: integer
        overall: string           # "pass" or "fail"
```

**Eval execution:**

```
function runEval(evalFile):
  config = parseYaml(evalFile)
  results = []

  for each case in config.cases:
    // Step 1: Run the persona under test
    personaOutput = exec(`claude -p --agent ${config.persona_under_test} ...`, case.persona_prompt)

    // Step 2: Send output to judge
    judgePrompt = case.judge_prompt
      .replace("{input}", readFile(case.input_file))
      .replace("{persona_output}", personaOutput)

    judgeOutput = exec(`claude -p --model ${config.judge_model} ...`, judgePrompt)

    // Step 3: Parse judge scores
    scores = parseJudgeScores(judgeOutput)

    // Step 4: Evaluate against thresholds
    passed = true
    for [dimension, minScore] in case.expect.judge_score_min:
      if dimension == "overall":
        passed = passed && scores.overall == minScore
      else:
        passed = passed && scores[dimension] >= minScore

    results.push({ name: case.name, passed, scores, personaOutput, judgeOutput })

  return results
```

---

## 8. Telemetry Specification

### 8.1 Canonical Telemetry Event Schema

This section resolves field name inconsistencies across source documents. The following is the canonical schema.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://agentboot.dev/schema/telemetry-event/v1",
  "title": "AgentBoot Telemetry Event",
  "type": "object",
  "required": ["event", "persona_id", "timestamp"],
  "properties": {
    "event": {
      "type": "string",
      "enum": ["persona_invocation", "persona_error", "hook_execution", "session_summary"],
      "description": "Event type"
    },
    "persona_id": {
      "type": "string",
      "description": "Persona identifier (e.g., 'security-reviewer')"
    },
    "persona_version": {
      "type": "string",
      "description": "Persona version from config or package.json"
    },
    "model": {
      "type": "string",
      "description": "Model used for this invocation"
    },
    "scope": {
      "type": "string",
      "description": "Scope path: 'org:team:group' format (e.g., 'acme:platform:api')"
    },
    "input_tokens": {
      "type": "integer",
      "description": "Input token count for this invocation"
    },
    "output_tokens": {
      "type": "integer",
      "description": "Output token count"
    },
    "thinking_tokens": {
      "type": "integer",
      "description": "Extended thinking token count (billed as output)"
    },
    "tool_calls": {
      "type": "integer",
      "description": "Number of tool calls in this invocation"
    },
    "duration_ms": {
      "type": "integer",
      "description": "Wall-clock duration in milliseconds"
    },
    "cost_usd": {
      "type": "number",
      "description": "Estimated cost in USD"
    },
    "findings_count": {
      "type": "object",
      "description": "Finding counts by severity",
      "properties": {
        "CRITICAL": { "type": "integer" },
        "ERROR": { "type": "integer" },
        "WARN": { "type": "integer" },
        "INFO": { "type": "integer" }
      }
    },
    "suggestions": {
      "type": "integer",
      "description": "Number of non-finding suggestions"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp"
    },
    "session_id": {
      "type": "string",
      "description": "Session identifier (opaque string)"
    },
    "gate_result": {
      "type": "string",
      "enum": ["passed", "failed", "skipped"],
      "description": "CI gate result (if applicable)"
    }
  }
}
```

**Field name resolution:**

| Source doc field | Canonical field | Reason |
|-----------------|----------------|--------|
| `persona` (ci-cd-automation.md) | `persona_id` | Consistent with other `_id` suffixed fields |
| `scope: "team:platform/api"` (prompt-optimization.md) | `scope: "acme:platform:api"` | Use colon separators consistently, include org |
| `version` (ci-cd-automation.md) | `persona_version` | Avoid ambiguity with AgentBoot version |

### 8.2 Hook Generation

AgentBoot generates audit trail hooks that emit telemetry events. All hooks are `async: true` to avoid blocking the developer.

**Generated hooks:**

| Hook Event | Matcher | Script | What It Emits |
|------------|---------|--------|---------------|
| `SubagentStart` | (all) | `.claude/hooks/agentboot-telemetry.sh` | `persona_invocation` event with start timestamp, persona_id, model |
| `SubagentStop` | (all) | `.claude/hooks/agentboot-telemetry.sh` | Completes the `persona_invocation` event with duration, tokens, cost, findings |
| `PostToolUse` | `Edit\|Write\|Bash` | `.claude/hooks/agentboot-telemetry.sh` | Increments `tool_calls` counter |
| `SessionEnd` | (all) | `.claude/hooks/agentboot-telemetry.sh` | `session_summary` event with total cost, total invocations |

**Hook script behavior:**

The generated hook script is a single shell script that reads the hook input JSON from stdin, extracts relevant fields, and appends an NDJSON line to the telemetry log.

```bash
#!/bin/bash
# .claude/hooks/agentboot-telemetry.sh
# Generated by AgentBoot. Do not edit manually.

TELEMETRY_LOG="${AGENTBOOT_TELEMETRY_LOG:-.agentboot/telemetry.ndjson}"
INPUT=$(cat)

EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

case "$EVENT_NAME" in
  SubagentStart)
    echo "{\"event\":\"persona_invocation\",\"persona_id\":\"$AGENT_TYPE\",\"timestamp\":\"$TIMESTAMP\",\"status\":\"started\"}" >> "$TELEMETRY_LOG"
    ;;
  SubagentStop)
    # Extract completion data from hook input
    echo "{\"event\":\"persona_invocation\",\"persona_id\":\"$AGENT_TYPE\",\"timestamp\":\"$TIMESTAMP\",\"status\":\"completed\"}" >> "$TELEMETRY_LOG"
    ;;
  SessionEnd)
    echo "{\"event\":\"session_summary\",\"timestamp\":\"$TIMESTAMP\"}" >> "$TELEMETRY_LOG"
    ;;
esac

echo '{"continue":true}' # Always allow continuation
```

**Async behavior:** All telemetry hooks set `"async": true` in the hook configuration. This means the hook runs in the background and does not block the main agent execution. If the hook fails (e.g., cannot write to log file), the failure is silently ignored.

### 8.3 NDJSON Output Format

Telemetry is stored as Newline-Delimited JSON (NDJSON). Each line is a complete, valid JSON object.

**File location:** `.agentboot/telemetry.ndjson` (relative to personas repo root or `$AGENTBOOT_TELEMETRY_LOG`)

**Example:**
```
{"event":"persona_invocation","persona_id":"code-reviewer","persona_version":"1.2.0","model":"sonnet","scope":"acme:platform:api","input_tokens":8420,"output_tokens":3200,"thinking_tokens":12000,"tool_calls":7,"duration_ms":45000,"cost_usd":0.089,"findings_count":{"CRITICAL":0,"ERROR":1,"WARN":3,"INFO":2},"suggestions":2,"timestamp":"2026-03-19T14:30:00Z","session_id":"abc123"}
{"event":"persona_invocation","persona_id":"security-reviewer","persona_version":"1.2.0","model":"opus","scope":"acme:platform:api","input_tokens":12400,"output_tokens":5100,"thinking_tokens":18000,"tool_calls":12,"duration_ms":92000,"cost_usd":0.57,"findings_count":{"CRITICAL":1,"ERROR":2,"WARN":1,"INFO":0},"suggestions":0,"timestamp":"2026-03-19T14:32:00Z","session_id":"abc123"}
```

**Rotation:** AgentBoot does not implement log rotation in V1. Organizations should configure external rotation (logrotate, or periodic archival). The `agentboot metrics` command reads all NDJSON files matching the configured pattern.

### 8.4 `agentboot metrics` Aggregation Algorithm

```
function aggregateMetrics(events, filters):
  // Apply filters
  filtered = events
    .filter(e => e.event === "persona_invocation" && e.status === "completed")
    .filter(e => !filters.persona || e.persona_id === filters.persona)
    .filter(e => !filters.team || e.scope.includes(filters.team))
    .filter(e => !filters.period || isWithinPeriod(e.timestamp, filters.period))

  // Group by persona
  byPersona = groupBy(filtered, "persona_id")

  // Compute aggregates per persona
  for [personaId, events] in byPersona:
    yield {
      persona_id: personaId,
      invocation_count: events.length,
      avg_input_tokens: mean(events.map(e => e.input_tokens)),
      avg_output_tokens: mean(events.map(e => e.output_tokens)),
      avg_cost_usd: mean(events.map(e => e.cost_usd)),
      total_cost_usd: sum(events.map(e => e.cost_usd)),
      avg_duration_ms: mean(events.map(e => e.duration_ms)),
      avg_tool_calls: mean(events.map(e => e.tool_calls)),
      findings_distribution: {
        CRITICAL: sum(events.map(e => e.findings_count?.CRITICAL || 0)),
        ERROR: sum(events.map(e => e.findings_count?.ERROR || 0)),
        WARN: sum(events.map(e => e.findings_count?.WARN || 0)),
        INFO: sum(events.map(e => e.findings_count?.INFO || 0))
      },
      model_distribution: countBy(events, "model"),
      period: { start: min(timestamps), end: max(timestamps) }
    }
```

---

## 9. Plugin and Marketplace Specification

### 9.1 Plugin Structure

The `agentboot export --format plugin` command produces a directory compatible with the plugin system.

**Plugin directory layout:**

```
dist/plugin/
  .claude-plugin/
    plugin.json                  # Plugin manifest
  agents/
    code-reviewer/
      CLAUDE.md                  # Agent definition with frontmatter
    security-reviewer/
      CLAUDE.md
  skills/
    review-code/
      SKILL.md                   # Skill with context: fork
    review-security/
      SKILL.md
  hooks/
    hooks.json                   # Hook definitions
  rules/
    gotchas-postgres.md          # Path-scoped rules
  traits/
    critical-thinking.md         # Shared traits
```

**plugin.json schema:**

```json
{
  "name": "{org}@{org}-personas",
  "version": "1.2.0",
  "description": "Agentic personas for {org}",
  "author": "{org}",
  "license": "Apache-2.0",
  "agentboot_version": "0.1.0",
  "personas": [
    {
      "id": "code-reviewer",
      "name": "Code Reviewer",
      "description": "Reviews code changes for quality, consistency, and bugs",
      "model": "sonnet",
      "agent_path": "agents/code-reviewer/CLAUDE.md",
      "skill_path": "skills/review-code/SKILL.md"
    }
  ],
  "traits": [
    {
      "id": "critical-thinking",
      "path": "traits/critical-thinking.md"
    }
  ]
}
```

### 9.2 marketplace.json Format

The marketplace index file lives in the marketplace repository root.

```json
{
  "$schema": "https://agentboot.dev/schema/marketplace/v1",
  "name": "{org}-personas",
  "description": "Agentic personas marketplace for {org}",
  "maintainer": "{org}",
  "url": "https://github.com/{org}/{org}-personas",
  "entries": [
    {
      "type": "plugin",
      "name": "{org}@{org}-personas",
      "version": "1.2.0",
      "description": "Full persona suite for {org}",
      "published_at": "2026-03-19T14:30:00Z",
      "sha256": "abc123...",
      "path": "releases/v1.2.0/"
    },
    {
      "type": "trait",
      "name": "critical-thinking",
      "version": "1.0.0",
      "description": "Apply systematic skepticism to every claim and finding",
      "published_at": "2026-03-15T10:00:00Z",
      "path": "traits/critical-thinking/"
    },
    {
      "type": "domain",
      "name": "healthcare",
      "version": "1.0.0",
      "description": "HIPAA compliance domain layer",
      "published_at": "2026-03-10T08:00:00Z",
      "path": "domains/healthcare/"
    }
  ]
}
```

### 9.3 How `agentboot publish` Works

1. Read compiled plugin output from `dist/plugin/`
2. Validate plugin structure (plugin.json exists, all referenced files exist)
3. If `--bump` specified, increment version in `plugin.json` and `package.json`
4. Copy plugin directory to marketplace repository at `releases/v{version}/`
5. Compute SHA-256 hash of the release directory
6. Add or update entry in `marketplace.json`
7. Git commit: `chore: publish {plugin-name} v{version}`
8. Git push

### 9.4 How `agentboot search` Works

1. Fetch `marketplace.json` from configured marketplace URL(s)
2. Cache locally at `~/.agentboot/cache/marketplace-{hash}.json` (TTL: 1 hour)
3. Search entries by:
   - Full-text match on `name` and `description`
   - Filter by `type` if `--type` specified
4. Rank results by relevance (name match > description match)
5. Display results with install command for each

**Default marketplace registries:**
- Public AgentBoot marketplace: `https://github.com/agentboot/marketplace` (when available)
- Org marketplace: from `agentboot.config.json` or `connect` config

---

## 10. Knowledge Server Specification (MCP)

### 10.1 MCP Tool Definitions

AgentBoot exposes knowledge as MCP tools. The tool interface stays stable across all three knowledge stages.

**Tool: `agentboot_kb_search`**

| Property | Value |
|----------|-------|
| Name | `agentboot_kb_search` |
| Description | Search organizational knowledge base for relevant rules, gotchas, patterns, and domain knowledge |
| Input schema | `{ "query": string, "type?": "gotcha" | "trait" | "adr" | "pattern" | "all", "limit?": integer }` |
| Output | Array of `{ id, type, title, content, relevance_score, paths, tags }` |

**Tool: `agentboot_kb_get`**

| Property | Value |
|----------|-------|
| Name | `agentboot_kb_get` |
| Description | Get a specific knowledge item by ID |
| Input schema | `{ "id": string }` |
| Output | `{ id, type, title, content, metadata, related_ids }` |

**Tool: `agentboot_kb_list`**

| Property | Value |
|----------|-------|
| Name | `agentboot_kb_list` |
| Description | List knowledge items by category or tag |
| Input schema | `{ "type?": string, "tag?": string, "limit?": integer, "offset?": integer }` |
| Output | Array of `{ id, type, title, summary, tags }` |

**Tool: `agentboot_persona_invoke`**

| Property | Value |
|----------|-------|
| Name | `agentboot_persona_invoke` |
| Description | Invoke an AgentBoot persona against provided input |
| Input schema | `{ "persona": string, "input": string, "format?": "text" | "json" }` |
| Output | Persona output (structured findings or text) |

### 10.2 SQLite Schema (Stage 2)

Generated by `agentboot build --index`. Stores structured metadata extracted from markdown frontmatter.

```sql
-- Knowledge items (gotchas, traits, patterns, ADRs)
CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY,           -- e.g., "gotcha:postgres-rls"
  type TEXT NOT NULL,            -- "gotcha", "trait", "adr", "pattern", "instruction"
  title TEXT NOT NULL,
  content TEXT NOT NULL,          -- Full markdown content
  summary TEXT,                   -- First paragraph or description
  source_path TEXT NOT NULL,      -- Relative file path
  created_at TEXT NOT NULL,       -- ISO 8601
  updated_at TEXT NOT NULL
);

-- Tags for categorization
CREATE TABLE tags (
  item_id TEXT NOT NULL REFERENCES knowledge_items(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (item_id, tag)
);

-- Path scoping (which file patterns this item applies to)
CREATE TABLE path_scopes (
  item_id TEXT NOT NULL REFERENCES knowledge_items(id),
  glob_pattern TEXT NOT NULL,     -- e.g., "**/*.ts", "src/api/**"
  PRIMARY KEY (item_id, glob_pattern)
);

-- Related items (bidirectional links)
CREATE TABLE related_items (
  item_id TEXT NOT NULL REFERENCES knowledge_items(id),
  related_id TEXT NOT NULL REFERENCES knowledge_items(id),
  relation_type TEXT NOT NULL,    -- "supersedes", "related", "conflicts", "extends"
  PRIMARY KEY (item_id, related_id)
);

-- Full-text search index
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title,
  content,
  summary,
  content='knowledge_items',
  content_rowid='rowid'
);

-- Indexes
CREATE INDEX idx_items_type ON knowledge_items(type);
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_paths_pattern ON path_scopes(glob_pattern);
```

### 10.3 Vector Index Specification (Stage 3)

Generated by `agentboot build --embeddings`. Adds semantic search via sqlite-vss.

```sql
-- Vector embeddings for semantic search
CREATE VIRTUAL TABLE knowledge_vectors USING vss0(
  embedding(1536)                 -- Dimension matches embedding model output
);

-- Mapping between vectors and knowledge items
CREATE TABLE vector_mappings (
  vector_rowid INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES knowledge_items(id),
  chunk_index INTEGER NOT NULL DEFAULT 0,  -- For items split into chunks
  chunk_text TEXT NOT NULL
);
```

**Embedding model:** The embedding model is configurable. Default: `voyage-3` (1536 dimensions). Alternatives: any model producing fixed-dimension vectors compatible with sqlite-vss.

**Chunking strategy:**
1. Split content at heading boundaries (## or ###)
2. If a chunk exceeds 512 tokens, split at paragraph boundaries
3. Each chunk stores its own embedding
4. Search returns the parent knowledge item, not individual chunks

### 10.4 How `agentboot build --index` Works

```
function buildIndex(config):
  1. Collect all knowledge sources:
     - core/traits/*.md
     - .claude/rules/*.md (gotchas)
     - core/instructions/*.md
     - Domain layer files from extend.domains
  2. For each file:
     a. Parse frontmatter (title, paths, tags, description)
     b. Generate ID from type and filename: "{type}:{filename-without-ext}"
     c. Extract summary (first paragraph of body)
  3. Create SQLite database at .agentboot/knowledge.db
  4. Insert all items, tags, path_scopes
  5. Build FTS5 index
  6. Print: "Indexed {n} knowledge items ({gotchas} gotchas, {traits} traits, ...)"
```

### 10.5 How `agentboot build --embeddings` Works

```
function buildEmbeddings(config):
  1. Require --index to have been run (knowledge.db must exist)
  2. Load all items from knowledge_items table
  3. For each item:
     a. Chunk content (heading boundaries, max 512 tokens per chunk)
     b. Call embedding API for each chunk
     c. Store vector in knowledge_vectors table
     d. Store mapping in vector_mappings table
  4. Print: "Generated {n} embeddings for {m} knowledge items"
  5. Print estimated cost: "{tokens} tokens, ~${cost}"
```

**Cost considerations:** Embedding generation requires API calls. For a typical org (50-500 knowledge items), the one-time cost is <$1. Incremental rebuilds only process changed items.

---

## 11. Open Questions

Technical ambiguities, undefined interfaces, and implementation decisions that need resolution before or during implementation.

### 11.1 persona.config.json Does Not Exist Yet

**Status:** The `persona.config.json` file is referenced throughout the design docs and this spec but does not exist for any of the 4 current personas. This blocks trait composition.

**Decision needed:** Should the schema defined in Section 5 be the canonical schema, or are there fields missing? Specifically:
- Should `autonomy` be deferred to V2+ or included in V1 schema?
- Should `tokenBudget` be per-persona or only in the global lint config?
- How does `required: true` interact with group/team overrides exactly?

### 11.2 Weight Application Semantics

**Status:** The weight mapping (HIGH=0.7, MEDIUM=0.5, LOW=0.3) is defined, but how weights affect the compiled output is underspecified.

**Options:**
1. **Comment-based:** Emit `<!-- weight: 0.7 -->` before trait content and rely on the LLM to interpret emphasis
2. **Content modification:** Abbreviate low-weight traits (include summary only), expand high-weight traits (include full examples)
3. **Token budget allocation:** Weights determine what share of the per-persona token budget each trait gets
4. **No runtime effect:** Weights are metadata only, used for lint budget calculations

**Decision needed:** Which approach, or combination? Option 1 is simplest to implement. Option 3 is most useful for optimization.

### 11.3 Cross-Platform SKILL.md Frontmatter

**Status:** The cross-platform SKILL.md uses agentskills.io format, but the exact frontmatter schema is not fully specified. The source docs mention `name`, `description`, `version`, and `traits` in frontmatter, but it is unclear which fields are required by the agentskills.io specification vs. which are AgentBoot additions.

**Decision needed:** Define the canonical cross-platform SKILL.md frontmatter schema explicitly, distinguishing between standard agentskills.io fields and AgentBoot-specific extensions.

### 11.4 Test File Location Convention

**Status:** `prompt-optimization.md` uses `tests/security-reviewer.test.yaml` while `test-plan.md` uses `tests/behavioral/code-reviewer.test.yaml`. The canonical format in this spec uses `tests/behavioral/` subdirectory.

**Decision needed:** Confirm the directory structure:
- `tests/behavioral/*.test.yaml`
- `tests/eval/*.eval.yaml`
- `tests/snapshots/*.json`
- `tests/fixtures/` for code samples

### 11.5 Telemetry Log Location

**Status:** The telemetry NDJSON log location is mentioned as `.agentboot/telemetry.ndjson` in this spec but is not specified in any source doc. The hooks write to this file, and `agentboot metrics` reads from it.

**Decision needed:**
- Should the log be in the personas repo (`.agentboot/telemetry.ndjson`) or in each target repo?
- Should there be a user-level log at `~/.agentboot/telemetry.ndjson` for personal metrics?
- Should the path be configurable via `agentboot.config.json`?

### 11.6 `agentboot lint --fix` Scope

**Status:** The `--fix` flag is mentioned but auto-fixable rules are limited. The only clear candidates are whitespace trimming and formatting normalization.

**Decision needed:** Define exactly which rules are auto-fixable:
- `prompt-too-long`: Not fixable (requires human judgment)
- `vague-instruction`: Not fixable (requires specific replacement)
- `hardcoded-paths`: Possibly fixable (replace with relative paths)
- Formatting issues: Fixable (trailing whitespace, inconsistent heading levels)

### 11.7 CLI Argument Parser

**Status:** No CLI argument parser is installed. The `package.json` does not include `commander`, `yargs`, or any other CLI framework.

**Decision needed:** Select a CLI framework:
- **commander** -- lightweight, TypeScript-friendly, widely used
- **yargs** -- feature-rich, good subcommand support
- **clipanion** -- used by Yarn, TypeScript-first
- **citty** -- modern, lightweight, by UnJS

Recommendation: `commander` for its simplicity and ecosystem familiarity.

### 11.8 `agentboot discover` Overlap Analysis Algorithm

**Status:** The overlap analysis feature (detecting near-duplicate content across repos) is described in cli-design.md but no algorithm is specified.

**Decision needed:** How to detect near-duplicates:
- **Exact hash matching** -- finds identical content only
- **Normalized hash** -- strip whitespace, lowercase, then hash (finds formatting variants)
- **Jaccard similarity** -- compare token sets (finds paraphrased versions)
- **Embedding similarity** -- requires API call (most accurate, costs money)

Recommendation: Start with normalized hash matching (free, fast) and Jaccard similarity for V1. Add embedding-based similarity in V2.

### 11.9 repos.json Does Not Exist

**Status:** The `repos.json` file is referenced by `sync.ts` but does not exist in the repository. This blocks the sync pipeline.

**Decision needed:** Should this be created as an empty array (`[]`) as the initial scaffold, or should it be generated by `agentboot setup`?

### 11.10 Token Counting Accuracy

**Status:** The spec defines a character-based approximation (1 token ~= 4 characters) with a +/-15% accuracy claim. This may not be sufficient for strict budget enforcement.

**Decision needed:**
- Is +/-15% accuracy acceptable for lint enforcement?
- Should AgentBoot attempt to use `tiktoken` (if installed) for exact counts?
- Should the token budget thresholds account for the estimation error margin?

### 11.11 Behavioral Test Dependency on Claude Code CLI

**Status:** Behavioral tests invoke `claude -p` with specific flags. This creates a hard dependency on having Claude Code installed in the test environment.

**Decision needed:**
- Should behavioral tests be skippable when Claude Code is not installed?
- Should there be a mock mode for local development (uses fixture outputs instead of live invocations)?
- How to handle Claude Code version compatibility (flag names may change)?

### 11.12 Managed Settings Generation

**Status:** The `output.managed` flag in config generates managed settings artifacts, but the exact content of `managed-settings.json` is not fully specified.

**Decision needed:** Which fields should the managed settings include by default:
- `disableBypassPermissionsMode: "disable"` (always?)
- `allowManagedHooksOnly: true` (always for enterprise?)
- `allowManagedMcpServersOnly: true` (always?)
- `allowManagedPermissionRulesOnly: true` (always?)
- `forceLoginMethod` and `forceLoginOrgUUID` (if known)?

### 11.13 Plugin Validation

**Status:** The test plan mentions `claude plugin validate` as an integration test step, but it is unclear if this command exists in current Claude Code versions or what it validates.

**Decision needed:** If `claude plugin validate` does not exist, AgentBoot should implement its own plugin structure validation that checks:
- `plugin.json` schema validity
- All referenced file paths exist
- Agent CLAUDE.md files have valid frontmatter
- Skill SKILL.md files have valid frontmatter
- No files exceed reasonable size limits

### 11.14 GitLab API Sync Mode

**Status:** `agentboot sync --mode gitlab-api` is listed as a flag option but no GitLab API integration is specified anywhere in the source docs.

**Decision needed:** Should GitLab API mode be:
- Deferred to V2
- Implemented using the GitLab REST API directly
- Implemented via the `glab` CLI (GitLab's CLI tool)

### 11.15 MCP Server Transport and Deployment

**Status:** The CI/CD doc shows an MCP server running as a Docker container (`ghcr.io/agentboot/mcp-server:latest`), but no MCP server implementation exists and no Docker configuration is specified.

**Decision needed:**
- Should the MCP server be a standalone package or part of the main `agentboot` binary?
- Which transport type: stdio (for local use), HTTP (for CI/Docker)?
- Should it be a separate repository?

### 11.16 Scope Merging: Additive vs. Replacement Semantics

**Status:** The spec states group personas are "merged with" org-level (additive), and groups "cannot remove org-level personas." However, teams should be able to customize. The exact semantics of "team wins on conflicts for optional behaviors" vs. "org wins on mandatory behaviors" need formal definition.

**Decision needed:** Define precisely:
- What constitutes an "optional" vs. "mandatory" behavior?
- Can a team disable a group-level persona (not org-level)?
- What happens when a team sets a trait weight to 0 (false) that the group set to HIGH?
- Is the `required` field on personas/traits the sole mechanism for mandatory designation?

### 11.17 Uninstall Archive Location

**Status:** Uninstall references `.claude/.agentboot-archive/` for pre-AgentBoot originals, but it is unclear when this archive is created. The discover command is described as non-destructive, and the archive is only mentioned in the uninstall context.

**Decision needed:** When exactly is the archive created:
- During `agentboot discover --migrate` (when the user applies the migration plan)?
- During `agentboot sync` (first sync to a repo that already has .claude/ content)?
- During `agentboot setup` (when setup detects existing content)?

### 11.18 Lint Rule: `conflicting-instructions` Algorithm

**Status:** This rule detects contradictions between instructions across files, but no algorithm is specified for what constitutes a "conflict."

**Decision needed:**
- Should this use keyword-based heuristics (detect "always X" and "never X" patterns)?
- Should this use LLM-based analysis (more accurate but requires API call, not free)?
- Should this be deferred to V2 due to algorithmic complexity?

Recommendation: Start with keyword-based heuristics for V1 (detect explicit "always"/"never"/"must"/"must not" contradictions on the same topic). Add LLM-based conflict detection as an optional `--deep` flag in V2.

### 11.19 Session Transcript Access for `agentboot review`

**Status:** The `agentboot review` command needs access to recent persona output samples, but it is unclear how it accesses session transcripts. Claude Code stores transcripts at `~/.claude/projects/{project}/{sessionId}/`, but these are machine-local and may contain private data.

**Decision needed:**
- Does `agentboot review` read from local session transcripts?
- Does it read from CI artifacts (JSON output from `claude -p`)?
- Does it require a separate "review samples" collection mechanism?

### 11.20 Cost Estimation Output Token Estimates

**Status:** The `agentboot cost-estimate` command estimates output tokens "based on persona type" (reviewer ~3k, generator ~8k), but these are rough heuristics.

**Decision needed:**
- Should output token estimates be configurable per persona in `persona.config.json`?
- Should they be derived from telemetry data (actual averages from `agentboot metrics`)?
- Should the command support a `--calibrate` flag that runs a sample invocation to measure actual costs?

---

*This document is the implementation blueprint for AgentBoot. Every field, flag, algorithm, and schema defined here should be implemented as specified. Where ambiguity exists, the Open Questions section identifies it explicitly. Resolve open questions before implementing the affected subsystem.*
