---
sidebar_label: "GitHub Bot Setup"
sidebar_position: 7
---

# GitHub Bot Setup

## The Two-Step Sync Model

AgentBoot uses a two-step distribution model:

1. A change merges to hub `main` — triggers the build + sync GitHub Action.
2. The sync action opens PRs in spoke repos — bot auto-merges if CI passes.

This gives spoke repos visibility and control while keeping the process lightweight.
Spoke teams can see exactly what changed, review if they want to, and rely on their
existing CI to gate the merge.

---

## Setup

### Hub side

The `agentboot.yml` workflow (see `docs/hub-cicd.md`) handles step 1. It runs
`agentboot sync`, which opens PRs in spoke repos with the compiled artifacts. The
sync step uses `GITHUB_TOKEN` to authenticate against spoke repos.

### Spoke repo side

Install a GitHub Action in each spoke repo that auto-merges AgentBoot sync PRs when
CI passes:

```yaml
# .github/workflows/agentboot-automerge.yml
name: Auto-merge AgentBoot sync PRs

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  automerge:
    name: Auto-merge
    runs-on: ubuntu-latest
    if: startsWith(github.head_ref, 'agentboot/sync-')
    steps:
      - uses: actions/checkout@v4
      - name: Run spoke CI
        run: npm test  # or your test command
      - name: Auto-merge
        run: gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**What this does:**
- Detects PRs from AgentBoot sync (branch prefix `agentboot/sync-`).
- Runs the spoke repo's existing test suite to verify nothing breaks.
- Auto-merges with squash if CI passes.

---

## Required Permissions

### Hub repo
- `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`
- The token must have access to spoke repos (use a GitHub App or PAT with cross-repo
  access if spoke repos are in different orgs)

### Spoke repos
- `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`
- Auto-merge must be enabled in repo settings
- The GitHub Actions runner must be allowed to merge PRs

---

## Branch Protection Rules for Spoke Repos

Configure these settings on the `main` (or default) branch of each spoke repo:

- **Require PR reviews:** `0` for full automation, or `1` if you want a human review
  option on sync PRs.
- **Require status checks:** your existing CI checks. AgentBoot sync PRs must pass
  the same bar as any other change.
- **Allow auto-merge:** enabled. Required for the auto-merge workflow above.
- **Restrict pushes to main:** AgentBoot sync PRs come from the hub's GitHub Actions
  runner via PR, not direct push. No special push access needed.

---

## Troubleshooting

**Sync PRs are not being created:** Verify the hub's `GITHUB_TOKEN` has write access
to spoke repos. Check the `agentboot sync` step output in the hub's Actions log.

**Auto-merge is not triggering:** Confirm auto-merge is enabled in the spoke repo's
settings (Settings > General > Allow auto-merge). Verify the branch protection rules
allow the GitHub Actions bot to merge.

**CI fails on sync PRs:** The compiled output from AgentBoot should not break spoke
CI. If it does, check for path conflicts — AgentBoot writes to `.claude/` and
platform-specific directories. Ensure your CI does not lint or test generated files.
Add `.claude/` to your linter's ignore list if needed.
