/**
 * R2-5 — corrupting one JSON file in a spoke turned revocation off, silently.
 *
 * `.agentboot-manifest.json` is the ONLY record of what AgentBoot previously
 * delivered to a spoke. Every reader in sync.ts collapsed a parse failure into
 * the same value as "no manifest, first sync" — `loadManifestHashes` returned
 * null under the comment *"Corrupt manifest — sync as normal"*. But losing that
 * record does not degrade sync to "write everything again"; it degrades sync to
 * **write everything again and delete nothing**.
 *
 * Reproduced end to end on two spokes, one hub, one revocation (drop
 * `security.instructions` from `instructions.enabled`):
 *
 *   manifest intact
 *     ✓ spokeY (claude) — 3 written, 27 unchanged, 1 removed
 *     spokeY/.claude/rules/ → baseline.instructions.md
 *
 *   manifest replaced with `{ "files": [ ,,,`
 *     SYNC_FORCE_EXIT=0
 *     ✓ spokeX (claude) — 3 written, 27 unchanged        ← no "removed"
 *     spokeX/.claude/rules/ → baseline.instructions.md  security.instructions.md
 *     drift-check EXIT 0  "1/1 clean, 0 drifted, 0 UNCHECKED"
 *
 * The revoked control is still live; sync then rewrote the manifest, RE-ADOPTING
 * it as a legitimately managed artifact and signing it — so drift-check reports
 * clean precisely because the evidence of the revocation was destroyed.
 *
 * The path is documented, too: B9's import-first guard fires (no hashes ⇒ every
 * file looks locally modified) and tells the operator *"To override: agentboot
 * sync --force"*, and `--force` completes the hole.
 *
 * The prune site already printed a loud skip line for the platform-mismatch
 * case, but was written `if (prevManifest !== null && !prunable)` — and in the
 * corrupt case `prevManifest` IS null, so it took the silent branch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
let hub = "";

function run(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function setEnabledInstructions(list: string[]): void {
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
  (cfg["instructions"] as Record<string, unknown>)["enabled"] = list;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  expect(run(["build"], hub).status, "rebuild after a config change").toBe(0);
}

/** Seed a fresh spoke with both instructions delivered. */
function seedSpoke(name: string): string {
  const spoke = path.join(base, name);
  fs.mkdirSync(spoke, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: spoke, encoding: "utf-8" });
  fs.writeFileSync(
    path.join(hub, "repos.json"),
    JSON.stringify([{ path: `../${name}`, label: name, platform: "claude" }], null, 2),
  );
  setEnabledInstructions(["baseline.instructions", "security.instructions"]);
  run(["sync", "--force"], hub);
  expect(
    fs.existsSync(path.join(spoke, ".claude", "rules", "security.instructions.md")),
    "seed must deliver the control that is later revoked",
  ).toBe(true);
  return spoke;
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r2-corrupt-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
  (cfg["personas"] as Record<string, unknown>)["outputFormats"] = ["claude"];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}, 300_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("R2-5 — an unreadable spoke manifest is not an absent one", () => {
  it("POSITIVE (control): with the manifest intact, revocation propagates and sync exits 0", () => {
    const spoke = seedSpoke("spokeIntact");
    setEnabledInstructions(["baseline.instructions"]);
    const s = run(["sync", "--force"], hub);
    expect(s.status, s.out).toBe(0);
    expect(s.out).toMatch(/removed/);
    expect(
      fs.existsSync(path.join(spoke, ".claude", "rules", "security.instructions.md")),
      "the revoked control survived a sync with a good manifest — the control case is broken",
    ).toBe(false);
  }, 300_000);

  it("NEGATIVE: a corrupt manifest makes the skipped revocation an ERROR, named", () => {
    const spoke = seedSpoke("spokeCorrupt");
    const manifest = path.join(spoke, ".claude", ".agentboot-manifest.json");
    expect(fs.existsSync(manifest)).toBe(true);
    fs.writeFileSync(manifest, '{ "files": [ ,,,');

    setEnabledInstructions(["baseline.instructions"]);
    const s = run(["sync", "--force"], hub);

    // The revoked control still cannot be removed — the record of it is gone.
    // What must NOT happen is that being reported as a successful sync.
    expect(s.status, `sync reported success while revocation was skipped:\n${s.out}`).toBe(1);
    expect(s.out).toContain("could not be parsed");
    expect(s.out).toContain("REMAINS LIVE");
    expect(
      fs.existsSync(path.join(spoke, ".claude", "rules", "security.instructions.md")),
      "precondition of the finding: the control does survive; the fix is that we SAY SO",
    ).toBe(true);
  }, 300_000);

  it("NEGATIVE: an unparseable manifest is distinguished from an absent one", () => {
    // A genuinely absent manifest is a first sync — legitimate, exit 0, silent.
    const spoke = path.join(base, "spokeFirst");
    fs.mkdirSync(spoke, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: spoke, encoding: "utf-8" });
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ path: "../spokeFirst", label: "spokeFirst", platform: "claude" }], null, 2),
    );
    setEnabledInstructions(["baseline.instructions"]);
    const s = run(["sync", "--force"], hub);
    expect(s.status, s.out).toBe(0);
    expect(s.out).not.toContain("could not be parsed");
  }, 300_000);
});
