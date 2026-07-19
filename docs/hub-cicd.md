---
sidebar_label: "Hub CI/CD"
sidebar_position: 6
---

# Hub CI/CD Guide

## Overview

The hub repo (your AgentBoot personas repo) uses a straightforward branching model
and automated pipelines to keep persona changes validated, compiled, and distributed.

---

## Branching Strategy

- **`main`** — production. Everything merged here is compiled and synced to spoke repos
  automatically.
- **Feature branches** — for persona changes, new traits, gotchas. All `/ab`-proposed
  changes use the `ab/*` prefix (e.g., `ab/trait-critical-thinking`,
  `ab/gotcha-lambda-cold-start`).
- **`release/vX.Y`** — release preparation branches for version milestones.

---

## GitHub Actions: Validate + Build + Sync on Merge

Drop this workflow into `.github/workflows/agentboot.yml` in your hub repo:

```yaml
name: AgentBoot Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npx agentboot validate --strict

  build-and-sync:
    name: Build & Sync
    runs-on: ubuntu-latest
    needs: validate
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npx agentboot build
      - run: npx agentboot sync
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**What this does:**
- On every PR: runs `agentboot validate --strict` to catch errors before merge.
- On merge to `main`: validates, builds compiled output, and syncs to spoke repos.

> **Hub scaffolded by a pre-0.16 AgentBoot?** Older versions of `agentboot install`
> did not write a `package.json`/`package-lock.json` pair, and both `npm ci` and
> `setup-node`'s `cache: 'npm'` hard-fail without a lockfile. If your hub predates
> v0.16 and has no `package-lock.json`, run `npm install` once and commit the
> resulting files — or replace `npm ci` with `npm install` in the workflow and drop
> the `cache: 'npm'` lines. Hubs scaffolded by v0.16+ ship the manifest + lockfile
> pair, so the workflow above works as-is. To pin AgentBoot itself, add it as an
> exact-version devDependency — see
> [Enterprise Operations § Pinned, reproducible installs](enterprise-operations.md#3-pinned-reproducible-installs).

---

## CI Interface

For automated environments that use Claude evaluation, the primary interface is
`claude -p --output-format json`. This is cost-bounded and schema-enforced.

---

## `ab/*` Branch Auto-Merge

Branches created by `/ab` follow the `ab/*` naming convention. Configure branch
protection to auto-merge `ab/*` PRs when CI passes. This is optional but recommended
for fast iteration on persona improvements.

**Setup:**
1. Require status checks: `validate` must pass.
2. Enable auto-merge for PRs with the `ab-contribution` label (applied automatically
   by `/ab` when proposing changes).
3. Optionally require one reviewer for non-`ab/*` branches while allowing `ab/*`
   branches to merge on CI pass alone.

**Branch protection settings (GitHub):**
- Require status checks to pass before merging: enabled
- Required checks: `Validate`
- Allow auto-merge: enabled
- Restrict who can push to matching branches: hub maintainers only
