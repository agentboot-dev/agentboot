/**
 * R2-1 — the MCP surface trusted a stale `dist/`.
 *
 * N1's rule: a failed build leaves the previous `dist/` byte-identical, so file
 * presence is not evidence of current policy. Every CLI consumer was taught to
 * refuse or to report. The MCP server was not, because
 * `tests/dist-consumer-invariant.test.ts` derives the consumer set by parsing
 * `scripts/cli.ts`, and the `mcp-server` command block is a nine-line
 * subprocess dispatch with no dist/ token in it. The invariant written because
 * "two lists that must agree will drift" was itself derived from one file.
 *
 * Measured on a scaffolded hub whose build had just FAILED, same hub, same
 * moment (this file re-runs it):
 *
 *     agentboot status              EXIT 1   "Last build: … — FAILED"
 *     agentboot audit               EXIT 1   refuses
 *     MCP agentboot_status                   {"lastBuiltAt":"<PREVIOUS BUILD>"}
 *     MCP agentboot_doctor                   {"issues":[],"allClear":true}
 *     MCP agentboot_list_personas            {"source":"dist"}
 *
 * `lastBuiltAt` was `fs.statSync(dist/).mtime` — the timestamp of the last
 * SUCCESSFUL build, printed unchanged after a failed one, which is the exact
 * thing DIST_CONSUMERS.status's posture forbids in words. And the consumer is
 * an agent, which is handed `source: "dist"` and reads it as "current policy".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Status read WITHOUT a pipe — a piped $? is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Build the scaffolded hub EXPLICITLY, and make a failure say what happened.
 *
 * `agentboot install` runs a build itself — but through
 * `spawnSync("agentboot", ["build"])`, a BARE command name resolved off PATH.
 * On a machine with a global install that resolves; under CI's `npm ci` there
 * is no global `agentboot`, so the spawn fails ENOENT, install discards
 * `result.error`/`status`/stdout/stderr behind one yellow line, and STILL
 * EXITS 0 over a hub with no `dist/` at all. This suite then died on a raw
 * `ENOENT … dist/.agentboot-build.json` from `fs.readFileSync` — a stack trace
 * about a missing file, naming nothing about the build that never ran.
 *
 * So the scaffold no longer trusts install's internal build. It drives the
 * build through the same PATH-independent `bin/agentboot.js` every other
 * assertion here uses, and when it fails it reports the exit status and
 * carries the output — including the case where there was no output, which is
 * itself the finding rather than something to interpolate into an empty gap.
 *
 * The freshness assertion this replaces is KEPT, not relaxed: the stamp must
 * still exist and still say `success`, or the positive cases below would be
 * passing against a superseded tree.
 */
function buildHubOrExplain(hubDir: string): void {
  const b = ab(["build"], hubDir);
  const shown = b.out.trim() || "(the build produced no output on stdout or stderr)";
  if (b.status !== 0) {
    throw new Error(
      `scaffold build FAILED: \`agentboot build\` exited ${b.status} in ${hubDir}\n` +
        `--- build output ---\n${shown}\n--- end build output ---`,
    );
  }
  const stampPath = path.join(hubDir, "dist", ".agentboot-build.json");
  if (!fs.existsSync(stampPath)) {
    const distState = fs.existsSync(path.join(hubDir, "dist"))
      ? "dist/ exists but carries no build stamp"
      : "dist/ was never created";
    throw new Error(
      `scaffold build exited 0 but left no usable dist/: ${distState} (${stampPath})\n` +
        `--- build output ---\n${shown}\n--- end build output ---`,
    );
  }
  const stamp = JSON.parse(fs.readFileSync(stampPath, "utf-8")) as { status?: string };
  if (stamp.status !== "success") {
    throw new Error(
      `scaffold build exited 0 but stamped status=${String(stamp.status)} — ` +
        `the positive cases below would pass against a superseded tree.\n` +
        `--- build output ---\n${shown}\n--- end build output ---`,
    );
  }
}

/** Drive one MCP tool call over stdio and return the parsed tool payload. */
function mcp(tool: string, hubDir: string): Record<string, unknown> {
  const req =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    }) +
    "\n" +
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: {} },
    }) +
    "\n";
  const r = spawnSync(process.execPath, [CLI, "mcp-server"], {
    cwd: hubDir,
    input: req,
    env: { ...process.env, NODE_NO_WARNINGS: "1", AGENTBOOT_HUB: hubDir },
    encoding: "utf-8",
    timeout: 300_000,
  });
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const msg = JSON.parse(line) as {
        id?: number;
        result?: { content?: Array<{ text?: string }> };
      };
      if (msg.id === 2 && msg.result?.content?.[0]?.text) {
        return JSON.parse(msg.result.content[0].text!) as Record<string, unknown>;
      }
    } catch {
      /* not the frame we want */
    }
  }
  throw new Error(`no MCP result for ${tool}: ${r.stdout}${r.stderr}`);
}

let base: string;
let hub: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-mcp-fresh-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);
  // install exits 0 whether or not its internal build ran, so build here and
  // confirm the starting point is a SUCCESS stamp — the positive assertions
  // below must not be passing for the wrong reason.
  buildHubOrExplain(hub);
}, 300_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("R2-1 — the MCP surface reports dist/ staleness", () => {
  it("POSITIVE: on a fresh dist/, tools say so and doctor is clear", () => {
    const status = mcp("agentboot_status", hub) as { build: Record<string, unknown> };
    expect(status.build["distFresh"]).toBe(true);
    expect(status.build["lastBuildStatus"]).toBe("success");
    expect(status.build["distStaleReason"]).toBeUndefined();

    const personas = mcp("agentboot_list_personas", hub);
    expect(personas["source"]).toBe("dist");
    expect(personas["dist_stale"]).toBe(false);

    const doctor = mcp("agentboot_doctor", hub) as { issues: Array<{ description: string }> };
    expect(doctor.issues.filter((i) => /dist\/ is STALE/.test(i.description))).toEqual([]);
  }, 300_000);

  it("NEGATIVE: after a FAILED build, every MCP answer carries the staleness", () => {
    // Trip the capability gate: declare claude.hooks with `claude` retired from
    // outputFormats. Build exits 1 and dist/ is left byte-identical.
    const cfgPath = path.join(hub, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    (cfg["personas"] as Record<string, unknown>)["outputFormats"] = ["skill", "agents", "copilot"];
    cfg["claude"] = {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    const build = ab(["build"], hub);
    expect(build.status, "the build must actually fail, or this test is vacuous").toBe(1);
    const stamp = JSON.parse(
      fs.readFileSync(path.join(hub, "dist", ".agentboot-build.json"), "utf-8"),
    ) as { status: string };
    expect(stamp.status).toBe("failed");

    // The CLI already refused. The MCP surface must not disagree with it about
    // the same tree at the same moment.
    expect(ab(["status"], hub).status).toBe(1);

    const status = mcp("agentboot_status", hub) as { build: Record<string, unknown> };
    expect(status.build["distFresh"]).toBe(false);
    expect(status.build["lastBuildStatus"]).toBe("failed");
    expect(status.build["distStaleReason"]).toBe("failed");
    // lastBuiltAt must be the STAMP's build attempt, not dist/'s mtime.
    expect(status.build["lastBuiltAt"]).toBe(
      (
        JSON.parse(
          fs.readFileSync(path.join(hub, "dist", ".agentboot-build.json"), "utf-8"),
        ) as { builtAt: string }
      ).builtAt,
    );

    const doctor = mcp("agentboot_doctor", hub) as {
      allClear: boolean;
      issues: Array<{ severity: string; description: string }>;
    };
    expect(doctor.allClear).toBe(false);
    expect(
      doctor.issues.some((i) => i.severity === "error" && /dist\/ is STALE/.test(i.description)),
      "doctor reported allClear on a hub whose build had just failed",
    ).toBe(true);

    // Content-serving tools: still answer (the `reports` posture), but never
    // hand an agent superseded policy labelled only `source: "dist"`.
    for (const tool of ["agentboot_list_personas", "agentboot_get_persona"]) {
      const payload =
        tool === "agentboot_get_persona"
          ? mcpWithArgs(tool, hub, { name: "code-reviewer" })
          : mcp(tool, hub);
      expect(payload["source"], tool).toBe("dist");
      expect(payload["dist_stale"], tool).toBe(true);
      expect(String(payload["warning"] ?? ""), tool).toMatch(/current policy/i);
    }
  }, 300_000);

  it("NEGATIVE: a config edit with no rebuild is stale too, not just a failed build", () => {
    // Restore a good build, then move the config without rebuilding.
    const cfgPath = path.join(hub, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    delete cfg["claude"];
    (cfg["personas"] as Record<string, unknown>)["outputFormats"] = [
      "skill",
      "agents",
      "claude",
      "copilot",
    ];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    expect(ab(["build"], hub).status).toBe(0);
    expect(
      (mcp("agentboot_status", hub) as { build: Record<string, unknown> }).build["distFresh"],
    ).toBe(true);

    // Revoke a control. No rebuild. The stamp still says "success".
    const cfg2 = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    (cfg2["instructions"] as Record<string, unknown>)["enabled"] = ["baseline.instructions"];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg2, null, 2));

    const status = mcp("agentboot_status", hub) as { build: Record<string, unknown> };
    expect(status.build["lastBuildStatus"]).toBe("success");
    expect(status.build["distFresh"], "a success stamp is not the same as a current tree").toBe(
      false,
    );
    expect(status.build["distStaleReason"]).toBe("config-stale");
  }, 300_000);
});

/** mcp() with arguments — kept separate so the common case stays a one-liner. */
function mcpWithArgs(
  tool: string,
  hubDir: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const req =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    }) +
    "\n" +
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }) +
    "\n";
  const r = spawnSync(process.execPath, [CLI, "mcp-server"], {
    cwd: hubDir,
    input: req,
    env: { ...process.env, NODE_NO_WARNINGS: "1", AGENTBOOT_HUB: hubDir },
    encoding: "utf-8",
    timeout: 300_000,
  });
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const msg = JSON.parse(line) as {
        id?: number;
        result?: { content?: Array<{ text?: string }> };
      };
      if (msg.id === 2 && msg.result?.content?.[0]?.text) {
        return JSON.parse(msg.result.content[0].text!) as Record<string, unknown>;
      }
    } catch {
      /* not the frame we want */
    }
  }
  throw new Error(`no MCP result for ${tool}: ${r.stdout}${r.stderr}`);
}
