---
sidebar_label: "Release Process"
sidebar_position: 9
---

# Release process

How AgentBoot ships, stated as the contract it actually follows. This page exists so the
release model is a documented commitment, not tribal knowledge — and so an evaluator can
verify each claim against the workflow files.

## The model: trunk-based, publish decoupled from merge

- **`main` is always releasable.** Every PR passes the full gate (typecheck, validate,
  build, the complete test suite, skills/plugin spec conformance, the enforcement
  conformance harness) on Linux **and** Windows before merge.
- **Merging does not publish.** A release happens only when a merged PR deliberately
  bumps `package.json` past the latest `v*` tag. Any other merge — refactors, docs,
  dependency bumps — lands silently and is absorbed into the next deliberate release.
- **The release PR is the release.** The version bump, CHANGELOG entry, and the tracked
  version-string updates (see below) travel in the same PR as the last changes they
  describe, so the tag always points at a commit whose docs tell the truth about it.

## What the release workflow does (`.github/workflows/release.yml`)

On a merged PR (or manual dispatch), in order:

1. **Concurrency group** — stacked merges queue; releases cannot race or skip.
2. **Exact-commit checkout** — the triggering merge commit, not whatever `main` has
   become since.
3. **Release decision** — `package.json` version vs latest tag. Equal → clean no-op
   ("no version bump in this merge — no release"). A version whose tag already exists →
   loud failure, never a silent skip.
4. **Full gate again** — validate + build + tests on the release commit.
5. **Version-string preflight** — `scripts/version-strings.manifest.json` lists every
   place the current version is hardcoded in public docs/templates; the release fails
   before tagging if any was not bumped. The site can never advertise a version that
   is not shipping.
6. **Tag + GitHub release** — tag on the exact merge commit; notes drafted from merged
   PRs.
7. **npm publish `--provenance`** — the package is publicly attested to this repo and
   workflow. No `--tag` is passed, so every release lands on the **`latest`** dist-tag
   (see below).
8. **SBOM + checksums** — a CycloneDX SBOM generated from a production-only lockfile
   resolution (with a completeness guard that fails the release if any production
   package is missing) and SHA-256 checksums are attached to the GitHub release.
   Verification procedure: SECURITY.md.
9. **Homebrew formula update** — pinned to the immutable npm tarball by URL + SHA-256.

## Versioning

- **Patch** — fixes and internal changes with no behavior contract change.
- **Minor** — new capabilities or behavior changes (each called out in the CHANGELOG's
  per-version behavior-changes list; see migration.md).
- **v1.0.0** will be tagged as a deliberate **freeze event** — a Beta milestone cut from
  `main` when the GA bar is met, not an automatic increment.

## npm dist-tags

**Ruled 2026-08-11: AgentBoot publishes to the `latest` dist-tag, including v1.0.0.**
`npm install agentboot` with no version therefore installs the newest release, and there
is no separate `beta` or `next` channel to opt into.

This is a record of the mechanic already in force, not a change: `release.yml` runs
`npm publish --provenance` with no `--tag`, and npm's default for an unflagged publish is
`latest`. It is written down because the alternative — parking Beta releases on a `beta`
tag — is the kind of thing a reader assumes from the word "Beta", and an unstated
publishing channel is a silent contract. Two consequences worth stating plainly:

- **A release is live the moment it publishes.** There is no staging tag to soak on, so
  the gate that protects installers is the release workflow's own full-suite run
  (step 4), not a channel an early adopter has to choose.
- **Adding a second tag later is additive**; moving `latest` off the newest release is
  not. If a `beta` alias is ever introduced it will point *alongside* `latest`, never
  instead of it.

## Invariants an evaluator can check

| Claim | Where to verify |
|---|---|
| No bot commits on `main` from releasing | `git log` — the workflow never commits |
| Tag == published content | tag points at the merge commit; npm provenance links the artifact to it |
| Docs versions can't lag a release | version-strings preflight in release.yml (step 5) |
| Dependency bumps can't force or wedge a release | release decision (step 3) |
| SBOM completeness is enforced, not assumed | the guard in release.yml step 8 fails the release on any missing production package |
| Releases publish to `latest`, with no hidden channel | `npm publish --provenance` in release.yml carries no `--tag`; `npm dist-tag ls agentboot` |
