---
sidebar_label: "Org Connection"
sidebar_position: 2
---

# How Developers Get Their Org's AgentBoot

The gap: AgentBoot (generic framework) and Acme-AgentBoot (org's custom rules, personas,
domain knowledge) are two different things. A developer who installs "agentboot" gets
the framework. How do they get their company's customizations?

---

## The Two Layers

```
┌─────────────────────────────────────────────────┐
│  Layer 2: Org Customizations                    │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Custom       │ │ Domain   │ │ Org-specific │ │
│  │ personas     │ │ gotchas  │ │ traits       │ │
│  │ (HIPAA       │ │ (Postgres│ │ (coding      │ │
│  │  reviewer)   │ │  RLS,    │ │  standards,  │ │
│  │              │ │  Lambda) │ │  brand voice)│ │
│  └─────────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ Hooks    │ │ Managed      │ │ MCP servers │ │
│  │ (PHI     │ │ settings     │ │ (knowledge  │ │
│  │  scan)   │ │ (permissions)│ │  base)      │ │
│  └──────────┘ └──────────────┘ └─────────────┘ │
├─────────────────────────────────────────────────┤
│  Layer 1: AgentBoot Core                        │
│  ┌───────────┐ ┌────────────┐ ┌──────────────┐ │
│  │ code-     │ │ security-  │ │ test-        │ │
│  │ reviewer  │ │ reviewer   │ │ generator    │ │
│  └───────────┘ └────────────┘ └──────────────┘ │
│  ┌───────────────────────────────────────────┐  │
│  │ Core traits: critical-thinking,           │  │
│  │ structured-output, source-citation, etc.  │  │
│  └───────────────────────────────────────────┘  │
│  ┌──────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Build    │ │ Validate   │ │ Sync         │  │
│  │ system   │ │ system     │ │ system       │  │
│  └──────────┘ └────────────┘ └──────────────┘  │
└─────────────────────────────────────────────────┘
```

The developer needs both layers. The question is: how do they arrive?

---

## Five Connection Models

### Model A: Single Org Plugin (Recommended)

The org's platform team uses AgentBoot (the build tool) to produce a **single,
self-contained plugin** that includes core + org customizations, already composed.
The developer only installs one thing.

**Platform team workflow:**
```bash
# One-time install
agentboot install --hub --org acme-corp
# Edit agentboot.config.json, add custom personas, traits, hooks, domain layers
agentboot build
agentboot export --format plugin --name acme
# Publish to private marketplace
agentboot publish --marketplace acme-corp/acme-personas
```

**Developer workflow:**
```bash
# One-time (or IT force-enables via managed settings)
/plugin marketplace add acme-corp/acme-personas
/plugin install acme

# That's it. They now have:
# - Core personas (code-reviewer, security-reviewer, etc.)
# - Org personas (hipaa-reviewer, compliance-checker, etc.)
# - Org traits (acme-standards, phi-awareness, etc.)
# - Compliance hooks (PHI scanning, credential blocking)
# - Domain gotchas rules
# - MCP servers (knowledge base)
# All namespaced: /acme:review-code, /acme:review-security
```

### Plugin Naming Strategy

The plugin `name` in plugin.json IS the namespace prefix for all skills. Keep it short:

| Plugin Name | Skill Invocation | Verdict |
|---|---|---|
| `"acme"` | `/acme:review-code` | Too long |
| `"acme"` | `/acme:review-code` | Good — org identity, short |
| `"ab"` | `/ab:review-code` | Fine for internal use |

For a private marketplace with a single org plugin, use the shortest recognizable
name. There's no collision risk in a private context. The `name` field accepts any
kebab-case string — it doesn't have to match the repo name, directory name, or
marketplace name.

**How the connection happens:**
- Managed settings force-enable: developer does nothing, it just appears
- Onboarding doc says "run this command": `/plugin marketplace add acme-corp/acme-personas`
- Repo README mentions it
- Tech lead tells them in standup

**Pros:**
- Simplest developer experience (one install, everything works)
- Core and org customizations are pre-composed (no assembly)
- Version-controlled as a unit
- IT can force-enable via managed settings
- Namespace prevents conflicts with anything else

**Cons:**
- Org doesn't get core updates automatically (must rebuild when AgentBoot core updates)
- Larger plugin (includes core + org)

### Private Marketplace Hosting

A marketplace is **just a Git repo** — not an artifact server like Maven/Nexus. No
special infrastructure required.

**Monorepo approach** (plugins in the same repo as marketplace.json):
```
acme-personas/                           # Private GitHub/GitLab/Bitbucket repo
├── .claude-plugin/
│   └── marketplace.json                 # Plugin catalog
└── plugins/
    └── acme/                            # The org plugin
        ├── .claude-plugin/
        │   └── plugin.json              # name: "acme"
        ├── agents/
        ├── skills/
        ├── hooks/
        └── .mcp.json
```

```json
// .claude-plugin/marketplace.json
{
  "name": "acme-personas",
  "owner": { "name": "Acme Platform Team" },
  "plugins": [
    {
      "name": "acme",
      "source": "./plugins/acme",
      "description": "Acme engineering personas and compliance",
      "version": "1.0.0"
    }
  ]
}
```

**Multi-repo approach** (plugins in separate repos):
```json
{
  "name": "acme-personas",
  "plugins": [
    {
      "name": "acme",
      "source": { "source": "github", "repo": "acme-corp/acme-plugin", "ref": "v1.0.0" }
    },
    {
      "name": "acme-data",
      "source": { "source": "npm", "package": "@acme/data-plugin", "version": "^2.0.0" }
    }
  ]
}
```

Plugin sources can be: relative paths, GitHub repos, any git URL (GitLab, Bitbucket,
self-hosted), npm packages (including private registries), or pip packages.

**Authentication:** Uses existing git credentials. If `git clone` works for the private
repo in your terminal, it works in Claude Code. For background auto-updates, set
`GITHUB_TOKEN` / `GITLAB_TOKEN` / `BITBUCKET_TOKEN` in the environment.

**IT force-install** (no developer action):
```json
// managed-settings.json (deployed via MDM)
{
  "extraKnownMarketplaces": {
    "acme-personas": {
      "source": { "source": "github", "repo": "acme-corp/acme-personas" }
    }
  },
  "enabledPlugins": {
    "acme@acme-personas": true
  }
}
```

**Lockdown** (prevent developers from adding unauthorized marketplaces):
```json
{
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "acme-corp/acme-personas" }
  ]
}
```

**Mitigation for core updates:**
```bash
# In the personas repo CI
agentboot upgrade     # Pull latest core traits/personas
agentboot build       # Rebuild with org customizations
agentboot publish     # Push to marketplace
# Developers get updates via /reload-plugins or next session
```

---

### Model B: Two-Layer Plugin (Core + Org Extension)

Developer installs the generic AgentBoot plugin from the public marketplace, then
installs the org plugin on top. The org plugin extends core, doesn't replace it.

**Developer workflow:**
```bash
/plugin marketplace add agentboot/agentboot-marketplace
/plugin install agentboot                          # Core personas

/plugin marketplace add acme-corp/acme-personas
/plugin install acme                     # Org extensions
```

**How they compose:**
- Core plugin provides: `/agentboot:review-code`, `/agentboot:review-security`
- Org plugin provides: `/acme:review-hipaa`, `/acme:sme-compliance`
- Org plugin can also add hooks, rules, and MCP servers that layer on top

**Pros:**
- Core updates flow independently (AgentBoot publishes, devs get it)
- Org plugin is smaller (only customizations)
- Clear separation of concerns

**Cons:**
- Two installs (confusing for willing adopters)
- Two namespaces (`/agentboot:X` and `/acme:Y`)
- No way for org plugin to modify core persona behavior (can only add new personas)
- Plugin-to-plugin composition isn't a native CC feature

**Verdict:** Cleaner architecture but worse developer experience. **Not recommended**
unless CC adds plugin dependency/extension mechanisms.

---

### Model C: Repo Already Has It (Sync-Based)

The org's sync pipeline writes `.claude/` into every target repo. When a developer
clones the repo, the personas are already there. No plugin install needed.

**Developer workflow:**
```bash
git clone git@github.com:acme-corp/my-service.git
cd my-service
claude
# .claude/ is already populated with agents, skills, rules, hooks, traits
# /review-code just works (no namespace prefix)
```

**How it gets there:**
```bash
# In the personas repo CI (runs on merge to main)
agentboot build
agentboot sync --mode github-api
# Creates PRs in every target repo updating .claude/
# Team champion merges the PR
```

**Pros:**
- **Zero developer install** — clone and go
- No plugin system dependency
- No namespace prefix (`/review-code` not `/acme:review-code`)
- Works for any tool that reads `.claude/` (not just CC plugins)
- Files are in the repo, visible, inspectable

**Cons:**
- Adds files to every repo (`.claude/` directory)
- Sync PRs create merge noise
- Files can drift if someone edits them in the target repo
- No automatic updates (requires re-sync + merge)
- Scales to dozens of repos; gets painful at hundreds

**Verdict:** Best **zero-friction developer experience**. The developer never installs
anything — the governance is in the repo they're already working in. This should be the
**default for existing repos**.

---

### Model D: Managed Settings Push (IT-Driven)

IT deploys configuration to developer machines via MDM or Anthropic's server-managed
settings. The developer does nothing.

**What gets pushed:**
```
/Library/Application Support/ClaudeCode/
├── managed-settings.json
│   {
│     "enabledPlugins": { "acme@acme-personas": true },
│     "extraKnownMarketplaces": ["https://github.com/acme-corp/acme-personas"],
│     "hooks": { /* compliance hooks */ },
│     "permissions": { "deny": ["Bash(rm -rf *)"] },
│     "allowManagedHooksOnly": true
│   }
├── managed-mcp.json
│   { "mcpServers": { "acme-kb": { ... } } }
└── CLAUDE.md
    ## Acme Corp Development Standards
    @acme-standards.md
```

**Developer experience:**
```bash
claude
# Plugin auto-installed, hooks active, MCP servers connected
# Developer didn't do anything — IT handled it
```

**Pros:**
- Zero developer action (not even "run this command")
- Strongest enforcement (OS-level, can't be overridden)
- Perfect for compliance-first orgs
- Skeptics get governed without opting in

**Cons:**
- Requires MDM infrastructure (Jamf, Intune, etc.)
- Or requires Anthropic Team/Enterprise plan for server-managed
- Blunt instrument (same config for every repo on machine)
- Doesn't help with repo-specific personas (use sync for those)

**Verdict:** Use for **HARD guardrails and plugin force-enable** only. Compliance hooks,
credential blocking, and forcing the org plugin to install. Don't use for persona
delivery — that's what the plugin and sync are for.

---

### Model E: Self-Service Install

The developer has AgentBoot installed (generic or org plugin) and runs `agentboot install`
to connect to their org.

**Developer workflow:**
```bash
# Has generic agentboot installed
/agentboot:connect

# Interactive:
# > What organization are you with?
# > acme-corp
# > Found: acme-corp/acme-personas marketplace
# > Installing acme plugin...
# > Connected! You now have 12 personas, 8 traits, 3 compliance hooks.
# > Run /acme:review-code to try a code review.
```

**How it works under the hood:**
1. Skill asks for org name (or reads from git remote, or env var)
2. Looks up org's marketplace (registry of known org marketplaces, or convention-based URL)
3. Adds marketplace and installs org plugin
4. Optionally configures local settings

**Pros:**
- Self-service (no IT ticket, no Slack message)
- Discoverable (the skill guides you)
- Works for contractors/new hires who aren't in MDM yet
- Could auto-detect org from git remote (`git@github.com:acme-corp/...` → `acme-corp`)

**Cons:**
- Requires the generic agentboot plugin first (chicken-and-egg)
- Auto-detection from git remote is fragile
- Discovery registry adds complexity

**Verdict:** Nice **onboarding UX** but not the primary connection method. Good as a
fallback for developers who aren't covered by MDM or repo sync.

---

## Recommended: Three-Path Strategy

Different paths for different situations. All three can coexist.

```
New developer joins Acme Corp
         │
         ├── Path 1: IT already pushed managed settings (MDM)
         │   └── Plugin auto-installed, hooks active. Done.
         │
         ├── Path 2: Developer clones an Acme repo
         │   └── .claude/ already has personas from sync. Done.
         │
         └── Path 3: Developer working on new/unsynced repo
             └── /acme:connect or manual plugin install
```

### Path 1: Managed Settings (Compliance + Plugin Auto-Install)

**Who:** Every developer on a managed machine.
**What gets pushed:** Force-enabled org plugin + HARD guardrail hooks.
**Result:** Developer opens Claude Code → plugin is there → compliance hooks active.

### Path 2: Repo Sync (Repo-Specific Personas)

**Who:** Every developer who clones an org repo.
**What's in the repo:** `.claude/` with compiled agents, skills, rules, traits.
**Result:** Developer clones → `claude` → personas work immediately.

### Path 3: Self-Service (Catch-All)

**Who:** Contractors, new hires before MDM, developers on new repos.
**What they do:** `/agentboot:connect acme-corp` or manual marketplace add.
**Result:** Plugin installed, ready to go.

### How They Layer

```
Managed Settings (HARD guardrails, forced plugin)
  └── Org Plugin (personas, traits, org-wide hooks, MCP servers)
       └── Repo .claude/ (repo-specific rules, path-scoped gotchas)
            └── User preferences (~/.claude/CLAUDE.md, personal rules)
```

All four layers compose. A developer on a managed machine, working in a synced repo,
with the org plugin installed, gets the union of all layers. Nothing conflicts because
the scope hierarchy handles precedence.

---

## Non-Claude Code Org Connection

The five connection models above are CC-centric. For orgs using Copilot, Cursor, or
mixed toolchains, the connection is simpler — but also less capable.

### Copilot Orgs

**How developers get org customizations:**

The **only** delivery path is repo sync. There is no plugin marketplace, no managed
settings, no force-enable. The platform team runs `agentboot sync` and the
generated files land in the repo:

```
.github/
├── copilot-instructions.md      # Always-on instructions (org + team layers)
├── prompts/
│   ├── review-code.prompt.md    # /review-code slash command
│   ├── review-security.prompt.md
│   └── gen-tests.prompt.md
└── instructions/
    ├── database.instructions.md  # Path-scoped (glob frontmatter)
    └── lambda.instructions.md
skills/
├── code-reviewer/SKILL.md       # Agent Skills (CLI agent mode)
└── security-reviewer/SKILL.md
```

Developers clone the repo → open VS Code → Copilot reads the instructions and prompts
automatically. No install step.

**Org-level custom instructions:** Copilot Enterprise supports org-wide custom
instructions configured in GitHub org settings. AgentBoot's org-scope always-on
instructions map here, but must be copy-pasted into the GitHub admin UI (no API
sync for this yet).

**What's missing vs. CC:**
- No plugin system → no private marketplace, no force-enable, no version management
- No hooks → compliance is advisory only (instruction-based refusal)
- No managed settings → no HARD guardrails
- No self-service connect → developer gets what's in the repo, period

### Cursor Orgs

**How developers get org customizations:**

Also repo sync only:

```
.cursor/
└── rules/
    ├── org-standards.md          # Always-on
    ├── gotchas-database.md       # Path-scoped (with globs)
    └── gotchas-lambda.md
.cursorrules                       # Legacy single-file (flattened org instructions)
skills/
├── code-reviewer/SKILL.md
└── security-reviewer/SKILL.md
```

**What's missing vs. CC:**
- No plugin system, no hooks, no managed settings, no org-level config
- Basically instruction files in the repo — that's the entire governance surface

### Mixed-Toolchain Orgs

When an org has CC, Copilot, AND Cursor users:

```
agentboot sync
  │
  ├── CC repos:      .claude/ (full native — agents, skills, rules, hooks, MCP)
  ├── Copilot repos: .github/ (instructions, prompts, skills)
  ├── Cursor repos:  .cursor/ (rules, skills)
  └── All repos:     skills/  (agentskills.io — cross-platform)
```

The repo's `platform` field in `repos.json` determines which format it receives.
The MCP server is the equalizer — it works in all three platforms and provides the
same persona invocation regardless of which tool the developer uses.

**The governance gap:** CC repos get hooks, managed settings, and plugin force-enable.
Copilot and Cursor repos get instructions and prompt files — advisory only. There is
no way to enforce HARD guardrails on non-CC platforms today. AgentBoot should be
transparent about this gap rather than overpromising. The compliance story for non-CC
is: instruction-based refusal + CI-based review (PR bots) + organizational policy.

---

## What AgentBoot Needs to Build

| Component | Purpose | Phase |
|-----------|---------|-------|
| `agentboot export --format plugin` | Generate CC plugin from personas repo | V1 |
| `agentboot publish` | Push plugin to private marketplace | V1 |
| Private marketplace template | Scaffold a marketplace.json repo for the org | V1 |
| `/agentboot:connect` skill | Self-service org connection | V1.5 |
| Managed settings generator | Generate managed-settings.json for IT deployment | V1.5 |
| `agentboot upgrade` | Pull latest core into org's personas repo | V1 |
| Org detection (git remote) | Auto-detect org from repo context | V2 |
| Plugin update notification | Notify developers when org plugin updates | V2 |

---

## The Full Picture

```
Org Platform Team                    Individual Developer
─────────────────                    ────────────────────

agentboot.config.json ──┐
custom personas ────────┤
domain layers ──────────┤
gotchas rules ──────────┤
compliance hooks ───────┘
        │
  agentboot build
        │
  agentboot export
        │
   ┌────┴────────────────┐
   │                     │
   ▼                     ▼
Plugin                 .claude/
(marketplace)          (sync to repos)
   │                     │
   │    ┌────────────┐   │
   └───►│ Developer  │◄──┘
        │            │
        │ Also gets: │
        │ - managed  │◄── IT pushes via MDM
        │   settings │
        │ - personal │◄── ~/.claude/CLAUDE.md
        │   prefs    │
        └────────────┘
```

The developer never runs `agentboot`. They either:
1. Get the plugin automatically (managed settings)
2. Get .claude/ by cloning a repo (sync)
3. Install the plugin manually (self-service)
4. Some combination of all three

AgentBoot is invisible to the end developer. They see personas, skills, and hooks —
not a framework.
