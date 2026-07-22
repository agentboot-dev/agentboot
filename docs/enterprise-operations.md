---
sidebar_label: "Enterprise Operations"
sidebar_position: 8
---

# Enterprise Operations

This is the operations kit for platform and security teams running AgentBoot across an
organization: reference architecture, controls, reproducible installs, rollback and
incident playbooks, and a pilot runbook. It assumes you have read
[Hub CI/CD](hub-cicd.md), [GitHub Bot Setup](github-bot.md), and
[Org Connection](org-connection.md); it cross-links rather than repeats them.

All org names below (`acme-corp`) are invented examples.

---

## 1. Reference architecture

AgentBoot is a build tool, not a runtime: the hub compiles source (traits, personas,
instructions, gotchas) into per-platform artifacts, sync distributes them to spoke
repos as PRs, and drift-check verifies the spokes still match what was synced.

```
              ┌────────────────────────────┐
              │  Private hub repo          │
              │  acme-corp/acme-personas   │
              │  (source of truth)         │
              └────────────┬───────────────┘
              PR review → merge to main
                           │
              CI: validate --strict → build
                           │
                 ┌─────────┴──────────┐
                 ▼                    ▼
          dist/ (compiled)      dist/managed/
                 │                    │  managed-settings.json,
        agentboot sync                │  managed CLAUDE.md, managed-mcp.json
        (PR per spoke,                ▼
         agentboot/sync-*)      MDM channel (Jamf / Intune /
                 │              JumpCloud / Kandji) → developer
                 ▼              machines, non-overridable
   ┌──────────┬──────────┬──────────┐
   │ spoke A  │ spoke B  │ spoke C  │   each spoke carries
   │ .claude/ │ .github/ │ .codex/  │   .agentboot-manifest.json
   └────┬─────┴────┬─────┴────┬─────┘   (SHA-256 per synced file)
        └──────────┴──────────┘
                   │
         agentboot drift-check
         (detects, does not prevent)
```

The loop, end to end:

1. **Build** — every merge to hub `main` runs `agentboot validate --strict` then
   `agentboot build` ([Hub CI/CD](hub-cicd.md)). Compiled output lands in `dist/`.
2. **Sync** — `agentboot sync` opens a PR per registered spoke (branch prefix
   `agentboot/sync-`), writing only agent-configuration paths. Review posture for
   these PRs is a deliberate decision — see
   [GitHub Bot Setup § Decide your review posture first](github-bot.md#decide-your-review-posture-first)
   before enabling any auto-merge.
3. **Drift-check** — each sync writes a `.agentboot-manifest.json` into the spoke's
   target directory with a SHA-256 content hash per managed file. `agentboot
   drift-check` compares spokes against their manifest and reports modified or
   removed files. Drift is **detected, not prevented** — see
   [Platform capability matrix](platform-capability-matrix.md).
4. **Verify** — two commands turn "trust the pipeline" into checked claims:
   - **`agentboot verify-manifest`** verifies a spoke's manifest end to end: the
     manifest's own sha256 content digest, every listed file's hash, and the SSH
     signature when the hub sets `sync.signing`. Non-zero exit on any mismatch —
     drop it into each spoke's CI as a tamper check on synced configuration. The
     manifest also carries **provenance**: the hub commit (with a dirty-tree
     flag), the AgentBoot version, and hashes of the config and policy-exception
     files that produced the artifacts, so any spoke can answer *which reviewed
     hub state produced this*.
   - **`agentboot conformance`** empirically tests the compiled enforcement:
     it executes the built hook scripts per platform with crafted inputs (clean,
     secret canary, malformed, oversized, deny-listed tool) and compares observed
     blocking behavior against the declared enforcement level, writing the result
     to `dist/<platform>/enforcement-manifest.json`. Advisory platforms get a
     manifest stating plainly that no enforcement mechanism exists; unprobeable
     controls are reported *untested*, never assumed to pass. Run it in hub CI so
     "hooks block secrets on platform X" is a tested claim, not an assumption.

**Signed sync manifests.** If your threat model includes tampering between hub CI
and spoke review, enable `sync.signing` (an SSH key via `ssh-keygen -Y sign`) so
every manifest is signed by hub CI. A configured-but-failing signer fails the sync
— never a silent fallback. Pin *who* may sign by keeping an `allowed_signers` file
in your CI and checking the manifest's recorded signer key against it — see
[CLI Reference § verify-manifest](cli-reference.md#agentboot-verify-manifest).

**Managed settings ride a separate channel.** HARD guardrails (denied tools, bypass
disable, forced plugins) are compiled into `dist/managed/` and deployed by your MDM to
the OS-level managed path — not through git, not overridable by developers, Claude
Code only. The deployment procedure, per-scope fragment merging, and the
verify-by-denied-action check are documented in
[Configuration § Deploying the managed output](configuration.md#deploying-the-managed-output-what-your-mdm-operator-ships).

---

## 2. Hub repository controls

The hub is the single point of review for everything the fleet receives, so its
controls matter more than any individual spoke's.

**Branch protection on hub `main`** (extends [Hub CI/CD](hub-cicd.md)):

- Require status checks: `validate` (strict) must pass.
- Require at least 1 review; require CODEOWNERS review so security-sensitive paths
  cannot merge on an AI-platform approval alone.
- Restrict push access to hub maintainers; all changes — including `/ab`-proposed
  `ab/*` branches — arrive via PR.
- If you enable auto-merge for `ab/*` persona-improvement PRs, keep CODEOWNERS rules
  in place: auto-merge still blocks until required owners approve when a sensitive
  path is touched.

**Hub-side CODEOWNERS.** Instruction content and enforcement surfaces have different
blast radii, so give them different owners:

```
# .github/CODEOWNERS (hub repo)

# Instruction content — AI-platform team owns
core/personas/           @acme-corp/ai-platform
core/traits/             @acme-corp/ai-platform
core/gotchas/            @acme-corp/ai-platform
core/instructions/       @acme-corp/ai-platform

# Enforcement surfaces — security co-owns
hooks/                   @acme-corp/ai-platform @acme-corp/security
agentboot.config.json    @acme-corp/ai-platform @acme-corp/security
repos.json               @acme-corp/ai-platform @acme-corp/security
```

`agentboot.config.json` is on the security list because it is where hooks,
permissions, MCP governance (`mcp.approved` / `mcp.enforceApproved`), and the entire
`managed` guardrail block are defined. `repos.json` is there because it controls which
repos receive synced configuration.

**Separation of duties:**

| Role | Owns | Does not |
|---|---|---|
| Persona authors (any engineer, via `/ab propose`) | Draft traits, gotchas, persona changes on `ab/*` branches | Merge to `main`; touch config or hooks |
| AI-platform team | Review/merge instruction content; operate the hub pipeline | Solely approve guardrail changes |
| Security team | Co-approve `hooks/`, config, managed guardrails, MCP allowlist | Author day-to-day persona content |
| MDM operator | Deploy `dist/managed/` artifacts; merge per-scope fragments in the MDM repo | Edit guardrail *content* (that happens in the hub, reviewed) |

The useful property: the person who writes a persona, the person who approves a
guardrail, and the person who ships the managed settings are three different people.

---

## 3. Pinned, reproducible installs

An unpinned toolchain is the easiest supply-chain hole to close. Pin the AgentBoot
version at every point where it is installed or invoked:

**Hub `package.json`.** Install AgentBoot as a devDependency at an exact version and
use `npm ci` in CI (as the [Hub CI/CD](hub-cicd.md) workflow already does) so the
lockfile is authoritative:

```json
{ "devDependencies": { "agentboot": "X.Y.Z" } }
```

(Use the exact version you have vetted — check the current release with
`agentboot --version` or the [CHANGELOG](https://github.com/agentboot-dev/agentboot/blob/main/CHANGELOG.md);
the examples on this page use `X.Y.Z` as a placeholder.)

**Reusable CI workflow.** If you use the reusable workflow
(`.github/workflows/agentboot-ci.yml` in the AgentBoot repo), pin its
`agentboot-version` input and enable the `forbid-latest` policy switch, which fails
the workflow if the version resolves to `latest`:

```yaml
jobs:
  agentboot:
    uses: agentboot-dev/agentboot/.github/workflows/agentboot-ci.yml@main
    with:
      agentboot-version: "X.Y.Z"
      forbid-latest: true
```

(Pin the workflow ref itself to a tag or SHA rather than `@main` if your policy
requires it — standard GitHub Actions hygiene.)

**Generated MCP config is pinned for you.** Every artifact the build emits that
launches AgentBoot via npx — MCP server entries in `.mcp.json` / `mcp.json` / the
Codex `config.toml` — uses a version-pinned spec (`agentboot@X.Y.Z`, the version that
produced the build), never a bare `agentboot`. Spokes therefore keep executing the
reviewed version even if npm's `latest` moves.

**Internal registry.** AgentBoot installs from npm like any package, so the standard
mechanisms apply: point `npm config set registry` (or a scoped `.npmrc`) at your
internal mirror/proxy (Artifactory, Verdaccio, Nexus) and vet versions into it before
they become installable.

**Restricted-network installs.** On networks with no registry access, use `npm pack
agentboot@X.Y.Z` on a connected machine, transfer the tarball, and install it
offline (`npm install ./agentboot-X.Y.Z.tgz`).

**Release verification.** Every release provides three independent verification
routes, documented in
[SECURITY.md § Verifying a release](https://github.com/agentboot-dev/agentboot/blob/main/SECURITY.md):

1. **npm provenance** — packages are published with `npm publish --provenance`
   (Sigstore attestation linking the package to the exact GitHub Actions run and
   commit); `npm audit signatures` in your install environment verifies registry
   signatures and provenance attestations for the installed tree.
2. **Checksums** — each GitHub Release attaches `agentboot-<version>.sha256`
   covering the npm tarball and the SBOM; verify a transferred tarball with
   `shasum -a 256 -c` before an offline install.
3. **SBOM** — each GitHub Release attaches a CycloneDX SBOM
   (`agentboot-<version>.sbom.cdx.json`) of the production dependency tree, for
   ingestion into your dependency-tracking tooling.

For restricted-network installs, verify the checksum and ingest the SBOM **before**
the tarball crosses the boundary — that is the point where provenance is otherwise
lost.

---

## 4. Developer onboarding and offboarding

**Onboarding is designed to be near-zero.** The three delivery paths
([Org Connection](org-connection.md)) cover it:

- Managed machine → MDM already pushed managed settings; guardrails are active before
  the developer does anything.
- Cloning a synced repo → `.claude/` (or the platform equivalent) is already in the
  repo; personas work on first session. Nothing to install.
- Unsynced/new repo → `/ab connect` self-service.

An onboarding doc for `acme-corp` therefore needs roughly one line: *"clone the repo
and start your agent tool; if you're on a new repo, run `/ab connect`."*

**Personal scope stays personal.** Developers can layer their own preferences —
user-level `~/.claude/` content (personal `CLAUDE.md`, personal skills) and Claude
Code's repo-local untracked `CLAUDE.local.md` — on top of the synced configuration.
Sync is strictly hub → spoke: nothing in a developer's personal scope is read by the
build or pushed upstream, and [privacy.md](privacy.md) treats user-level content as
private by design. (Note the precedence caveat: personal preferences compose *under*
org rules — they cannot override managed settings or `rule`-composed artifacts.)

**Offboarding: there is nothing to revoke in AgentBoot itself.** It is a build tool —
no accounts, no per-user licenses, no server-side sessions. Offboarding is your normal
process plus two AgentBoot-adjacent items:

1. Remove the person's access to the hub repo and spoke repos (ordinary GitHub/GitLab
   offboarding — this is what actually gated their access).
2. If the person held or could read any org token used by hub CI to open sync PRs
   (a PAT or GitHub App credential with cross-repo write — see
   [GitHub Bot Setup § Required Permissions](github-bot.md#required-permissions)),
   rotate it.

Machine-local leftovers on a returned device (`~/.agentboot/` registry and telemetry,
`~/.claude/` content) are wiped by standard device reimaging; none of them grant
access to anything.

---

## 5. Emergency disable and rollback

Everything AgentBoot delivers through git **is just files in a repo**, which makes
rollback ordinary git work:

**Roll back one spoke.** Revert the sync PR (or `git revert` the sync commit) in the
spoke. The repo's agent configuration returns to the prior state immediately for
everyone who pulls.

**Roll back the fleet.** Revert the offending change in the **hub**, merge, and let
the pipeline re-build and re-sync. Every spoke gets a corrective sync PR. This is the
preferred path — it fixes the source of truth, so the bad state cannot re-sync.

**Roll back managed settings.** The MDM channel is independent of git: redeploy the
previous `managed-settings.json` artifact through your MDM (this is why the merged
managed files should live in a reviewed MDM repo, per
[Configuration § Deploying the managed output](configuration.md#deploying-the-managed-output-what-your-mdm-operator-ships)).
Then re-run the post-deployment verification on one machine — confirm a denied tool
is actually blocked.

**Roll back the tool version.** Change the pinned version (hub devDependency, the
reusable workflow's `agentboot-version` input) back to the last good release and
rebuild. Because generated MCP entries pin the building version, a rebuild + resync
also rolls back what spokes execute via npx.

**Emergency stop.** To halt distribution entirely: disable the hub's build-and-sync
workflow (or block merges to hub `main`). No new sync PRs are created; spokes stay
frozen at their current state.

**Don't hand-delete files in spokes.** Drift-check compares spokes against their
manifest and will flag manual deletions and edits as drift — correctly, because the
spoke no longer matches what was reviewed. The clean path is always
revert-through-git (spoke revert for speed, hub revert for the real fix). To remove
AgentBoot-managed files from a repo deliberately, use `agentboot uninstall`, which
removes exactly what the manifest lists.

---

## 6. Incident response

Playbook for a compromised or malicious artifact — a poisoned persona/instruction
file, a tampered hook, a bad upstream package version, or a rogue MCP server entry.

1. **Contain.** Emergency-stop distribution (disable the hub sync workflow). If the
   artifact rode the MDM channel, pull or replace the managed deployment.
2. **Identify scope.** Every synced spoke carries `.agentboot-manifest.json` with
   SHA-256 hashes of exactly what was delivered; `agentboot drift-check --format
   json` across the fleet tells you which repos hold which content, and the hub's git
   history tells you which commit introduced it and which sync runs shipped it. Run
   `agentboot verify-manifest` per spoke to distinguish *delivered-as-reviewed*
   content (manifest digest, file hashes, and signature all check out — the
   manifest's provenance block names the hub commit to investigate) from *tampered*
   content (verification fails — widen the investigation beyond the hub).
3. **Roll back.** Revert the hub commit (or the version pin, for a bad upstream
   release), rebuild, resync the fleet (Section 5). For MCP: remove the server from
   `mcp.approved` — with `mcp.enforceApproved` set, the allowlist is the control
   point — and resync.
4. **Rotate credentials.** Rotate the hub CI token (the cross-repo PAT or GitHub App
   credential used by `agentboot sync`), and any secrets available to hub CI (e.g.
   `ANTHROPIC_API_KEY` if behavioral tests are enabled).
5. **Review telemetry where available.** If telemetry was enabled, each
   developer machine has an NDJSON log (`telemetry.logPath`, default
   `~/.agentboot/telemetry.ndjson`) of persona invocations — useful for answering
   "was the poisoned persona actually invoked, and when." If the org configured a
   `telemetry.sink`, prefer the shipped batches at the org's own collector: they
   survive local deletion and can be integrity-checked with
   `agentboot telemetry-verify --batches <dir> --require-signed`.
6. **Post-incident.** Feed the root cause back into controls: a CODEOWNERS gap, a
   missing `validation.secretPatterns` entry, an unpinned install, an over-broad
   `repos.json`.

**Where the audit trail lives, and its limits.** The durable, trustworthy trail is
**git**: hub history (what was authored and by whom), sync PRs in each spoke (what
was delivered and when), and the manifests (what should be on disk now). Telemetry
records only minimal invocation events (persona id, timestamp, status; no prompts,
by design invariant — see [privacy.md](privacy.md)), and its trust posture depends
on how you run it:

- **Local-only (the default):** the NDJSON log is local to each developer's machine
  and developer-writable / deletable. Its hash chain makes post-write edits,
  deletions, and reordering *detectable* (`agentboot telemetry-verify --log`), but
  the chain is unkeyed — it cannot prevent a full consistent rewrite. Treat a
  local-only log as a best-effort investigation aid, not tamper-proof evidence.
- **With an org sink configured (`telemetry.sink`):** `agentboot telemetry-ship`
  ships events to the org's **own** HTTPS collector — there is no default endpoint
  and nothing ever goes to the AgentBoot vendor — as sequence-numbered,
  digest-chained batches, SSH-signed when `sync.signing` is enabled. Shipped
  batches survive local deletion, and their tamper-evidence is checkable with
  `agentboot telemetry-verify --batches <dir> --require-signed --allowed-signers
  <file>` (`--require-signed` is the actual defense — without it, stripped
  signatures pass).

The honest residual limit: a developer who controls the machine can suppress events
**before first shipment** (bound this with an org-controlled ship cadence, e.g. a
scheduled `telemetry-ship` outside the developer's editable config), and the local
chain alone is not non-repudiable. See
[assurance-claims.md](assurance-claims.md) rows 6 and 12 for the precise claims and
their executed probes.

---

## 7. Backup and restore

**The hub repo IS the state.** Source of truth for every persona, trait, instruction,
gotcha, config, and repo registration is the hub's git history. Your existing git
backup/DR posture (mirrors, the hosting provider's redundancy) is the AgentBoot
backup story. Restore = restore the repo, re-run build + sync.

Everything else is regenerable:

| Artifact | Nature | Restore |
|---|---|---|
| Hub repo | Source of truth | Git backup/restore |
| `dist/` | Compiled output | `agentboot build` — never backed up, always rebuilt |
| Spoke `.claude/` etc. | Compiled output + in each spoke's own git history | Re-run `agentboot sync` |
| `~/.agentboot/config.json` | Machine-local hub registry (convenience for `/ab` and the MCP server) | Re-run `agentboot connect <hub-path>`; nothing unique is lost |
| `~/.agentboot/` telemetry | Machine-local, optional | Local log not restorable. With `telemetry.sink` configured, shipped batches live on the org's own collector (org-owned infrastructure — back it up like any org datastore); events not yet shipped are lost with the machine |
| Managed artifacts in MDM | Copies of `dist/managed/` output | Rebuild from hub; keep the merged per-fleet files in a reviewed MDM repo |

The one thing to actively protect is the hub repo. Everything downstream is a build
product.

---

## 8. Multi-team ownership

The scope tree ([Concepts § The scope hierarchy](concepts.md#the-scope-hierarchy)) is
also the ownership model. The common shape is `org → group → team → repo` (the N-tier
`nodes` config supports arbitrary depth), and conflicts resolve by composition type:
**rule** artifacts compose top-down (org wins — gotchas, personas, persona-rules,
lexicons by default), **preference** artifacts compose bottom-up (team wins — traits
and instructions by default), overridable per artifact via frontmatter.

Map ownership onto the layers:

| Scope layer | Typical owner | Owns |
|---|---|---|
| Org | AI-platform + security | Universal personas, org gotchas, HARD guardrails, MCP allowlist |
| Group | Group's senior/platform engineers | Horizontal additions (e.g. infra-review personas for all platform teams) |
| Team | Team leads / champions | Team personas, traits, framework-specific instructions |
| Repo | Repo maintainers (via the hub) | Path-scoped instructions |

Two operational notes:

- **All layers live in the hub.** Teams customize through hub PRs touching their
  scope node (or via `/ab propose` / `/ab promote`), not by committing files into
  their own repos — that keeps drift-check meaningful and review centralized.
  Hub-side CODEOWNERS can mirror this: give each team ownership of its own scope
  paths so team-scope changes need team review, not central review.
- **Per-team managed policy** uses the `managed-settings.d` fragments the build
  emits per scope (`00-org`, `10-group`, `20-team`), merged so the org fragment wins
  on conflict, one merged file per fleet segment — see
  [Configuration § Deploying the managed output](configuration.md#deploying-the-managed-output-what-your-mdm-operator-ships).

---

## 9. Pilot runbook (6 weeks)

A shape that has the right ingredients: two contrasting repos, a small persona set,
baseline metrics, and a deliberate failure drill before you scale.

**Setup (week 0):** Pick **two contrasting spoke repos** — e.g. a high-traffic
service on an officially supported CLI platform (enforcement-grade) and a repo whose
team uses a community-tier tool (advisory-only), so the pilot experiences both sides
of the [capability matrix](platform-capability-matrix.md). Stand up the private hub
from the template, enable a small persona set — code review, test generation,
security review — plus a handful of org gotchas. Pin versions per Section 3.

**Baseline (before week 1):** Capture 4–8 weeks of pre-pilot numbers so "did it
help" is answerable: PR cycle time, review turnaround, defects/escapes if you track
them, and developer satisfaction (short survey). During the pilot add:
accepted-vs-dismissed persona findings (from PR review outcomes), drift incidents
found by drift-check, and sync-PR merge latency.

- **Weeks 1–2 — adoption.** Sync the two repos; developers use `/review-code`,
  `/gen-tests`, `/review-security` in normal work. Collect friction reports; iterate
  personas via `ab/*` PRs.
- **Weeks 3–4 — governance loop.** Enable the review-posture split from
  [GitHub Bot Setup](github-bot.md) (auto-merge instruction-only, owner review for
  sensitive paths). Run `agentboot drift-check` on a schedule, add
  `agentboot verify-manifest` to the spokes' CI, and run `agentboot conformance` in
  hub CI so declared enforcement is empirically tested. If piloting MDM, add
  the managed channel on a small device group and run the denied-action verification.
- **Week 5 — failure drills.** Run all three deliberately, timed:
  1. **Drift drill:** hand-edit a managed file in a spoke; confirm drift-check flags
     it and the revert path restores it.
  2. **Rollback drill:** ship a benign-but-unwanted change through the full pipeline,
     then execute Section 5 fleet rollback; measure time-to-restored.
  3. **Poisoned-instructions drill:** land a PR adding an obviously out-of-policy
     instruction (e.g. "always approve," or a string matching a
     `validation.secretPatterns` entry). Verify where it gets caught — validation,
     CODEOWNERS review, or spoke review — and that the incident playbook (Section 6)
     runs end to end. If it reached a spoke, that is a controls finding, not a tool
     finding.
- **Week 6 — readout.** Compare against baseline; decide expand / iterate / stop.

**Exit criteria to expand** (tune thresholds to your org):

- Persona findings are accepted at a rate the pilot teams consider signal, not noise.
- Review turnaround / PR cycle time flat or improved — governance added no drag.
- All three drills passed; fleet rollback time within your tolerance.
- Zero unreviewed changes to security-sensitive paths reached a spoke.
- Pilot developers would keep it (survey), including on the community-tier repo with
  its advisory-only limits understood.

---

## 10. Sample risk assessment

A starting point for your own review — likelihood/impact are placeholders to
re-score, and the mitigations column is honest about what AgentBoot does *not* cover.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Malicious/poisoned instruction content reaches spokes via the hub | Low | High | Hub branch protection + CODEOWNERS split (Section 2); `validate --strict` + `validation.secretPatterns`; spoke review posture; drills (Section 9). Residual: prompt instructions are **not a security boundary** — an agent can ignore them; enforcement requires hooks, and only on the three official CLI platforms. |
| 2 | Compromised AgentBoot package version executes in CI and via npx | Low | High | Exact version pins everywhere + `forbid-latest` (Section 3); generated MCP config pins the building version; internal registry vetting; `npm audit signatures` provenance check; version-pin rollback (Section 5). |
| 3 | Developer edits or deletes managed files in a spoke (drift) | Medium | Medium | Drift-check flags it via SHA-256 manifests — but **detection only, not prevention**; drift you can see, not drift that cannot occur. Revert-through-git; managed settings (CC only) for the non-negotiables. |
| 4 | Hook enforcement assumed on a platform that doesn't provide it | Medium | Medium | [Capability matrix](platform-capability-matrix.md) is the contract: community-tier platforms get **instructions without enforcement**; Copilot CLI hook timeouts fail open. `agentboot conformance` tests the declared level empirically per platform (`dist/<platform>/enforcement-manifest.json`) — run it in hub CI rather than assuming (pilot's contrasting-repo design exists for this too). |
| 5 | Hub CI token (cross-repo write) leaked or abused | Low | High | Least-privilege GitHub App or scoped PAT; rotate on offboarding and incidents (Sections 4, 6); spoke branch protections mean the token can open PRs, not push to main. |
| 6 | Incident forensics gap — telemetry missing or tampered | Medium | Low–Medium | Telemetry is **opt-in** and, without a sink, **local and developer-deletable** ([privacy.md](privacy.md)) — treat local-only logs as best-effort. Configure `telemetry.sink` + `sync.signing` and ship on an org-controlled cadence: shipped batches are digest-chained, signed, and survive local deletion; verify with `telemetry-verify --require-signed`. Residual: a machine-controlling developer can suppress events before first shipment, and the local chain is unkeyed. The durable trail for *content* remains git (hub history, sync PRs, manifests). |
| 7 | Rogue MCP server configured in a spoke | Low | High | `mcp.approved` allowlist + `mcp.enforceApproved` at build/sync; sync PR review on `.mcp.json` (a security-sensitive path). Residual: enforcement applies to synced config — a developer adding a server outside managed scope is drift/policy territory. |
| 8 | Developer works outside the governed tooling entirely | Medium | Medium | Out of AgentBoot's scope by design — hooks bind the agent surface, not the developer. Pair with normal repo-level controls: branch protection, CI, human review. |

---

## See also

- [Hub CI/CD](hub-cicd.md) — the pipeline this page builds on
- [GitHub Bot Setup](github-bot.md) — sync PR automation and review posture
- [Org Connection](org-connection.md) — how developers receive configuration
- [Configuration](configuration.md) — `managed`, `mcp`, `validation`, `telemetry`
- [Platform capability matrix](platform-capability-matrix.md) — what is enforced where
- [Privacy](privacy.md) — the telemetry and developer-privacy model
