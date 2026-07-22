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
import { PLATFORM_ENFORCEMENT } from "./conformance.js";
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
    declared: typeof PLATFORM_ENFORCEMENT;
    /** Per-platform enforcement manifests from the last conformance run, verbatim. */
    manifests: Record<string, unknown>;
    /** Platforms with compiled output but no enforcement manifest — conformance not run. */
    unprobed_platforms: string[];
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
      | (Pick<BatchChainVerification, "batches" | "signed" | "gaps" | "ok"> & { signatureVerified: number })
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
  const manifests: Record<string, unknown> = {};
  const unprobed: string[] = [];
  if (fs.existsSync(distPath)) {
    for (const platform of fs.readdirSync(distPath)) {
      const platformDir = path.join(distPath, platform);
      if (!fs.statSync(platformDir).isDirectory()) continue;
      const manifestPath = path.join(platformDir, "enforcement-manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          manifests[platform] = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        } catch {
          manifests[platform] = { error: "unreadable enforcement manifest" };
        }
      } else if (platform in PLATFORM_ENFORCEMENT) {
        unprobed.push(platform);
      }
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
          .filter((e) => e.status === "modified" || e.status === "missing")
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
      chain: { batches: v.batches, signed: v.signed, signatureVerified: v.signatureVerified, gaps: v.gaps, ok: v.ok },
    };
  }

  const pack: EvidencePack = {
    format: "agentboot-evidence-pack",
    version: 1,
    generated_at: new Date().toISOString(),
    hub: collectHubProvenance(hubPath, agentbootVersion),
    enforcement: { declared: PLATFORM_ENFORCEMENT, manifests, unprobed_platforms: unprobed },
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
