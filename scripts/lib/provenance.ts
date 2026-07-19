/**
 * D6: sync provenance, change-risk classification, and manifest integrity.
 *
 * Generated config delivered to spokes is security-sensitive: it carries
 * enforcement (compliance hooks, managed settings, MCP config), not just
 * advisory prompt content. A sync PR therefore must state exactly what
 * produced it (hub commit, AgentBoot version, config/policy versions), what
 * risk class each delivered file falls into, and ship a manifest whose
 * integrity is verifiable after the fact — a content digest always, and an
 * SSH signature when the hub configures a signing key.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Same bound as every external-binary probe (v0.12.4 hang-class fix). */
const PROBE_TIMEOUT_MS = 10_000;

/** SSH signature namespace — fixed so signatures cannot be replayed across uses. */
export const MANIFEST_SIG_NAMESPACE = "agentboot-manifest";

// ---------------------------------------------------------------------------
// Hub provenance
// ---------------------------------------------------------------------------

export interface HubProvenance {
  agentboot_version: string;
  /** Hub repo HEAD commit, or null when the hub is not a git repo. */
  hub_commit: string | null;
  /** True when the hub working tree had uncommitted changes at sync time. */
  hub_dirty: boolean;
  /** sha256 of agentboot.config.json — pins which config produced the artifacts. */
  config_hash: string | null;
  /** sha256 of agentboot-exceptions.json — pins the policy-exception set (B7). */
  exceptions_hash: string | null;
  generated_at: string;
}

function sha256OfFile(filePath: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

export function collectHubProvenance(hubPath: string, agentbootVersion: string): HubProvenance {
  let commit: string | null = null;
  let dirty = false;
  try {
    const rev = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: hubPath, encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS,
    });
    if (rev.status === 0 && rev.stdout) {
      commit = rev.stdout.trim();
      const st = spawnSync("git", ["status", "--porcelain"], {
        cwd: hubPath, encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS,
      });
      dirty = st.status === 0 && (st.stdout ?? "").trim().length > 0;
    }
  } catch { /* hub not a git repo or git unavailable — provenance degrades to null */ }

  return {
    agentboot_version: agentbootVersion,
    hub_commit: commit,
    hub_dirty: dirty,
    config_hash: sha256OfFile(path.join(hubPath, "agentboot.config.json")),
    exceptions_hash: sha256OfFile(path.join(hubPath, "agentboot-exceptions.json")),
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Change-risk classification
// ---------------------------------------------------------------------------

/**
 * enforcement — files that change what is BLOCKED or EXECUTED in the spoke
 *   (hooks, hook wiring, managed settings, MCP server config, any delivered
 *   executable). These are security controls; removing or altering one changes
 *   the enforcement posture of the repo.
 * config     — machine-read wiring that changes tool behavior but not
 *   enforcement (manifests, persona/plugin configs).
 * content    — advisory prompt content (personas, traits, instructions).
 */
export type SyncRiskClass = "enforcement" | "config" | "content";

export function classifySyncRisk(relPath: string): SyncRiskClass {
  const p = relPath.replace(/\\/g, "/").toLowerCase();
  const base = p.split("/").pop() ?? p;

  if (p.includes("hooks/") || base === "hooks.json") return "enforcement";
  if (base === "settings.json" || base === "managed-settings.json") return "enforcement";
  if (p.includes("managed-settings.d/") || p.includes("/managed/")) return "enforcement";
  if (base === ".mcp.json") return "enforcement";
  if (base.endsWith(".sh") || base.endsWith(".ps1")) return "enforcement";

  if (base === ".agentboot-manifest.json" || base === "plugin.json" || base === "persona.config.json") {
    return "config";
  }
  return "content";
}

export interface RiskSummary {
  enforcement: string[];
  config: string[];
  content: string[];
  /** True when any enforcement-class file is in the change set. */
  securitySensitive: boolean;
}

export function buildRiskSummary(filesWritten: string[]): RiskSummary {
  const summary: RiskSummary = { enforcement: [], config: [], content: [], securitySensitive: false };
  for (const file of filesWritten) {
    summary[classifySyncRisk(file)].push(file);
  }
  summary.enforcement.sort();
  summary.config.sort();
  summary.content.sort();
  summary.securitySensitive = summary.enforcement.length > 0;
  return summary;
}

// ---------------------------------------------------------------------------
// Manifest integrity — content digest + optional SSH signature
// ---------------------------------------------------------------------------

export interface ManifestSignature {
  format: "ssh";
  namespace: string;
  /** The signer's public key line (from <key>.pub), for identification. */
  signer_public_key: string | null;
  /** Armored SSHSIG block produced by `ssh-keygen -Y sign`. */
  signature: string;
}

export interface ManifestIntegrity {
  algorithm: "sha256";
  /** Digest over the canonicalized manifest with the integrity field removed. */
  manifest_digest: string;
  signature?: ManifestSignature;
}

/** Deterministic serialization: recursively sorted object keys. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return "{" + Object.keys(obj).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
      .join(",") + "}";
  }
  return JSON.stringify(value);
}

/** Digest input is every manifest field EXCEPT `integrity`, canonicalized. */
export function computeManifestDigest(manifest: Record<string, unknown>): string {
  const { integrity: _integrity, ...rest } = manifest as { integrity?: unknown } & Record<string, unknown>;
  return createHash("sha256").update(canonicalize(rest)).digest("hex");
}

/**
 * Sign a manifest digest with an SSH private key via `ssh-keygen -Y sign`.
 * Returns the armored signature, or an error string (never throws) — a
 * configured-but-failing signer must surface loudly in the sync result.
 */
export function signManifestDigest(
  digest: string,
  sshKeyPath: string,
): { signature: ManifestSignature } | { error: string } {
  const resolvedKey = path.resolve(sshKeyPath);
  if (!fs.existsSync(resolvedKey)) {
    return { error: `Signing key not found: ${resolvedKey}` };
  }
  try {
    const sign = spawnSync(
      "ssh-keygen",
      ["-Y", "sign", "-f", resolvedKey, "-n", MANIFEST_SIG_NAMESPACE, "-"],
      { input: digest, encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
    );
    if (sign.status !== 0 || !sign.stdout?.includes("BEGIN SSH SIGNATURE")) {
      const stderr = (sign.stderr ?? "").trim().split("\n")[0] ?? "unknown error";
      return { error: `ssh-keygen -Y sign failed: ${stderr}` };
    }
    let publicKey: string | null = null;
    try {
      publicKey = fs.readFileSync(resolvedKey + ".pub", "utf-8").trim();
    } catch { /* no .pub alongside the key — signature still valid */ }
    return {
      signature: {
        format: "ssh",
        namespace: MANIFEST_SIG_NAMESPACE,
        signer_public_key: publicKey,
        signature: sign.stdout,
      },
    };
  } catch (err) {
    return { error: `ssh-keygen unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface ManifestVerification {
  digestOk: boolean;
  computedDigest: string;
  recordedDigest: string | null;
  /** null = no signature present; true/false = signature checked. */
  signatureOk: boolean | null;
  signerPublicKey: string | null;
  /** Per-file hash mismatches against the manifest's files list. */
  fileMismatches: Array<{ path: string; expected: string; actual: string | null }>;
  errors: string[];
}

/**
 * Verify a written manifest: recompute the content digest, re-hash every
 * listed file, and (when a signature is present) check it with
 * `ssh-keygen -Y check-novalidate`. Full signer-identity verification against
 * an allowed-signers file is the org's CI concern; this checks that the
 * signature is cryptographically valid for the recorded digest.
 */
export function verifyManifestFile(manifestPath: string, repoRoot?: string): ManifestVerification {
  const result: ManifestVerification = {
    digestOk: false,
    computedDigest: "",
    recordedDigest: null,
    signatureOk: null,
    signerPublicKey: null,
    fileMismatches: [],
    errors: [],
  };

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    result.errors.push(`Cannot read manifest: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const integrity = manifest["integrity"] as ManifestIntegrity | undefined;
  result.computedDigest = computeManifestDigest(manifest);
  result.recordedDigest = integrity?.manifest_digest ?? null;
  result.digestOk = result.recordedDigest !== null && result.recordedDigest === result.computedDigest;
  if (result.recordedDigest === null) {
    result.errors.push("Manifest has no integrity.manifest_digest (pre-0.14 manifest?)");
  }

  // Per-file hashes. Manifest paths are repo-relative; the repo root is the
  // manifest's grandparent (repo/<targetDir>/.agentboot-manifest.json) unless
  // given explicitly.
  const root = repoRoot ?? path.resolve(path.dirname(manifestPath), "..");
  const files = (manifest["files"] ?? []) as Array<{ path: string; hash: string }>;
  for (const f of files) {
    const abs = path.join(root, f.path);
    let actual: string | null = null;
    try {
      actual = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    } catch { /* missing file */ }
    if (actual !== f.hash) {
      result.fileMismatches.push({ path: f.path, expected: f.hash, actual });
    }
  }

  // Signature check (structure + cryptographic validity for the digest).
  if (integrity?.signature?.signature) {
    result.signerPublicKey = integrity.signature.signer_public_key ?? null;
    let sigDir: string | null = null;
    try {
      sigDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sigcheck-"));
      const sigFile = path.join(sigDir, "manifest.sig");
      fs.writeFileSync(sigFile, integrity.signature.signature, "utf-8");
      const check = spawnSync(
        "ssh-keygen",
        ["-Y", "check-novalidate", "-n", integrity.signature.namespace ?? MANIFEST_SIG_NAMESPACE, "-s", sigFile],
        // The signed message is the RECORDED digest — a tampered manifest fails
        // the digest comparison above even if its signature self-verifies.
        { input: result.recordedDigest ?? "", encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
      );
      result.signatureOk = check.status === 0;
      if (!result.signatureOk) {
        result.errors.push(`Signature check failed: ${(check.stderr ?? "").trim().split("\n")[0]}`);
      }
    } catch (err) {
      result.signatureOk = false;
      result.errors.push(`ssh-keygen unavailable for signature check: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (sigDir) fs.rmSync(sigDir, { recursive: true, force: true });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sync-PR body
// ---------------------------------------------------------------------------

export interface SyncPrBodyOptions {
  provenance: HubProvenance;
  filesWritten: string[];
  /** Repo-relative manifest paths included in this sync. */
  manifestPaths: string[];
  signed: boolean;
}

const short = (hash: string | null): string => (hash ? hash.slice(0, 12) : "n/a");

/**
 * Build the sync-PR body: provenance block, risk-classified change summary
 * with enforcement files called out individually, and verification pointers.
 */
export function buildSyncPrBody(opts: SyncPrBodyOptions): string {
  const { provenance, filesWritten, manifestPaths, signed } = opts;
  const risk = buildRiskSummary(filesWritten.filter((f) => !f.replace(/\\/g, "/").endsWith(".agentboot-manifest.json")));

  const lines: string[] = [];
  lines.push("## AgentBoot sync");
  lines.push("");
  lines.push("Generated configuration — review like any change to CI or repo settings.");
  lines.push("");
  lines.push("### Provenance");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| AgentBoot | v${provenance.agentboot_version} |`);
  lines.push(`| Hub commit | ${provenance.hub_commit ? `\`${provenance.hub_commit.slice(0, 12)}\`${provenance.hub_dirty ? " ⚠ **dirty working tree**" : ""}` : "n/a (hub not a git repo)"} |`);
  lines.push(`| Config hash | \`${short(provenance.config_hash)}\` |`);
  lines.push(`| Policy exceptions | ${provenance.exceptions_hash ? `\`${short(provenance.exceptions_hash)}\`` : "none"} |`);
  lines.push(`| Generated | ${provenance.generated_at} |`);
  lines.push("");
  lines.push("### Risk summary");
  lines.push("");
  if (risk.enforcement.length > 0) {
    lines.push(`🔴 **Enforcement-affecting** (${risk.enforcement.length} — changes what is blocked or executed in this repo; review carefully):`);
    for (const f of risk.enforcement) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (risk.config.length > 0) {
    lines.push(`🟡 Config/wiring: ${risk.config.length} file(s)`);
  }
  if (risk.content.length > 0) {
    lines.push(`🟢 Advisory content: ${risk.content.length} file(s)`);
  }
  if (risk.enforcement.length === 0) {
    lines.push("");
    lines.push("No enforcement-affecting changes in this sync.");
  }
  lines.push("");
  lines.push("### Integrity");
  lines.push("");
  for (const m of manifestPaths) {
    lines.push(`- \`${m}\` — sha256 content digest embedded${signed ? ", **SSH-signed**" : ", unsigned"}`);
  }
  lines.push("");
  lines.push("Verify locally: `npx agentboot verify-manifest`");
  lines.push("");
  return lines.join("\n");
}
