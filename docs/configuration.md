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

> Packaged, opinionated compliance domains (healthcare/fintech/govtech) are on the
> [roadmap](roadmap.md). The `domains` mechanism and `add domain` scaffold exist today.

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
| `output.failOnDirtyDist` | boolean | `false` | Fail the build if `dist/` already contains prior output (CI staleness guard). |
| `output.tokenBudget.warnAt` | number | `8000` | Per-persona estimated-token warning threshold (informational — warns, never blocks). |

> Which **platforms** to emit is controlled by `personas.outputFormats`, not `output`. There is no
> `output.format`, `output.hooks`, `output.mcp`, `output.managed`, or `output.dir` key.

---

## Platform-specific & delivery

### `claude` (experimental)

Claude Code-specific extras, emitted only for the `claude` format when set.

| Field | Type | Description |
|---|---|---|
| `claude.hooks` | object | Extra Claude Code hooks. |
| `claude.permissions` | `{ allow?: string[]; deny?: string[] }` | Permission rules. |
| `claude.mcpServers` | object | Additional MCP server entries. |

### `userLevel` — user-scope install

Controls `agentboot install-user` (writing compiled skills/rules to `~/.claude`).

| Field | Type | Default | Description |
|---|---|---|---|
| `userLevel.mode` | `"auto" \| "direct" \| "manifest"` | `auto` | `auto`: write `~/.claude` directly unless a `~/.claude/.managed` sentinel indicates another tool owns the slot (then stage for handoff). `direct`: always write. `manifest`: never write — stage resolved content + a handoff manifest for an external provider. |

### `agents` — tools & LLM provider

| Field | Type | Description |
|---|---|---|
| `agents.tools` | `("claude-code"\|"copilot"\|"cursor"\|"gemini"\|string)[]` | Which agent tools your org uses (informs output selection). |
| `agents.primary` | string | Default tool when a choice is needed. |
| `agents.llmProvider` | `"claude-code"\|"anthropic-api"\|"manual"\|string` | Provider for AgentBoot's own LLM operations (e.g. import classification). |
| `agents.llmModel` | string \| null | Model override for API providers. |
| `agents.billingAcknowledged` | boolean | Whether the user acknowledged that LLM-powered commands cost money. |

### `ab.modelOverrides`

`ab.modelOverrides` (`Record<string,string>`) overrides the model used by individual `/ab` skill
agents.

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
| `managed.guardrails.forcePlugins` | string[] | Plugins to force-install. |
| `managed.guardrails.denyTools` | string[] | Tool patterns to deny. |
| `managed.guardrails.requireAuditLog` | boolean | Require audit logging. |
| `managed.guardrails.disableBypassPermissions` | boolean | Disallow bypassing permissions. |

### `mcp` — MCP connection governance

| Field | Type | Description |
|---|---|---|
| `mcp.approved` | `McpServerEntry[]` | Allowed MCP servers (`{ name, command? }`). |
| `mcp.enforceApproved` | boolean | Reject any MCP server in a target repo not on the approved list. |
| `mcp.required` | string[] | MCP servers required in all repos. |

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

```jsonc
{
  "telemetry": { "enabled": true, "includeDevId": "hashed" }
}
```

The emitted telemetry record per persona invocation contains only:
`{ event, persona_id, timestamp, status, dev_id }` — no prompt, model, token, or cost fields.

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
