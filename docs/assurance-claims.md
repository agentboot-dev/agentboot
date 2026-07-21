# Assurance-claim register

**The rule: no public assurance claim ships without a pointer to the probe that verifies it.**

AgentBoot's thesis is enforcement honesty — an assurance artifact that claims more than its
mechanism delivers is the one defect class this product cannot afford. This register is the
structural control against that class: every enforcement/integrity/coverage claim made in the
public docs, README, or release notes must have a row here naming the executable probe (test
file or CI step) that demonstrates it, plus an honest statement of the claim's limits.

`tests/assurance-register.test.ts` parses this table and fails the build if any referenced
probe file does not exist — a row cannot silently rot. Adding a new public assurance claim
without a row (or a row without a real probe) should be treated as a review blocker.

| # | Claim (as made publicly) | Probe that verifies it | Honest limits |
|---|---|---|---|
| 1 | Input scan blocks credential-bearing prompts before the model sees them | `scripts/lib/conformance.ts` (input-scan probes, run in CI via `agentboot conformance`); `tests/band-b.test.ts` | Regex + optional org scanner; novel secret formats can pass. Hook timeout is platform fail-open. |
| 2 | Output scan with `blocking: true` blocks on detected credentials | `scripts/lib/conformance.ts` (Stop probes with the real `last_assistant_message` payload + transcript fallback); `tests/hardening-v0.16.test.ts` | Remediation-forcing, not display suppression: rendered text cannot be retracted; the turn cannot end until the model remediates. |
| 3 | Synced manifests are tamper-evident | `tests/hardening-v0.16.test.ts` (executed signature-strip attack, rogue-signer rejection); `tests/v0.19-gaps.test.ts` (in-toto/DSSE attestation: subject-divergence + payload-tamper detection) | ONLY with `sync.signing` enabled AND verification run with `--require-signed --allowed-signers`. An unsigned digest detects accidental corruption only — `verify-manifest` reports this posture explicitly. The optional in-toto attestation (`emitInToto`) adds a standard predicate but its signature is SSHSIG, not a Sigstore bundle: no transparency log, no CI-identity certificate. |
| 4 | The hub secret scan covers what the compiler ships | `tests/hardening-v0.16.test.ts` (bare AWS key planted in gotchas / instructions / node scope / team scope must fail `validate`); surface enumerated by `scripts/lib/scope-layout.ts` | Pattern-based; encodings/obfuscations outside the pattern set pass. Config-supplied patterns are rejected if regex-unsafe. |
| 5 | A spoke receives only its own scope's content | `tests/hardening-v0.16.test.ts` (two-team repro: sibling-team content must not reach the spoke or its manifest) | Isolation is per registered repo entry; a repo registered to the wrong scope receives that scope. |
| 6 | Telemetry carries no prompt/response/file content, and the published schema accepts exactly what the hooks emit | `tests/hardening-v0.16.test.ts` + `tests/band-b.test.ts` (hook output validated key-for-key; schema generated from the canonical spec, `additionalProperties: false`) | Local NDJSON file only, developer-deletable; best-effort evidence, not non-repudiable logging. |
| 7 | Declared enforcement level matches observed hook behavior per platform | `agentboot conformance` in `.github/workflows/validate.yml` (crafted clean/secret/malformed/oversized inputs; writes `dist/<platform>/enforcement-manifest.json`) | Probes run the compiled scripts directly; platform-side event delivery is asserted from platform docs, not probed in a live session. |
| 8 | The published SBOM covers the full production dependency closure | Completeness guard inside `.github/workflows/release.yml` (fails the release if any prod lockfile package is missing); `tests/release-workflow.test.ts` | Covers npm-resolvable production packages; does not cover the consumer's own environment. |
| 9 | Windows is a gated, tested platform | `windows-latest` matrix leg in `.github/workflows/validate.yml` (required, no `continue-on-error`); `tests/release-workflow.test.ts` pins the absence of the mask | CI-level validation; the beta Windows-adopter pass for live-session behaviors is still open. |
| 10 | Drift between a spoke and its manifest is detectable | `tests/lib.test.ts` drift suites; `templates/ci/drift-check.yml` | Detects divergence from the last synced manifest; cannot attribute intent (hotfix vs tamper) — see enterprise-operations.md. |
| 11 | Releases are verifiable end to end | `.github/workflows/release.yml` (npm `--provenance`, SHA-256 checksums + SBOM attached to the release); procedure in SECURITY.md | Verifies artifact ↔ release binding; trusting the release channel itself is the consumer's trust decision. |
| 12 | Telemetry is tamper-evident once shipped to the org sink; local logs are edit/deletion-detectable | `tests/band-d3.test.ts` (executed edit/delete/reorder detection, batch digest-chain + sequence-gap + rogue-signer rejection); `scripts/lib/telemetry-sink.ts` | Local chain is unkeyed — detects modification, cannot prevent a full consistent rewrite. Tamper evidence requires signed shipped batches; a machine-controlling developer can suppress events before first shipment (bound with an org-controlled ship cadence). No default endpoint exists — the sink is opt-in and org-owned. |
| 13 | Distributed MCP server references are rug-pull-detectable | `tests/mcp-pin.test.ts` (executed tool-definition mutation → mismatch with the changed tool named; added/removed detection; timeout and spawn-failure honesty) | Detection at pin/verify time (`mcp-pin`/`mcp-verify` in CI or pre-rollout), not continuous interception at every agent connect. Digest covers the advertised `tools/list` surface — server *behavior* behind an unchanged interface is out of scope. HTTP transport support is narrower than stdio (single-event SSE; https only). Unpinned servers warn, they do not fail, unless `--strict`. |

## Maintenance

- Adding a claim to README/docs/release notes → add a row in the same PR.
- Removing or weakening a probe → update or remove the claim in the same PR.
- The strongest wording a claim may use is what its probe demonstrates. When in doubt,
  state the limit in the claim itself (as done for #2 and #3).
