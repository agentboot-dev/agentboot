/**
 * N1 — a failed build left `dist/` byte-identical and nothing recorded it.
 *
 * The repro that named this: revoke a control, watch the build fail, run
 * `agentboot sync`, get `skipped (no changes)` and exit 0. There genuinely were
 * no changes — because the build that was supposed to produce them never ran to
 * completion. The revoked control shipped, under a signed manifest, green.
 *
 * Staging (F-1) is the right blast-radius behaviour and the wrong TRUST
 * behaviour: "the previous tree survived intact" and "this tree is current" are
 * different facts and had the same on-disk signature. These tests pin the
 * sentinel that separates them.
 *
 * Per the standing norm, every case asserts BOTH directions — the fresh tree
 * must pass, or the gate is just an outage.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  DIST_STAMP_FILE,
  computeConfigDigest,
  writeDistStamp,
  readDistStamp,
  checkDistFreshness,
  checkDistStamp,
  computeSourceDigest,
} from "../scripts/lib/dist-stamp.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Run the real CLI. Returns status WITHOUT a pipe: a piped $? is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 180_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scaffoldHub(tag: string): { base: string; hub: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `agentboot-${tag}-`));
  const hub = path.join(base, "hub");
  const r = spawnSync(
    "node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);
  return { base, hub };
}

function editConfig(hub: string, fn: (c: Record<string, any>) => void): void {
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  fn(c);
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

function readConfig(hub: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(hub, "agentboot.config.json"), "utf-8"));
}

// ---------------------------------------------------------------------------
// Unit — the gate itself
// ---------------------------------------------------------------------------

describe("computeConfigDigest", () => {
  it("U1: is stable under key reordering — a re-serialized config is not a policy change", () => {
    expect(computeConfigDigest({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(computeConfigDigest({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("U2 (NEGATIVE): a real value change DOES move the digest", () => {
    // If this passes vacuously the whole staleness check is decorative.
    expect(computeConfigDigest({ personas: { outputFormats: ["claude"] } }))
      .not.toBe(computeConfigDigest({ personas: { outputFormats: ["claude", "copilot"] } }));
  });

  it("U3: array ORDER is significant — [a,b] is not [b,a]", () => {
    expect(computeConfigDigest({ x: ["a", "b"] })).not.toBe(computeConfigDigest({ x: ["b", "a"] }));
  });
});

describe("checkDistFreshness — fails closed on every unknown", () => {
  const cfg = { org: "acme", personas: { outputFormats: ["claude"] } };

  function tmpDist(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-stamp-"));
    fs.mkdirSync(path.join(d, "claude"), { recursive: true });
    return d;
  }

  // A hub with no artifact sources — its source digest is stable and empty, so
  // these cases isolate the CONFIG dimension from the SOURCE dimension.
  function tmpHub(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hubroot-"));
  }

  it("U4: NO stamp is untrusted — a tree of files is not evidence that it is current", () => {
    const d = tmpDist();
    // Stamp-only dimension: NF2-1 split these out precisely because they need
    // no config, and hiding them behind a config-presence check is what let
    // install-user and publish ship a failed tree at exit 0.
    const r = checkDistStamp(d);
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe("missing");
  });

  it("U5: a `failed` stamp is untrusted even when the digest matches", () => {
    const d = tmpDist();
    writeDistStamp(d, {
      status: "failed",
      configDigest: computeConfigDigest(cfg),
      outputFormats: ["claude"],
      builtAt: "2026-08-08T00:00:00.000Z",
      agentbootVersion: "0.0.0",
      failureReason: "boom",
    });
    const r = checkDistStamp(d);
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe("failed");
    expect(r.detail).toContain("boom");
  });

  it("U6: a stamp from a DIFFERENT config is untrusted — this is the revocation case", () => {
    const d = tmpDist();
    const hub = tmpHub();
    writeDistStamp(d, {
      status: "success",
      configDigest: computeConfigDigest({ ...cfg, personas: { outputFormats: ["claude", "copilot"] } }),
      sourceDigest: computeSourceDigest(hub),
      outputFormats: ["claude", "copilot"],
      builtAt: "2026-08-08T00:00:00.000Z",
      agentbootVersion: "0.0.0",
    });
    const r = checkDistFreshness(d, cfg, hub);
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe("config-stale");
  });

  it("U7: a malformed stamp reads as NO stamp, never as a pass", () => {
    const d = tmpDist();
    fs.writeFileSync(path.join(d, DIST_STAMP_FILE), "{not json");
    expect(readDistStamp(d)).toBeNull();
    expect(checkDistStamp(d).reason).toBe("missing");
  });

  it("U8: a stamp with an unrecognised status reads as NO stamp", () => {
    const d = tmpDist();
    fs.writeFileSync(
      path.join(d, DIST_STAMP_FILE),
      JSON.stringify({ status: "probably-fine", configDigest: computeConfigDigest(cfg) }),
    );
    expect(checkDistStamp(d).reason).toBe("missing");
  });

  it("U9 (NEGATIVE): a matching success stamp IS fresh — the gate is not a blanket refusal", () => {
    const d = tmpDist();
    const hub = tmpHub();
    writeDistStamp(d, {
      status: "success",
      configDigest: computeConfigDigest(cfg),
      sourceDigest: computeSourceDigest(hub),
      outputFormats: ["claude"],
      builtAt: "2026-08-08T00:00:00.000Z",
      agentbootVersion: "0.0.0",
    });
    expect(checkDistFreshness(d, cfg, hub).fresh).toBe(true);
    expect(checkDistStamp(d).fresh).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration — the real build
// ---------------------------------------------------------------------------

describe("N1 integration: the build stamps its own outcome", () => {
  it("I1: a successful build stamps success, at dist/ ROOT so sync can never ship it", () => {
    const { hub } = scaffoldHub("n1-ok");
    expect(ab(["build"], hub).status).toBe(0);

    const dist = path.join(hub, "dist");
    const stamp = readDistStamp(dist);
    expect(stamp).not.toBeNull();
    expect(stamp!.status).toBe("success");
    expect(stamp!.configDigest).toBe(computeConfigDigest(readConfig(hub)));
    expect(checkDistFreshness(dist, readConfig(hub), hub).fresh).toBe(true);

    // The stamp must live at the root, NOT inside a platform tree: sync copies
    // dist/<platform>/ wholesale, so a stamp one level deeper would be delivered
    // into every spoke.
    expect(fs.existsSync(path.join(dist, DIST_STAMP_FILE))).toBe(true);
    for (const p of fs.readdirSync(dist)) {
      const sub = path.join(dist, p);
      if (fs.statSync(sub).isDirectory()) {
        expect(fs.existsSync(path.join(sub, DIST_STAMP_FILE))).toBe(false);
      }
    }
  }, 300_000);

  it("I2: a FAILED build marks the surviving dist/ stale — the N1 repro", () => {
    const { hub } = scaffoldHub("n1-fail");
    expect(ab(["build"], hub).status).toBe(0);
    const dist = path.join(hub, "dist");

    const inventoryBefore = fs.readdirSync(dist).sort();
    expect(readDistStamp(dist)!.status).toBe("success");

    // Break the config so the build exits non-zero AFTER the invalidation hook
    // is armed but BEFORE the swap.
    editConfig(hub, (c) => {
      c.personas.outputFormats = [...c.personas.outputFormats, "no-such-platform"];
    });

    const build = ab(["build"], hub);
    expect(build.status).not.toBe(0);

    // F-1 still holds: the previous tree survived byte-identical...
    expect(fs.readdirSync(dist).sort()).toEqual(inventoryBefore);
    // ...but it is no longer claiming to be current. That is the whole fix.
    const after = readDistStamp(dist);
    expect(after!.status).toBe("failed");
    const check = checkDistFreshness(dist, readConfig(hub), hub);
    expect(check.fresh).toBe(false);
    expect(check.reason).toBe("failed");
  }, 300_000);

  it("I3: editing the config without rebuilding makes dist/ config-stale", () => {
    const { hub } = scaffoldHub("n1-stale");
    expect(ab(["build"], hub).status).toBe(0);
    const dist = path.join(hub, "dist");
    expect(checkDistFreshness(dist, readConfig(hub), hub).fresh).toBe(true);

    // A revocation the operator forgot to rebuild after.
    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });
    const check = checkDistFreshness(dist, readConfig(hub), hub);
    expect(check.fresh).toBe(false);
    expect(check.reason).toBe("config-stale");

    // ...and a successful rebuild clears it. Otherwise the gate is a one-way trap.
    expect(ab(["build"], hub).status).toBe(0);
    expect(checkDistFreshness(dist, readConfig(hub), hub).fresh).toBe(true);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Integration — the consumers refuse
// ---------------------------------------------------------------------------

function mkSpoke(base: string, name = "spoke"): string {
  const spoke = path.join(base, name);
  fs.mkdirSync(spoke, { recursive: true });
  fs.writeFileSync(path.join(spoke, ".keep"), "");
  spawnSync("git", ["init", "-q", "."], { cwd: spoke });
  return spoke;
}

describe("N1 integration: sync / drift-check / audit refuse a stale dist/", () => {
  it("I4: the exact N1 repro — revoke, build fails, sync must NOT report `no changes`", () => {
    const { base, hub } = scaffoldHub("n1-sync");
    mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude", scope: "core" }], null, 2),
    );

    expect(ab(["build"], hub).status).toBe(0);
    // Precondition: sync works at all against a FRESH dist. Without this the
    // test below cannot distinguish "the gate fired" from "sync was broken".
    expect(ab(["sync"], hub).status).toBe(0);

    // The operator revokes a control AND the rebuild fails.
    editConfig(hub, (c) => {
      c.instructions.enabled = ["baseline.instructions"];
      c.personas.outputFormats = [...c.personas.outputFormats, "no-such-platform"];
    });
    expect(ab(["build"], hub).status).not.toBe(0);

    const sync = ab(["sync"], hub);
    expect(sync.status).toBe(1);
    expect(sync.out).toContain("stale dist/");
    // The old behaviour, verbatim, is what must NOT happen.
    expect(sync.out).not.toMatch(/skipped \(no changes\)/);
  }, 300_000);

  it("I5: a dry run refuses too — a plan off a stale tree is a plan for the old policy", () => {
    const { base, hub } = scaffoldHub("n1-dry");
    mkSpoke(base);
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ name: "spoke", path: "../spoke", platform: "claude", scope: "core" }], null, 2),
    );
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["sync", "--dry-run"], hub).status).toBe(0);

    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });
    const dry = ab(["sync", "--dry-run"], hub);
    expect(dry.status).toBe(1);
    expect(dry.out).toContain("config-stale");
  }, 300_000);

  it("I6: drift-check and audit stop reporting green off a stale tree", () => {
    const { hub } = scaffoldHub("n1-report");
    expect(ab(["build"], hub).status).toBe(0);

    // Both must PASS on a fresh tree, or the assertions below prove nothing.
    expect(ab(["drift-check"], hub).status).toBe(0);
    expect(ab(["audit"], hub).status).toBe(0);

    editConfig(hub, (c) => { c.instructions.enabled = ["baseline.instructions"]; });

    const drift = ab(["drift-check"], hub);
    expect(drift.status).toBe(1);
    expect(drift.out).toContain("stale dist/");

    const audit = ab(["audit"], hub);
    expect(audit.status).toBe(1);
    expect(audit.out).toContain("stale dist/");

    // ...and both recover on a successful rebuild.
    expect(ab(["build"], hub).status).toBe(0);
    expect(ab(["drift-check"], hub).status).toBe(0);
    expect(ab(["audit"], hub).status).toBe(0);
  }, 300_000);

  it("I7: an UNBUILT hub is not stale — audit runs, and says it cannot speak to deployment", () => {
    const { hub } = scaffoldHub("n1-unbuilt");
    fs.rmSync(path.join(hub, "dist"), { recursive: true, force: true });
    const audit = ab(["audit"], hub);
    expect(audit.status).toBe(0);
    // "I checked nothing" must not print the same as "I checked and it was fine".
    expect(audit.out).toContain("never been built");
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The digest must not fire on config that cannot change the build
// ---------------------------------------------------------------------------

describe("computeConfigDigest — build-affecting keys only", () => {
  it("U10: changing `sync.*` does NOT move the digest", () => {
    // sync governs DELIVERY; compile.ts never reads it. Marking a
    // byte-for-byte-correct dist/ stale because the operator enabled manifest
    // signing is a false positive, and a staleness error that fires when
    // nothing is stale trains people to ignore the real one.
    const base = { org: "acme", personas: { outputFormats: ["claude"] } };
    expect(computeConfigDigest({ ...base, sync: { signing: { enabled: false } } }))
      .toBe(computeConfigDigest({ ...base, sync: { signing: { enabled: true }, repos: "./r.json" } }));
    expect(computeConfigDigest({ ...base, sync: { pr: { enabled: true } } }))
      .toBe(computeConfigDigest(base));
  });

  it("U11 (NEGATIVE): every OTHER key still moves it — the exclusion is a deny-list", () => {
    // A config key added later must be included by default. Over-reporting
    // staleness costs a rebuild; under-reporting ships the wrong policy.
    const base: Record<string, unknown> = { org: "acme", sync: { repos: "./r.json" } };
    for (const [k, v] of Object.entries({
      personas: { outputFormats: ["claude"] },
      managed: { enabled: true },
      compliance: { outputScan: { blocking: true } },
      instructions: { enabled: ["baseline.instructions"] },
      somethingAddedLater: { x: 1 },
    })) {
      expect(computeConfigDigest({ ...base, [k]: v }), k).not.toBe(computeConfigDigest(base));
    }
  });
});
