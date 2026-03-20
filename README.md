# AgentBoot

**Convention over configuration for agentic development teams.**

AgentBoot is to Claude Code what Spring Boot is to Java: an opinionated, drop-in foundation that gives your whole engineering organization consistent AI agent behavior from day one — without building it yourself.

---

## The problem

Every team that adopts Claude Code ends up doing the same thing: writing a `CLAUDE.md`, defining some rules, maybe adding a few agents. Most of these are mediocre. New teams don't know where to start. Teams in the same organization drift apart. Nobody shares anything.

Meanwhile, the teams that invest in building it well — composable traits, reviewers, guardrails, a distribution pipeline — can't share their work because it's buried in proprietary context.

AgentBoot solves that. It's the shared foundation everyone was going to build anyway, done once, done well.

---

## Quickstart

```bash
# 1. Use this repo as a template
gh repo create my-org-personas --template agentboot/agentboot --private

# 2. Configure your org structure
cp examples/minimal/agentboot.config.json ./agentboot.config.json
# edit agentboot.config.json with your org name, groups, and teams

# 3. Build and sync to your repos
npm install && npm run build && npm run sync
```

Your repos now have:
- Always-on code review instructions
- Security guardrails active on sensitive file paths
- `/review-code`, `/review-security`, `/gen-tests` slash commands
- Agent skills deployable in Claude Code agent mode

---

## What you get

### Composable traits
Reusable behavioral building blocks. Each persona is assembled from traits — change a trait once and every persona that uses it updates automatically.

```
Security Reviewer  =  critical-thinking (HIGH)
                    + structured-output
                    + source-citation

Test Generator     =  schema-awareness
                    + structured-output
                    + source-citation
```

### V1 personas, ready to deploy

| Persona | Invocation | What it does |
|---|---|---|
| Code Reviewer | `/review-code` or auto on PR | Reviews for your team's standards |
| Security Reviewer | `/review-security` | Flags vulnerabilities, exposed secrets, risky patterns |
| Test Generator | `/gen-tests` | Writes unit and integration tests from function signatures |
| Test Data Expert | `/gen-testdata` | Generates realistic synthetic test data |

### Scope hierarchy
Define your org once. AgentBoot handles the layers.

```
Your org
  └── Group (e.g. Platform)
        ├── Team (e.g. API)       → gets Platform + API personas
        └── Team (e.g. Frontend)  → gets Platform + Frontend personas
```

Studio-wide rules propagate down. Teams extend without overriding what they shouldn't.

### A distribution pipeline
One PR to `my-org-personas` → automatically synced to every registered repo. Team Champions don't pull manually. Governance is automatic.

---

## Convention over configuration

AgentBoot ships with sensible defaults for everything. You configure what's different about your organization, not everything from scratch.

```jsonc
// agentboot.config.json — the only file you need to edit to start
{
  "org": "acme-corp",
  "groups": {
    "platform": {
      "teams": ["api", "infra", "data"]
    },
    "product": {
      "teams": ["mobile", "web", "growth"]
    }
  },
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator"],
    "extend": "./personas"        // optional: your org-specific additions
  },
  "sync": {
    "repos": ["./repos.json"]    // list of target repos to sync to
  }
}
```

That's it. Run `npm run build && npm run sync` and your whole organization has consistent AI agent governance.

---

## Why Claude Code

AgentBoot is built on Claude Code. If you're evaluating AI development tools and wondering whether the investment is worth it — the answer is yes, and here's why: Claude Code is the only tool with the extensibility model (hooks, agents, MCP, scoped instructions) that makes enterprise governance like AgentBoot possible.

Other tools give you autocomplete. Claude Code gives you a platform. AgentBoot is what you build on that platform.

---

## Extend for your domain

AgentBoot ships generic. Your industry has specific requirements. The `domains/` directory shows you how to add a compliance layer for your context — healthcare, finance, defense, or any regulated environment — without modifying AgentBoot's core.

See [`docs/extending.md`](docs/extending.md) for the pattern.

---

## Plays well with others

AgentBoot personas use the [agentskills.io](https://agentskills.io) open standard. Skills you build with AgentBoot work in GitHub Copilot, Cursor, Gemini CLI, and any other agentskills.io-compatible tool. The always-on instructions work anywhere that reads `CLAUDE.md` or `.github/copilot-instructions.md`.

Lock-in is optional. Staying because it works is the goal.

---

## Project status

| Component | Status |
|---|---|
| Core traits (6) | ✅ Stable |
| V1 personas (4) | ✅ Stable |
| Scope hierarchy + sync | ✅ Stable |
| CI/CD pipeline | ✅ Stable |
| Compliance domain template | 🚧 Beta |
| MCP knowledge base integration | 📋 Planned |
| Self-improvement loop | 📋 Planned |

---

## Contributing

AgentBoot grows through community contributions — new personas, new domain layers, improved traits, better tooling.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.
File issues at [github.com/agentboot/agentboot/issues](https://github.com/agentboot/agentboot/issues).

---

## License

Apache 2.0 — use it, fork it, build on it.

---

*Built by [Mike Saavedra](https://github.com/saavyone). Inspired by a gap nobody had filled.*
