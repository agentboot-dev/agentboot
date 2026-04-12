---
description: "AgentBoot CLI — build, validate, sync, and manage agentic personas. Use /ab for the main entry point."
---

# /ab — AgentBoot CLI

The `/ab` skill is the main entry point for AgentBoot operations inside Claude Code.
It provides access to the full build pipeline and management commands.

## Available Subcommands

| Command | Description |
|---|---|
| `/ab build` | Compile personas into platform-native output |
| `/ab validate` | Run pre-build validation checks |
| `/ab sync` | Distribute compiled output to spoke repos |
| `/ab dev-build` | Full local pipeline: clean, validate, build, dev-sync |
| `/ab test` | Run the test suite |
| `/ab author` | Author and edit personas, traits, and gotchas (see `/ab-author`) |
| `/ab diagnose` | Diagnose build failures, drift, and config issues (see `/ab-diagnose`) |
| `/ab manage` | Manage repos, scopes, and sync targets (see `/ab-manage`) |
| `/ab query` | Query persona catalog and build output (see `/ab-query`) |

## Quick Start

```
/ab build          # compile all personas
/ab validate       # check config and sources
/ab sync           # push to spoke repos
/ab dev-build      # full local dev cycle
```

## Usage Notes

- Run `/ab validate` before `/ab build` to catch config errors early.
- `/ab dev-build` is the recommended workflow for local development.
- For detailed help on any subcommand, use the corresponding skill (e.g., `/ab-author`).
