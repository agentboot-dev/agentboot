/**
 * D3: central tamper-evident telemetry sink.
 *
 * Covers the full evidence chain with its honest trust model:
 *  - per-event hash chain written by the generated hook (edits/deletions/
 *    reordering of the local log are detectable; forks from concurrent hooks
 *    are warnings, not tampering)
 *  - spooling into sequence-numbered, digest-chained, optionally SSH-signed
 *    batches (idempotent byte-offset cursor)
 *  - batch-chain verification: digest integrity, prev-digest linkage,
 *    sequence-gap detection, signature authentication
 *  - org-wide distribution: compile emits telemetry-sink.json into platform
 *    core dirs; the shipper discovers it from a synced spoke
 *  - no phone-home invariants: no default endpoint, https:// only
 */

import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  computeEventChain,
  verifyTelemetryLog,
  spoolTelemetry,
  verifyBatchChain,
  computeBatchDigest,
  findSinkConfig,
  resolveHeaders,
  TELEMETRY_CHAIN_GENESIS,
  type TelemetryBatch,
} from "../scripts/lib/telemetry-sink.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 120_000,
  }).toString();
}

const sshAvailable = (() => {
  try {
    const r = spawnSync("ssh-keygen", ["-Y", "sign", "-h"], { stdio: "pipe", timeout: 10_000 });
    return r.status !== 127 && r.error === undefined;
  } catch { return false; }
})();

function writeChainedLog(logPath: string, count: number): void {
  let prev = TELEMETRY_CHAIN_GENESIS;
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const event: Record<string, unknown> = {
      event: "hook_execution", persona_id: "p", tool_name: "Edit",
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      dev_id: "", schema: 2,
    };
    const chain = computeEventChain(prev, event);
    lines.push(JSON.stringify({ ...event, chain }));
    prev = chain;
  }
  fs.writeFileSync(logPath, lines.join("\n") + "\n");
}

describe("event hash chain", () => {
  it("a clean chained log verifies", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-log-"));
    try {
      const log = path.join(dir, "t.ndjson");
      writeChainedLog(log, 10);
      const v = verifyTelemetryLog(log);
      expect(v.ok).toBe(true);
      expect(v.chained).toBe(10);
      expect(v.forks).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("editing an event's content is detected", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-edit-"));
    try {
      const log = path.join(dir, "t.ndjson");
      writeChainedLog(log, 10);
      const lines = fs.readFileSync(log, "utf-8").trim().split("\n");
      const tampered = JSON.parse(lines[4]!);
      tampered.tool_name = "Bash"; // rewrite history: claim a different tool ran
      lines[4] = JSON.stringify(tampered);
      fs.writeFileSync(log, lines.join("\n") + "\n");
      const v = verifyTelemetryLog(log);
      expect(v.ok).toBe(false);
      expect(v.failures.some((f) => f.line === 5)).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("deleting an event is detected", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-del-"));
    try {
      const log = path.join(dir, "t.ndjson");
      writeChainedLog(log, 10);
      const lines = fs.readFileSync(log, "utf-8").trim().split("\n");
      lines.splice(4, 1);
      fs.writeFileSync(log, lines.join("\n") + "\n");
      const v = verifyTelemetryLog(log);
      expect(v.ok).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("a concurrent-write fork is a warning, not a failure", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-fork-"));
    try {
      const log = path.join(dir, "t.ndjson");
      writeChainedLog(log, 3);
      // Two hooks raced: this event chains off line 2's chain, not line 3's.
      const lines = fs.readFileSync(log, "utf-8").trim().split("\n");
      const parent = (JSON.parse(lines[1]!) as { chain: string }).chain;
      const raced: Record<string, unknown> = {
        event: "session_summary", timestamp: "2026-01-01T00:01:00Z", dev_id: "", schema: 2,
      };
      raced["chain"] = computeEventChain(parent, raced);
      fs.appendFileSync(log, JSON.stringify(raced) + "\n");
      const v = verifyTelemetryLog(log);
      expect(v.ok).toBe(true);
      expect(v.forks).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("the generated hook writes chained events end-to-end", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-hook-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-hooklog-"));
    try {
      fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme", personas: { enabled: [], outputFormats: ["claude"] },
        traits: { enabled: [] }, telemetry: { enabled: true },
        validation: { secretPatterns: [] },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const hook = path.join(hub, "dist", "claude", "core", "hooks", "agentboot-telemetry.sh");
      const log = path.join(dataDir, "telemetry.ndjson");
      for (const payload of [
        { hook_event_name: "PostToolUse", tool_name: "Edit" },
        { hook_event_name: "PostToolUse", tool_name: "Write" },
        { hook_event_name: "SessionEnd" },
      ]) {
        const r = spawnSync("bash", [hook], {
          input: JSON.stringify(payload), encoding: "utf-8", timeout: 20_000,
          env: { ...process.env, AGENTBOOT_TELEMETRY_LOG: log },
        });
        expect(r.status).toBe(0);
      }
      const v = verifyTelemetryLog(log);
      expect(v.lines).toBe(3);
      expect(v.chained).toBe(3);
      expect(v.ok).toBe(true);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("spool and batch chain", () => {
  it("spools events into digest-chained batches, idempotently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-spool-"));
    try {
      const log = path.join(dir, "t.ndjson");
      const spool = path.join(dir, "spool");
      writeChainedLog(log, 25);
      const first = spoolTelemetry(log, spool, { batchSize: 10 });
      expect(first.batchesWritten).toBe(3);
      expect(first.eventsSpooled).toBe(25);
      // Second run: nothing new — exactly once.
      const again = spoolTelemetry(log, spool, { batchSize: 10 });
      expect(again.batchesWritten).toBe(0);
      // Append more events → next batch continues the sequence + digest chain.
      const lines = fs.readFileSync(log, "utf-8").trim().split("\n");
      const lastChain = (JSON.parse(lines[lines.length - 1]!) as { chain: string }).chain;
      const extra: Record<string, unknown> = { event: "session_summary", timestamp: "2026-01-01T01:00:00Z", dev_id: "", schema: 2 };
      extra["chain"] = computeEventChain(lastChain, extra);
      fs.appendFileSync(log, JSON.stringify(extra) + "\n");
      const third = spoolTelemetry(log, spool, { batchSize: 10 });
      expect(third.batchesWritten).toBe(1);

      const v = verifyBatchChain(spool);
      expect(v.batches).toBe(4);
      expect(v.ok).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("batch content tampering and batch deletion are detected", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-tamper-"));
    try {
      const log = path.join(dir, "t.ndjson");
      const spool = path.join(dir, "spool");
      writeChainedLog(log, 30);
      spoolTelemetry(log, spool, { batchSize: 10 });

      // Tamper: drop an event from batch 2.
      const b2 = path.join(spool, "batch-00000002.json");
      const batch = JSON.parse(fs.readFileSync(b2, "utf-8")) as TelemetryBatch;
      batch.events.pop();
      fs.writeFileSync(b2, JSON.stringify(batch, null, 2));
      let v = verifyBatchChain(spool);
      expect(v.ok).toBe(false);
      expect(v.failures.some((f) => f.file.includes("00000002") && f.reason.includes("digest"))).toBe(true);

      // Restore digest consistency for the tampered batch — now the NEXT
      // batch's prev_batch_digest exposes it.
      batch.digest = computeBatchDigest(batch);
      fs.writeFileSync(b2, JSON.stringify(batch, null, 2));
      v = verifyBatchChain(spool);
      expect(v.failures.some((f) => f.file.includes("00000003") && f.reason.includes("prev_batch_digest"))).toBe(true);

      // Deletion: remove batch 2 entirely → sequence gap.
      fs.rmSync(b2);
      v = verifyBatchChain(spool);
      expect(v.gaps).toContain(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it.skipIf(!sshAvailable)("signed batches authenticate against allowed_signers; a rogue signer fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-sign-"));
    try {
      const key = path.join(dir, "key");
      execSync(`ssh-keygen -q -t ed25519 -N "" -f "${key}"`, { timeout: 15_000 });
      const log = path.join(dir, "t.ndjson");
      const spool = path.join(dir, "spool");
      writeChainedLog(log, 5);
      const res = spoolTelemetry(log, spool, { batchSize: 10, signKeyPath: key });
      expect(res.signed).toBe(true);
      expect(res.signingError).toBeNull();

      const batchFile = res.batchFiles[0]!;
      const batch = JSON.parse(fs.readFileSync(batchFile, "utf-8")) as TelemetryBatch;
      expect(batch.signature?.signature).toContain("BEGIN SSH SIGNATURE");

      // Authenticate via ssh-keygen -Y verify against an allowed_signers root.
      const pub = fs.readFileSync(key + ".pub", "utf-8").trim().split(" ").slice(0, 2).join(" ");
      const allowed = path.join(dir, "allowed_signers");
      fs.writeFileSync(allowed, `ci@example.com ${pub}\n`);
      const sigFile = path.join(dir, "b.sig");
      fs.writeFileSync(sigFile, batch.signature!.signature);
      const good = spawnSync("ssh-keygen",
        ["-Y", "verify", "-f", allowed, "-I", "ci@example.com", "-n", "agentboot-telemetry", "-s", sigFile],
        { input: batch.digest!, encoding: "utf-8", timeout: 10_000 });
      expect(good.status).toBe(0);

      // A different (rogue) trust root rejects it.
      const rogue = path.join(dir, "rogue");
      execSync(`ssh-keygen -q -t ed25519 -N "" -f "${rogue}"`, { timeout: 15_000 });
      const roguePub = fs.readFileSync(rogue + ".pub", "utf-8").trim().split(" ").slice(0, 2).join(" ");
      fs.writeFileSync(allowed, `ci@example.com ${roguePub}\n`);
      const bad = spawnSync("ssh-keygen",
        ["-Y", "verify", "-f", allowed, "-I", "ci@example.com", "-n", "agentboot-telemetry", "-s", sigFile],
        { input: batch.digest!, encoding: "utf-8", timeout: 10_000 });
      expect(bad.status).not.toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("org-wide sink distribution + no-phone-home invariants", () => {
  it("compile emits telemetry-sink.json into platform core dirs; findSinkConfig discovers it from a nested dir", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-dist-"));
    try {
      fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme", personas: { enabled: [], outputFormats: ["claude"] },
        traits: { enabled: [] },
        telemetry: { enabled: true, sink: { url: "https://telemetry.example.internal/ingest", batchSize: 50 } },
        validation: { secretPatterns: [] },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const emitted = path.join(hub, "dist", "claude", "core", "telemetry-sink.json");
      expect(fs.existsSync(emitted)).toBe(true);
      expect(JSON.parse(fs.readFileSync(emitted, "utf-8")).url).toBe("https://telemetry.example.internal/ingest");

      // Spoke-side discovery: .claude/telemetry-sink.json found walking up.
      const spoke = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-spoke-"));
      try {
        fs.mkdirSync(path.join(spoke, ".claude"), { recursive: true });
        fs.copyFileSync(emitted, path.join(spoke, ".claude", "telemetry-sink.json"));
        const nested = path.join(spoke, "src", "deep");
        fs.mkdirSync(nested, { recursive: true });
        const found = findSinkConfig(undefined, nested);
        expect(found?.url).toBe("https://telemetry.example.internal/ingest");
      } finally { fs.rmSync(spoke, { recursive: true, force: true }); }
    } finally { fs.rmSync(hub, { recursive: true, force: true }); }
  });

  it("config validation rejects a non-https sink url (no plaintext shipping)", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "ab-d3-http-"));
    try {
      fs.mkdirSync(path.join(hub, "core"), { recursive: true });
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme", personas: { enabled: [] }, traits: { enabled: [] },
        telemetry: { sink: { url: "http://insecure.example/ingest" } },
      }));
      let output = "";
      try {
        output = run(`scripts/validate.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "") + String(err.message ?? "");
      }
      expect(output).toContain("https://");
    } finally { fs.rmSync(hub, { recursive: true, force: true }); }
  });

  it("no default endpoint exists anywhere in the sink path", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "telemetry-sink.ts"), "utf-8");
    // The only URLs the shipper knows are org-configured; no hardcoded host.
    expect(src).not.toMatch(/https:\/\/(?!$)[a-z0-9.-]*agentboot\.dev/);
    expect(src).not.toMatch(/fetch\("https:\/\//);
  });

  it("resolveHeaders expands $ENV values at ship time", () => {
    process.env["AB_D3_TEST_TOKEN"] = "sekrit-token-value";
    const h = resolveHeaders({ authorization: "$AB_D3_TEST_TOKEN", "x-static": "plain" });
    expect(h["authorization"]).toBe("sekrit-token-value");
    expect(h["x-static"]).toBe("plain");
    delete process.env["AB_D3_TEST_TOKEN"];
  });
});

describe("chain primitive parity with the hook's inline implementation", () => {
  it("computeEventChain matches a hand-computed sha256(prev + canonical)", () => {
    const event = { b: 2, a: 1, nested: { z: true, y: [1, 2] } };
    const canonical = '{"a":1,"b":2,"nested":{"y":[1,2],"z":true}}';
    const expected = createHash("sha256").update("seed" + canonical).digest("hex");
    expect(computeEventChain("seed", event)).toBe(expected);
  });
});
