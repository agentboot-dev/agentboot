/**
 * Auditor evidence-pack export: the bundle must reflect real state (never
 * fabricate), carry drift + manifest trust postures per repo, report unprobed
 * platforms as unprobed, and be digest-protected (and signable) itself.
 */

import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildEvidencePack, computePackDigest } from "../scripts/lib/evidence-pack.js";
import type { AgentBootConfig } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

const sshAvailable = (() => {
  try {
    const r = spawnSync("ssh-keygen", ["-Y", "sign", "-h"], { stdio: "pipe", timeout: 10_000 });
    return r.status !== 127 && r.error === undefined;
  } catch { return false; }
})();

function run(script: string): string {
  return execSync(`${TSX} ${script}`, {
    cwd: ROOT, env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 120_000,
  }).toString();
}

function mkHubWithSpoke(): { hub: string; spoke: string; config: AgentBootConfig } {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), "ab-evidence-hub-"));
  const spoke = fs.mkdtempSync(path.join(os.tmpdir(), "ab-evidence-spoke-"));
  const config = {
    org: "acme",
    personas: { enabled: [], outputFormats: ["claude"] },
    traits: { enabled: [] },
    managed: { guardrails: { denyTools: ["Bash*"] } },
    validation: { secretPatterns: [] },
  } as unknown as AgentBootConfig;
  fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
  fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(hub, "repos.json"), JSON.stringify([
    { path: spoke, platform: "claude" },
  ]));
  // Hub policy exceptions: one live, one expired.
  fs.writeFileSync(path.join(hub, "agentboot-exceptions.json"), JSON.stringify([
    { id: "EX-1", policy: "drift:x", reason: "r", approver: "a", owner: "o", created: "2026-01-01", expires: "2099-01-01" },
    { id: "EX-2", policy: "drift:y", reason: "r", approver: "a", owner: "o", created: "2026-01-01", expires: "2020-01-01" },
  ]));
  run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
  run(`scripts/sync.ts --config ${path.join(hub, "agentboot.config.json")} --adopt-existing`);
  return { hub, spoke, config };
}

describe("evidence pack", () => {
  it("bundles drift state, manifest posture, guardrails, and enforcement honestly", () => {
    const { hub, spoke, config } = mkHubWithSpoke();
    try {
      const { pack, signingError } = buildEvidencePack({
        hubPath: hub, config, agentbootVersion: "0.0.0-test",
        repos: [{ path: spoke, platform: "claude" }],
        distPath: path.join(hub, "dist"),
      });
      expect(signingError).toBeNull();

      // Repo evidence: freshly synced spoke is drift-clean with a manifest.
      expect(pack.repos).toHaveLength(1);
      expect(pack.repos[0]!.drift.manifestFound).toBe(true);
      expect(pack.repos[0]!.drift.clean).toBe(true);
      expect(pack.repos[0]!.manifestVerification?.digestOk).toBe(true);
      expect(pack.repos[0]!.manifestVerification?.posture).toBe("integrity-only");

      // Guardrails: deny list + expiry status computed.
      expect(pack.guardrails.denyTools).toEqual(["Bash*"]);
      expect(pack.guardrails.exceptions.find((e) => e.id === "EX-1")?.expired).toBe(false);
      expect(pack.guardrails.exceptions.find((e) => e.id === "EX-2")?.expired).toBe(true);

      // Enforcement: no conformance run happened → claude must be UNPROBED,
      // never assumed green.
      expect(pack.enforcement.unprobed_platforms).toContain("claude");
      expect(Object.keys(pack.enforcement.manifests)).not.toContain("claude");

      // The pack protects itself.
      expect(pack.integrity?.pack_digest).toBe(computePackDigest(pack as unknown as Record<string, unknown>));
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
    }
  });

  it("reports drifted files after a spoke file is tampered", () => {
    const { hub, spoke, config } = mkHubWithSpoke();
    try {
      // Tamper a managed file in the spoke.
      const settings = path.join(spoke, ".claude", "settings.json");
      if (fs.existsSync(settings)) fs.appendFileSync(settings, "\n// tampered\n");
      const { pack } = buildEvidencePack({
        hubPath: hub, config, agentbootVersion: "0.0.0-test",
        repos: [{ path: spoke, platform: "claude" }],
        distPath: path.join(hub, "dist"),
      });
      if (fs.existsSync(settings)) {
        expect(pack.repos[0]!.drift.clean).toBe(false);
        expect(pack.repos[0]!.drift.driftedFiles.length).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
    }
  });

  it.skipIf(!sshAvailable)("signs the pack digest when a key is provided; tampering the pack breaks the digest", () => {
    const { hub, spoke, config } = mkHubWithSpoke();
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-evidence-key-"));
    try {
      const key = path.join(keyDir, "key");
      execSync(`ssh-keygen -q -t ed25519 -N "" -f "${key}"`, { timeout: 15_000 });
      const { pack, signingError } = buildEvidencePack({
        hubPath: hub, config, agentbootVersion: "0.0.0-test",
        repos: [{ path: spoke, platform: "claude" }],
        distPath: path.join(hub, "dist"),
        signKeyPath: key,
      });
      expect(signingError).toBeNull();
      expect(pack.integrity?.signature?.signature).toContain("BEGIN SSH SIGNATURE");

      // Tamper the evidence → recomputed digest no longer matches.
      const tampered = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;
      (tampered["guardrails"] as { denyTools: string[] }).denyTools = [];
      expect(computePackDigest(tampered)).not.toBe(pack.integrity?.pack_digest);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
      fs.rmSync(keyDir, { recursive: true, force: true });
    }
  });

  it("CLI: agentboot evidence-pack writes the bundle", () => {
    const { hub, spoke } = mkHubWithSpoke();
    try {
      const out = path.join(hub, "evidence.json");
      // shell: true — the extensionless tsx shim is not directly spawnable on Windows
      const r = spawnSync(
        `"${TSX}" "${path.join(ROOT, "scripts", "cli.ts")}" evidence-pack --config "${path.join(hub, "agentboot.config.json")}" --out "${out}"`,
        { cwd: hub, shell: true, encoding: "utf-8", timeout: 120_000, stdio: "pipe" },
      );
      expect(r.status, r.stderr).toBe(0);
      const pack = JSON.parse(fs.readFileSync(out, "utf-8"));
      expect(pack.format).toBe("agentboot-evidence-pack");
      expect(pack.integrity.pack_digest).toHaveLength(64);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
    }
  });
});
