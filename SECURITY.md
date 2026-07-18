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

Advisories in AgentBoot's dependency tree that are known and deliberately dispositioned
(rather than silently ignored) are listed here:

- **esbuild ≤0.28.0 — arbitrary file read via the esbuild development server on Windows**
  (GHSA-g7r4-m6w7-qqqr, low): esbuild reaches AgentBoot transitively via `tsx` (runtime TS
  execution) and `vitest` (dev). AgentBoot never starts the esbuild development server — the
  vulnerable code path is not reachable in any AgentBoot workflow. Will be resolved when the
  upstream dependencies move past the affected range.

## What AgentBoot's own security model covers

For the security posture of the tool and its generated output — hook behavior, managed
settings, drift detection, MCP surface, telemetry privacy — see:

- [Platform capability matrix](docs/platform-capability-matrix.md) — what is enforced vs
  advisory per platform
- [Privacy model](docs/privacy.md) — what telemetry does and does not collect
- [Trust page](https://agentboot.dev/trust) — supply-chain posture (npm provenance, no
  lifecycle scripts)
