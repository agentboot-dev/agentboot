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

const stampStatusOf = (h: string): string =>
  JSON.parse(fs.readFileSync(path.join(h, "dist", ".agentboot-build.json"), "utf-8")).status;
const stampStatus = (): string => stampStatusOf(hub);

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

/**
 * A-class — and then there were nine more.
 *
 * R1-E fixed three consumers. It did not ask how many there were. The answer
 * was that `install-user`, `export`, `publish`, `test` and `cost-estimate` were
 * still acting on a stale tree at exit 0, and `doctor`, `status` and `lint`
 * were still describing one as healthy — because the gated set and the
 * consumer set were two hand-maintained lists.
 *
 * tests/dist-consumer-invariant.test.ts asserts that no command can read dist/
 * without declaring a posture. This block asserts the postures are real: the
 * gated ones refuse, and the reporting ones say what is wrong.
 */
describe("A-class — the remaining dist/ consumers", () => {
  it("precondition: a failed rebuild stamps dist/ failed", () => {
    makeDistStale();
    expect(ab(["build"], hub).status).toBe(1);
    expect(stampStatus()).toBe("failed");
  }, 300_000);

  it("A2-residual: install-user refuses — it delivers org policy to a developer's machine", () => {
    // Measured pre-fix: EXIT 0, "✓ Would write 5 skill file(s) + 2 rule file(s)
    // to ~/.claude/" and "✓ Would withdraw 1 revoked artifact(s)". Two green
    // ticks installing a revoked control from a platform the org had retired.
    // Its only precondition was fs.existsSync(distCore) — existence read as
    // freshness, the pattern the sync gate was written to kill.
    const r = ab(["install-user", "--dry-run"], hub);
    expect(r.out).toMatch(/refusing to run `install-user` against a stale dist\//);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("A3-residual: export refuses for BOTH formats — it packages a distributable", () => {
    const plugin = ab(["export", "--format", "plugin", "--output", "zz-plugin"], hub);
    expect(plugin.out).toMatch(/refusing to run `export` against a stale dist\//);
    expect(plugin.status, plugin.out).toBe(1);
    expect(fs.existsSync(path.join(hub, "zz-plugin"))).toBe(false);

    // The agentskills path ended with "Submit this file to agentskills.io for
    // directory listing." — publishing superseded policy to a public directory.
    const skills = ab(["export", "--format", "agentskills"], hub);
    expect(skills.out).toMatch(/refusing to run `export` against a stale dist\//);
    expect(skills.status, skills.out).toBe(1);
  }, 300_000);

  it("A-class: test refuses — a green run against a superseded tree is a false pass", () => {
    const r = ab(["test", "--snapshot"], hub);
    expect(r.out).toMatch(/refusing to run `test` against a stale dist\//);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("A-class: cost-estimate refuses — a stale tree gives a wrong number stated as fact", () => {
    const r = ab(["cost-estimate"], hub);
    expect(r.out).toMatch(/refusing to run `cost-estimate` against a stale dist\//);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("A4-residual: status reads the STAMP, not dist/'s directory mtime", () => {
    // Pre-fix, cli.ts was literally commented `// Check dist/ freshness` and
    // then did fs.statSync(distPath).mtime — printing the timestamp of the
    // EARLIER SUCCESSFUL build while the most recent attempt had failed
    // seconds later, at exit 0.
    const r = ab(["status"], hub);
    expect(r.out).toMatch(/Last build: .* — FAILED/);
    expect(r.out).not.toMatch(/reporting on a stale dist\/[\s\S]*refusing to run `status`/);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("V5: doctor calls a failed build a FAILED check, not `dist/ exists (built)`", () => {
    const r = ab(["doctor"], hub);
    expect(r.out).toMatch(/dist\/ exists but is NOT trustworthy/);
    expect(r.out).not.toMatch(/✓ dist\/ exists \(built\)/);
    expect(r.status, r.out).not.toBe(0);
  }, 300_000);

  it("POSITIVE: a successful rebuild clears every one of them — no gate is an outage", () => {
    makeDistFresh();
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["install-user", "--dry-run"], hub).status).toBe(0);
    expect(ab(["export", "--format", "plugin", "--output", "zz-ok"], hub).status).toBe(0);
    expect(ab(["cost-estimate"], hub).status).toBe(0);
    const st = ab(["status"], hub);
    expect(st.status, st.out).toBe(0);
    expect(st.out).not.toMatch(/FAILED/);
  }, 900_000);
});

/**
 * A1/A2-residual — end to end: the surface where guardrails are actually declared.
 *
 * The config digest catches a config edit. It does not catch `guardrail: hard`,
 * `applyTo:` or the control text, because none of those live in
 * agentboot.config.json. This is the reported repro, run against the CLI.
 */
describe("A1/A2-residual — an ARTIFACT edit that never rebuilt", () => {
  let vhub: string;
  let vspoke: string;

  const phi = (guardrail: string, body: string) =>
    `---\ndescription: PHI handling\nguardrail: ${guardrail}\n---\n# PHI\n${body}\n`;

  it("precondition: build + sync ships the SOFT control to the spoke", () => {
    const vbase = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-srcstale-"));
    vhub = path.join(vbase, "hub");
    vspoke = path.join(vbase, "spoke");
    fs.mkdirSync(vspoke, { recursive: true });
    spawnSync("git", ["init", "-q", "."], { cwd: vspoke });
    spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: vspoke });
    const inst = spawnSync(
      process.execPath,
      [CLI, "install", "--hub", "--org", "acme", "--path", vhub, "--non-interactive", "--skip-sync"],
      { cwd: vbase, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
    );
    if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);

    fs.writeFileSync(
      path.join(vhub, "core", "instructions", "phi.instructions.md"),
      phi("soft", "Avoid logging patient data where practical."),
    );
    const cfgPath = path.join(vhub, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    cfg.personas = { ...(cfg.personas ?? {}), outputFormats: ["claude"] };
    cfg.instructions = { enabled: ["phi.instructions"] };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    fs.writeFileSync(
      path.join(vhub, "repos.json"),
      JSON.stringify([{ name: "spokeV", path: "../spoke", platform: "claude" }], null, 2),
    );

    expect(ab(["build"], vhub).status).toBe(0);
    expect(ab(["sync"], vhub).status).toBe(0);
    const landed = path.join(vspoke, ".claude", "rules", "phi.instructions.md");
    expect(fs.existsSync(landed)).toBe(true);
    expect(fs.readFileSync(landed, "utf-8")).toContain("where practical");
  }, 900_000);

  it("tightening the ARTIFACT without rebuilding is caught by sync, drift-check and audit", () => {
    fs.writeFileSync(
      path.join(vhub, "core", "instructions", "phi.instructions.md"),
      phi("hard", "NEVER log, trace, or print patient-identifying data. Non-overridable."),
    );
    // Pre-fix, measured unpiped: SYNC_EXIT=0 printing
    // "– spokeV (claude) — skipped (no changes)" / "✓ Synced 0 of 1 repo";
    // DRIFT_EXIT=0 "1/1 clean"; AUDIT_EXIT=0; stamp "success"; spoke still soft.
    const s = ab(["sync"], vhub);
    expect(s.status, s.out).toBe(1);
    expect(s.out).toMatch(/sources-stale/);
    expect(s.out).toMatch(/guardrail: hard/);
    expect(ab(["drift-check"], vhub).status).toBe(1);
    expect(ab(["audit"], vhub).status).toBe(1);
    // And the stamp still says "success" — which is TRUE and beside the point:
    // the last build did succeed, against sources that no longer exist.
    expect(stampStatusOf(vhub)).toBe("success");
  }, 600_000);

  it("DELETING an artifact without rebuilding is caught too — revocation is an edit", () => {
    fs.rmSync(path.join(vhub, "core", "instructions", "phi.instructions.md"));
    expect(ab(["sync"], vhub).status).toBe(1);
  }, 300_000);

  it("POSITIVE: rebuilding clears it and the HARD control reaches the spoke", () => {
    fs.writeFileSync(
      path.join(vhub, "core", "instructions", "phi.instructions.md"),
      phi("hard", "NEVER log, trace, or print patient-identifying data. Non-overridable."),
    );
    expect(ab(["build"], vhub).status).toBe(0);
    expect(ab(["sync"], vhub).status).toBe(0);
    expect(ab(["drift-check"], vhub).status).toBe(0);
    const landed = fs.readFileSync(path.join(vspoke, ".claude", "rules", "phi.instructions.md"), "utf-8");
    expect(landed).toContain("Non-overridable");
    expect(landed).not.toContain("where practical");
  }, 900_000);
});
