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
- Leave all other hub content (traits, personas, gotchas, `repos.json`,
  `agentboot.config.json`) untouched.

**3. Restart Claude Code**

Claude Code reads `.mcp.json` at startup. Restart it to pick up the new MCP server:

```bash
# In your hub directory
claude
```

**4. Verify**

Type `/ab` in Claude Code. The orchestrator should respond and offer to route your
request to the right specialist. If it doesn't, see [Troubleshooting](#troubleshooting)
below.

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

Run `agentboot install` separately in each hub directory. Each hub gets its own
`.mcp.json` with `AGENTBOOT_HUB` set to that hub's path.

```bash
cd ~/work/acme-personas && agentboot install
cd ~/work/sideproject-personas && agentboot install
```

---

### If you moved your hub after the v0.9 install

The `.mcp.json` written during install hardcodes `AGENTBOOT_HUB` to the hub's
absolute path at install time. If you moved the hub directory since then, the path
will be wrong and the MCP server will fail to find your config.

Fix: re-run `agentboot install` from the hub's current location.

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

The MCP server is not running or is misconfigured. Check `.mcp.json` in your hub:

```bash
cat /path/to/your-hub/.mcp.json
```

It should contain an `agentboot` entry with `AGENTBOOT_HUB` set to your hub's
absolute path. If it is missing or the path is wrong, re-run `agentboot install`.

To confirm the MCP server starts correctly, run it manually:

```bash
cd /path/to/your-hub
AGENTBOOT_HUB=$(pwd) agentboot mcp-server
```

You should see `AgentBoot MCP server listening` with no errors. `Ctrl+C` to stop.

**MCP server starts but reports wrong hub**

Your `AGENTBOOT_HUB` in `.mcp.json` points to a different directory. Open `.mcp.json`,
find the `env.AGENTBOOT_HUB` field, and confirm it matches your hub's current absolute
path. Re-run `agentboot install` to regenerate it automatically.

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
