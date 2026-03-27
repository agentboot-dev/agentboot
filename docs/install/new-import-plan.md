# Plan: hasPrompts detection, import offers, and same-org repo registration

## Context

The install wizard's detection of existing agentic content is fragmented and incomplete. `scanNearby` only checks for `.claude/` directories, `detectCwd` inventories `.claude/` contents but misses root-level `CLAUDE.md`, and neither detects `.cursorrules` or Copilot instructions. The user wants a single `hasPrompts()` function that covers all known agentic file locations, a manifest of what it found, and an interactive install flow that uses this to offer individual imports and same-org repo registration.

---

## Changes

### 1. New helper: `hasPrompts(dirPath)` -> `{ found: boolean; files: string[] }`

**File:** `scripts/lib/install.ts` (exported)

Shallow existence checks for known agentic files:
- `.claude/` non-empty (excluding `.agentboot-archive`, `.agentboot-manifest.json`)
- Root `CLAUDE.md`
- `.cursorrules`
- `.github/copilot-instructions.md`
- `.github/prompts/*.prompt.md`

Returns relative paths in the `files` array. No file reading, no classification. Each check wrapped in try/catch for permission errors.

---

### 2. New helper: `getGitOrgAndRepo(dirPath)` -> `{ org: string; repo: string } | null`

**File:** `scripts/lib/install.ts` (exported)

Extracts org and repo name from `git remote get-url origin`. Replaces 4+ duplicated instances of the same regex pattern throughout install.ts.

---

### 3. New helper: `addToReposJson(hubDir, repoPath, label)` -> `boolean`

**File:** `scripts/lib/install.ts` (exported)

Reads repos.json, checks for duplicate (by path or label), appends entry, writes back. Returns false if already registered. Replaces duplicated repos.json write logic in Path 1 and Path 2.

---

### 4. Update `scanNearby` to use `hasPrompts`

Return type changes from `"hub" | "claude"` to `"hub" | "prompts"`. Results include `files?: string[]` for prompts entries. Uses `hasPrompts()` instead of bare `.claude/` existence check. Still checks cwd and siblings.

---

### 5. Update `detectCwd` to add `promptFiles`

Add `promptFiles: string[]` to `DetectionResult`, populated by `hasPrompts(cwd)`. Existing `claudeArtifacts` stays unchanged (it serves the detailed `.claude/` inventory purpose).

---

### 6. Update Path 1 Step 1.3: Individual import offers

Replace the batch summary with per-directory offers:

1. Scan siblings (and cwd) using the updated `scanNearby` (which now uses `hasPrompts`).
2. Filter for `type === "prompts"`.
3. For each discovered directory, offer individually:
   ```
   Found agentic content in {basename} ({N} files). Note for import? (Y/n)
   ```
   If yes, print:
   ```
   Run: agentboot import --path {dir}
   ```
   (Do NOT execute import -- it requires LLM access.)
4. After all discovered dirs, enter a loop:
   ```
   Check another folder for content? (Y/n)
   ```
   If yes -> prompt for path -> `hasPrompts(path)` -> show results -> repeat.
   If no -> break.

Note: Import is not executed during install (requires LLM). We note the commands for the user to run after install completes.

---

### 7. Update Path 1 Step 1.6: Same-org repo registration

After first repo is registered:

1. Extract git org from registered repo using `getGitOrgAndRepo`.
2. Scan siblings for git repos with matching org (check for `.git/` dir, then `getGitOrgAndRepo`).
3. For each match (not already in repos.json, not the hub), offer individually:
   ```
   Register {org/repo-name}? (Y/n)
   ```
   If yes, add via `addToReposJson`.
4. After discovered repos, loop:
   ```
   Register another repo? (Y/n)
   ```
   If yes -> prompt for path -> validate -> register -> repeat.
   If no -> break.

---

### 8. Global hub registry: `~/.agentboot/config.json` — DEFERRED

> **Status:** This section is deferred to a future story. The approved implementation
> plan (AB-99) covers Sections 1–7 and 9 only. This section remains as design
> documentation for future work.

AgentBoot commands currently only work when run from inside the hub repo (they look for `agentboot.config.json` in cwd). There's no way to find the hub from a spoke repo or a random directory.

**Solution:** A global config file at `~/.agentboot/config.json` that maps org slugs to hub paths:

```json
{
  "hubs": {
    "acme-corp": "/Users/mike/work/personas"
  }
}
```

**When written:**
- `agentboot install --hub` (Path 1): after `scaffoldHub` completes, write the hub path keyed by org slug
- `agentboot install --connect` (Path 2): after hub is located and validated, write it

**New helpers** (in new `scripts/lib/global-config.ts`):

```typescript
// Read the global config (returns {} if missing or corrupt)
export function readGlobalConfig(): { hubs?: Record<string, string> }

// Write/update a hub entry in the global config
export function registerHub(orgSlug: string, hubPath: string): void

// Find a hub — the lookup chain used by all CLI commands:
//   1. cwd has agentboot.config.json? → cwd is the hub
//   2. ~/.agentboot/config.json has a hub for this org? → use that path
//   3. null (no hub found)
export function findHub(orgSlug?: string): string | null
```

**How CLI commands use it:**
- Commands that currently require cwd to be the hub (`build`, `sync`, `validate`, `doctor`, `status`, `lint`) gain a `findHub()` fallback. If cwd isn't a hub, check the global config. `agentboot status` works from any directory.
- The `--config` flag still takes precedence over everything.

**Impact on install flow — install reads global config first:**

The very first thing `runInstall()` does (before asking which path) is check
`~/.agentboot/config.json` for existing orgs/hubs. This changes the entry flow:

```
1. Read global config
2. If no orgs registered:
     "No existing AgentBoot org found."
     → proceed to current path selection (create hub / connect to hub)
3. If one or more orgs registered:
     "Found existing org: acme-corp (hub: /Users/mike/work/personas)"
     → "What would you like to do?"
        - Use this org (import content, register repos, etc.)
        - Create a new org/hub
     If "use this org":
       → skip hub creation, go straight to import offers + repo registration
       → the install becomes a "manage my existing setup" flow
```

This makes `agentboot install` re-runnable. First run creates the org/hub.
Subsequent runs detect the existing setup and offer to do more (import, register
repos, re-scan). The install wizard is a convenience entry point, not a one-time
operation.

**What install does NOT do on re-run:**
- Edit or delete personas, traits, or gotchas (use `agentboot add`, or edit directly)
- Uninstall from spokes (use `agentboot uninstall`)
- Modify the hub config (use `agentboot config`)

The wizard should tell the user this at the end:
> "Everything you just did can be managed individually. See `agentboot --help`."

**Tests (~6 in `tests/global-config.test.ts`):**
- `readGlobalConfig` returns empty object when file missing
- `registerHub` creates `~/.agentboot/config.json` if absent
- `registerHub` adds new org without clobbering existing entries
- `registerHub` updates existing org path
- `findHub` returns cwd when agentboot.config.json exists
- `findHub` falls back to global config when cwd is not a hub

---

### 9. Update existing callers

- Path 1 line 621: `s.type === "claude"` -> `s.type === "prompts"`
- Path 2 line 881: already filters `"hub"` only -- no change needed
- Tests that assert on `type: "claude"` -> update to `"prompts"`

---

## Critical files

| File | Action |
|------|--------|
| `scripts/lib/install.ts` | Add `hasPrompts`, `getGitOrgAndRepo`, `addToReposJson`, `registerHub`. Update `scanNearby`, `detectCwd`, Path 1 Steps 1.3 and 1.6. Deduplicate git remote parsing. |
| `scripts/lib/global-config.ts` | New file. `readGlobalConfig`, `findHub`. Manages `~/.agentboot/config.json`. |
| `scripts/cli.ts` | Update command resolution to use `findHub()` fallback when cwd is not a hub. |
| `tests/cli.test.ts` | Add tests for `hasPrompts` (~11), `getGitOrgAndRepo` (~4), `addToReposJson` (~5), updated `scanNearby` (~3). Update existing scanNearby tests for type rename. |
| `tests/global-config.test.ts` | New file. Tests for `readGlobalConfig`, `registerHub`, `findHub` (~6). |

---

## Tests

### `hasPrompts` (~11 tests)
- Empty dir returns `found: false`
- Non-empty `.claude/` detected
- `.claude/` with only `.agentboot-manifest.json` returns `found: false`
- Root `CLAUDE.md` detected
- `.cursorrules` detected
- `.github/copilot-instructions.md` detected
- `.github/prompts/*.prompt.md` files detected
- Mixed content returns all files
- `.agentboot-archive` excluded from `.claude/` check
- Permission errors handled gracefully
- Files array contains relative paths

### `getGitOrgAndRepo` (~4 tests)
- Extracts org and repo from HTTPS remote
- Extracts org and repo from SSH remote
- Returns null for directory without `.git`
- Returns null for git repo without remote

### `addToReposJson` (~5 tests)
- Adds entry to empty repos.json
- Adds entry to existing repos.json
- Returns false if repo already registered by path
- Returns false if repo already registered by label
- Creates valid JSON output

### `scanNearby` updates (~3 tests)
- Detects sibling with root `CLAUDE.md` but no `.claude/` directory
- Detects sibling with `.cursorrules`
- Results include `files` array for prompts-type entries

### Global config (~6 tests, in `tests/global-config.test.ts`)
- `readGlobalConfig` returns empty object when file missing
- `registerHub` creates `~/.agentboot/config.json` if absent
- `registerHub` adds new org without clobbering existing entries
- `registerHub` updates existing org path
- `findHub` returns cwd when `agentboot.config.json` exists
- `findHub` falls back to global config when cwd is not a hub

---

## Verification

```bash
npx tsc --noEmit          # type-check
npx vitest run tests/     # all tests pass
agentboot doctor           # still works
```

---

## Out of scope (future subcommands)

The install wizard is a convenience that bundles several operations into a guided
flow. Everything it does should be independently repeatable or reversible via
subcommands. Two gaps exist today:

### `agentboot org list/set/remove`

Manages the global hub registry (`~/.agentboot/config.json`). The install wizard
writes to this file, but there's no subcommand to inspect or modify it afterward.

```bash
agentboot org list                          # show registered orgs and hub paths
agentboot org set acme-corp ~/work/personas # register or update a hub path
agentboot org remove acme-corp              # remove an org from the registry
```

Without this, users who need to move their hub directory, rename their org, or
clean up stale entries must hand-edit `~/.agentboot/config.json`. That's workable
for power users but inconsistent with the CLI-managed philosophy.

### `agentboot repo list/add/remove`

Manages target repo registration (`repos.json` in the hub). The install wizard
and `install --connect` both write to this file, but there's no dedicated
subcommand.

```bash
agentboot repo list                         # show registered repos with sync status
agentboot repo add ~/work/api-service       # register a repo (detects org/name from git)
agentboot repo remove ~/work/api-service    # unregister a repo
agentboot repo add ~/work/web-app --group platform --team web  # with scope
```

Currently, users edit `repos.json` directly or re-run the install wizard. The
`status` command already reads repos.json and shows sync state — `repo list`
would be a focused subset of that.

### Install wizard messaging

During the install, after imports and registrations, we should tell the user:

> "Everything you just did can be managed individually:
>   - Import more content:   agentboot import --path <dir>
>   - Register more repos:   agentboot repo add <path>   (future)
>   - Manage your org:       agentboot org set <slug> <path>  (future)
>   - Uninstall from a repo: agentboot uninstall --repo <path>"

This sets the expectation that install is a convenience, not the only path. Until
`org` and `repo` subcommands ship, the message references `repos.json` and
`~/.agentboot/config.json` directly.
