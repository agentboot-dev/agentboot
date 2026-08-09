/**
 * R2-7 — "has anything changed since the build" is a DIGEST question, and the
 * audit answered it with mtimes.
 *
 * checkManifestDrift compared source mtimes against the newest mtime under
 * dist/. Two ways that was wrong in the same direction — quiet:
 *
 *   * mtime is not evidence of content. Appending to a persona SKILL.md and then
 *     `touch -t 202001010000` rewinds the mtime below dist/ and the walk reports
 *     nothing. (The `audit` COMMAND still refused, because it is gated on
 *     assertDistFreshOrExit, which is digest-based. That gate is why this was
 *     LOW — not a reason the check was fine, and the gate is exactly what makes
 *     the defect invisible from the CLI, so these tests call the check directly.)
 *   * walkSource covered only core/{traits,personas,instructions,gotchas}. A
 *     scaffolded hub has all four EMPTY, so the comparison examined ZERO source
 *     files and said nothing at all. NF4-2's `newestDistMtime === 0` guard
 *     covered the DIST side of that vacuity and not the SOURCE side.
 *
 * NF4-2 also observed that the `newestDistMtime === 0` half of 8cf8a26 was
 * unasserted: reverting it left the entire 1995-test suite green. The
 * "could not compare" cases below are that assertion, now against the digest
 * form of the same guard.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { runAudit } from "../scripts/lib/audit.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
let hub = "";

const driftFindings = () =>
  runAudit(hub).findings.filter((f) => f.type === "manifest-drift");

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r27-"));
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

describe("R2-7 — the audit's staleness check agrees with the authoritative one", () => {
  it("PRECONDITION: a freshly built hub reports no drift", () => {
    // Without this the whole suite could pass by always reporting drift.
    expect(driftFindings()).toEqual([]);
  });

  it("R2-7: an edit with a REWOUND mtime is still caught", () => {
    const f = path.join(hub, "core", "personas", "locked-reviewer", "SKILL.md");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "---\nname: locked\n---\n# L\nNever log a PAN.\n");
    // The mtime says this file predates dist/ by 26 years. Its CONTENT does not.
    fs.utimesSync(f, new Date("2000-01-01"), new Date("2000-01-01"));
    const found = driftFindings();
    expect(found.length, "an mtime-rewound edit reported clean").toBeGreaterThan(0);
    expect(found.map((x) => x.message).join("\n")).toMatch(/sources have changed/i);
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  });

  it("R2-7: DELETING a source artifact is drift too — revocation is an edit", () => {
    // An mtime walk cannot see a deletion at all: there is no file left to stat.
    // A scaffolded hub's core/ dirs are EMPTY (that is the vacuity half of this
    // finding), so the artifact is created, built in, and then removed.
    const abs = path.join(hub, "core", "instructions", "zz-revoke.instructions.md");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '---\ndescription: zz\napplyTo: "**"\n---\n# zz\nNever log a PAN.\n');
    const b = spawnSync(process.execPath, [CLI, "build"], {
      cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
    });
    expect(b.status, `${b.stdout}${b.stderr}`).toBe(0);
    expect(driftFindings(), "precondition: built state is clean").toEqual([]);

    fs.rmSync(abs);
    try {
      expect(driftFindings().length, "a revoked artifact reported clean").toBeGreaterThan(0);
    } finally {
      const b2 = spawnSync(process.execPath, [CLI, "build"], {
        cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
      });
      expect(b2.status).toBe(0);
    }
  }, 900_000);

  it("R2-7: a change under nodes/ is seen — the four hardcoded dirs were not the surface", () => {
    const f = path.join(hub, "nodes", "zz", "instructions", "zz.instructions.md");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "---\ndescription: zz\n---\n# zz\nbody\n");
    try {
      expect(driftFindings().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(path.join(hub, "nodes", "zz"), { recursive: true, force: true });
    }
  });

  it("NF4-2: dist/ with NO source digest SAYS the comparison did not run", () => {
    // "I could not compare" must not print identically to "nothing is stale".
    const stampPath = path.join(hub, "dist", ".agentboot-build.json");
    const original = fs.readFileSync(stampPath, "utf-8");
    const stamp = JSON.parse(original);
    delete stamp.sourceDigest;
    fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2));
    try {
      const found = driftFindings();
      expect(found.length, "a tree with no digest reported clean").toBeGreaterThan(0);
      expect(found[0]!.message).toMatch(/did NOT run/);
      expect(found[0]!.message).toMatch(/not evidence that dist\/ is current/);
    } finally {
      fs.writeFileSync(stampPath, original);
    }
  });

  it("NF4-2: an UNREADABLE config says so rather than reporting a drift it caused", () => {
    // Domain roots are configurable, so an unreadable config means the digest
    // would cover a smaller tree than the build used and mismatch for the wrong
    // reason. Reporting that as drift sends the operator to rebuild forever.
    const cfg = path.join(hub, "agentboot.config.json");
    const original = fs.readFileSync(cfg, "utf-8");
    fs.writeFileSync(cfg, "{ not json");
    try {
      const found = driftFindings();
      expect(found.length).toBeGreaterThan(0);
      expect(found.map((f) => f.message).join("\n")).toMatch(/did NOT run/);
    } finally {
      fs.writeFileSync(cfg, original);
    }
  });

  it("NEGATIVE: rebuilding clears it — the check is not a permanent warning", () => {
    const f = path.join(hub, "core", "gotchas", "zz.md");
    fs.writeFileSync(f, '---\ndescription: zz\npaths: "src/**"\n---\nrule\n');
    expect(driftFindings().length).toBeGreaterThan(0);
    const b = spawnSync(process.execPath, [CLI, "build"], {
      cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
    });
    expect(b.status, `${b.stdout}${b.stderr}`).toBe(0);
    expect(driftFindings(), "drift survived a successful rebuild").toEqual([]);
  }, 600_000);
});
