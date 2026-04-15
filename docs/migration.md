---
sidebar_label: "Migration Guide"
sidebar_position: 3
---

# Migration Guide

Upgrade instructions for each AgentBoot release that requires action. Releases not
listed here are backward-compatible and require only a package update.

---

## v0.9 → v0.10

**What changed:** v0.10 ships the `/ab` skill — a five-agent orchestrator that replaces
direct CLI usage for interactive work. It also introduces the AgentBoot MCP server, which
the skill requires. Neither existed in v0.9, so a fresh `agentboot install` is needed
to write the new files into your hub.

**`/ab` is available in every repo, not just the hub.** After installing and syncing,
developers can use `/ab` from any spoke repo without switching to the hub directory.
The MCP server resolves the hub automatically from a global registry written during
`agentboot install`.

### Migration steps

**1. Update the package**

```bash
npm install -g agentboot@latest
```

Verify:

```bash
agentboot --version   # should show 0.10.x or higher
```

**2. Re-run install in your hub**

```bash
cd /path/to/your-personas-hub
agentboot install
```

This is safe to run on an existing hub. It will:

- Write five skill files into `.claude/agents/`:
  `ab.md`, `ab-author.md`, `ab-diagnose.md`, `ab-manage.md`, `ab-query.md`
- Create or update `.mcp.json` with the AgentBoot MCP server entry. Existing MCP
  server entries are preserved — only the `agentboot` entry is added or updated.
- Register the hub in `~/.agentboot/config.json` so the MCP server can resolve it
  from any repo on this machine.
- Leave all other hub content (traits, personas, gotchas, `repos.json`,
  `agentboot.config.json`) untouched.

**3. Build and sync**

Rebuild your personas and sync to all registered repos. This updates the `/ab` agents
and writes the AgentBoot MCP server entry to every spoke's `.mcp.json`:

```bash
cd /path/to/your-personas-hub
agentboot build
agentboot sync
```

**4. Restart Claude Code**

Claude Code reads `.mcp.json` at startup. Restart it in any repo to pick up the MCP
server — the hub, a spoke, or any other directory:

```bash
claude
```

**5. Verify**

Type `/ab` in Claude Code. The orchestrator should respond and offer to route your
request to the right specialist. If it doesn't, see [Troubleshooting](#troubleshooting)
below.

You can verify from any spoke repo, not just the hub:

```bash
cd /path/to/any-spoke-repo
claude
# then type /ab
```

---

### What you get after upgrading

| Before (v0.9) | After (v0.10) |
|---|---|
| `agentboot build` in terminal | `/ab build` in Claude Code |
| `agentboot sync` in terminal | `/ab sync` in Claude Code |
| `agentboot add trait <name>` | `/ab add trait <name>` |
| `agentboot import --path <dir>` | `/ab import <dir>` |
| `agentboot doctor` | `/ab diagnose` |
| `agentboot cost-estimate` | `/ab cost-estimate` |

The CLI still works for all commands — it is the CI and scripting interface. `/ab`
is the interactive interface for day-to-day use. You do not need to migrate existing
scripts.

---

### If you have multiple hubs

Run `agentboot install` separately in each hub directory. Each hub is registered
in `~/.agentboot/config.json`. The first one registered becomes the default — the
hub the MCP server uses when `/ab` is invoked from a spoke repo.

```bash
cd ~/work/acme-personas && agentboot install
cd ~/work/sideproject-personas && agentboot install
```

To change the default hub, edit `~/.agentboot/config.json` and update the
`"defaultHub"` field to the path you want. `agentboot hubs` (coming in a future
release) will make this interactive.

---

### If you moved your hub after the v0.9 install

The hub's `.mcp.json` and the global registry (`~/.agentboot/config.json`) both
record the hub's absolute path at install time. If you moved the hub directory,
both will point to the old location and the MCP server will fail to find your config.

Fix: re-run `agentboot install` from the hub's new location. This updates both
`.mcp.json` and the registry entry.

```bash
cd /new/location/personas
agentboot install
```

---

### Troubleshooting

**`/ab` is not recognized in Claude Code**

The skill files were not written or Claude Code has not restarted. Check:

```bash
ls /path/to/your-hub/.claude/agents/
# Should show: ab.md ab-author.md ab-diagnose.md ab-manage.md ab-query.md
```

If the files are missing, re-run `agentboot install` from the hub directory.
If the files are present, restart Claude Code.

**`/ab` responds but MCP tools fail**

The MCP server is not running or is resolving the wrong hub. Check in order:

1. Confirm the global registry points to your hub:
```bash
cat ~/.agentboot/config.json
# "defaultHub" should be your hub's absolute path
```

2. Confirm `.mcp.json` exists in the repo where you're running Claude Code:
```bash
cat /path/to/repo/.mcp.json
# Should contain an "agentboot" entry
```

3. If either is missing or wrong, re-run `agentboot install` from your hub directory.

To confirm the MCP server starts and resolves the right hub, run it manually:

```bash
agentboot mcp-server
```

You should see `AgentBoot MCP server listening` with the hub path shown. `Ctrl+C` to stop.

**MCP server starts but reports wrong hub**

The global registry (`~/.agentboot/config.json`) has a stale `defaultHub` path.
Open it and update `"defaultHub"` to your hub's current absolute path, or re-run
`agentboot install` from the hub to regenerate it automatically.

**AgentBoot defaults are over the 8,000-token persona budget**

This is a known issue in v0.10.0 affecting the four built-in personas
(`review-code`, `review-security`, `gen-tests`, `gen-testdata`). These personas
compile to 10,000–11,000 tokens when all traits are composed. This does not prevent
compilation or sync — it is a budget warning only. The fix ships in a subsequent
patch. Your org's custom personas are not affected.

---

## v0.8 → v0.9

No migration required. Update the package:

```bash
npm install -g agentboot@latest
```

v0.9 added multi-platform output targets (Gemini, Windsurf, JetBrains) and the
`agentboot import` command. These activate automatically if you run `agentboot build`
after upgrading. No config changes needed unless you want to enable the new output
targets — see [`docs/configuration.md`](configuration.md) for the `output.platforms`
field.

---

## General upgrade policy

- **Patch releases (0.x.y):** Always backward-compatible. Update and rebuild.
- **Minor releases (0.x):** Usually backward-compatible. Check this page for any action required.
- **Pre-v1.0:** Breaking changes may occur at any minor release. Release notes and this
  page will document all required migration steps.
- **v1.0+:** Semantic versioning applies. Breaking changes only in major releases.

When in doubt after any upgrade: `agentboot install` in your hub, `agentboot validate`,
`agentboot build`. These three commands will surface any incompatibilities.
