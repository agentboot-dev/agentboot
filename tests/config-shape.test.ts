/**
 * NF2-3 — a malformed policy value crashed the build with a raw TypeError.
 *
 * `managed.guardrails.denyTools: "WebFetch"` (a string where an array belongs)
 * produced, on a scaffolded hub:
 *
 *     node bin/agentboot.js build >b.txt 2>&1; echo $?   -> 1
 *     ...
 *     Unexpected error: TypeError: denyTools.map is not a function
 *       at buildComplianceHookScripts (scripts/compile.ts:2858:32)
 *       at main (scripts/compile.ts:3974:33)
 *
 * — after most of dist/ had already been written. It DID fail closed (the stamp
 * records `status: "failed"` and every gated command refuses afterwards), so
 * this is not a safety hole; it is V4's malformed-policy-value class in a
 * sibling key, reaching the operator as a stack frame instead of a diagnostic.
 *
 * The comparison that makes it a defect: the ADJACENT `permissions` key with the
 * same mistake already produced
 *   "✗ scopes/core: permissions is string, expected an object — from 00-org"
 * One key names itself and its expected type; its neighbour prints a stack
 * frame. From a stack frame in the compiler the operator cannot tell WHICH of
 * their keys is wrong.
 *
 * Two fixes: a TABLE of policy-bearing keys and their shapes (per-key checks are
 * how `permissions` got one and `denyTools` did not), and one place that turns
 * ANY loadConfig failure into a named refusal — because every config error,
 * including the ones loadConfig already checked for, was reaching the operator
 * as a stack trace. Deleting `org` from a hub config produced
 * `at main (…/scripts/compile.ts:3536:18)` before this.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { configShapeErrors, CONFIG_SHAPE } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
let hub = "";

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-shape-"));
  hub = path.join(base, "hub");
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

function withConfig(mutate: (c: Record<string, any>) => void, cmd = "build"): { status: number; out: string } {
  const cfgPath = path.join(hub, "agentboot.config.json");
  const original = fs.readFileSync(cfgPath, "utf-8");
  const cfg = JSON.parse(original);
  mutate(cfg);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  try {
    const r = spawnSync(process.execPath, [CLI, cmd], {
      cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    fs.writeFileSync(cfgPath, original);
  }
}

describe("NF2-3 — configShapeErrors names the key and the expected type", () => {
  it("the table is non-trivial and covers the key that crashed the build", () => {
    expect(CONFIG_SHAPE.length).toBeGreaterThan(20);
    expect(CONFIG_SHAPE.some((r) => r.path === "managed.guardrails.denyTools")).toBe(true);
  });

  it("a string where an array of strings belongs", () => {
    const e = configShapeErrors({ org: "a", managed: { guardrails: { denyTools: "WebFetch" } } });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("managed.guardrails.denyTools");
    expect(e[0]).toContain("expected an array of strings");
  });

  it("an array of NON-strings is caught too — Array.isArray is not enough", () => {
    const e = configShapeErrors({ org: "a", managed: { guardrails: { denyTools: [{ tool: "x" }] } } });
    expect(e[0]).toContain("expected an array of strings");
  });

  it("wildcards reach into per-group config, and name the group", () => {
    const e = configShapeErrors({ org: "a", groups: { platform: { permissions: "deny-everything" } } });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("groups.platform.permissions");
    expect(e[0]).toContain("expected an object");
  });

  it("EVERY wrong value is reported, not just the first", () => {
    const e = configShapeErrors({
      org: 7,
      personas: { outputFormats: "claude" },
      managed: { enabled: "yes", guardrails: { denyTools: "WebFetch" } },
    });
    expect(e.length).toBeGreaterThanOrEqual(4);
  });

  it("NEGATIVE: a well-formed config produces NOTHING", () => {
    // A checker that flags a correct config is worse than none: it teaches the
    // operator to ignore the channel.
    expect(
      configShapeErrors({
        org: "acme",
        personas: { enabled: ["a"], outputFormats: ["claude", "cursor"] },
        instructions: { enabled: [] },
        claude: { permissions: { deny: ["Bash(rm -rf *)"] }, settings: { anything: 1 } },
        managed: { enabled: true, guardrails: { denyTools: ["WebFetch"], requireAuditLog: false } },
        groups: { platform: { teams: ["api"], permissions: { allow: ["Read(x)"] } } },
      }),
    ).toEqual([]);
  });

  it("NEGATIVE: an ABSENT key is not a wrong key", () => {
    expect(configShapeErrors({ org: "acme" })).toEqual([]);
  });
});

describe("NF2-3 — the operator gets a diagnostic, never a stack frame", () => {
  const STACK_FRAME = /^\s+at [A-Za-z_$][\w$.]* \(/m;

  it("malformed denyTools: named key, named type, no stack trace", () => {
    const r = withConfig((c) => { c.managed = { enabled: true, guardrails: { denyTools: "WebFetch" } }; });
    expect(r.status).toBe(1);
    expect(r.out).toContain("managed.guardrails.denyTools");
    expect(r.out).toContain("expected an array of strings");
    expect(r.out, "the operator got a stack frame").not.toMatch(STACK_FRAME);
    expect(r.out).not.toContain("denyTools.map is not a function");
  }, 300_000);

  it("a config error loadConfig ALREADY checked for is no longer a stack trace either", () => {
    // Deleting `org` hit an existing loadConfig throw with no handler. The
    // class was never denyTools-specific.
    const r = withConfig((c) => { delete c.org; }, "validate");
    expect(r.status).toBe(1);
    expect(r.out).toContain("org");
    expect(r.out).not.toMatch(STACK_FRAME);
  }, 300_000);

  it("sync refuses the same way — one helper, three scripts", () => {
    const r = withConfig((c) => { c.managed = { enabled: true, guardrails: { denyTools: "WebFetch" } }; }, "sync");
    expect(r.status).toBe(1);
    expect(r.out).not.toMatch(STACK_FRAME);
  }, 300_000);

  it("NEGATIVE: a well-formed hub still builds", () => {
    const r = withConfig(() => { /* unchanged */ });
    expect(r.status, r.out).toBe(0);
  }, 300_000);
});
