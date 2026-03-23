# AgentBoot Test Plan

## Test Suite Overview

| File | Tests | Scope | Runtime |
|------|-------|-------|---------|
| `validate.test.ts` | 20 | Unit: JSONC parsing, frontmatter, secret scanning, persona config validation | <100ms |
| `pipeline.test.ts` | 33 | Integration: compile → sync pipeline, scope merging, platform output | ~3s |
| `cli.test.ts` | 100 | Integration: CLI commands (AB-2/3 epics), compile features, uninstall safety, plugin, compliance, telemetry | ~9s |
| `lib.test.ts` | 50 | Unit: config utilities, frontmatter edge cases, secret scanning, scope models | <300ms |
| `config-security.test.ts` | 31 | Unit: path traversal rejection, targetDir validation, type safety, adversarial JSONC | <100ms |
| **Total** | **234** | | ~12s |

## Coverage by Feature

### Phase 1 (AB-1)

| Feature | Jira | Tests | Notes |
|---------|------|-------|-------|
| JSONC stripping | — | 5 | validate.test.ts: comments, string preservation, escaped quotes, real config |
| Frontmatter parsing | — | 4 | validate.test.ts: extraction, null case, multi-word, all real SKILL.md files |
| Secret scanning | — | 7 | validate.test.ts: passwords, API keys, AWS, private keys, GitHub tokens, safe content, real files |
| persona.config.json | — | 3 | validate.test.ts: existence, required fields, trait references |
| Validation script (AB-11) | AB-11 | 2 | pipeline.test.ts: passes all 4 checks, detects missing persona |
| Compile script (AB-12) | AB-12 | 1 | pipeline.test.ts: compiles 4 personas × 3 platforms |
| Dist structure | — | 3 | pipeline.test.ts: platform dirs, persona dirs, skill dirs |
| Skill output (AB-21) | AB-21 | 2 | pipeline.test.ts: SKILL.md with traits, persona.config.json |
| Claude output | — | 1 | pipeline.test.ts: skills/{name}/SKILL.md with CC frontmatter |
| Agent output (AB-17) | AB-17 | 1 | pipeline.test.ts: agent files with name, description, no default model |
| CLAUDE.md @imports (AB-19) | AB-19 | 1 | pipeline.test.ts: all 6 traits + 2 instructions (exact match, no .md.md) |
| Trait files (AB-19) | AB-19 | 1 | pipeline.test.ts: 6 trait files exist with content |
| Token budget (AB-25) | AB-25 | 1 | pipeline.test.ts: per-persona token estimates in output |
| Copilot output (AB-22) | AB-22 | 1 | pipeline.test.ts: copilot-instructions.md, HTML comments stripped |
| Instructions (AB-20) | AB-20 | 1 | pipeline.test.ts: instructions in all 3 platforms |
| PERSONAS.md (AB-23) | AB-23 | 1 | pipeline.test.ts: generated in every platform |
| Trait injection | — | 1 | pipeline.test.ts: correct traits per persona |
| Platform self-containment | — | 1 | pipeline.test.ts: skill/copilot parity, claude skills list |
| settings.json (AB-26) | AB-26 | 1 | pipeline.test.ts: generated with hooks/permissions |
| .mcp.json (AB-27) | AB-27 | 1 | pipeline.test.ts: generated with mcpServers |
| Sync (AB-15) | AB-15 | 5 | pipeline.test.ts: sync to target, .claude/ dir, skills, rules, PERSONAS.md |
| Manifest (AB-24) | AB-24 | 1 | pipeline.test.ts: manifest exists with correct structure and SHA-256 hashes |
| Sync idempotency | — | 1 | pipeline.test.ts: skips unchanged files on re-sync |
| Dry-run | — | 1 | pipeline.test.ts: no files written in dry-run mode |
| Copilot sync | — | 1 | pipeline.test.ts: copilot-instructions.md to .github/ |
| PR mode (AB-28) | AB-28 | 1 | pipeline.test.ts: PR mode doesn't crash without remote |
| Scope merging (AB-16) | AB-16 | 2 | pipeline.test.ts: team > group > core, group > core |
| Full pipeline | — | 1 | pipeline.test.ts: validate → compile end-to-end |

### Phase 2 (AB-2)

| Feature | Jira | Tests | Notes |
|---------|------|-------|-------|
| context:fork skill output (AB-18) | AB-18 | 6 | cli.test.ts: fork frontmatter, agent reference, all 4 skills, no double FM, stripped source FM |
| Welcome fragment (AB-77) | AB-77 | 4 | cli.test.ts: section exists, 4 invocations, descriptions, no .md.md |
| Gotchas compilation (AB-52) | AB-52 | 1 | cli.test.ts: gotcha→rules, gotcha→skill, README filtered |
| Setup wizard (AB-33) | AB-33 | 5 | cli.test.ts: config scaffold, repos.json, core dirs, no overwrite, valid JSON |
| Add persona (AB-34) | AB-34 | 7 | cli.test.ts: files created, trait markers, frontmatter, style guide, config JSON, duplicate rejection, name validation |
| Add trait (AB-35) | AB-35 | 1 | cli.test.ts: file created with correct sections |
| Add gotcha | AB-52 | 1 | cli.test.ts: file created with paths frontmatter |
| Prompt style guide (AB-55) | AB-55 | 1 | cli.test.ts: scaffold has Identity/Setup/Rules/Output/What Not To Do + style comments |
| Doctor (AB-36) | AB-36 | 3 | cli.test.ts: passes on project root, detects missing config, exit code |
| Status (AB-37) | AB-37 | 3 | cli.test.ts: shows org info, JSON output, empty repos |
| Lint (AB-38) | AB-38 | 6 | cli.test.ts: trait-too-long, severity filter, JSON output, persona filter, vague language, secrets |
| Uninstall (AB-45) | AB-45 | 5 | cli.test.ts: dry-run, removes matching hashes, skips modified, path traversal rejection, no manifest |
| Config command | — | 4 | cli.test.ts: top-level key, nested key, nonexistent key, mutation fails |
| YAML frontmatter safety | — | 3 | cli.test.ts: quoted descriptions in skills, quoted names in agents, special chars |
| CLI global | — | 2 | cli.test.ts: --version, --help |

### Phase 3 (AB-3)

| Feature | Jira | Tests | Notes |
|---------|------|-------|-------|
| Plugin structure (AB-57) | AB-57 | 7 | cli.test.ts: plugin.json fields, agents dir, skills dir, traits dir, hooks dir, rules dir, persona paths |
| Compliance hooks (AB-59/60/63) | AB-59 | 5 | cli.test.ts: input scan hook, output scan hook, telemetry hook, settings.json registration |
| Telemetry schema (AB-64) | AB-64 | 1 | cli.test.ts: JSON schema with required fields and event enum |
| Add domain/hook (AB-46) | AB-46 | 5 | cli.test.ts: domain scaffold, hook scaffold, duplicate rejection, help text |
| Export command (AB-40) | AB-40 | 3 | cli.test.ts: plugin export, marketplace export, unknown format rejection |
| Publish command (AB-41) | AB-41 | 3 | cli.test.ts: dry-run, marketplace.json creation, version bump |
| N-tier scope model (AB-88) | AB-88 | 1 | cli.test.ts: legacy groups/teams to nodes conversion |
| Privacy/telemetry config (AB-62/65) | AB-62 | 1 | cli.test.ts: config accepts privacy and telemetry fields |
| Domain layer loading (AB-53) | AB-53 | 1 | cli.test.ts: domain manifest loads correctly |
| Model selection matrix (AB-56) | AB-56 | 1 | cli.test.ts: documentation file exists with required sections |
| ACKNOWLEDGMENTS (AB-91) | AB-91 | 1 | cli.test.ts: file exists with prior art credits |
| dev-sync | — | 2 | cli.test.ts: syncs to local dirs, copies to platform-native locations |

### Shared Libraries (lib.test.ts)

| Feature | Tests | Notes |
|---------|-------|-------|
| stripJsoncComments edge cases | 8 | Empty input, no comments, comment-only lines, multiple comments, trailing whitespace, escaped quotes, no newlines, protocol URLs |
| resolveConfigPath | 5 | Default path, custom path, relative path, mixed flags, missing value |
| loadConfig | 9 | Valid config, JSONC stripping, missing file, array input, null input, missing org, empty org, bad personas.enabled, bad targetDir, minimal config |
| flattenNodes | 6 | Empty input, single node, two-level tree, three-level tree, siblings, prefix parameter |
| groupsToNodes | 5 | Empty groups, group with teams, no teams, empty teams array, multiple groups |
| parseFrontmatter edge cases | 9 | Empty block, blank-only block, minimal valid, empty values, no-colon lines, duplicate keys, value with colons, non-start position, whitespace values |
| scanForSecrets additional | 8 | Slack tokens, line numbers, multiple secrets, custom patterns, empty content, non-assignment mentions, DEFAULT_SECRET_PATTERNS validation |

### Config Security (config-security.test.ts)

| Feature | Tests | Notes |
|---------|-------|-------|
| Path traversal rejection | 5 | sync.repos, output.distPath, personas.customDir with "..", clean paths accepted, strict ".." detection |
| sync.targetDir validation | 11 | Valid targets (.claude, .cursor, .agentboot, custom), rejected targets (no dot, path separator, single dot, double dot, spaces, empty, digit after dot) |
| Type safety | 10 | Non-string org (number, boolean, null), array config, string config, number config, invalid JSON, non-string targetDir, object personas.enabled |
| Full config acceptance | 1 | All optional sections populated and returned correctly |
| Adversarial JSONC | 5 | Single-quoted strings, nested escaped quotes, line with only //, extremely long lines, triple slashes |

## Known Gaps

### Not Tested (by design or limitation)

| Gap | Reason |
|-----|--------|
| `agentboot setup` git remote detection | Would need to mock git — tested manually |
| `agentboot uninstall` directory cleanup | Tested indirectly via hash-match removal |
| `agentboot lint --fix` | Not yet implemented |
| `agentboot config` write mutation | Not yet implemented |
| `agentboot dev-build` via CLI | Tested via npm scripts in pipeline.test.ts |
| Compile with external config pointing to different core/ | compile.ts hardcodes ROOT for coreDir — design limitation |
| Token budget for group/team scope personas | compile.ts only checks core scope — known issue |
| JSONC block comments (`/* */`) | Only `//` comments supported — documented |
| Concurrent builds | Single-user build tool, no locking needed |
| sync.ts pure functions (mergeScopes, detectDrift, etc.) | Not exported — only tested via integration. Export to lib for unit testing |
| validate.ts isUnsafeRegex/buildSecretPatterns | Not exported — only exercised indirectly via integration tests |
| import.ts scanPath/classifyFile | Deterministic but untested — only normalizeContent and jaccardSimilarity have coverage |
| dev-sync.ts copyRecursive/cleanMatchingFiles | Not exported — only tested via integration |
| compile.ts pure functions | Not exported — only tested via CLI integration |

### Manual Test Checklist

Run before each release:

- [ ] `npx tsx scripts/cli.ts --help` — all commands listed
- [ ] `npx tsx scripts/cli.ts --version` — matches package.json
- [ ] `npx tsx scripts/cli.ts dev-build` — clean pipeline completes
- [ ] `npx tsx scripts/cli.ts doctor` — all checks pass
- [ ] `npx tsx scripts/cli.ts status` — shows org info
- [ ] `npx tsx scripts/cli.ts lint` — reports trait length warnings
- [ ] `npx tsx scripts/cli.ts lint --format json` — valid JSON output (no header)
- [ ] Create temp dir, run `npx tsx scripts/cli.ts setup --skip-detect`, verify files
- [ ] In project root: `npx tsx scripts/cli.ts add persona test-xyz`, verify output, delete
- [ ] Sync to temp repo, then uninstall — verify clean removal

## Bugs Found by Tests

1. **CRITICAL: Double .md.md extension** — `instrFileNames.push(file)` should be `push(name)` (fixed)
2. **CRITICAL: Uninstall hash truncation** — `.slice(0, 8)` vs full 64-char hash (fixed)
3. **ERROR: Uninstall double path prefix** — `path.join(repo, targetDir, entry.path)` doubled `.claude/` (fixed)
4. **ERROR: Status manifest wrong path** — looked at repo root, not `.claude/` (fixed)
5. **ERROR: YAML injection** — descriptions unquoted in frontmatter (fixed)
6. **ERROR: Frontmatter regex fragile** — `(?!---)` lookahead breaks on `---` in values (fixed)
7. **ERROR: Uninstall encoding mismatch** — UTF-8 string vs raw Buffer hash (fixed)
8. **WARN: Path traversal via manifest** — added boundary check (fixed)
9. **WARN: Lint JSON output** — header printed before JSON (fixed)
10. **WARN: Model/permissionMode unquoted in YAML** — inconsistent with other fields (fixed)
11. **WARN: Pipeline test substring match** — `toContain` masked .md.md bug (fixed to regex)
12. **WARN: Platform containment test** — didn't filter `gotchas/` directory (fixed)
13. **WARN: loadConfig array bypass** — `typeof [] === "object"` passes the non-object check. However, `Array.isArray(parsed)` in the same condition now correctly catches arrays and throws "Config must be a JSON object". The original lib.test.ts comment claiming arrays fall through is stale — verified by config-security.test.ts (fixed)
14. **INFO: parseFrontmatter empty block** — `---\n---` (no content) returns `null` because regex requires `[\s\S]+?` (1+ chars). Empty frontmatter is rejected silently (by design — valid SKILL.md files always have fields)
15. **INFO: lib.test.ts stale comment** — lib.test.ts:180-182 NOTE claims arrays bypass the object check and fall through to org validation. This is incorrect — `Array.isArray(parsed)` catches arrays. The test at line 188 only asserts `toThrow()` without checking the message, which masked this (unfixed comment — low priority)
