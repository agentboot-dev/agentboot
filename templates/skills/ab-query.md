# /ab query

Query skill — inspect hub state, personas, traits, scopes, and manifests.

## Usage

```
/ab query personas              — List all enabled personas
/ab query traits                — List all enabled traits with weights
/ab query instructions          — List active instruction sets
/ab query scopes                — Show scope hierarchy and overrides
/ab query manifest <repo>       — Show sync manifest for a spoke repo
/ab query config                — Display resolved configuration
/ab query output-formats        — List enabled output platforms
```

## Output

All query commands return structured output suitable for piping or
display. Use `--json` for machine-readable JSON output.

## Examples

```
/ab query personas
# code-reviewer, security-reviewer, test-generator, test-data-expert

/ab query traits
# critical-thinking (HIGH), structured-output (MEDIUM), ...

/ab query manifest my-repo
# .claude/CLAUDE.md  sha256:abc123...
# .claude/rules/...  sha256:def456...
```

## Notes

- All query commands are read-only.
- No files are modified by query operations.
