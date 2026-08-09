/**
 * R2-3 — the whole GROUP tier was invisible to the capability gate.
 *
 * `CAPABILITY_SUPPORT` exists to answer "this is configured, and no configured
 * platform can honour it". It carried `claude.permissions.deny` at ERROR
 * severity. It carried nothing at all for `groups[name].permissions`,
 * `.mcpServers` or `.enabledPlugins` — the documented per-group managed settings
 * (docs/configuration.md:81) — which are emitted by a single
 * `if (outputFormats.includes("claude"))` block at compile.ts:4327.
 *
 * Reproduced on a scaffolded hub before the fix:
 *
 *     personas.outputFormats = ["cursor","copilot"]
 *     groups.platform.permissions.deny = ["Bash(rm -rf *)", "Write(**\/.env)"]
 *     groups.platform.mcpServers.vault = { command: "vault-mcp" }
 *
 *     BUILD_EXIT=0
 *     grep -rl 'rm -rf' dist   → (nothing)
 *     doctor Coverage          → silent
 *
 * Two org deny rules gone, green build, nothing said — while the SAME control
 * written one scope up, as `claude.permissions.deny`, would have failed the
 * build. A gate that fires on a control at the org scope and not at the group
 * scope is worse than no gate: it teaches the operator the gate has them covered.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CAPABILITY_SUPPORT } from "../scripts/lib/conformance.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r2-groups-"));
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

function run(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const GROUP_ROWS = [
  "groups[].permissions.deny",
  "groups[].permissions.allow",
  "groups[].mcpServers",
  "groups[].enabledPlugins",
];

describe("R2-3 — group-scope managed config is covered by the capability gate", () => {
  it("the rows exist, and each takes the same severity as its org-level twin", () => {
    const byId = new Map(CAPABILITY_SUPPORT.map((r) => [r.id, r]));
    for (const id of GROUP_ROWS) {
      expect(byId.get(id), `missing CAPABILITY_SUPPORT row ${id}`).toBeDefined();
    }
    // The severity rule, asserted rather than remembered: inventing a different
    // ladder for the same key at a different scope is how two tables drift.
    expect(byId.get("groups[].permissions.deny")!.severity).toBe(
      byId.get("claude.permissions.deny")!.severity,
    );
    expect(byId.get("groups[].permissions.allow")!.severity).toBe(
      byId.get("claude.permissions.allow")!.severity,
    );
    expect(byId.get("groups[].mcpServers")!.severity).toBe(
      byId.get("claude.mcpServers")!.severity,
    );
  });

  it("NEGATIVE: a group deny list on a hub that builds no claude FAILS the build, by name", () => {
    const hub = hubWith("deny-nonclaude", (cfg) => {
      (cfg["personas"] as Record<string, unknown>)["outputFormats"] = ["cursor", "copilot"];
      cfg["groups"] = {
        platform: { teams: ["api"], permissions: { deny: ["Bash(rm -rf *)", "Write(**/.env)"] } },
      };
    });
    const b = run(["build"], hub);
    expect(b.status, `the build shipped two revoked-nowhere deny rules green: ${b.out}`).toBe(1);
    expect(b.out).toContain("groups[].permissions.deny");
    // And the control really is absent from the tree — the gate is not just noise.
    const found = spawnSync("grep", ["-rl", "rm -rf", path.join(hub, "dist")], { encoding: "utf-8" });
    expect(found.stdout.trim()).toBe("");
  }, 300_000);

  it("NEGATIVE: doctor names the shortfall for the WARN-severity group keys too", () => {
    const hub = hubWith("warn-nonclaude", (cfg) => {
      (cfg["personas"] as Record<string, unknown>)["outputFormats"] = ["cursor", "copilot"];
      cfg["groups"] = {
        platform: {
          teams: ["api"],
          mcpServers: { vault: { command: "vault-mcp" } },
          enabledPlugins: [{ url: "https://plugins.invalid/acme" }],
        },
      };
    });
    // warn-severity keys must not fail the build …
    expect(run(["build"], hub).status).toBe(0);
    // … but doctor must not be silent about them.
    const d = run(["doctor"], hub);
    expect(d.out).toContain("groups[].mcpServers");
    expect(d.out).toContain("groups[].enabledPlugins");
  }, 300_000);

  it("POSITIVE: the same config on a claude hub builds clean and the artifact lands", () => {
    const hub = hubWith("group-claude", (cfg) => {
      (cfg["personas"] as Record<string, unknown>)["outputFormats"] = ["claude"];
      cfg["groups"] = {
        platform: {
          teams: ["api"],
          permissions: { deny: ["Bash(rm -rf *)"] },
          mcpServers: { vault: { command: "vault-mcp" } },
          enabledPlugins: [{ url: "https://plugins.invalid/acme" }],
        },
      };
    });
    const b = run(["build"], hub);
    expect(b.status, b.out).toBe(0);
    const fragment = path.join(
      hub, "dist", "claude", "nodes", "platform", "managed-settings.d", "10-group.json",
    );
    expect(fs.existsSync(fragment), "the group fragment did not land on a claude hub").toBe(true);
    const body = fs.readFileSync(fragment, "utf-8");
    expect(body).toContain("rm -rf");
    expect(body).toContain("vault-mcp");
    expect(body).toContain("plugins.invalid");
    // The gate must stay quiet when the capability IS honoured, or it is noise.
    expect(b.out).not.toContain("groups[].permissions.deny");
  }, 300_000);
});
