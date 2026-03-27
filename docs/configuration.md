---
sidebar_label: "Configuration"
sidebar_position: 3
---

# Configuration Reference

This document is the complete reference for `agentboot.config.json`. Every field is
documented with its type, default value, and an example.

---

## JSON Schema

The config file is validated against the following JSON Schema on every `npm run build`
and `npm run validate` invocation. Validation errors block the build.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://agentboot.dev/schema/config/v1",
  "title": "AgentBoot Configuration",
  "type": "object",
  "required": ["org"],
  "additionalProperties": false,
  "properties": {
    "org": {
      "type": "string",
      "description": "Your organization identifier. Used as a namespace in generated files.",
      "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
    },
    "orgDisplayName": {
      "type": "string",
      "description": "Human-readable organization name. Used in generated file headers and welcome messages. Falls back to org if not set."
    },
    "groups": {
      "type": "object",
      "description": "Group definitions. Keys are group names; values describe the group.",
      "additionalProperties": {
        "$ref": "#/definitions/GroupConfig"
      }
    },
    "personas": {
      "$ref": "#/definitions/PersonasConfig"
    },
    "traits": {
      "$ref": "#/definitions/TraitsConfig"
    },
    "sync": {
      "$ref": "#/definitions/SyncConfig"
    },
    "output": {
      "$ref": "#/definitions/OutputConfig"
    },
    "extend": {
      "$ref": "#/definitions/ExtendConfig"
    }
  },
  "definitions": {
    "GroupConfig": {
      "type": "object",
      "required": ["teams"],
      "additionalProperties": false,
      "properties": {
        "teams": {
          "type": "array",
          "items": { "type": "string" },
          "description": "List of team names within this group."
        },
        "personas": {
          "$ref": "#/definitions/PersonasConfig",
          "description": "Group-level persona overrides. Merged with org-level config."
        },
        "traits": {
          "$ref": "#/definitions/TraitsConfig",
          "description": "Group-level trait overrides."
        },
        "extend": {
          "type": "string",
          "description": "Path to group-level persona extensions directory."
        }
      }
    },
    "PersonasConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": {
          "type": "array",
          "items": { "type": "string" },
          "description": "List of persona IDs to include in the build.",
          "default": ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"]
        },
        "extend": {
          "type": ["string", "null"],
          "description": "Path to a directory containing additional persona definitions.",
          "default": null
        }
      }
    },
    "TraitsConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": {
          "type": "array",
          "items": { "type": "string" },
          "description": "List of trait IDs to include. All listed traits must exist in core/traits/ or an extension directory.",
          "default": ["critical-thinking", "structured-output", "source-citation", "confidence-signaling", "audit-trail"]
        }
      }
    },
    "SyncConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "repos": {
          "type": ["string", "array"],
          "description": "Path to repos.json file, or an inline array of RepoConfig objects.",
          "default": "./repos.json"
        },
        "mode": {
          "type": "string",
          "enum": ["local", "github-api"],
          "description": "Sync mode. 'local' writes to local filesystem paths. 'github-api' creates PRs via the GitHub API.",
          "default": "local"
        },
        "pr": {
          "$ref": "#/definitions/SyncPrConfig"
        }
      }
    },
    "SyncPrConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "When true (and mode is 'local'), the sync script commits and opens a PR in each target repo after writing files.",
          "default": false
        },
        "branch_prefix": {
          "type": "string",
          "description": "Git branch prefix for sync PRs.",
          "default": "agentboot/sync-"
        },
        "title_template": {
          "type": "string",
          "description": "PR title template. Supports {version} and {date} placeholders.",
          "default": "chore: AgentBoot persona sync {version}"
        }
      }
    },
    "OutputConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "dir": {
          "type": "string",
          "description": "Subdirectory within each target repo where compiled output is written.",
          "default": ".claude"
        },
        "personas_registry": {
          "type": "boolean",
          "description": "When true, generates PERSONAS.md in the root of the personas repo after each build.",
          "default": true
        }
      }
    },
    "ExtendConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "domains": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Array of paths to domain layer directories. Applied in order.",
          "default": []
        },
        "instructions": {
          "type": ["string", "null"],
          "description": "Path to an org-level always-on instruction fragment. Prepended to the generated CLAUDE.md.",
          "default": null
        }
      }
    }
  }
}
```

---

## Field Reference

### `org`

**Type:** `string`
**Required:** Yes
**Pattern:** Lowercase alphanumeric and hyphens, no leading/trailing hyphen

Your organization identifier. Used as a namespace prefix in generated file headers and
in the PERSONAS.md registry. Does not need to match your GitHub organization name,
but using the same value reduces confusion.

```json
"org": "acme-corp"
```

---

### `orgDisplayName`

**Type:** `string`
**Required:** No
**Default:** Falls back to `org`

Human-readable organization name. Used in generated file headers (e.g.,
`AgentBoot — Acme Corporation`) and in welcome messages during install. Unlike `org`,
this value has no format restrictions — it can contain spaces, capitalization, and
special characters.

```json
"orgDisplayName": "Acme Corporation"
```

**Migration:** If your hub was created before `orgDisplayName` was added, `agentboot doctor`
will suggest setting it. Run `agentboot config orgDisplayName "Your Org Name"` or edit
`agentboot.config.json` directly.

---

### `groups`

**Type:** `object`
**Required:** No
**Default:** `{}`

Defines the group structure of your organization. Keys are group names (lowercase,
hyphen-separated). Values are `GroupConfig` objects.

Groups represent horizontal slices of your organization — typically engineering
departments or platform areas. A group has teams and can have group-level persona
and trait overrides.

```json
"groups": {
  "platform": {
    "teams": ["api", "infra", "data"],
    "personas": {
      "enabled": ["code-reviewer", "security-reviewer", "test-generator", "api-contract-reviewer"]
    }
  },
  "product": {
    "teams": ["web", "mobile", "growth"]
  }
}
```

Repos registered to a team inherit the group's configuration on top of the org default.
In the example above, repos in the `platform` group receive the `api-contract-reviewer`
persona in addition to the org default set; repos in the `product` group receive only
the org defaults.

---

### `groups[name].teams`

**Type:** `string[]`
**Required:** Yes within a group definition

List of team names that belong to this group. Team names are used to match repos in
`repos.json` to their group for layered configuration.

---

### `groups[name].personas`

**Type:** `PersonasConfig`
**Required:** No
**Default:** Inherits org-level `personas` config

Group-level persona configuration. If specified, the group's `enabled` list is **merged
with** the org-level list — it does not replace it. The group can add personas; it cannot
remove org-level personas.

---

### `groups[name].traits`

**Type:** `TraitsConfig`
**Required:** No
**Default:** Inherits org-level `traits` config

Group-level trait configuration. Same merge semantics as `groups[name].personas`.

---

### `groups[name].extend`

**Type:** `string`
**Required:** No
**Default:** `null`

Path to a directory containing group-level persona extensions. Same format as
`personas.customDir` at the org level.

---

### `personas`

**Type:** `PersonasConfig`
**Required:** No

Org-level persona configuration.

---

### `personas.enabled`

**Type:** `string[]`
**Required:** No
**Default:** `["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"]`

List of persona IDs to include in the build. IDs must match the directory name under
`core/personas/` or the ID declared in a persona SKILL.md frontmatter in an extension
directory.

Removing a persona from `enabled` removes it from the build output and from all synced
repos.

```json
"personas": {
  "enabled": ["code-reviewer", "security-reviewer"]
}
```

---

### `personas.customDir`

**Type:** `string | null`
**Required:** No
**Default:** `null`

Path to a directory containing additional persona definitions, relative to
`agentboot.config.json`. Personas in this directory are added to the build on top of
the `enabled` list from core. The directory must follow the same structure as
`core/personas/`: one subdirectory per persona, each containing a `SKILL.md`.

```json
"personas": {
  "enabled": ["code-reviewer", "security-reviewer"],
  "customDir": "./personas"
}
```

---

### `traits`

**Type:** `TraitsConfig`
**Required:** No

Org-level trait configuration.

---

### `traits.enabled`

**Type:** `string[]`
**Required:** No
**Default:** All traits in `core/traits/`

List of trait IDs to include in the build. Trait IDs must match the filename (without
`.md`) under `core/traits/` or in a domain layer's `traits/` directory.

You rarely need to set this explicitly. The default includes all core traits. Only set
this if you want to deliberately exclude a core trait from your org's builds (unusual).

---

### `sync`

**Type:** `SyncConfig`
**Required:** No

Controls how compiled output is distributed to target repos.

---

### `sync.repos`

**Type:** `string | RepoConfig[]`
**Required:** No
**Default:** `"./repos.json"`

Path to a JSON file containing the list of repos, or an inline array. When a string,
the path is relative to `agentboot.config.json`. The referenced file (or inline array)
must be an array of `RepoConfig` objects:

```json
[
  {
    "name": "my-org/my-repo",
    "path": "/absolute/path/to/my-repo",
    "team": "api",
    "group": "platform"
  }
]
```

`name` is the GitHub repo slug (used in PR titles and sync commit messages). `path` is
the absolute local filesystem path used in `local` sync mode. `team` and `group` must
match values declared in the `groups` config. `platform` determines which output format
the repo receives:

```json
[
  {
    "name": "my-org/my-repo",
    "path": "/absolute/path/to/my-repo",
    "team": "api",
    "group": "platform",
    "platform": "claude-code"
  }
]
```

Valid `platform` values: `"claude-code"` (default), `"copilot"`, `"cross-platform"`.
When `output.format` is `"both"`, the sync script uses this field to select the right
output for each repo.

---

### `sync.mode`

**Type:** `"local" | "github-api"`
**Required:** No
**Default:** `"local"`

Controls how the sync script delivers compiled output.

- `"local"`: Writes files directly to `path` in each repo entry. Fastest for local
  development and CI workflows where you check out the repos.
- `"github-api"`: Creates a PR in each target repo via the GitHub API without requiring
  a local checkout. Requires a `GITHUB_TOKEN` environment variable with write access to
  all target repos.

---

### `sync.pr.enabled`

**Type:** `boolean`
**Required:** No
**Default:** `false`

When `true` in `local` mode, the sync script automatically commits the written files
and opens a PR in each target repo. Requires the local repo to have a clean working
tree and a configured git identity.

---

### `sync.pr.branch_prefix`

**Type:** `string`
**Required:** No
**Default:** `"agentboot/sync-"`

Git branch prefix for sync PRs. A timestamp or version suffix is appended automatically.
Example result: `agentboot/sync-2026-03-17`.

---

### `sync.pr.title_template`

**Type:** `string`
**Required:** No
**Default:** `"chore: AgentBoot persona sync {version}"`

PR title template. Supported placeholders: `{version}` (the AgentBoot version from
package.json), `{date}` (ISO date of the sync run), `{org}` (the org identifier).

---

### `output.dir`

**Type:** `string`
**Required:** No
**Default:** `".claude"`

The subdirectory within each target repo where the sync script writes compiled output.
Defaults to `.claude`, which is the directory Claude Code reads for always-on
instructions, personas, and path-scoped instructions.

Change this if you want to use AgentBoot with a different AI agent tool that reads
from a different directory (e.g., `.github/copilot-instructions.md` for GitHub Copilot).

---

### `output.personas_registry`

**Type:** `boolean`
**Required:** No
**Default:** `true`

When `true`, the build step generates `PERSONAS.md` in the root of the personas repo.
This file is the human-readable registry of all compiled personas. CI checks that this
file is up to date on every PR.

---

### `output.format`

**Type:** `"claude-code" | "cross-platform" | "both"`
**Required:** No
**Default:** `"both"`

Controls which compilation target the build produces.

- `"claude-code"`: Generates Claude Code-native output using the full feature surface —
  `.claude/agents/` with rich frontmatter (model, tools, hooks, MCP), `.claude/skills/`
  with `context: fork`, `.claude/rules/` with `paths:` frontmatter, `.claude/traits/` as
  separate files for `@import`, `.claude/CLAUDE.md` using `@imports`, `.claude/settings.json`
  with hook entries, and `.claude/.mcp.json`. This is the optimal output for organizations
  using Claude Code.

- `"cross-platform"`: Generates standalone output that works across all agent platforms —
  inlined SKILL.md (agentskills.io format), `copilot-instructions.md`, and a flattened
  `CLAUDE.md`. Traits are baked into each persona file. No @imports, no hooks, no MCP
  config.

- `"both"`: Generates both formats. Use this when your organization has repos using
  different agent platforms. The sync script writes the appropriate format per repo
  based on the repo's `platform` field in `repos.json`.

---

### `output.hooks`

**Type:** `boolean`
**Required:** No
**Default:** `true`

When `true` and output format includes `claude-code`, the build step generates
`.claude/settings.json` with hook entries from domain layer hook configurations.
Hooks are merged across scopes (org → group → team) with the same precedence rules
as other configuration.

---

### `output.mcp`

**Type:** `boolean`
**Required:** No
**Default:** `true`

When `true` and output format includes `claude-code`, the build step generates
`.claude/.mcp.json` with MCP server configurations referenced by agent frontmatter.

---

### `output.managed`

**Type:** `boolean`
**Required:** No
**Default:** `false`

When `true`, the build step generates managed settings artifacts in `dist/managed/`
for MDM deployment. These are the non-overridable HARD guardrail files:
- `managed-settings.json` — hooks and permissions that no user can override
- `managed-mcp.json` — MCP servers that are always active
- `CLAUDE.md` — instructions that are always prepended

Managed settings are deployed to system paths via MDM (JumpCloud, Jamf, Intune), not
via the sync script. The build generates the artifacts; your MDM pipeline distributes
them.

---

### `extend.domains`

**Type:** `string[]`
**Required:** No
**Default:** `[]`

Array of paths to domain layer directories, relative to `agentboot.config.json`.
Domain layers are applied in order — traits and personas from later domains are merged
on top of earlier ones. No domain can override a core trait or persona that has been
marked required.

```json
"extend": {
  "domains": ["./domains/healthcare", "./domains/federal"]
}
```

---

### `extend.instructions`

**Type:** `string | null`
**Required:** No
**Default:** `null`

Path to a Markdown file containing org-level always-on instructions. The content is
prepended to the generated `CLAUDE.md` in every synced repo, before group, team, and
path-scoped instructions. Use this for universal rules that must be active in every
Claude Code session across your entire organization.

```json
"extend": {
  "instructions": "./instructions/org-always-on.md"
}
```

---

### `telemetry`

**Type:** `TelemetryConfig`
**Required:** No

Controls telemetry output. AgentBoot telemetry is local-only NDJSON — no data is sent
to any external service.

---

### `telemetry.enabled`

**Type:** `boolean`
**Required:** No
**Default:** `false`

When `true`, hooks write telemetry events to the NDJSON log file.

---

### `telemetry.includeDevId`

**Type:** `false | "hashed" | "email" | "email-raw"`
**Required:** No
**Default:** `false`

Controls how developer identity appears in telemetry records:

- `false` — no developer identifier is included
- `"hashed"` — SHA-256 hash of the developer's git email
- `"email"` — **hashed** email (same as `"hashed"`, for backward compatibility)
- `"email-raw"` — raw email address (requires explicit opt-in)

Note: `"email"` defaults to hashed output, not raw. If you need raw email addresses
in telemetry, you must explicitly use `"email-raw"`.

---

### `telemetry.logPath`

**Type:** `string`
**Required:** No
**Default:** `"~/.agentboot/telemetry.ndjson"`

Path to the NDJSON telemetry log file. Subject to path traversal validation — the
path must resolve to a location under the user's home directory or the hub directory.

---

### `telemetry.includeContent`

**Type:** `false`
**Required:** No
**Default:** `false`

Design invariant: raw prompt content is never included in telemetry. This field
exists in the schema to make the invariant explicit — it cannot be set to `true`.

---

## Complete example

```jsonc
{
  "org": "acme-corp",
  "orgDisplayName": "Acme Corporation",
  "groups": {
    "platform": {
      "teams": ["api", "infra", "data"],
      "personas": {
        "enabled": [
          "code-reviewer",
          "security-reviewer",
          "test-generator",
          "test-data-expert",
          "api-contract-reviewer"
        ]
      }
    },
    "product": {
      "teams": ["web", "mobile", "growth"]
    }
  },
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator"],
    "customDir": "./personas"
  },
  "traits": {
    "enabled": [
      "critical-thinking",
      "structured-output",
      "source-citation",
      "confidence-signaling",
      "audit-trail"
    ]
  },
  "sync": {
    "repos": "./repos.json",
    "mode": "local",
    "pr": {
      "enabled": true,
      "branch_prefix": "agentboot/sync-",
      "title_template": "chore: AgentBoot persona sync {version}"
    }
  },
  "output": {
    "dir": ".claude",
    "format": "both",
    "personas_registry": true,
    "hooks": true,
    "mcp": true,
    "managed": false
  },
  "extend": {
    "domains": ["./domains/fintech-compliance"],
    "instructions": "./instructions/acme-always-on.md"
  }
}
```
