/**
 * Emitted SKILL.md frontmatter must carry only keys the Agent Skills spec allows.
 *
 * Q-CI-1. decision-0005 stamps `id`, `slug` and `hash` onto source personas. The
 * `dist/skill/` emitter passed composed content straight through, so all three
 * landed at the top level of every emitted SKILL.md — where the spec forbids
 * unknown keys. Both required CI legs failed identically:
 *
 *   Validation failed for dist/skill/core/ai-security-reviewer/:
 *     - Unexpected fields in frontmatter: hash, id, slug.
 *
 * **The local suite could not have caught it.** `skills-ref` is pinned to an
 * exact version and invoked only by the workflow, so the one authority on this
 * format never executes on a developer machine. It surfaced on the branch's
 * first CI run, 184 commits in — which is the argument for that gate in a
 * sentence: a build can be green everywhere it is cheap to look.
 *
 * This test is the local half. It does not re-implement the validator — it
 * asserts the one property the validator rejected us for, over the real emitted
 * tree, so the next stamped field fails here in seconds instead of in CI after a
 * push. The validator stays the authority; this is the fast feedback under it.
 *
 * The identity is preserved, not dropped: `metadata` is an allowed key and the
 * stamps live under it. Dropping them would have been the easier fix and would
 * have quietly cost the traceability the identity work exists to provide.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Pinned from skills-ref@0.1.5 — the version the merge gate runs. */
const ALLOWED = new Set([
  "allowed-tools", "compatibility", "description", "license", "metadata", "name",
]);

let dist = "";
let skills: string[] = [];

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-skillspec-"));
  const hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);

  // Build the REAL corpus, not a fixture — the defect was in the real personas.
  for (const d of ["core", "domains"]) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(hub, d), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, "agentboot.config.json"), path.join(hub, "agentboot.config.json"));

  const b = spawnSync(process.execPath, [CLI, "build", "--config", path.join(hub, "agentboot.config.json")], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 600_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);

  dist = path.join(hub, "dist", "skill");
  const root = path.join(dist, "core");
  skills = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "SKILL.md")))
        .map((e) => path.join(root, e.name, "SKILL.md"))
    : [];
});

/** Top-level frontmatter keys — nested keys belong to their parent. */
function topLevelKeys(file: string): string[] {
  const s = fs.readFileSync(file, "utf-8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---/.exec(s);
  if (!m) return [];
  return (m[1] ?? "")
    .split("\n")
    .filter((l) => /^[A-Za-z0-9_-]+:/.test(l))
    .map((l) => l.slice(0, l.indexOf(":")));
}

describe("emitted SKILL.md conforms to the Agent Skills frontmatter spec", () => {
  it("the build emitted skills at all — otherwise every case below is vacuous", () => {
    // The CI step this mirrors carries the same guard, for the same reason: a
    // layout change that emits nothing would turn a real gate into a green one.
    expect(skills.length).toBeGreaterThanOrEqual(3);
  });

  it("no emitted SKILL.md carries a top-level key the spec disallows", () => {
    const offenders: string[] = [];
    for (const f of skills) {
      for (const k of topLevelKeys(f)) {
        if (!ALLOWED.has(k)) offenders.push(`${path.relative(dist, f)}: ${k}`);
      }
    }
    expect(
      offenders,
      "skills-ref rejects any frontmatter key outside its allow-list, and it runs as a " +
        "merge gate. A new stamped field must go under `metadata:`, not at the top level:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("identity is PRESERVED under metadata rather than dropped", () => {
    // The failure mode of the obvious fix. Deleting id/slug/hash would also make
    // the validator pass, and would silently discard the traceability
    // decision-0005 exists to provide — so assert the identity is still there.
    const withMeta = skills.filter((f) => {
      const s = fs.readFileSync(f, "utf-8");
      return /^metadata:/m.test(s) && /^\s+id:\s*01/m.test(s) && /^\s+hash:\s*sha256:/m.test(s);
    });
    expect(withMeta.length).toBe(skills.length);
  });

  it("the detector can fail", () => {
    // A key outside the allow-list must be reported, and one inside it must not.
    const tmp = path.join(os.tmpdir(), `skillspec-probe-${process.pid}.md`);
    fs.writeFileSync(tmp, "---\nname: x\ndescription: y\nid: 01ABC\n---\n\nbody\n");
    expect(topLevelKeys(tmp).filter((k) => !ALLOWED.has(k))).toEqual(["id"]);
    fs.writeFileSync(tmp, "---\nname: x\ndescription: y\nmetadata:\n  id: 01ABC\n---\n\nbody\n");
    expect(topLevelKeys(tmp).filter((k) => !ALLOWED.has(k))).toEqual([]);
    fs.rmSync(tmp, { force: true });
  });
});
