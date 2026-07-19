/**
 * Band D6: sync-PR provenance + risk summaries + verifiable artifact manifests.
 *
 * Generated config is security-sensitive — it carries enforcement (hooks,
 * managed settings, MCP config), not just prompt content. Therefore:
 *  - the sync manifest records WHAT produced it (hub commit, AgentBoot
 *    version, config + policy-exception hashes),
 *  - the manifest is tamper-evident (content digest; SSH signature when the
 *    hub configures a signing key),
 *  - the sync PR body carries provenance and a risk-classified change summary
 *    instead of the string "Automated AgentBoot sync",
 *  - `agentboot verify-manifest` checks all of it after the fact.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  collectHubProvenance,
  classifySyncRisk,
  buildRiskSummary,
  computeManifestDigest,
  signManifestDigest,
  verifyManifestFile,
  buildSyncPrBody,
  MANIFEST_SIG_NAMESPACE,
  type HubProvenance,
} from "../scripts/lib/provenance.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-d6-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf-8", timeout: 15_000 }).trim();
}

const sshKeygenAvailable = (() => {
  try {
    const r = spawnSync("ssh-keygen", ["-h"], { stdio: "pipe", timeout: 10_000 });
    return r.error === undefined; // -h exits non-zero but proves the binary exists
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Unit: provenance collection
// ---------------------------------------------------------------------------

describe("D6: hub provenance", () => {
  it("records the hub HEAD commit, dirty flag, and config/exceptions hashes", () => {
    const hub = fs.mkdtempSync(path.join(tmpDir, "prov-hub-"));
    fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({ org: "p" }));
    fs.writeFileSync(path.join(hub, "agentboot-exceptions.json"), JSON.stringify({ exceptions: [] }));
    git(hub, "init -q");
    git(hub, "config user.email d6@test.local");
    git(hub, "config user.name d6");
    git(hub, "add -A");
    git(hub, 'commit -q -m init');

    const clean = collectHubProvenance(hub, "9.9.9");
    expect(clean.agentboot_version).toBe("9.9.9");
    expect(clean.hub_commit).toBe(git(hub, "rev-parse HEAD"));
    expect(clean.hub_dirty).toBe(false);
    expect(clean.config_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(clean.exceptions_hash).toMatch(/^[0-9a-f]{64}$/);

    fs.writeFileSync(path.join(hub, "uncommitted.md"), "drift");
    expect(collectHubProvenance(hub, "9.9.9").hub_dirty).toBe(true);
  });

  it("degrades to null commit outside a git repo", () => {
    const notARepo = fs.mkdtempSync(path.join(tmpDir, "prov-plain-"));
    const p = collectHubProvenance(notARepo, "1.0.0");
    expect(p.hub_commit).toBeNull();
    expect(p.config_hash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit: risk classification
// ---------------------------------------------------------------------------

describe("D6: change-risk classification", () => {
  it("classifies enforcement-affecting files as enforcement", () => {
    for (const f of [
      ".claude/hooks/scan-secrets.sh",
      ".claude/settings.json",
      "managed-settings.json",
      ".claude/managed-settings.d/10-org.json",
      ".mcp.json",
      "hooks/hooks.json",
      ".github/hooks/block-output.ps1",
    ]) {
      expect(classifySyncRisk(f), f).toBe("enforcement");
    }
  });

  it("classifies wiring as config and prompts as content", () => {
    expect(classifySyncRisk(".claude/.agentboot-manifest.json")).toBe("config");
    expect(classifySyncRisk(".claude-plugin/plugin.json")).toBe("config");
    expect(classifySyncRisk(".claude/skills/code-reviewer/SKILL.md")).toBe("content");
    expect(classifySyncRisk("CLAUDE.md")).toBe("content");
  });

  it("buildRiskSummary flags security-sensitive change sets", () => {
    const flagged = buildRiskSummary([".claude/hooks/x.sh", "CLAUDE.md"]);
    expect(flagged.securitySensitive).toBe(true);
    expect(flagged.enforcement).toEqual([".claude/hooks/x.sh"]);
    const benign = buildRiskSummary(["CLAUDE.md", ".claude/skills/a/SKILL.md"]);
    expect(benign.securitySensitive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit: digest + PR body
// ---------------------------------------------------------------------------

describe("D6: manifest digest", () => {
  const base = {
    managed_by: "agentboot", version: "1.0.0", synced_at: "t",
    scope: { group: null, team: null },
    files: [{ path: "a.md", hash: "aa" }],
    provenance: { agentboot_version: "1.0.0" },
  };

  it("is stable under key reordering and excludes the integrity field", () => {
    const reordered = { files: base.files, version: base.version, synced_at: base.synced_at,
      provenance: base.provenance, scope: base.scope, managed_by: base.managed_by,
      integrity: { algorithm: "sha256", manifest_digest: "whatever" } };
    expect(computeManifestDigest(reordered as never)).toBe(computeManifestDigest(base as never));
  });

  it("changes when file hashes change", () => {
    const tampered = { ...base, files: [{ path: "a.md", hash: "bb" }] };
    expect(computeManifestDigest(tampered as never)).not.toBe(computeManifestDigest(base as never));
  });
});

describe("D6: sync-PR body", () => {
  const provenance: HubProvenance = {
    agentboot_version: "1.2.3",
    hub_commit: "abc123def4567890",
    hub_dirty: false,
    config_hash: "c".repeat(64),
    exceptions_hash: null,
    generated_at: "2026-07-18T00:00:00Z",
  };

  it("carries provenance, calls out enforcement files, and points at verify-manifest", () => {
    const body = buildSyncPrBody({
      provenance,
      filesWritten: [".claude/hooks/scan.sh", ".claude/skills/a/SKILL.md", ".claude/.agentboot-manifest.json"],
      manifestPaths: [".claude/.agentboot-manifest.json"],
      signed: true,
    });
    expect(body).toContain("v1.2.3");
    expect(body).toContain("abc123def456"); // short hub commit
    expect(body).toContain("Enforcement-affecting");
    expect(body).toContain(".claude/hooks/scan.sh");
    expect(body).toContain("SSH-signed");
    expect(body).toContain("verify-manifest");
    expect(body).not.toContain("Automated AgentBoot sync");
  });

  it("says so plainly when nothing enforcement-affecting changed, and flags a dirty hub", () => {
    const body = buildSyncPrBody({
      provenance: { ...provenance, hub_dirty: true },
      filesWritten: [".claude/skills/a/SKILL.md"],
      manifestPaths: [".claude/.agentboot-manifest.json"],
      signed: false,
    });
    expect(body).toContain("No enforcement-affecting changes");
    expect(body).toContain("dirty working tree");
    expect(body).toContain("unsigned");
  });
});

// ---------------------------------------------------------------------------
// E2E: compile → sync → manifest carries provenance + integrity → verify
// ---------------------------------------------------------------------------

describe("D6 E2E: synced manifest is provenance-carrying and tamper-evident", () => {
  let hub: string;
  let spoke: string;
  let manifestPath: string;

  beforeAll(() => {
    hub = fs.mkdtempSync(path.join(tmpDir, "e2e-hub-"));
    spoke = fs.mkdtempSync(path.join(tmpDir, "e2e-spoke-"));
    fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
      org: "d6-e2e",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
      traits: { enabled: ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"] },
      instructions: { enabled: [] },
    }, null, 2));
    fs.writeFileSync(path.join(hub, "repos.json"),
      JSON.stringify([{ path: spoke, label: "e2e-spoke", platform: "claude" }]));
    git(hub, "init -q");
    git(hub, "config user.email d6@test.local");
    git(hub, "config user.name d6");
    git(hub, "add -A");
    git(hub, 'commit -q -m "hub init"');

    execSync(`${TSX} scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`,
      { cwd: ROOT, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });
    execSync(`${TSX} scripts/sync.ts --config ${path.join(hub, "agentboot.config.json")}`,
      { cwd: ROOT, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });
    manifestPath = path.join(spoke, ".claude", ".agentboot-manifest.json");
  }, 240_000);

  it("manifest records hub commit, config hash, and a content digest", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.provenance.hub_commit).toBe(git(hub, "rev-parse HEAD"));
    expect(manifest.provenance.config_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.provenance.agentboot_version).toBe(manifest.version);
    expect(manifest.integrity.algorithm).toBe("sha256");
    expect(manifest.integrity.manifest_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verify-manifest passes on the untouched spoke", () => {
    const v = verifyManifestFile(manifestPath, spoke);
    expect(v.digestOk).toBe(true);
    expect(v.fileMismatches).toEqual([]);
    expect(v.signatureOk).toBeNull(); // signing not configured in this hub
  });

  it("detects a tampered synced file and a tampered manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const victim = (manifest.files as Array<{ path: string }>).find(f => f.path.endsWith("SKILL.md"))!;
    const victimAbs = path.join(spoke, victim.path);
    const original = fs.readFileSync(victimAbs, "utf-8");
    try {
      fs.appendFileSync(victimAbs, "\ninjected line\n");
      const v = verifyManifestFile(manifestPath, spoke);
      expect(v.digestOk).toBe(true); // manifest itself untouched
      expect(v.fileMismatches.map(m => m.path)).toContain(victim.path);
    } finally {
      fs.writeFileSync(victimAbs, original);
    }

    // Tamper the manifest itself (e.g. hide a file entry) → digest mismatch
    const tampered = { ...manifest, files: (manifest.files as unknown[]).slice(1) };
    const tamperedPath = path.join(spoke, ".claude", "tampered-manifest.json");
    fs.writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));
    const v2 = verifyManifestFile(tamperedPath, spoke);
    expect(v2.digestOk).toBe(false);
  });

  it.skipIf(!sshKeygenAvailable)("signing: signed manifest verifies end-to-end", () => {
    const keyPath = path.join(tmpDir, "signing-key");
    execSync(`ssh-keygen -q -t ed25519 -N "" -f "${keyPath}"`, { timeout: 15_000 });

    // Enable signing in the hub config and re-sync
    const configPath = path.join(hub, "agentboot.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.sync = { signing: { enabled: true, sshKeyPath: keyPath } };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    git(hub, "add -A");
    git(hub, 'commit -q -m "enable signing"');
    execSync(`${TSX} scripts/sync.ts --config ${configPath} --force`,
      { cwd: ROOT, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.integrity.signature.format).toBe("ssh");
    expect(manifest.integrity.signature.namespace).toBe(MANIFEST_SIG_NAMESPACE);
    expect(manifest.integrity.signature.signature).toContain("BEGIN SSH SIGNATURE");
    expect(manifest.integrity.signature.signer_public_key).toContain("ssh-ed25519");

    const v = verifyManifestFile(manifestPath, spoke);
    expect(v.digestOk).toBe(true);
    expect(v.signatureOk).toBe(true);
  }, 240_000);

  it("CLI: agentboot verify-manifest exits 0 on a clean spoke and 1 on tamper", () => {
    const cli = path.join(ROOT, "scripts", "cli.ts");
    // shell: true — the extensionless tsx shim is not directly spawnable on Windows
    const runCli = () => spawnSync(`"${TSX}" "${cli}" verify-manifest --repo "${spoke}"`,
      { shell: true, encoding: "utf-8", timeout: 60_000, stdio: "pipe" });
    const clean = runCli();
    expect(clean.stdout).toContain("Content digest OK");
    expect(clean.status).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const victim = (manifest.files as Array<{ path: string }>).find(f => f.path.endsWith("SKILL.md"))!;
    const victimAbs = path.join(spoke, victim.path);
    const original = fs.readFileSync(victimAbs, "utf-8");
    try {
      fs.appendFileSync(victimAbs, "\ntamper\n");
      const dirty = runCli();
      expect(dirty.status).toBe(1);
      expect(dirty.stdout).toContain("differ from the manifest");
    } finally {
      fs.writeFileSync(victimAbs, original);
    }
  }, 120_000);

  it.skipIf(!sshKeygenAvailable)("signing helper round-trips and fails loudly on a missing key", () => {
    const keyPath = path.join(tmpDir, "signing-key"); // created above
    const digest = "d".repeat(64);
    const signed = signManifestDigest(digest, keyPath);
    expect("signature" in signed).toBe(true);

    const missing = signManifestDigest(digest, path.join(tmpDir, "no-such-key"));
    expect("error" in missing && missing.error).toContain("not found");
  });
});
