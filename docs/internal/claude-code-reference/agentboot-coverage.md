# AgentBoot ↔ Claude Code Coverage Analysis

Cross-references every Claude Code feature against AgentBoot's current design. Identifies
what is fully used, partially used, and not used at all.

**Legend:** FULL = AgentBoot generates/leverages this fully. PARTIAL = designed but not
using all capabilities. NONE = not used. N/A = not relevant to AgentBoot's scope.

---

## 1. CLAUDE.md System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| Project-level CLAUDE.md | FULL | Sync generates `.claude/CLAUDE.md` | — |
| `@import` syntax | PARTIAL | Designed in concepts.md but compile.ts still inlines | Implement @import-based output in compile.ts |
| Subdirectory CLAUDE.md | NONE | Could generate per-directory context files | Consider for path-scoped domain knowledge |
| User-level `~/.claude/CLAUDE.md` | NONE | Not in AgentBoot's scope (per-user) | Document as a user customization point |
| Managed policy CLAUDE.md | PARTIAL | Designed for HARD guardrails but no generator | Implement managed artifact generation |
| `claudeMdExcludes` | NONE | Not generated in settings.json output | Generate excludes for monorepo scenarios |
| 200-line guideline | NONE | No size validation on generated CLAUDE.md | Add build validation: warn if >200 lines |
| Compaction survival | N/A | Native behavior; no action needed | — |
| Lazy-loaded subdirectory CLAUDE.md | NONE | Could generate domain context per-directory | Explore for deep domain knowledge delivery |

### Untapped Opportunity: Subdirectory CLAUDE.md

AgentBoot could generate subdirectory-specific CLAUDE.md files that activate only when
Claude reads files in those paths. Example: `src/auth/CLAUDE.md` with auth-specific
context, `src/api/CLAUDE.md` with API design rules. This is more granular than rules
with `paths:` frontmatter because it can contain rich context (architecture diagrams,
domain model summaries) rather than just rules.

---

## 2. Settings System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `.claude/settings.json` generation | PARTIAL | Designed for hooks only | Generate full settings including permissions |
| `.claude/settings.local.json` | NONE | Local overrides not in scope | Document as user escape hatch |
| Managed settings paths | PARTIAL | Designed but no generator | Implement `output.managed` generation |
| Permission `allow` rules | NONE | Not generating permission configs | Generate per-persona tool permissions |
| Permission `deny` rules | NONE | Not generating deny lists | Generate deny rules for read-only personas |
| `env` variables | NONE | Not generating env config | Generate env for MCP servers, hooks |
| `defaultModel` | NONE | Not setting org-wide model | Consider as org-level config option |
| `effort` | NONE | Not setting effort level | Consider per-persona effort setting |
| `sandbox` config | NONE | Not generating sandbox rules | Explore for compliance-heavy domains |
| `additionalDirectories` | NONE | Not used | Could reference shared knowledge dirs |
| `autoIncludeFilesInPrompts` | NONE | Not configured | Document as user preference |
| `disableBypassPermissionsMode` | NONE | Managed-only; relevant for HARD guardrails | Include in managed settings generation |
| `allowManagedPermissionRulesOnly` | NONE | Managed-only lockdown | Include in managed settings generation |
| `allowManagedHooksOnly` | NONE | Managed-only lockdown | Include in managed settings generation |
| `allowManagedMcpServersOnly` | NONE | Managed-only lockdown | Include in managed settings generation |
| `contributionAttribution` | NONE | Not relevant to AgentBoot | — |

### Untapped Opportunity: Permission Generation

AgentBoot knows each persona's tool requirements from frontmatter (`disallowedTools`,
`tools`). It should also generate matching permission rules in `settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(npm run test)", "Bash(npm run lint)", "Read", "Grep", "Glob"],
    "deny": ["Bash(rm -rf *)", "Bash(git push --force *)"]
  }
}
```

This provides defense-in-depth: the persona's `disallowedTools` is the first layer
(model-level), and `permissions.deny` is the second layer (runtime-enforced).

### Untapped Opportunity: Managed Settings Lockdown

For enterprise HARD guardrails, AgentBoot should generate managed settings that use
Claude Code's native lockdown features:

```json
{
  "disableBypassPermissionsMode": "disable",
  "allowManagedHooksOnly": true,
  "allowManagedMcpServersOnly": true,
  "allowManagedPermissionRulesOnly": true
}
```

This prevents developers from disabling hooks, adding unauthorized MCP servers, or
overriding permission rules. It's the strongest enforcement Claude Code offers.

---

## 3. Agent System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `.claude/agents/` generation | PARTIAL | Designed but not implemented in compile.ts | Implement agent CLAUDE.md generation |
| `name` field | FULL | Mapped from persona name | — |
| `description` field | FULL | Mapped from persona description | — |
| `model` field | PARTIAL | Designed but not all personas specify model | Add model to persona.config.json |
| `permissionMode` field | NONE | Not generated | Generate per-persona (reviewers = `plan`) |
| `maxTurns` field | NONE | Not generated | Add to persona.config.json |
| `tools` / `disallowedTools` | PARTIAL | Designed in concepts.md | Implement in compile output |
| `skills` (preload) | NONE | Not using skill preloading | Preload relevant skills per persona |
| `mcpServers` (scoped) | NONE | Not generating scoped MCP | Generate MCP refs for knowledge-dependent personas |
| `hooks` (agent-specific) | NONE | Not generating per-agent hooks | Generate audit hooks per persona |
| `memory` scope | NONE | Not using agent memory | Map to self-improvement reflections |
| `background` | NONE | Not generating background agents | Consider for monitoring personas |
| `isolation: worktree` | NONE | Not using worktree isolation | Consider for reviewer isolation alongside `context: fork` |
| Built-in agents | N/A | AgentBoot defines custom agents, not built-ins | — |
| @-mention invocation | N/A | Native; no generation needed | Document for users |
| `--agent` CLI flag | N/A | Native; no generation needed | Document for users |
| Agent memory directories | NONE | Not using `.claude/agent-memory/` | Map to self-improvement reflections system |

### Untapped Opportunity: `permissionMode` for Reviewers

Review personas should run in `plan` mode (read-only). They should never edit files:

```yaml
permissionMode: plan
```

This is stronger than `disallowedTools: Edit, Write` because it's enforced at the
runtime level, not the model level. The model might ignore `disallowedTools` in edge
cases; `permissionMode: plan` cannot be overridden.

### Untapped Opportunity: Agent Memory for Self-Improvement

Instead of a custom `.claude/reflections/` directory, self-improvement reflections
should use Claude Code's native agent memory system:

```yaml
memory: project    # or local
```

This gives the agent a persistent `MEMORY.md` and topic files that survive across
sessions. The reflection data lives where Claude Code expects it, not in a custom
location.

### Untapped Opportunity: `skills` Preloading

Agents can preload skills to have them available without explicit invocation:

```yaml
skills:
  - hipaa-check
  - audit
```

A security reviewer agent could preload the `hipaa-check` skill so it's always
available during review without the developer having to invoke it separately.

---

## 4. Skills System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `.claude/skills/` generation | PARTIAL | Designed but not fully specified | Implement skill generation |
| `context: fork` | PARTIAL | Designed in concepts.md | Generate for all review skills |
| `agent:` field | PARTIAL | Designed to reference agent | Map skill → agent in compile |
| `argument-hint` | NONE | Not generating argument hints | Add to skill frontmatter output |
| `disable-model-invocation` | NONE | Not using | Consider for admin-only skills |
| `user-invocable` | NONE | Not using | Set false for internal-only skills |
| `allowed-tools` | NONE | Not generating tool restrictions | Generate per-skill |
| `$ARGUMENTS` substitution | NONE | Not using | Use in skill templates |
| `${CLAUDE_SESSION_ID}` | NONE | Not using | Use in audit trail skills |
| `${CLAUDE_SKILL_DIR}` | NONE | Not using | Reference supporting files |
| Dynamic context `!`cmd`` | NONE | Not using | Use for live PR data, git context |
| Supporting files (reference.md) | NONE | Not generating | Generate reference docs per skill |
| Skill hooks | NONE | Not generating per-skill hooks | Add audit hooks to review skills |
| Enterprise-managed skills | NONE | Not targeting managed locations | Include in managed output |

### Untapped Opportunity: Dynamic Context Injection

Skills can inject live data at invocation time using `` !`command` ``:

```markdown
## Current Changes

!`git diff HEAD`

## Review these changes against the following standards...
```

This means the `/review-code` skill can automatically include the current diff without
the persona needing to run `git diff` as a separate tool call. It saves a turn and
ensures the review always starts with the right context.

Other high-value injections:
- `` !`git log --oneline -10` `` — recent commit context
- `` !`cat .claude/CLAUDE.md` `` — project rules
- `` !`gh pr view --json title,body` `` — PR metadata

### Untapped Opportunity: Argument Hints

```yaml
argument-hint: "[file-or-directory] [--format json|markdown]"
```

Provides autocomplete guidance when developers type `/review-code`. Small quality-of-life
improvement that makes skills more discoverable and self-documenting.

---

## 5. Rules System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `.claude/rules/` generation | PARTIAL | Designed for gotchas rules | Implement in compile output |
| `paths:` frontmatter | PARTIAL | Designed with `paths:` frontmatter | Verify compile.ts uses `paths:` |
| Always-on rules (no paths) | PARTIAL | Designed for standards rules | Generate from always-on instructions |
| User-level rules `~/.claude/rules/` | NONE | Not in AgentBoot's scope | Document as user customization |
| Symlink support | NONE | Not using | Consider for shared rules across repos |
| Recursive directory discovery | NONE | Not leveraging nested rules dirs | Consider for deep domain rule trees |

### Untapped Opportunity: Symlinked Rules

Instead of copying rules into every target repo, the sync could create symlinks to a
shared location. This would reduce disk usage and make updates instant. However, this
only works when the shared repo is available locally (not for CI or remote developers).

---

## 6. Hooks System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `UserPromptSubmit` | PARTIAL | Designed for input scanning | Implement hook script generation |
| `PreToolUse` | NONE | Not generating | Generate for dangerous command blocking |
| `PostToolUse` | NONE | Not generating | Generate for audit logging |
| `Stop` | PARTIAL | Designed for output scanning | Implement hook script generation |
| `SessionStart` | NONE | Not generating | Generate for env setup, audit logging |
| `SessionEnd` | NONE | Not generating | Generate for session audit summary |
| `SubagentStart`/`SubagentStop` | NONE | Not generating | Generate for persona invocation logging |
| `PermissionRequest` | NONE | Not generating | Generate for compliance audit |
| `PreCompact`/`PostCompact` | NONE | Not using | Could preserve persona state |
| `ConfigChange` | NONE | Not using | Could detect unauthorized config changes |
| `WorktreeCreate`/`WorktreeRemove` | NONE | Not using | Logging for worktree isolation |
| `TeammateIdle`/`TaskCompleted` | NONE | Not using | Agent team coordination |
| `InstructionsLoaded` | NONE | Not using | Could validate instruction integrity |
| `Notification` | NONE | Not using | Custom notification behavior |
| `StopFailure` | NONE | Not using | Error tracking per persona |
| `Elicitation`/`ElicitationResult` | NONE | Not using | MCP interaction logging |
| `prompt` hook type | NONE | Not using | LLM-evaluated compliance checks |
| `agent` hook type | NONE | Not using | Complex validation via subagent |
| `http` hook type | NONE | Not using | Webhook to external audit systems |
| `async` hooks | NONE | Not using | Non-blocking audit logging |
| Hook matchers for MCP tools | NONE | Not using | Monitor MCP tool usage |

### Untapped Opportunity: Comprehensive Audit Trail via Hooks

AgentBoot should generate a standard set of audit hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": ".claude/hooks/audit-session-start.sh", "async": true }]
    }],
    "SubagentStart": [{
      "hooks": [{ "type": "command", "command": ".claude/hooks/audit-persona-start.sh", "async": true }]
    }],
    "SubagentStop": [{
      "hooks": [{ "type": "command", "command": ".claude/hooks/audit-persona-stop.sh", "async": true }]
    }],
    "PostToolUse": [{
      "matcher": "Edit|Write|Bash",
      "hooks": [{ "type": "command", "command": ".claude/hooks/audit-tool-use.sh", "async": true }]
    }],
    "SessionEnd": [{
      "hooks": [{ "type": "command", "command": ".claude/hooks/audit-session-end.sh", "async": true }]
    }]
  }
}
```

All async so they don't slow down the developer. Output: structured NDJSON to a log
file. This gives organizations a complete audit trail of every persona invocation,
every tool use, and every session — without any developer effort.

### Untapped Opportunity: `prompt` Hook Type for Compliance

Instead of regex-based input scanning, use a `prompt` hook with a fast model:

```json
{
  "type": "prompt",
  "prompt": "Does the following text contain PII, PHI, credentials, or internal URLs? Respond YES or NO only.\n\nText: $INPUT",
  "model": "haiku",
  "timeout": 5
}
```

This catches patterns that regex misses (e.g., natural language descriptions of patients,
paraphrased credentials). More expensive than regex but more accurate. Could be a
configurable Layer 1.5 between deterministic hooks and instruction-based refusal.

### Untapped Opportunity: `PreToolUse` for Dangerous Command Blocking

```json
{
  "PreToolUse": [{
    "matcher": "Bash",
    "hooks": [{
      "type": "command",
      "command": ".claude/hooks/block-dangerous-commands.sh"
    }]
  }]
}
```

Block `rm -rf`, `git push --force`, `DROP TABLE`, etc. at the hook level. This is
stronger than instruction-based guidance because it's deterministic.

---

## 7. MCP System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `.mcp.json` generation | PARTIAL | Designed but no implementation | Implement in compile/sync |
| Agent-scoped MCP | NONE | Not generating in agent frontmatter | Add `mcpServers` to persona config |
| Managed MCP | NONE | Not generating managed-mcp.json | Include in managed output |
| MCP allowlist/denylist | NONE | Not generating policies | Include in managed settings |
| MCP resources (@-references) | NONE | Not using | Could expose knowledge base as resources |
| MCP prompts as commands | NONE | Not using | Could expose persona skills as MCP prompts |
| OAuth configuration | NONE | Not generating OAuth config | Include for authenticated services |
| Environment variable expansion | NONE | Not using in generated configs | Use for secrets/tokens |
| `claude mcp serve` | NONE | Not using | Could expose AgentBoot as MCP server |

### Untapped Opportunity: AgentBoot as MCP Server

`claude mcp serve` turns Claude Code into an MCP server. AgentBoot could provide an
MCP server that other tools consume — exposing persona invocation, trait lookup, and
governance status as MCP tools and resources. This would let Copilot, Cursor, or any
MCP client access AgentBoot-governed personas without Claude Code.

### Untapped Opportunity: Knowledge Base as MCP Resources

Domain knowledge could be exposed as MCP resources:

```
@agentboot:knowledge://compliance/hipaa-safe-harbor
@agentboot:knowledge://architecture/domain-boundaries
```

Developers reference knowledge in prompts; the MCP server returns the relevant content.
This is the MCP-first integration pattern described in the concepts doc.

---

## 8. Memory System

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| Auto memory | NONE | Not leveraging | Could seed project memory with persona context |
| Agent memory (`memory:` field) | NONE | Not using | Map to self-improvement reflections |
| `autoMemoryDirectory` | NONE | Not configuring | Document for users |
| 200-line MEMORY.md index | NONE | Not using | Leverage for persona context persistence |

### Untapped Opportunity: Seeded Project Memory

AgentBoot's sync could seed the target repo's auto memory with project-relevant context:

```
~/.claude/projects/<project>/memory/
├── MEMORY.md              ← Generated by AgentBoot with persona summary
├── architecture.md        ← Domain context from domain layer
└── gotchas.md             ← Condensed gotchas for memory (vs. rules for enforcement)
```

This gives Claude persistent knowledge about the project that survives across sessions,
beyond what CLAUDE.md provides. CLAUDE.md is instructions; memory is knowledge.

---

## 9. CLI Features

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| `--agent` flag | N/A | Native; users invoke directly | Document usage patterns |
| `-p` (print mode) | NONE | Not using for testing | Use in behavioral test pipeline |
| `--json-schema` | NONE | Not using | Use for structured review output validation |
| `--max-turns` | NONE | Not using | Use in behavioral tests to limit cost |
| `--max-budget-usd` | NONE | Not using | Document for cost-conscious orgs |
| `--system-prompt` | NONE | Not using | Could use for testing persona prompts |
| `--output-format json` | NONE | Not using | Use in CI for machine-readable review output |
| `--from-pr` | N/A | Native | Document for PR review workflow |
| `--worktree` | NONE | Not using in testing | Use for isolated test execution |
| `--effort` | NONE | Not setting per-persona | Add effort to persona config |
| `--fallback-model` | NONE | Not using | Document for resilient CI pipelines |

### Untapped Opportunity: Headless Behavioral Testing

AgentBoot's behavioral test suite should use Claude Code's print mode:

```bash
claude -p \
  --agent code-reviewer \
  --output-format json \
  --max-turns 5 \
  --max-budget-usd 0.50 \
  "Review the file src/auth/login.ts"
```

This is deterministic, scriptable, and cost-bounded. The JSON output can be parsed
and validated against expected finding patterns. Combined with `--json-schema`, the
output structure is guaranteed.

---

## 10. Other Features

| Feature | Coverage | Notes | Action Needed |
|---------|----------|-------|---------------|
| Task system (TaskCreate, etc.) | NONE | Not using | Could use for multi-persona orchestration |
| Cron (CronCreate, etc.) | NONE | Not using | Could schedule recurring compliance scans |
| Agent teams / TeammateIdle | NONE | Not using | Future: coordinated multi-persona reviews |
| `context: fork` + `agent:` | PARTIAL | Designed but not generating | Implement in skill output |
| Dynamic context `!`cmd`` | NONE | Not generating | High value for review skills |
| Worktree isolation | NONE | Not generating | Use for parallel review execution |
| LSP tool | NONE | Not using | Could enhance code review accuracy |
| Extended thinking / effort | NONE | Not configuring | Add per-persona effort level |
| `/batch` skill | N/A | Native | Document for large-scale reviews |
| Keybindings | N/A | User preference | Document available actions |
| Status line | N/A | User preference | — |

### Untapped Opportunity: Task System for Multi-Persona Orchestration

The `/review` meta-skill could use the Task system to orchestrate multiple reviewers:

1. `/review` creates tasks: "security review", "code review", "cost review"
2. Each task is assigned to the appropriate persona agent
3. Agents run in parallel (background mode or worktrees)
4. `TaskCompleted` hooks aggregate results
5. Persona arbitrator resolves conflicts

This is native Claude Code multi-agent coordination without custom infrastructure.

### Untapped Opportunity: Cron for Scheduled Compliance

```
CronCreate: "Run /review-security on all changed files" every 24h
```

Recurring security scans, architecture drift detection, or compliance checks. No CI
pipeline configuration needed — it runs inside Claude Code.

---

## Priority Summary

### Immediate (implement in compile.ts / sync.ts)

1. **Generate `.claude/agents/{name}/CLAUDE.md`** with full frontmatter (model, permissionMode, maxTurns, disallowedTools, skills, mcpServers, hooks, memory)
2. **Generate `.claude/skills/{name}/SKILL.md`** with `context: fork`, `agent:`, `argument-hint`, dynamic context injection
3. **Generate `.claude/settings.json`** with hooks (audit trail, compliance) AND permissions (allow/deny rules)
4. **Generate `.claude/rules/{topic}.md`** with `paths:` frontmatter from gotchas and domain rules
5. **Use `@import`** in generated CLAUDE.md instead of inlining traits
6. **Generate `.mcp.json`** for domain-layer MCP servers
7. **Add `permissionMode: plan`** to all review personas (read-only enforcement)
8. **Add `memory: project`** to personas with self-improvement enabled

### Near-Term (V1 polish)

9. Dynamic context injection (`` !`git diff HEAD` ``) in review skills
10. Audit hook generation (SessionStart, SubagentStart/Stop, PostToolUse, SessionEnd)
11. `argument-hint` in all skill frontmatter
12. `skills` preloading in agent frontmatter
13. CLAUDE.md size validation (warn if >200 lines)
14. Behavioral test pipeline using `claude -p --output-format json`

### V2+ (advanced features)

15. Managed settings generation with full lockdown (`allowManagedHooksOnly`, etc.)
16. Managed MCP with allowlist/denylist policies
17. `prompt` hook type for LLM-evaluated compliance
18. Subdirectory CLAUDE.md for deep domain knowledge
19. AgentBoot as MCP server (`claude mcp serve`)
20. Knowledge base as MCP resources
21. Task system for multi-persona orchestration
22. Cron for scheduled compliance scans
23. Seeded project memory
24. Agent teams coordination
