# AgentBoot

**Convention over configuration for agentic development teams.**

AgentBoot is a build tool that compiles AI agent personas and distributes them across your organization's repositories. Define once, deploy everywhere. The Spring Boot of AI agent governance.

## The Problem

Every team adopting AI coding tools (Claude Code, GitHub Copilot, Cursor) ends up writing its own CLAUDE.md, its own rules, its own agents — independently, inconsistently, and without governance. There's no standard for distributing agent behavior across repos, no mechanism for enforcing compliance, no way to measure value, and no path for sharing improvements.

AgentBoot solves that. It's the shared foundation everyone was going to build anyway, done once, done well.

## How It Works

AgentBoot is a build tool, not a runtime framework. It produces files and exits.

```
Source files              Build step              Distributed artifacts
(traits, personas,   →    agentboot build    →    (.claude/, copilot-
 instructions, gotchas)                           instructions.md, skills)
```

1. **Define** personas from composable traits in version-controlled Markdown
2. **Build** — validate, compile, and lint in one step
3. **Sync** — distribute compiled artifacts to every registered repo

The output works without AgentBoot installed. Any platform that reads Markdown can consume it.

## Quickstart

```bash
# Install (pick one)
brew tap agentboot-dev/agentboot && brew install agentboot
npm install -g agentboot

# Set up a new personas repo
agentboot setup

# Configure your org
# Edit agentboot.config.json with your org name, groups, and teams

# Build and sync
agentboot build
agentboot sync --dry-run   # preview first
agentboot sync             # deploy to repos
```

Your repos now have:
- Always-on code review and security instructions
- `/review-code`, `/review-security`, `/gen-tests`, `/gen-testdata` slash commands
- Agent skills deployable in Claude Code agent mode
- Platform-native output for Claude Code, GitHub Copilot, and agentskills.io

## What You Get

### Composable traits

Reusable behavioral building blocks. Change a trait once and every persona that uses it updates on the next build.

```
Security Reviewer  =  critical-thinking + structured-output + source-citation
Test Generator     =  schema-awareness + structured-output + source-citation
```

### V1 Personas

| Persona | Invocation | What it does |
|---|---|---|
| Code Reviewer | `/review-code` | Finds real bugs, not style nits |
| Security Reviewer | `/review-security` | Flags vulnerabilities, secrets, risky patterns |
| Test Generator | `/gen-tests` | Writes tests, audits coverage, finds gaps |
| Test Data Expert | `/gen-testdata` | Generates realistic synthetic test data |

### Scope hierarchy

Define your org structure once. AgentBoot handles the layers.

```
Org
  └── Group (e.g. Platform)
        ├── Team (e.g. API)       → gets Org + Platform + API personas
        └── Team (e.g. Frontend)  → gets Org + Platform + Frontend personas
```

Org-wide rules propagate down. Teams extend without overriding what they shouldn't.

### Multi-platform output

One build produces output for multiple platforms:

| Platform | Output | Location |
|---|---|---|
| Claude Code | Agents, skills, rules, traits, CLAUDE.md | `.claude/` |
| GitHub Copilot | copilot-instructions.md fragments | `.github/` |
| agentskills.io | Cross-platform SKILL.md | Configurable |

### Build once, deploy everywhere

Your personas repo is the source. Target repos receive the compiled output. One PR to the personas repo rebuilds and syncs to every registered repo.

AgentBoot only writes to `.claude/` and `.github/copilot-instructions.md` — it never touches application code, configuration, or dependencies. Sync PRs are safe to auto-merge.

## Configuration

Everything is driven by `agentboot.config.json`:

```jsonc
{
  "org": "your-org",
  "groups": {
    "platform": { "teams": ["api", "infra"] },
    "product": { "teams": ["mobile", "web"] }
  },
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator"],
    "customDir": "./personas"  // optional: org-specific additions
  }
}
```

## CLI Commands

```bash
agentboot build          # Compile personas from traits
agentboot validate       # Pre-build validation checks
agentboot sync           # Distribute to target repos
agentboot dev-build      # clean → validate → build → dev-sync pipeline
agentboot setup          # Scaffold a new personas repo
agentboot add <type>     # Create a new persona, trait, or gotcha
agentboot doctor         # Diagnose configuration issues
agentboot status         # Show deployment status
agentboot lint           # Static analysis for prompt quality
agentboot uninstall      # Remove AgentBoot from a repo
agentboot config         # View configuration
```

Run `agentboot --help` for full usage.

## Extending

AgentBoot ships generic. Your industry has specific requirements. Add domain-specific personas, traits, and gotchas without modifying core:

- **Custom personas** — add to `personas.customDir` path in config
- **Gotchas** — path-scoped knowledge rules in `core/gotchas/`
- **Domain layers** — compliance overlays for healthcare, fintech, defense

## Project Status

| Component | Status |
|---|---|
| Core traits (6) | Stable |
| V1 personas (4) | Stable |
| Build pipeline (validate, compile, sync) | Stable |
| CLI (12 commands) | Stable |
| Scope hierarchy + distribution | Stable |
| Lint + token budgets | Stable |
| Compliance domain template | Planned |
| MCP knowledge base | Planned |
| Cursor / Gemini output | Planned |

## Contributing

AgentBoot grows through community contributions — new personas, domain layers, improved traits, better tooling.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

*Built by [Mike Saavedra](https://github.com/saavyone).*
