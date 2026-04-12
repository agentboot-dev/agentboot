---
description: "Diagnose AgentBoot build failures, sync drift, config issues, and pipeline problems."
---

# /ab-diagnose — Diagnostics

The `/ab-diagnose` skill helps troubleshoot AgentBoot pipeline issues:
build failures, sync drift, config problems, and validation errors.

## Operations

| Command | Description |
|---|---|
| `/ab-diagnose build` | Analyze the last build failure |
| `/ab-diagnose drift` | Check spoke repos for drift from last sync |
| `/ab-diagnose config` | Validate config against schema and detect issues |
| `/ab-diagnose pipeline` | Run the full pipeline with verbose diagnostics |

## Build Failure Diagnosis

When a build fails, `/ab-diagnose build` will:
1. Re-run validation with verbose output
2. Check for missing trait references in persona configs
3. Check for malformed SKILL.md frontmatter
4. Report the exact failure point with suggested fixes

## Drift Detection

`/ab-diagnose drift` compares spoke repo files against the manifest:
1. Read `.agentboot-manifest.json` from each spoke
2. Hash current files and compare against recorded hashes
3. Report which files drifted and what changed
4. Suggest resolution: `agentboot import` or `agentboot sync --force`

## Config Diagnosis

`/ab-diagnose config` checks for:
- Missing or invalid persona references
- Trait references that don't resolve to files
- Scope hierarchy inconsistencies
- MCP governance violations
