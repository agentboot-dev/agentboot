/**
 * AB-DEF-9 and the class behind it — A DOCUMENTED FLAG THAT NOTHING CONSUMES.
 *
 * `agentboot sync --repos-file <path>` is the documented way to scope a sync to
 * a subset of spokes. `cli.ts` declared the option and forwarded it to the sync
 * script as `--repos`. `sync.ts` parsed `--config`, `--dry-run`, `--force`,
 * `--mode`, `--repo` and `--adopt-existing` — and nothing else. The `--repo`
 * loop uses strict equality, so `--repos` did not match it either. The argv pair
 * was dropped in silence and the target list came from `config.sync.repos`.
 *
 * What the operator got: a sync scoped to one spoke wrote to the ENTIRE
 * configured fleet, produced and signed a manifest on every unintended spoke,
 * and exited 0 with a success report. `--dry-run` inherited the identical hole,
 * so the rehearsal that exists to catch exactly this previewed the wrong fleet.
 *
 * The only trace of the flag inside sync.ts was a usage comment describing a
 * parser that did not exist — which is the tell for this whole class: the
 * documentation and the declaration are the artifacts people read, and neither
 * of them is the thing that has to be true.
 *
 * SO THIS FILE IS TWO TESTS, AND THE SECOND ONE IS THE POINT.
 *
 *   1. A regression guard on `--repos` specifically.
 *   2. AN INVARIANT over EVERY flag `cli.ts` forwards: if the CLI pushes it into
 *      a script's argv, that script must reference it. A flag added tomorrow and
 *      forwarded to a parser that ignores it fails here, without anyone
 *      remembering this defect existed.
 *
 * Ratified as gate condition E11 (2026-08-11): a defect class caught only by
 * humans is closed by a mechanism, never by another instance patch.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

// ---------------------------------------------------------------------------
// 1 · The invariant — every forwarded flag is consumed by its target script
// ---------------------------------------------------------------------------

/**
 * Every `args.push("--flag" …)` in cli.ts, paired with the `runScript({script})`
 * it is forwarded to.
 *
 * Deliberately derived from the source rather than hand-listed: a hand-listed
 * pair of tables (flags cli.ts forwards, flags this test knows about) drifts, and
 * the flag added next quarter would be exempt by default — which is the same
 * "one half was taught" shape the defect came from.
 */
function forwardedFlags(): Array<{ script: string; flag: string }> {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");
  const out: Array<{ script: string; flag: string }> = [];

  // Each command action ends in a runScript({ script: "x.ts", ... }) call.
  // Split on those boundaries and attribute the pushes that precede each one.
  const scriptRe = /runScript\(\{\s*script:\s*"([^"]+)"/g;
  let prev = 0;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(src)) !== null) {
    const segment = src.slice(prev, m.index);
    prev = scriptRe.lastIndex;
    const script = m[1]!;
    const pushRe = /args\.push\(\s*"(--[a-zA-Z0-9-]+)"/g;
    let p: RegExpExecArray | null;
    while ((p = pushRe.exec(segment)) !== null) {
      out.push({ script, flag: p[1]! });
    }
  }
  return out;
}

describe("flag-consumption invariant — a forwarded flag must be parsed", () => {
  const pairs = forwardedFlags();

  it("the extractor finds real forwarding pairs (a vacuous invariant is not one)", () => {
    // Guards the guard. If cli.ts is restructured and the regex stops matching,
    // this file would pass by finding nothing — the exact failure mode that let
    // a tamper test on this branch pass without tampering with anything. The
    // anchor is the specific pair this file exists for: lose it and the whole
    // invariant has gone quiet.
    expect(pairs.some((p) => p.script === "sync.ts" && p.flag === "--repos")).toBe(true);
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    expect(new Set(pairs.map((p) => p.script)).size).toBeGreaterThanOrEqual(2);
  });

  const byScript = new Map<string, Set<string>>();
  for (const { script, flag } of pairs) {
    if (!byScript.has(script)) byScript.set(script, new Set());
    byScript.get(script)!.add(flag);
  }

  /** Strip comments — AB-DEF-9's only trace was a comment. Docs are not code. */
  const decomment = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  /**
   * A script's own body PLUS the local `./lib/*.js` modules it imports.
   *
   * Scripts legitimately delegate argv parsing: `--config` is consumed by
   * `lib/config.ts` via `resolveHubConfigOrExit(argv)`, and a body-only search
   * would call that inert. Widening to the imported libs keeps the check honest
   * without making it vacuous — AB-DEF-9 still fails here, because no lib parsed
   * `--repos` either. Searching all of `scripts/` would be the vacuous version.
   */
  function consumptionSurface(script: string): string | null {
    const file = path.join(ROOT, "scripts", script);
    if (!fs.existsSync(file)) return null;
    const body = fs.readFileSync(file, "utf-8");
    let surface = body;
    for (const m of body.matchAll(/from\s+"\.\/lib\/([a-zA-Z0-9._-]+)\.js"/g)) {
      const lib = path.join(ROOT, "scripts", "lib", `${m[1]!}.ts`);
      if (fs.existsSync(lib)) surface += "\n" + fs.readFileSync(lib, "utf-8");
    }
    return decomment(surface);
  }

  for (const [script, flags] of byScript) {
    const surface = consumptionSurface(script);
    if (surface === null) continue;

    for (const flag of flags) {
      it(`${script} (or a lib it imports) consumes ${flag}`, () => {
        expect(
          surface.includes(`"${flag}"`),
          `cli.ts forwards ${flag} to ${script}, but neither ${script} nor any lib ` +
            `it imports ever reads it. A flag the CLI accepts and the parser ignores ` +
            `is silently inert — parse it, or stop forwarding it. This is AB-DEF-9.`,
        ).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2 · Regression — `--repos-file` actually scopes the blast radius
// ---------------------------------------------------------------------------

function run(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("AB-DEF-9 — sync --repos-file scopes the target list", () => {
  let base = "";
  let hub = "";
  const spokes: string[] = [];

  function setup(): boolean {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-defnine-"));
    hub = path.join(base, "hub");
    const inst = spawnSync(
      process.execPath,
      [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
      { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
    );
    if (inst.status !== 0) return false;

    for (const name of ["alpha", "bravo", "charlie"]) {
      const p = path.join(base, name);
      fs.mkdirSync(path.join(p, ".git"), { recursive: true });
      spokes.push(p);
    }
    // The CONFIGURED list is all three — the fleet an unscoped sync would hit.
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify(spokes.map((p, i) => ({ label: ["alpha", "bravo", "charlie"][i], path: p })), null, 2),
    );
    // The SCOPED list is one.
    fs.writeFileSync(
      path.join(base, "repos.one.json"),
      JSON.stringify([{ label: "alpha", path: spokes[0] }], null, 2),
    );
    return run(["build", "--config", path.join(hub, "agentboot.config.json")], hub).status === 0;
  }

  const ready = setup();

  it("the fixture built (an unbuilt fixture would make every case below vacuous)", () => {
    expect(ready).toBe(true);
  });

  it.runIf(ready)("--dry-run names ONLY the scoped list, not the configured fleet", () => {
    const r = run(
      [
        "sync",
        "--config", path.join(hub, "agentboot.config.json"),
        "--repos-file", path.join(base, "repos.one.json"),
        "--dry-run",
      ],
      base,
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("alpha");
    // Pre-fix these two appeared, because the override was dropped and the
    // configured three-entry list was used. A rehearsal that previews the wrong
    // fleet is worse than no rehearsal.
    expect(r.out).not.toContain("bravo");
    expect(r.out).not.toContain("charlie");
  });

  it.runIf(ready)("a real sync writes to the scoped spoke and leaves the others byte-untouched", () => {
    const before = spokes.slice(1).map((p) => fs.readdirSync(p).sort().join(","));

    const r = run(
      [
        "sync",
        "--config", path.join(hub, "agentboot.config.json"),
        "--repos-file", path.join(base, "repos.one.json"),
      ],
      base,
    );
    expect(r.status).toBe(0);

    // The scoped spoke received something...
    expect(fs.readdirSync(spokes[0]!).length).toBeGreaterThan(1);
    // ...and the unscoped ones received nothing. Pre-fix both were written to,
    // and each got a signed manifest recording the wrong blast radius as
    // intentional.
    const after = spokes.slice(1).map((p) => fs.readdirSync(p).sort().join(","));
    expect(after).toEqual(before);
  });

  it.runIf(ready)("a --repos-file that does not exist fails loudly, never falling through to config", () => {
    // The silent-fallthrough path is the defect. Exiting 0 against the full
    // fleet because a path was typo'd is the worst available outcome.
    const r = run(
      [
        "sync",
        "--config", path.join(hub, "agentboot.config.json"),
        "--repos-file", path.join(base, "no-such-file.json"),
        "--dry-run",
      ],
      base,
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("repos.json not found");
    expect(r.out).not.toContain("charlie");
  });
});
