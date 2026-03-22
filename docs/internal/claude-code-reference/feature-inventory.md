# Claude Code Feature Inventory

Complete reference of every Claude Code feature, configuration option, and capability.
Last verified: March 2026.

---

## 1. CLAUDE.md System

### File Locations & Precedence (highest to lowest)

| Priority | Location | Scope | Shared | Excludable |
|----------|----------|-------|--------|------------|
| 1 | Managed policy paths (see below) | Organization | IT-deployed | No |
| 2 | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Project | Yes (git) | Yes |
| 3 | Parent directory CLAUDE.md files (walk up tree) | Ancestors | Varies | Yes |
| 4 | `~/.claude/CLAUDE.md` | User | No | Yes |
| 5 | Subdirectory CLAUDE.md files | Lazy-loaded | Varies | Yes |

Managed policy paths:
- macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`
- Linux/WSL: `/etc/claude-code/CLAUDE.md`
- Windows: `C:\Program Files\ClaudeCode\CLAUDE.md`

### @import Syntax

```markdown
@path/to/file.md           # Relative to importing file
@./docs/api.md              # Explicit relative
@../shared/standards.md     # Parent traversal
@~/preferences.md           # Home directory
@/absolute/path/file.md     # Absolute path
```

- Max recursion depth: **5 levels**
- First external import triggers approval dialog; can decline permanently
- Imported files expand inline at load time
- Relative paths resolve from the **importing file's location**, not cwd

### Behavioral Notes

- Target **under 200 lines** per file (longer = higher context cost, lower adherence)
- Specific, concrete instructions outperform vague goals
- Full CLAUDE.md content **survives compaction** — re-injected fresh after `/compact`
- Subdirectory CLAUDE.md files are **lazy-loaded** when Claude reads files in that directory

### claudeMdExcludes

```json
{
  "claudeMdExcludes": [
    "**/monorepo/CLAUDE.md",
    "/home/user/monorepo/other-team/.claude/rules/**"
  ]
}
```

- Glob patterns matched against absolute file paths
- Configurable at any settings layer
- **Cannot exclude managed policy CLAUDE.md**

---

## 2. Settings System

### Configuration Scopes (highest to lowest precedence)

| Scope | Location | Shared | Override |
|-------|----------|--------|---------|
| Managed | System paths (see §1) | IT-deployed | Cannot be overridden |
| CLI flags | Session | No | Session only |
| Local project | `.claude/settings.local.json` | No (gitignored) | Per-machine |
| Shared project | `.claude/settings.json` | Yes (git) | Per-project |
| User | `~/.claude/settings.json` | No | All projects |

### Complete Settings Fields

```jsonc
{
  // Model & behavior
  "defaultModel": "sonnet|opus|haiku|inherit|<full-model-id>",
  "model": "claude-opus-4-6",
  "agent": "agent-name",                    // Set main agent for session
  "effort": "low|medium|high|max",
  "defaultMode": "default|acceptEdits|dontAsk|bypassPermissions|plan",
  "skipDangerousModePermissionPrompt": true,

  // Permissions
  "permissions": {
    "allow": ["Bash(npm run *)", "Read", "WebFetch(domain:example.com)"],
    "ask": ["Edit"],
    "deny": ["Bash(git push *)", "Agent(Explore)"]
  },

  // Memory
  "autoMemoryEnabled": true,
  "autoMemoryDirectory": "~/custom-memory-dir",
  "claudeMdExcludes": ["pattern"],

  // Environment
  "env": {
    "DEBUG": "true",
    "NODE_ENV": "development"
  },

  // Working directories
  "additionalDirectories": ["../shared", "/absolute/path"],

  // Hooks
  "disableAllHooks": false,
  "hooks": { /* see §6 */ },

  // Plugins
  "enabledPlugins": ["plugin-name"],
  "extraKnownMarketplaces": ["https://github.com/user/marketplace"],
  "strictKnownMarketplaces": false,

  // File suggestions
  "autoIncludeFilesInPrompts": true,

  // Sandboxing
  "sandbox": {
    "enabled": false,
    "mode": "strict|moderate|permissive",
    "readPaths": ["/tmp", "~/.ssh/**"],
    "writePaths": ["/tmp"],
    "allowedDomains": ["example.com", "*.trusted.com"]
  },

  // Attribution
  "contributionAttribution": {
    "userEmail": "user@example.com"
  },

  // Managed-only settings
  "disableBypassPermissionsMode": "disable",
  "allowManagedPermissionRulesOnly": false,
  "allowManagedHooksOnly": false,
  "allowManagedMcpServersOnly": false,
  "blockedMarketplaces": ["untrusted-source"],
  "allow_remote_sessions": true,
  "forceLoginMethod": "oauth|sso|email",
  "forceLoginOrgUUID": "uuid-here"
}
```

### Permission Rule Syntax

**Bash:**
- Exact: `Bash(npm run build)`
- Wildcards: `Bash(npm run *)`, `Bash(git * main)`
- Space before `*` enforces word boundary: `Bash(ls *)` matches `ls -la` but not `lsof`
- Shell operator aware: `Bash(safe *)` won't allow `safe && dangerous`

**Read/Edit path patterns:**
- Project-relative: `Edit(/src/**/*.ts)` → `<project>/src/**/*.ts`
- Home: `Read(~/.zshrc)`
- Absolute: `Edit(//tmp/file.txt)` → `/tmp/file.txt`
- CWD-relative: `Read(src/*.js)` or `Read(./src/*.js)`
- Gitignore glob patterns: `*` (single dir), `**` (recursive)

**Other tools:**
- WebFetch: `WebFetch(domain:example.com)`
- MCP: `mcp__server-name`, `mcp__server__tool-name`, `mcp__server__.*`
- Agent: `Agent(Explore)`, `Agent(my-agent)`
- Skill: `Skill(name)`, `Skill(name *)`

**Evaluation order:** deny → ask → allow (first match wins). Deny always takes precedence.

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Standard prompts for each action |
| `acceptEdits` | Auto-accept file edits for session |
| `dontAsk` | Auto-deny unless pre-approved in allow list |
| `plan` | Read-only — no file edits or commands |
| `bypassPermissions` | Skip prompts (except `.git`, `.claude`, `.vscode`, `.idea`) |

---

## 3. Agent System

### File Format: `.claude/agents/{name}/CLAUDE.md`

```yaml
---
name: agent-id                               # Required (lowercase, hyphens, max 64 chars)
description: When to delegate to this agent  # Required
tools: Read, Grep, Glob, Bash               # Optional: tool allowlist
disallowedTools: Write, Edit, Agent          # Optional: tool denylist
model: sonnet|opus|haiku|inherit|<id>        # Optional (default: inherit)
permissionMode: default|acceptEdits|...      # Optional
maxTurns: 50                                 # Optional: agentic turn limit
skills:                                      # Optional: preload skill content
  - skill-name
mcpServers:                                  # Optional: scoped MCP servers
  server-name:
    type: stdio
    command: npx
    args: ["-y", "package"]
  existing-server: {}                        # Reference existing by name
hooks:                                       # Optional: agent-specific hooks
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
memory: user|project|local                   # Optional: persistent memory scope
background: true|false                       # Optional: run as background task
isolation: worktree                          # Optional: git worktree isolation
---

Agent system prompt in markdown.
```

### Storage Locations (priority order)

1. `--agents` CLI flag (session only, JSON)
2. `.claude/agents/{name}/CLAUDE.md` (project, committed)
3. `~/.claude/agents/{name}/CLAUDE.md` (user, all projects)
4. Plugin's `agents/` directory

### Built-in Agents

| Agent | Purpose | Default Tools |
|-------|---------|---------------|
| `Explore` | Fast codebase exploration | Read, Glob, Grep, Bash, LSP |
| `Plan` | Architecture and planning | Read, Glob, Grep, Bash, LSP, WebFetch, WebSearch |
| `general-purpose` | Multi-step tasks | All tools except Agent |
| `Bash` | Shell command execution | Bash only |
| `statusline-setup` | Status line config | Read, Edit |
| `Claude Code Guide` | CC documentation Q&A | Glob, Grep, Read, WebFetch, WebSearch |

### Invocation Methods

1. **Automatic delegation** — Claude matches task to agent `description`
2. **@-mention** — `@"agent-name (agent)"` guarantees delegation
3. **CLI flag** — `claude --agent agent-name`
4. **Settings** — `"agent": "agent-name"` in settings.json
5. **Natural language** — name the agent; Claude may delegate

### Context Behavior

- Each invocation creates **fresh context** (unless resumed via SendMessage)
- CLAUDE.md files still load in subagent context
- Preloaded skills injected at startup
- Subagents **cannot spawn other subagents** (no nesting)
- Main conversation compaction doesn't affect subagent transcripts
- Subagent transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`

### Memory Scope

| Scope | Directory | Shared |
|-------|-----------|--------|
| `user` | `~/.claude/agent-memory/{name}/` | No (cross-project) |
| `project` | `.claude/agent-memory/{name}/` | Yes (git) |
| `local` | `.claude/agent-memory-local/{name}/` | No (gitignored) |

First 200 lines of agent's `MEMORY.md` loaded at startup. Read/Write/Edit tools auto-enabled when memory is set.

### Background Agents

- Set `background: true` in frontmatter or press `Ctrl+B` while running
- Prompt for permissions upfront; auto-deny unlisted tools
- Run concurrently with main session
- `AskUserQuestion` calls fail silently; agent continues

### Worktree Isolation

- Set `isolation: worktree` in frontmatter
- Agent gets isolated copy of repo (git worktree)
- Auto-cleaned if agent makes no changes
- If changes made, worktree path and branch returned

---

## 4. Skills System

### File Format: `.claude/skills/{name}/SKILL.md`

```yaml
---
name: skill-name                             # Optional (defaults to directory name)
description: When to use this skill          # Recommended (auto-invoke trigger)
argument-hint: "[version] [environment]"     # Optional: CLI autocomplete hint
disable-model-invocation: false              # Optional: user-only trigger
user-invocable: true                         # Optional: hide from / menu
allowed-tools: Read, Grep, Bash              # Optional: tool allowlist
model: sonnet|opus|haiku|inherit             # Optional: override model
context: fork                                # Optional: run in isolated subagent
agent: Explore|Plan|general-purpose|{name}   # Optional: subagent type (requires context: fork)
hooks:                                       # Optional: skill-specific hooks
  PreToolUse:
    - matcher: "Bash"
      hooks: [...]
---

Skill instructions.
```

### String Substitutions

| Placeholder | Expands To |
|-------------|-----------|
| `$ARGUMENTS` | All arguments passed to skill |
| `$ARGUMENTS[N]` or `$N` | Specific argument by index (0-based) |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Directory containing SKILL.md |

### Dynamic Context Injection

Syntax: `` !`command` `` (backticks around shell command)

- Executed **before** Claude sees skill content
- Output replaces the placeholder inline
- Claude sees the result, not the command
- Example: `` !`gh pr diff` `` fetches live PR data at invocation time

### Supporting Files

```
.claude/skills/my-skill/
├── SKILL.md              # Required
├── reference.md          # Optional: detailed docs (on-demand)
├── examples.md           # Optional: usage examples
└── scripts/
    └── helper.py         # Optional: executable scripts
```

### Storage Locations

1. Enterprise: Managed settings (all users)
2. Personal: `~/.claude/skills/{name}/SKILL.md`
3. Project: `.claude/skills/{name}/SKILL.md`
4. Plugin: `{plugin}/skills/{name}/SKILL.md`

### Invocation Control

| Config | User can `/invoke` | Claude auto-invokes |
|--------|-------------------|-------------------|
| Default | Yes | Yes (via description match) |
| `disable-model-invocation: true` | Yes | No |
| `user-invocable: false` | No | Yes |

### Bundled Skills

| Skill | Trigger |
|-------|---------|
| `/batch <instruction>` | Large-scale parallel changes (5-30 worktrees) |
| `/claude-api` | Auto-triggered with anthropic/SDK imports |
| `/debug [description]` | Troubleshoot via debug log |
| `/loop [interval] <prompt>` | Recurring prompts |
| `/simplify [focus]` | Review changes with 3 parallel agents |

---

## 5. Rules System

### File Format: `.claude/rules/{topic}.md`

```yaml
---
paths:                              # Optional glob patterns
  - "src/api/**/*.ts"
  - "src/**/*.{ts,tsx}"
  - "*.md"
---

Rule content in markdown.
```

### Behavior

- Rules **without** `paths:` — loaded at session start (always active)
- Rules **with** `paths:` — loaded on-demand when Claude reads matching files
- Supports brace expansion: `*.{ts,tsx,js}`
- Supports `**` recursive glob

### Storage & Priority

| Location | Scope | Priority |
|----------|-------|----------|
| `.claude/rules/` | Project | Higher |
| `~/.claude/rules/` | User (all projects) | Lower |

- Symlinks supported for sharing rules across projects
- Subdirectory `.claude/rules/` auto-discovered recursively

---

## 6. Hooks System (25 Events)

### All Hook Events

| Event | Matcher | Fires When | Exit 2 Blocks |
|-------|---------|------------|---------------|
| `SessionStart` | startup, resume, clear, compact | Session begins/resumes | No |
| `SessionEnd` | clear, logout, prompt_input_exit, bypass_permissions_disabled, other | Session terminates | No |
| `InstructionsLoaded` | session_start, nested_traversal, path_glob_match, include, compact | CLAUDE.md/rules loaded | No |
| `UserPromptSubmit` | (none) | Before processing user prompt | **Yes** |
| `PreToolUse` | Tool name | Before tool execution | **Yes** |
| `PostToolUse` | Tool name | After tool succeeds | No |
| `PostToolUseFailure` | Tool name | After tool fails | No |
| `PermissionRequest` | Tool name | Permission dialog appears | **Yes** |
| `Stop` | (none) | Claude finishes response | **Yes** |
| `StopFailure` | rate_limit, authentication_failed, billing_error, invalid_request, server_error, max_output_tokens, unknown | Turn ends with API error | No |
| `SubagentStart` | Agent type name | Subagent spawned | No |
| `SubagentStop` | Agent type name | Subagent finishes | **Yes** |
| `Notification` | permission_prompt, idle_prompt, auth_success, elicitation_dialog | Notification sent | No |
| `TeammateIdle` | (none) | Agent team teammate idle | No |
| `TaskCompleted` | (none) | Task marked complete | No |
| `ConfigChange` | user_settings, project_settings, local_settings, policy_settings, skills | Config file changes | **Yes** |
| `PreCompact` | manual, auto | Before context compaction | No |
| `PostCompact` | manual, auto | After compaction completes | No |
| `WorktreeCreate` | (none) | Worktree creation initiated | **Yes** |
| `WorktreeRemove` | (none) | Worktree removal | No |
| `Elicitation` | MCP server name | MCP requests user input | **Yes** |
| `ElicitationResult` | MCP server name | User responds to elicitation | **Yes** |

### Hook Types

**Command hook:**
```json
{
  "type": "command",
  "command": "script.sh",
  "timeout": 600,
  "async": false,
  "statusMessage": "Running validation..."
}
```

**HTTP hook:**
```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks",
  "headers": {"Authorization": "Bearer $TOKEN"},
  "allowedEnvVars": ["TOKEN"],
  "timeout": 30
}
```

**Prompt hook (LLM evaluation):**
```json
{
  "type": "prompt",
  "prompt": "Evaluate whether this is safe: $ARGUMENTS",
  "model": "haiku",
  "timeout": 30
}
```

**Agent hook (subagent with tools):**
```json
{
  "type": "agent",
  "prompt": "Analyze: $ARGUMENTS",
  "model": "inherit",
  "timeout": 60
}
```

### Hook Input (stdin JSON)

```json
{
  "session_id": "uuid",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/directory",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "agent_id": "subagent-id",
  "agent_type": "agent-name"
}
```

Additional fields vary by event (tool_name, tool_input for PreToolUse; response for Stop; etc.).

### Hook Output (stdout JSON)

```json
{
  "continue": true,
  "stopReason": "message if continue=false",
  "suppressOutput": false,
  "systemMessage": "injected warning",
  "decision": "block|allow|deny|ask",
  "reason": "explanation",
  "hookSpecificOutput": { }
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — process JSON output |
| 2 | Block action — show stderr to user |
| Other | Non-blocking error — show in verbose mode |

### Matcher Patterns for MCP Tools

- `mcp__<server>__<tool>` — exact match
- `mcp__memory__.*` — all tools from memory server
- `mcp__.*__write.*` — write operations from any server

### Configuration Locations

- `~/.claude/settings.json` (user)
- `.claude/settings.json` (project, shared)
- `.claude/settings.local.json` (project, local)
- Managed policy settings
- Plugin `hooks/hooks.json`
- Agent/Skill frontmatter `hooks:` field

---

## 7. MCP System

### Configuration: `.mcp.json`

```json
{
  "mcpServers": {
    "server-name": {
      "type": "http|sse|stdio|ws",
      "url": "https://example.com/mcp",
      "command": "/path/to/server",
      "args": ["--arg1", "value"],
      "env": {"KEY": "${ENV_VAR:-default}"},
      "headers": {"Authorization": "Bearer ${TOKEN}"},
      "oauth": {
        "clientId": "id",
        "clientSecret": "secret",
        "callbackPort": 8080,
        "authServerMetadataUrl": "https://auth.example.com/.well-known"
      }
    }
  }
}
```

### Transport Types

| Type | Use Case |
|------|----------|
| `http` | Remote HTTP server (recommended) |
| `stdio` | Local process (npx, python, etc.) |
| `ws` | WebSocket |
| `sse` | Server-Sent Events (deprecated) |

### Installation Scopes

| Scope | Location | CLI Flag |
|-------|----------|----------|
| Local (default) | `~/.claude.json` | `--scope local` |
| Project | `.mcp.json` | `--scope project` |
| User | `~/.claude.json` | `--scope user` |
| Managed | System paths | IT-deployed |

### CLI Commands

```bash
claude mcp add --transport http name https://url
claude mcp add --transport stdio name -- npx package
claude mcp add-json name '{"type":"http","url":"..."}'
claude mcp add-from-claude-desktop
claude mcp list
claude mcp get name
claude mcp remove name
claude mcp reset-project-choices
claude mcp serve                    # Claude as MCP server
```

### Managed MCP

**Option 1: Exclusive control** — `managed-mcp.json` at system paths. Users cannot add/modify.

**Option 2: Policy-based allowlist/denylist:**
```json
{
  "allowedMcpServers": [
    { "serverName": "github" },
    { "serverCommand": ["npx", "-y", "package"] },
    { "serverUrl": "https://mcp.company.com/*" }
  ],
  "deniedMcpServers": [
    { "serverName": "untrusted" }
  ]
}
```
Denylist takes precedence. `managed-mcp.json` overrides both.

### MCP Resources

- Reference: `@server:protocol://path`
- Auto-fetched as attachments
- Fuzzy-searchable in `@` autocomplete
- Example: `@github:issue://123`

### MCP Prompts as Commands

- Format: `/mcp__servername__promptname`
- Discoverable via `/` menu
- Arguments space-separated

### MCP Output Limits

- Warning threshold: 10,000 tokens
- Default max: 25,000 tokens
- Override: `MAX_MCP_OUTPUT_TOKENS=50000 claude`

### Tool Search (Deferred Discovery)

- Auto-enabled when tool descriptions exceed 10% of context
- `ENABLE_TOOL_SEARCH=auto:5` (custom threshold percentage)
- `ENABLE_TOOL_SEARCH=false` to disable

---

## 8. Memory System

### Directory Structure

```
~/.claude/projects/<project>/memory/
├── MEMORY.md          # Index — first 200 lines loaded at session start
├── topic-a.md         # Topic files — loaded on-demand
└── topic-b.md
```

- `<project>` derived from git repo name
- All worktrees in same repo share one memory directory
- Machine-local (not synced)

### Settings

| Setting | Type | Default | Scope |
|---------|------|---------|-------|
| `autoMemoryEnabled` | boolean | true | Any |
| `autoMemoryDirectory` | string | (auto) | User/local/managed only |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | env var | unset | Session |

---

## 9. CLI Features

### Key Flags

```bash
# Session
claude                                  # Interactive mode
claude "prompt"                         # Start with prompt
claude -p "prompt"                      # Print mode (non-interactive)
claude -c                               # Continue last session
claude -r "session-id|name"             # Resume specific session
claude --resume id --fork-session       # Fork from existing session

# Model & effort
claude --model opus|sonnet|haiku
claude --effort low|medium|high|max
claude --fallback-model sonnet          # Print mode only

# Permissions
claude --permission-mode default|acceptEdits|plan|dontAsk|bypassPermissions
claude --tools "Bash,Edit,Read"
claude --allowedTools "Bash(npm *)"
claude --disallowedTools "Bash(git push *)"

# System prompt
claude --system-prompt "text"
claude --system-prompt-file ./file.txt
claude --append-system-prompt "extra"
claude --append-system-prompt-file ./extra.txt

# Agents
claude --agent agent-name
claude --agents '{"name": {...}}'

# Worktrees
claude --worktree feature-name
claude -w feature-name

# Working dirs
claude --add-dir ../lib ../apps

# MCP
claude --mcp-config ./mcp.json
claude --strict-mcp-config
claude --chrome / --no-chrome

# Output (print mode)
claude --output-format text|json|stream-json
claude --input-format text|stream-json
claude --json-schema '{...}'
claude --max-turns 3
claude --max-budget-usd 5.00
claude --no-session-persistence

# Advanced
claude --debug "api,hooks"
claude --verbose
claude --betas interleaved-thinking
claude --init / --init-only / --maintenance
claude --from-pr 123
claude --remote "task"
claude --teleport
claude --name "session-name"
claude --session-id "uuid"
claude --ide
```

---

## 10. Built-in Tools (35)

| Tool | Permission | Purpose |
|------|-----------|---------|
| Agent | No | Spawn subagent |
| AskUserQuestion | No | Multiple-choice questions to user |
| Bash | Yes | Execute shell commands |
| CronCreate | No | Schedule recurring/one-shot prompt |
| CronDelete | No | Cancel scheduled task |
| CronList | No | List scheduled tasks |
| Edit | Yes | Targeted file edits (string replacement) |
| EnterPlanMode | No | Switch to plan mode |
| EnterWorktree | No | Create git worktree |
| ExitPlanMode | Yes | Exit plan mode |
| ExitWorktree | No | Exit worktree |
| Glob | No | File pattern matching |
| Grep | No | Pattern search in files |
| ListMcpResourcesTool | No | List MCP server resources |
| LSP | No | Language server (type errors, navigation) |
| NotebookEdit | Yes | Modify Jupyter notebook cells |
| Read | No | Read file contents (text, images, PDFs, notebooks) |
| ReadMcpResourceTool | No | Read specific MCP resource |
| Skill | Yes | Execute skill |
| TaskCreate | No | Create task |
| TaskGet | No | Get task details |
| TaskList | No | List all tasks |
| TaskOutput | No | Retrieve background task output |
| TaskStop | No | Kill background task |
| TaskUpdate | No | Update task status/deps |
| TodoWrite | No | Session task checklist |
| ToolSearch | No | Search for deferred tools |
| WebFetch | Yes | Fetch URL content |
| WebSearch | Yes | Web search |
| Write | Yes | Create/overwrite files |

---

## 11. Interactive Features

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Cancel current input/generation |
| `Ctrl+D` | Exit session |
| `Ctrl+F` | Kill all background agents (press twice) |
| `Ctrl+L` | Clear screen |
| `Ctrl+O` | Toggle verbose output |
| `Ctrl+R` | Reverse history search |
| `Ctrl+G` | Open in text editor |
| `Ctrl+V` / `Cmd+V` | Paste image from clipboard |
| `Ctrl+B` | Background running tasks |
| `Ctrl+T` | Toggle task list |
| `Esc+Esc` | Rewind or summarize |
| `Shift+Tab` / `Alt+M` | Toggle permission modes |
| `Alt+P` / `Cmd+P` | Switch model |
| `Alt+T` / `Cmd+T` | Toggle extended thinking |
| `Ctrl+K` | Delete to end of line |
| `Ctrl+U` | Delete entire line |
| `Ctrl+Y` | Paste deleted text |
| `Alt+B` / `Alt+F` | Word navigation |

### Input Modes

- `\` + `Enter` — newline (all terminals)
- `Alt+Enter` — newline (macOS default)
- `Shift+Enter` — newline (iTerm2, WezTerm, Ghostty, Kitty)
- `!command` — direct Bash execution
- `@path` — file mention
- `/` — skill/command autocomplete
- `Space` (held) — push-to-talk dictation

### Vim Mode

Enable with `/vim`. Supports: `h/j/k/l`, `w/e/b`, `0/$`, `gg/G`, `f/F/t/T`, `dd/D/dw`, `cc/C/cw`, `yy/yw`, `p/P`, `>>/<<`, `.`, text objects (`iw/aw`, `i"/a"`, `i(/a(`, `i[/a[`, `i{/a{`).

### Keybindings Customization

File: `~/.claude/keybindings.json`

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+e": "chat:externalEditor",
        "ctrl+u": null
      }
    }
  ]
}
```

Contexts: Global, Chat, Autocomplete, Settings, Confirmation, Tabs, Help, Transcript, HistorySearch, Task, ThemePicker, Attachments, Footer, MessageSelector, DiffDialog, ModelPicker, Select, Plugin.

Chords supported: `"ctrl+k ctrl+s": "action"`.

Reserved (cannot rebind): `Ctrl+C`, `Ctrl+D`.

---

## 12. Agent Teams & Task System

### Task Tools

- `TaskCreate` — create task with description, dependencies
- `TaskGet` — get task by ID
- `TaskList` — list all tasks
- `TaskUpdate` — update status (pending → in_progress → completed), add dependencies
- `TaskOutput` — retrieve background task output
- `TaskStop` — kill running background task

### Multi-Agent Coordination

- `TeammateIdle` hook — fires when an agent team teammate is idle
- `TaskCompleted` hook — fires when a task is marked complete
- `--teammate-mode auto|in-process|tmux` — how agents coordinate

### Cron (Scheduled Tasks)

- `CronCreate` — schedule recurring or one-shot prompts
- `CronDelete` — cancel scheduled task
- `CronList` — list all scheduled tasks

---

## 13. Git & Worktree Features

### Worktrees

- CLI: `claude --worktree feature-name` or `-w`
- Tools: `EnterWorktree` / `ExitWorktree`
- Agent: `isolation: worktree` in frontmatter
- Location: `<repo>/.claude/worktrees/<name>`
- Hooks: `WorktreeCreate`, `WorktreeRemove`
- Auto-cleanup if subagent makes no changes

### Session-PR Linking

- Auto-linked when PR created via `gh pr create` in session
- Resume: `claude --from-pr 123` or `--from-pr <url>`

---

## 14. Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLAUDE_ENV_FILE` | Persist env vars across Bash commands |
| `CLAUDE_CODE_REMOTE` | "true" if cloud session |
| `CLAUDE_PROJECT_DIR` | Project root path |
| `CLAUDE_PLUGIN_ROOT` | Plugin installation directory |
| `CLAUDE_PLUGIN_DATA` | Plugin persistent data directory |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Disable auto memory |
| `CLAUDE_CODE_TASK_LIST_ID` | Named task list |
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | Enable/disable prompt suggestions |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | Keep project cwd in Bash |
| `MAX_MCP_OUTPUT_TOKENS` | Override MCP output limit |
| `ENABLE_TOOL_SEARCH` | Control deferred tool discovery |

---

## 15. Configuration File Paths (Complete)

| Path | Purpose |
|------|---------|
| `~/.claude/` | User config home |
| `~/.claude/settings.json` | User settings |
| `~/.claude/keybindings.json` | Keyboard shortcuts |
| `~/.claude/CLAUDE.md` | User-level instructions |
| `~/.claude/agents/` | Personal agents |
| `~/.claude/skills/` | Personal skills |
| `~/.claude/rules/` | Personal rules |
| `~/.claude/projects/{project}/memory/` | Auto memory |
| `~/.claude.json` | MCP config (local/user scope) |
| `.claude/settings.json` | Project settings (shared) |
| `.claude/settings.local.json` | Project settings (local) |
| `.claude/CLAUDE.md` | Project instructions |
| `.claude/agents/` | Project agents |
| `.claude/skills/` | Project skills |
| `.claude/rules/` | Project rules |
| `.claude/agent-memory/` | Agent memory (shared) |
| `.claude/agent-memory-local/` | Agent memory (local) |
| `.claude/worktrees/` | Worktree isolation |
| `.mcp.json` | MCP config (project scope) |
| `CLAUDE.md` | Project instructions (root) |
| `/Library/Application Support/ClaudeCode/` | Managed policy (macOS) |
| `/etc/claude-code/` | Managed policy (Linux/WSL) |
| `C:\Program Files\ClaudeCode\` | Managed policy (Windows) |
