---
sidebar_label: "Getting Started"
sidebar_position: 1
---

# Getting Started with AgentBoot

This guide takes you from zero to a working AgentBoot deployment in one sitting. By the
end you will have: an org personas repo, a working sync to one target repo, and a
verified `/review-code` invocation in Claude Code.

Estimated time: 20-30 minutes.

---

## Prerequisites

Before you start, you need:

1. **Claude Code** installed and configured. You should be able to run `claude` from
   the command line and have it connect to your account.
   → Install: [docs.anthropic.com/claude-code](https://docs.anthropic.com/en/docs/claude-code/overview)

2. **Node.js 18 or later.** Check with `node --version`. If you need to upgrade,
   use [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org).

3. **GitHub account** with permission to create repositories in your org (or your
   personal account for solo use).

4. **One target repository** that you want to deploy AgentBoot to. This is any existing
   codebase where you want AI agent governance. You need write access to it.

---

## Step 1: Create your org personas repo from the AgentBoot template

The AgentBoot repo is a GitHub template. Use it to create your private org hub.

```bash
# Replace "my-org-personas" with your preferred repo name
# Replace "my-org" with your GitHub org or username
gh repo create my-org/my-org-personas \
  --template agentboot/agentboot \
  --private \
  --clone
cd my-org-personas
```

If you prefer the GitHub web UI: go to
[github.com/agentboot/agentboot](https://github.com/agentboot/agentboot), click
"Use this template", choose "Create a new repository", and clone the result.

Install dependencies:

```bash
npm install
```

---

## Step 2: Edit agentboot.config.json for your org

Open `agentboot.config.json`. This is the only file you need to edit to configure your
organization's structure. A minimal starting config:

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

---

## Step 3: Register your first target repo

Create `repos.json` in the root of your personas repo. This is the list of repositories
that will receive compiled personas on each sync:

```json
[
  {
    "name": "my-org/my-first-repo",
    "path": "/absolute/local/path/to/my-first-repo",
    "team": "api",
    "group": "platform"
  }
]
```

`name` is the GitHub slug. `path` is the absolute path to the repo on your local machine
(the sync script writes to it directly). `team` and `group` tell the build system which
level of the scope hierarchy this repo belongs to, so it receives the right layered
configuration.

If you do not want to use local paths, the sync script also supports GitHub API mode —
see [`docs/configuration.md`](configuration.md) for the `sync.mode` field.

---

## Step 4: Run the build

The build step resolves all trait compositions, validates persona frontmatter, and
produces the compiled output that will be synced to your target repos.

```bash
npm run build
```

A successful build produces output in `dist/` and generates an up-to-date `PERSONAS.md`.
If the build fails, the error output will tell you which persona or trait has a problem.

Common first-run failures:
- **`agentboot.config.json` validation error:** Check that all persona and trait IDs
  in `enabled` arrays match actual files in `core/personas/` and `core/traits/`.
- **Missing `repos.json`:** Create it as described in Step 3.
- **Node version too old:** Run `node --version` and verify it is 18+.

---

## Step 5: Run your first sync

```bash
npm run sync
```

The sync script reads `repos.json`, writes the compiled `.claude/` directory to each
registered repo, and reports what changed. On a fresh target repo, it will write the
Claude Code-native output:

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

The agents in `.claude/agents/` use Claude Code's full native frontmatter (model,
permissionMode, maxTurns, disallowedTools, mcpServers, hooks, memory). The skills in
`.claude/skills/` use `context: fork` to delegate to the agent with isolated context.
The CLAUDE.md uses `@.claude/traits/critical-thinking.md` imports instead of inlining.

The sync does not commit or push to the target repo. It writes the files locally. You
decide when to commit and push — this is intentional, so you can review the output before
it takes effect.

Commit the output in the target repo:

```bash
cd /path/to/my-first-repo
git add .claude/
git commit -m "chore: deploy AgentBoot V1 personas"
git push
```

---

## Step 6: Verify it works in Claude Code

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

If any command is not recognized, check that the `.claude/agents/ and .claude/skills/` directory was written
correctly in the sync step and that the persona SKILL.md files are present.

---

## Step 7: Add your first team-level customization

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

Run `npm run build && npm run sync` again. Repos registered to the `api` team under
`platform` will now receive the additional always-on instructions and the API contract
reviewer persona, layered on top of the org defaults. Other repos are unaffected.

---

## Step 8: Onboard your team

Once you have a working deployment, tell your team:

1. **Claude Code reads `.claude/` automatically.** No setup required on each developer's
   machine beyond having Claude Code installed. The personas and instructions are active
   the moment they clone the repo and open Claude Code.

2. **Slash commands are ready to use.** Share the invocation table from `PERSONAS.md`
   with your team. The most useful ones to start with:
   - `/review-code` — code review against your team's standards
   - `/review-security` — security-focused review
   - `/gen-tests` — generate unit and integration tests

3. **Changes to agent behavior go through the personas repo.** If a developer wants to
   change how a persona behaves or add a new one, they open a PR against `my-org-personas`,
   not against the target repo. This keeps governance centralized.

4. **The always-on instructions in `.claude/CLAUDE.md` apply automatically.** Developers
   do not need to do anything to activate them. They are active on every Claude Code
   session in that repo.

---

## Next steps

- **Add more repos:** Edit `repos.json` and run `npm run sync` again.
- **Add a domain layer:** See [`docs/extending.md`](extending.md) for how to build
  compliance or domain-specific personas on top of AgentBoot core.
- **Automate sync on merge:** Set up the sync workflow so that every merge to `main` in
  your personas repo automatically opens a PR against each registered repo.
  See [`.github/workflows/validate.yml`](../.github/workflows/validate.yml) for the
  CI foundation you can extend.
- **Read the concepts doc:** [`docs/concepts.md`](concepts.md) explains the trait system,
  scope hierarchy, and distribution model in depth.
