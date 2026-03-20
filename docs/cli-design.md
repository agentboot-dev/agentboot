# AgentBoot CLI Design

A standalone CLI tool distributed via native package managers. The primary entry point
for anyone touching AgentBoot — from a developer running `agentboot setup` on their
first day to a platform team running `agentboot build` in CI.

---

## Distribution

### Package Managers (Primary)

```bash
# macOS
brew install agentboot

# Linux (Debian/Ubuntu)
sudo apt install agentboot

# Linux (RHEL/Fedora)
sudo dnf install agentboot

# Windows
choco install agentboot
# or
winget install agentboot

# Fallback (requires Node.js)
npx agentboot
```

### Why Not npm-Only

| npm/npx | Native package manager |
|---------|----------------------|
| Requires Node.js 18+ | No runtime dependency |
| `npx` cold start is slow | Binary starts instantly |
| npm is foreign to non-Node devs | brew/apt/choco is universal |
| Version management via npm | Version management via brew/apt |
| Works in CI with Node.js | Works in any CI |

The CLI should be a compiled binary (Go or Rust) with **zero runtime dependencies**.
npx remains as a fallback for environments where package managers aren't available
or for CI pipelines that already have Node.js.

### Implementation Options

| Language | Pros | Cons |
|----------|------|------|
| **Go** | Single binary, fast compile, good CLI libs (cobra, bubbletea), cross-compile trivial | Not the project's current language (TypeScript) |
| **Rust** | Single binary, fastest, excellent CLI libs (clap, ratatui) | Steeper learning curve, slower compile |
| **TypeScript + pkg/bun** | Same language as build scripts, reuse existing code | Bundled binary is large (~50MB), slower startup |
| **TypeScript + native installer** | Same language, npm publish + brew tap + apt repo | Multiple distribution channels to maintain |

**Recommendation:** Start with TypeScript (reuse existing compile/validate/sync code)
distributed via npm + brew tap. Migrate to Go if binary size or startup time becomes
a problem. The CLI commands are I/O-bound (file reads, git operations, API calls),
not CPU-bound, so language performance doesn't matter much.

### Brew Tap

```bash
# Users install with:
brew tap agentboot/tap
brew install agentboot

# Or single command:
brew install agentboot/tap/agentboot
```

The tap is a GitHub repo (`agentboot/homebrew-tap`) with a formula that downloads
the pre-built binary from GitHub Releases.

---

## Commands

### `agentboot setup` — Interactive Onboarding Wizard

The main entry point. Asks questions, determines the right delivery method, and
executes the setup.

```
$ agentboot setup

  Welcome to AgentBoot — AI persona governance for engineering teams.

  I'll ask a few questions to set up the right configuration for your situation.

  ─────────────────────────────────────────────────

  What's your role?
  ❯ Developer (I write code and want AI personas in my workflow)
    Platform / DevEx team (I manage tooling for other developers)
    IT / Security (I manage compliance and device policies)
    Just exploring (I want to try AgentBoot on a personal project)

```

#### Question Flow

```
Q1: What's your role?
├── Developer → Q2
├── Platform team → Q5
├── IT / Security → Q8
└── Exploring → Quick Start (solo setup, skip org questions)

Q2: What AI coding tool do you use?
├── Claude Code → Q3
├── GitHub Copilot → Q3
├── Cursor → Q3
├── Multiple / mixed → Q3
└── None yet → recommend Claude Code, then Q3

Q3: Does your organization already have an AgentBoot setup?
├── Yes → Q4
├── No → "You'll need a platform team to set this up. Want to do a solo trial instead?"
├── I don't know → detect from git remote, check for .claude/, check for known marketplaces
└── I'm solo / no org → Quick Start

Q4: How do you connect to your org's setup?
    [Auto-detect: check managed settings, check .claude/ in current repo,
     check git remote against known marketplace patterns]
├── Found managed plugin → "You're already connected! Plugin {name} is active."
├── Found .claude/ in repo → "Your repo already has personas. Try /review-code."
├── Found org marketplace → "/plugin marketplace add {org}/{repo} — install now? [Y/n]"
└── Nothing found → "Ask your platform team for the marketplace URL, or paste it here: ___"

Q5: How many developers will use this?
├── Just me → Quick Start with org persona repo scaffold
├── Small team (2-20) → Standard Setup
├── Department (20-100) → Standard Setup + marketplace recommendation
└── Enterprise (100+) → Enterprise Setup (MDM, managed settings, compliance)

Q6: What AI tools does your team use?
├── Claude Code only → CC-native setup
├── Copilot only → Copilot setup
├── Cursor only → Cursor setup
├── Mixed → Multi-platform setup
└── Deciding → recommend starting with CC, generate cross-platform output

Q6.5: (Platform/IT roles) Want me to scan for existing agentic content?
├── Yes → Run agentboot discover (see below)
├── Skip → Q7
└── I'll do it later → "Run 'agentboot discover' anytime"

Q7: Do you have compliance requirements?
├── HIPAA → add healthcare domain layer
├── SOC 2 → add compliance hooks
├── PCI DSS → add financial domain layer
├── GDPR → add privacy hooks
├── Multiple → add all applicable
├── Not sure → skip, can add later
└── None → skip

Q8: (IT role) What device management do you use?
├── Jamf → generate macOS managed settings
├── Intune → generate Windows managed settings
├── JumpCloud → generate cross-platform managed settings
├── Kandji → generate macOS managed settings
├── Other MDM → generate generic managed settings
├── No MDM → recommend server-managed settings
└── None → standard repo-based setup

→ Execute appropriate setup based on answers
```

#### Setup Outcomes

**Quick Start (solo developer):**
```
$ agentboot setup
  ...answers questions...

  Setting up AgentBoot for solo use in the current directory.

  ✓ Created .claude/agents/code-reviewer/CLAUDE.md
  ✓ Created .claude/agents/security-reviewer/CLAUDE.md
  ✓ Created .claude/skills/review-code/SKILL.md
  ✓ Created .claude/skills/review-security/SKILL.md
  ✓ Created .claude/skills/gen-tests/SKILL.md
  ✓ Created .claude/traits/critical-thinking.md
  ✓ Created .claude/traits/structured-output.md
  ✓ Created .claude/traits/source-citation.md
  ✓ Created .claude/CLAUDE.md (with @imports)

  Done! Open Claude Code and try:
    /review-code        Review your recent changes
    /review-security    Security-focused review
    /gen-tests          Generate tests for a file
```

**Standard Setup (platform team, CC-focused):**
```
  Setting up AgentBoot org personas repo.

  ✓ Created agentboot.config.json
  ✓ Created repos.json (empty — add your repos)
  ✓ Created core personas (4)
  ✓ Created core traits (6)
  ✓ Created baseline instructions

  Next steps:
  1. Edit agentboot.config.json with your org name and team structure
  2. Add repos to repos.json
  3. Run: agentboot build
  4. Run: agentboot sync
  5. Optional: agentboot export --format plugin (for marketplace distribution)
```

**Enterprise Setup (IT, MDM):**
```
  Setting up AgentBoot enterprise deployment.

  ✓ Created agentboot.config.json (enterprise template)
  ✓ Created domains/compliance/ (HIPAA hooks and rules)
  ✓ Generated dist/managed/managed-settings.json (for Jamf deployment)
  ✓ Generated dist/managed/managed-mcp.json
  ✓ Generated dist/managed/CLAUDE.md
  ✓ Created marketplace template (acme-personas/)

  Deploy managed settings:
    Upload dist/managed/ to Jamf → Configuration Profiles → Claude Code

  Publish marketplace:
    cd acme-personas && git init && git remote add origin ...
    agentboot publish

  Rollout guide: docs/rollout-playbook.md
```

---

### `agentboot build` — Compile Personas

```bash
agentboot build                        # Build all output formats
agentboot build --format claude-code   # CC-native only
agentboot build --format copilot       # Copilot only
agentboot build --format cross-platform
agentboot build --format plugin        # CC plugin
agentboot build --format all
agentboot build --validate-only        # Dry run — check for errors without writing
```

### `agentboot sync` — Distribute to Repos

```bash
agentboot sync                          # Sync to all repos in repos.json
agentboot sync --repo my-org/my-repo    # Sync to one repo
agentboot sync --dry-run                # Show what would change
agentboot sync --mode local             # Write to local filesystem paths
agentboot sync --mode github-api        # Create PRs via GitHub API
agentboot sync --mode gitlab-api        # Create MRs via GitLab API
```

### `agentboot export` — Generate Distributable Artifacts

```bash
agentboot export --format plugin        # CC plugin directory
agentboot export --format marketplace   # Marketplace repo scaffold
agentboot export --format managed       # Managed settings for MDM
agentboot export --format github-action # Reusable workflow
agentboot export --format mcp-server    # MCP server package
```

### `agentboot publish` — Push to Marketplace

```bash
agentboot publish                       # Push to configured marketplace
agentboot publish --marketplace ./path  # Specify marketplace
agentboot publish --bump patch          # Bump version before publishing
agentboot publish --bump minor
```

### `agentboot doctor` — Diagnose Issues

```bash
$ agentboot doctor

  AgentBoot Doctor
  ────────────────

  Environment:
  ✓ Claude Code installed (v1.0.45)
  ✓ Node.js 22.1.0
  ✓ git 2.44.0
  ✓ gh CLI 2.65.0

  Configuration:
  ✓ agentboot.config.json found and valid
  ✓ repos.json found (3 repos registered)
  ✗ persona.config.json missing for: code-reviewer, security-reviewer
    → Run: agentboot build --fix to generate missing configs

  Personas:
  ✓ code-reviewer: valid SKILL.md, 3 traits composed
  ✓ security-reviewer: valid SKILL.md, 4 traits composed
  ✗ test-generator: references trait 'minimal-diff' which is planned but not yet authored
    → Create core/traits/minimal-diff.md or remove from persona config

  Sync Status:
  ✓ my-org/api-service: synced (v1.2.0, 3 days ago)
  ✓ my-org/web-app: synced (v1.2.0, 3 days ago)
  ✗ my-org/mobile-app: never synced
    → Run: agentboot sync --repo my-org/mobile-app

  Plugin:
  ✗ No plugin generated yet
    → Run: agentboot export --format plugin

  Managed Settings:
  ✗ Not generated
    → Run: agentboot export --format managed (if using MDM)
```

### `agentboot status` — What's Deployed Where

```bash
$ agentboot status

  Org: acme-corp (v1.2.0)
  ─────────────────────────

  Personas: 6 enabled
    code-reviewer       security-reviewer    test-generator
    test-data-expert    architecture-reviewer cost-reviewer

  Traits: 8 enabled
    critical-thinking   structured-output    source-citation
    confidence-signaling audit-trail         schema-awareness
    creative-suggestion  cost-awareness

  Repos: 12 registered
    Platform (CC):   api-service, auth-service, gateway    [synced v1.2.0]
    Product (CC):    web-app, mobile-api                   [synced v1.2.0]
    Data (Copilot):  ml-pipeline, data-lake                [synced v1.2.0]
    Frontend (Cursor): design-system, marketing-site       [synced v1.1.0 ⚠️ outdated]

  Plugin: acme@acme-personas (v1.2.0)
    Marketplace: github.com/acme-corp/acme-personas
    Last published: 2 days ago

  Managed Settings: generated (v1.2.0)
    Deploy target: Jamf (macOS)
    Last deployed: manual (check MDM console)
```

### `agentboot discover` — Scan for Existing Agentic Infrastructure

Scans the org's repos, machines, and configuration for existing AI agent content —
CLAUDE.md files, Copilot instructions, Cursor rules, MCP servers, hooks, skills,
agents, and anything else that represents agentic maturity the org already has.

This is the "bring me everything you have" command, except the org doesn't have to
remember what they have. AgentBoot finds it.

```bash
# Scan current repo
agentboot discover

# Scan a directory of repos (e.g., ~/work/ with 30 repos)
agentboot discover --path ~/work/

# Scan specific repos
agentboot discover --repos org/api-service org/web-app org/mobile-api

# Scan via GitHub API (all repos in an org)
agentboot discover --github-org acme-corp

# Scan this machine's user-level config
agentboot discover --local

# Full scan: repos + local + managed settings
agentboot discover --all

# Output as JSON for processing
agentboot discover --format json > discovery-report.json
```

**What it scans for:**

```
$ agentboot discover --path ~/work/ --local

  AgentBoot Discovery Scan
  ────────────────────────

  Scanning 28 repos in ~/work/...
  Scanning local config ~/.claude/...
  Scanning managed settings...

  ═══════════════════════════════════════════════════

  CLAUDE CODE INFRASTRUCTURE
  ──────────────────────────

  CLAUDE.md files found: 23 (across 18 repos)
  ├── Root-level CLAUDE.md:          18 repos
  ├── .claude/CLAUDE.md:              5 repos
  ├── Subdirectory CLAUDE.md:        12 files (in 6 repos)
  │   └── src/api/CLAUDE.md, src/auth/CLAUDE.md, etc.
  ├── Total lines (all files):    4,200
  ├── Average per repo:             233 lines ⚠️ (recommended: <200)
  └── Longest: web-app/CLAUDE.md    812 lines ⚠️

  Custom agents: 7 (across 4 repos)
  ├── api-service/.claude/agents/db-reviewer.md
  ├── api-service/.claude/agents/api-linter.md
  ├── web-app/.claude/agents/react-reviewer.md
  ├── web-app/.claude/agents/a11y-checker.md
  ├── auth-service/.claude/agents/security-scan.md
  ├── ml-pipeline/.claude/agents/data-validator.md
  └── ml-pipeline/.claude/agents/notebook-reviewer.md

  Skills: 4 (across 3 repos)
  ├── api-service/.claude/skills/gen-api-tests/SKILL.md
  ├── web-app/.claude/skills/gen-component/SKILL.md
  ├── web-app/.claude/skills/review-css/SKILL.md
  └── shared-lib/.claude/skills/check-types/SKILL.md

  Rules: 9 (across 5 repos)
  ├── Always-on (no paths): 4
  └── Path-scoped: 5

  Hooks: 2 repos have hooks in settings.json
  ├── api-service: PreToolUse (1 hook), PostToolUse (1 hook)
  └── auth-service: UserPromptSubmit (1 hook — PHI scan)

  MCP servers: 3 repos have .mcp.json
  ├── api-service: postgres-mcp, redis-mcp
  ├── ml-pipeline: jupyter-mcp
  └── web-app: figma-mcp

  COPILOT INFRASTRUCTURE
  ──────────────────────

  copilot-instructions.md: 8 repos
  ├── .github/copilot-instructions.md: 8 files
  ├── Total lines: 1,400
  └── Average: 175 lines

  Prompt files (.github/prompts/): 3 repos
  ├── web-app: review-component.prompt.md, gen-story.prompt.md
  ├── api-service: review-api.prompt.md
  └── mobile-api: gen-tests.prompt.md

  CURSOR INFRASTRUCTURE
  ─────────────────────

  .cursorrules: 6 repos
  .cursor/rules/: 2 repos (4 rule files total)

  LOCAL MACHINE
  ─────────────

  ~/.claude/CLAUDE.md: exists (48 lines)
  ~/.claude/agents/: 2 personal agents
  ~/.claude/skills/: 1 personal skill
  ~/.claude/rules/: 3 personal rules

  Managed settings: /Library/Application Support/ClaudeCode/
  ├── managed-settings.json: NOT FOUND
  └── managed-mcp.json: NOT FOUND

  SUMMARY
  ───────

  Total agentic content found: 74 files across 22 repos
  ├── Claude Code:  45 files (18 repos)
  ├── Copilot:      19 files (8 repos)
  ├── Cursor:       10 files (8 repos)

  Platforms in use: Claude Code (primary), Copilot (secondary), Cursor (some)
  Maturity level: INTERMEDIATE
    (Custom agents exist but no governance structure,
     no shared traits, no centralized distribution)

  ═══════════════════════════════════════════════════

  What would you like to do?

  [1] Generate detailed report (Markdown)
  [2] Classify and ingest all content (agentboot add prompt --batch for each file)
  [3] Show overlap analysis (duplicate/similar content across repos)
  [4] Show migration plan (what becomes traits, gotchas, personas, always-on)
  [5] Export as agentboot.config.json (scaffold org structure from discovered repos)
```

**Non-destructive guarantee:**

Discovery and migration never modify, move, or delete existing files. Every action
creates NEW files in the AgentBoot personas repo. The org's existing `.claude/`,
`.cursorrules`, `copilot-instructions.md`, and custom agents stay exactly where
they are, untouched, working as they were before.

The migration plan produces a parallel structure. The org reviews it, tests it, and
only when ready, runs `agentboot sync` to deploy the governed versions alongside
(or replacing) the originals — via PR, with review, at their pace.

If something goes wrong, the originals are still there. `git revert` the sync PR
and you're back to where you started. Zero risk.

```
Before agentboot discover:
  22 repos with scattered .claude/ files ← UNTOUCHED

After agentboot discover + migrate:
  22 repos with scattered .claude/ files ← STILL UNTOUCHED
  + 1 new org personas repo with consolidated, governed content
  + agentboot sync creates PRs to replace scattered files (when YOU'RE ready)
```

**What each action does:**

**[1] Detailed report** — Full inventory as Markdown, shareable with the platform
team. Lists every file, its content summary, and suggested classification. Good for
"let me review this before we do anything."

**[2] Classify and ingest** — Runs `agentboot add prompt --batch` on each discovered
file. Classifies every instruction as trait, gotcha, persona rule, or always-on.
Deduplicates across repos. Presents the full migration plan for approval.

**[3] Overlap analysis** — Finds content that appears in multiple repos. "12 repos
have some version of 'use TypeScript strict mode'" → that's an org-wide trait, not a
per-repo instruction. "3 repos have Postgres gotchas with slightly different wording"
→ consolidate into one shared gotcha.

```
  Overlap Analysis
  ────────────────

  Near-duplicates found:

  1. "TypeScript strict mode" instruction
     Found in: 12/18 repos (67%)
     Variations: 4 different wordings
     → Recommendation: Extract as org trait "typescript-standards"

  2. "Never commit .env files" rule
     Found in: 15/18 repos (83%)
     Variations: 2 (identical in 13, slightly different in 2)
     → Recommendation: Extract as always-on instruction

  3. Postgres RLS gotchas
     Found in: 3 repos
     Variations: 3 (each has unique gotchas + shared ones)
     → Recommendation: Merge into shared gotcha "postgres-rls"
       (union of all three, deduplicated)

  4. React component review rules
     Found in: web-app, design-system
     Variations: 2 (web-app is a superset)
     → Recommendation: Extract as team-scoped trait "react-standards"

  5. Custom agents: db-reviewer, api-linter
     Found in: api-service only
     → Recommendation: Promote to org personas if other teams would benefit
```

**[4] Migration plan** — The actionable output. Shows exactly what becomes what:

```
  Migration Plan
  ──────────────

  Traits (extract from CLAUDE.md → core/traits/):
    typescript-standards.md       ← from 12 repos' CLAUDE.md (deduplicated)
    react-patterns.md             ← from web-app, design-system
    api-design-standards.md       ← from api-service, gateway

  Gotchas (extract from CLAUDE.md → .claude/rules/ with paths:):
    postgres-rls.md               ← merged from 3 repos
    lambda-coldstart.md           ← from serverless-api
    redis-clustering.md           ← from cache-service

  Personas (promote existing agents → core/personas/):
    code-reviewer                 ← based on web-app/react-reviewer + api-service/api-linter
    security-reviewer             ← based on auth-service/security-scan
    data-validator                ← from ml-pipeline (as-is)

  Always-on instructions (keep in CLAUDE.md, deduplicated):
    "Never commit .env files"
    "Use conventional commits"
    "PRs require at least one approval"
    ... (8 more)

  Per-repo instructions (stay in repo, not centralized):
    api-service: API-specific endpoint conventions
    ml-pipeline: Notebook formatting rules
    web-app: Component file structure

  Discard (too vague or outdated):
    "Write clean code" (5 repos) — too vague
    "Follow best practices" (3 repos) — not actionable
    "TODO: update this section" (2 repos) — stale

  ──────────────

  Estimated result:
    Before: 74 files, 5,600 lines, scattered across 22 repos, no governance
    After:  6 traits, 3 gotchas, 3 personas, 1 lean CLAUDE.md template
            Centralized in org personas repo, synced to all repos
            ~800 lines total (85% reduction)

  Apply this plan? [y/N]
```

**[5] Export config** — Generates `agentboot.config.json` from the discovered
repo structure:

```json
{
  "org": "acme-corp",
  "groups": {
    "backend": {
      "teams": ["api", "auth", "data"]
    },
    "frontend": {
      "teams": ["web", "mobile", "design-system"]
    },
    "platform": {
      "teams": ["infra", "ml-pipeline"]
    }
  }
}
```

Inferred from git remote patterns, directory structure, and which repos share
similar content.

**Scan targets:**

| Target | What it finds | How |
|---|---|---|
| Repo `.claude/` | CLAUDE.md, agents, skills, rules, hooks, settings, .mcp.json | File system scan |
| Repo `.github/` | copilot-instructions.md, prompts/*.prompt.md, instructions/ | File system scan |
| Repo `.cursor/` | .cursorrules, rules/ | File system scan |
| Repo root | CLAUDE.md, GEMINI.md, .mcp.json | File system scan |
| Repo subdirectories | Nested CLAUDE.md files (lazy-loaded context) | Recursive scan |
| `~/.claude/` | User-level agents, skills, rules, CLAUDE.md, settings | File system scan |
| Managed settings paths | managed-settings.json, managed-mcp.json | OS-specific paths |
| GitHub API | All repos in org, their .claude/ contents | `gh api` |
| Package.json | Scripts referencing claude, copilot, AI tools | Grep |
| Git history | Recently added .claude/ files, CLAUDE.md changes | `git log` |
| Installed CC plugins | `/plugin list` equivalent | CC config files |

### `agentboot upgrade` — Update Core

```bash
agentboot upgrade                # Pull latest AgentBoot core (traits, personas, build system)
agentboot upgrade --check        # Check for updates without applying
agentboot upgrade --version 2.0  # Upgrade to specific version
```

### `agentboot connect` — Developer Self-Service (Non-Interactive)

```bash
# For developers who know their org's marketplace
agentboot connect acme-corp                         # Auto-detect marketplace
agentboot connect --marketplace acme-corp/personas  # Explicit marketplace
agentboot connect --url https://gitlab.internal/plugins  # GitLab/self-hosted
```

This is the CLI equivalent of the `/agentboot:connect` skill. It:
1. Adds the marketplace to Claude Code
2. Installs the org plugin
3. Verifies the setup

### `agentboot add` — Add Components

```bash
agentboot add persona my-reviewer     # Scaffold a new persona
agentboot add trait my-trait           # Scaffold a new trait
agentboot add domain healthcare       # Add a domain layer template
agentboot add gotcha database         # Add a gotchas rule template
agentboot add hook compliance         # Add a compliance hook template
agentboot add repo my-org/new-repo    # Register a repo for sync

# Ingest raw prompts (classify, format, save)
agentboot add prompt "Always check null safety before DB calls"
agentboot add prompt --file ~/Downloads/tips.md
agentboot add prompt --clipboard
agentboot add prompt --url https://blog.example.com/gotchas
agentboot add prompt --file .claude/CLAUDE.md --batch    # Decompose existing CLAUDE.md
agentboot add prompt "..." --dry-run                     # Preview without writing
```

### `agentboot validate` — CI-Friendly Validation

```bash
agentboot validate                    # Validate everything
agentboot validate --personas         # Personas only
agentboot validate --traits           # Traits only
agentboot validate --config           # Config only
agentboot validate --strict           # Fail on warnings too
```

Exit code 0 = pass, 1 = errors, 2 = warnings (with --strict).

### `agentboot uninstall` — Clean Removal

If AgentBoot isn't working out, removing it should be as easy as installing it.
No orphaned files, no broken repos, no mystery config left behind. And just like
`discover`, it's non-destructive in a different sense — it gives you back what you
had before, not an empty void.

```bash
# Remove AgentBoot from a single repo
agentboot uninstall --repo my-org/api-service

# Remove from all synced repos
agentboot uninstall --all-repos

# Remove the CC plugin
agentboot uninstall --plugin

# Remove managed settings (generates removal instructions for IT)
agentboot uninstall --managed

# Full removal — everything
agentboot uninstall --everything

# Preview what would be removed
agentboot uninstall --dry-run
```

```
$ agentboot uninstall --repo my-org/api-service --dry-run

  AgentBoot Uninstall — Dry Run (my-org/api-service)
  ───────────────────────────────────────────────────

  Files that would be removed:
    .claude/agents/code-reviewer/CLAUDE.md       (synced by AgentBoot)
    .claude/agents/security-reviewer/CLAUDE.md   (synced by AgentBoot)
    .claude/skills/review-code/SKILL.md          (synced by AgentBoot)
    .claude/skills/review-security/SKILL.md      (synced by AgentBoot)
    .claude/traits/critical-thinking.md          (synced by AgentBoot)
    .claude/traits/structured-output.md          (synced by AgentBoot)
    .claude/rules/gotchas-postgres.md            (synced by AgentBoot)
    .claude/settings.json                        (AgentBoot hooks section only)
    .claude/.mcp.json                            (AgentBoot servers only)

  Files that would be KEPT (not managed by AgentBoot):
    .claude/CLAUDE.md                            (has manual edits — see below)
    .claude/rules/team-conventions.md            (authored locally, not synced)
    .claude/settings.local.json                  (personal settings)

  Requires attention:
    .claude/CLAUDE.md contains both AgentBoot-generated content AND manual edits.
    ├── Lines 1-45: AgentBoot @imports and generated content
    ├── Lines 46-78: Manually added by your team
    │
    ├── [1] Remove AgentBoot content, keep manual edits
    ├── [2] Keep entire file as-is (manual cleanup later)
    └── [3] Show me the diff

  Restore pre-AgentBoot state:
    AgentBoot discovered and archived your original files during setup.
    Archive location: .claude/.agentboot-archive/
    ├── CLAUDE.md.pre-agentboot          (original, 812 lines)
    ├── copilot-instructions.md.pre-agentboot
    │
    ├── [1] Restore originals from archive
    ├── [2] Don't restore (start fresh)
    └── [3] Show diff between original and current

  After uninstall:
    Your repo will have its original .claude/ content (or a clean state).
    No AgentBoot-managed files remain.
    The repo's git history preserves everything if you need it back.

  No files modified. Run without --dry-run to proceed.
```

**Key behaviors:**

**Tracks what it owns.** During sync, AgentBoot writes a manifest
(`.claude/.agentboot-manifest.json`) listing every file it manages. Uninstall
removes exactly those files — nothing more. Files authored locally by the team
are never touched.

```json
{
  "managed_by": "agentboot",
  "version": "1.2.0",
  "synced_at": "2026-03-19T14:30:00Z",
  "files": [
    { "path": "agents/code-reviewer/CLAUDE.md", "hash": "a3f2..." },
    { "path": "skills/review-code/SKILL.md", "hash": "7b1c..." },
    { "path": "traits/critical-thinking.md", "hash": "e4d8..." }
  ]
}
```

If a managed file was modified after sync (the hash doesn't match), uninstall
warns: "This file was synced by AgentBoot but has been modified locally. Remove
anyway? [y/N]"

**Archives originals during setup.** When `agentboot discover` + migrate first
runs, it archives the repo's original agentic files to
`.claude/.agentboot-archive/`. Uninstall can restore them. This is the "undo" for
the entire AgentBoot adoption. The org gets back exactly what they had before.

**Handles mixed content.** If CLAUDE.md has both AgentBoot-generated `@imports`
and manually authored content, uninstall separates them. It removes the AgentBoot
lines and keeps the manual ones. The developer reviews the result.

**Plugin removal.** `--plugin` runs the CC plugin uninstall:
```bash
# Equivalent to:
claude plugin uninstall acme@acme-personas
```

**Managed settings.** AgentBoot can't remove MDM-deployed files (that requires IT).
`--managed` generates instructions for the IT team:
```
  Managed settings removal requires IT action:

  macOS (Jamf):
    Remove profile: "AgentBoot Managed Settings"
    Files to remove:
      /Library/Application Support/ClaudeCode/managed-settings.json
      /Library/Application Support/ClaudeCode/managed-mcp.json
      /Library/Application Support/ClaudeCode/CLAUDE.md

  Paste these instructions into a ticket to your IT team,
  or forward this output to: [configured IT contact]
```

**The principle:** If someone asks "how do I get rid of AgentBoot?", the answer
should be one command, not a scavenger hunt. Easy exit builds trust for easy entry.
An org that knows they can cleanly remove the tool is more willing to try it.

---

## Command Summary

| Command | Who Uses It | Purpose |
|---------|-------------|---------|
| `setup` | Everyone (first time) | Interactive onboarding — determines and executes the right setup |
| `connect` | Developers | Connect to org's existing AgentBoot setup |
| `build` | Platform team, CI | Compile personas with trait composition |
| `sync` | Platform team, CI | Distribute compiled output to target repos |
| `export` | Platform team | Generate plugin, marketplace, managed settings, etc. |
| `publish` | Platform team | Push plugin to marketplace |
| `add` | Platform team | Scaffold new personas, traits, domains, gotchas |
| `add prompt` | Anyone | Ingest raw prompts — classify, format, save as proper content |
| `discover` | Platform team | Scan repos/machines for existing agentic content, generate migration plan |
| `lint` | Platform team, CI | Static prompt analysis — token budgets, vague language, conflicts, security |
| `test` | Platform team, CI | Persona testing — deterministic, behavioral, snapshot, eval, mutation |
| `validate` | CI | Pre-merge schema and config validation |
| `search` | Anyone | Search marketplace for traits, gotchas, personas, domains |
| `metrics` | Platform team | Read telemetry, report per-persona/team/period |
| `cost-estimate` | Platform team | Project per-persona costs across the org |
| `review` | Platform team | Guided human review of persona output samples |
| `issue` | Anyone | Streamlined bug reporting against AgentBoot core |
| `doctor` | Anyone | Diagnose issues (includes `--diagnose` for layered isolation) |
| `status` | Platform team | Dashboard of what's deployed where |
| `upgrade` | Platform team | Update AgentBoot core |
| `uninstall` | Platform team | Clean removal — restore pre-AgentBoot state, remove only managed files |

---

## Design Principles

### 1. One Command Gets You Started

`brew install agentboot && agentboot setup` — that's the entire onboarding. The
wizard handles everything else. No README to read, no config to write, no architecture
to understand first.

### 2. Progressive Disclosure

The `setup` wizard asks only what's needed for the user's role. A solo developer
answers 3 questions and gets files in their repo. A platform team answers 7 questions
and gets a full org scaffold. An IT admin answers 4 questions and gets managed settings.

### 3. Detect Before Asking

The wizard auto-detects as much as possible before asking:
- Git remote → org name
- `.claude/` in current repo → already set up
- Managed settings on disk → already governed
- Known marketplace patterns → org already has AgentBoot
- `claude --version` → CC installed
- Platform tools in PATH → which agents are available

### 4. Every Command Works in CI

Every command accepts `--non-interactive` (or detects non-TTY) and uses flags instead
of prompts. `agentboot build && agentboot validate --strict && agentboot sync` works
in any CI pipeline without interaction.

### 5. Errors Tell You What to Do

Every error message includes the fix command:
```
✗ persona.config.json missing for: code-reviewer
  → Run: agentboot add persona-config code-reviewer
```

Not just "what's wrong" but "how to fix it."

### 6. Easy Exit Builds Trust for Easy Entry

`agentboot uninstall` is a first-class command, not an afterthought. It tracks what
it manages, archives what it replaces, and restores what was there before. An org
that knows they can cleanly remove the tool in one command is more willing to try it.
No vendor lock-in, no orphaned files, no scavenger hunt.
