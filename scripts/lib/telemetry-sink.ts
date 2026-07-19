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
}

/**
 * Move new events from the local log into sequence-numbered batch files under
 * spoolDir. Idempotent via a byte-offset cursor: events are spooled exactly
 * once. Signing failures are surfaced, never silent (a configured-but-broken
 * signer must not quietly downgrade the evidence chain).
 */
export function spoolTelemetry(
  logPath: string,
  spoolDir: string,
  options: { batchSize?: number; signKeyPath?: string | null } = {},
): SpoolResult {
  const batchSize = options.batchSize ?? 100;
  const result: SpoolResult = { batchesWritten: 0, eventsSpooled: 0, signed: false, signingError: null, batchFiles: [] };
  if (!fs.existsSync(logPath)) return result;
  fs.mkdirSync(spoolDir, { recursive: true });

  const state = readSpoolState(spoolDir);
  const buf = fs.readFileSync(logPath);
  if (state.offset >= buf.length) return result;
  const fresh = buf.subarray(state.offset).toString("utf-8");
  const lines = fresh.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return result;

  const events: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip corrupt line */ }
  }

  let seq = state.lastSeq;
  let prevDigest = state.lastDigest;
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
        result.signingError = signed.error;
      } else {
        batch.signature = signed.signature;
        result.signed = true;
      }
    }
    const file = path.join(spoolDir, `batch-${String(seq).padStart(8, "0")}.json`);
    fs.writeFileSync(file, JSON.stringify(batch, null, 2) + "\n", { mode: 0o600 });
    result.batchFiles.push(file);
    result.batchesWritten++;
    result.eventsSpooled += batch.events.length;
    prevDigest = batch.digest;
  }

  fs.writeFileSync(stateFile(spoolDir), JSON.stringify({
    offset: buf.length,
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
  gaps: number[];
  failures: Array<{ file: string; reason: string }>;
  ok: boolean;
}

/** Verify digest integrity, digest chaining, and sequence continuity of a directory of batch files. */
export function verifyBatchChain(dir: string): BatchChainVerification {
  const result: BatchChainVerification = { batches: 0, signed: 0, gaps: [], failures: [], ok: false };
  if (!fs.existsSync(dir)) {
    result.failures.push({ file: dir, reason: "directory not found" });
    return result;
  }
  const files = fs.readdirSync(dir).filter((f) => /^batch-\d{8}\.json$/.test(f)).sort();
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
    if (prevSeq !== null) {
      if (batch.batch_seq !== prevSeq + 1) {
        for (let s = prevSeq + 1; s < batch.batch_seq; s++) result.gaps.push(s);
      }
      if (batch.prev_batch_digest !== prevDigest) {
        result.failures.push({ file: f, reason: "prev_batch_digest does not match the preceding batch" });
      }
    }
    if (batch.signature?.signature) result.signed++;
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
