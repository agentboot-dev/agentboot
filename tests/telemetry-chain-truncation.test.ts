/**
 * R1-F — the tamper-evident batch chain could not see the two easiest edits.
 *
 * `verifyBatchChain` checked digests, `prev_batch_digest` linkage, and sequence
 * continuity BETWEEN PRESENT FILES. Both of the things an actor removing an
 * inconvenient window would actually do fell outside that:
 *
 *   1. Delete the OLDEST batches. Continuity is only checked between files that
 *      are there, and the first present batch was never asked whether it begins
 *      the chain — so its `prev_batch_digest` pointing at an absent predecessor
 *      went unexamined.
 *   2. Delete ALL of them. `failures: []` and `gaps: []` computed `ok = true`.
 *
 * Measured before the fix, on a 5-batch chain:
 *
 *     FULL             {"batches":5,"gaps":[],"failures":[],"ok":true}
 *     FRONT-TRUNCATED  {"batches":3,"gaps":[],"failures":[],"ok":true}   ← 1,2 deleted
 *     EMPTY            {"batches":0,"gaps":[],"failures":[],"ok":true}   ← all deleted
 *
 * `telemetry-verify` printed "✓ Batch chain verifies — digests intact, sequence
 * continuous" and exited 0 for all three, and `evidence-pack` embedded
 * `{batches: 0, ok: true}` for an auditor.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { verifyBatchChain, computeBatchDigest } from "../scripts/lib/telemetry-sink.js";

/** A well-formed, correctly-chained store of `n` batches. */
function makeChain(n: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-chain-"));
  let prev: string | null = null;
  for (let seq = 1; seq <= n; seq++) {
    const batch: Record<string, unknown> = {
      batch_seq: seq,
      prev_batch_digest: prev,
      org: "acme",
      schema_version: 2,
      created_at: new Date().toISOString(),
      events: [{ event: "e", seq }],
    };
    batch["digest"] = computeBatchDigest(batch as never);
    prev = batch["digest"] as string;
    fs.writeFileSync(path.join(dir, `batch-${String(seq).padStart(8, "0")}.json`), JSON.stringify(batch, null, 2));
  }
  return dir;
}

describe("verifyBatchChain — deleting the head of the chain is tampering", () => {
  it("POSITIVE: a complete chain from batch 1 verifies", () => {
    const dir = makeChain(5);
    const v = verifyBatchChain(dir);
    expect(v.ok).toBe(true);
    expect(v.batches).toBe(5);
    expect(v.truncatedPrefix).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("NEGATIVE: deleting the OLDEST batches fails, and names the missing sequences", () => {
    const dir = makeChain(5);
    fs.rmSync(path.join(dir, "batch-00000001.json"));
    fs.rmSync(path.join(dir, "batch-00000002.json"));
    const v = verifyBatchChain(dir);
    expect(v.truncatedPrefix).toBe(true);
    expect(v.gaps).toEqual([1, 2]);
    expect(v.failures[0]!.reason).toMatch(/chain does not start here/);
    expect(v.ok).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("NEGATIVE: an empty store does not verify — nothing is not intact", () => {
    const dir = makeChain(3);
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
    const v = verifyBatchChain(dir);
    expect(v.batches).toBe(0);
    expect(v.ok).toBe(false);
    expect(v.failures[0]!.reason).toMatch(/empty store is not a verified chain/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a MIDDLE deletion is still caught — the pre-existing check must not regress", () => {
    const dir = makeChain(5);
    fs.rmSync(path.join(dir, "batch-00000003.json"));
    const v = verifyBatchChain(dir);
    expect(v.gaps).toContain(3);
    expect(v.ok).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("--partial accepts a deliberate slice, and still REPORTS that it is one", () => {
    const dir = makeChain(5);
    fs.rmSync(path.join(dir, "batch-00000001.json"));
    const v = verifyBatchChain(dir, { allowPartial: true });
    // Accepted — the live spool root legitimately has its head moved to shipped/.
    expect(v.ok).toBe(true);
    // But never silently: the flag suppresses the failure, not the fact.
    expect(v.truncatedPrefix).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a missing directory still fails — unchanged", () => {
    const v = verifyBatchChain(path.join(os.tmpdir(), "ab-chain-does-not-exist-zzz"));
    expect(v.ok).toBe(false);
    expect(v.failures[0]!.reason).toMatch(/directory not found/);
  });
});
