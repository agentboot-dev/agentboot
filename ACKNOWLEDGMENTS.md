# Acknowledgments

AgentBoot draws inspiration from the broader ecosystem of developer tools and agentic
frameworks. This document credits prior art and complementary projects that influenced
our design decisions.

## Prior Art

These projects explored ideas in the agentic development space before or in parallel
with AgentBoot. We acknowledge their contributions to the ecosystem.

| Project | Relationship | Notes |
|---------|-------------|-------|
| [SuperClaude](https://github.com/nickbaumann98/superClaude) | Prior art | Trait-based behavioral composition for Claude Code. Independently developed the trait format concept that AgentBoot adopted and extended for multi-org governance. |
| [ArcKit](https://github.com/nicholasgriffintn/arckit) | Prior art | Architecture-aware Claude Code configuration. Demonstrated the value of structured project context for AI agents. |
| [spec-kit](https://github.com/spec-kit/spec-kit) | Prior art | Specification-driven development tool. Explored structured prompt management and project specification patterns. |
| [Trail of Bits Claude Config](https://github.com/trailofbits/claude-config) | Prior art | Security-focused Claude Code configuration from a leading security firm. Influenced our security persona and compliance hook design. |
| [Trail of Bits Claude Skills](https://github.com/trailofbits/claude-skills) | Prior art (CC-BY-SA-4.0) | Security review skills. Licensed under CC-BY-SA-4.0 which requires ShareAlike — these cannot be relicensed as MIT/Apache. Referenced for security review patterns but not bundled. |

## Complementary Tools

These tools solve problems adjacent to AgentBoot and may be used alongside it.

| Tool | Category | How it relates |
|------|----------|----------------|
| Claude Code | Platform | AgentBoot's primary delivery platform. We build on CC's agents, skills, hooks, and rules. |
| GitHub Copilot | Platform | Secondary output target. AgentBoot generates copilot-instructions.md for Copilot users. |
| Anthropic API | Infrastructure | Powers behavioral testing and LLM-as-judge evaluations. |

## Design Influences

AgentBoot's "convention over configuration" philosophy is inspired by:

- **Spring Boot** (Java) — opinionated defaults that reduce boilerplate
- **Ruby on Rails** — convention over configuration for web frameworks
- **Create React App** — zero-config project scaffolding
- **ESLint shareable configs** — composable rule sets distributed as packages

The scope hierarchy model (Org → Group → Team → Repo) draws from:

- **Terraform workspaces** — environment-scoped configuration
- **Kubernetes namespaces** — hierarchical resource isolation
- **Google Cloud resource hierarchy** — org → folder → project

## License Compatibility

| Source | License | Compatible with Apache-2.0? | Notes |
|--------|---------|----------------------------|-------|
| AgentBoot core | Apache-2.0 | Yes | Our license |
| SuperClaude | MIT | Yes | Permissive |
| Trail of Bits config | Apache-2.0 | Yes | Same license |
| Trail of Bits skills | CC-BY-SA-4.0 | **No (ShareAlike)** | Cannot be relicensed. Reference only, not bundled. |
| ArcKit | MIT | Yes | Permissive |

## Contributing

If you believe your project should be acknowledged here, please open an issue or PR.
We take attribution seriously and want to credit the community accurately.
