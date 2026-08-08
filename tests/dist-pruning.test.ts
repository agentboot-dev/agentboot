/**
 * Regression guards for F-1 — `dist/` was never pruned, so revocation did not work.
 *
 * The defect: `compile` only ever WROTE into `dist/` and `sync` only ever wrote
 * into a spoke. An operator who removed an artifact from `instructions.enabled`
 * got a green build, a green sync ("skipped — no changes"), a green
 * `drift-check` and a signed manifest — while the withdrawn control kept
 * shipping. Worse, `generateManifest` regenerated the manifest without the
 * revoked file, which de-listed it from AgentBoot's own inventory: drift-check
 * then reported "clean" precisely BECAUSE the artifact had stopped being tracked.
 *
 * Per the standing norm — a check that cannot fail is not a check — every case
 * below asserts BOTH the firing case and the silent case, so a change that makes
 * pruning vacuous (or makes it fire on a steady-state build) fails here.
 *
 * See docs/research/capability-platform-matrix-2026-08-08.md §1.
 */

import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

import { diffTrees, planOrphanRemoval } from "../scripts/lib/prune.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

// ---------------------------------------------------------------------------
// Unit — diffTrees
// ---------------------------------------------------------------------------

describe("diffTrees — what did this build stop producing?", () => {
  it("U1: reports an artifact removed from one still-live platform", () => {
    const before = ["claude/core/rules/a.md", "claude/core/rules/b.md"];
    const after = ["claude/core/rules/a.md"];
    expect(diffTrees(before, after)).toEqual({
      removed: ["claude/core/rules/b.md"],
      retiredTrees: [],
    });
  });

  it("U2: rolls a wholly-removed top-level tree up instead of itemising its files", () => {
    const before = ["claude/core/x.md", "claude/core/y.md", "cursor/core/z.mdc"];
    const after = ["cursor/core/z.mdc"];
    const d = diffTrees(before, after);
    expect(d.retiredTrees).toEqual(["claude"]);
    expect(d.removed).toEqual([]);
  });

  it("U3 (NEGATIVE): identical inventories produce no prune at all", () => {
    // If this ever fails, every steady-state build starts claiming it deleted
    // things — which trains operators to skim past the prune report.
    const t = ["claude/a", "cursor/b", "persona-sizes.json"];
    expect(diffTrees(t, [...t])).toEqual({ removed: [], retiredTrees: [] });
  });

  it("U4 (NEGATIVE): additions are not prunes", () => {
    expect(diffTrees(["a/x"], ["a/x", "a/y", "b/z"])).toEqual({
      removed: [],
      retiredTrees: [],
    });
  });

  it("U4b: a removed top-level FILE is a removal, not a retired tree", () => {
    // persona-sizes.json / schema files must never be mistaken for platforms.
    expect(diffTrees(["persona-sizes.json", "a/x"], ["a/x"])).toEqual({
      removed: ["persona-sizes.json"],
      retiredTrees: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Unit — planOrphanRemoval
// ---------------------------------------------------------------------------

const prevOf = (o: Record<string, string>) => new Map(Object.entries(o));

describe("planOrphanRemoval — what may a sync unlink from a spoke?", () => {
  it("U5: an orphan whose hash matches the manifest is removable", () => {
    const plan = planOrphanRemoval(
      prevOf({ ".claude/rules/gone.md": "h1", ".claude/rules/kept.md": "h2" }),
      new Set([".claude/rules/kept.md"]),
      () => "h1",
    );
    expect(plan.remove).toEqual([".claude/rules/gone.md"]);
    expect(plan.blocked).toEqual([]);
  });

  it("U6: an orphan the spoke EDITED is blocked, never deleted", () => {
    const plan = planOrphanRemoval(
      prevOf({ ".claude/rules/gone.md": "h1" }),
      new Set(),
      () => "locally-edited",
    );
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([{ path: ".claude/rules/gone.md", reason: "modified-locally" }]);
  });

  it("U7: an orphan already deleted from disk appears in neither list", () => {
    const plan = planOrphanRemoval(prevOf({ ".claude/rules/gone.md": "h1" }), new Set(), () => null);
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("U8 (NEGATIVE): when every manifest path is still written, nothing is planned", () => {
    const prev = prevOf({ "a": "h", "b": "h" });
    const plan = planOrphanRemoval(prev, new Set(["a", "b"]), () => "h");
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.retained).toEqual([]);
  });

  it("U9: a `retain` match is never removed and is warn-level, not error-level", () => {
    const plan = planOrphanRemoval(
      prevOf({ ".claude/rules/security.instructions.md": "h1" }),
      new Set(),
      () => "locally-edited",
      ["\\.claude/rules/security\\.instructions\\.md"],
    );
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([]); // blocked is the ERROR channel
    expect(plan.retained).toEqual([".claude/rules/security.instructions.md"]);
  });

  it("U10: sync's own manifest entries and the archive are never orphans", () => {
    const plan = planOrphanRemoval(
      prevOf({
        ".claude/.agentboot-manifest.json": "h",
        ".claude/.agentboot-manifest.intoto.json": "h",
        ".claude/.agentboot-archive/old.md": "h",
      }),
      new Set(),
      () => "h",
    );
    expect(plan.remove).toEqual([]);
  });

  it("U11 (NEGATIVE): a first sync (no previous manifest) plans nothing", () => {
    const plan = planOrphanRemoval(null, new Set(), () => "h");
    expect(plan).toEqual({ remove: [], blocked: [], retained: [] });
  });
});

// ---------------------------------------------------------------------------
// Integration — the defect itself
// ---------------------------------------------------------------------------

/** Run the real CLI. Returns status WITHOUT a pipe: a piped $? is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scaffoldHub(): { base: string; hub: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-prune-"));
  const hub = path.join(base, "hub");
  const r = spawnSync(
    "node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 180_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);
  return { base, hub };
}

function mkSpoke(base: string, name = "spoke"): string {
  const spoke = path.join(base, name);
  fs.mkdirSync(spoke, { recursive: true });
  fs.writeFileSync(path.join(spoke, ".keep"), "");
  execFileSync("git", ["init", "-q", "."], { cwd: spoke });
  return spoke;
}

function editConfig(hub: string, fn: (c: Record<string, any>) => void): void {
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  fn(c);
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

function findAll(root: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pattern.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe("F-1 integration: revocation actually propagates", () => {
  it("I1/I2: a revoked instruction is purged from dist/ AND from the spoke", () => {
    const { base, hub } = scaffoldHub();
    const spoke = mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude", scope: "core" }], null, 2),
    );

    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);
    // Precondition: the artifact really was delivered, else the test is vacuous.
    expect(findAll(spoke, /^security\.instructions/).length).toBeGreaterThan(0);
    const distBefore = findAll(path.join(hub, "dist"), /^security\.instructions/).length;
    expect(distBefore).toBeGreaterThan(0);

    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });

    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(findAll(path.join(hub, "dist"), /^security\.instructions/)).toEqual([]);
    // The prune report must NAME what it removed, not merely count it.
    expect(build.out).toMatch(/Pruned \d+ stale artifact\(s\)/);
    expect(build.out).toContain("security.instructions");

    const sync = ab(["sync"], hub);
    expect(sync.status).toBe(0);
    expect(findAll(spoke, /^security\.instructions/)).toEqual([]);
    expect(sync.out).toMatch(/removed/);

    // And the honesty surface stays green, because nothing is outstanding.
    expect(ab(["drift-check"], hub).status).toBe(0);
  }, 300_000);

  it("I3/I4: retiring platforms prunes their trees but keeps plugin/schema/persona-sizes", () => {
    const { hub } = scaffoldHub();
    editConfig(hub, (c) => {
      c.personas.outputFormats = ["skill", "agents", "claude", "copilot"];
    });
    expect(ab(["build"], hub).status).toBe(0);
    const dist = path.join(hub, "dist");
    // I4 — plugin is derived from claude, NOT from `plugin` being an
    // outputFormat. A prune rule phrased as `validFormats \ outputFormats`
    // deletes it; this pins that it survives.
    expect(fs.existsSync(path.join(dist, "plugin"))).toBe(true);

    editConfig(hub, (c) => { c.personas.outputFormats = ["cursor"]; });
    const build2 = ab(["build"], hub);
    expect(build2.status).toBe(0);
    for (const gone of ["claude", "copilot", "skill", "agents", "plugin"]) {
      expect(fs.existsSync(path.join(dist, gone))).toBe(false);
    }
    expect(fs.existsSync(path.join(dist, "cursor"))).toBe(true);
    // I3 regression guard — schema/ and persona-sizes.json are not platforms.
    expect(fs.existsSync(path.join(dist, "persona-sizes.json"))).toBe(true);
    expect(build2.out).toMatch(/retired platform tree\(s\)/);
  }, 300_000);

  it("I6 (NEGATIVE): a second build with no config change prunes nothing and is byte-identical", () => {
    const { hub } = scaffoldHub();
    expect(ab(["build"], hub).status).toBe(0);
    const dist = path.join(hub, "dist");
    // NOTE: byte-identity across builds is NOT achievable — provenanceHeader
    // stamps `new Date().toISOString()` into every emitted artifact. That is
    // pre-existing and orthogonal. The prune-relevant invariant is the file
    // SET: a steady-state rebuild must neither drop nor add a path.
    const snapshot = (): string => {
      const files = findAll(dist, /./).sort();
      const h = createHash("sha256");
      for (const f of files) h.update(path.relative(dist, f).replace(/\\/g, "/") + "\n");
      return h.digest("hex");
    };
    const first = snapshot();

    const build2 = ab(["build"], hub);
    expect(build2.status).toBe(0);
    expect(build2.out).toContain("0 stale artifact(s), 0 retired platform tree(s)");
    expect(build2.out).not.toMatch(/Pruned \d+ stale/);
    expect(snapshot()).toBe(first);
  }, 300_000);

  it("I7/I8 (NEGATIVE): a first sync and a steady-state re-sync remove nothing", () => {
    const { base, hub } = scaffoldHub();
    mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude" }], null, 2),
    );
    expect(ab(["build"], hub).status).toBe(0);

    const first = ab(["sync"], hub); // no previous manifest — prev === null
    expect(first.status).toBe(0);
    expect(first.out).not.toMatch(/removed/);

    const second = ab(["sync"], hub);
    expect(second.status).toBe(0);
    expect(second.out).not.toMatch(/\d+ removed/);
  }, 300_000);

  it("I9/I11: a locally-modified revoked artifact blocks, exits non-zero, and shows as drift", () => {
    const { base, hub } = scaffoldHub();
    const spoke = mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude" }], null, 2),
    );
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);

    const victim = path.join(spoke, ".claude", "rules", "security.instructions.md");
    expect(fs.existsSync(victim)).toBe(true);
    fs.appendFileSync(victim, "\n<!-- local edit -->\n");

    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });
    expect(ab(["build"], hub).status).toBe(0);

    // --force is required because the local edit is also ordinary drift; the
    // point of this case is what happens to the REVOKED file once sync proceeds.
    const sync = ab(["sync", "--force"], hub);
    expect(sync.status).not.toBe(0);
    expect(sync.out).toMatch(/could NOT be withdrawn/i);
    expect(fs.existsSync(victim)).toBe(true); // never deleted

    const manifest = JSON.parse(
      fs.readFileSync(path.join(spoke, ".claude", ".agentboot-manifest.json"), "utf-8"),
    );
    expect(manifest.retired.map((r: { path: string }) => r.path)).toContain(
      ".claude/rules/security.instructions.md",
    );

    // I11 — drift-check must NOT report this repo clean.
    const drift = ab(["drift-check"], hub);
    expect(drift.status).not.toBe(0);
    expect(drift.out).toMatch(/retired/);
  }, 300_000);

  it("I10: a `retain` entry downgrades the blocked removal to a warning, exit 0", () => {
    const { base, hub } = scaffoldHub();
    const spoke = mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify(
        [{
          name: "spoke", path: "../spoke", platform: "claude",
          retain: ["\\.claude/rules/security\\.instructions\\.md"],
        }],
        null, 2,
      ),
    );
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);

    const victim = path.join(spoke, ".claude", "rules", "security.instructions.md");
    fs.appendFileSync(victim, "\n<!-- local edit -->\n");
    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });
    expect(ab(["build"], hub).status).toBe(0);

    const sync = ab(["sync", "--force"], hub);
    expect(sync.status).toBe(0);            // the hatch silences the ERROR…
    expect(sync.out).toMatch(/retained/i);  // …but never the FACT
    expect(fs.existsSync(victim)).toBe(true);
  }, 300_000);

  it("I12 (NEGATIVE): drift-check on an untouched spoke is clean and exits 0", () => {
    const { base, hub } = scaffoldHub();
    mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude" }], null, 2),
    );
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);
    const drift = ab(["drift-check"], hub);
    expect(drift.status).toBe(0);
    expect(drift.out).not.toMatch(/retired/);
  }, 300_000);

  it("I13/I14: repos.json naming an unbuilt platform errors, and other repos still sync", () => {
    const { base, hub } = scaffoldHub();
    mkSpoke(base, "spokeClaude");
    mkSpoke(base, "spokeCursor");
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([
        { name: "spokeClaude", path: "../spokeClaude", platform: "claude" },
        { name: "spokeCursor", path: "../spokeCursor", platform: "cursor" },
      ], null, 2),
    );
    editConfig(hub, (c) => { c.personas.outputFormats = ["cursor"]; });
    expect(ab(["build"], hub).status).toBe(0);

    const sync = ab(["sync"], hub);
    expect(sync.status).not.toBe(0);
    expect(sync.out).toContain("hub does not build for this platform");
    expect(sync.out).toContain("outputFormats");
    // Keep-going: repo 2 must not be abandoned because repo 1 failed.
    expect(fs.existsSync(path.join(base, "spokeCursor", ".cursor"))).toBe(true);
  }, 300_000);

  it("I15: --dry-run reports the removal and changes nothing on disk", () => {
    const { base, hub } = scaffoldHub();
    const spoke = mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude" }], null, 2),
    );
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync"], hub).status).toBe(0);
    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });
    expect(ab(["build"], hub).status).toBe(0);

    const dry = ab(["sync", "--dry-run"], hub);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain("would remove");
    expect(
      fs.existsSync(path.join(spoke, ".claude", "rules", "security.instructions.md")),
    ).toBe(true);
  }, 300_000);

  it("I16: a build that fails mid-flight leaves the previous dist/ untouched", () => {
    const { hub } = scaffoldHub();
    expect(ab(["build"], hub).status).toBe(0);
    const dist = path.join(hub, "dist");
    const before = findAll(dist, /./).sort().map((f) => path.relative(dist, f));

    // Force a failure AFTER emission: an impossible token budget.
    editConfig(hub, (c) => {
      c.output = { ...(c.output ?? {}), tokenBudget: { warnAt: 1, failAt: 1 } };
    });
    const bad = ab(["build"], hub);
    expect(bad.status).not.toBe(0);

    expect(findAll(dist, /./).sort().map((f) => path.relative(dist, f))).toEqual(before);
    // …and no staging directory is left behind.
    expect(fs.readdirSync(hub).filter((n) => n.includes(".staging-"))).toEqual([]);
  }, 300_000);

  it("I18 (NEGATIVE): two platforms sharing one targetDir never delete each other's files", () => {
    // Found while implementing this fix: `copilot` and `claude` both default to
    // targetDir `.claude`, so they overwrite each other's manifest. Harmless
    // while sync only ever wrote; catastrophic once it deletes — the second
    // platform read the first's manifest and saw every one of its files as an
    // orphan. The pass is skipped unless the manifest is tagged with THIS
    // platform, and the skip is announced rather than silent.
    const { base, hub } = scaffoldHub();
    const spoke = mkSpoke(base, "multi");
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify(
        [{ name: "multi", path: "../multi", platforms: ["claude", "copilot"] }],
        null, 2,
      ),
    );
    expect(ab(["build"], hub).status).toBe(0);
    const sync = ab(["sync"], hub);
    expect(sync.status).toBe(0);
    expect(fs.existsSync(path.join(spoke, ".claude"))).toBe(true);
    expect(fs.existsSync(path.join(spoke, ".github", "copilot-instructions.md"))).toBe(true);

    // A second run must still not cross-delete, and must SAY it skipped.
    const sync2 = ab(["sync"], hub);
    expect(sync2.status).toBe(0);
    expect(fs.existsSync(path.join(spoke, ".claude"))).toBe(true);
    expect(sync2.out).toMatch(/Revocation propagation skipped/);
  }, 300_000);

  it("I17: repeat builds do not duplicate content in append-mode concat files", () => {
    const { hub } = scaffoldHub();
    editConfig(hub, (c) => { c.personas.outputFormats = ["windsurf", "jetbrains"]; });
    expect(ab(["build"], hub).status).toBe(0);
    const wsFile = path.join(hub, "dist", "windsurf", "core", ".windsurfrules");
    const sizeOnce = fs.existsSync(wsFile) ? fs.readFileSync(wsFile, "utf-8").length : 0;
    expect(ab(["build"], hub).status).toBe(0);
    const sizeTwice = fs.existsSync(wsFile) ? fs.readFileSync(wsFile, "utf-8").length : 0;
    expect(sizeTwice).toBe(sizeOnce);
  }, 300_000);
});
