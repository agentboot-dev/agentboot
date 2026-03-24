---
sidebar_label: "Getting Started"
sidebar_position: 1
---

# Getting Started with AgentBoot

AgentBoot manages your AI agent behavior as source code — versioned, reviewed,
tested, and deployed from a central personas repo to every project in your org.

This guide takes you from zero to a working deployment in one sitting. By the
end you will have: an org personas repo, a working sync to one target repo, and a
verified `/review-code` invocation in Claude Code.

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
   any existing codebase where you want AI agent governance. You need write access.

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

## Step 1: Create your personas repo

The personas repo is the single source of truth for how every AI agent in your
org behaves. Think of it like an infrastructure-as-code repo, but for prompts.

### Option A: Interactive install (recommended)

Run `agentboot install` from any directory. The wizard will guide you through
creating the personas repo in the right location.

```bash
agentboot install
```

The install wizard will:
1. Ask whether you're creating a new personas repo or connecting to an existing one
2. Detect your org from your git remote
3. Recommend a location for the personas repo (separate from your code repos)
4. Scaffold the persona source code, traits, and instructions
5. Automatically compile the personas (`agentboot build`)
6. Optionally register and sync your first target repo

If you already have `.claude/` content, skills, or rules in your repos, the
wizard will detect them and recommend running `agentboot import` to bring that
knowledge into your new personas repo.

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

## Step 2: Configure your org

Open `agentboot.config.json` in your personas repo. If you used `agentboot install`,
this was created for you with your org name detected from git. A minimal config:

```jsonc
{
  "org": "my-org",
  "groups": {
    "platform": {
      "teams": ["api", "infra"]
    },
    "product": {
      "teams": ["web", "mobile"]
    }
  },
  "personas": {
    "enabled": ["code-reviewer", "security-reviewer", "test-generator"],
    "extend": null
  },
  "traits": {
    "enabled": ["critical-thinking", "structured-output", "source-citation"]
  },
  "sync": {
    "repos": "./repos.json"
  },
  "output": {
    "dir": ".claude"
  }
}
```

Fill in `"org"` with your actual org name. You can add or remove groups and teams now,
or leave the defaults and come back to it after the first sync.

The `"enabled"` arrays in `personas` and `traits` control what gets deployed. Start with
the full V1 set and prune after you see what your team uses.

**Solo developers:** Use your GitHub username as the org name. Everything works the same
— solo mode is just an org of one person. You go through the same steps.

**Evaluating without a GitHub repo?** See [Local evaluation](#local-evaluation-no-github-repo-required)
above. You can run everything locally and push to GitHub later.

---

## Step 3: Register your first target repo

Create `repos.json` in the root of your personas repo. This is the list of repositories
that will receive compiled personas on each sync:

```json
[
  {
    "path": "/absolute/local/path/to/my-first-repo",
    "label": "my-org/my-first-repo",
    "group": "platform",
    "team": "api"
  }
]
```

`path` is the absolute path to the repo on your local machine (the sync script writes
to it directly). `label` is a human-readable name (shown in sync output). `group` and
`team` tell the build system which level of the scope hierarchy this repo belongs to,
so it receives the right layered configuration. All fields except `path` are optional.

If you do not want to use local paths, the sync script also supports GitHub API mode —
see [`docs/configuration.md`](configuration.md) for the `sync.mode` field.

**Tip:** Developers on your team can add their own repos by running `agentboot install`
from their code repo and choosing "Connect this repo to an existing personas repo."
This creates a branch and PR against the personas repo — no manual `repos.json`
editing required.

---

## Step 4: Build and sync

If you used `agentboot install`, the build was already run for you. Otherwise:

```bash
agentboot build
```

The build resolves all trait compositions, validates persona frontmatter, and
produces compiled output in `dist/`. Then sync to your target repos:

```bash
agentboot sync
```

The sync script reads `repos.json`, writes the compiled `.claude/` directory to each
registered repo, and reports what changed. On a fresh target repo, it writes:

```
.claude/
  CLAUDE.md                        ← always-on instructions using @imports
  settings.json                    ← hooks (compliance, audit logging)
  .mcp.json                        ← MCP server configs (if any)
  agents/
    code-reviewer/CLAUDE.md        ← full frontmatter (model, tools, hooks, etc.)
    security-reviewer/CLAUDE.md
  skills/
    review-code/SKILL.md           ← invocation surface (context: fork → agent)
    review-security/SKILL.md
    gen-tests/SKILL.md
    gen-testdata/SKILL.md
  traits/
    critical-thinking.md           ← separate trait files for @import
    structured-output.md
    source-citation.md
  rules/
    gotchas-database.md            ← path-scoped rules (paths: frontmatter)
    gotchas-lambda.md
```

If the target repo already has `.claude/` content, sync archives the originals
to `.claude/.agentboot-archive/` before deploying. You can restore them anytime
with `agentboot uninstall`.

The sync does not commit or push to the target repo. It writes the files locally. You
decide when to commit and push — this is intentional, so you can review the output before
it takes effect.

```bash
cd /path/to/my-first-repo
git add .claude/
git commit -m "chore: deploy AgentBoot V1 personas"
git push
```

---

## Step 5: Verify it works in Claude Code

Open your target repo in Claude Code:

```bash
cd /path/to/my-first-repo
claude
```

Now invoke the code reviewer:

```
/review-code
```

If you have staged changes or a recently modified file open, the code reviewer will
activate and produce a structured review output. You should see severity-tiered findings
(CRITICAL / WARN / INFO) with source citations.

To verify the security reviewer:

```
/review-security src/auth/login.ts
```

To verify the test generator:

```
/gen-tests src/services/user-service.ts
```

If any command is not recognized, check that the `.claude/agents/` and `.claude/skills/`
directories were written correctly in the sync step and that the persona SKILL.md files
are present.

---

## Step 6: Add your first team-level customization

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

Run `agentboot build && agentboot sync` again. Repos registered to the `api` team under
`platform` will now receive the additional always-on instructions and the API contract
reviewer persona, layered on top of the org defaults. Other repos are unaffected.

---

## Step 7: Set up governance

Your personas repo is a codebase. Treat it like one:

1. **Enable branch protection on `main`.** Persona changes should go through code
   review — the same discipline you apply to application code.

2. **Add CI validation.** Run `agentboot validate --strict` in your CI pipeline
   to catch errors before merge.

3. **Encourage contributions.** Developers who use the personas daily are your best
   contributors. A low-friction PR workflow lets them propose improvements to the
   prompts they know best.

---

## Step 8: Onboard your team

Once you have a working deployment, tell your team:

1. **Claude Code reads `.claude/` automatically.** No install required on each
   developer's machine beyond having Claude Code. The personas and instructions are
   active the moment they clone the repo and open Claude Code.

2. **Slash commands are ready to use.** Share the invocation table from `PERSONAS.md`
   with your team. The most useful ones to start with:
   - `/review-code` — code review against your team's standards
   - `/review-security` — security-focused review
   - `/gen-tests` — generate unit and integration tests

3. **Changes to agent behavior go through the personas repo.** If a developer wants to
   change how a persona behaves or add a new one, they open a PR against the personas
   repo, not against the target repo. This keeps governance centralized.

4. **Adding new repos is one command.** Developers can run `agentboot install` from
   their code repo to connect it to the personas hub and open a PR to register it.

5. **The always-on instructions in `.claude/CLAUDE.md` apply automatically.** Developers
   do not need to do anything to activate them. They are active on every Claude Code
   session in that repo.

---

## Step 9: Import existing prompt knowledge (optional)

If your org already has hand-written `.claude/` content, CLAUDE.md files, Copilot
instructions, or Cursor rules scattered across repos, you can import them into your
personas repo:

```bash
agentboot import --path ~/work/
```

Import uses AI to scan and classify your existing prompt content into personas, traits,
gotchas, and instructions. It **never modifies or deletes your original files** — it
creates new files in the personas repo only. You review and merge the results.

This is an LLM-powered command that requires an active Claude Code session. See
[CLI Reference](./cli-reference.md) for details.

---

## Next steps

- **Add more repos:** Edit `repos.json` or have developers run `agentboot install` from their repos.
- **Import existing content:** Run `agentboot import` to bring in scattered prompt knowledge.
- **Add a domain layer:** See [`docs/extending.md`](extending.md) for how to build
  compliance or domain-specific personas on top of AgentBoot core.
- **Automate sync on merge:** Set up the sync workflow so that every merge to `main` in
  your personas repo automatically opens a PR against each registered repo.
  See [`.github/workflows/validate.yml`](../.github/workflows/validate.yml) for the
  CI foundation you can extend.
- **Read the concepts doc:** [`docs/concepts.md`](concepts.md) explains the trait system,
  scope hierarchy, and distribution model in depth.
