# AgentBoot

**Bootstrap your agentic development teams.**

AgentBoot is a build tool that compiles AI agent personas and distributes them across your organization's repositories. Define once, deploy everywhere. Your agentic development harness.

## The Problem

Every team adopting AI coding tools (Claude Code, GitHub Copilot, Cursor) ends up writing its own CLAUDE.md, its own rules, its own agents — independently, inconsistently, with no shared quality baseline. There's no standard for distributing agent behavior across repos, no mechanism for enforcing behavioral consistency, no way to measure value, and no path for sharing improvements.

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

The `/ab` skill inside Claude Code is the human interface for all of this. The CLI is for CI pipelines.

## Quickstart

```bash
# 1. Install
npm install -g agentboot

# 2. Set up your personas hub
agentboot install
```

The installer creates your personas repo, builds the personas, and syncs them to any repos you register.

**3. Restart Claude Code, then go to any repo and type `/ab`**

That's it. `/ab` is the interface — ask it anything:

```
/ab how do I add a persona for my data team?
/ab show me what's registered
/ab sync
```

**For CI and scripting:** `agentboot build`, `agentboot sync`, `agentboot validate --strict`
See [CLI Reference](docs/cli-reference.md).

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
| Claude Code | Agents, skills, rules, traits, CLAUDE.md, hooks | `.claude/` |
| OpenAI Codex | Config, hooks, skills | `.codex/` |
| GitHub Copilot | copilot-instructions.md fragments, hooks | `.github/` |
| agentskills.io | Cross-platform SKILL.md | Configurable |

Official support targets the CLI surfaces of Claude Code, Codex, and GitHub Copilot.
AgentBoot additionally emits for Cursor, Gemini, Windsurf, JetBrains, and the universal
`AGENTS.md` standard on a community-supported basis.

### Build once, deploy everywhere

Your personas repo is the source. Target repos receive the compiled output. One PR to the personas repo rebuilds and syncs to every registered repo.

AgentBoot only writes agent-configuration files (`.claude/`, `.github/`, `.codex/`, and other platform config directories) — it never touches application code, configuration, or dependencies. Sync PRs are safe to auto-merge.

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

Full CLI reference (for CI/scripting): [docs/cli-reference.md](docs/cli-reference.md)

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
| CLI | Stable |
| Scope hierarchy + distribution | Stable |
| Lint + token budgets | Stable |
| Compliance domain template | Stable |
| MCP server | Stable |
| Cursor / Gemini / Codex output | Stable |

## Contributing

AgentBoot grows through community contributions — new personas, domain layers, improved traits, better tooling.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache 2.0 — see [LICENSE](LICENSE). "AgentBoot" is a trademark of Michel Saavedra — see [TRADEMARK.md](TRADEMARK.md).

---

*Built by [Mike Saavedra](https://github.com/saavyone).*
