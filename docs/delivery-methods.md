---
sidebar_label: "Delivery Methods"
sidebar_position: 1
---

# AgentBoot Delivery Methods — Analysis & Recommendations

How organizations install, configure, and use AgentBoot. Evaluated through the lens
of the real adoption challenge: an org with power users, skeptics, and non-engineers.

---

## The User Spectrum

Every organization adopting agentic development has these user segments:

| Segment | Profile | What They Need | Priority |
|---------|---------|---------------|----------|
| **Power Users** | Already use Claude Code daily, have custom CLAUDE.md, write their own agents | Composable primitives, not hand-holding. Control and extensibility. | HIGH |
| **Willing Adopters** | Engineers open to AI tools but haven't gone deep | Zero-config start, immediate value, gradual depth | HIGH |
| **Skeptics / Hold-outs** | Engineers resistant to AI tools, prefer their workflow | Proof of value without disrupting their workflow. Opt-in, not forced. | MEDIUM |
| **Non-Engineers** | PMs, designers, compliance, marketing | GUI-first, no terminal, structured forms | LOW (but in scope) |
| **IT / Platform Team** | Deploy tooling, enforce compliance, manage fleet | Centralized control, MDM, audit trail, zero-touch deployment | HIGH |

AgentBoot must serve all five — but through different channels, not one monolithic
installer.

---

## Delivery Methods

### 1. Claude Code Plugin (Recommended Primary Channel)

**What it is:** AgentBoot packaged as a Claude Code plugin, installable from a
marketplace (public or private). Bundles skills, agents, hooks, rules, and MCP
servers into a single distributable unit.

**How it works:**
```bash
# User adds the AgentBoot marketplace (once)
/plugin marketplace add agentboot/agentboot-marketplace

# User installs the AgentBoot plugin
/plugin install agentboot

# Or org IT force-enables it via managed settings
```

**Plugin structure:**
```
agentboot-plugin/
├── .claude-plugin/
│   └── plugin.json              # name, version, description
├── agents/
│   ├── code-reviewer/CLAUDE.md
│   ├── security-reviewer/CLAUDE.md
│   └── test-generator/CLAUDE.md
├── skills/
│   ├── review-code/SKILL.md
│   ├── review-security/SKILL.md
│   ├── gen-tests/SKILL.md
│   └── agentboot-setup/SKILL.md  # Interactive setup wizard
├── hooks/
│   └── hooks.json               # Audit trail, compliance hooks
├── .mcp.json                    # Knowledge base, domain tools
├── .lsp.json                    # LSP servers (if any)
├── settings.json                # Default agent, permissions
└── README.md
```

**Private marketplace for orgs:**

The org creates a private marketplace repo with their customized AgentBoot config:

```json
// .claude-plugin/marketplace.json
{
  "name": "acme-personas",
  "displayName": "Acme Corp AI Personas",
  "owner": { "name": "Acme Platform Team" },
  "plugins": [
    {
      "name": "acme",
      "source": "./plugins/acme",
      "description": "Acme-customized AgentBoot with HIPAA compliance",
      "version": "1.0.0"
    }
  ]
}
```

Engineers install with:
```bash
/plugin marketplace add acme-corp/acme-personas   # private GitHub repo
/plugin install acme
```

IT force-enables via managed settings:
```json
{
  "enabledPlugins": { "acme@acme-personas": true },
  "extraKnownMarketplaces": ["https://github.com/acme-corp/acme-personas"]
}
```

**Serves:**

| Segment | How |
|---------|-----|
| Power Users | Full access to plugin internals; can fork/extend |
| Willing Adopters | One command install; `/agentboot:review-code` works immediately |
| Skeptics | IT can force-enable; value appears without opt-in effort |
| IT / Platform | Centralized marketplace; version pinning; managed settings |

**Pros:**
- Native CC distribution — no external tooling needed
- Namespace isolation (`/agentboot:review-code`) prevents conflicts
- Version-controlled via marketplace with semantic versioning
- IT can force-enable via managed settings — zero developer setup
- `/reload-plugins` picks up updates without restart
- Settings.json in plugin sets default agent, permissions
- Private marketplace supports enterprise authentication (GitHub, GitLab, Bitbucket)
- Already the standard way CC users install extensions

**Cons:**
- Claude Code only — doesn't help Copilot/Cursor users
- Plugin skills are namespaced (`/agentboot:review-code` not `/review-code`)
- Requires CC 1.0.33+ (but this is already old)
- Plugin marketplace is relatively new; some orgs may not be familiar

**Verdict:** This should be the **primary delivery method** for Claude Code users. It
maps perfectly to AgentBoot's plugin architecture (agents + skills + hooks + MCP + rules).

---

### 2. CLI Tool (`agentboot`)

**What it is:** A Node.js CLI that scaffolds, builds, and syncs persona configurations.
The current approach but needs refinement.

**How it works:**
```bash
# Bootstrap a new org personas repo
agentboot setup

# Interactive setup — asks org name, picks starter personas
agentboot setup --interactive

# Build compiled output
agentboot build

# Sync to target repos
agentboot sync

# Generate a Claude Code plugin from your config
agentboot export --format plugin

# Generate cross-platform output
agentboot export --format cross-platform
```

**Key insight:** The CLI is the **build tool**, not the delivery mechanism. It produces
artifacts (plugins, .claude/ directories, copilot-instructions.md) that are delivered
through other channels.

**Serves:**

| Segment | How |
|---------|-----|
| Power Users | Full control over build pipeline; scriptable |
| Willing Adopters | `agentboot setup` gets them started |
| IT / Platform | CI/CD integration; `agentboot build && agentboot sync` in pipeline |

**Pros:**
- `npx` means zero install — try it immediately
- Scriptable for CI/CD pipelines
- Platform-agnostic output generation
- Can generate Claude Code plugins, Copilot instructions, Cursor config
- Familiar pattern for Node.js developers

**Cons:**
- Requires Node.js (not universal)
- Terminal-only — excludes non-engineers
- Another tool to learn for engineers who just want personas

**Verdict:** Essential for the **build/admin workflow** but not the end-user experience.
Engineers interact with the plugin or .claude/ output, not the CLI directly.

---

### 3. Git Template Repository (Current Approach)

**What it is:** The current AgentBoot repo is a GitHub template. Orgs create their
private personas repo from it.

**How it works:**
```bash
gh repo create my-org/my-org-personas --template agentboot/agentboot --private --clone
cd my-org-personas
npm install
# Edit agentboot.config.json
npm run build
npm run sync
```

**Serves:**

| Segment | How |
|---------|-----|
| Power Users | Full repo control; can customize everything |
| IT / Platform | Central governance repo; version-controlled |

**Pros:**
- Full ownership of the personas repo
- Git-based governance (PRs, reviews, history)
- Works without any AgentBoot runtime dependency
- Familiar GitHub template workflow

**Cons:**
- High setup friction — clone, install, configure, build, sync
- Requires understanding of the entire system before getting value
- End developers never see or interact with this repo
- Template repos can't receive upstream updates cleanly

**Verdict:** Good for the **platform team** that manages governance. But it's the
wrong entry point for individual developers. The template repo produces the plugin
or .claude/ output that developers actually consume.

---

### 4. Managed Settings / MDM (Enterprise IT Channel)

**What it is:** Organization IT deploys AgentBoot configuration to all developer
machines via MDM (Jamf, Intune, JumpCloud, Kandji) or Anthropic's server-managed
settings.

**Two sub-channels:**

**A. Endpoint-managed (MDM):**
```
/Library/Application Support/ClaudeCode/
├── managed-settings.json    # Hooks, permissions, forced plugins
├── managed-mcp.json         # Required MCP servers
└── CLAUDE.md                # Non-overridable instructions
```
Deployed via Jamf/Intune profile. Strongest enforcement — OS-level file protection.

**B. Server-managed (no MDM required):**
Anthropic's server delivers configuration based on org membership. No endpoint
deployment needed. Configured via admin panel at platform.claude.com.

**How AgentBoot fits:**
```bash
# CLI generates managed artifacts
agentboot export --format managed-settings

# Output:
# dist/managed/managed-settings.json
# dist/managed/managed-mcp.json
# dist/managed/CLAUDE.md

# IT deploys via MDM or uploads to Anthropic admin panel
```

**Serves:**

| Segment | How |
|---------|-----|
| Skeptics | Guardrails and compliance hooks activate automatically — no opt-in |
| IT / Platform | Zero-touch deployment; strongest enforcement; audit trail |
| All Engineers | Baseline governance active on every machine |

**Pros:**
- Zero developer action required
- Strongest enforcement available (OS-level protection)
- Applies to ALL Claude Code sessions on the machine
- Cannot be overridden by any user or project config
- Server-managed option requires no MDM infrastructure
- Perfect for HARD guardrails (PHI scanning, credential blocking)

**Cons:**
- Only Claude Code (no Copilot/Cursor)
- Heavy IT involvement for endpoint-managed
- Managed settings are blunt — same config for all repos on machine
- Server-managed is newer; some features may be limited

**Verdict:** Essential for **compliance-first orgs**. AgentBoot should generate managed
artifacts as a first-class output. This is how skeptics and hold-outs get governed
without opting in.

---

### 5. MCP Server (`agentboot-mcp`)

**What it is:** AgentBoot exposed as an MCP server that any MCP-compatible agent can
consume. Provides persona invocation, trait lookup, governance status, and knowledge
base access as MCP tools and resources.

**How it works:**
```json
// .mcp.json in any repo
{
  "mcpServers": {
    "agentboot": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@agentboot/mcp-server", "--config", "./agentboot.config.json"]
    }
  }
}
```

**MCP tools exposed:**
- `agentboot_review` — invoke a reviewer persona with structured output
- `agentboot_list_personas` — list available personas for current scope
- `agentboot_get_trait` — retrieve a trait definition
- `agentboot_check_compliance` — run compliance scan on input

**MCP resources exposed:**
- `agentboot:persona://code-reviewer` — full persona definition
- `agentboot:trait://critical-thinking` — trait content
- `agentboot:knowledge://compliance/hipaa` — domain knowledge

**Serves:**

| Segment | How |
|---------|-----|
| Power Users | Programmatic access; custom integrations |
| Copilot/Cursor Users | AgentBoot personas in non-CC agents |
| IT / Platform | Centralized persona serving; usage telemetry |

**Pros:**
- Cross-platform: works in Claude Code, Copilot, Cursor, Gemini CLI, any MCP client
- Single source of truth — no sync needed; personas served live
- Usage telemetry built-in (the server sees every invocation)
- Enables the "AgentBoot as a service" model
- MCP resources enable `@agentboot:persona://code-reviewer` in prompts

**Cons:**
- Requires running process (stdio server or HTTP endpoint)
- Higher latency than static files
- More complex to deploy than a plugin
- MCP support varies by platform (GA in CC and VS Code; preview elsewhere)

**Verdict:** The **cross-platform bridge**. When an org has both Claude Code and Copilot
users, the MCP server ensures everyone gets governed personas. Also enables advanced
integrations (CI/CD persona invocation, API access).

---

### 6. Direct `.claude/` Sync (Current Approach, Simplified)

**What it is:** AgentBoot's sync script writes compiled files directly to target repos'
`.claude/` directories. No plugin, no MCP server — just files in git.

**How it works:**
```bash
agentboot sync    # Writes .claude/ to all repos in repos.json
# Or in CI:
agentboot sync --mode github-api   # Creates PRs via GitHub API
```

**Serves:**

| Segment | How |
|---------|-----|
| All Engineers | .claude/ files are there when they clone the repo; zero setup |
| IT / Platform | Governance via PR review of sync commits |
| Skeptics | Files are present whether they want them or not |

**Pros:**
- Simplest mental model — files in a directory
- Works offline (no server, no plugin install)
- Version-controlled in the target repo
- No Claude Code plugin system dependency
- Works for any tool that reads .claude/ or copilot-instructions.md

**Cons:**
- Sync creates noise in target repos (files they didn't author)
- Merge conflicts when sync and manual changes collide
- No live updates — requires re-sync for persona changes
- Files can be modified in target repo (drift from hub)

**Verdict:** The **fallback/bootstrap method**. Works everywhere but lacks the polish
of plugin-based delivery. Good for initial deployment and for repos that can't use
plugins.

---

### 7. Cowork Plugins (Non-Engineers)

**What it is:** Claude's desktop app (Cowork) has its own plugin system for
non-technical users. Cowork plugins appear in a GUI with structured forms — no
terminal required.

**How it works:**
AgentBoot personas could be packaged as Cowork plugins that expose:
- Structured forms for invoking reviews ("paste your PRD here → get review")
- Compliance checking ("upload document → check for PII")
- Knowledge base Q&A ("ask the domain expert")

Cowork plugins are the same format as Claude Code plugins but appear in the
desktop GUI with form-based input rather than slash commands.

**Serves:**

| Segment | How |
|---------|-----|
| Non-Engineers | GUI with forms; no terminal; role-specific plugins |
| Willing Adopters | Gentle on-ramp; can graduate to CLI later |

**Pros:**
- Same plugin format as Claude Code — build once, deliver to both
- Structured forms feel like filling out a brief, not writing code
- Role-specific plugins (legal review, marketing copy, compliance check)
- Enterprise org can manage Cowork plugins centrally

**Cons:**
- Cowork is Anthropic-specific (no Copilot/Cursor equivalent)
- Plugin capabilities more limited than CLI (no git, limited file access)
- Non-engineers may not need the full persona governance system
- Cowork plugin ecosystem is newer; fewer examples

**Verdict:** A **bonus channel** for orgs that want to extend persona governance beyond
engineering. Same plugin, different surface. Low priority but comes almost free if
we're already building CC plugins.

---

### 8. VS Code / JetBrains Extension Surface

**What it is:** Claude Code runs inside VS Code and JetBrains IDEs. Plugins installed
in the CLI are automatically available in the IDE extension. No separate IDE extension
needed.

**How it works:**
- Engineer installs Claude Code VS Code extension
- Plugin installed via CLI (`/plugin install agentboot`) appears in IDE
- Slash commands available in VS Code's Claude Code panel
- Skills appear in the `/` autocomplete menu

**Serves:**

| Segment | How |
|---------|-----|
| Willing Adopters | IDE-first experience; never leave VS Code |
| Skeptics | AI review appears in their existing IDE workflow |

**Pros:**
- No separate installation — CC plugins work in IDE automatically
- Familiar IDE interface
- Code context (open files, selections) available to personas

**Cons:**
- Requires Claude Code extension (not standalone)
- JetBrains support is partial (no `/` IntelliSense for slash commands)
- Not a separate delivery method — it's the CC plugin surfaced in IDE

**Verdict:** Not a separate channel; it's where the CC plugin **appears**. But worth
noting because the IDE is where most developers spend their time.

---

## Recommended Strategy

### Multi-Channel Architecture

```
                    agentboot.config.json
                           │
                    ┌──────┴──────┐
                    │  CLI Build  │
                    │  (agentboot build)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
    ┌─────────▼──────┐ ┌──▼────────┐ ┌─────▼──────────┐
    │ CC Plugin      │ │ .claude/  │ │ Cross-Platform │
    │ (marketplace)  │ │ (direct)  │ │ (SKILL.md,     │
    │                │ │           │ │  copilot, etc.) │
    └───────┬────────┘ └─────┬─────┘ └───────┬────────┘
            │                │               │
    ┌───────▼────┐    ┌──────▼──────┐ ┌──────▼──────┐
    │ CC + IDE   │    │ Any CC repo │ │ Copilot /   │
    │ + Cowork   │    │ (fallback)  │ │ Cursor /    │
    │            │    │             │ │ Gemini CLI  │
    └────────────┘    └─────────────┘ └─────────────┘
            │
    ┌───────▼────────────┐
    │ Managed Settings   │
    │ (MDM / Server)     │
    │ HARD guardrails    │
    └────────────────────┘
            │
    ┌───────▼────────────┐
    │ MCP Server         │
    │ (cross-platform    │
    │  live serving)     │
    └────────────────────┘
```

### Phase 1: Foundation (Now → V1)

| Channel | Action | Effort |
|---------|--------|--------|
| **Git Template** | Already exists. Refine `agentboot.config.json` and build pipeline. | LOW |
| **CLI** | Implement `agentboot setup`, `build`, `sync`, `export --format plugin`. | MEDIUM |
| **Direct .claude/ sync** | Already designed. Implement Claude Code-native output. | MEDIUM |

### Phase 2: Native Distribution (V1 → V1.5)

| Channel | Action | Effort |
|---------|--------|--------|
| **CC Plugin** | Package AgentBoot output as a CC plugin. Create private marketplace template. | MEDIUM |
| **Managed Settings** | Generate managed-settings.json and managed-mcp.json. Document MDM deployment. | LOW |

### Phase 3: Cross-Platform & Enterprise (V1.5 → V2)

| Channel | Action | Effort |
|---------|--------|--------|
| **MCP Server** | Build `@agentboot/mcp-server` with persona invocation, trait lookup, compliance tools. | HIGH |
| **Server-Managed Settings** | Document integration with Anthropic's server-managed settings (no MDM). | LOW |
| **Cross-Platform Output** | Refine copilot-instructions.md and generic SKILL.md output for non-CC agents. | MEDIUM |

### Phase 4: Broader Reach (V2+)

| Channel | Action | Effort |
|---------|--------|--------|
| **Cowork Plugins** | Package review/compliance personas for non-engineer use via desktop GUI. | LOW |
| **Public Marketplace** | Submit core AgentBoot plugin to official Anthropic marketplace. | LOW |

---

## Per-Segment Journey

### Power User Journey
```
1. Discovers AgentBoot (GitHub, marketplace, word of mouth)
2. `agentboot setup` → scaffolds org personas repo
3. Edits agentboot.config.json, writes custom personas/traits
4. `agentboot build && agentboot export --format plugin`
5. Publishes to private marketplace
6. Team installs via /plugin install
7. Power user extends with custom agents, hooks, MCP servers
```

### Willing Adopter Journey
```
1. Tech lead says "install the AgentBoot plugin"
2. /plugin marketplace add my-org/personas
3. /plugin install my-org-agentboot
4. Types /my-org-agentboot:review-code — gets structured review
5. "Oh, this is useful" → starts exploring other personas
6. Gradually becomes a power user
```

### Skeptic Journey
```
1. IT deploys managed settings via MDM (no developer action)
2. Compliance hooks activate automatically in every CC session
3. Developer notices audit trail messages but isn't disrupted
4. PR bot runs /review-code automatically (via CI, not the developer)
5. Skeptic sees review quality and starts invoking personas manually
6. "OK, this actually helps" → grudging adoption
```

### Non-Engineer Journey
```
1. IT enables Cowork plugin for their department
2. Opens Cowork desktop app → sees "Compliance Review" in sidebar
3. Pastes a document → fills out a form → gets structured compliance review
4. Never touches a terminal
```

### IT / Platform Team Journey
```
1. Evaluates AgentBoot → creates org personas repo from template
2. Configures agentboot.config.json with org structure
3. Builds and tests with pilot team (3-5 devs, 2-3 weeks)
4. Generates managed settings for HARD guardrails
5. Deploys managed settings via MDM
6. Creates private marketplace with org-customized plugin
7. Rolls out department by department
8. Monitors via audit hooks and structured telemetry
```

---

## Non-Claude Code Delivery

The methods above are CC-centric because CC has the richest extensibility surface.
For orgs using Copilot, Cursor, Gemini CLI, or a mix of tools, AgentBoot delivers
through different channels.

### GitHub Copilot

**Delivery mechanisms:**

1. **`copilot-instructions.md`** — AgentBoot's cross-platform build generates
   `.github/copilot-instructions.md` which Copilot reads as always-on instructions.
   This is the equivalent of CLAUDE.md. Synced to repos via `agentboot sync`.

2. **Path-scoped `.instructions.md`** — Copilot supports per-directory instruction
   files (`.github/instructions/*.instructions.md` with glob-scoped frontmatter).
   AgentBoot generates these from gotchas rules and domain layers.

3. **Prompt files (`.github/prompts/*.prompt.md`)** — Copilot's slash command
   equivalent. AgentBoot generates these as the IDE invocation surface for personas.
   Developers type `/review-code` in VS Code Copilot Chat.

4. **Agent Skills (`skills/{name}/SKILL.md`)** — The agentskills.io format is
   supported in Copilot CLI agent mode. AgentBoot's cross-platform SKILL.md output
   works here directly.

5. **Repository rules** — Copilot can auto-review every PR via native repository
   rules. No Claude Code involved. The PR review persona is configured once in
   GitHub repo settings.

6. **Custom instructions (org-level)** — Copilot Enterprise supports org-level
   custom instructions that apply to all repos. AgentBoot generates these from
   the org-scope always-on instructions.

7. **MCP servers** — Copilot supports MCP in VS Code (GA) and CLI. AgentBoot's
   MCP server works here for live persona serving and knowledge base access.

**What Copilot lacks vs. CC:**
- No hooks (except CLI pre-prompt hook) — compliance enforcement is advisory only
- No managed settings/MDM — no HARD guardrail channel
- No per-persona model selection — Copilot chooses the model
- No agent memory — no self-improvement reflections
- No worktree isolation — no parallel reviewer execution
- No `context: fork` — no reviewer isolation from generation context

**Org connection for Copilot:**
The platform team runs `agentboot sync` to write generated files to target repos.
Developers clone the repo and the Copilot instructions are there. No plugin install,
no marketplace. It's the "repo already has it" model.

### Cursor

**Delivery mechanisms:**

1. **`.cursor/rules/`** — Cursor reads rule files from this directory. AgentBoot
   generates these from always-on instructions and gotchas rules. Format is similar
   to CC rules but in Cursor's directory.

2. **`.cursorrules`** — Legacy single-file instructions. AgentBoot can generate
   this as a flattened version of org + group + team instructions.

3. **Agent Skills (`skills/{name}/SKILL.md`)** — Cursor supports the agentskills.io
   format. AgentBoot's cross-platform SKILL.md output works here.

4. **MCP servers** — Cursor supports MCP. AgentBoot's MCP server provides live
   persona access.

**What Cursor lacks vs. CC:**
- No hooks — zero enforcement capability
- No managed settings — no HARD guardrails
- No agent/subagent system — personas are instruction-based only
- No org-level distribution mechanism — per-repo files only

**Org connection for Cursor:**
Same as Copilot — `agentboot sync` writes files to repos. No marketplace.

### Gemini CLI

**Delivery mechanisms:**

1. **`GEMINI.md`** — Gemini CLI reads this file for project instructions. AgentBoot
   generates it from the same source as CLAUDE.md.

2. **Agent Skills** — Gemini CLI supports the agentskills.io format.

3. **MCP servers** — Gemini CLI supports MCP.

**Org connection:** Sync-based (files in repo).

### Multi-Agent Organizations

When an org has developers using different tools:

```
agentboot build
agentboot export --format all

dist/
├── claude-code/           # Full native output (.claude/ directory)
├── copilot/               # .github/copilot-instructions.md + prompts + skills
├── cursor/                # .cursor/rules/ + .cursorrules + skills
├── gemini/                # GEMINI.md + skills
├── cross-platform/        # agentskills.io SKILL.md (works everywhere)
└── mcp/                   # MCP server config (works everywhere)
```

The sync script reads each repo's `platform` field from `repos.json` and writes
the appropriate format:

```json
[
  { "name": "org/api-service", "platform": "claude-code", "team": "api" },
  { "name": "org/web-app", "platform": "copilot", "team": "web" },
  { "name": "org/ml-pipeline", "platform": "cursor", "team": "data" }
]
```

The MCP server is the only channel that serves all platforms identically — same
persona definitions, same invocation, same output format. For orgs that want
uniform governance regardless of tool choice, the MCP server is the primary
delivery mechanism, with per-platform file sync as the secondary.

---

## Key Design Decisions

### D-01: Plugin as primary, sync as fallback

The CC plugin is the primary delivery method because it uses the native distribution
mechanism, supports force-enable via managed settings, gets updates via `/reload-plugins`,
and isolates via namespace. The direct .claude/ sync is the fallback for repos that
can't use plugins or for cross-platform output.

### D-02: CLI is a build tool, not a user tool

End developers never run `agentboot`. They consume the plugin or .claude/ output.
The CLI is for the platform team that manages the personas repo, runs builds in CI,
and publishes to marketplaces.

### D-03: Managed settings for compliance, not convenience

Managed settings should only carry HARD guardrails — compliance hooks, credential
blocking, audit logging. Personas and skills are delivered via the plugin or .claude/
sync. Mixing governance and convenience in managed settings makes both harder to manage.

### D-04: MCP server is the cross-platform bridge

When an org has Claude Code AND Copilot AND Cursor users, the MCP server is the only
channel that serves all three with the same persona definitions. It's higher effort but
the only path to true multi-agent governance.

### D-05: Same plugin serves CC and Cowork

A Claude Code plugin automatically works in Cowork (the desktop app). This means
AgentBoot gets non-engineer reach for free when packaged as a plugin. Skills that make
sense for non-engineers (compliance review, document analysis) surface in the Cowork GUI
with structured forms.

---

## Sources

- [Create plugins — Claude Code Docs](https://code.claude.com/docs/en/plugins)
- [Plugins reference — Claude Code Docs](https://code.claude.com/docs/en/plugins-reference)
- [Create and distribute a plugin marketplace — Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces)
- [Configure server-managed settings — Claude Code Docs](https://code.claude.com/docs/en/server-managed-settings)
- [Claude Code for Enterprise](https://claude.com/product/claude-code/enterprise)
- [Claude Code Organisation Rollout Playbook — systemprompt.io](https://systemprompt.io/guides/claude-code-organisation-rollout)
- [Cowork: Claude Code power for knowledge work](https://claude.com/product/cowork)
- [Use plugins in Cowork — Claude Help Center](https://support.claude.com/en/articles/13837440-use-plugins-in-cowork)
- [Manage Cowork plugins for your organization — Claude Help Center](https://support.claude.com/en/articles/13837433-manage-cowork-plugins-for-your-organization)
- [Claude Code Plugin Marketplace: npm for AI-Assisted Development Workflows — Medium](https://james-sheen.medium.com/claude-codes-plugin-marketplace-npm-for-ai-assisted-development-workflows-9685333bd400)
- [Official Claude Code Plugins — GitHub](https://github.com/anthropics/claude-plugins-official)
- [Claude Code Private Marketplace Demo — GitHub](https://github.com/mrlm-xyz/demo-claude-marketplace)
