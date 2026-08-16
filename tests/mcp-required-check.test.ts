/**
 * R2-4 — `mcp.required` was checked by two guards that switched themselves off
 * in exactly the state each was written to catch.
 *
 * scripts/validate.ts, checkMcpGovernance:
 *
 *     if (mcpConfig.required && mcpConfig.approved)          { …in-approved-list… }
 *     if (mcpConfig.required && config.claude?.mcpServers)   { …is-configured… }
 *
 * Each check is gated on the presence of the very thing it compares against. So:
 *
 *   - `required: ["vault"]` with NO `approved` list — nothing is approved, so the
 *     required server certainly is not — produced no finding.
 *   - `required: ["vault"]` with NO `claude.mcpServers` — zero of the required
 *     servers present, the MAXIMUM shortfall — produced no finding.
 *
 * Both printed `✓ MCP governance — approved servers and required servers
 * validated`, which is a positive claim that a check ran when it did not.
 * Reproduced against the real CLI: `agentboot validate --strict` on a hub with
 * `mcp.approved: [{name:"vault"}]`, `mcp.required: ["vault"]` and no
 * `claude.mcpServers` printed that green tick verbatim.
 *
 * A check that cannot fail is not a check. FAIL CLOSED on missing data: an
 * absent list is an empty list, not an excuse to skip.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r2-mcpreq-"));
});
afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

function hubWith(name: string, mutate: (cfg: Record<string, unknown>) => void): string {
  const hub = path.join(base, name);
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
  mutate(cfg);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return hub;
}

function validate(hub: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, "validate"], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("R2-4 — the mcp.required checks fire when there is nothing to compare against", () => {
  it("NEGATIVE: required with NO approved list is a finding, not a silent pass", () => {
    const hub = hubWith("req-no-approved", (cfg) => {
      cfg["mcp"] = { required: ["vault"] };
    });
    const v = validate(hub);
    expect(v.out).toContain('MCP required server "vault" is not in the approved servers list');
    expect(v.out).toContain("mcp.approved is not configured at all");
    // The green tick must not be printed for a check that found a problem.
    expect(v.out).not.toMatch(
      /✓\s*MCP governance — approved servers and required servers validated/,
    );
  }, 300_000);

  it("NEGATIVE: required with NO claude.mcpServers is a finding — the maximum shortfall", () => {
    const hub = hubWith("req-no-servers", (cfg) => {
      cfg["mcp"] = { approved: [{ name: "vault", command: "vault-mcp" }], required: ["vault"] };
    });
    const v = validate(hub);
    expect(v.out).toContain('MCP required server "vault" is not configured in claude.mcpServers');
    expect(v.out).toContain("no claude.mcpServers are configured at all");
  }, 300_000);

  it("NEGATIVE: the pre-existing case still fires — some servers configured, required one absent", () => {
    const hub = hubWith("req-other-server", (cfg) => {
      cfg["mcp"] = { approved: [{ name: "vault", command: "vault-mcp" }], required: ["vault"] };
      cfg["claude"] = { mcpServers: { other: { command: "/bin/true" } } };
    });
    const v = validate(hub);
    expect(v.out).toContain('MCP required server "vault" is not configured in claude.mcpServers');
  }, 300_000);

  it("POSITIVE: required, approved and configured — the tick is earned, no findings", () => {
    const hub = hubWith("req-satisfied", (cfg) => {
      cfg["mcp"] = { approved: [{ name: "vault", command: "vault-mcp" }], required: ["vault"] };
      cfg["claude"] = { mcpServers: { vault: { command: "vault-mcp" } } };
    });
    const v = validate(hub);
    expect(v.out).not.toContain("MCP required server");
    expect(v.out).toMatch(/MCP governance — approved servers and required servers validated/);
  }, 300_000);

  it("POSITIVE: no mcp block at all stays silent — the gate must not become noise", () => {
    const hub = hubWith("no-mcp", () => {});
    expect(validate(hub).out).not.toContain("MCP required server");
  }, 300_000);
});
