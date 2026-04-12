---
description: "Query the AgentBoot persona catalog, build output, trait inventory, and configuration."
---

# /ab-query — Catalog & Output Queries

The `/ab-query` skill lets you inspect AgentBoot's catalog, build output,
and configuration without modifying anything.

## Operations

| Command | Description |
|---|---|
| `/ab-query personas` | List all available personas with descriptions |
| `/ab-query traits` | List all traits with usage counts |
| `/ab-query persona <name>` | Show details for a specific persona |
| `/ab-query trait <name>` | Show trait content and which personas use it |
| `/ab-query output <platform>` | Inspect build output for a platform |
| `/ab-query config` | Show the resolved configuration |
| `/ab-query manifest <repo>` | Show sync manifest for a spoke repo |

## Persona Queries

`/ab-query personas` shows:
- Name, description, and slash command
- Trait composition with weights
- Target platforms
- Token budget estimate

## Trait Queries

`/ab-query traits` shows:
- All available traits with descriptions
- Which personas reference each trait
- Weight distribution across personas

## Output Inspection

`/ab-query output <platform>` shows:
- Files generated for the platform
- File sizes and token estimates
- Scope hierarchy (core, group, team layers)

## Config Inspection

`/ab-query config` shows the resolved `agentboot.config.json` with:
- Enabled personas and traits
- Scope hierarchy
- Sync targets and platform assignments
