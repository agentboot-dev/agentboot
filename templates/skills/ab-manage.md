---
description: "Manage AgentBoot spoke repos, scopes, sync targets, and configuration."
---

# /ab-manage — Repository & Scope Management

The `/ab-manage` skill helps manage the hub-and-spoke distribution model:
spoke repos, scope hierarchy, and sync configuration.

## Operations

| Command | Description |
|---|---|
| `/ab-manage repos` | List and manage spoke repos in repos.json |
| `/ab-manage repo add <path>` | Add a spoke repo |
| `/ab-manage repo remove <path>` | Remove a spoke repo |
| `/ab-manage scopes` | List the scope hierarchy (org, groups, teams) |
| `/ab-manage install <path>` | Install AgentBoot into a new repo |
| `/ab-manage uninstall <path>` | Remove AgentBoot from a repo |

## Repo Management

Spoke repos are defined in `repos.json`. Each entry specifies:
- `path` — absolute path to the repo
- `platform` — target platform (claude, copilot, cursor, etc.)
- `label` — human-readable name
- `group` / `team` — scope assignment for layered config

## Scope Management

The scope hierarchy controls which personas and overrides apply:
- **Org** (core) — base personas and instructions for everyone
- **Group** — department or team-cluster overrides
- **Team** — team-specific persona tweaks and additions

## Install / Uninstall

`/ab-manage install` sets up a spoke repo:
1. Archives existing `.claude/` content
2. Runs initial sync
3. Generates `.agentboot-manifest.json`

`/ab-manage uninstall` cleanly removes AgentBoot:
1. Restores archived content from `.agentboot-archive/`
2. Removes manifest and managed files
