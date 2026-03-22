# Audit Findings — 2026-03-19 Session

Consolidated from 7 parallel audit agents reviewing all public docs.
Prioritized by severity. Issues marked FIXED have been resolved in this session.

---

## CRITICAL (Must Fix Before Commit)

| # | Issue | File(s) | Status |
|---|-------|---------|--------|
| 1 | WORK-IN-PROGRESS.md is public with SSH key paths, personal account details, and internal strategy | WORK-IN-PROGRESS.md | FIXED — moved to docs/internal/ |
| 2 | "O3, O4" origin codes remain in concepts.md line 214 | concepts.md | FIXED |
| 3 | "O7" origin code in agentboot-coverage.md line 348 | agentboot-coverage.md | FIXED |
| 4 | "Inspires" column in ecosystem diagram contradicts "parallel evolution" framing | third-party-ecosystem.md | FIXED |
| 5 | "local LLM analysis" in Tier 2 box contradicts "no local LLM" later | privacy-and-safety.md | FIXED |
| 6 | "three organizations" count in ACKNOWLEDGMENTS template leaks origin info | third-party-ecosystem.md | FIXED |
| 7 | spec-kit "~72.7k stars" is very likely wrong (would be top GitHub repos) | third-party-ecosystem.md | FIXED |
| 8 | Repository URL mismatch: package.json says agentboot/agentboot, actual repo is saavyone/agentboot | package.json, WORK-IN-PROGRESS.md | FIXED — package.json updated |

## HIGH (Consistency Issues Across Docs)

| # | Issue | File(s) | Status |
|---|-------|---------|--------|
| 9 | `init` vs `setup` command name conflict | delivery-methods, org-connection, marketplace vs cli-design | FIXED — standardized to `setup` |
| 10 | `npx agentboot` vs `agentboot` — cli-design says brew, other docs say npx | delivery-methods, org-connection, ci-cd-automation | FIXED — standardized to `agentboot` with npx as fallback note |
| 11 | Plugin naming `acme-agentboot` vs `acme` — org-connection recommends `acme` but examples use both | delivery-methods, org-connection | FIXED — standardized to `acme` |
| 12 | CLI commands missing from cli-design.md: lint, test, search, metrics, cost-estimate, review, issue | cli-design.md | FIXED — added to command summary |
| 13 | `persona.config.json` referenced but never defined anywhere | concepts.md, configuration.md | FIXED — added note that schema is TBD |
| 14 | `creative-suggestion` trait referenced but doesn't exist in core/traits/ | concepts.md | FIXED — noted as planned |
| 15 | `findings_count` vs `findings` telemetry field name across docs | privacy-and-safety, prompt-optimization, test-plan | FIXED — standardized to `findings_count` |
| 16 | Duplicate section "8" numbering in prompt-optimization.md | prompt-optimization.md | FIXED |
| 17 | `.build/` vs `dist/` build output directory | getting-started.md | FIXED — changed to `dist/` |
| 18 | `.claude/personas/` should be `.claude/agents/` or `.claude/skills/` | getting-started.md | FIXED |
| 19 | `enabledPlugins` format inconsistency (string array vs object) | delivery-methods, org-connection | FIXED — standardized to object format |
| 20 | OutputConfig schema missing format, hooks, mcp, managed fields | configuration.md | Noted — schema update deferred to implementation |
| 21 | `gen-testdata` vs `test-data-expert` persona name inconsistency | privacy-and-safety, prompt-optimization, getting-started | FIXED — standardized |
| 22 | `text_matches` vs `text_includes` / `prompt:` vs `input:` test YAML inconsistency | test-plan, prompt-optimization | FIXED — standardized |
| 23 | Model name format: `sonnet` vs `claude-sonnet-4-6` | privacy-and-safety, prompt-optimization | FIXED — standardized to `sonnet` |

## MEDIUM (Clarifications and Cleanup)

| # | Issue | File(s) | Status |
|---|-------|---------|--------|
| 24 | "Sonnet-authored" / "Opus-authored" design references in anti-patterns | concepts.md | FIXED |
| 25 | Token deduplication claim for @imports may be incorrect | concepts.md | FIXED — reworded |
| 26 | 25 hook events count — actual count may be 22 | concepts.md, extending.md, feature-inventory.md | FIXED — softened to avoid specific count |
| 27 | 35 built-in tools count — actual may be ~31 | feature-inventory.md | FIXED — removed specific count |
| 28 | Domain template structure doesn't match actual files | extending.md | Noted — template needs fleshing out |
| 29 | `agentboot connect` not referenced in org-connection.md | org-connection.md, cli-design.md | Noted — cross-reference needed |
| 30 | getting-started.md bypasses `agentboot setup` | getting-started.md | Noted — update when CLI is built |
| 31 | Stage 1 knowledge layer claims "Already Built" but not fully implemented | knowledge-layer.md | FIXED — changed to "Designed" |
| 32 | MCP stability claim contradicts Stage 1 having no MCP | knowledge-layer.md | FIXED — clarified |
| 33 | developer-onboarding presents planned features as existing | developer-onboarding.md | FIXED — added planned-feature note |
| 34 | Copilot CLI `gh copilot suggest --skill` flag likely wrong | ci-cd-automation.md | Noted — verify when implementing |
| 35 | Gemini CLI `gemini -p --skill` flag likely wrong | ci-cd-automation.md | Noted — verify when implementing |
| 36 | ACKNOWLEDGMENTS.md doesn't exist yet (referenced in third-party-ecosystem.md) | third-party-ecosystem.md | Noted — create during V1 |
| 37 | LinkedIn references in marketplace.md contributor profile section | marketplace.md | FIXED |
| 38 | Internal strategy language in delivery-methods.md (phase roadmap, priority column) | delivery-methods.md | Noted — acceptable for design docs |
| 39 | `extraKnownMarketplaces` format inconsistency | delivery-methods, org-connection | FIXED — standardized to object format |
| 40 | `.mcp.json` location: project root vs inside `.claude/` | concepts.md | FIXED — clarified project root |
| 41 | traits.enabled default mismatch between schema and field reference | configuration.md | Noted — reconcile during implementation |
| 42 | RepoConfig not defined in JSON schema | configuration.md | Noted — add during implementation |
| 43 | Wrong path `~/saavyone/agentboot` in WORK-IN-PROGRESS.md | WORK-IN-PROGRESS.md | FIXED (file moved to internal) |
| 44 | `publish` command syntax inconsistency | marketplace.md vs cli-design.md | Noted — reconcile during implementation |
| 45 | agentboot-coverage.md has unresolved "?" in design question | agentboot-coverage.md | FIXED |
| 46 | "(fixed)" parenthetical is internal context | agentboot-coverage.md | FIXED |
