# Acknowledgments

AgentBoot draws inspiration from the broader ecosystem of developer tools and agentic
frameworks. This document credits prior art and complementary projects that influenced
our design decisions.

## Prior Art

These projects explored ideas in the agentic development space before or in parallel
with AgentBoot. We acknowledge their contributions to the ecosystem.

| Project | Relationship | Notes |
|---------|-------------|-------|
| [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework) | Prior art | Configuration framework enhancing Claude Code with specialized commands and cognitive personas, by NomenAK. Independently developed the trait-based behavioral composition concept that AgentBoot adopted and extended for multi-org governance. |
| [ArcKit](https://github.com/tractorjuice/arc-kit) | Prior art | Enterprise architecture governance harness for AI coding assistants, by Mark Craddock. Demonstrated the value of structured project context for AI agents. (Now also distributed as a Claude Code plugin at [tractorjuice/arckit-claude](https://github.com/tractorjuice/arckit-claude).) |
| [spec-kit](https://github.com/github/spec-kit) | Prior art | GitHub's spec-driven development toolkit. Explored structured prompt management and project specification patterns. |
| [Trail of Bits Claude Code Config](https://github.com/trailofbits/claude-code-config) | Prior art | Opinionated Claude Code defaults, sandboxing, permissions, hooks, and MCP usage patterns from a leading security firm. Influenced our security persona and compliance hook design. |
| [Trail of Bits Skills](https://github.com/trailofbits/skills) | Prior art (CC-BY-SA-4.0) | Security research, vulnerability detection, and audit-workflow skills, distributed as a reviewed plugin marketplace. Licensed CC-BY-SA-4.0, which requires ShareAlike — these cannot be relicensed as MIT/Apache. Referenced for security review patterns but not bundled. |

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

Upstream licenses last verified against the GitHub API on **2026-07-25**. Re-verify
before reusing any upstream content — licenses change, and none of the below is bundled
into AgentBoot today.

| Source | License | Compatible with Apache-2.0? | Notes |
|--------|---------|----------------------------|-------|
| AgentBoot core | Apache-2.0 | Yes | Our license |
| SuperClaude | MIT | Yes | Permissive |
| spec-kit | MIT | Yes | Permissive |
| Trail of Bits Claude Code config | **None declared** | **No — assume all rights reserved** | No license file in the repo. Absence of a license is not permission. Reference only, not bundled. |
| Trail of Bits skills | CC-BY-SA-4.0 | **No (ShareAlike)** | Cannot be relicensed. Reference only, not bundled. |
| ArcKit | **Not detected** (`NOASSERTION`) | **Unknown — do not assume** | GitHub cannot resolve a standard license. Reference only, not bundled. |

## Contributing

If you believe your project should be acknowledged here, please open an issue or PR.
We take attribution seriously and want to credit the community accurately.
