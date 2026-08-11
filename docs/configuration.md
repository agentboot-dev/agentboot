---
sidebar_label: "Configuration"
sidebar_position: 3
---

# Configuration Reference

AgentBoot is configured by a single file at the root of your hub: **`agentboot.config.json`**.
It is [JSONC](https://github.com/microsoft/node-jsonc-parser) — `//` comments are allowed — and
follows *convention over configuration*: every field has a sensible default, so you only specify
what is different about your organization.

> **There is no JSON Schema.** `agentboot validate` (and every build/sync) runs a small set of
> runtime checks — `org` must be a non-empty string, `personas.enabled` must be an array,
> `sync.targetDir` must be a dot-prefixed path, and path fields are rejected if they contain `..`.
> Unknown keys are ignored, not rejected. The authoritative shape is the `AgentBootConfig` type in
> `scripts/lib/config.ts`; this page documents it.

Run `agentboot validate` after editing to check your config.

---

## Organization identity

| Field | Type | Default | Description |
|---|---|---|---|
| `org` | string | *(required)* | Your organization slug (lowercase, no spaces). Written into provenance headers on every output file and into `PERSONAS.md`. |
| `orgDisplayName` | string | — | Human-readable org name for generated docs and headers. |

```jsonc
{
  "org": "your-org",
  "orgDisplayName": "Your Organization"
}
```

---

## Scope model

AgentBoot compiles personas top-down through a scope tree; on a filename conflict the more specific
scope wins. There are two ways to express scope.

### `nodes` — N-tier scope (current model)

`nodes` is an arbitrary-depth tree. Each node adds personas/traits and can override config for the
repos mapped to it.

| Field (per node) | Type | Description |
|---|---|---|
| `displayName` | string | Display name for this scope level. |
| `children` | `Record<string, ScopeNode>` | Child nodes (any depth). |
| `personas` | string[] | Personas enabled at this scope (additive to parent). |
| `traits` | string[] | Additional traits enabled at this scope. |
| `config` | object | Config values overridden at this scope. |

```jsonc
{
  "nodes": {
    "platform": {
      "displayName": "Platform",
      "personas": ["code-reviewer"],
      "children": {
        "api": { "traits": ["schema-awareness"] }
      }
    }
  }
}
```

### `groups` — legacy flat scope (still supported)

The original two-level `org → group → team` model. It is converted to `nodes` internally, so you can
keep using it. Prefer `nodes` for new hubs.

| Field | Type | Description |
|---|---|---|
| `groups[name].teams` | string[] | Team names under this group. |
| `groups[name].permissions` | `{ allow?: string[]; deny?: string[] }` | Group-level managed permissions. |
| `groups[name].mcpServers` | object | Group-level MCP servers. |
| `groups[name].enabledPlugins` | `{ url: string }[]` | Plugins force-enabled for the group. |

```jsonc
{
  "groups": {
    "platform": { "teams": ["api", "infra", "data"] },
    "product":  { "teams": ["web", "mobile", "growth"] }
  }
}
```

`repos.json` maps each target repo to a group/team: an array of `{ path, group?, team? }`.

---

## Personas, traits, instructions

### `personas`

| Field | Type | Default | Description |
|---|---|---|---|
| `personas.enabled` | string[] | all in `core/personas/` | Which personas to compile and distribute (directory names under `core/personas/`). |
| `personas.customDir` | string | — | Path (relative to the config) to an org-specific personas directory compiled alongside core. |
| `personas.outputFormats` | string[] | all nine formats | **The output-format control.** Which native formats to emit per persona (see below). |

**Output formats** (`personas.outputFormats`): `skill` (SKILL.md), `claude` (Claude Code), `copilot`
(`.github/copilot-instructions.md`), `cursor` (`.cursor/rules/*.mdc`), `agents` (universal
`AGENTS.md`), `windsurf` (`.windsurfrules`), `gemini` (`GEMINI.md` + `.gemini/`), `jetbrains`
(`.junie/` + `.aiassistant/`), `codex` (`.codex/`). The `plugin` output is auto-generated from
`claude` and is not listed. Default: all nine.

### `traits`

| Field | Type | Default | Description |
|---|---|---|---|
| `traits.enabled` | string[] | all in `core/traits/` | Traits available org-wide. Personas select which to use via their `persona.config.json`. Listing a subset restricts what personas may reference. |

### `instructions`

| Field | Type | Default | Description |
|---|---|---|---|
| `instructions.enabled` | string[] | all in `core/instructions/` | Always-on instruction fragments (filenames without `.md`) distributed to every synced repo — baseline guardrails loaded before any slash command. |

```jsonc
{
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"],
    "outputFormats": ["skill", "claude", "copilot", "cursor", "agents", "windsurf", "gemini", "jetbrains", "codex"]
  },
  "traits": { "enabled": ["critical-thinking", "structured-output", "source-citation"] },
  "instructions": { "enabled": ["baseline.instructions", "security.instructions"] }
}
```

---

## Domains

`domains` is a **top-level** array of domain-layer references (packaged bundles of traits, personas,
gotchas, and instructions). Scaffold one with `agentboot add domain <name>`.

| Form | Example |
|---|---|
| string path | `"./domains/my-domain"` |
| object | `{ "name": "healthcare", "version": "1.0.0", "path": "./domains/healthcare" }` |

```jsonc
{ "domains": ["./domains/my-domain"] }
```

> The `domains` mechanism and `add domain` scaffold exist today, and a generic
> **healthcare starter pack** ships in `domains/healthcare-template/` (engineering
> guardrails for health-data codebases — it does not establish HIPAA compliance or any
> regulatory posture). Fuller packaged compliance domains (healthcare/fintech/govtech)
> are on the [roadmap](roadmap.md).

---

## Sync

| Field | Type | Default | Description |
|---|---|---|---|
| `sync.repos` | string | `./repos.json` | Path to the repo list that receives compiled output. |
| `sync.targetDir` | string | `.claude` | Where within each repo to write output (must be dot-prefixed). Copilot instructions also go to `.github/`. |
| `sync.writePersonasIndex` | boolean | `true` | Write a `PERSONAS.md` inventory into each repo. |
| `sync.dryRun` | boolean | `false` | Print what would change without writing (override at runtime with `--dry-run`). |
| `sync.pr.enabled` | boolean | `false` | Open a PR per repo instead of writing directly (requires the `gh` CLI). |
| `sync.pr.branchPrefix` | string | `agentboot/sync-` | Branch name prefix for sync PRs. |
| `sync.pr.titleTemplate` | string | — | PR title template. |
| `sync.signing.enabled` | boolean | `false` | SSH-sign the sync manifest digest (`ssh-keygen -Y sign`). Requires `sshKeyPath`. A configured-but-failing signer is a sync **error** — the hub never silently ships unsigned. |
| `sync.signing.sshKeyPath` | string | — | Path to the SSH private key (relative paths resolve against the hub config). Verify with `agentboot verify-manifest`. |
| `sync.signing.emitInToto` | boolean | `false` | Also write `.agentboot-manifest.intoto.json` next to the manifest: an **in-toto v1 Statement** (subjects = per-file sha256 digests + the manifest digest; predicate = hub provenance incl. git context) in a **DSSE envelope**, signed over the DSSE PAE bytes with the same SSH key. Honest posture: gives policy tooling a standard predicate and is verifiable via `verify-manifest` or ssh-keygen — but the signature is SSHSIG, **not a Sigstore bundle** (no transparency log, no CI-identity certificate); Sigstore keyless is the documented next step. |

```jsonc
{
  "sync": {
    "repos": "./repos.json",
    "targetDir": ".claude",
    "writePersonasIndex": true,
    "pr": { "enabled": true, "branchPrefix": "agentboot/sync-", "titleTemplate": "chore: AgentBoot sync" }
  }
}
```

---

## Output / build

| Field | Type | Default | Description |
|---|---|---|---|
| `output.distPath` | string | `./dist` | Where compiled output is written before syncing. |
| `output.provenanceHeaders` | boolean | `true` | Add source-file + timestamp provenance headers to output. |
| `output.failOnDirtyDist` | boolean | `false` | **Deprecated, ignored.** `dist/` is now rebuilt from empty on every build and pruned, so a dirty `dist/` is structurally impossible. Setting the key prints a deprecation warning; the build no longer fails. |
| `output.tokenBudget.warnAt` | number | `8000` | Per-persona estimated-token warning threshold (informational — warns, never blocks). |
| `output.tokenBudget.failAt` | number | — | Opt-in hard ceiling: the build **fails** when a compiled persona's estimated size exceeds it — the CI gate for prompt-size regressions. The build also writes `dist/persona-sizes.json` so hub PRs show size changes as a reviewable diff. Estimates use a chars/4 heuristic — a stable relative measure, not an exact tokenizer count. |

> Which **platforms** to emit is controlled by `personas.outputFormats`, not `output`. There is no
> `output.format`, `output.hooks`, `output.mcp`, `output.managed`, or `output.dir` key.

### Capability coverage — a configured control must reach some platform

`personas.outputFormats` selects platforms; the `claude.*`, `compliance.*`, `mcp.*`, `ab.*` and
`managed.*` blocks configure capabilities. Nothing used to compare the two, so a capability whose
emitter was gated off produced no file, no log line, and no record that it had ever been requested.

The build now fails when a configured capability can be honoured by **none** of the configured output
formats. Which platforms emit which capability is declared in `CAPABILITY_SUPPORT`
(`scripts/lib/conformance.ts`) — a separate axis from `PLATFORM_ENFORCEMENT`, which states how
*strongly* a platform enforces:

| Capability | Emitted by | Severity if no configured target emits it |
|---|---|---|
| `claude.hooks`, `claude.permissions.deny`, `mcp.enforceApproved`, `managed.guardrails.disableBypassPermissions` | claude | **error** |
| `compliance.inputScan.scannerCommand`, `compliance.outputScan.blocking`, `managed.guardrails.denyTools`, `managed.guardrails.requireAuditLog` | claude, codex, copilot, plugin | **error** |
| `claude.permissions.allow`, `claude.mcpServers`, `claude.settings`, `ab.modelOverrides` | claude | warn |
| `instructions[].applyTo` (narrowing only) | copilot | warn |
| `gotchas[].paths` | copilot, cursor, windsurf, jetbrains | warn |
| `managed.guardrails.forcePlugins` | **nothing** | **error, always** |

**One honouring target is enough** — partial coverage is the enforcement axis's concern, not this one.

Severity is assigned by *what the operator loses*, not by importance. **Error** means the operator
believes a control is active and it is not. **Warn** means a convenience is lost and nothing is
falsely believed to be enforced. `permissions.deny` and `permissions.allow` look symmetric and are
not: `deny` is the control, `allow` is a pre-approval convenience — failing a build over lost
friction-reduction is the over-gating that gets a gate switched off.

**A narrowing `applyTo` only.** `applyTo: "**"` is the documented always-on sentinel; losing a
universal scope is a no-op, so it never fires.

#### Accepting a gap

Errors are waived through the policy-exception register (`agentboot-exceptions.json`) with the policy
key `capability:<id>` — not a config boolean, because the register requires an owner and an approver
and it **expires**:

```json
[{ "id": "EX-2026-014", "policy": "capability:claude.hooks",
   "reason": "cursor-only pilot; hooks land when Claude Code is added",
   "approver": "…", "owner": "…", "created": "2026-08-08", "expires": "2026-11-08" }]
```

A waived gap still prints on every build, naming the owner and the expiry. The day after it expires
the build fails again. Warn-level rows need no waiver — they do not block.

`agentboot doctor` reports the same information under a **Coverage** section, printed *before*
Enforcement: coverage answers "was it emitted at all?", enforcement answers "how strongly?" — and
coverage is the prior question.

### Revocation — `dist/` is generated output, not a cache

Every build compiles into a staging directory and swaps it into place, so `dist/` is a faithful
projection of hub config rather than an append-only cache. Removing an artifact from
`instructions.enabled`, or a platform from `personas.outputFormats`, therefore **removes it from
`dist/`** — and the build reports what it pruned, including the zero case:

```
  Pruned 4 stale artifact(s) from dist/:
    − dist/claude/core/rules/security.instructions.md
  Pruned 5 retired platform tree(s): agents, claude, copilot, plugin, skill
```

`sync` then propagates the deletion to each spoke. Removal is confined to paths listed in that
spoke's previous manifest — sync can only delete files it wrote — which is why it is on by default
with no flag. Two cases do not delete:

| Case | Behaviour |
|---|---|
| The spoke **edited** the file since delivery | Never deleted. Sync **exits non-zero**: the org withdrew a control and one repo still has it. Fix the local edit, or add a `retain` regex to the repo entry. |
| A `retain` regex matches (repos.json entry, or hub-wide `sync.retain`) | Never deleted. Reported as a **warning on every sync** — the hatch silences the error, never the fact. |

A revoked artifact sync could not withdraw is recorded in the spoke manifest's `retired[]` array, and
`drift-check` reports it as drift and **exits non-zero**. A withdrawn control still live on a spoke
is not a clean repo.

`sync` also refuses to ship a platform the hub does not build: if `repos.json` names `claude` but
`personas.outputFormats` does not, `dist/claude/` does not exist and that repo entry fails with a
message naming both sides. Other repos still sync; the run exits non-zero at the end.

---

## Platform-specific & delivery

### `claude` (experimental)

Claude Code-specific extras, emitted only for the `claude` format when set.

| Field | Type | Description |
|---|---|---|
| `claude.hooks` | object | Extra Claude Code hooks. |
| `claude.permissions` | `{ allow?: string[]; deny?: string[] }` | Permission rules. |
| `claude.mcpServers` | object | Additional MCP server entries. |
| `claude.settings` | object | Arbitrary additional Claude Code settings keys, passed through **verbatim** to the managed output (`dist/managed/managed-settings.json` and the `managed-settings.d` fragments). Use for keys with no dedicated AgentBoot field — `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `env`, `cleanupPeriodDays`, `includeCoAuthoredBy`, or any future Claude Code key — so an existing hand-written managed settings file can be reproduced 1:1 from hub config. Keys with dedicated config (`permissions`, `hooks`, `mcpServers`) are rejected at validation. |

### `userLevel` — user-scope install

Controls `agentboot install-user` (writing compiled skills/rules to `~/.claude`).

| Field | Type | Default | Description |
|---|---|---|---|
| `userLevel.mode` | `"auto" \| "direct" \| "manifest"` | `auto` | `auto`: write `~/.claude` directly unless a `~/.claude/.managed` sentinel indicates another tool owns the slot (then stage for handoff). `direct`: always write. `manifest`: never write — stage resolved content + a handoff manifest for an external provider. |

`agentboot install-user --mode <auto\|direct\|manifest>` overrides the configured value for one run;
`--dry-run` reports what either mode would do without touching anything.

#### What is written, and what is deliberately not

Both modes carry exactly two slots, taken from `dist/claude/core/`:

| Slot | Source | Destination (direct mode) |
|---|---|---|
| `skills/` | `dist/claude/core/skills/` | `~/.claude/skills/` |
| `rules/` | `dist/claude/core/rules/` | `~/.claude/rules/` |

**`CLAUDE.md` and `settings.json` are never written or staged, in either mode.** They are *composed*
files — one needs a safe append between an external provider's markers, the other a deep merge — and
AgentBoot has no way to perform either without clobbering another tool's content. Direct writes are
additive into directory slots only: no hooks, no `permissions.deny`. `install-user` prints both
exclusions on every run so the omission is never mistaken for a failure.

Content is refused rather than delivered if it still contains an unresolved `{{ template_var }}`.
A user-level config manager typically resolves templates all-or-nothing, so one unresolved variable
from AgentBoot would fail *every other tool's* content in the same pass. The check runs in dry-run
too, so it surfaces before it can matter.

#### The handoff contract (`manifest` mode)

This manifest is the **only coupling between AgentBoot and an external user-scope provider**. It is
what a provider implements against, so it is specified here rather than left to the source.

Nothing under `~/.claude` is touched. The resolved slot content is staged and a manifest is written
beside it:

```
<distPath>/claude-user/            # default staging root — dist/claude-user
├── .agentboot-handoff.json        # the manifest the provider reads
├── skills/…                       # resolved, ready to copy
└── rules/…
```

```jsonc
// dist/claude-user/.agentboot-handoff.json
{
  "managed_by": "agentboot",       // constant — identifies the producer
  "scope": "user",                 // constant
  "mode": "manifest",              // constant; present only in the handoff manifest
  "apply_target": "~/.claude",     // where the provider is asked to apply `files`
  "written_at": "2026-08-11T09:00:00.000Z",   // ISO 8601, UTC
  "files": [
    { "path": "skills/ab/SKILL.md", "hash": "9a52…" },
    { "path": "rules/baseline.md",  "hash": "1c7f…" }
  ]
}
```

| Field | Contract |
|---|---|
| `files[].path` | **POSIX-relative to the staging root**, always `/`-separated even on Windows, and never absolute or `..`-bearing. Join it to `apply_target` to get the destination. |
| `files[].hash` | Hex-encoded **SHA-256 over the file's contents**. Verify before applying; a mismatch means the staged tree was modified after the build. |
| `written_at` | Build time, not apply time. |

**The provider's side of the contract:** apply every `files[]` entry under `apply_target`, verify the
hash first, and treat the manifest as the complete inventory — AgentBoot stages nothing that is not
listed. AgentBoot does not read this file back; once staged, the slot belongs to the provider.

#### The install manifest (`direct` mode)

Direct writes record what they delivered in `~/.claude/.agentboot-user-manifest.json` — the same
shape minus `mode` and `apply_target`, with `files[].path` POSIX-relative to `~/.claude`:

```jsonc
{ "managed_by": "agentboot", "scope": "user", "written_at": "…",
  "files": [{ "path": "skills/ab/SKILL.md", "hash": "9a52…" }] }
```

It exists so revocation works, and its semantics are deliberately conservative:

- **Withdrawal is confined to the previous manifest.** The next `install-user` removes what the last
  one delivered and this one did not. Because the manifest lists only files AgentBoot wrote, it can
  never delete a file it did not create.
- **A locally edited artifact is `blocked`, not removed** — its hash no longer matches, so it is left
  on disk, reported in yellow as *revoked at the hub and still active on this machine*, and **kept in
  the manifest** so `agentboot uninstall --user` can still reach it. Silently discarding a local edit,
  or dropping it from tracking, both produce content no command can account for.
- **"0 revoked" and "pruning never ran" print differently.** An equivalence there is how a withdrawn
  artifact sits on disk indefinitely while the run looks clean.
- **An unreadable manifest prunes nothing** and is treated as "no previous install" — guessing would
  delete files AgentBoot cannot prove it wrote.
- **Path traversal is refused on read.** `uninstall --user` skips any manifest entry that resolves
  outside `~/.claude/` and says so, so a tampered manifest cannot aim the uninstaller at the rest of
  the home directory.
- Manifests written by older builds may contain `\`-separated paths; both manifests are normalised on
  read, so an upgrade does not read every legacy entry as an orphan.

### `agents` — tools & LLM provider

| Field | Type | Description |
|---|---|---|
| `agents.tools` | `("claude-code"\|"copilot"\|"cursor"\|"gemini"\|string)[]` | Which agent tools your org uses (informs output selection). |
| `agents.primary` | string | Default tool when a choice is needed. |
| `agents.llmProvider` | `"claude-code"\|"anthropic-api"\|"manual"\|string` | Provider for AgentBoot's own LLM operations (e.g. import classification). |
| `agents.llmModel` | string \| null | Model override for API providers. |
| `agents.billingAcknowledged` | boolean | Whether the user acknowledged that LLM-powered commands cost money. |

### `ab.modelOverrides` — per-agent model assignment for `/ab`

The `/ab` skill compiles to five agent files, and each is stamped with a **default model chosen
for cost**: the read-only query agent runs on Haiku, everything else on Sonnet.
`ab.modelOverrides` (`Record<string, string>`) replaces the default for one agent. The key is the
agent name; an unknown key matches no agent and is silently inert.

| Key | Default | Agent |
|---|---|---|
| `ab.modelOverrides.ab` | `sonnet` | The `/ab` entry point; routes to the four below. |
| `ab.modelOverrides["ab-query"]` | `haiku` | Read-only status and lookup. **This is the cost story the feature exists for** — the highest-volume agent runs on the cheapest model. |
| `ab.modelOverrides["ab-author"]` | `sonnet` | Authors personas, traits and instructions. |
| `ab.modelOverrides["ab-diagnose"]` | `sonnet` | Diagnoses build / sync / drift failures. |
| `ab.modelOverrides["ab-manage"]` | `sonnet` | Hub and spoke management operations. |

**Legal values** — anything else is not a model this build understands:

| Value | Meaning |
|---|---|
| `opus` \| `sonnet` \| `haiku` | Agent SDK model aliases. |
| `inherit` | Run on whatever model the parent session is using. |
| `claude-<id>` | An explicit model id matching `^claude-[a-z0-9.-]+$` — e.g. `claude-sonnet-4-5`. |

Values are trimmed and lower-cased before matching, so `" Haiku "` is accepted.

```jsonc
{
  "ab": {
    "modelOverrides": {
      "ab-query": "claude-haiku-4-5",   // pin the cheap agent to an exact id
      "ab-author": "opus"               // author with the strongest model
    }
  }
}
```

**An invalid value does not fail the build. It is ignored, with a warning, and the default is
used:**

```
⚠ Ignoring invalid ab.modelOverrides["ab-query"] = "sonet" — expected opus | sonnet |
  haiku | inherit or a claude-* model id; using default "haiku".
```

That is deliberate — a typo in a cost knob should not stop a governance build — but it means a
**mistyped override silently loses the saving it was meant to make**. The warning is the only
signal; read the build log.

**`ab-query` is compiled read-only and that is not configurable.** Its agent frontmatter is
stamped with `disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit"]`, so the query agent
cannot run commands or write files whatever model it is pointed at. Read-only is the agent's
contract, not a preference, and there is no config key that relaxes it.

---

## Governance

### `composition` — rule/preference merging

| Field | Type | Description |
|---|---|---|
| `composition.defaults` | `Record<string, "rule"\|"preference">` | Override the default composition type per classification. |
| `composition.overrides` | `Record<string, "rule"\|"preference">` | Override composition type for specific artifact paths. |

### `managed` — HARD guardrails (MDM)

Generates a managed-settings artifact (Claude Code only) for MDM distribution.

| Field | Type | Description |
|---|---|---|
| `managed.enabled` | boolean | Enable managed-settings generation. |
| `managed.platform` | `"jamf"\|"intune"\|"jumpcloud"\|"kandji"\|"other"` | MDM target. |
| `managed.outputPath` | string | Custom output path. |
| `managed.scopeMerge.acknowledgedOverrides` | string[] | Top-level managed-settings keys whose cross-scope override is intended. Without this the build fails on a differing-value collision. `permissions`/`hooks` are unioned and never belong here; `"*"` is rejected. |
| `managed.guardrails.forcePlugins` | string[] | **NOT IMPLEMENTED — accepted, typed, and read by no code path on any platform.** Setting it now FAILS the build (see the capability gate below); this row is retained only so the failure is explicable. Flagged for a product decision: implement it, or delete the key and the type. |
| `managed.guardrails.denyTools` | string[] | Tool patterns to deny. |
| `managed.guardrails.requireAuditLog` | boolean | Require audit logging. |
| `managed.guardrails.disableBypassPermissions` | boolean | Disallow bypassing permissions. |

#### Deploying the managed output (what your MDM operator ships)

The build writes managed artifacts to **two places with two different jobs**:

| Output | Contents | Role |
|---|---|---|
| `dist/managed/` | `managed-settings.json` (complete managed-settings file: HARD guardrails, deny-tool hooks, bypass disable, audit/telemetry hooks), a managed `CLAUDE.md` banner, and `managed-mcp.json` when MCP servers are configured | **The deployable unit.** This is what the MDM pushes to the OS-level managed location. |
| `managed-settings.d/` fragments — `00-org.json` under `dist/claude/core/`, plus `10-group.json` / `20-team.json` under `dist/claude/nodes/<scope>/` when scopes define policy | Per-scope building blocks (permissions, hooks, bypass disable), named for alphabetical precedence (org wins over group wins over team) | **Composition inputs.** They are not deployed as-is. |

Deployment flow:

1. **Single org-wide policy:** deploy `dist/managed/managed-settings.json` to the managed
   path for your MDM (the build prints the target path — e.g.
   `/Library/Application Support/Claude/` for Jamf/Kandji, `/etc/claude-code/` for Linux
   MDM, `C:\ProgramData\Claude\` for Intune).
2. **Per-team policy:** the build performs the merge for you — every scope with policy
   gets a single deployable file at `dist/managed/scopes/<scope>/managed-settings.json`
   (e.g. `scopes/core/` for the org-wide fleet, `scopes/nodes/platform/api/` for a team
   segment). Merge semantics:

   - **`permissions.deny` / `permissions.allow` — UNION across scopes.** A team can add
     denies, never remove the org's.
   - **`hooks` — UNION across scopes, per event, over the entry arrays.** Both authors'
     hooks run. There is no such thing as "overriding" a hook downward: a higher scope
     declaring its own hook does not contradict a lower scope's, and union is the only
     semantics under which both survive. Identical entries are deduplicated, so
     hand-declaring the telemetry hook alongside `requireAuditLog` does not double-fire it.
   - **Every other key is won by the higher scope** (org over group over team) — but a
     collision on **differing values now FAILS the build**. This file is the channel a
     developer cannot override; a value silently dropped here is a control that was
     authored, validated and signed, and enforces nothing. Identical values in two
     fragments are normal (`claude.settings` is copied into both) and are never reported.

   If the override is intended, enumerate it:

   ```json
   "managed": { "scopeMerge": { "acknowledgedOverrides": ["cleanupPeriodDays"] } }
   ```

   The loss is then reported as a warning naming the winner, the loser and both sources —
   an acknowledged loss is still a loss. `"*"` is rejected; the point is that each accepted
   loss is enumerated and reviewable in the hub PR diff. `permissions` and `hooks` never
   appear here, because nothing is discarded for them.

   Deploy the merged file for each fleet segment; the `managed-settings.d/` fragments
   remain available as the reviewable composition inputs.
3. **Verify after deployment** on one managed machine: start a Claude Code session and
   confirm (a) a denied tool from `guardrails.denyTools` is actually blocked, and
   (b) `--dangerously-skip-permissions` is rejected if `disableBypassPermissions` is set.
   A managed settings file that is present but in the wrong location fails silently —
   the denied-action check is the real verification, not the file copy.

### `mcp` — MCP connection governance

| Field | Type | Description |
|---|---|---|
| `mcp.approved` | `McpServerEntry[]` | Allowed MCP servers. Beyond `name`, an entry can **pin the implementation identity**: `command`, `args` (pin the package spec here, e.g. `["company-tools@1.2.3", "serve"]` — this is how a version is pinned), `url`, and `transport`. With `enforceApproved`, a configured server must match every pinned field exactly — an approved *name* may not front a different executable. |
| `mcp.enforceApproved` | boolean | Reject any configured MCP server not on the approved list, or whose identity differs from the approved pin. `validate` additionally warns for approved servers without a `toolsDigest` or `registry`. |
| `mcp.required` | string[] | MCP servers required in all repos. |
| `mcp.approved[].toolsDigest` | string | **Digest pin (v0.19.0):** sha256 over the server's canonicalized `tools/list` definitions. Identity/version pins alone do not stop a mutable server changing its tool descriptions under a fixed name (the rug-pull class) — the digest does. Record with `agentboot mcp-pin --write`; check with `agentboot mcp-verify` (in CI or pre-rollout), which names the added/removed/changed tools on mismatch. Pins compile into `mcp-pins.json` in every platform core dir, so a spoke can run `agentboot mcp-verify --pins .claude/mcp-pins.json` without the hub. |
| `mcp.approved[].registry` | string | Provenance of the server reference: `official-registry:<namespace>`, `vetted:<catalog>`, `vendor:<name>`, or `unvetted`. Surfaced by validate warnings, `mcp-pin` output, and the evidence pack. |

> **Approving a server is not approving every tool it exposes.** The allowlist governs which
> server implementations may run; each server still surfaces its own tool set to the agent.
> AgentBoot's own MCP server runs a **read-only profile by default** — the mutating tools
> (`agentboot_build`, `agentboot_sync`, `agentboot_propose_change`) are hidden and rejected
> unless the server is started with `agentboot mcp-server --profile maintainer` (or
> `AGENTBOOT_MCP_PROFILE=maintainer`). Tool metadata carries MCP annotations
> (`readOnlyHint`, `openWorldHint`) so clients can display what mutates.

### `privacy` — three-tier privacy model

| Field | Type | Description |
|---|---|---|
| `privacy.tier` | `"private"\|"privileged"\|"organizational"` | private = raw prompts never leave the machine; privileged = LLM analysis via API with developer approval; organizational = anonymized metrics only. |
| `privacy.rawPrompts` | `false` | Design invariant — raw prompts are never collected. Only `false` is valid. |
| `privacy.escalationEnabled` | boolean | Escalation exception for genuinely harmful content (category flag only). |

### `validation`

| Field | Type | Default | Description |
|---|---|---|---|
| `validation.secretPatterns` | string[] | `[]` | Extra regex patterns that fail validation if found in a trait/persona (e.g. internal hostnames, account IDs). |
| `validation.strictMode` | boolean | `false` | Treat validation warnings as build-blocking errors. |

### `compliance` — pluggable content scanners

The bundled credential regexes always run in the generated input/output scan hooks. An
organization can additionally plug its **own scanner** — a DLP wrapper, a PHI classifier,
any executable — into the same hook chain, and promote the output scan from warn to block.
AgentBoot does not become a DLP engine; it gives your scanner a reliable integration point.

| Field | Type | Default | Description |
|---|---|---|---|
| `compliance.inputScan.scannerCommand` | string | — | Executable invoked by the input-scan hook after the bundled patterns pass. Receives the prompt on stdin. Exit `0` = allow, `2` = block, anything else = scanner failure (see `failMode`). Embedded in the generated hook at build time; shell metacharacters are rejected. |
| `compliance.inputScan.failMode` | `"open"\|"closed"` | `"open"` | What a scanner *failure* (not a block) does: `open` = allow with a stderr notice, `closed` = block. Note: a scanner that hangs is bounded by the hook's own timeout, which the platform may treat as fail-open — see the platform capability matrix. |
| `compliance.outputScan.scannerCommand` | string | — | Same contract, applied to the response in the Stop-hook output scan. |
| `compliance.outputScan.failMode` | `"open"\|"closed"` | `"open"` | As above, for the output scanner. |
| `compliance.outputScan.blocking` | boolean | `false` | Promote the output scan from warn-only to **blocking**: on a match (bundled pattern or scanner), the hook exits 2 with a redact instruction returned to the model instead of printing a warning. Precisely stated: this cannot retract text already rendered on screen — it refuses to let the turn end until the model remediates (remediation-forcing, not display suppression). |

Scanner content never leaves the machine through AgentBoot: the hook pipes content to your
command locally and surfaces its stdout/stderr to the developer only.

#### Hook input limit — `AGENTBOOT_MAX_HOOK_INPUT_BYTES`

Every generated hook reads a **bounded** amount from stdin. A hook runs on the developer's critical
path for every prompt and every tool call, so an unbounded read is a memory and latency problem; and
a payload that cannot be read in full cannot be scanned in full.

| | Value |
|---|---|
| Default cap | **1 MiB — `1048576` bytes.** Deliberately larger than any legitimate prompt or tool payload. |
| Environment override | `AGENTBOOT_MAX_HOOK_INPUT_BYTES` — read by the hook at run time, not baked in at build time. |
| Accepted range | **`1` … `2147483647`** (2 GiB − 1), written in **plain decimal digits with no leading zero, sign, whitespace, or unit suffix**. `1048576` is valid; `0x100000`, `1MB`, `01048576` and `-1` are not. |
| Not configurable from | `agentboot.config.json`. This is an operator-side runtime knob, not org policy. |

**There is no "unlimited".** A value outside the accepted range is not silently clamped and not
silently accepted — it is treated as an **unusable limit**, and what happens next follows the hook's
own posture:

| Hook posture | Unusable `AGENTBOOT_MAX_HOOK_INPUT_BYTES` |
|---|---|
| Blocking (input scan, deny-tools) | **Refuses to run.** Exits `2` with a block reason naming the variable and the accepted range. A gate will not run unbounded. |
| Non-blocking (output scan, telemetry) | Falls back to the `1048576` default, and says so on stderr. A working scan beats a skipped one. |

**Over-cap behaviour — a prompt larger than the cap is not truncated and quietly scanned.** Each hook
takes the posture it already takes on every other failure:

| Hook | Event | Over-cap posture | What the developer sees |
|---|---|---|---|
| Input scan | `UserPromptSubmit` | **block** | Exit `2`. *"prompt exceeds the hook input limit and could not be scanned. Split it, or raise `AGENTBOOT_MAX_HOOK_INPUT_BYTES` deliberately."* The prompt does not reach the model. |
| Deny-tools gate | `PreToolUse` | **block** | Exit `2`. *"tool-use payload exceeds the hook input limit and could not be inspected."* |
| Output scan | `Stop` | **skip** | Exit `0`, with *"output scan SKIPPED for this turn"* on stderr. A Stop hook that blocked on its own failure would strand the session — but an unscanned response must never look like a clean one. |
| Audit trail | `SubagentStart`, `SubagentStop`, `PostToolUse`, `SessionEnd` | **degrade** | Records the event anyway and warns on stderr that fields may be incomplete. |

So on a `>1 MiB` prompt the DLP gate **blocks outright** rather than scanning a truncated copy. If
your team legitimately submits payloads that large, raise the variable deliberately — do not read the
block as a bug.

The same three postures apply when a hook cannot read stdin at all, or cannot measure what it read.
An unreadable or unmeasurable payload is an unscanned payload and is treated exactly like an over-cap
one, rather than falling through to exit `0`.

> **This is not `compliance.inputScan.failMode`, and not the platform hook timeout.** `failMode`
> governs what a *scanner process failure* does once the payload has been read; the Copilot ceiling
> in [the platform capability matrix](platform-capability-matrix.md) is about hooks that *time out*.
> The input cap is a third, separate mechanism, and it is the only one of the three that fails closed
> on the blocking hooks by default.

### Policy exceptions — owners and expiration dates

Enterprise policies always meet legitimate exceptions; unstructured exceptions become
permanent bypasses. AgentBoot records exceptions as **owned, expiring, reviewable JSON**:

- **Hub:** `agentboot-exceptions.json` at the hub root — validated by `agentboot validate`.
- **Spoke repo:** `.agentboot-exceptions.json` at the repo root — consumed by
  `agentboot drift-check`. A modified/missing managed file covered by an unexpired
  `"policy": "drift:<path-or-glob>"` exception reports as **`excepted`** (with its
  exception id) instead of failing the repo — approved drift is always *distinguished*
  from unauthorized drift, never hidden. Living in the repo means the exception itself
  is PR-reviewed history.

```jsonc
{
  "exceptions": [
    {
      "id": "EX-2026-001",
      "policy": "drift:.claude/settings.json",
      "reason": "Vendor pilot needs a temporary permission override",
      "approver": "security-lead",          // a person, not a team alias
      "owner": "platform-lead",             // owns resolving it before expiry
      "created": "2026-07-01",
      "expires": "2026-10-01",              // REQUIRED — expired exceptions are NOT honored
      "compensatingControl": "weekly manual review of the overridden file",
      "link": "https://tickets.example.com/SEC-123"
    }
  ]
}
```

Required fields: `id`, `policy`, `reason`, `approver`, `owner`, `created`, `expires`.
An **expired** exception is treated as absent — the drift resurfaces, validation fails,
and the report names the owner. Exceptions expiring within 14 days produce warnings.
"Just this once" cannot silently become forever.

---

## Telemetry

Local, opt-in usage telemetry. **Raw prompt content is never included** (`includeContent` is a `false`
design invariant).

| Field | Type | Default | Description |
|---|---|---|---|
| `telemetry.enabled` | boolean | `false` | Enable telemetry emission. |
| `telemetry.includeDevId` | `false \| "hashed" \| "email" \| "email-raw"` | `false` | Developer identification. The value *is* the format — `"hashed"` = SHA-256 of email, `"email"` = raw email, `false` = no dev ID. (There is no separate `devIdFormat` field.) |
| `telemetry.logPath` | string | `~/.agentboot/telemetry.ndjson` | NDJSON log file path. |
| `telemetry.includeContent` | `false` | `false` | Never include raw prompt content. Design invariant. |
| `telemetry.sink` | object | — | **Org-configured central sink** (none by default — AgentBoot never phones home). When set, compile emits `telemetry-sink.json` into every platform's core dir (synced to spokes, org-managed) and `agentboot telemetry-ship` spools events into digest-chained, optionally SSH-signed batches and POSTs them to this endpoint. |
| `telemetry.sink.url` | string | required | The org's own HTTPS collector. `https://` only. |
| `telemetry.sink.headers` | object | — | Extra request headers. A value like `"$TOKEN_VAR"` resolves from the shipper's environment at ship time — never commit literal credentials. |
| `telemetry.sink.batchSize` | number | `100` | Events per shipped batch (1–10000). |
| `telemetry.sink.spoolDir` | string | `~/.agentboot/telemetry-spool` | Where batches wait to ship (and `shipped/` keeps the local audit copy). |
| `telemetry.sink.sign` | boolean | `true` when signing enabled | Sign batch digests with `sync.signing.sshKeyPath`. |

```jsonc
{
  "telemetry": { "enabled": true, "includeDevId": "hashed" }
}
```

The emitted telemetry record per persona invocation contains only:
`{ event, persona_id, timestamp, status, dev_id, schema, chain }` — no prompt, model,
token, or cost fields. `chain` is a hash-chain link (sha256 of the previous event's
chain + this event's canonical content) making post-write edits, deletions, and
reordering of the local log detectable; verify with `agentboot telemetry-verify --log`.

**The sink's trust model, stated honestly:** the local chain is unkeyed — it detects
modification but cannot prevent a full consistent rewrite. Tamper *evidence* comes from
shipping: batches are digest-chained, sequence-numbered, and (with `sync.signing`)
SSH-signed, so once shipped, forgery fails signature verification, deletion shows as a
sequence gap, and local log deletion no longer erases history. The residual limit: a
developer who controls the machine can suppress events *before* first shipment — bound
that window with an org-controlled ship cadence (CI/cron running
`agentboot telemetry-ship`) rather than trusting per-developer invocation.

The full event schema (three event types, every field, its source, and whether it can
identify a person) is versioned in `scripts/lib/telemetry-schema.ts`, and a conformance
test executes the generated hook against it — the hook cannot drift from the documented
schema without failing CI. Run **`agentboot telemetry-inspect`** to see exactly what would
be emitted under your current config, including sample events. Note that a `"hashed"`
developer id is **pseudonymous, not anonymous** — see the privacy guide.

---

## Complete example

The shipped `agentboot.config.json` at the repo root is a fully-annotated working example. A minimal
hub needs only:

```jsonc
{
  "org": "acme",
  "orgDisplayName": "Acme Corp",
  "personas": { "enabled": ["code-reviewer", "security-reviewer", "test-generator"] },
  "sync": { "repos": "./repos.json", "targetDir": ".claude" }
}
```

Everything else is optional and defaulted. See `scripts/lib/config.ts` for the authoritative type.
