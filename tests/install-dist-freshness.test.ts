/**
 * NF3-6 — `install` read dist/ six times, every one via `fs.existsSync`.
 *
 * Existence read as freshness, which is the exact pattern the dist-stamp
 * subsystem exists to kill: a failed build leaves the previous `dist/`
 * byte-identical, so existence proves a build happened ONCE, not that the tree
 * reflects current policy.
 *
 * It was invisible to the A-class DIST_CONSUMERS invariant because the
 * derivation parses cli.ts command blocks and `install`'s block is options plus
 * `.action(installAction)` — no `dist` token anywhere in it — while the reads
 * live in scripts/lib/install.ts. Same blind spot that hid `mcp-server`, one
 * import shape over.
 *
 * WHY THIS FILE AND NOT THE INVARIANT: A-2's `gateIn` branch greps the named
 * file for a gate call and a refusal token. Neutering the gate body (wrapping it
 * in `if (false)`) leaves both strings in place, so the invariant stayed green —
 * the same substring-vs-property trap NF4-4 found in A-2 for the CLI branch. The
 * registry entry is asserted structurally over there; the BEHAVIOUR is asserted
 * here, where a mutation can actually be caught.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { distIsActionable } from "../scripts/lib/install.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
let hub = "";
const stampPath = () => path.join(hub, "dist", ".agentboot-build.json");

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf36-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
  const b = spawnSync(process.execPath, [CLI, "build"], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("NF3-6 — install does not treat dist/'s existence as freshness", () => {
  it("NEGATIVE: a successfully built dist/ IS actionable", () => {
    // Without this, "always false" passes every case below and install simply
    // stops offering to deploy — an outage, not a gate.
    expect(distIsActionable(hub)).toBe(true);
  });

  it("NF3-6: a dist/ whose stamp says FAILED is not actionable", () => {
    const original = fs.readFileSync(stampPath(), "utf-8");
    const stamp = JSON.parse(original);
    stamp.status = "failed";
    fs.writeFileSync(stampPath(), JSON.stringify(stamp, null, 2));
    try {
      expect(
        distIsActionable(hub),
        "install offered to deploy from a tree whose own build stamp says it failed",
      ).toBe(false);
    } finally {
      fs.writeFileSync(stampPath(), original);
    }
  });

  it("NF3-6: a dist/ with NO stamp is not actionable", () => {
    const original = fs.readFileSync(stampPath(), "utf-8");
    fs.rmSync(stampPath());
    try {
      expect(distIsActionable(hub)).toBe(false);
    } finally {
      fs.writeFileSync(stampPath(), original);
    }
  });

  it("NF3-6: a dist/ with a MALFORMED stamp is not actionable", () => {
    const original = fs.readFileSync(stampPath(), "utf-8");
    fs.writeFileSync(stampPath(), "{ not json");
    try {
      expect(distIsActionable(hub), "an unreadable stamp read as a valid one").toBe(false);
    } finally {
      fs.writeFileSync(stampPath(), original);
    }
  });

  it("NEGATIVE: an absent dist/ is simply not actionable, quietly", () => {
    // A hub that has never been built is an ordinary state during onboarding —
    // it must not print a scary diagnostic, just decline the step.
    expect(distIsActionable(path.join(base, "never-built"))).toBe(false);
  });
});
