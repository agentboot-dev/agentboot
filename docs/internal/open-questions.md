# Open Questions — Consolidated

All open questions from the planning docs, categorized by status.
Questions marked RESOLVED have answers applied to the design docs.
Questions marked DEFERRED are parked for later design phases.
Questions marked RESEARCH need investigation before they can be answered.

---

## RESOLVED (Answers Applied to Design)

These questions have clear answers that should be reflected in the docs.

### From PRD

| ID | Question | Resolution |
|---|---|---|
| Q1 | Circular trait dependencies | Detect during build (stop graph traversal). Document behavior. |
| Q2 | Trait update breaks persona test | Trait is blocked. Tests drive changes. Author updates tests with components. |
| Q3 | persona.config.json creation | `agentboot config persona` command. Scope is explicit, not inferred. |
| Q5 | JSONC support | No JSONC unless proven beneficial. If adopted, consistent across all JSON files. |
| Q6 | Conflicting trait weights | More specific scope wins on optional behaviors. Less-specific override goes against design principles. |
| Q7 | What constitutes "mandatory" | Rules are mandatory by nature. Personas are optional/customizable. Convention over configuration. Enforcement through collaboration and communication. |
| Q8 | Repo-level overrides | Local content allowed. Mandatory rules: higher level wins. Overrides are transient but committed to git. Manifest tracked by Git. |
| Q9 | Sync branch strategy | PRs target default branch. Minimal initially. PRs must never impact code functionality. |
| Q10 | Escalation abuse prevention | Full-stop mechanisms. Role-based approval (like CODEOWNERS). Overrides approved by higher level. Multiple root users = governance by committee. |
| Q13 | Plugin namespace collision | Marketplace registration guarantees uniqueness within that marketplace. Multi-marketplace collision = org's risk. |
| Q15 | Managed settings vs plugin conflict | Managed settings always win. Could notify admins of versions, but not core feature. |
| Q20 | Behavioral test model selection | Default to persona-specified model, allow org admin override. |
| Q22 | License compatibility for marketplace | Not AgentBoot's concern to enforce. Prominently display licenses. Let end users decide. |
| Q24 | Versioning across system | All versioned independently. All use semantic versioning. |
| Q25 | Backward compatibility | Follow semver. Breaking changes only in major versions. Release notes + upgrade guides. |
| Q26 | Air-gapped environments | Best effort. "Too bad, so sad" for non-fitting use cases. Open source — PRs welcome. |
| Q28 | Multi-language organizations | Support from beginning. Let community implement language packs. |
| Q30 | Initial target market | Smaller teams first (2-20 developers). Fits origin story. |

### From Architecture

| ID | Question | Resolution |
|---|---|---|
| OQ-01 | persona.config.json schema | Defined in technical-spec.md Section 5. |
| OQ-02 | Trait weight section extraction | Use markdown heading convention (`## HIGH`, `## MEDIUM`, `## LOW`) |
| OQ-05 | Sync conflict resolution | Answered in PRD Q8 — warn on modified files, higher level wins on mandatory. |
| OQ-06 | repos.json doesn't exist | Start as `[]`. Created by `agentboot setup`. |
| OQ-07 | Missing trait definitions | Remove references to traits that don't exist. Don't reference what we don't have. |
| OQ-09 | CLI implementation language | TypeScript first. Go migration if binary size/startup becomes a problem. |
| OQ-19 | dist/ directory lifecycle | Agreed — first build validates the output structure. |

### From Technical Spec

| ID | Question | Resolution |
|---|---|---|
| TS-01 | persona.config.json fields | Per-persona tokenBudget. `required` doesn't fit personas — use rules instead. |
| TS-04 | Test file location | Confirmed: `tests/behavioral/`, `tests/eval/`, `tests/snapshots/`, `tests/fixtures/` |
| TS-05 | Telemetry log location | Target repo. User-level log at `~/.agentboot/telemetry.ndjson`. Path configurable. |
| TS-06 | `agentboot lint --fix` | Use Haiku to fix suggestions. Confirm with human (depending on autonomy level). Assumes CLI has CC/agent access. |
| TS-07 | CLI argument parser | `commander` (lightweight, TypeScript-friendly). |
| TS-08 | Discover overlap algorithm | Normalized hash + Jaccard similarity for V1. Embedding-based in V2. |
| TS-09 | repos.json creation | Warn user. Remind to run setup or contact DevEx team. |
| TS-10 | Token counting accuracy | Estimation first with honest documentation ("best effort"). Move to tiktoken over time. |
| TS-11 | Behavioral test CC dependency | Document limitations honestly. Mock mode makes sense. Version compatibility managed by humans. |
| TS-13 | Plugin validation | Implement AgentBoot's own validation (plugin.json schema, file paths, frontmatter, size limits). |
| TS-14 | GitLab API sync | Support both REST and CLI. Let humans decide. |
| TS-15 | MCP server transport/deployment | Combined binary first. Both stdio + HTTP transports. Separate when it makes sense. |
| TS-16 | Scope merging semantics | Rules = mandatory, personas = optional. `required` field removed from personas/traits — use rules. Weight 0 allowed if team sets it; groups use rules to lock weights. |
| TS-17 | Uninstall archive creation | Archive happens in first PR per repo (simultaneously archives existing + installs new). |
| TS-18 | Conflicting-instructions lint | Keyword-based heuristics for V1 (always/never/must/must not contradictions). |
| TS-20 | Cost estimation output | Simplest approach first (same rate all personas, honest docs). Base on metrics over time. `--calibrate` flag later. |

### From Design

| ID | Question | Resolution |
|---|---|---|
| DQ-01 | Escalation and /insights interaction | Separate processes. Post-insights script handles scrubbing. Escalation is separate and loud. |
| DQ-02 | Transition from false to hashed/email | Forward-only. Transition should be onerous (many hoops). |
| DQ-03 | CI-mode privacy | CI-mode is different context. Developer submitted work = org-visible. Attribute telemetry to CI user with traceability to PR/author. |
| DQ-05 | Session transcript retention | AgentBoot has no opinion on things it doesn't control. Privacy-first for things within control. |
| DQ-06 | Hashed developer ID generation | Salted hash (BYOS — Bring Your Own Salt). Org provides salt via secrets manager. No salt = default, but notify. Not retroactive. |
| DQ-07 | Welcome fragment for returning devs | Lower priority. Include removal-after-first-use mechanism when implemented. |
| DQ-09 | Non-interactive CLI flag mapping | Org admin runs interactive first, outputs config file for CI. Human-readable, documented, consistent format. |
| DQ-10 | Missing persona error handling | Initially generic CC error. Soon: helpful AgentBoot message for onboarding success. |
| DQ-23 | Telemetry on uninstall | Offered as option to user. |
| DQ-24 | Uninstall and in-flight PRs | Best effort to close via `gh`. Report if unable so user knows to close manually. |
| DQ-26 | "Spring Boot" analogy | Yes to audience-specific catchphrases. Default: "The Easy Button for Agentic Development Teams" (workshop in marketing). |
| DQ-27 | Agent-agnostic positioning | Always upfront about "best effort." Not misleading if implementation is genuine. Other agents' lack of features is not our responsibility. |
| DQ-28 | Public stance on AI regulation | No public opinions outside the already opinionated product. |
| DQ-31 | AgentBoot vs content versioning | Independent semantic versioning. |

---

## DEFERRED (Later Design Phases)

These are parked. Not forgotten — they'll be designed when closer to implementation.

### Cross-Platform & Format
| ID | Question |
|---|---|
| OQ-03 | Cross-platform gotchas frontmatter translation rules |
| OQ-04 | Plugin namespace UX impact |

### Knowledge Layer
| ID | Question |
|---|---|
| OQ-08 | Knowledge frontmatter schema formalization |
| OQ-18 | Embedding model selection for Stage 3 |

### Governance & Autonomy
| ID | Question |
|---|---|
| OQ-10 | Autonomy progression evidence requirements |
| OQ-11 | Domain layer conflict between domains (semantic conflicts) |
| OQ-13 | Persona arbitrator invocation criteria |
| OQ-16 | Team-level config storage mechanism |

### Infrastructure & Operations
| ID | Question |
|---|---|
| OQ-12 | Server-managed settings integration path |
| OQ-14 | Plugin versioning and update strategy |
| OQ-15 | Test infrastructure implementation (scheduled for next planning phase) |
| OQ-17 | Cowork plugin surface area |
| OQ-20 | Hook script portability (Windows) |

### Marketplace & Community
| ID | Question |
|---|---|
| DQ-12 | Marketplace usage stats collection |
| DQ-13 | Abandoned verified trait governance |
| DQ-14 | SuperClaude cross-listing practicalities (dependency on upstream cooperation) |
| DQ-15 | Marketplace namespace collision prevention |
| DQ-19 | `agentboot discover --github-org` rate limiting |
| DQ-20 | Setup wizard auto-detection reliability |
| DQ-21 | Developer on multiple orgs |
| DQ-22 | Onboarding checklist partial completion |
| DQ-25 | Manifest behavior for manually modified files |
| DQ-29 | Marketplace maintenance governance |
| DQ-30 | AgentBoot project governance |

### Other
| ID | Question |
|---|---|
| Q4 | repos.json lifecycle (minimal first, grows over time) |
| Q11 | Telemetry data retention policy (sane defaults for now) |
| Q16 | Multi-Git-platform org support |
| Q19 | Behavioral test fixture realism (community contributions) |
| Q21 | SuperClaude partnership governance |
| Q23 | Monetization revenue sharing |
| Q27 | Build system performance budget (needs empirical data) |
| Q29 | Accessibility (post-MVP) |
| DQ-08 | Contextual tips + /learn interaction (tracking across sessions) |

---

## NEEDS RESEARCH

These need investigation before answering.

| ID | Question | What to Research |
|---|---|---|
| Q14 | MCP server authentication/authorization | How do MCP servers handle auth? What patterns exist? |
| Q18 | Knowledge embeddings versioning (RAG) | How do other RAG systems handle embedding versioning? |
| Q31 | SKILL.md format vs CC agents relationship | How exactly does agentskills.io spec map to CC agent definitions? |
| Q32 | Compliance hooks testing in CI | How to test hooks without triggering real compliance systems? |
| TS-02 | Weight application semantics | Test comment-based vs content modification vs token budget vs metadata approaches |
| TS-03 | Cross-platform SKILL.md required fields | Find the agentskills.io spec and document which fields are required |
| TS-12 | Managed settings default fields | Investigate similarities across MDM providers. Find specs to align with. |
| TS-19 | Session transcript access for `agentboot review` | How to reconcile 3-tier privacy with review tool needs |
| DQ-04 | Is /insights analysis prompt auditable? | More investigation needed — currently a black box |
| DQ-11 | Cowork structured forms validation | Validate concept against Cowork's actual capabilities |
| DQ-16 | /insights session transcript access | Same as DQ-04 — how does /insights actually access transcripts? |
| DQ-17 | Stop hook timing for subagents | Does Stop fire at subagent completion or parent session end? |
| DQ-18 | Managed settings vs repo sync conflict | Needs deeper investigation beyond "managed wins" |
| Q17 | Knowledge MCP concurrent access | Document limitation honestly. Prefer community solutions. |

---

## AUDIT DOUBTS (Assumptions I'm Not Confident About)

These are places where I (Claude) made assumptions during the design session that
should be validated. I'm flagging them rather than assuming they're correct.

| ID | Doubt | Where It Appears | Why I'm Uncertain |
|---|---|---|---|
| AD-01 | **agentskills.io as a real standard.** I described it as "adopted by 26+ platforms" based on web search results. I haven't personally read the spec. The star count and adoption claims may be inflated by search result hype. | concepts.md, prd.md, architecture.md, third-party-ecosystem.md | Web search results can be unreliable. The spec should be read firsthand and verified. |
| AD-02 | **SuperClaude star count (~5.7k).** I used this number from a search result. It may be stale or wrong. | third-party-ecosystem.md | Time-sensitive data from web search. |
| AD-03 | **Copilot CLI `--skill` flag.** I wrote `gh copilot suggest --skill code-reviewer` in ci-cd-automation.md. I'm not confident this flag exists. | ci-cd-automation.md | Based on web search, not firsthand verification. |
| AD-04 | **Gemini CLI `-p` flag.** I wrote `gemini -p --skill` in ci-cd-automation.md. I haven't verified this. | ci-cd-automation.md | Speculative based on pattern matching with CC's `-p`. |
| AD-05 | **Claude Code hook event count.** I originally said 25, then softened to "comprehensive set." The feature-inventory.md lists 22. The actual count should come from the CC docs, not my list. | feature-inventory.md, concepts.md | I compiled the list from a subagent's research. Could be missing events or including deprecated ones. |
| AD-06 | **Claude Code built-in tool count.** Feature inventory says 35 in the header but the table has ~31 entries. I softened the header language but the mismatch may still exist. | feature-inventory.md | Same compilation concern as AD-05. |
| AD-07 | **`context: fork` behavior.** I described it as creating an isolated subagent context. I'm not 100% sure this is how CC implements it vs. just a regular subagent spawn. | concepts.md, getting-started.md | Based on CC docs research, not tested. |
| AD-08 | **`.mcp.json` location.** I said project root (not inside .claude/). This should be verified against current CC behavior. Earlier docs said `.claude/.mcp.json`. | concepts.md, architecture.md | Conflicting sources during the session. |
| AD-09 | **Managed settings paths.** I listed `/Library/Application Support/ClaudeCode/` for macOS. This path should be verified — there was a note about Windows paths changing. | concepts.md, extending.md, privacy-and-safety.md | Based on web search. Paths change between CC versions. |
| AD-10 | **`claude plugin validate` command.** I referenced this as a way to validate plugins. It may not exist as a CLI command (vs. an in-app `/plugin validate`). | architecture.md | Uncertain whether it's CLI or TUI-only. |
| AD-11 | **The "creative-suggestion" trait.** I referenced this throughout concepts.md as the counterpart to critical-thinking. It doesn't exist in the repo. I treated it as a planned trait but some sections read like it exists. | concepts.md | It's described as if it's real. Should either be created or all references should be explicitly marked as planned. |
| AD-12 | **Token-to-character ratio of 1:4.** The tech spec uses this for estimation. The actual ratio varies significantly by content type (code vs prose vs JSON). | technical-spec.md | Industry approximation, not a verified constant for AgentBoot's content types. |
| AD-13 | **`paths:` vs `globs:` in CC rules.** I standardized to `paths:` based on the CC docs research. But some CC doc pages may still reference `globs:`. The subagent that did the research may have found outdated docs. | concepts.md, extending.md, all gotchas examples | The CC docs themselves may be inconsistent on this. |
| AD-14 | **Cowork plugins.** I described Cowork as sharing the CC plugin format. This should be verified — Cowork may have its own plugin system that's similar but not identical. | delivery-methods.md, developer-onboarding.md | Based on web search results that may oversimplify. |
| AD-15 | **The three-tier privacy model implementation.** The design is sound conceptually. But the "Tier 2 privileged analysis" via Claude API means session transcripts are sent to Anthropic — which the org may already have Compliance API access to. The privacy boundary is between AgentBoot and the org, not absolute. I documented this caveat, but I'm uncertain how well users will understand the distinction. | privacy-and-safety.md | The privacy model is a design commitment, not a technical guarantee. The honest caveat section may not be prominent enough. |
