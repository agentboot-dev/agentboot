/**
 * R1-D — `drift-check` reported success for repos it never checked.
 *
 * The all-repos path exited `driftedRepos > 0 ? 1 : 0`, and `driftedRepos`
 * counts only `manifestFound && !clean`. So every way of NOT checking a repo
 * landed in the exit-0 branch:
 *
 *   - a spoke whose `.agentboot-manifest.json` was deleted  → `? (no manifest)`, exit 0
 *   - a registered repo not present on this machine         → `? (no manifest)`, exit 0
 *   - an unreadable repos.json                              → "0/0 clean", exit 0
 *
 * The first is the sharp one: deleting one JSON file on a spoke is the cheapest
 * possible way to make an org-wide compliance report green forever, and the
 * per-repo mode (`--repo`) had always exited 2 on exactly that state — the two
 * modes disagreed about whether "I could not check" is a pass.
 *
 * All three verified against the real CLI below, both directions.
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
let spoke: string;
let reposJson: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-drift-unchecked-"));
  hub = path.join(base, "hub");
  spoke = path.join(base, "spoke");

  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);

  fs.mkdirSync(spoke, { recursive: true });
  fs.writeFileSync(path.join(spoke, "README.md"), "x\n");
  for (const args of [["init", "-q", "."], ["add", "-A"],
    ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init"]]) {
    spawnSync("git", args, { cwd: spoke, encoding: "utf-8" });
  }

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.personas = { ...(cfg.personas ?? {}), outputFormats: ["claude"] };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  reposJson = path.join(hub, "repos.json");
  fs.writeFileSync(reposJson, JSON.stringify([{ path: "../spoke", platform: "claude" }], null, 2));

  if (ab(["build"], hub).status !== 0) throw new Error("build failed");
  if (ab(["sync"], hub).status !== 0) throw new Error("sync failed");
}, 900_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

const manifest = () => path.join(spoke, ".claude", ".agentboot-manifest.json");

describe("drift-check — an unchecked repo is not a clean repo", () => {
  it("POSITIVE: a synced, intact spoke still exits 0", () => {
    const r = ab(["drift-check"], hub);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/1\/1 clean/);
  }, 300_000);

  it("NEGATIVE: deleting the spoke manifest exits 1 and says the repo was UNCHECKED", () => {
    const saved = fs.readFileSync(manifest(), "utf-8");
    fs.rmSync(manifest());
    try {
      const r = ab(["drift-check"], hub);
      expect(r.out).toMatch(/UNCHECKED/);
      expect(r.out).toMatch(/does not speak for them/);
      expect(r.status, r.out).toBe(1);
    } finally {
      fs.writeFileSync(manifest(), saved);
    }
  }, 300_000);

  it("the per-repo mode and the all-repos mode agree on a missing manifest", () => {
    const saved = fs.readFileSync(manifest(), "utf-8");
    fs.rmSync(manifest());
    try {
      const one = ab(["drift-check", "--repo", "../spoke"], hub);
      const all = ab(["drift-check"], hub);
      // Different codes are fine (2 vs 1); both must be non-zero. The old bug
      // was 2 vs 0 — one mode calling it a failure and the other a pass.
      expect(one.status).not.toBe(0);
      expect(all.status).not.toBe(0);
    } finally {
      fs.writeFileSync(manifest(), saved);
    }
  }, 300_000);

  it("NEGATIVE: a registered repo missing from this machine exits 1 and is named unreachable", () => {
    const saved = fs.readFileSync(reposJson, "utf-8");
    fs.writeFileSync(reposJson, JSON.stringify([{ path: "../nope", platform: "claude" }]));
    try {
      const r = ab(["drift-check"], hub);
      expect(r.out).toMatch(/repo path not found on this machine/);
      expect(r.out).toMatch(/1 unreachable/);
      expect(r.status, r.out).toBe(1);
    } finally {
      fs.writeFileSync(reposJson, saved);
    }
  }, 300_000);

  it("NEGATIVE: an unreadable repos.json fails loudly instead of reporting 0/0 clean", () => {
    const saved = fs.readFileSync(reposJson, "utf-8");
    fs.writeFileSync(reposJson, "{{{");
    try {
      const r = ab(["drift-check"], hub);
      expect(r.out).toMatch(/Cannot read the repo registry/);
      expect(r.out).not.toMatch(/0\/0 clean/);
      expect(r.status, r.out).toBe(1);
    } finally {
      fs.writeFileSync(reposJson, saved);
    }
  }, 300_000);

  it("zero registered repos says \"nothing was checked\" rather than borrowing the clean sentence", () => {
    const saved = fs.readFileSync(reposJson, "utf-8");
    fs.writeFileSync(reposJson, "[]");
    try {
      const r = ab(["drift-check"], hub);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/nothing was checked/);
      expect(r.out).not.toMatch(/clean,/);
    } finally {
      fs.writeFileSync(reposJson, saved);
    }
  }, 300_000);
});
