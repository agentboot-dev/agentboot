# Config Schema Audit

Pre-release audit of `agentboot.config.json` and `persona.config.json` schemas. Fields are hard to rename after adoption.

**Date:** 2026-03-21
**Status:** Pre-release review

---

## agentboot.config.json

### Root Fields

| Field | Type | Used | Status |
|-------|------|------|--------|
| `org` | string | Yes | OK — required, no change |
| `orgDisplayName` | string | Yes | OK — defaults to `org` |
| `groups` | Record | Yes | See issue #1 |
| `personas` | object | Yes | See issues #2, #3 |
| `traits` | object | Yes | OK |
| `instructions` | object | Yes | OK |
| `output` | object | Yes | See issue #5 |
| `sync` | object | Yes | See issues #6, #7 |
| `claude` | object | Yes | See issue #8 |
| `validation` | object | Yes | OK |

### Issues Found

#### CRITICAL — Fix before public release

**1. `groups[].label` is defined but never used**
`GroupConfig.label` exists in the TypeScript interface but no code reads it. Dead field in the schema.
- Recommendation: Remove from interface and example config, or implement display in PERSONAS.md output.

**2. `personas.customDir` — unclear name**
Does it extend, override, or supplement core personas? The behavior is "load additional personas from this path" but the name suggests inheritance.
- Recommendation: Rename to `personas.customDir` or `personas.additionalDir`.

**3. `personas.outputFormats` not validated**
Accepts any string but only recognizes `"skill"`, `"claude"`, `"copilot"`. Invalid values are silently ignored.
- Recommendation: Validate against allowed set. Error on unknown formats.

#### HIGH — Fix before 1.0

**4. `repos[].platform` allows unimplemented values**
`"cursor"` and `"gemini"` are accepted in repos.json but compile.ts doesn't generate output for them.
- Recommendation: Restrict to implemented platforms or emit a clear warning.

**5. `output.tokenBudget.warnAt` — unclear intent**
Warns when exceeded but doesn't block. Is this informational or a hard limit?
- Recommendation: Document design intent. If informational, rename to `output.tokenBudget.warnAt`. If hard limit, enforce it.

**6. `sync.pr.*` — implemented but commented out in example config**
PR mode works in code but users can't discover it from the config file.
- Recommendation: Uncomment the PR section with a note that it's optional.

**7. `sync.pr.titleTemplate` not validated**
`branchPrefix` has regex validation but `titleTemplate` doesn't. Inconsistent security posture.
- Recommendation: Add validation for `titleTemplate` to match `branchPrefix`.

#### MEDIUM — Polish

**8. `claude.hooks`, `claude.permissions`, `claude.mcpServers` — Phase 2 features exposed**
These generate settings.json and .mcp.json but CC integration is incomplete. Users may expect full functionality.
- Recommendation: Add clear comments marking these as experimental.

**9. `output.tokenBudget.warnAt` — deeply nested for one field**
`output.tokenBudget.warnAt` is 3 levels deep for a single number.
- Recommendation: Keep for now (anticipate adding `perTrait`, `total` later), but document why.

**10. Default values not documented in example config**
`repos[].platform` defaults to `"claude"`, `sync.pr.branchPrefix` defaults to `"agentboot/sync-"`, etc.
- Recommendation: Add comments documenting defaults in the example config file.

---

## persona.config.json

| Field | Type | Required | Status |
|-------|------|----------|--------|
| `name` | string | Yes | OK |
| `description` | string | Yes | OK |
| `invocation` | string | No | OK — defaults to `/{dir-name}` |
| `model` | string | No | OK |
| `permissionMode` | string | No | OK |
| `traits` | string[] | No | OK |
| `groups.{name}.traits` | string[] | No | OK — trait inheritance well-designed |
| `teams.{name}.traits` | string[] | No | OK — dedup works correctly |

**No issues found.** The persona config schema is clean and well-designed. Trait inheritance (core + group + team with dedup) works as expected.

---

## repos.json

| Field | Type | Required | Status |
|-------|------|----------|--------|
| `path` | string | Yes | OK |
| `platform` | string | No | See issue #4 |
| `group` | string | No | OK — validated against config |
| `team` | string | No | OK — validated against group |
| `label` | string | No | OK |

---

## Before Public Release Checklist

- [ ] Remove `groups[].label` or implement it
- [ ] Rename `personas.customDir` to `personas.customDir`
- [ ] Validate `personas.outputFormats` against allowed set
- [ ] Restrict `repos[].platform` to implemented platforms
- [ ] Clarify `tokenBudget` design intent
- [ ] Uncomment `sync.pr` in example config (with "optional" note)
- [ ] Add default value comments to example config
- [ ] Mark `claude.*` fields as experimental in example config

---

## Recommendation

The schema is ~85% production-ready. The critical issue is `groups.label` (dead code) and `personas.customDir` (unclear name). Everything else is polish. No fundamental restructuring needed — the hierarchy (org → groups → teams, traits → personas → output) is sound.
