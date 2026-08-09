/**
 * R2-2 — the MCP surface counted "could not check" as a pass.
 *
 * Commit `337e012` established the rule for the CLI: *a missing manifest is not
 * evidence of compliance*, and *"I checked nothing" and "I checked everything
 * and it was fine" must not print alike*. It named the corrupt-repos.json case
 * explicitly — "a bad merge in repos.json turns the nightly compliance job into
 * a check of nothing that reads as a check of everything" — and fixed
 * scripts/cli.ts. scripts/mcp-server.ts kept both fail-open shapes:
 *
 *   1. `loadReposJson()` returned `[]` on an unparseable repos.json, so
 *      `agentboot_status` answered `{"repos":[],"platforms":[]}` and
 *      `agentboot_doctor` answered `{"issues":[],"allClear":true}` — the doctor
 *      check was `fs.existsSync(reposPath)`, i.e. existence read as validity.
 *   2. `computeRepoDrift` wrapped the real drift check in a comment-only catch
 *      ("drift check is best-effort for status; keep defaults") over defaults of
 *      `hasDrift: false`, so a repo that could not be checked at all reported as
 *      not-drifted.
 *
 * Measured against the same corrupt file, same hub:
 *     agentboot drift-check  EXIT 1  names the file and the parse error
 *     MCP agentboot_status           {"repos":[],"platforms":[]}
 *     MCP agentboot_doctor           {"issues":[],"allClear":true}
 *
 * The consumer here is an agent asking for the org's repo posture, and it got a
 * confident, complete-looking, empty answer.
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
  for (const line of (r.stdout ?? "").trim().split("\n").filter(Boolean).reverse()) {
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
let spoke: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-mcp-unchecked-"));
  hub = path.join(base, "hub");
  spoke = path.join(base, "spoke");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);
  fs.mkdirSync(spoke, { recursive: true });
  fs.writeFileSync(
    path.join(hub, "repos.json"),
    JSON.stringify([{ path: "../spoke", label: "spoke", platform: "claude" }], null, 2),
  );
  const sync = ab(["sync"], hub);
  if (sync.status !== 0) throw new Error(`sync failed: ${sync.out}`);
}, 300_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("R2-2 — unchecked is not clean on the MCP surface", () => {
  it("POSITIVE: a real synced spoke reports checked, synced and not drifted", () => {
    const status = mcp("agentboot_status", hub) as {
      repos: Array<Record<string, unknown>>;
      uncheckedRepos: number;
      reposError?: string;
    };
    expect(status.reposError).toBeUndefined();
    expect(status.repos).toHaveLength(1);
    expect(status.repos[0]!["checked"]).toBe(true);
    expect(status.repos[0]!["synced"]).toBe(true);
    expect(status.repos[0]!["hasDrift"]).toBe(false);
    expect(status.uncheckedRepos).toBe(0);

    const doctor = mcp("agentboot_doctor", hub) as { issues: Array<{ description: string }> };
    expect(doctor.issues.filter((i) => /repos\.json .* could not be parsed/.test(i.description)))
      .toEqual([]);
  }, 300_000);

  it("NEGATIVE: a repo absent from this machine is UNCHECKED, not clean", () => {
    // Each case writes its own roster: an order-dependent suite is the
    // existence-read-as-freshness bug in test form.
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ path: "../nowhere", label: "nowhere", platform: "claude" }], null, 2),
    );
    const repos = mcp("agentboot_list_repos", hub) as {
      repos: Array<Record<string, unknown>>;
      uncheckedRepos: number;
    };
    const missing = repos.repos.find((r) => r["name"] === "nowhere")!;
    expect(missing["checked"]).toBe(false);
    expect(missing["hasDrift"]).toBe(false); // the old default — now qualified by `checked`
    expect(String(missing["uncheckedReason"] ?? "")).toMatch(/does not exist/i);
    expect(repos.uncheckedRepos).toBe(1);
  }, 300_000);

  it("NEGATIVE: deleting a spoke's manifest is UNCHECKED, not clean", () => {
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ path: "../spoke", label: "spoke", platform: "claude" }], null, 2),
    );
    const manifest = path.join(spoke, ".claude", ".agentboot-manifest.json");
    if (!fs.existsSync(manifest)) expect(ab(["sync"], hub).status).toBe(0);
    expect(fs.existsSync(manifest), "the sync must have written a manifest").toBe(true);
    fs.rmSync(manifest);

    const repos = mcp("agentboot_list_repos", hub) as {
      repos: Array<Record<string, unknown>>;
      uncheckedRepos: number;
    };
    expect(repos.repos[0]!["checked"], "a repo with no manifest was reported as checked").toBe(false);
    expect(String(repos.repos[0]!["uncheckedReason"] ?? "")).toMatch(/manifest/i);
    expect(repos.uncheckedRepos).toBe(1);
  }, 300_000);

  it("NEGATIVE: an unreadable repos.json is not an empty repos.json", () => {
    fs.writeFileSync(path.join(hub, "repos.json"), '[{"path": "../spoke",,,]');

    // The CLI already refuses; the MCP surface must not disagree about the same file.
    expect(ab(["drift-check"], hub).status).toBe(1);

    const status = mcp("agentboot_status", hub) as {
      repos: unknown[];
      reposError?: string;
    };
    expect(status.repos).toEqual([]);
    expect(
      status.reposError,
      "status returned an empty repo list with no indication that nothing could be parsed",
    ).toMatch(/could not be read/i);

    const list = mcp("agentboot_list_repos", hub) as { reposError?: string };
    expect(list.reposError).toMatch(/could not be read/i);

    const doctor = mcp("agentboot_doctor", hub) as {
      allClear: boolean;
      issues: Array<{ severity: string; description: string }>;
    };
    expect(doctor.allClear, "doctor reported allClear on an unparseable repos.json").toBe(false);
    expect(
      doctor.issues.some(
        (i) => i.severity === "error" && /repos\.json .* could not be parsed/.test(i.description),
      ),
    ).toBe(true);
  }, 300_000);
});
