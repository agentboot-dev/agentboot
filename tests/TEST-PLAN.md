# AgentBoot Test Plan

Last updated: 2026-07-12. Total: 37 test files, 1198 tests passing.

## Test Suite Overview

| File | Tests | Scope | Runtime |
|------|-------|-------|---------|
| `validate.test.ts` | ~28 | Unit + CLI: JSONC parsing, frontmatter, secret scanning, validate --strict mode, error message quality | <200ms |
| `pipeline.test.ts` | ~42 | Integration: compile → sync pipeline, scope merging, platform output, sync idempotency, Copilot frontmatter, Cursor mutex, hook shebang | ~5s |
| `cli.test.ts` | ~115 | Integration: CLI commands (AB-2/3 epics), compile features, uninstall safety, plugin, compliance, telemetry, doctor, status | ~10s |
| `lib.test.ts` | 50 | Unit: config utilities, frontmatter edge cases, secret scanning, scope models | <300ms |
| `config-security.test.ts` | 31 | Unit: path traversal rejection, targetDir validation, type safety, adversarial JSONC | <100ms |
| `install.test.ts` | 43 | Unit: install.ts pure functions — AgentBootError, addToReposJson, detectCwd, getGitOrgAndRepo, hasPrompts, scaffoldHub, scanNearby edge cases | <200ms |
| `trait-weights.test.ts` | ~18 | Integration: trait weight system, HIGH vs OFF calibration preamble text diff in SKILL.md and Cursor .mdc | ~8s |
| `phase8.test.ts` | ~60 | Integration: Phase 8 platform output (Gemini no @imports, Windsurf, JetBrains, agents format) | ~5s |
| `build-catalog.test.ts` | ~10 | Integration: catalog HTML output, XSS escaping in name/description, component cards, detail pages | ~15s |
| `cost-estimate.test.ts` | ~18 | Unit + CLI: pricing calculation, CLI output format, human-readable table, model cost ordering | ~5s |
| `optimize.test.ts` | ~35 | Unit + CLI: optimize scoring, HTML report generation written to disk, escapeHtml | ~5s |
| `dev-sync.test.ts` | 6 | Integration: dev-sync writes to .claude/, idempotency, restart warning | ~15s |
| `mcp-server.test.ts` | ~45 | Unit: MCP tool handlers — read tools, execute tools, propose_change validation, isContainedIn security | <500ms |
| `import-phase10.test.ts` | ~20 | Unit + integration: import batching, prompt structure, retry manifest, source attribution | <300ms |
| `phase4.test.ts` | ~25 | Integration: Phase 4 features — install wizard, import system, composition manifests | ~3s |
| `phase6.test.ts` | ~30 | Integration: Phase 6 — composition consistency, override detection, behavioral test runner | ~3s |
| `phase9.test.ts` | ~15 | Integration: Phase 9 — JetBrains output, windsurf gotchas, AGENTS.md gotchas | ~5s |
| `import-expanded.test.ts` | ~40 | Integration: expanded import — whole-file, config merge, skill import, dedup, secrets | ~3s |
| `marketplace.test.ts` | ~20 | Unit: marketplace registry, search, SHA verification, license validation | <300ms |
| `contribution.test.ts` | ~15 | Unit: contribution review, duplicate detection, Jaccard similarity | <200ms |
| `export.test.ts` | ~10 | Integration: agentskills.io export, skills-index.json schema | ~3s |
| `monorepo.test.ts` | ~10 | Integration: monorepo detection, per-package sync | ~3s |
| *(other test files)* | remainder | intelligence, judge, optimize-weights, trait-weights, crossplatform-hooks, phase11-* (codex, hooks, registry, guardrails, compile, governance, audit-coverage, foundation, ab-import, user-scope), gitignore, install, contribution, cost-estimate, etc. | ~5s |
| **Total** | **1040+** | | ~52s |

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

### Automation of human-in-the-loop-priority.md (2026-04-05)

These tests convert the "Opportunities to Add Automated Tests" table in
`docs/internal/manual-testing/human-in-the-loop-priority.md` into working automated
tests. All 15 opportunities from that table are now covered.

| Source row | File | Tests added | What it proves |
|---|---|---|---|
| Error message quality (TP-03-02) | `validate.test.ts` | 2 | Unknown persona and missing trait produce actionable error messages with entity names |
| validate --strict exit code (TP-03-12) | `validate.test.ts` | 2 | --strict promotes warnings to errors; exits non-zero; **documents exit code 1 vs. documented 2** |
| Trait weight compiled diff (TP-05-01) | `trait-weights.test.ts` | 3 | HIGH weight injects adversarial calibration prose; OFF weight produces no trait block |
| doctor command (TP-02-01) | `cli.test.ts` | 3 | doctor exits 0, outputs JSON, contains at least one ok:true check |
| status command (TP-02-02) | `cli.test.ts` | 4 | status shows org info, JSON format, empty repos handling |
| dev-sync behavior (TP-04-01) | `dev-sync.test.ts` | 6 | NEW FILE — dev-sync writes to .claude/, reports file count, idempotency, restart warning |
| Scope hierarchy (TP-06-01) | `pipeline.test.ts` | 2 | team persona overrides group; group persona overrides core |
| XSS in PERSONAS.md / catalog (TP-10-10) | `build-catalog.test.ts` | 2 | `<script>` in name is escaped; `<p>` content escaped; **exposes data-search bug** |
| Copilot frontmatter required fields (TP-07-01) | `pipeline.test.ts` | 1 | All .agent.md files contain `description:` and `model:` |
| Gemini no @imports (TP-08-05) | `phase8.test.ts` | 2 | GEMINI.md and per-persona files contain no lines starting with `@` |
| Cursor alwaysApply/globs mutex (TP-09-01) | `pipeline.test.ts` | 1 | No .mdc file has both alwaysApply:true and a globs value simultaneously |
| generateHtmlReport to disk (TP-11-05) | `optimize.test.ts` | 3 | Report written as valid HTML file >500 bytes, no external script refs, empty metrics valid |
| cost-estimate table format (TP-13-10/11/12) | `cost-estimate.test.ts` | 4 | Non-zero $ amounts, all 4 personas shown, opus>sonnet cost ordering, 3-digit token counts |
| sync idempotency (TP-15-01) | `pipeline.test.ts` | 1 | SHA-256 hash of synced file identical after two consecutive sync runs |
| Hook shebang line (TP-16-01) | `pipeline.test.ts` | 1 | All hook scripts in dist/claude/core/hooks/ start with `#!/` |

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
| validate.ts isUnsafeRegex/buildSecretPatterns | Exported and tested in validate.test.ts |
| import.ts scanPath/classifyFile | Deterministic but untested — only normalizeContent and jaccardSimilarity have coverage |
| dev-sync.ts copyRecursive/cleanMatchingFiles | Not exported — only tested via integration |
| compile.ts pure functions | Not exported — only tested via CLI integration |
| Catalog HTML in browser (headless) | Requires Playwright/Puppeteer — see integration stub in build-catalog.test.ts |
| XSS in data-search attribute | Fixed — see "Bugs Found" #16 below. `escapeHtml()` is now applied to the `data-search` attribute |

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

### Bugs Found in 2026-04-05 Session (from automation of human-in-the-loop-priority.md)

16. **ERROR: XSS in data-search attribute (build-catalog.ts — FIXED)** — Previously the `data-search` HTML attribute received the raw component description while `<p>` text content was escaped, allowing an attacker who controls a registry component description to inject attribute-context XSS payloads. `scripts/build-catalog.ts` now calls `escapeHtml()` on the name and description when building the `data-search` attribute; `tests/build-catalog.test.ts` asserts the escaped output.

17. **WARN: validate --strict exits code 1, not code 2 (validate.ts — OPEN)** — The manual test plan (TP-03-12) documents that `validate --strict` should exit with code 2 when warnings are promoted to errors. The implementation exits with code 1 (the default `process.exit(1)` path). There is no `process.exit(2)` in `scripts/validate.ts`. The `tests/validate.test.ts` strict-mode tests document this as the actual behavior. To fix: add a dedicated exit code 2 path for strict-mode failures in validate.ts, then update the test to assert `status === 2`.
