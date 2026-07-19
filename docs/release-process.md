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
   workflow.
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

## Invariants an evaluator can check

| Claim | Where to verify |
|---|---|
| No bot commits on `main` from releasing | `git log` — the workflow never commits |
| Tag == published content | tag points at the merge commit; npm provenance links the artifact to it |
| Docs versions can't lag a release | version-strings preflight in release.yml (step 5) |
| Dependency bumps can't force or wedge a release | release decision (step 3) |
| SBOM completeness is enforced, not assumed | the guard in release.yml step 8 fails the release on any missing production package |
