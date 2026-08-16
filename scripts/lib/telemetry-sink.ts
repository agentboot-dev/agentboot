/**
 * D3: central tamper-evident telemetry sink.
 *
 * The trust model, stated honestly:
 *  - Every telemetry event carries a hash CHAIN link (sha256 of the previous
 *    event's chain + the event's canonical content). This makes post-write
 *    edits, deletions, and reordering of the local log DETECTABLE — it does
 *    not prevent them, and it is unkeyed, so an actor who rewrites the entire
 *    file consistently defeats it. Concurrent hook writes can legitimately
 *    fork the chain (two events chaining off the same parent); verification
 *    reports forks as warnings, distinct from content tampering.
 *  - `telemetry-ship` moves events into sequence-numbered BATCHES, each
 *    digest-chained to the previous batch and (when signing is configured)
 *    SSH-signed with the org key. Once a batch reaches the org's sink, local
 *    deletion no longer erases history, forged batches fail signature
 *    verification, and a missing batch is visible as a sequence gap.
 *  - The residual limit: a developer who controls the machine can suppress
 *    events BEFORE first shipment. Org-side controls (ship cadence in CI,
 *    ingestion timestamps) bound that window; AgentBoot states it rather
 *    than pretending otherwise.
 *
 * No phone-home: there is no default endpoint. The sink is the ORG's own
 * collector, configured in the hub and compiled into synced artifacts
 * (org-managed, not per-developer).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  canonicalize,
  signManifestDigest,
  type ManifestSignature,
} from "./provenance.js";
import type { TelemetrySinkConfig } from "./config.js";

export const TELEMETRY_CHAIN_GENESIS = "agentboot-telemetry-genesis";
export const TELEMETRY_SIG_NAMESPACE = "agentboot-telemetry";
/** How far back verification searches for a fork parent (concurrent hooks). */
const FORK_LOOKBACK = 8;

// ---------------------------------------------------------------------------
// Event chain
// ---------------------------------------------------------------------------

/** chain = sha256(prevChain + canonical(event without its chain field)). */
export function computeEventChain(prevChain: string, event: Record<string, unknown>): string {
  const { chain: _chain, ...rest } = event;
  return createHash("sha256").update(prevChain + canonicalize(rest)).digest("hex");
}

export interface LogVerification {
  lines: number;
  chained: number;
  /** Events that legitimately fork off an earlier parent (concurrent writes). */
  forks: number;
  /** Pre-chain events (no chain field) — written before v0.17.0. */
  unchained: number;
  failures: Array<{ line: number; reason: string }>;
  ok: boolean;
}

/**
 * Verify the hash chain of a local NDJSON telemetry log. Each event's chain
 * must derive from one of the previous FORK_LOOKBACK chains (immediate parent
 * = clean; earlier parent = fork warning; none = content was modified,
 * inserted, or reordered).
 */
export function verifyTelemetryLog(logPath: string): LogVerification {
  const result: LogVerification = { lines: 0, chained: 0, forks: 0, unchained: 0, failures: [], ok: false };
  if (!fs.existsSync(logPath)) {
    result.failures.push({ line: 0, reason: `log not found: ${logPath}` });
    return result;
  }
  const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim());
  const recentChains: string[] = [TELEMETRY_CHAIN_GENESIS];
  for (let i = 0; i < lines.length; i++) {
    result.lines++;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch {
      result.failures.push({ line: i + 1, reason: "not valid JSON" });
      continue;
    }
    const chain = event["chain"];
    if (typeof chain !== "string") {
      result.unchained++;
      continue;
    }
    const candidates = recentChains.slice(-FORK_LOOKBACK);
    const parentIdx = candidates.findIndex((c) => computeEventChain(c, event) === chain);
    if (parentIdx === -1) {
      result.failures.push({
        line: i + 1,
        reason: "chain does not derive from any recent parent — content modified, inserted, or reordered",
      });
    } else {
      result.chained++;
      if (parentIdx !== candidates.length - 1) result.forks++;
    }
    recentChains.push(chain as string);
  }
  result.ok = result.failures.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export interface TelemetryBatch {
  format: "agentboot-telemetry-batch";
  version: 1;
  batch_seq: number;
  created_at: string;
  source_log: string;
  events: Array<Record<string, unknown>>;
  prev_batch_digest: string | null;
  digest?: string;
  signature?: ManifestSignature;
}

export function computeBatchDigest(batch: TelemetryBatch): string {
  const { digest: _d, signature: _s, ...rest } = batch;
  return createHash("sha256").update(canonicalize(rest)).digest("hex");
}

export interface SpoolState {
  /** Byte offset into the log already spooled. */
  offset: number;
  /** Last batch sequence number written. */
  lastSeq: number;
  /** Digest of the last batch written. */
  lastDigest: string | null;
}

function stateFile(spoolDir: string): string {
  return path.join(spoolDir, "spool-state.json");
}

export function readSpoolState(spoolDir: string): SpoolState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(spoolDir), "utf-8")) as SpoolState;
  } catch {
    return { offset: 0, lastSeq: 0, lastDigest: null };
  }
}

export interface SpoolResult {
  batchesWritten: number;
  eventsSpooled: number;
  signed: boolean;
  signingError: string | null;
  batchFiles: string[];
  /** Complete log lines that were present but unparseable (surfaced, not silently dropped). */
  corruptLines: number;
  /** The local log shrank below the cursor (rotation/truncation) — cursor was reset to 0. */
  logReset: boolean;
  /** Signing was configured but failed — nothing was written and the cursor was NOT advanced. */
  abortedUnsigned: boolean;
}

/**
 * Move new events from the local log into sequence-numbered batch files under
 * spoolDir. Idempotent via a byte-offset cursor: events are spooled exactly
 * once.
 *
 * Integrity invariants (each fixes a silent-loss / silent-downgrade class):
 *  - **Signing is all-or-nothing.** If a signing key is configured and signing
 *    fails, the whole run aborts: no batch is written, the cursor does NOT
 *    advance, and the error surfaces — so a later run with a working key signs
 *    those events instead of shipping them permanently unsigned.
 *  - **Only complete lines are consumed.** A trailing partial line (bytes after
 *    the last newline — a hook write still in flight) is left unconsumed; the
 *    cursor stops before it so it is re-read once complete.
 *  - **Truncation is detected.** If the log shrank below the cursor (rotation),
 *    the cursor resets to 0 rather than becoming a permanent no-op.
 *  - **Corrupt complete lines are counted, not silently dropped.**
 */
export function spoolTelemetry(
  logPath: string,
  spoolDir: string,
  options: { batchSize?: number; signKeyPath?: string | null } = {},
): SpoolResult {
  const batchSize = options.batchSize ?? 100;
  const result: SpoolResult = {
    batchesWritten: 0, eventsSpooled: 0, signed: false, signingError: null,
    batchFiles: [], corruptLines: 0, logReset: false, abortedUnsigned: false,
  };
  if (!fs.existsSync(logPath)) return result;
  fs.mkdirSync(spoolDir, { recursive: true });

  const state = readSpoolState(spoolDir);
  const buf = fs.readFileSync(logPath);

  // Truncation/rotation: the log is shorter than where we last stopped, so the
  // bytes we recorded no longer exist. Re-read from the start rather than
  // sitting past EOF forever (batches are seq-numbered, so the sink dedups).
  let startOffset = state.offset;
  if (startOffset > buf.length) {
    startOffset = 0;
    result.logReset = true;
  }
  if (startOffset >= buf.length) return result;

  // Consume only through the last newline; anything after it is a partial write
  // in flight — leave those bytes for the next run.
  const region = buf.subarray(startOffset);
  const lastNl = region.lastIndexOf(0x0a);
  if (lastNl === -1) return result; // no complete line yet
  const consumedBytes = lastNl + 1;
  const complete = region.subarray(0, consumedBytes).toString("utf-8");
  const lines = complete.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    // Only blank lines — still advance so we don't re-scan them forever.
    fs.writeFileSync(stateFile(spoolDir), JSON.stringify({
      offset: startOffset + consumedBytes, lastSeq: state.lastSeq, lastDigest: state.lastDigest,
    } satisfies SpoolState, null, 2) + "\n", { mode: 0o600 });
    return result;
  }

  const events: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line) as Record<string, unknown>); }
    catch { result.corruptLines++; }
  }

  let seq = state.lastSeq;
  let prevDigest = state.lastDigest;
  const written: string[] = [];
  const rollback = () => { for (const f of written) { try { fs.unlinkSync(f); } catch { /* already gone */ } } };

  for (let i = 0; i < events.length; i += batchSize) {
    seq++;
    const batch: TelemetryBatch = {
      format: "agentboot-telemetry-batch",
      version: 1,
      batch_seq: seq,
      created_at: new Date().toISOString(),
      source_log: path.basename(logPath),
      events: events.slice(i, i + batchSize),
      prev_batch_digest: prevDigest,
    };
    batch.digest = computeBatchDigest(batch);
    if (options.signKeyPath) {
      const signed = signManifestDigest(batch.digest, options.signKeyPath, TELEMETRY_SIG_NAMESPACE);
      if ("error" in signed) {
        // Signing was required but failed — roll back everything written this
        // run and leave the cursor untouched so these events get another chance
        // to be signed, rather than permanently shipping them unsigned.
        rollback();
        result.signingError = signed.error;
        result.abortedUnsigned = true;
        result.batchesWritten = 0;
        result.eventsSpooled = 0;
        result.batchFiles = [];
        result.signed = false;
        return result;
      }
      batch.signature = signed.signature;
      result.signed = true;
    }
    const file = path.join(spoolDir, `batch-${String(seq).padStart(8, "0")}.json`);
    fs.writeFileSync(file, JSON.stringify(batch, null, 2) + "\n", { mode: 0o600 });
    written.push(file);
    result.batchFiles.push(file);
    result.batchesWritten++;
    result.eventsSpooled += batch.events.length;
    prevDigest = batch.digest;
  }

  fs.writeFileSync(stateFile(spoolDir), JSON.stringify({
    offset: startOffset + consumedBytes,
    lastSeq: seq,
    lastDigest: prevDigest,
  } satisfies SpoolState, null, 2) + "\n", { mode: 0o600 });
  return result;
}

export interface ShipResult {
  shipped: number;
  failed: number;
  errors: string[];
}

/** Resolve "$VAR" header values from the environment at ship time. */
export function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = { "content-type": "application/json" };
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k.toLowerCase()] = v.startsWith("$") ? (process.env[v.slice(1)] ?? "") : v;
  }
  return out;
}

/**
 * POST every unshipped batch in spoolDir to the org sink, oldest first, in
 * order. A shipped batch moves to spoolDir/shipped/ (kept as the local audit
 * copy). Stops at the first failure to preserve sequence order at the sink.
 */
export async function shipSpool(spoolDir: string, sink: TelemetrySinkConfig): Promise<ShipResult> {
  const result: ShipResult = { shipped: 0, failed: 0, errors: [] };
  if (!fs.existsSync(spoolDir)) return result;
  if (!sink.url.startsWith("https://")) {
    result.errors.push(`sink url must be https:// — got ${sink.url}`);
    return result;
  }
  const shippedDir = path.join(spoolDir, "shipped");
  fs.mkdirSync(shippedDir, { recursive: true });
  const batches = fs.readdirSync(spoolDir)
    .filter((f) => /^batch-\d{8}\.json$/.test(f))
    .sort();
  const headers = resolveHeaders(sink.headers);
  for (const f of batches) {
    const abs = path.join(spoolDir, f);
    try {
      const res = await fetch(sink.url, {
        method: "POST",
        headers,
        body: fs.readFileSync(abs, "utf-8"),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        result.failed++;
        result.errors.push(`${f}: sink responded ${res.status}`);
        break; // preserve order — retry from here next run
      }
      fs.renameSync(abs, path.join(shippedDir, f));
      result.shipped++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${f}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Batch-chain verification (sink side or local audit copy)
// ---------------------------------------------------------------------------

export interface BatchChainVerification {
  batches: number;
  signed: number;
  /** Batches whose SSHSIG cryptographically verified over their digest. */
  signatureVerified: number;
  /** Batches whose signer authenticated against the allowed_signers file. */
  signerAuthenticated: number;
  gaps: number[];
  /**
   * The earliest batch present does not begin the chain — its
   * `prev_batch_digest` names a predecessor that is NOT in this directory.
   *
   * Sequence continuity was only ever checked BETWEEN present files, so deleting
   * the oldest batches left `gaps: []` and `ok: true`. Truncating the front of
   * the chain is the obvious move for anyone removing the window they care
   * about, and it was the one edit this tamper-evident control could not see.
   */
  truncatedPrefix: boolean;
  failures: Array<{ file: string; reason: string }>;
  ok: boolean;
}

export interface VerifyBatchChainOptions {
  /**
   * Treat any UNSIGNED batch, or a batch whose signature does not verify, as a
   * FAILURE. This is the only defense against signature stripping — the chain
   * digest is unkeyed, so an actor who deletes the `signature` fields and keeps
   * the (still self-consistent) digests otherwise passes. The expectation that
   * batches MUST be signed can only come from outside: this flag, set by the
   * org's verifier/CI.
   */
  requireSigned?: boolean | undefined;
  /**
   * Accept a directory that holds a deliberate SLICE of the chain rather than
   * all of it — e.g. the live spool root, whose oldest batches have already been
   * moved to `shipped/`. Off by default: a store that is meant to be complete
   * (the sink's, or the spool's `shipped/`) must not pass while missing its
   * head, and "we are only looking at part of it" has to be stated, not assumed.
   */
  allowPartial?: boolean | undefined;
  /**
   * Cryptographically verify signatures and COUNT the verified ones, without
   * failing on unsigned batches (for reporting, e.g. the evidence pack). Implied
   * by requireSigned / allowedSignersPath.
   */
  verifySignatures?: boolean | undefined;
  /** Path to an OpenSSH allowed_signers file to authenticate each batch signer. */
  allowedSignersPath?: string | undefined;
  /** Principal to authenticate against (discovered via find-principals when omitted). */
  signerPrincipal?: string | undefined;
}

/** SSHSIG check-novalidate (+ optional allowed_signers auth) of a batch signature over its digest. */
function verifyBatchSignature(
  batch: TelemetryBatch,
  opts: VerifyBatchChainOptions,
): { signatureOk: boolean; signerAuthed: boolean | null; error?: string } {
  const sig = batch.signature;
  if (!sig?.signature || !batch.digest) return { signatureOk: false, signerAuthed: null, error: "no signature" };
  const namespace = sig.namespace || TELEMETRY_SIG_NAMESPACE;
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-batchsig-"));
    const sigFile = path.join(dir, "batch.sig");
    fs.writeFileSync(sigFile, sig.signature, "utf-8");
    const check = spawnSync(
      "ssh-keygen",
      ["-Y", "check-novalidate", "-n", namespace, "-s", sigFile],
      { input: batch.digest, encoding: "utf-8", stdio: "pipe", timeout: 10_000 },
    );
    if (check.status !== 0) {
      return { signatureOk: false, signerAuthed: null, error: (check.stderr ?? "").trim().split("\n")[0] || "signature check failed" };
    }
    let signerAuthed: boolean | null = null;
    if (opts.allowedSignersPath) {
      const allowed = path.resolve(opts.allowedSignersPath);
      if (!fs.existsSync(allowed)) {
        return { signatureOk: true, signerAuthed: false, error: `allowed_signers not found: ${allowed}` };
      }
      let principal = opts.signerPrincipal ?? null;
      if (!principal) {
        const found = spawnSync("ssh-keygen", ["-Y", "find-principals", "-f", allowed, "-s", sigFile],
          { encoding: "utf-8", stdio: "pipe", timeout: 10_000 });
        principal = found.status === 0 ? (found.stdout ?? "").trim().split("\n")[0] || null : null;
      }
      if (!principal) return { signatureOk: true, signerAuthed: false, error: "signer not in allowed_signers" };
      const verify = spawnSync(
        "ssh-keygen",
        ["-Y", "verify", "-f", allowed, "-I", principal, "-n", namespace, "-s", sigFile],
        { input: batch.digest, encoding: "utf-8", stdio: "pipe", timeout: 10_000 },
      );
      signerAuthed = verify.status === 0;
    }
    return { signatureOk: true, signerAuthed };
  } catch (err) {
    return { signatureOk: false, signerAuthed: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Verify digest integrity, digest chaining, sequence continuity, and — when
 * `requireSigned` is set or an allowed_signers file is supplied — the SSHSIG
 * signature (and signer identity) of every batch in a directory.
 */
export function verifyBatchChain(dir: string, options: VerifyBatchChainOptions = {}): BatchChainVerification {
  const result: BatchChainVerification = {
    batches: 0, signed: 0, signatureVerified: 0, signerAuthenticated: 0,
    gaps: [], truncatedPrefix: false, failures: [], ok: false,
  };
  if (!fs.existsSync(dir)) {
    result.failures.push({ file: dir, reason: "directory not found" });
    return result;
  }
  const wantSigCheck = options.requireSigned === true || options.allowedSignersPath !== undefined || options.verifySignatures === true;
  const files = fs.readdirSync(dir).filter((f) => /^batch-\d{8}\.json$/.test(f)).sort();
  if (files.length === 0) {
    // An empty store is not a verified chain. `failures: []` + `gaps: []` used
    // to compute ok=true, so deleting every batch PASSED verification and the
    // evidence pack embedded `{batches: 0, ok: true}` for an auditor to read.
    result.failures.push({ file: dir, reason: "no batch files in this directory — an empty store is not a verified chain" });
    return result;
  }
  let firstBatchSeen = false;
  let prevSeq: number | null = null;
  let prevDigest: string | null = null;
  for (const f of files) {
    result.batches++;
    let batch: TelemetryBatch;
    try {
      batch = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as TelemetryBatch;
    } catch {
      result.failures.push({ file: f, reason: "not valid JSON" });
      continue;
    }
    if (batch.digest !== computeBatchDigest(batch)) {
      result.failures.push({ file: f, reason: "digest mismatch — batch content was modified" });
    }
    if (!firstBatchSeen) {
      firstBatchSeen = true;
      // The chain's genesis batch is seq 1 with a null predecessor, by
      // construction. Anything else means this directory does not contain the
      // start of the chain — the batches before it were deleted or never
      // delivered, and nothing downstream could tell.
      if (batch.batch_seq !== 1 || batch.prev_batch_digest !== null) {
        result.truncatedPrefix = true;
        if (!options.allowPartial) {
          result.failures.push({
            file: f,
            reason: `chain does not start here — earliest batch is seq ${batch.batch_seq}` +
              `${batch.prev_batch_digest ? " and names a predecessor that is absent" : ""}` +
              " (batches before it were deleted or never delivered)",
          });
          for (let s = 1; s < batch.batch_seq; s++) result.gaps.push(s);
        }
      }
    }
    if (prevSeq !== null) {
      if (batch.batch_seq !== prevSeq + 1) {
        for (let s = prevSeq + 1; s < batch.batch_seq; s++) result.gaps.push(s);
      }
      if (batch.prev_batch_digest !== prevDigest) {
        result.failures.push({ file: f, reason: "prev_batch_digest does not match the preceding batch" });
      }
    }
    const hasSig = Boolean(batch.signature?.signature);
    if (hasSig) result.signed++;
    if (wantSigCheck) {
      if (!hasSig) {
        if (options.requireSigned) {
          result.failures.push({ file: f, reason: "batch is UNSIGNED but signatures are required (--require-signed) — possible signature stripping" });
        }
      } else {
        const v = verifyBatchSignature(batch, options);
        if (!v.signatureOk) {
          result.failures.push({ file: f, reason: `signature verification failed${v.error ? `: ${v.error}` : ""}` });
        } else {
          result.signatureVerified++;
          if (v.signerAuthed === true) result.signerAuthenticated++;
          else if (v.signerAuthed === false) {
            result.failures.push({ file: f, reason: `signer not authenticated against allowed_signers${v.error ? `: ${v.error}` : ""}` });
          }
        }
      }
    }
    prevSeq = batch.batch_seq;
    prevDigest = batch.digest ?? null;
  }
  result.ok = result.failures.length === 0 && result.gaps.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// Sink-config discovery (spoke side)
// ---------------------------------------------------------------------------

/**
 * Find the org sink config: an explicit path, a synced
 * .claude/telemetry-sink.json walking up from cwd, or null.
 */
export function findSinkConfig(explicitPath?: string, startDir: string = process.cwd()): TelemetrySinkConfig | null {
  const tryRead = (p: string): TelemetrySinkConfig | null => {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as TelemetrySinkConfig;
      return typeof parsed.url === "string" ? parsed : null;
    } catch { return null; }
  };
  if (explicitPath) return tryRead(explicitPath);
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".claude", "telemetry-sink.json");
    if (fs.existsSync(candidate)) return tryRead(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function defaultSpoolDir(): string {
  return path.join(os.homedir(), ".agentboot", "telemetry-spool");
}
