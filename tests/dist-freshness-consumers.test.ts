/**
 * R1-E — three more consumers trusted a stale `dist/`.
 *
 * N1 established the rule: a failed build leaves the previous `dist/`
 * byte-identical, so the presence of files is not evidence that they reflect
 * current policy. `sync`, `drift-check` and `audit` were taught to refuse.
 * `conformance`, `baseline` and `evidence-pack` were not — and they are the
 * three that turn `dist/` into an EVIDENCE CLAIM.
 *
 * Reproduced on a scaffolded hub: build with `managed.guardrails.denyTools`,
 * probe it green, then revoke denyTools and add a narrow `applyTo` instruction
 * so the rebuild fails at the scope gate.
 *
 *     BUILD2   = 1        dist/.agentboot-build.json → status "failed"
 *     conformance  EXIT=0   "deny-tools not-applicable"  ← NEW config, OLD tree
 *     baseline     EXIT=0   archived that as the platform-behaviour record
 *     evidence-pack EXIT=0  wrote the auditor bundle from it
 *     sync         EXIT=1   ← the only one that noticed
 *
 * conformance is the worst of the three because it WRITES its reading back into
 * `dist/<platform>/enforcement-manifest.json`, which is what `baseline` archives
 * and `evidence-pack` hands to the auditor. One stale probe contaminates the
 * whole evidence chain.
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

let base: string;
let hub: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-fresh-consumers-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.personas = { ...(cfg.personas ?? {}), outputFormats: ["claude"] };
  cfg.managed = { ...(cfg.managed ?? {}), enabled: true, guardrails: { denyTools: ["Bash"] } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  if (ab(["build"], hub).status !== 0) throw new Error("initial build failed");
}, 900_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

const stampStatus = (): string =>
  JSON.parse(fs.readFileSync(path.join(hub, "dist", ".agentboot-build.json"), "utf-8")).status;

/** Revoke a control AND trip a build gate, so the rebuild fails and dist/ ages. */
function makeDistStale(): void {
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.managed.guardrails.denyTools = [];
  cfg.instructions = { ...(cfg.instructions ?? {}) };
  cfg.instructions.enabled = [...(cfg.instructions.enabled ?? []), "narrow.instructions"];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  fs.writeFileSync(
    path.join(hub, "core", "instructions", "narrow.instructions.md"),
    '---\ndescription: narrow\napplyTo: "src/api/**"\n---\n# narrow\nAPI only.\n',
  );
}

function makeDistFresh(): void {
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.instructions.enabled = (cfg.instructions.enabled ?? []).filter((n: string) => n !== "narrow.instructions");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  fs.rmSync(path.join(hub, "core", "instructions", "narrow.instructions.md"), { force: true });
}

describe("stale dist/ — the evidence-producing commands must refuse", () => {
  it("POSITIVE: all three run against a fresh dist/", () => {
    expect(ab(["conformance"], hub).status).toBe(0);
    expect(ab(["baseline"], hub).status).toBe(0);
    expect(ab(["evidence-pack", "--out", "ep.json"], hub).status).toBe(0);
  }, 600_000);

  it("a failed rebuild stamps dist/ failed — the precondition for the rest", () => {
    makeDistStale();
    const b = ab(["build"], hub);
    expect(b.status, b.out).toBe(1);
    expect(stampStatus()).toBe("failed");
  }, 300_000);

  it("NEGATIVE: conformance refuses — it would write a stale reading INTO dist/", () => {
    const r = ab(["conformance"], hub);
    expect(r.out).toMatch(/refusing to run `conformance` against a stale dist\//);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("NEGATIVE: baseline refuses — a stale snapshot is worse than a missing week", () => {
    const r = ab(["baseline"], hub);
    expect(r.out).toMatch(/refusing to run `baseline` against a stale dist\//);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("NEGATIVE: evidence-pack refuses — the auditor bundle must not describe replaced policy", () => {
    const r = ab(["evidence-pack", "--out", "ep-stale.json"], hub);
    expect(r.out).toMatch(/refusing to run `evidence-pack` against a stale dist\//);
    expect(r.status, r.out).toBe(1);
    expect(fs.existsSync(path.join(hub, "ep-stale.json"))).toBe(false);
  }, 300_000);

  it("POSITIVE: a successful rebuild restores all three — the gate is not an outage", () => {
    makeDistFresh();
    expect(ab(["build"], hub).status).toBe(0);
    expect(stampStatus()).toBe("success");
    expect(ab(["conformance"], hub).status).toBe(0);
    expect(ab(["baseline"], hub).status).toBe(0);
    expect(ab(["evidence-pack", "--out", "ep2.json"], hub).status).toBe(0);
  }, 600_000);
});
