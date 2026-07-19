/**
 * Band D2: platform conformance test harness.
 *
 * B12 documented per-platform enforcement honesty; D2 makes it a TESTED
 * contract. The harness executes the compiled hook scripts with crafted
 * inputs (clean, secret-bearing, malformed, deny-listed tool, oversized) and
 * writes a per-platform enforcement manifest recording declared level vs
 * observed behavior. Untestable is reported as "untested", never "pass".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  PLATFORM_ENFORCEMENT,
  hookDirForPlatform,
  probeBash,
  runPlatformConformance,
  runConformance,
  type EnforcementManifest,
} from "../scripts/lib/conformance.js";
import { loadConfig } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

let tmpDir: string;
let hub: string;
let distPath: string;

const bashAvailable = probeBash() !== null;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-d2-"));
  hub = path.join(tmpDir, "hub");
  fs.mkdirSync(hub, { recursive: true });
  // Hub with enforcement fully exercised: deny-tools configured AND output
  // blocking enabled — the strictest posture, so every probe suite runs.
  fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
    org: "d2-conformance",
    personas: { enabled: ["code-reviewer"], outputFormats: ["claude", "copilot", "cursor"] },
    traits: { enabled: ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"] },
    instructions: { enabled: [] },
    compliance: { outputScan: { blocking: true } },
    managed: { guardrails: { denyTools: ["Bash*"] } },
  }, null, 2));
  execSync(`${TSX} scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`,
    { cwd: ROOT, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });
  distPath = path.join(hub, "dist");
}, 240_000);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("D2: enforcement classification SSOT", () => {
  it("declares a level for every supported platform", () => {
    for (const platform of ["claude", "codex", "copilot", "cursor", "gemini", "windsurf", "jetbrains", "agents", "skill"]) {
      expect(PLATFORM_ENFORCEMENT[platform], platform).toBeDefined();
      expect(["enforced", "partial", "fail-open", "advisory"]).toContain(PLATFORM_ENFORCEMENT[platform]!.level);
    }
  });

  it("maps hook directories only for platforms that actually have hooks", () => {
    expect(hookDirForPlatform("/d", "claude")).toBe(path.join("/d", "claude", "core", "hooks"));
    expect(hookDirForPlatform("/d", "copilot")).toBe(path.join("/d", "copilot", "core", ".github", "hooks"));
    expect(hookDirForPlatform("/d", "codex")).toBe(path.join("/d", "codex", "core", ".codex", "hooks"));
    expect(hookDirForPlatform("/d", "plugin")).toBe(path.join("/d", "plugin", "hooks"));
    for (const advisory of ["cursor", "gemini", "windsurf", "jetbrains", "agents", "skill"]) {
      expect(hookDirForPlatform("/d", advisory), advisory).toBeNull();
    }
  });
});

describe("D2: honesty guarantees", () => {
  it("advisory platforms report not-applicable, never pass", () => {
    const config = loadConfig(path.join(hub, "agentboot.config.json"));
    const manifest = runPlatformConformance(distPath, "cursor", config, "0.0.0", probeBash());
    expect(manifest.declared.level).toBe("advisory");
    for (const c of manifest.controls) {
      expect(c.status, c.control).toBe("not-applicable");
      expect(c.probes).toEqual([]);
    }
  });

  it("without bash, hook controls are UNTESTED with a reason — never assumed to pass", () => {
    const config = loadConfig(path.join(hub, "agentboot.config.json"));
    const manifest = runPlatformConformance(distPath, "claude", config, "0.0.0", null);
    const inputScan = manifest.controls.find((c) => c.control === "input-scan")!;
    expect(inputScan.status).toBe("untested");
    expect(inputScan.reason).toContain("bash not available");
  });

  it("a missing hook script is UNTESTED, not skipped silently", () => {
    const emptyDist = fs.mkdtempSync(path.join(tmpDir, "empty-dist-"));
    fs.mkdirSync(path.join(emptyDist, "claude", "core", "hooks"), { recursive: true });
    const config = loadConfig(path.join(hub, "agentboot.config.json"));
    const manifest = runPlatformConformance(emptyDist, "claude", config, "0.0.0", probeBash());
    const inputScan = manifest.controls.find((c) => c.control === "input-scan")!;
    expect(inputScan.status).toBe("untested");
    expect(inputScan.reason).toContain("not present in dist");
  });
});

describe.skipIf(!bashAvailable)("D2: behavioral probes against compiled hooks", () => {
  let claude: EnforcementManifest;

  beforeAll(() => {
    const config = loadConfig(path.join(hub, "agentboot.config.json"));
    claude = runPlatformConformance(distPath, "claude", config, "0.0.0", probeBash());
  }, 120_000);

  it("input-scan: clean passes, secret blocks, malformed guarded, oversized bounded", () => {
    const c = claude.controls.find((x) => x.control === "input-scan")!;
    expect(c.status, JSON.stringify(c.probes, null, 2)).toBe("pass");
    expect(c.probes.map((p) => p.probe)).toContain("secret-bearing input BLOCKS");
  });

  it("output-scan: blocking mode enforces exit 2 on secrets", () => {
    const c = claude.controls.find((x) => x.control === "output-scan")!;
    expect(c.status, JSON.stringify(c.probes, null, 2)).toBe("pass");
    const secretProbe = c.probes.find((p) => p.probe.includes("BLOCKS"))!;
    expect(secretProbe.expected).toContain("exit 2");
    expect(secretProbe.pass).toBe(true);
  });

  it("deny-tools: deny-listed tool blocks, others pass", () => {
    const c = claude.controls.find((x) => x.control === "deny-tools")!;
    expect(c.status, JSON.stringify(c.probes, null, 2)).toBe("pass");
    expect(c.probes.some((p) => p.probe.includes("BLOCKS"))).toBe(true);
  });

  it("telemetry: records the event without blocking", () => {
    const c = claude.controls.find((x) => x.control === "telemetry")!;
    expect(c.status, JSON.stringify(c.probes, null, 2)).toBe("pass");
  });

  it("copilot hooks behave identically at the script level (fail-open is a PLATFORM property)", () => {
    const config = loadConfig(path.join(hub, "agentboot.config.json"));
    const copilot = runPlatformConformance(distPath, "copilot", config, "0.0.0", probeBash());
    expect(copilot.declared.level).toBe("fail-open");
    const inputScan = copilot.controls.find((x) => x.control === "input-scan")!;
    expect(inputScan.status).toBe("pass");
  });

  it("warn-only output scan (blocking disabled) expects warning, not block", () => {
    // Separate hub without blocking to exercise the warn-only expectation path
    const warnHub = path.join(tmpDir, "warn-hub");
    fs.mkdirSync(warnHub, { recursive: true });
    fs.writeFileSync(path.join(warnHub, "agentboot.config.json"), JSON.stringify({
      org: "d2-warn",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
      traits: { enabled: ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"] },
      instructions: { enabled: [] },
    }, null, 2));
    execSync(`${TSX} scripts/compile.ts --config ${path.join(warnHub, "agentboot.config.json")}`,
      { cwd: ROOT, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });
    const config = loadConfig(path.join(warnHub, "agentboot.config.json"));
    const manifest = runPlatformConformance(path.join(warnHub, "dist"), "claude", config, "0.0.0", probeBash());
    const outputScan = manifest.controls.find((x) => x.control === "output-scan")!;
    expect(outputScan.status, JSON.stringify(outputScan.probes, null, 2)).toBe("pass");
    expect(outputScan.probes.some((p) => p.probe.includes("WARNS"))).toBe(true);
  }, 240_000);
});

describe("D2: enforcement manifests in artifacts", () => {
  it("runConformance writes dist/<platform>/enforcement-manifest.json for each platform", () => {
    const config = loadConfig(path.join(hub, "agentboot.config.json"));
    const run = runConformance(distPath, ["claude", "copilot", "cursor"], config, "1.2.3");
    expect(run.manifests).toHaveLength(3);
    for (const platform of ["claude", "copilot", "cursor"]) {
      const manifestPath = path.join(distPath, platform, "enforcement-manifest.json");
      expect(fs.existsSync(manifestPath), platform).toBe(true);
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(m.platform).toBe(platform);
      expect(m.agentboot_version).toBe("1.2.3");
      expect(m.declared.level).toBe(PLATFORM_ENFORCEMENT[platform]!.level);
      expect(Array.isArray(m.controls)).toBe(true);
    }
    if (bashAvailable) {
      expect(run.failedPlatforms).toEqual([]);
    }
  });

  it("CLI: agentboot conformance --format json exits 0 with no failed platforms", () => {
    const cli = path.join(ROOT, "scripts", "cli.ts");
    const r = spawnSync(TSX, [cli, "conformance", "--format", "json"], {
      cwd: hub, encoding: "utf-8", timeout: 120_000, stdio: "pipe",
      env: { ...process.env, AGENTBOOT_HUB: hub },
    });
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.failedPlatforms).toEqual([]);
    expect(parsed.manifests.length).toBeGreaterThan(0);
  }, 180_000);
});
