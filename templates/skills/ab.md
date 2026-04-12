# /ab

AgentBoot CLI skill — the primary entry point for managing your personas hub.

## Usage

```
/ab build        — Compile traits into persona output files
/ab validate     — Run pre-build validation checks
/ab sync         — Distribute compiled output to target repos
/ab dev-build    — Clean, validate, build, and dev-sync pipeline
/ab status       — Show hub status and configuration summary
/ab help         — Show available /ab subcommands
```

## Subcommands

| Command | Description |
|---------|-------------|
| `/ab build` | Compile personas from core/ into dist/ |
| `/ab validate` | Run all pre-build checks |
| `/ab sync` | Push compiled output to spoke repos |
| `/ab dev-build` | Full local pipeline: clean, validate, build, dev-sync |
| `/ab author` | Author and edit personas, traits, and instructions |
| `/ab diagnose` | Troubleshoot build failures and configuration issues |
| `/ab manage` | Manage hub configuration, repos, and scopes |
| `/ab query` | Query hub state — personas, traits, scopes, manifests |

## Notes

- This skill delegates to subcommand skills for detailed operations.
- All commands are deterministic and do not call an LLM unless noted.
- Run `/ab help` for the full command reference.
