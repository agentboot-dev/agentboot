---
sidebar_label: "Troubleshooting"
sidebar_position: 2
---

# Troubleshooting

Common issues and solutions when using AgentBoot.

## Installation Issues

### Homebrew install fails on macOS Tahoe

**Symptom:**
```
nice: Operation not permitted
Error: Failure while executing; `/usr/bin/sandbox-exec ...` exited with 126.
```

**Cause:** macOS Tahoe (macOS 26) blocks the `nice` command inside Homebrew's sandbox. This affects all Homebrew formulae that run `npm install` during build, not just AgentBoot.

**Fix:** Install via npm instead:

```bash
brew uninstall agentboot 2>/dev/null
npm install -g agentboot
agentboot --version
```

Or use npx without installing:

```bash
npx agentboot --help
```

macOS Sequoia (macOS 15) and earlier are not affected. The Homebrew formula will work again once Homebrew ships a fix for the Tahoe sandbox incompatibility.

---

## Build Issues

### `Config file not found: agentboot.config.json`

You're running a build command outside the project root. Either `cd` to the directory containing `agentboot.config.json` or pass `--config path/to/agentboot.config.json`.

### `Config requires a non-empty "org" field`

Your `agentboot.config.json` is missing the `org` field. Run `agentboot install` to generate a valid config, or add `"org": "your-org"` to the file.

### `Persona not found: <name>`

The persona listed in `personas.enabled` does not have a matching directory in `core/personas/`. Either create it with `agentboot add persona <name>` or remove it from the enabled list.

### Token budget warnings

These are informational. A persona exceeding the token budget still compiles, but may consume more context than intended. Reduce the persona's SKILL.md content or remove less-critical traits.

## Sync Issues

### `repos.json not found`

The sync command reads `repos.json` for target repositories. Create it with `[]` (empty array) if you only use dev-sync, or populate it with repo entries for production sync.

### Manifest hash mismatch during uninstall

A managed file was modified after sync. AgentBoot skips modified files to avoid data loss. If you want to force removal, delete the file manually.

## CLI Issues

### `Unknown type: '<name>'. Use: persona, trait, gotcha, domain, hook`

The `agentboot add` command only supports these five types. Check your spelling.

### `Name must be 1-64 lowercase alphanumeric chars with hyphens`

Names for personas, traits, gotchas, domains, and hooks must be lowercase, start with a letter, and contain only letters, numbers, and hyphens.

## Claude Code Integration

### Personas don't appear in Claude Code

After building and syncing, verify the output exists at `.claude/agents/` and `.claude/skills/` in the target repo. Run `agentboot doctor` to check for common issues.

### Hooks not executing

Verify the hook scripts are executable (`chmod +x .claude/hooks/*.sh`) and that `jq` is installed on the developer's machine. Run `agentboot doctor` to check environment dependencies.

## Still stuck?

- Run `agentboot doctor` for environment diagnostics
- Run `agentboot doctor --format json` for machine-readable output
- Check the [Getting Started guide](./getting-started.md) for install steps
- File an issue at [github.com/agentboot-dev/agentboot/issues](https://github.com/agentboot-dev/agentboot/issues)
