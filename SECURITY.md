# Security Policy

AgentBoot generates executable hooks, tool permissions, MCP configuration, and assistant
instructions that are distributed across downstream repositories. We treat the compiler, the
generated artifacts, and the release chain as security-sensitive surfaces.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

- **Preferred:** [Report privately via GitHub](https://github.com/agentboot-dev/agentboot/security/advisories/new)
  (Security → Report a vulnerability). This keeps the report private while we investigate.
- **Alternative:** email `mike@agentboot.dev` with subject line `SECURITY: <short summary>`.

Include what you can: affected version, reproduction steps, impact assessment, and any
suggested remediation. Reports about the generated artifacts (hooks, managed settings, MCP
config) and the release/distribution chain are explicitly in scope, alongside the CLI itself.

## Response targets

| Stage | Target |
|---|---|
| Acknowledgement | within 72 hours |
| Triage + severity assessment | within 1 week |
| Fix for critical/high issues | next patch release, expedited |
| Fix for moderate/low issues | next scheduled release |

AgentBoot is maintained by a single maintainer; these are good-faith targets, not an SLA.

## Supported versions

Only the **latest released version** on npm receives security fixes. AgentBoot is in public
Beta (0.x): there are no maintained older release lines, and upgrading to the latest patch is
always the remediation path.

| Version | Supported |
|---|---|
| Latest npm release | ✅ |
| Anything older | ❌ — upgrade |

## Coordinated disclosure

We ask reporters to allow up to **90 days** from acknowledgement before public disclosure.
In practice fixes usually ship much faster; we will coordinate timing with you and credit
reporters in the release notes unless you prefer otherwise.

## Verifying a release

Every release provides three independent verification routes:

1. **npm provenance** — packages are published with `--provenance` (Sigstore attestation
   linking the package to the exact GitHub Actions run and commit):

   ```bash
   npm audit signatures            # in a project depending on agentboot
   npm view agentboot@<version> dist.attestations
   ```

2. **Checksums** — each GitHub Release attaches `agentboot-<version>.sha256` covering the
   npm tarball and the SBOM:

   ```bash
   curl -sLO https://registry.npmjs.org/agentboot/-/agentboot-<version>.tgz
   shasum -a 256 -c agentboot-<version>.sha256   # from the GitHub Release assets
   ```

3. **SBOM** — each GitHub Release attaches a CycloneDX SBOM
   (`agentboot-<version>.sbom.cdx.json`) of the production dependency tree for
   ingestion into your dependency-tracking tooling.

## Known dependency-advisory dispositions

This repository contains **two independent dependency trees**, and an advisory count is
meaningless without saying which one it is against. Both are listed below; neither is
silently ignored.

| Tree | Lockfile | Reaches users? |
|---|---|---|
| **Published package** | `package-lock.json` | **Yes** — this is what `npm i agentboot` installs |
| **Documentation site** | `website/package-lock.json` | **No** — `website/` is `private: true` and is excluded from the published tarball |

The docs-site exclusion is verifiable, not asserted — `npm pack --dry-run` lists the exact
90 files that ship, and no path under `website/` appears among them.

### Published package tree — clean

`npm audit` reports **0 advisories** at every severity. Reproduce with:

```bash
npm run audit          # npm audit --audit-level=moderate
```

Three advisories were open against this tree until the 2026-08-11 lockfile refresh
(js-yaml GHSA-5p4m-2wfm-xmqj high, nanoid GHSA-2v37-7h3g-55p8 high, postcss
GHSA-fxqj-rqcc-2cmp moderate). All three were resolved by patch-level bumps within the
existing semver ranges; no dependency's declared range changed. The earlier
esbuild advisory GHSA-g7r4-m6w7-qqqr was resolved in v0.12.3 by the tsx 4.23.1 upgrade.

> This section previously claimed "`npm audit` is clean" while those three advisories were
> open against it. The claim was written once and never re-measured. It is now backed by
> `npm run audit`, so a future regression makes the claim fail rather than merely age.

### Documentation site tree — fixed where fixable, dispositioned where not

Reproduce the numbers below with:

```bash
cd website && npm audit          # 20 entries — 3 advisories in 2 packages, plus wrappers
```

`npm audit` counts every `@docusaurus/*` package that merely *depends on* a vulnerable one,
so the headline number (20 at the time of writing, down from 29) is much larger than the
number of actual advisories. Three advisories remain, in two packages; both packages are
dispositioned below.

**Fixed on 2026-08-11 (no declared version range changed).** A lockfile-only refresh
(`npm audit fix --package-lock-only`) resolved six advisories against this tree by
patch-level bumps: brace-expansion 1.1.16 → 1.1.18 (GHSA-rgw5-rvv9-x895,
GHSA-mh99-v99m-4gvg), fast-uri 3.1.4 → 3.1.5 (GHSA-7p8r-x3mc-p8w7), js-yaml 4.3.0 → 4.3.1
(GHSA-5p4m-2wfm-xmqj), nanoid 3.3.16 → 3.3.18 (GHSA-2v37-7h3g-55p8), postcss 8.5.20 →
8.5.26 (GHSA-fxqj-rqcc-2cmp). No package was added or removed and `website/package.json`
gained no new dependency. The register previously listed four of these as "pending fix";
`npm audit` found two more (js-yaml, nanoid) that had no open alert against this manifest —
which is why the fix was driven from `npm audit`, not from the alert list.

**Also fixed:** the two `serialize-javascript` advisories, via the single targeted override
below. It was previously recorded here as "accepted — unreachable without a forced
override"; the override was then tried, and it works, so the acceptance no longer holds.

```jsonc
// website/package.json
"overrides": { "serialize-javascript": "^7.1.0" }
```

`copy-webpack-plugin@11` and `css-minimizer-webpack-plugin@5` — the versions Docusaurus
3.10.2 pins — declare `serialize-javascript: ^6.0.x`, so npm will not reach the patched
7.0.5+ line on its own, and their own fixed lines (14.x / 8.x) are majors the preset does
not accept. The override forces 7.1.0 across both. It is validated by a real build, not by
assumption: `npm ci && npm run build` succeeds and emits a minified stylesheet, and
`.github/workflows/deploy-docs.yml` runs that same build on every PR touching `website/**`,
so a future override that breaks the site fails CI before merge rather than after deploy.
Checked under npm 10 as well as npm 11, because CI installs on Node 22.

> **Caveat, recorded rather than glossed.** npm does not write the `overrides` field into
> `website/package-lock.json`: regenerating the lockfile from a `package.json` that declares
> the override yields a file containing no `overrides` key (npm 11.11.0). The pin therefore
> lives in the lockfile's resolved tree alone, and regenerating it with the `overrides` block
> deleted from `package.json` would silently drop back to the vulnerable 6.0.2. Nothing in
> CI currently re-measures `npm audit` for this tree, so that regression would show up here
> as a stale claim rather than as a failing job. Re-run `cd website && npm audit` when
> touching either file.

The three advisories that remain are transitive under `@docusaurus/*`, which is
version-pinned by the preset. `@docusaurus/core` is already on the latest published release
(3.10.2), so there is no upstream upgrade that clears them.

| GHSA | Package | Severity | Disposition |
|---|---|---|---|
| GHSA-5p2g-fcmc-qvqq | image-size | high | **Accepted — no upstream patch exists.** Both advisories are DoS-by-infinite-loop in the ICNS/JXL/HEIF parsers; `image-size` has no fixed release (latest 2.0.2 is itself in range, confirmed against the registry on 2026-08-11). Reached only when Docusaurus measures images at build time, and the only images it measures are this repository's own static assets. No untrusted input, no runtime exposure. |
| GHSA-w3rx-r6r6-pgpr | image-size | high | as above |
| GHSA-w5hq-g745-h8pq | uuid | moderate | **Accepted — dev-server only, and not actually fixable here.** Reached via `webpack-dev-server@5.2.6` → `sockjs@0.3.24` → `uuid@^8.3.2`; the advisory is fixed in uuid 11.1.1, which `sockjs` does not accept, and 5.2.6 is the newest release of the line `@docusaurus/core` allows (`^5.2.2`). The fix landed in `webpack-dev-server@6`, which drops `sockjs` entirely and requires Node ≥ 22.15.0 — a major outside the pin. `webpack-dev-server` runs only under `npm start` on a maintainer's machine; it is not part of `npm run build` output and is never deployed. |

> **`npm audit` claims this one is fixable, and it is wrong.** It prints *"fix available via
> `npm audit fix`"* for the `uuid` advisory. It is not: `npm audit fix --package-lock-only`
> leaves it in place, and so does `--force`, because every path to it is pinned. Verified
> 2026-08-11. The disposition above is the measured behaviour of this tree, not the tool's
> summary of it — the same reason this register exists at all.

**Cross-check against GitHub's alert list.** `gh api repos/:owner/:repo/dependabot/alerts`
on 2026-08-11 returned ten open alerts: nine against `website/package-lock.json` and one
against the root `package-lock.json` (postcss GHSA-fxqj-rqcc-2cmp). The root alert is
already resolved in this branch's lockfile (postcss 8.5.26) — Dependabot measures the
default branch, so alerts for both trees close on merge, not on commit. Of the nine website
alerts, six are cleared by the changes above (brace-expansion ×2, fast-uri, postcss,
serialize-javascript ×2); three remain and are dispositioned here — `image-size` ×2 and
`uuid`. Alert counts and `npm audit` counts do not have to match (Dependabot dedupes and
lags); when they disagree, `npm audit` against the committed lockfile is the number to
trust, because it is the tree that actually builds.

## What AgentBoot's own security model covers

For the security posture of the tool and its generated output — hook behavior, managed
settings, drift detection, MCP surface, telemetry privacy — see:

- [Platform capability matrix](docs/platform-capability-matrix.md) — what is enforced vs
  advisory per platform
- [Privacy model](docs/privacy.md) — what telemetry does and does not collect
- [Trust page](https://agentboot.dev/trust) — supply-chain posture (npm provenance, no
  lifecycle scripts)
