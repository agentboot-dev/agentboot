/**
 * I1 — the generated hooks read stdin with an unbounded `INPUT=$(cat)`.
 *
 * These hooks run on a developer's machine on every prompt and every tool call,
 * so an oversized payload is a memory/latency problem on the critical path.
 * The cap is generous (1 MiB); what matters is the ACTION at the boundary, and
 * that it is never silent.
 *
 * Per the standing norm each case asserts both directions — a cap that blocks
 * ordinary prompts is an outage, not a control.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let hooksDir = "";
let bash = "";

function findBash(): string {
  for (const c of ["bash", "C:\\Program Files\\Git\\bin\\bash.exe"]) {
    const r = spawnSync(c, ["--version"], { stdio: "pipe", timeout: 10_000 });
    if (r.status === 0) return c;
  }
  return "";
}

/** Run a hook with the given stdin. Status is read WITHOUT a pipe. */
function runHook(script: string, stdin: string, env: Record<string, string> = {}) {
  const r = spawnSync(bash, [path.join(hooksDir, script)], {
    input: stdin,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  bash = findBash();
  if (!bash) return; // asserted in the first test rather than silently skipping
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-i1-"));
  const hub = path.join(base, "hub");
  const r = spawnSync("node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.compliance = { ...(cfg.compliance ?? {}), inputScan: { enabled: true } };
  cfg.managed = { enabled: true, guardrails: { denyTools: ["WebFetch"] } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const b = spawnSync("node", [CLI, "build"], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
  hooksDir = path.join(hub, "dist", "claude", "core", "hooks");
}, 600_000);

const OVERSIZED = JSON.stringify({ prompt: "a".repeat(1_200_000), tool_name: "Read" });

describe("I1 — hook stdin size cap", () => {
  it("I1-0: bash is available and the hooks were emitted", () => {
    // A suite that skips itself when the interpreter is missing reports the same
    // green as one that ran. Assert the precondition instead.
    expect(bash, "no bash found — the hook tests cannot run").not.toBe("");
    for (const h of ["agentboot-input-scan.sh", "agentboot-pretooluse.sh", "agentboot-output-scan.sh"]) {
      expect(fs.existsSync(path.join(hooksDir, h)), h).toBe(true);
    }
  });

  it("I1-1 (NEGATIVE): an ordinary prompt is allowed — the cap is not an outage", () => {
    expect(runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "hello world" })).status).toBe(0);
  });

  it("I1-2 (NEGATIVE): the scanner still blocks a real secret", () => {
    // If the cap change had broken parsing, everything would pass and the DLP
    // gate would be gone. This is the assertion that catches that.
    const r = runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "api_key = AKIAABCDEFGHIJKLMNOP" }));
    expect(r.status).toBe(2);
  });

  it("I1-3: an oversized prompt FAILS CLOSED and says why", () => {
    const r = runHook("agentboot-input-scan.sh", OVERSIZED);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("exceeds the hook input limit");
    expect(r.stderr).toContain("cannot scan it in full");
  });

  it("I1-4: the PreToolUse deny hook also fails closed on an oversized payload", () => {
    const r = runHook("agentboot-pretooluse.sh", OVERSIZED);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("could not be inspected");
  });

  it("I1-5 (NEGATIVE): the PreToolUse hook still allows an ordinary non-denied tool", () => {
    expect(runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "Read" })).status).toBe(0);
  });

  it("I1-6: the Stop hook fails OPEN — but LOUDLY, never silently", () => {
    // A Stop hook that blocks on its own failure strands the session, so the
    // declared posture is fail-open. The requirement is that an unscanned
    // response cannot look like a clean one.
    const r = runHook("agentboot-output-scan.sh", OVERSIZED);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("output scan SKIPPED");
  });

  it("I1-7: the cap is an env-tunable decision, not a hard wall", () => {
    const r = runHook("agentboot-input-scan.sh", OVERSIZED, {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "5000000",
    });
    expect(r.status).toBe(0);
  });
});
