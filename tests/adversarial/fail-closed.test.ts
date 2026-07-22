/**
 * Adversarial "known-bad" corpus (2026-07-21 GA-RC audit remediation).
 *
 * AgentBoot's thesis is "verify, don't trust" — so its verifiers must fail
 * CLOSED on tampered/stripped/unbound input, and the audit found several that
 * failed OPEN. Each test here drives an actual attack and asserts the verifier
 * now rejects it. These are the regression guards for the fail-closed fixes;
 * a future change that reopens any hole turns one of these red.
 */

import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  spoolTelemetry,
  verifyBatchChain,
} from "../../scripts/lib/telemetry-sink.js";
import {
  signManifestDigest,
  canonicalize,
  computeManifestDigest,
  verifyManifestFile,
  MANIFEST_SIG_NAMESPACE,
} from "../../scripts/lib/provenance.js";
import { computePerToolHashes } from "../../scripts/lib/mcp-pin.js";

const sshAvailable = (() => {
  try {
    const r = spawnSync("ssh-keygen", ["-Y", "sign", "-h"], { stdio: "pipe", timeout: 10_000 });
    return r.status !== 127 && r.error === undefined;
  } catch { return false; }
})();

function mkKey(dir: string): string {
  const key = path.join(dir, "k");
  execSync(`ssh-keygen -q -t ed25519 -N "" -f "${key}"`, { timeout: 15_000 });
  return key;
}

// ---------------------------------------------------------------------------
// D-03: signManifestDigest records the namespace it ACTUALLY signed under.
// ---------------------------------------------------------------------------
describe.skipIf(!sshAvailable)("D-03 signature namespace is recorded truthfully", () => {
  it("records the passed namespace, not the manifest default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ns-"));
    try {
      const key = mkKey(dir);
      const sig = signManifestDigest("deadbeef", key, "agentboot-telemetry");
      expect("signature" in sig).toBe(true);
      if ("signature" in sig) expect(sig.signature.namespace).toBe("agentboot-telemetry");
      const sig2 = signManifestDigest("deadbeef", key); // default
      if ("signature" in sig2) expect(sig2.signature.namespace).toBe(MANIFEST_SIG_NAMESPACE);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// D-02: stripping telemetry batch signatures is caught by --require-signed.
// ---------------------------------------------------------------------------
describe.skipIf(!sshAvailable)("D-02 telemetry signature stripping fails closed", () => {
  it("verifyBatchChain({requireSigned}) rejects a stripped-signature batch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-strip-"));
    try {
      const key = mkKey(dir);
      const log = path.join(dir, "telemetry.ndjson");
      fs.writeFileSync(log, [`{"event":"a"}`, `{"event":"b"}`].join("\n") + "\n");
      const spool = path.join(dir, "spool");
      const res = spoolTelemetry(log, spool, { signKeyPath: key });
      expect(res.signed).toBe(true);
      expect(res.batchesWritten).toBeGreaterThan(0);

      // Signed → verifies with signatures enforced.
      expect(verifyBatchChain(spool, { requireSigned: true }).ok).toBe(true);

      // Attacker strips the `signature` field (the digest excludes it, so the
      // batch still self-consistently digests — the exact stripping attack).
      for (const f of fs.readdirSync(spool).filter((x) => /^batch-\d{8}\.json$/.test(x))) {
        const p = path.join(spool, f);
        const b = JSON.parse(fs.readFileSync(p, "utf-8"));
        delete b.signature;
        fs.writeFileSync(p, JSON.stringify(b, null, 2) + "\n");
      }
      const after = verifyBatchChain(spool, { requireSigned: true });
      expect(after.ok).toBe(false);
      expect(after.failures.some((x) => /unsigned|stripping/i.test(x.reason))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// R-1: a signing failure aborts the spool — nothing written, cursor unmoved.
// ---------------------------------------------------------------------------
describe("R-1 signing failure does not permanently ship unsigned", () => {
  it("aborts, writes no batch, and leaves the cursor so a later run signs them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-r1-"));
    try {
      const log = path.join(dir, "telemetry.ndjson");
      fs.writeFileSync(log, [`{"event":"a"}`, `{"event":"b"}`].join("\n") + "\n");
      const spool = path.join(dir, "spool");
      const res = spoolTelemetry(log, spool, { signKeyPath: path.join(dir, "does-not-exist") });
      expect(res.abortedUnsigned).toBe(true);
      expect(res.batchesWritten).toBe(0);
      expect(fs.readdirSync(spool).filter((x) => /^batch-\d{8}\.json$/.test(x)).length).toBe(0);
      // Cursor not advanced: the events are still pending (no spool-state that skips them).
      const res2 = spoolTelemetry(log, spool, {}); // no signing this time
      expect(res2.eventsSpooled).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// D-18: torn trailing line unconsumed; truncation resets rather than no-ops.
// ---------------------------------------------------------------------------
describe("D-18 spool does not silently lose events", () => {
  it("leaves a trailing partial line unconsumed until it completes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-torn-"));
    try {
      const log = path.join(dir, "t.ndjson");
      const spool = path.join(dir, "spool");
      fs.writeFileSync(log, `{"event":"a"}\n{"event":"par`); // 2nd line torn (no newline)
      const r1 = spoolTelemetry(log, spool, {});
      expect(r1.eventsSpooled).toBe(1);
      fs.appendFileSync(log, `tial"}\n`); // complete the 2nd line
      const r2 = spoolTelemetry(log, spool, {});
      expect(r2.eventsSpooled).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects log truncation/rotation instead of sitting past EOF forever", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-trunc-"));
    try {
      const log = path.join(dir, "t.ndjson");
      const spool = path.join(dir, "spool");
      fs.writeFileSync(log, [`{"event":"a"}`, `{"event":"b"}`, `{"event":"c"}`].join("\n") + "\n");
      expect(spoolTelemetry(log, spool, {}).eventsSpooled).toBe(3);
      // Rotate: replace with a shorter log.
      fs.writeFileSync(log, `{"event":"d"}\n`);
      const r = spoolTelemetry(log, spool, {});
      expect(r.logReset).toBe(true);
      expect(r.eventsSpooled).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("surfaces corrupt complete lines instead of dropping them silently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-corrupt-"));
    try {
      const log = path.join(dir, "t.ndjson");
      const spool = path.join(dir, "spool");
      fs.writeFileSync(log, `{"event":"a"}\nNOT JSON\n{"event":"b"}\n`);
      const r = spoolTelemetry(log, spool, {});
      expect(r.corruptLines).toBe(1);
      expect(r.eventsSpooled).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// D-04: manifest posture never claims "signed-authenticated" on tampered content.
// ---------------------------------------------------------------------------
describe.skipIf(!sshAvailable)("D-04 manifest posture does not lie on tampered content", () => {
  it("reports integrity-only (not signed-*) when a listed file was swapped", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-posture-"));
    try {
      const key = mkKey(dir);
      const claude = path.join(dir, ".claude");
      fs.mkdirSync(claude, { recursive: true });
      fs.writeFileSync(path.join(claude, "a.md"), "hello");
      const hash = execSync(`node -e "const c=require('crypto');process.stdout.write(c.createHash('sha256').update('hello').digest('hex'))"`).toString();
      const manifest: Record<string, unknown> = {
        files: [{ path: ".claude/a.md", hash }], scope: null, synced_at: null, provenance: {},
      };
      const digest = computeManifestDigest(manifest);
      const signed = signManifestDigest(digest, key);
      if (!("signature" in signed)) throw new Error("sign failed");
      manifest["integrity"] = { algorithm: "sha256", manifest_digest: digest, signature: signed.signature };
      const mpath = path.join(claude, ".agentboot-manifest.json");
      fs.writeFileSync(mpath, JSON.stringify(manifest, null, 2));

      // Clean: a valid signature over an intact manifest → a signed posture.
      const clean = verifyManifestFile(mpath, dir);
      expect(clean.digestOk).toBe(true);
      expect(clean.posture.startsWith("signed")).toBe(true);

      // Swap the file content — signature and manifest digest still self-verify,
      // but the actual artifact no longer matches. Posture must drop to integrity-only.
      fs.writeFileSync(path.join(claude, "a.md"), "HACKED");
      const tampered = verifyManifestFile(mpath, dir);
      expect(tampered.fileMismatches.length).toBe(1);
      expect(tampered.posture).toBe("integrity-only");
      expect(tampered.posture).not.toBe("signed-authenticated");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// canonicalize: undefined-valued keys are omitted (JSON parity) so a manifest
// cannot fail its own verify after a JSON round-trip.
// ---------------------------------------------------------------------------
describe("canonicalize matches JSON round-trip semantics", () => {
  it("omits undefined-valued object keys", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe(canonicalize({ b: 1 }));
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

// ---------------------------------------------------------------------------
// D-09: duplicate MCP tool names do not collapse into one per-tool hash entry.
// ---------------------------------------------------------------------------
describe("D-09 duplicate tool names are not silently collapsed", () => {
  it("keeps both entries so the diff can name them", () => {
    const hashes = computePerToolHashes([
      { name: "x", description: "one" },
      { name: "x", description: "two" },
    ]);
    expect(Object.keys(hashes).length).toBe(2);
    expect(Object.keys(hashes)).toContain("x");
    expect(Object.keys(hashes)).toContain("x#2");
  });
});
