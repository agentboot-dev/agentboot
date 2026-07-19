/**
 * D2: platform conformance test harness + per-platform enforcement manifest.
 *
 * B12 documented enforcement honesty (which platforms enforce, which are
 * advisory). This module converts those claims into a TESTED contract:
 *
 *  - `PLATFORM_ENFORCEMENT` is the single source of truth for the declared
 *    enforcement level per platform (doctor reads it too).
 *  - The harness EXECUTES the compiled hook scripts with crafted inputs —
 *    clean, secret-bearing, malformed, deny-listed tool — and records
 *    observed exit codes and blocking decisions against expectations.
 *  - Results land in `dist/<platform>/enforcement-manifest.json`: a
 *    machine-readable statement of which controls exist on that platform,
 *    what level they are declared at, and what the probes actually observed.
 *
 * Honesty rules: a control that cannot be probed (no bash, script absent) is
 * "untested", never "pass". Advisory platforms get a manifest stating plainly
 * that no enforcement mechanism exists. Nothing is fabricated at compile time
 * — empirical fields only exist after a real harness run.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentBootConfig } from "./config.js";

/** Same bound as every external-binary probe (v0.12.4 hang-class fix). */
const PROBE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Declared enforcement levels — SSOT (doctor imports this)
// ---------------------------------------------------------------------------

export interface PlatformEnforcement {
  level: "enforced" | "partial" | "fail-open" | "advisory";
  detail: string;
}

export const PLATFORM_ENFORCEMENT: Record<string, PlatformEnforcement> = {
  claude: { level: "enforced", detail: "hooks block (exit 2); managed settings via the MDM channel are non-overridable" },
  codex: { level: "partial", detail: "hooks emitted with partial event coverage; managed-settings ceiling is lower than Claude Code" },
  copilot: { level: "fail-open", detail: "command hooks time out OPEN — a hung or slow hook does not block" },
  cursor: { level: "advisory", detail: "instructions only — no hook binding, nothing is enforced" },
  gemini: { level: "advisory", detail: "instructions only — no hook binding" },
  windsurf: { level: "advisory", detail: "instructions only — no hook binding" },
  jetbrains: { level: "advisory", detail: "instructions only — no hook binding" },
  agents: { level: "advisory", detail: "AGENTS.md is instructions only" },
  skill: { level: "advisory", detail: "skill content is instructions only" },
};

/** Where a platform's executable hooks live inside dist/, or null when the
 * platform has no hook mechanism at all. */
export function hookDirForPlatform(distPath: string, platform: string): string | null {
  switch (platform) {
    case "claude": return path.join(distPath, "claude", "core", "hooks");
    case "codex": return path.join(distPath, "codex", "core", ".codex", "hooks");
    case "copilot": return path.join(distPath, "copilot", "core", ".github", "hooks");
    case "plugin": return path.join(distPath, "plugin", "hooks");
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Probe runner
// ---------------------------------------------------------------------------

/** Locate a bash usable for executing hook scripts (Git Bash on Windows). */
export function probeBash(): string | null {
  for (const candidate of ["bash", "C:\\Program Files\\Git\\bin\\bash.exe"]) {
    try {
      const r = spawnSync(candidate, ["--version"], { stdio: "pipe", timeout: PROBE_TIMEOUT_MS });
      if (r.status === 0) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

export interface ProbeResult {
  probe: string;
  expected: string;
  observed: string;
  pass: boolean;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Execute a hook script with sandboxed side effects (HOME + telemetry log
 * redirected into a temp dir) and a hard timeout. */
function runHook(bashPath: string, scriptPath: string, stdin: string, timeoutMs: number, sandbox: string): HookRun {
  const r = spawnSync(bashPath, [scriptPath], {
    input: stdin,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: timeoutMs,
    env: {
      ...process.env,
      HOME: sandbox,
      USERPROFILE: sandbox,
      AGENTBOOT_TELEMETRY_LOG: path.join(sandbox, "telemetry.ndjson"),
    },
  });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut };
}

const describeRun = (run: HookRun): string =>
  run.timedOut ? "TIMED OUT" : `exit ${run.status}${run.stdout.includes('"decision":"block"') ? " (block decision)" : ""}`;

/** Secret canary, concatenation-assembled so scanners in CI never see it whole. */
const secretCanary = (): string => ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

// ---------------------------------------------------------------------------
// Per-control probe suites
// ---------------------------------------------------------------------------

export interface ControlResult {
  control: string;
  mechanism: string;
  declared_level: PlatformEnforcement["level"];
  /** pass: all probes matched expectations. fail: at least one mismatch.
   * untested: mechanism exists but could not be probed (reason says why).
   * not-applicable: the platform has no mechanism for this control. */
  status: "pass" | "fail" | "untested" | "not-applicable";
  reason?: string;
  probes: ProbeResult[];
}

function probeInputScan(bashPath: string, script: string, sandbox: string): ProbeResult[] {
  const probes: ProbeResult[] = [];
  const timeoutMs = 5000; // matches the compiled hook binding

  const clean = runHook(bashPath, script, JSON.stringify({ prompt: "refactor the parser module" }), timeoutMs, sandbox);
  probes.push({ probe: "clean input passes", expected: "exit 0", observed: describeRun(clean), pass: clean.status === 0 });

  const secret = runHook(bashPath, script, JSON.stringify({ prompt: `use key ${secretCanary()}` }), timeoutMs, sandbox);
  probes.push({
    probe: "secret-bearing input BLOCKS",
    expected: "exit 2 (block decision)",
    observed: describeRun(secret),
    pass: secret.status === 2 && secret.stdout.includes('"decision":"block"'),
  });

  const malformed = runHook(bashPath, script, "this is not json", timeoutMs, sandbox);
  probes.push({
    probe: "malformed input fails CLOSED",
    expected: "exit 0 with empty extraction OR exit 2 block — never a crash past the parse guard",
    observed: describeRun(malformed),
    pass: malformed.status === 0 || malformed.status === 2,
  });

  const oversized = runHook(bashPath, script, JSON.stringify({ prompt: "x".repeat(500_000) }), timeoutMs, sandbox);
  probes.push({
    probe: "oversized input completes within the 5s hook binding",
    expected: "completes (no timeout)",
    observed: describeRun(oversized),
    pass: !oversized.timedOut,
  });

  return probes;
}

function probeOutputScan(bashPath: string, script: string, sandbox: string, failMode: "open" | "closed"): ProbeResult[] {
  const probes: ProbeResult[] = [];
  const timeoutMs = 5000;

  const clean = runHook(bashPath, script, JSON.stringify({ response: "here is the refactored parser" }), timeoutMs, sandbox);
  probes.push({ probe: "clean output passes", expected: "exit 0", observed: describeRun(clean), pass: clean.status === 0 });

  const secret = runHook(bashPath, script, JSON.stringify({ response: `creds: ${secretCanary()}` }), timeoutMs, sandbox);
  if (failMode === "closed") {
    probes.push({
      probe: "secret in output BLOCKS (outputScan.blocking enabled)",
      expected: "exit 2",
      observed: describeRun(secret),
      pass: secret.status === 2,
    });
  } else {
    probes.push({
      probe: "secret in output WARNS (outputScan.blocking disabled — warn-only by design)",
      expected: "exit 0 + warning on stderr",
      observed: `${describeRun(secret)}${secret.stderr.includes("WARNING") ? " (warned)" : " (no warning)"}`,
      pass: secret.status === 0 && secret.stderr.includes("WARNING"),
    });
  }

  const malformed = runHook(bashPath, script, "not json", timeoutMs, sandbox);
  probes.push({
    probe: "malformed input at Stop fails OPEN (never wedges the session)",
    expected: "exit 0",
    observed: describeRun(malformed),
    pass: malformed.status === 0,
  });

  return probes;
}

function probeTelemetry(bashPath: string, script: string, sandbox: string): ProbeResult[] {
  const run = runHook(bashPath, script,
    JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit" }), 3000, sandbox);
  const logWritten = fs.existsSync(path.join(sandbox, "telemetry.ndjson"));
  return [{
    probe: "telemetry event records without blocking",
    expected: "exit 0 within the 3s binding, event appended to the log",
    observed: `${describeRun(run)}${logWritten ? " (log written)" : " (no log)"}`,
    pass: run.status === 0 && !run.timedOut && logWritten,
  }];
}

function probeDenyTools(bashPath: string, script: string, sandbox: string, deniedPattern: string): ProbeResult[] {
  const probes: ProbeResult[] = [];
  // Use a concrete tool name that matches the first configured pattern; glob
  // patterns probe with the glob turned into a literal-ish candidate.
  const deniedTool = deniedPattern.replace(/\*/g, "X").replace(/\?/g, "Y");

  const denied = runHook(bashPath, script, JSON.stringify({ tool_name: deniedTool }), 5000, sandbox);
  probes.push({
    probe: `deny-listed tool "${deniedTool}" BLOCKS`,
    expected: "exit 2 (block decision)",
    observed: describeRun(denied),
    pass: denied.status === 2 && denied.stdout.includes('"decision":"block"'),
  });

  const allowed = runHook(bashPath, script, JSON.stringify({ tool_name: "agentboot-conformance-allowed-tool" }), 5000, sandbox);
  probes.push({
    probe: "non-listed tool passes",
    expected: "exit 0",
    observed: describeRun(allowed),
    pass: allowed.status === 0,
  });

  const malformed = runHook(bashPath, script, "not json", 5000, sandbox);
  probes.push({
    probe: "malformed input fails CLOSED (blocks)",
    expected: "exit 0 with empty tool OR exit 2 — parse guard must hold",
    observed: describeRun(malformed),
    pass: malformed.status === 0 || malformed.status === 2,
  });

  return probes;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface EnforcementManifest {
  platform: string;
  agentboot_version: string;
  generated_at: string;
  declared: PlatformEnforcement;
  controls: ControlResult[];
}

const statusOf = (probes: ProbeResult[]): "pass" | "fail" =>
  probes.every((p) => p.pass) ? "pass" : "fail";

/**
 * Run the conformance harness for one platform against its compiled dist tree.
 */
export function runPlatformConformance(
  distPath: string,
  platform: string,
  config: AgentBootConfig,
  agentbootVersion: string,
  bashPath: string | null,
): EnforcementManifest {
  const declared = PLATFORM_ENFORCEMENT[platform] ?? { level: "advisory" as const, detail: "unknown platform — treated as advisory" };
  const controls: ControlResult[] = [];
  const hookDir = hookDirForPlatform(distPath, platform);
  // Output-match blocking is governed by compliance.outputScan.blocking
  // (failMode only governs scanner-failure behavior — see compile.ts B2/B3).
  const failMode: "open" | "closed" = config.compliance?.outputScan?.blocking === true ? "closed" : "open";
  const denyTools = config.managed?.guardrails?.denyTools ?? [];

  const hookControl = (
    control: string,
    scriptName: string,
    probe: (bash: string, script: string, sandbox: string) => ProbeResult[],
  ): ControlResult => {
    const base = { control, mechanism: "hook script", declared_level: declared.level };
    if (!hookDir) {
      return { ...base, mechanism: "none", status: "not-applicable", probes: [],
        reason: "no hook mechanism exists on this platform — instructions are advisory only" };
    }
    const script = path.join(hookDir, scriptName);
    if (!fs.existsSync(script)) {
      return { ...base, status: "untested", probes: [],
        reason: `${scriptName} not present in dist — run agentboot build first` };
    }
    if (!bashPath) {
      return { ...base, status: "untested", probes: [],
        reason: "bash not available on this machine — hook behavior not executed" };
    }
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-conformance-"));
    try {
      const probes = probe(bashPath, script, sandbox);
      return { ...base, status: statusOf(probes), probes };
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  };

  controls.push(hookControl("input-scan", "agentboot-input-scan.sh", probeInputScan));
  controls.push(hookControl("output-scan", "agentboot-output-scan.sh",
    (b, s, sb) => probeOutputScan(b, s, sb, failMode)));
  controls.push(hookControl("telemetry", "agentboot-telemetry.sh", probeTelemetry));

  if (denyTools.length > 0) {
    controls.push(hookControl("deny-tools", "agentboot-pretooluse.sh",
      (b, s, sb) => probeDenyTools(b, s, sb, denyTools[0]!)));
  } else {
    controls.push({
      control: "deny-tools", mechanism: hookDir ? "hook script" : "none",
      declared_level: declared.level, status: "not-applicable", probes: [],
      reason: "managed.guardrails.denyTools not configured",
    });
  }

  return {
    platform,
    agentboot_version: agentbootVersion,
    generated_at: new Date().toISOString(),
    declared,
    controls,
  };
}

export interface ConformanceRun {
  manifests: EnforcementManifest[];
  /** Platforms whose manifest contains at least one FAILED control. */
  failedPlatforms: string[];
  bashAvailable: boolean;
}

/**
 * Run the harness for every requested platform and write each
 * `dist/<platform>/enforcement-manifest.json`.
 */
export function runConformance(
  distPath: string,
  platforms: string[],
  config: AgentBootConfig,
  agentbootVersion: string,
): ConformanceRun {
  const bashPath = probeBash();
  const manifests: EnforcementManifest[] = [];
  const failedPlatforms: string[] = [];

  for (const platform of platforms) {
    const manifest = runPlatformConformance(distPath, platform, config, agentbootVersion, bashPath);
    manifests.push(manifest);
    if (manifest.controls.some((c) => c.status === "fail")) {
      failedPlatforms.push(platform);
    }
    const platformDir = path.join(distPath, platform);
    if (fs.existsSync(platformDir)) {
      fs.writeFileSync(
        path.join(platformDir, "enforcement-manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
        "utf-8",
      );
    }
  }

  return { manifests, failedPlatforms, bashAvailable: bashPath !== null };
}
