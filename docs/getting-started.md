---
sidebar_label: "Getting Started"
sidebar_position: 1
---

# Getting Started with AgentBoot

AgentBoot is a harness engineering build tool that manages your AI agent behavior
as source code — versioned, reviewed, tested, and deployed from a central personas
repo to every project in your org. It compiles personas into platform-native formats.
Official support targets the **CLI surfaces of Claude Code, Codex, and GitHub Copilot**;
AgentBoot additionally emits for Cursor, Gemini, Windsurf, JetBrains, and the universal
`AGENTS.md` standard on a community-supported basis.

By the end of this guide you will have a personas hub deployed and `/ab` running in
Claude Code — ready to answer questions, manage your setup, and deploy changes.

> **Pre-v1.0 notice:** AgentBoot is under active development. Breaking changes may
> occur without deprecation warnings before v1.0. Release notes will document all
> changes. We do our best to minimize disruption, but stability is not guaranteed
> until v1.0.

---

## Prerequisites

Before you start, you need:

1. **Claude Code** installed and configured. You should be able to run `claude` from
   the command line and have it connect to your account.
   → Install: [docs.anthropic.com/claude-code](https://docs.anthropic.com/en/docs/claude-code/overview)

2. **Node.js 18 or later.** Check with `node --version`. If you need to upgrade,
   use [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org).

3. **GitHub account** with permission to create repositories in your org (or your
   personal account for solo use). If you don't have permission yet, see
   [Local evaluation](#local-evaluation-no-github-repo-required) below.

4. **One target repository** that you want to deploy AgentBoot personas to. This is
   any existing codebase where you want consistent AI agent behavior. You need write access.

---

## Step 0: Install the AgentBoot CLI

```bash
# Recommended
npm install -g agentboot

# Or via Homebrew (macOS Sequoia and earlier)
brew tap agentboot-dev/agentboot && brew install agentboot

# Or run without installing
npx agentboot --help
```

> **macOS Tahoe (macOS 26) users:** Homebrew's sandbox is currently incompatible with
> macOS Tahoe. Use `npm install -g agentboot` instead. See
> [Troubleshooting](./troubleshooting.md#homebrew-install-fails-on-macos-tahoe) for details.

Verify:

```bash
agentboot --version
```

---

## Step 1: Run the install wizard

```bash
agentboot install
```

The wizard will:
1. Ask where to create the personas repo (or use one you already have)
2. Detect your org from git (you confirm)
3. Ask which AI agent tools your team uses
4. Scaffold the personas source code and configuration
5. Build the personas automatically
6. Offer to register your target repos (scans siblings, auto-discovers)
7. Sync compiled personas to registered repos automatically

The wizard generates `agentboot.config.json`. Edit it to customize — see [Configuration](configuration.md).

The wizard registers repos interactively. Edit `repos.json` directly if needed — see [Configuration](configuration.md).

You can also specify options explicitly:

```bash
agentboot install --hub --org acme        # Skip org detection
```

> **After Step 1 completes, restart Claude Code.** The `/ab` skill is deployed during
> install — restarting Claude picks it up.

### Option B: GitHub template

If you prefer to set up manually, the AgentBoot repo is a GitHub template:

```bash
gh repo create my-org/personas \
  --template agentboot/agentboot \
  --private \
  --clone
cd personas
npm install
```

Or use the GitHub web UI: go to
[github.com/agentboot/agentboot](https://github.com/agentboot/agentboot), click
"Use this template", choose "Create a new repository", and clone the result.

### Local evaluation (no GitHub repo required)

If your org requires approval before creating new repositories, you can evaluate
AgentBoot entirely locally. The personas repo is a standard git repo — it does not
need a remote until you're ready to share it.

```bash
mkdir personas && cd personas
git init
agentboot install --hub
```

This gives you a fully functional personas repo on your local machine. Build, sync
to a target repo, and prove value — all without touching GitHub. When the org
approves, push it:

```bash
gh repo create my-org/personas --source . --private --push
```

Nothing changes about the repo structure. There is no "local mode" vs "production mode"
— a personas repo without a remote is the same as one with a remote. Git handles this
natively.

This is the recommended path for **proof-of-concept evaluations** in locked-down
environments. The org can audit every file in the personas repo before it goes to
GitHub, since it's all git-tracked source code.

---

## Step 2: Verify `/ab` is working

Restart Claude Code, then go to any registered repo (or the hub itself) and type:

```
/ab
```

Try a few interactions:

```
/ab how do I add a new persona?
/ab show me what's registered
/ab status
```

To verify the deployed personas work:

```
/review-code
/review-security src/auth/login.ts
/gen-tests src/services/user-service.ts
```

If any command is not recognized, check that the `.claude/agents/` and `.claude/skills/`
directories were written correctly in the sync step and that the persona SKILL.md files
are present.

---

## Step 3: Add your first team-level customization

Team-level customization lets you add personas or instructions that apply only to repos
in a specific team, without affecting the rest of the org.

In your personas repo, create a directory for your team's extensions:

```
personas/
  platform/
    api/
      always-on.md        ← additional always-on instructions for the API team
      personas/
        api-contract-reviewer/
          SKILL.md        ← a persona specific to the API team
```

Then register the extension in `agentboot.config.json`:

```jsonc
{
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator"],
    "customDir": "./personas"
  }
}
```

Run `/ab build` then `/ab sync` (or `agentboot build && agentboot sync` from the terminal).
Repos registered to the `api` team under `platform` will now receive the additional
always-on instructions and the API contract reviewer persona, layered on top of the org
defaults. Other repos are unaffected.

---

## Step 4: Configure your harness

Your personas repo is a codebase. Treat it like one:

1. **Enable branch protection on `main`.** Persona changes should go through code
   review — the same discipline you apply to application code.

2. **Add CI validation.** Run `agentboot validate --strict` in your CI pipeline
   to catch errors before merge.

3. **Encourage contributions.** Developers who use the personas daily are your best
   contributors. A low-friction PR workflow lets them propose improvements to the
   prompts they know best.

---

## Step 5: Onboard your team

Once you have a working deployment, tell your team:

1. **Claude Code reads `.claude/` automatically.** No install required on each
   developer's machine beyond having Claude Code. The personas and instructions are
   active the moment they clone the repo and open Claude Code.

2. **`/ab` is the day-to-day interface.** Type `/ab` in any repo with deployed personas.
   It can answer questions, run builds, sync, import, and diagnose issues.

3. **Slash commands are ready to use.** Share the invocation table from `PERSONAS.md`
   with your team. The most useful ones to start with:
   - `/review-code` — code review against your team's standards
   - `/review-security` — security-focused review
   - `/gen-tests` — generate unit and integration tests

4. **Changes to agent behavior go through the personas repo.** If a developer wants to
   change how a persona behaves or add a new one, they open a PR against the personas
   repo, not against the target repo. This keeps governance centralized.

5. **The always-on instructions in `.claude/CLAUDE.md` apply automatically.** Developers
   do not need to do anything to activate them. They are active on every Claude Code
   session in that repo.

---

## Next steps

- **Use `/ab` day-to-day.** It's the primary interface for managing your personas setup.
  Ask it anything: `/ab how do I add a persona?`, `/ab status`, `/ab sync`.
- **Add more repos:** Edit `repos.json` or have developers run `agentboot install` from their repos.
- **Add a domain layer:** See [`docs/extending.md`](extending.md) for how to build
  compliance or domain-specific personas on top of AgentBoot core.
- **Automate sync on merge:** Set up the sync workflow so that every merge to `main` in
  your personas repo automatically opens a PR against each registered repo.
  See [`.github/workflows/validate.yml`](../.github/workflows/validate.yml) for the
  CI foundation you can extend.
- **Read the concepts doc:** [`docs/concepts.md`](concepts.md) explains the trait system,
  scope hierarchy, and distribution model in depth.
- **Upgrading from an earlier version?** See [`docs/migration.md`](migration.md) for
  step-by-step upgrade instructions.

---

## Advanced: Import existing prompt knowledge

If your org already has hand-written `.claude/` content, CLAUDE.md files, Copilot
instructions, or Cursor rules scattered across repos, you can import them into your
personas repo:

```
/ab import
```

Or from the terminal: `agentboot import --path ~/work/`

Import uses AI to scan and classify your existing prompt content into personas, traits,
gotchas, and instructions. It **never modifies or deletes your original files** — it
creates new files in the personas repo only. You review and merge the results.

This is an LLM-powered command that requires an active Claude Code session. See
[CLI Reference](./cli-reference.md) for details.

---

## Advanced: Developer setup (connecting to an existing hub)

If your org already has a personas repo and you want to connect your code repo to it,
run `agentboot install` from your code repo:

```bash
cd /path/to/my-code-repo
agentboot install --connect
```

The wizard will:
1. Find the personas repo (scans siblings, checks your GitHub org via `gh`)
2. Register your repo in the hub's `repos.json`
3. Create a branch and offer to open a PR against the personas repo
4. Optionally sync compiled output to your repo immediately

You can also specify the hub path explicitly:

```bash
agentboot install --connect --hub-path ~/work/personas
```
