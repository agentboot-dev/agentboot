# CLI Commands Audit

Pre-release audit of all CLI command and flag names. These become the public API surface — hard to change after adoption.

**Date:** 2026-03-21
**Status:** Pre-release review

---

## Implemented Commands (12)

| Command | Flags | Notes |
|---------|-------|-------|
| `build` | `--config` | Compiles traits into persona output |
| `validate` | `--config`, `--strict` | Pre-build validation |
| `sync` | `--config`, `--repos`, `--dry-run` | Distribute to target repos |
| `dev-sync` | `--config` | Copy dist/ locally for dogfooding |
| `full-build` | `--config` | clean → validate → build → dev-sync |
| `setup` | `--skip-detect` | Scaffold new personas repo |
| `add <type> <name>` | — | Create persona, trait, or gotcha |
| `doctor` | `--config` | Diagnose config issues |
| `status` | `--config`, `--format` | Show deployment status |
| `lint` | `--config`, `--persona`, `--fix`, `--severity`, `--format` | Prompt quality analysis |
| `uninstall` | `--repo`, `--dry-run` | Remove AgentBoot from a repo |
| `config [key]` | — | View configuration (read-only) |

**Global flags:** `-c, --config <path>`, `--verbose`, `--quiet`, `-v, --version`

---

## Issues Found

### CRITICAL — Fix before public release

**1. `--fix` flag on `lint` is accepted but not implemented**
Users will expect it to work. Either implement auto-fix or remove the flag.
- Recommendation: Remove `--fix` for V1, add back when implemented.

**2. `--config` defined globally AND on individual commands**
Redundant definition. Commander inherits global options. Having it on both creates confusion about precedence.
- Recommendation: Remove per-command `--config`, rely on global `-c, --config`.

**3. `config` command is read-only but doesn't communicate that**
`agentboot config org acme` silently fails. Users expect `config key value` to write.
- Recommendation: Either implement write, or rename to `config get` / add clear error message on write attempts.

### HIGH — Fix before 1.0

**4. `--repos` flag on `sync` — ambiguous name**
Is it a list of repo paths or a path to repos.json? It's the latter.
- Recommendation: Rename to `--repos-file` for clarity.

**5. `doctor` lacks `--format json`**
`status` and `lint` both support `--format json`. `doctor` doesn't.
- Recommendation: Add `--format` to `doctor` for consistency.

**6. `dev-sync` is an internal command exposed publicly**
End users don't need this. It's for AgentBoot contributors.
- Recommendation: Either hide from `--help` or document as internal.

### MEDIUM — Polish

**7. No short flags for common options**
`--dry-run` is typed frequently but has no short form.
- Recommendation: Add `-d` for `--dry-run`, `-s` for `--strict`.

**8. `full-build` runs `dev-sync`, not `sync`**
The name suggests a complete build, but it only syncs locally.
- Recommendation: Either rename to `dev-build` or make `full-build` run actual `sync` (with `--dry-run` default for safety).

**9. `add` subcommands incomplete**
Implemented: `persona`, `trait`, `gotcha`. Design doc specifies: `domain`, `hook`, `repo`, `prompt`.
- Recommendation: Document current scope. Add remaining in Phase 2.

**10. `uninstall` scope limited**
Only `--repo` and `--dry-run`. Design doc specifies: `--all-repos`, `--plugin`, `--managed`, `--everything`.
- Recommendation: Document current scope. The existing flags are correct — just incomplete.

---

## Naming Consistency

**Good patterns (keep):**
- Hyphenated commands: `dev-sync`, `full-build`
- Hyphenated flags: `--dry-run`, `--skip-detect`
- Lowercase type arguments: `persona`, `trait`, `gotcha`

**Inconsistencies to resolve:**
- `--repos` (path to file) vs all other flags that describe what they point to
- `--format` used on some commands but not all output commands

---

## Planned Commands (Not Yet Implemented)

From `docs/cli-design.md` — these don't block V1 but should be on the roadmap:

| Command | Purpose | Priority |
|---------|---------|----------|
| `connect` | Developer self-service org connection | High (V1.5) |
| `export` | Generate distributable artifacts (plugin, marketplace) | High (V1.5) |
| `discover` | Scan repos for existing agentic content | Medium (V2) |
| `publish` | Push to marketplace | Medium (V2) |
| `cost-estimate` | Project per-persona costs | Low (V2) |
| `metrics` | Read telemetry | Low (V2) |
| `review` | Guided human review | Low (V2) |

---

## Recommendation

Address critical issues #1-3 before first `npm publish`. The remaining issues are improvements, not blockers. Current command names are solid and consistent — no renames needed except `--repos` → `--repos-file`.
