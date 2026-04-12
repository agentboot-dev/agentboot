# /ab manage

Management skill — configure hub settings, manage repos, and control scopes.

## Usage

```
/ab manage repo add <path>      — Register a spoke repo
/ab manage repo remove <path>   — Unregister a spoke repo
/ab manage repo list            — List all registered spoke repos
/ab manage scope show           — Show the current scope hierarchy
/ab manage config set <key> <value> — Update a config value
/ab manage config show          — Display current configuration
```

## Repo Management

Spoke repos are registered in `repos.json`. Each entry contains:
- `path` — absolute local path to the repo
- `label` — org/repo identifier for display

## Scope Hierarchy

The four-level hierarchy (Org > Group > Team > Repo) controls how
personas, traits, and instructions are merged during sync. More specific
scopes layer on top of general ones.

## Notes

- Repo operations modify `repos.json` in the hub directory.
- Config operations modify `agentboot.config.json`.
- Changes take effect on the next `/ab build` and `/ab sync`.
