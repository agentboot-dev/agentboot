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
  // Telemetry sink config (redirecting it exfiltrates telemetry to an
  // attacker-chosen collector) and MCP pin baselines (swapping them weakens or
  // disables the rug-pull digest check) are security controls, not advisory
  // content — a reviewer must see them called out, not buried as 🟢.
  if (base === "telemetry-sink.json") return "enforcement";
  if (base === "mcp-pins.json" || base === "agentboot.mcp-pins.json") return "enforcement";
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

/**
 * Deterministic serialization: recursively sorted object keys.
 *
 * Object keys whose value is `undefined` are OMITTED, matching JSON semantics
 * (`JSON.stringify({a: undefined})` → `"{}"`). Without this, an in-memory
 * manifest carrying an undefined-valued field canonicalizes differently from
 * the same manifest after a JSON round-trip (which drops the key) — so a
 * manifest could be signed over one digest and then FAIL its own verify after
 * being written and re-read. `undefined` (top-level or in an array) serializes
 * to `null`, again matching `JSON.stringify`'s array behavior.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return "{" + Object.keys(obj).sort()
      .filter((k) => obj[k] !== undefined)
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
  namespace: string = MANIFEST_SIG_NAMESPACE,
): { signature: ManifestSignature } | { error: string } {
  const resolvedKey = path.resolve(sshKeyPath);
  if (!fs.existsSync(resolvedKey)) {
    return { error: `Signing key not found: ${resolvedKey}` };
  }
  try {
    const sign = spawnSync(
      "ssh-keygen",
      ["-Y", "sign", "-f", resolvedKey, "-n", namespace, "-"],
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
        // Record the namespace the signature was ACTUALLY produced under — not
        // the manifest default. Telemetry/evidence-pack sign under their own
        // namespaces; recording the wrong one makes `-Y verify` fail against a
        // genuine signature (the recorded namespace is what the verifier feeds
        // back to ssh-keygen).
        namespace,
        signer_public_key: publicKey,
        signature: sign.stdout,
      },
    };
  } catch (err) {
    return { error: `ssh-keygen unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface VerifyManifestOptions {
  repoRoot?: string | undefined;
  /**
   * Treat a missing signature as a verification FAILURE. This is the only
   * defense against signature stripping: nothing inside a manifest can prove
   * it was supposed to be signed (an attacker who edits the manifest can
   * remove any such marker and recompute the unsigned digest), so the
   * expectation must come from outside — this flag, set by the org's CI.
   */
  requireSignature?: boolean | undefined;
  /** Path to an OpenSSH allowed_signers file to authenticate the signer. */
  allowedSignersPath?: string | undefined;
  /**
   * Principal to verify against (an identity from the allowed_signers file).
   * When omitted with allowedSignersPath set, the principal is discovered via
   * `ssh-keygen -Y find-principals`.
   */
  signerPrincipal?: string | undefined;
}

export type ManifestTrustPosture =
  /** No digest at all (pre-0.14 manifest). */
  | "none"
  /** Digest only. Detects accidental modification, NOT tampering: an editor can recompute the digest. */
  | "integrity-only"
  /** Valid signature, but the signer was not authenticated against allowed signers. */
  | "signed-unauthenticated"
  /** Valid signature from a signer authenticated against the allowed_signers file. */
  | "signed-authenticated";

export interface ManifestVerification {
  digestOk: boolean;
  computedDigest: string;
  recordedDigest: string | null;
  /** null = no signature present; true/false = signature checked. */
  signatureOk: boolean | null;
  signerPublicKey: string | null;
  /** null = no allowed-signers check performed; true/false = signer authenticated. */
  signerVerified: boolean | null;
  /** The principal the signature verified against (allowed-signers check). */
  signerPrincipal: string | null;
  /** What this verification actually establishes — reported honestly. */
  posture: ManifestTrustPosture;
  /** Per-file hash mismatches against the manifest's files list. */
  fileMismatches: Array<{ path: string; expected: string; actual: string | null }>;
  errors: string[];
}

/**
 * Verify a written manifest: recompute the content digest, re-hash every
 * listed file, check the signature (`ssh-keygen -Y check-novalidate`), and —
 * when an allowed_signers file is supplied — authenticate the signer identity
 * (`ssh-keygen -Y verify`). The result's `posture` states exactly what was
 * established; an unsigned manifest is "integrity-only" (accidental-corruption
 * detection), never "tamper-evident".
 */
export function verifyManifestFile(
  manifestPath: string,
  repoRootOrOptions?: string | VerifyManifestOptions,
): ManifestVerification {
  const options: VerifyManifestOptions =
    typeof repoRootOrOptions === "string" ? { repoRoot: repoRootOrOptions } : (repoRootOrOptions ?? {});
  const repoRoot = options.repoRoot;
  const result: ManifestVerification = {
    digestOk: false,
    computedDigest: "",
    recordedDigest: null,
    signatureOk: null,
    signerPublicKey: null,
    signerVerified: null,
    signerPrincipal: null,
    posture: "none",
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
  const root = path.resolve(repoRoot ?? path.resolve(path.dirname(manifestPath), ".."));
  const files = (manifest["files"] ?? []) as Array<{ path: string; hash: string }>;
  for (const f of files) {
    const abs = path.resolve(root, f.path);
    // Refuse to hash a manifest entry that escapes the repo root — a hostile
    // manifest could otherwise point `files[].path` at `../../etc/...` and turn
    // verify into an arbitrary-file read. Such an entry is itself a mismatch.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      result.fileMismatches.push({ path: f.path, expected: f.hash, actual: null });
      result.errors.push(`Manifest file path escapes the repo root: ${f.path}`);
      continue;
    }
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
      const namespace = integrity.signature.namespace ?? MANIFEST_SIG_NAMESPACE;
      const check = spawnSync(
        "ssh-keygen",
        ["-Y", "check-novalidate", "-n", namespace, "-s", sigFile],
        // The signed message is the RECORDED digest — a tampered manifest fails
        // the digest comparison above even if its signature self-verifies.
        { input: result.recordedDigest ?? "", encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
      );
      result.signatureOk = check.status === 0;
      if (!result.signatureOk) {
        result.errors.push(`Signature check failed: ${(check.stderr ?? "").trim().split("\n")[0]}`);
      }

      // Signer authentication against an allowed_signers file — the step that
      // turns "a valid signature exists" into "the RIGHT party signed it".
      if (result.signatureOk && options.allowedSignersPath) {
        const allowedSigners = path.resolve(options.allowedSignersPath);
        if (!fs.existsSync(allowedSigners)) {
          result.signerVerified = false;
          result.errors.push(`allowed_signers file not found: ${allowedSigners}`);
        } else {
          let principal = options.signerPrincipal ?? null;
          if (!principal) {
            const found = spawnSync(
              "ssh-keygen",
              ["-Y", "find-principals", "-f", allowedSigners, "-s", sigFile],
              { encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
            );
            principal = found.status === 0 ? (found.stdout ?? "").trim().split("\n")[0] || null : null;
            if (!principal) {
              result.signerVerified = false;
              result.errors.push("Signer is not listed in the allowed_signers file (find-principals matched nothing)");
            }
          }
          if (principal) {
            const verify = spawnSync(
              "ssh-keygen",
              ["-Y", "verify", "-f", allowedSigners, "-I", principal, "-n", namespace, "-s", sigFile],
              { input: result.recordedDigest ?? "", encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
            );
            result.signerVerified = verify.status === 0;
            result.signerPrincipal = principal;
            if (!result.signerVerified) {
              result.errors.push(
                `Signer authentication failed for principal "${principal}": ${(verify.stderr ?? "").trim().split("\n")[0]}`,
              );
            }
          }
        }
      }
    } catch (err) {
      result.signatureOk = false;
      result.errors.push(`ssh-keygen unavailable for signature check: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (sigDir) fs.rmSync(sigDir, { recursive: true, force: true });
    }
  } else if (options.requireSignature) {
    // Stripping the signature (or never signing) must be a FAILURE when the
    // verifier expects one. This expectation can only live outside the
    // manifest — anything inside it can be removed and re-digested.
    result.signatureOk = false;
    result.errors.push(
      "Manifest is UNSIGNED but a signature is required (--require-signed). " +
      "An unsigned digest detects accidental corruption only — it is not tamper evidence.",
    );
  }

  // Honest posture: what did this verification actually establish?
  // A "signed-*" posture REQUIRES digestOk AND zero file mismatches. The SSHSIG
  // signs the *recorded* digest; if the content no longer matches that digest
  // (digestOk=false) or a listed file was swapped (fileMismatches), the
  // signature vouches only for a stale digest — the actual artifacts are
  // unverified. Reporting "signed-authenticated" on tampered content is the lie
  // this gate prevents; a consumer reading `posture` must never be fooled while
  // digestOk is false.
  const contentIntact = result.digestOk && result.fileMismatches.length === 0;
  result.posture =
    result.recordedDigest === null ? "none"
    : !contentIntact ? "integrity-only"
    : !integrity?.signature?.signature ? "integrity-only"
    : result.signatureOk && result.signerVerified === true ? "signed-authenticated"
    : result.signatureOk ? "signed-unauthenticated"
    : "integrity-only";

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

// ---------------------------------------------------------------------------
// v0.19.0: standards-shaped attestation — in-toto Statement in a DSSE envelope
// ---------------------------------------------------------------------------
//
// Honest posture, stated once and linked from every consumer: this gives
// policy tooling a STANDARD predicate (in-toto v1 subjects + a typed
// predicate carrying hub provenance incl. git context) and signs the DSSE
// PAE bytes with the hub's SSH key (SSHSIG). It is verifiable with
// `agentboot verify-manifest` or ssh-keygen against an allowed_signers trust
// root. It is NOT a Sigstore bundle: no transparency log, no CI-identity
// certificate — "signed, with a standard predicate", not full supply-chain
// attestation. Sigstore keyless emission is the documented next step.

export const INTOTO_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const INTOTO_PAYLOAD_TYPE = "application/vnd.in-toto+json";
export const MANIFEST_PREDICATE_TYPE = "https://agentboot.dev/attestation/sync-manifest/v1";
export const ATTESTATION_SIG_NAMESPACE = "agentboot-attestation";

export interface InTotoStatement {
  _type: typeof INTOTO_STATEMENT_TYPE;
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: typeof MANIFEST_PREDICATE_TYPE;
  predicate: {
    provenance: HubProvenance;
    manifest_digest: string;
    scope: unknown;
    synced_at: unknown;
  };
}

export interface DsseEnvelope {
  payloadType: typeof INTOTO_PAYLOAD_TYPE;
  /** base64 of the JSON-serialized in-toto statement. */
  payload: string;
  signatures: Array<{
    /** The signer's public key line, for identification (not a trust root). */
    keyid: string;
    /** base64 of the armored SSHSIG block over the DSSE PAE bytes. */
    sig: string;
  }>;
  /** Non-standard extension declaring the signature format honestly. */
  x_agentboot: {
    signature_format: "sshsig";
    namespace: typeof ATTESTATION_SIG_NAMESPACE;
    note: string;
  };
}

/**
 * DSSE Pre-Authentication Encoding: "DSSEv1 SP len(type) SP type SP len(body) SP body".
 * Per the DSSE spec the lengths are BYTE counts (UTF-8), not JS string-length
 * (UTF-16 code units). Identical for the ASCII payloadType shipped today, but
 * `Buffer.byteLength` is the spec-correct value and avoids an interop break if
 * the type ever carries a multibyte character.
 */
export function dssePae(payloadType: string, payload: Buffer): Buffer {
  const typeLen = Buffer.byteLength(payloadType, "utf-8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeLen} ${payloadType} ${payload.length} `, "utf-8"),
    payload,
  ]);
}

/** Build the in-toto statement for a written manifest object. */
export function buildInTotoStatement(manifest: Record<string, unknown>): InTotoStatement {
  const files = (manifest["files"] ?? []) as Array<{ path: string; hash: string }>;
  const integrity = manifest["integrity"] as ManifestIntegrity | undefined;
  const provenance = (manifest["provenance"] ?? {}) as HubProvenance;
  const manifestDigest = integrity?.manifest_digest ?? computeManifestDigest(manifest);
  return {
    _type: INTOTO_STATEMENT_TYPE,
    subject: [
      ...files.map((f) => ({ name: f.path, digest: { sha256: f.hash } })),
      { name: ".agentboot-manifest.json", digest: { sha256: manifestDigest } },
    ],
    predicateType: MANIFEST_PREDICATE_TYPE,
    predicate: {
      provenance,
      manifest_digest: manifestDigest,
      scope: manifest["scope"] ?? null,
      synced_at: manifest["synced_at"] ?? null,
    },
  };
}

/**
 * Build and SSH-sign the DSSE envelope for a manifest. Returns the envelope
 * or an error (never throws) — a configured-but-failing attestation signer
 * surfaces loudly, like manifest signing.
 */
export function buildDsseEnvelope(
  manifest: Record<string, unknown>,
  sshKeyPath: string,
): { envelope: DsseEnvelope } | { error: string } {
  const statement = buildInTotoStatement(manifest);
  const payload = Buffer.from(JSON.stringify(statement), "utf-8");
  const pae = dssePae(INTOTO_PAYLOAD_TYPE, payload);

  const resolvedKey = path.resolve(sshKeyPath);
  if (!fs.existsSync(resolvedKey)) return { error: `Attestation signing key not found: ${resolvedKey}` };
  try {
    const sign = spawnSync(
      "ssh-keygen",
      ["-Y", "sign", "-f", resolvedKey, "-n", ATTESTATION_SIG_NAMESPACE, "-"],
      { input: pae, stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
    );
    const stdout = sign.stdout?.toString("utf-8") ?? "";
    if (sign.status !== 0 || !stdout.includes("BEGIN SSH SIGNATURE")) {
      const stderr = (sign.stderr?.toString("utf-8") ?? "").trim().split("\n")[0] ?? "unknown error";
      return { error: `ssh-keygen -Y sign (attestation) failed: ${stderr}` };
    }
    let publicKey = "";
    try {
      publicKey = fs.readFileSync(resolvedKey + ".pub", "utf-8").trim();
    } catch { /* no .pub — keyid stays empty */ }
    return {
      envelope: {
        payloadType: INTOTO_PAYLOAD_TYPE,
        payload: payload.toString("base64"),
        signatures: [{ keyid: publicKey, sig: Buffer.from(stdout, "utf-8").toString("base64") }],
        x_agentboot: {
          signature_format: "sshsig",
          namespace: ATTESTATION_SIG_NAMESPACE,
          note:
            "SSHSIG over the DSSE PAE bytes. Verifiable via `agentboot verify-manifest` or " +
            "ssh-keygen -Y verify with an allowed_signers trust root. Not a Sigstore bundle: " +
            "no transparency log, no CI-identity certificate.",
        },
      },
    };
  } catch (err) {
    return { error: `ssh-keygen unavailable for attestation: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface AttestationVerification {
  statementOk: boolean;
  /** Subjects in the statement match the manifest's files + digest. */
  subjectsMatchManifest: boolean | null;
  signatureOk: boolean | null;
  signerVerified: boolean | null;
  signerPrincipal: string | null;
  errors: string[];
}

/**
 * Verify a written attestation file against its manifest: payload parses as
 * an in-toto statement, subjects match the manifest's file digests + manifest
 * digest, SSHSIG verifies over the recomputed PAE, and (optionally) the
 * signer authenticates against an allowed_signers file.
 */
export function verifyAttestationFile(
  attestationPath: string,
  manifestPath: string | null,
  options: { allowedSignersPath?: string | undefined; signerPrincipal?: string | undefined } = {},
): AttestationVerification {
  const result: AttestationVerification = {
    statementOk: false,
    subjectsMatchManifest: null,
    signatureOk: null,
    signerVerified: null,
    signerPrincipal: null,
    errors: [],
  };

  let envelope: DsseEnvelope;
  let payload: Buffer;
  let statement: InTotoStatement;
  try {
    envelope = JSON.parse(fs.readFileSync(attestationPath, "utf-8")) as DsseEnvelope;
    payload = Buffer.from(envelope.payload, "base64");
    statement = JSON.parse(payload.toString("utf-8")) as InTotoStatement;
    result.statementOk =
      statement._type === INTOTO_STATEMENT_TYPE &&
      Array.isArray(statement.subject) &&
      statement.predicateType === MANIFEST_PREDICATE_TYPE;
    if (!result.statementOk) result.errors.push("Payload is not a well-formed in-toto v1 statement");
  } catch (err) {
    result.errors.push(`Cannot read attestation: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  if (manifestPath && fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      const expected = buildInTotoStatement(manifest);
      const key = (s: Array<{ name: string; digest: { sha256: string } }>) =>
        s.map((x) => `${x.name}@${x.digest.sha256}`).sort().join("|");
      result.subjectsMatchManifest = key(expected.subject) === key(statement.subject);
      if (!result.subjectsMatchManifest) {
        result.errors.push("Attestation subjects do not match the manifest's file digests — one of them changed after signing");
      }
    } catch (err) {
      result.errors.push(`Cannot compare against manifest: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sigB64 = envelope.signatures?.[0]?.sig;
  if (!sigB64) {
    result.signatureOk = false;
    result.errors.push("Envelope carries no signature");
    return result;
  }
  const pae = dssePae(envelope.payloadType, payload);
  let sigDir: string | null = null;
  try {
    sigDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-attcheck-"));
    const sigFile = path.join(sigDir, "att.sig");
    fs.writeFileSync(sigFile, Buffer.from(sigB64, "base64"));
    const check = spawnSync(
      "ssh-keygen",
      ["-Y", "check-novalidate", "-n", ATTESTATION_SIG_NAMESPACE, "-s", sigFile],
      { input: pae, stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
    );
    result.signatureOk = check.status === 0;
    if (!result.signatureOk) {
      result.errors.push(`Attestation signature check failed: ${(check.stderr?.toString("utf-8") ?? "").trim().split("\n")[0]}`);
    }
    if (result.signatureOk && options.allowedSignersPath) {
      const allowed = path.resolve(options.allowedSignersPath);
      if (!fs.existsSync(allowed)) {
        result.signerVerified = false;
        result.errors.push(`allowed_signers file not found: ${allowed}`);
      } else {
        let principal = options.signerPrincipal ?? null;
        if (!principal) {
          const found = spawnSync(
            "ssh-keygen",
            ["-Y", "find-principals", "-f", allowed, "-s", sigFile],
            { encoding: "utf-8", stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
          );
          principal = found.status === 0 ? (found.stdout ?? "").trim().split("\n")[0] || null : null;
          if (!principal) {
            result.signerVerified = false;
            result.errors.push("Attestation signer is not listed in the allowed_signers file");
          }
        }
        if (principal) {
          const verify = spawnSync(
            "ssh-keygen",
            ["-Y", "verify", "-f", allowed, "-I", principal, "-n", ATTESTATION_SIG_NAMESPACE, "-s", sigFile],
            { input: pae, stdio: "pipe", timeout: PROBE_TIMEOUT_MS },
          );
          result.signerVerified = verify.status === 0;
          result.signerPrincipal = principal;
          if (!result.signerVerified) {
            result.errors.push(`Attestation signer authentication failed for principal "${principal}"`);
          }
        }
      }
    }
  } catch (err) {
    result.signatureOk = false;
    result.errors.push(`ssh-keygen unavailable for attestation check: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (sigDir) fs.rmSync(sigDir, { recursive: true, force: true });
  }

  return result;
}
