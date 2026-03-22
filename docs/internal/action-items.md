# Action Items — Centralized Tracker

All open questions, audit doubts, unresolved concerns, and TODOs from across the documentation, deduplicated and prioritized.

**Last compiled:** 2026-03-21

---

## Critical (blocks public release)

### CLI-1. `--fix` flag on `lint` is accepted but not implemented
Users will invoke `agentboot lint --fix` and expect auto-fix behavior. The flag parses without error but does nothing.
- **Action:** Remove `--fix` from the CLI for V1. Re-add when the Haiku-based auto-fix (TS-06) is implemented.
- **Category:** CLI
- **Source:** docs/internal/archive/cli-commands-audit.md #1

### CLI-2. `--config` defined globally AND on individual commands
Redundant definition creates confusion about precedence. Commander inherits global options.
- **Action:** Remove per-command `--config` definitions; rely on global `-c, --config`.
- **Category:** CLI
- **Source:** docs/internal/archive/cli-commands-audit.md #2

### CLI-3. `config` command is read-only but doesn't communicate that
`agentboot config org acme` silently fails. Users expect `config key value` to set a value.
- **Action:** Add a clear error message on write attempts, or rename subcommand to `config get`.
- **Category:** CLI
- **Source:** docs/internal/archive/cli-commands-audit.md #3

### CFG-1. `groups[].label` is defined but never used
`GroupConfig.label` exists in the TypeScript interface but no code reads it. Dead field in the public schema.
- **Action:** Remove from interface and example config, or implement display in PERSONAS.md output.
- **Category:** Config
- **Source:** docs/internal/archive/config-schema-audit.md #1

### CFG-2. `personas.customDir` — unclear name
Does it extend, override, or supplement core personas? Behavior is "load additional personas from this path" but the name suggests inheritance.
- **Action:** Rename to `personas.additionalDir` or clarify semantics in schema docs.
- **Category:** Config
- **Source:** docs/internal/archive/config-schema-audit.md #2

### CFG-3. `personas.outputFormats` not validated
Accepts any string but only recognizes `"skill"`, `"claude"`, `"copilot"`. Invalid values are silently ignored.
- **Action:** Validate against allowed set. Error on unknown formats.
- **Category:** Config
- **Source:** docs/internal/archive/config-schema-audit.md #3

---

## High (should fix before v1.0)

### CLI-4. `--repos` flag on `sync` — ambiguous name
Unclear whether it's a list of repo paths or a path to repos.json (it's the latter).
- **Action:** Rename to `--repos-file`.
- **Category:** CLI
- **Source:** docs/internal/archive/cli-commands-audit.md #4

### CLI-5. `doctor` lacks `--format json`
`status` and `lint` both support `--format json`. `doctor` doesn't. Inconsistent.
- **Action:** Add `--format` to `doctor`.
- **Category:** CLI
- **Source:** docs/internal/archive/cli-commands-audit.md #5

### CLI-6. `dev-sync` is an internal command exposed publicly
End users don't need it; it's for AgentBoot contributors only.
- **Action:** Hide from `--help` or document as internal.
- **Category:** CLI
- **Source:** docs/internal/archive/cli-commands-audit.md #6

### CFG-4. `repos[].platform` allows unimplemented values
`"cursor"` and `"gemini"` are accepted in repos.json but compile.ts doesn't generate output for them.
- **Action:** Restrict to implemented platforms or emit a clear warning during validate.
- **Category:** Config
- **Source:** docs/internal/archive/config-schema-audit.md #4

### CFG-5. `output.tokenBudget.warnAt` — unclear intent
Warns when exceeded but doesn't block. Is this informational or a hard limit?
- **Action:** Document design intent. If informational only, keep as-is with clear docs. If hard limit, enforce it.
- **Category:** Config
- **Source:** docs/internal/archive/config-schema-audit.md #5

### CFG-6. `sync.pr.*` section commented out in example config
PR mode works in code but users can't discover it from the example configuration.
- **Action:** Uncomment PR section with a note that it's optional.
- **Category:** Config
- **Source:** docs/internal/archive/config-schema-audit.md #6

### CFG-7. `sync.pr.titleTemplate` not validated
`branchPrefix` has regex validation but `titleTemplate` doesn't. Inconsistent security posture.
- **Action:** Add validation for `titleTemplate` to match `branchPrefix` treatment.
- **Category:** Config, Security
- **Source:** docs/internal/archive/config-schema-audit.md #7

### GAP-1. No cursor or gemini output formats
Phase 2 feature. Currently only skill, claude, and copilot platforms are implemented.
- **Action:** Implement when prioritized; in the meantime, validate that config rejects these values (see CFG-4).
- **Category:** Config
- **Source:** CLAUDE.md (Known Gaps)

### GAP-2. Trait weight system not yet implemented
Traits are included or not. HIGH/MEDIUM/LOW weight configuration is designed but not built.
- **Action:** Phase 2. No action needed for V1 — document as planned.
- **Category:** Config
- **Source:** CLAUDE.md (Known Gaps)

### GAP-3. No runtime config schema validation
Zod planned but not wired in. Config errors may produce confusing failures.
- **Action:** Wire in zod validation for agentboot.config.json and persona.config.json before v1.0.
- **Category:** Config
- **Source:** CLAUDE.md (Known Gaps)

### GAP-4. Extension path `./personas` warns but doesn't block
Config referencing `./personas` directory produces a warning but build continues.
- **Action:** Decide: should this be an error or a warning? Document the decision.
- **Category:** Config
- **Source:** CLAUDE.md (Known Gaps)

### GAP-5. `repos.json` is empty — production sync untested
Production sync path has never been exercised in a real workflow. Only dev-sync is used.
- **Action:** Test sync against at least one real repo before v1.0.
- **Category:** Testing
- **Source:** CLAUDE.md (Known Gaps)

---

## Audit Doubts (CC behavior assumptions to validate)

### AD-01. agentskills.io as a real standard
Described as "adopted by 26+ platforms" based on web search. The spec has not been read firsthand.
- **Action:** Read the agentskills.io spec. Verify adoption claims. Adjust docs if inflated.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-01

### AD-03. Copilot CLI `--skill` flag
`gh copilot suggest --skill code-reviewer` referenced in ci-cd-automation.md. May not exist.
- **Action:** Verify against Copilot CLI docs. Remove or rewrite if the flag doesn't exist.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-03

### AD-04. Gemini CLI `-p` flag
`gemini -p --skill` referenced in ci-cd-automation.md. Speculative, not verified.
- **Action:** Verify against Gemini CLI docs. Remove or rewrite if the flag doesn't exist.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-04

### AD-05. Claude Code hook event count
Originally said 25, feature-inventory.md lists 22. Actual count should come from CC docs.
- **Action:** Cross-reference against current CC documentation. Update feature-inventory.md.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-05

### AD-06. Claude Code built-in tool count
Feature inventory header says 35 but the table has ~31 entries.
- **Action:** Recount tools from CC docs. Fix header to match actual count.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-06

### AD-07. `context: fork` behavior
Described as creating an isolated subagent context. Not tested against actual CC behavior.
- **Action:** Test `context: fork` in a real CC session. Document actual behavior.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-07

### AD-08. `.mcp.json` location
Stated as project root, but earlier docs said `.claude/.mcp.json`. Conflicting sources.
- **Action:** Verify current CC behavior. Update all docs to match.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-08

### AD-09. Managed settings paths
Listed `/Library/Application Support/ClaudeCode/` for macOS. Paths may change between CC versions.
- **Action:** Verify against current CC release. Add version caveat to docs.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-09

### AD-10. `claude plugin validate` command
Referenced as a way to validate plugins. May not exist as a CLI command (vs. in-app only).
- **Action:** Verify. If not a CLI command, update architecture.md and implement AgentBoot's own validation (per TS-13 resolution).
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-10

### AD-11. The "creative-suggestion" trait
Referenced throughout concepts.md as counterpart to critical-thinking. Does not exist in repo.
- **Action:** Either create the trait or mark all references as planned/example.
- **Category:** Config
- **Source:** docs/internal/open-questions.md AD-11

### AD-12. Token-to-character ratio of 1:4
Used in tech spec for estimation. Actual ratio varies by content type (code vs prose vs JSON).
- **Action:** Measure actual ratio against AgentBoot's typical content. Add margin of error to docs.
- **Category:** Testing
- **Source:** docs/internal/open-questions.md AD-12

### AD-13. `paths:` vs `globs:` in CC rules
Standardized to `paths:` but some CC docs may reference `globs:`. Potential mismatch.
- **Action:** Verify which keyword current CC actually uses. Update all gotchas examples.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-13

### AD-14. Cowork plugins
Described as sharing the CC plugin format. May have its own plugin system.
- **Action:** Verify against Cowork docs. Adjust delivery-methods.md if different.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-14

### AD-15. Three-tier privacy model implementation
Privacy boundary is between AgentBoot and the org, not absolute. Org may have Compliance API access to the same data.
- **Action:** Make the caveat more prominent in privacy-and-safety.md. Ensure users understand Tier 2 sends transcripts to Anthropic's API.
- **Category:** Privacy
- **Source:** docs/internal/open-questions.md AD-15

### AD-02. SuperClaude star count (~5.7k)
Time-sensitive data from web search. May be stale or wrong.
- **Action:** Re-check before any public-facing reference. Low priority — cosmetic.
- **Category:** CC compatibility
- **Source:** docs/internal/open-questions.md AD-02

---

## Deferred Design Questions (resolve when feature is prioritized)

### Cross-Platform & Format

| ID | Question | Category |
|---|---|---|
| OQ-03 | Cross-platform gotchas frontmatter translation rules | CC compatibility |
| OQ-04 | Plugin namespace UX impact | CLI |

**Source:** docs/internal/open-questions.md

### Knowledge Layer

| ID | Question | Category |
|---|---|---|
| OQ-08 | Knowledge frontmatter schema formalization | Config |
| OQ-18 | Embedding model selection for Stage 3 | Config |

**Source:** docs/internal/open-questions.md

### Governance & Autonomy

| ID | Question | Category |
|---|---|---|
| OQ-10 | Autonomy progression evidence requirements | Config |
| OQ-11 | Domain layer conflict between domains (semantic conflicts) | Config |
| OQ-13 | Persona arbitrator invocation criteria | Config |
| OQ-16 | Team-level config storage mechanism | Config |

**Source:** docs/internal/open-questions.md

### Infrastructure & Operations

| ID | Question | Category |
|---|---|---|
| OQ-12 | Server-managed settings integration path | CC compatibility |
| OQ-14 | Plugin versioning and update strategy | Config |
| OQ-15 | Test infrastructure implementation | Testing |
| OQ-17 | Cowork plugin surface area | CC compatibility |
| OQ-20 | Hook script portability (Windows) | CLI |

**Source:** docs/internal/open-questions.md

### Marketplace & Community

| ID | Question | Category |
|---|---|---|
| DQ-12 | Marketplace usage stats collection | Privacy |
| DQ-13 | Abandoned verified trait governance | Legal |
| DQ-14 | SuperClaude cross-listing practicalities | Legal |
| DQ-15 | Marketplace namespace collision prevention | Config |
| DQ-19 | `agentboot discover --github-org` rate limiting | CLI |
| DQ-20 | Setup wizard auto-detection reliability | CLI |
| DQ-21 | Developer on multiple orgs | Config |
| DQ-22 | Onboarding checklist partial completion | CLI |
| DQ-25 | Manifest behavior for manually modified files | Config |
| DQ-29 | Marketplace maintenance governance | Legal |
| DQ-30 | AgentBoot project governance | Legal |

**Source:** docs/internal/open-questions.md

### Other Deferred

| ID | Question | Category |
|---|---|---|
| Q4 | repos.json lifecycle (minimal first, grows over time) | Config |
| Q11 | Telemetry data retention policy | Privacy |
| Q16 | Multi-Git-platform org support | Config |
| Q19 | Behavioral test fixture realism | Testing |
| Q21 | SuperClaude partnership governance | Legal |
| Q23 | Monetization revenue sharing | Legal |
| Q27 | Build system performance budget | Testing |
| Q29 | Accessibility (post-MVP) | CLI |
| DQ-08 | Contextual tips + /learn interaction across sessions | CLI |

**Source:** docs/internal/open-questions.md

### CLI Planned Commands (not yet implemented, not blocking V1)

| Command | Purpose | Priority |
|---|---|---|
| `connect` | Developer self-service org connection | High (V1.5) |
| `export` | Generate distributable artifacts (plugin, marketplace) | High (V1.5) |
| `discover` | Scan repos for existing agentic content | Medium (V2) |
| `publish` | Push to marketplace | Medium (V2) |
| `cost-estimate` | Project per-persona costs | Low (V2) |
| `metrics` | Read telemetry | Low (V2) |
| `review` | Guided human review | Low (V2) |

**Source:** docs/internal/archive/cli-commands-audit.md

### CLI Incomplete Subcommands (not blocking V1)

| ID | Issue | Category |
|---|---|---|
| CLI-9 | `add` subcommands incomplete — only `persona`, `trait`, `gotcha` implemented; `domain`, `hook`, `repo`, `prompt` planned | CLI |
| CLI-10 | `uninstall` scope limited — only `--repo` and `--dry-run`; `--all-repos`, `--plugin`, `--managed`, `--everything` planned | CLI |

**Source:** docs/internal/archive/cli-commands-audit.md #9, #10

### Config Medium-Priority Polish

| ID | Issue | Category |
|---|---|---|
| CFG-8 | `claude.hooks`, `claude.permissions`, `claude.mcpServers` are Phase 2 features exposed in config — mark as experimental | Config |
| CFG-9 | `output.tokenBudget.warnAt` deeply nested for one field — document why (anticipate future sibling fields) | Config |
| CFG-10 | Default values not documented in example config | Config |

**Source:** docs/internal/archive/config-schema-audit.md #8, #9, #10

### CLI Medium-Priority Polish

| ID | Issue | Category |
|---|---|---|
| CLI-7 | No short flags for common options (`--dry-run` has no `-d`) | CLI |
| CLI-8 | `dev-build` runs `dev-sync` not `sync` — name may confuse | CLI |

**Source:** docs/internal/archive/cli-commands-audit.md #7, #8

---

## Research Needed (requires investigation)

### Security & Auth

| ID | Question | What to Research | Category |
|---|---|---|---|
| Q14 | MCP server authentication/authorization | How do MCP servers handle auth? What patterns exist? | Security |
| Q32 | Compliance hooks testing in CI | How to test hooks without triggering real compliance systems? | Testing |

### CC Feature Verification

| ID | Question | What to Research | Category |
|---|---|---|---|
| Q31 | SKILL.md format vs CC agents relationship | How exactly does agentskills.io spec map to CC agent definitions? | CC compatibility |
| TS-03 | Cross-platform SKILL.md required fields | Find the agentskills.io spec and document which fields are required | CC compatibility |
| TS-12 | Managed settings default fields | Investigate MDM provider specs to align with | CC compatibility |
| DQ-17 | Stop hook timing for subagents | Does Stop fire at subagent completion or parent session end? | CC compatibility |
| DQ-18 | Managed settings vs repo sync conflict | Needs deeper investigation beyond "managed wins" | CC compatibility |

### Privacy & Data Access

| ID | Question | What to Research | Category |
|---|---|---|---|
| TS-19 | Session transcript access for `agentboot review` | How to reconcile 3-tier privacy with review tool needs | Privacy |
| DQ-04 | Is /insights analysis prompt auditable? | Currently a black box — investigate | Privacy |
| DQ-16 | /insights session transcript access | How does /insights actually access transcripts? (overlaps DQ-04) | Privacy |

### Implementation Research

| ID | Question | What to Research | Category |
|---|---|---|---|
| TS-02 | Weight application semantics | Test comment-based vs content modification vs token budget vs metadata approaches | Config |
| Q18 | Knowledge embeddings versioning (RAG) | How do other RAG systems handle embedding versioning? | Config |
| Q17 | Knowledge MCP concurrent access | Document limitation honestly. Prefer community solutions. | Config |
| DQ-11 | Cowork structured forms validation | Validate concept against Cowork's actual capabilities | CC compatibility |

---

## Summary

| Priority | Count |
|---|---|
| Critical (blocks public release) | 6 |
| High (fix before v1.0) | 12 |
| Audit Doubts (validate assumptions) | 16 |
| Deferred Design Questions | 40 |
| Research Needed | 14 |
| **Total unique items** | **88** |
