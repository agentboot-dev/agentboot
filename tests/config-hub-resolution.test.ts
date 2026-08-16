/**
 * L46 — `--config` was honoured for the config FILE and ignored for the
 * artifact TREE.
 *
 * Every `--config` consumer read the named hub's config and then resolved
 * `output.distPath` (and the snapshot baseline, the behavioral test dir, the
 * source `core/` tree, the hub's package.json) against `process.cwd()`.
 *
 * A plain "no dist/ here" error would have been the benign failure. The real
 * one is a foreign cwd that contains its OWN `./dist`: reproduced live from
 * /tmp, `install-user --config <hub>` read the hub's `userLevel` config and
 * then staged SIX skill files out of the foreign tree for ~/.claude, where the
 * hub itself yields five. Org policy from one hub, artifacts from another, at
 * exit 0, under two green ticks — the silently-wrong-hub class.
 *
 * The invariant pinned here is stronger than "it doesn't crash":
 *
 *     running `<cmd> --config <hub>` from ANY cwd must act on <hub>,
 *     and must produce the same reading as running `<cmd>` inside <hub>.
 *
 * Each case therefore compares against the same command run from the hub, with
 * a decoy `./dist` sitting in the foreign cwd that is deliberately DIFFERENT
 * from the hub's — one extra skill, one bogus persona-sizes.json. Without the
 * decoy the test would pass on a machine where cwd resolution happens to find
 * nothing, which is how a wrong-tree bug hides.
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
let foreign: string;
let cfg: string;

/** Strip ANSI + absolute paths so two runs from different cwds are comparable. */
function normalize(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, "")
    .split(base).join("<BASE>")
    .replace(/\s+/g, " ")
    .trim();
}

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hubres-")));
  hub = path.join(base, "hub");
  foreign = path.join(base, "foreign");
  cfg = path.join(hub, "agentboot.config.json");
  fs.mkdirSync(foreign, { recursive: true });

  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);
  const b = ab(["build"], hub);
  if (b.status !== 0) throw new Error(`hub build failed: ${b.out}`);

  // The decoy. A foreign cwd holding its own ./dist is what turns "--config is
  // ignored for the tree" from a visible error into a silent wrong answer.
  fs.cpSync(path.join(hub, "dist"), path.join(foreign, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(foreign, "dist", "claude", "core", "skills", "DECOY-MARKER.md"),
    "---\nname: decoy\ndescription: foreign tree marker\n---\nDECOY\n",
  );
  fs.writeFileSync(
    path.join(foreign, "dist", "persona-sizes.json"),
    JSON.stringify({ personas: { "decoy-persona": 999999 } }),
  );
  // A distinguishable build stamp, so `status` — whose whole output about the
  // tree is the stamp — can actually tell the two apart. A copied stamp would
  // have let the status case pass while reading the wrong tree.
  const decoyStamp = path.join(foreign, "dist", ".agentboot-build.json");
  const stamp = JSON.parse(fs.readFileSync(decoyStamp, "utf-8")) as Record<string, unknown>;
  stamp["completedAt"] = "1999-01-01T00:00:00.000Z";
  stamp["builtAt"] = "1999-01-01T00:00:00.000Z";
  fs.writeFileSync(decoyStamp, JSON.stringify(stamp, null, 2));
  // The foreign cwd deliberately has no package.json and no core/ tree, so a
  // consumer that resolves either from cwd fails loudly rather than silently.
}, 900_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("L46: --config names the hub, and every consumer must act on THAT hub", () => {
  it("the decoy is genuinely different from the hub — otherwise this whole file is vacuous", () => {
    const hubSkills = fs.readdirSync(path.join(hub, "dist", "claude", "core", "skills"));
    const foreignSkills = fs.readdirSync(path.join(foreign, "dist", "claude", "core", "skills"));
    expect(foreignSkills.length).toBe(hubSkills.length + 1);
    expect(foreignSkills).toContain("DECOY-MARKER.md");
    expect(hubSkills).not.toContain("DECOY-MARKER.md");
  });

  it("install-user stages the HUB's tree, not the tree beside the operator", () => {
    const fromHub = ab(["install-user", "--dry-run"], hub);
    const fromForeign = ab(["install-user", "--dry-run", "--config", cfg], foreign);
    expect(fromHub.status, fromHub.out).toBe(0);
    expect(fromForeign.status, fromForeign.out).toBe(0);
    // The count is the tell: the decoy carries one extra skill file.
    expect(normalize(fromForeign.out)).toBe(normalize(fromHub.out));
    expect(fromForeign.out).not.toMatch(/DECOY/);
  }, 300_000);

  it("test --snapshot snapshots the HUB's tree, into the HUB", () => {
    const fromHub = ab(["test", "--snapshot", "--snapshot-file", ".snap-hub.json"], hub);
    const fromForeign = ab(
      ["test", "--snapshot", "--snapshot-file", ".snap-foreign.json", "--config", cfg],
      foreign,
    );
    expect(fromHub.status, fromHub.out).toBe(0);
    expect(fromForeign.status, fromForeign.out).toBe(0);

    // The baseline is hub state, so it belongs beside the hub — not wherever
    // the operator happened to stand. A snapshot written into the foreign cwd
    // would silently become the regression baseline for the wrong tree.
    const hubSnap = path.join(hub, ".snap-foreign.json");
    expect(fs.existsSync(hubSnap), "snapshot must land in the named hub").toBe(true);
    expect(fs.existsSync(path.join(foreign, ".snap-foreign.json"))).toBe(false);

    const a = JSON.parse(fs.readFileSync(path.join(hub, ".snap-hub.json"), "utf-8"));
    const b = JSON.parse(fs.readFileSync(hubSnap, "utf-8"));
    expect(b.entries.length).toBe(a.entries.length);
    expect(JSON.stringify(b.entries)).not.toMatch(/DECOY/);
  }, 300_000);

  it("cost-estimate prices the HUB's composed personas", () => {
    const fromHub = ab(["cost-estimate"], hub);
    const fromForeign = ab(["cost-estimate", "--config", cfg], foreign);
    expect(fromHub.status, fromHub.out).toBe(0);
    expect(fromForeign.status, fromForeign.out).toBe(0);
    expect(normalize(fromForeign.out)).toBe(normalize(fromHub.out));
    expect(fromForeign.out).not.toMatch(/decoy-persona/);
  }, 300_000);

  it("status reports on the HUB's dist/", () => {
    const fromHub = ab(["status"], hub);
    const fromForeign = ab(["status", "--config", cfg], foreign);
    expect(fromHub.status, fromHub.out).toBe(0);
    expect(fromForeign.status, fromForeign.out).toBe(0);
    expect(normalize(fromForeign.out)).toBe(normalize(fromHub.out));
  }, 300_000);

  it("doctor diagnoses the HUB, not the directory the operator is standing in", () => {
    const fromHub = ab(["doctor", "--format", "json"], hub);
    const fromForeign = ab(["doctor", "--format", "json", "--config", cfg], foreign);
    const a = JSON.parse(fromHub.out);
    const b = JSON.parse(fromForeign.out);
    expect(b.issuesFound).toBe(a.issuesFound);
    expect(b.checks.map((c: { name: string }) => c.name))
      .toEqual(a.checks.map((c: { name: string }) => c.name));
  }, 300_000);

  it("lint lints the HUB's sources and the HUB's compiled sizes", () => {
    const fromHub = ab(["lint", "--format", "json", "--severity", "info"], hub);
    const fromForeign = ab(["lint", "--format", "json", "--severity", "info", "--config", cfg], foreign);
    expect(fromForeign.status, fromForeign.out).toBe(fromHub.status);
    expect(JSON.parse(fromForeign.out)).toEqual(JSON.parse(fromHub.out));
    expect(fromForeign.out).not.toMatch(/decoy-persona/);
  }, 300_000);

  it("export packages the HUB's tree (and reads the HUB's package.json)", () => {
    const outHub = path.join(base, "idx-hub.json");
    const outForeign = path.join(base, "idx-foreign.json");
    const fromHub = ab(["export", "--format", "agentskills", "--output", outHub], hub);
    const fromForeign = ab(["export", "--format", "agentskills", "--output", outForeign, "--config", cfg], foreign);
    expect(fromHub.status, fromHub.out).toBe(0);
    // Pre-fix this threw ENOENT on the foreign cwd's absent package.json.
    expect(fromForeign.status, fromForeign.out).toBe(0);
    const stripTs = (p: string) => {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
      delete j["generatedAt"];
      return j;
    };
    // The `version` field comes from the hub's package.json — resolving that
    // from cwd is what made this command throw ENOENT off-hub.
    expect(stripTs(outForeign)).toEqual(stripTs(outHub));
    expect(JSON.parse(fs.readFileSync(outForeign, "utf-8")).skills.length).toBeGreaterThan(0);
  }, 300_000);
});
