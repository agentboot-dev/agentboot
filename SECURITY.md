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

### Documentation site tree — dispositioned

Every advisory below is transitive under `@docusaurus/*`, which is version-pinned by the
preset. `@docusaurus/core` is already on the latest published release (3.10.2), so there is
no upstream upgrade that clears these.

| GHSA | Package | Severity | Disposition |
|---|---|---|---|
| GHSA-5p2g-fcmc-qvqq | image-size | high | **Accepted — no upstream patch exists.** Both advisories are DoS-by-infinite-loop in the ICNS/JXL/HEIF parsers; `image-size` has no fixed release (latest 2.0.2 is itself in range). Reached only when Docusaurus measures images at build time, and the only images it measures are this repository's own static assets. No untrusted input, no runtime exposure. |
| GHSA-w3rx-r6r6-pgpr | image-size | high | as above |
| GHSA-5c6j-r48x-rmvq | serialize-javascript | high | **Accepted — unreachable without a forced override.** Patched in 7.0.5, but the only paths to it are `copy-webpack-plugin` and `css-minimizer-webpack-plugin`, whose fixed lines (14.x / 8.x) are majors that Docusaurus 3.10.2 does not accept. The sink serializes this repository's own build assets during a static-site build; there is no attacker-supplied value in the path. |
| GHSA-qj8w-gfj5-8c6v | serialize-javascript | moderate | as above |
| GHSA-w5hq-g745-h8pq | uuid | moderate | **Accepted — dev-server only.** Reached via `webpack-dev-server` → `sockjs`. The fixed `webpack-dev-server` line is a major outside the Docusaurus pin. `webpack-dev-server` runs only under `npm start` on a maintainer's machine; it is not part of `npm run build` output and is never deployed. |

Four further alerts against this tree (brace-expansion GHSA-rgw5-rvv9-x895 and
GHSA-mh99-v99m-4gvg, fast-uri GHSA-7p8r-x3mc-p8w7, postcss GHSA-fxqj-rqcc-2cmp) are **not
dispositioned — they are simply fixable**, by a lockfile-only refresh of
`website/package-lock.json` that changes no declared version range. They are listed here so
the register is complete rather than flattering; they are tracked as a pending fix, not as
an accepted risk.

## What AgentBoot's own security model covers

For the security posture of the tool and its generated output — hook behavior, managed
settings, drift detection, MCP surface, telemetry privacy — see:

- [Platform capability matrix](docs/platform-capability-matrix.md) — what is enforced vs
  advisory per platform
- [Privacy model](docs/privacy.md) — what telemetry does and does not collect
- [Trust page](https://agentboot.dev/trust) — supply-chain posture (npm provenance, no
  lifecycle scripts)
