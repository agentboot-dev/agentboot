# /ab diagnose

Diagnostic skill — troubleshoot build failures, configuration issues, and sync problems.

## Usage

```
/ab diagnose build       — Analyze the last build failure
/ab diagnose config      — Validate agentboot.config.json
/ab diagnose sync        — Check sync targets and connectivity
/ab diagnose manifest    — Verify manifest integrity in spoke repos
/ab diagnose traits      — Check trait references and weights
```

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Build fails with "trait not found" | Missing trait file in core/traits/ | Create the trait or remove the reference |
| Sync writes nothing | Empty repos.json | Add target repos with `/ab manage repo add` |
| Config validation error | Invalid JSONC syntax | Check agentboot.config.json for syntax errors |
| Manifest hash mismatch | Manual edit of synced files | Re-run `/ab sync` to restore expected state |

## Notes

- All diagnostic commands are read-only and safe to run at any time.
- Diagnostics do not call an LLM — they perform deterministic checks.
