/**
 * R1-B — `agentboot baseline` banked a snapshot that recorded no observation.
 *
 * The baseline exists because platform behaviour changes silently and cannot be
 * reconstructed after the fact: probes that begin at 1.4 cannot say how the
 * platform behaved at 1.0. Its only guard was "are there any manifests?", which
 * a full sheet of `untested` satisfies. So on a machine without bash the chain
 *
 *     conformance (exit 0, all untested) → baseline (✓ archived) → CI `find | wc -l`
 *
 * was green end to end while banking, week after week, a record of not having
 * looked. That is worse than banking nothing, because it looks like history.
 *
 * Also pinned here: `baseline` read a hardcoded `dist/`, so a hub with
 * `output.distPath` set archived nothing forever, on a schedule.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Status read WITHOUT a pipe — a piped $? is the pipe's. */
function ab(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

let base: string;
let hub: string;
let emptyBinDir: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-baseline-obs-"));
  hub = path.join(base, "hub");
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.personas = { ...(cfg.personas ?? {}), outputFormats: ["claude"] };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const build = ab(["build"], hub);
  if (build.status !== 0) throw new Error(`build failed: ${build.out}`);
  emptyBinDir = path.join(base, "empty-bin");
  fs.mkdirSync(emptyBinDir, { recursive: true });
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

const archiveDir = (): string => path.join(hub, ".agentboot", "baseline");
const snapshots = (): string[] =>
  fs.existsSync(archiveDir()) ? fs.readdirSync(archiveDir()).filter((f) => f.startsWith("conformance-")) : [];

describe("baseline — a snapshot with no observation is not a baseline", () => {
  it("POSITIVE: a real probe run archives, and the snapshot carries its probe count", () => {
    expect(ab(["conformance"], hub).status).toBe(0);
    const r = ab(["baseline"], hub);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/observed probe\(s\)/);
    const files = snapshots();
    expect(files.length).toBe(1);
    const snap = JSON.parse(fs.readFileSync(path.join(archiveDir(), files[0]!), "utf-8")) as { observedProbes: number };
    expect(snap.observedProbes).toBeGreaterThan(0);
  }, 300_000);

  it("NEGATIVE: manifests full of `untested` are refused — exit 1, nothing archived", () => {
    // Regenerate the manifests with no bash: every control comes back untested.
    // conformance itself now exits 1 here; --allow-untested is what a local
    // operator would reach for, and it must not unlock the archive.
    // Windows env vars are case-insensitive, so `{PATH, Path}` is one variable
    // set twice and the emptying is not reliable; Git-for-Windows bash is also
    // on PATH by design. `AGENTBOOT_BASH` is the SOLE candidate when set
    // (conformance.ts), so naming a nonexistent file makes every control
    // untested on every platform — and leaves the hook scripts' own PATH
    // intact, so this is an all-UNTESTED run rather than an all-FAILED one,
    // which is the state this case is about.
    const c = ab(["conformance", "--allow-untested"], hub, {
      AGENTBOOT_BASH: path.join(emptyBinDir, "no-such-bash"),
    });
    expect(c.status, c.out).toBe(0);

    const before = snapshots().length;
    const r = ab(["baseline"], hub);
    expect(r.out).toMatch(/records NO observed behaviour/);
    expect(r.status, r.out).toBe(1);
    expect(snapshots().length).toBe(before); // nothing banked
  }, 300_000);

  it("honours output.distPath — a hub that relocates dist/ still has a clock", () => {
    const relocated = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-baseline-dp-"));
    const hub2 = path.join(relocated, "hub");
    const inst = spawnSync(
      process.execPath,
      [CLI, "install", "--hub", "--org", "acme", "--path", hub2, "--non-interactive", "--skip-sync"],
      { cwd: relocated, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
    );
    expect(inst.status).toBe(0);
    const cfgPath = path.join(hub2, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    cfg.personas = { ...(cfg.personas ?? {}), outputFormats: ["claude"] };
    cfg.output = { ...(cfg.output ?? {}), distPath: "./build-out" };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    expect(ab(["build"], hub2).status).toBe(0);
    expect(ab(["conformance"], hub2).status).toBe(0);
    const r = ab(["baseline"], hub2);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/observed probe\(s\)/);
    fs.rmSync(relocated, { recursive: true, force: true });
  }, 600_000);
});
