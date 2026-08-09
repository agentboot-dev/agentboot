/**
 * Auditor evidence-pack export.
 *
 * Bundles the org's current governance state into a single signed,
 * digest-protected JSON artifact an auditor can consume without shell access:
 *   - hub provenance (commit, config/policy hashes, AgentBoot version)
 *   - declared enforcement level per platform (the conformance SSOT) plus the
 *     empirical enforcement manifests from the last conformance run
 *   - per-repo drift state and sync-manifest verification (trust posture)
 *   - guardrail state: managed deny/allow lists, policy exceptions with
 *     expiry status
 *   - telemetry evidence-chain summary when a shipped-batch store is present
 *
 * Honesty rules carried over from the conformance harness: nothing is
 * fabricated — a dimension that cannot be gathered (no dist build, repo
 * missing, no batches) is reported as absent, never assumed green. The pack
 * itself is digest-protected and (when signing is configured) SSH-signed, so
 * the evidence artifact is as tamper-evident as what it describes.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AgentBootConfig } from "./config.js";
import {
  canonicalize,
  collectHubProvenance,
  signManifestDigest,
  verifyManifestFile,
  type HubProvenance,
  type ManifestSignature,
  type ManifestVerification,
} from "./provenance.js";
import { checkDrift, findManifestPath, type DriftReport } from "./drift.js";
import { PLATFORM_ENFORCEMENT, configuredPlatforms, resolveEnforcement } from "./conformance.js";
import { verifyBatchChain, type BatchChainVerification } from "./telemetry-sink.js";
import { loadExceptionsFile, HUB_EXCEPTIONS_FILE } from "./exceptions.js";

export const EVIDENCE_SIG_NAMESPACE = "agentboot-evidence";

export interface RepoEvidence {
  path: string;
  platform: string | null;
  scope: { group?: string; team?: string };
  drift: {
    manifestFound: boolean;
    clean: boolean | null;
    driftedFiles: string[];
    unmanagedFiles: string[];
  };
  manifestVerification: Pick<ManifestVerification, "digestOk" | "signatureOk" | "signerVerified" | "posture"> & {
    fileMismatchCount: number;
  } | null;
}

export interface EvidencePack {
  format: "agentboot-evidence-pack";
  version: 1;
  generated_at: string;
  hub: HubProvenance;
  enforcement: {
    /**
     * R1-H: the RESOLVED enforcement for the platforms this org actually
     * builds — not the whole PLATFORM_ENFORCEMENT table verbatim.
     *
     * The pack used to ship all ten rows including `plugin: {level: "enforced"}`
     * unqualified, for nine platforms the org does not build. `plugin`'s
     * enforcement is conditional on `claude` being in outputFormats (that is
     * what its `requires` says), so the unqualified row is a claim that is only
     * conditionally true, handed to an auditor as though it were unconditional.
     * Blast-limited today because commit 883253e makes a plugin-without-claude
     * build fail — but a stale or hand-assembled dist still reaches this code,
     * and "currently unreachable" is not the same as "not asserted".
     */
    declared: Record<string, { level: string; detail: string; unmetRequires: string[] }>;
    /** Per-platform enforcement manifests from the last conformance run, verbatim. */
    manifests: Record<string, unknown>;
    /**
     * CONFIGURED platforms with no enforcement manifest — conformance has not
     * been run for them, and running it WILL cover them.
     *
     * R1-G: this used to be derived from `fs.readdirSync(distPath)`, which
     * includes `dist/plugin/` on any hub that builds `claude` even though
     * `plugin` is not a configured format. `conformance` iterates the CONFIG,
     * so the pack told the auditor to run a command that could never change
     * what the pack reported.
     */
    unprobed_platforms: string[];
    /** The platform set this pack was computed over, and where it came from. */
    platform_set: { platforms: string[]; source: "personas.outputFormats" };
    /**
     * Platform trees present in dist/ that are NOT configured formats — today
     * `plugin`, which the claude emitter derives. Reported so an auditor is not
     * left wondering why a directory exists with no manifest, and kept OUT of
     * `unprobed_platforms` because `conformance` will never probe them.
     */
    derived_platforms: string[];
  };
  guardrails: {
    denyTools: string[];
    exceptions: Array<{ id: string; expired: boolean; expires: string; owner: string }>;
  };
  /**
   * MCP governance state: each approved server, where the org sourced it
   * (registry provenance), and whether its tool surface is digest-pinned
   * against the rug-pull class. Enforcement is only meaningful when the org
   * enforces the approved list.
   */
  mcp: {
    enforceApproved: boolean;
    approved: Array<{
      name: string;
      registry: string | null;
      pinned: boolean;
      toolsDigestRecordedAt: string | null;
    }>;
  };
  repos: RepoEvidence[];
  telemetry: {
    batchStoreChecked: string | null;
    chain:
      | (Pick<BatchChainVerification, "batches" | "signed" | "gaps" | "truncatedPrefix" | "ok"> & { signatureVerified: number })
      | null;
  };
  integrity?: {
    algorithm: "sha256";
    pack_digest: string;
    /** True only when the pack digest carries an SSH signature (signing configured). */
    signed: boolean;
    signature?: ManifestSignature;
  };
}

export interface BuildEvidenceOptions {
  hubPath: string;
  config: AgentBootConfig;
  agentbootVersion: string;
  /** Registered repos (path/platform/group/team) to include. */
  repos: Array<{ path: string; platform?: string; group?: string; team?: string }>;
  distPath: string;
  /** Directory of shipped telemetry batches to verify, if any. */
  telemetryBatchDir?: string | undefined;
  /** SSH key to sign the pack digest (sync.signing.sshKeyPath). */
  signKeyPath?: string | undefined;
}

export function buildEvidencePack(options: BuildEvidenceOptions): { pack: EvidencePack; signingError: string | null } {
  const { hubPath, config, agentbootVersion, repos, distPath } = options;

  // Enforcement manifests from the last conformance run — never fabricated.
  //
  // R1-G: the platform set comes from the SAME resolver `conformance` uses, so
  // "unprobed" names platforms that running `agentboot conformance` will
  // actually cover.
  const configured = configuredPlatforms(config);
  const manifests: Record<string, unknown> = {};
  const unprobed: string[] = [];
  const derived: string[] = [];
  const readManifest = (platform: string): boolean => {
    const manifestPath = path.join(distPath, platform, "enforcement-manifest.json");
    if (!fs.existsSync(manifestPath)) return false;
    try {
      manifests[platform] = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      manifests[platform] = { error: "unreadable enforcement manifest" };
    }
    return true;
  };
  if (fs.existsSync(distPath)) {
    for (const platform of configured) {
      if (!readManifest(platform)) unprobed.push(platform);
    }
    // Everything else on disk that IS a known platform is derived output, not a
    // configured target. Its manifest is still carried if one exists — an
    // observation is evidence wherever it came from — but its absence is not
    // an action item, because no command will produce it.
    for (const platform of fs.readdirSync(distPath)) {
      if (configured.includes(platform)) continue;
      if (!(platform in PLATFORM_ENFORCEMENT)) continue;
      if (!fs.statSync(path.join(distPath, platform)).isDirectory()) continue;
      derived.push(platform);
      readManifest(platform);
    }
  }

  // Guardrails: managed deny list + policy exceptions with expiry status.
  const denyTools = config.managed?.guardrails?.denyTools ?? [];
  const exceptions: EvidencePack["guardrails"]["exceptions"] = [];
  try {
    for (const ex of loadExceptionsFile(path.join(hubPath, HUB_EXCEPTIONS_FILE))) {
      exceptions.push({
        id: ex.id,
        owner: ex.owner,
        expires: ex.expires,
        expired: Date.parse(ex.expires) < Date.now(),
      });
    }
  } catch { /* unreadable exceptions file — empty list is the honest state */ }

  // Per-repo drift + manifest verification.
  const repoEvidence: RepoEvidence[] = [];
  for (const entry of repos) {
    const repoPath = path.resolve(hubPath, entry.path);
    let drift: DriftReport | null = null;
    try { drift = checkDrift(repoPath); } catch { /* unreachable repo */ }
    const manifestPath = findManifestPath(repoPath);
    let verification: RepoEvidence["manifestVerification"] = null;
    if (manifestPath && fs.existsSync(manifestPath)) {
      const v = verifyManifestFile(manifestPath, { repoRoot: repoPath });
      verification = {
        digestOk: v.digestOk,
        signatureOk: v.signatureOk,
        signerVerified: v.signerVerified,
        posture: v.posture,
        fileMismatchCount: v.fileMismatches.length,
      };
    }
    const entries = drift?.entries ?? [];
    repoEvidence.push({
      path: entry.path,
      platform: entry.platform ?? null,
      scope: {
        ...(entry.group !== undefined ? { group: entry.group } : {}),
        ...(entry.team !== undefined ? { team: entry.team } : {}),
      },
      drift: {
        manifestFound: drift?.manifestFound ?? false,
        clean: drift?.manifestFound
          ? entries.every((e) => e.status === "clean" || e.status === "unmanaged" || e.status === "excepted")
          : null,
        driftedFiles: entries
          // F-1: a "retired" entry is a control the org withdrew that this repo
          // still carries. Omitting it from the evidence pack would reproduce
          // the exact false-green this fix removes.
          .filter((e) => e.status === "modified" || e.status === "missing" || e.status === "retired")
          .map((e) => e.file),
        unmanagedFiles: entries.filter((e) => e.status === "unmanaged").map((e) => e.file),
      },
      manifestVerification: verification,
    });
  }

  // MCP governance evidence: approved servers with provenance + pin status.
  const mcpEvidence: EvidencePack["mcp"] = {
    enforceApproved: config.mcp?.enforceApproved === true,
    approved: (config.mcp?.approved ?? []).map((s) => ({
      name: s.name,
      registry: s.registry ?? null,
      pinned: Boolean(s.toolsDigest),
      toolsDigestRecordedAt: s.toolsDigestRecordedAt ?? null,
    })),
  };

  // Telemetry batch-chain evidence, when a store exists. Verify signatures too
  // (not just digests) so the pack records how many batches are cryptographically
  // signed, not merely how many carry a signature field.
  let telemetryChain: EvidencePack["telemetry"] = { batchStoreChecked: null, chain: null };
  if (options.telemetryBatchDir && fs.existsSync(options.telemetryBatchDir)) {
    const v = verifyBatchChain(options.telemetryBatchDir, { verifySignatures: true });
    telemetryChain = {
      batchStoreChecked: options.telemetryBatchDir,
      // truncatedPrefix travels with the chain state: an auditor reading
      // "12 batches, ok" must be able to see that the chain did not start at 1.
      chain: { batches: v.batches, signed: v.signed, signatureVerified: v.signatureVerified, gaps: v.gaps, truncatedPrefix: v.truncatedPrefix, ok: v.ok },
    };
  }

  const pack: EvidencePack = {
    format: "agentboot-evidence-pack",
    version: 1,
    generated_at: new Date().toISOString(),
    hub: collectHubProvenance(hubPath, agentbootVersion),
    enforcement: {
      declared: Object.fromEntries(
        configured
          .filter((f) => f in PLATFORM_ENFORCEMENT)
          .map((f) => [f, resolveEnforcement(f, configured)]),
      ),
      manifests,
      unprobed_platforms: unprobed,
      platform_set: { platforms: configured, source: "personas.outputFormats" },
      derived_platforms: derived,
    },
    guardrails: { denyTools, exceptions },
    mcp: mcpEvidence,
    repos: repoEvidence,
    telemetry: telemetryChain,
  };

  // Integrity: digest always; signature only when the hub configures signing —
  // `signed` states which, so a consumer never has to assume "signed".
  const digest = createHash("sha256").update(canonicalize({ ...pack })).digest("hex");
  pack.integrity = { algorithm: "sha256", pack_digest: digest, signed: false };
  let signingError: string | null = null;
  if (options.signKeyPath) {
    const signed = signManifestDigest(digest, options.signKeyPath, EVIDENCE_SIG_NAMESPACE);
    if ("error" in signed) signingError = signed.error;
    else { pack.integrity.signature = signed.signature; pack.integrity.signed = true; }
  }

  return { pack, signingError };
}

/** Recompute the pack digest (integrity field excluded) for verification. */
export function computePackDigest(pack: Record<string, unknown>): string {
  const { integrity: _i, ...rest } = pack;
  return createHash("sha256").update(canonicalize(rest)).digest("hex");
}
