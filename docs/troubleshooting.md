---
sidebar_label: "Troubleshooting"
sidebar_position: 2
---

# Troubleshooting

Common issues and solutions when using AgentBoot.

> **Upgrading from an earlier version?** See [`docs/migration.md`](migration.md) for
> step-by-step upgrade instructions, including the v0.9 → v0.10 `/ab` skill migration.

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

### First sync stops with an error about existing agent config

A **first** sync onto a repo that already has hand-written instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`) hard-stops instead of replacing them — this is deliberate. Either run `agentboot import --path <repo>` first (recommended — the bespoke content is decomposed into hub artifacts, nothing is lost) and then sync, or run `agentboot sync --adopt-existing`, which archives everything it will overwrite to the repo's `.agentboot-archive/` (with an `archive-manifest.json`) before writing. `agentboot uninstall` restores the archive. See [CLI Reference § sync](cli-reference.md#first-sync-onto-a-repo-with-existing-agent-config).

### A drift or validation failure came back that used to be excepted

Policy exceptions **expire** (`expires` is a required field), and an expired exception is treated as absent — the covered drift or validation failure resurfaces and the report names the exception's `owner`. This is by design: "just this once" cannot silently become forever. Fix the underlying deviation, or renew the exception in `agentboot-exceptions.json` (hub) / `.agentboot-exceptions.json` (spoke) with a new expiry, approver, and reason via PR. Exceptions expiring within 14 days produce warnings first. See [configuration § Policy exceptions](configuration.md#policy-exceptions--owners-and-expiration-dates).

### `verify-manifest` reports a mismatch

Triage by which check failed:

- **Manifest content digest mismatch** — the `.agentboot-manifest.json` itself was edited or corrupted after sync. Re-sync from the hub to regenerate it.
- **File hash mismatch** — a managed file in the repo was modified after sync. If the change is intentional, cover it with a `drift:<path>` policy exception or reconcile it back through the hub; otherwise re-sync to restore the file.
- **Signature invalid or missing** — the manifest was modified after signing, or the hub shipped unsigned while your CI requires `--require-signed`. Note that signature *validity* only proves the digest was signed by *some* key.
- **Signer not in `allowed_signers`** — the signature is cryptographically valid but the signing key isn't in your trust root. Confirm whether the hub rotated its signing key (update `allowed_signers`) or whether an unauthorized party produced the manifest.

### `conformance` fails (declared vs observed divergence)

`agentboot conformance` executes the compiled hook scripts with crafted probes and compares **observed** blocking behavior against the platform's **declared** enforcement level. A failure means the artifacts do not enforce what the capability matrix declares — e.g. a hook script that is missing, not executable, mangled by local edits, or a stale `dist/` build. Rebuild (`agentboot build`) and re-run; a control reported **untested** (no `bash`, script missing) is an environment gap, not a pass. See [CLI Reference § conformance](cli-reference.md#agentboot-conformance).

## CLI Issues

### `Unknown type: '<name>'. Use: persona, trait, gotcha, domain, hook, prompt, template`

The `agentboot add` command only supports these seven types. Check your spelling.

### `Name must be 1-64 lowercase alphanumeric chars with hyphens`

Names for personas, traits, gotchas, domains, and hooks must be lowercase, start with a letter, and contain only letters, numbers, and hyphens.

## Claude Code Integration

### Personas don't appear in Claude Code

After building and syncing, verify the output exists at `.claude/agents/` and `.claude/skills/` in the target repo. Run `agentboot doctor` to check for common issues.

### Hooks not executing

Verify the hook scripts are executable (`chmod +x .claude/hooks/*.sh`).

**`jq` is not a requirement.** Compiled hooks parse their JSON input with `node -e`,
never `jq`, precisely so they run on Windows/git-bash where `jq` is usually absent.
Installing `jq` will not make a hook start working, and its absence is not the cause.

What hooks do require is **`node` on `PATH`** — every compiled hook guards on it with
`command -v node` and, depending on the hook, either blocks or exits quietly when it is
missing. If `node` is missing you may see hooks that appear to run and enforce nothing.
Check with `command -v node` in the same shell the agent launches hooks from; on
Windows/git-bash that shell often has a different `PATH` than your terminal.

`agentboot doctor`'s Environment section reports Node.js (the `>=22` floor), `git`, and
Claude Code. It inspects the hub, not the developer machine's shell utilities — it will
not tell you that a spoke's hook is missing an interpreter.

## Still stuck?

- Run `agentboot doctor` for environment diagnostics
- Run `agentboot doctor --format json` for machine-readable output
- Check the [Getting Started guide](./getting-started.md) for install steps
- File an issue at [github.com/agentboot-dev/agentboot/issues](https://github.com/agentboot-dev/agentboot/issues)
