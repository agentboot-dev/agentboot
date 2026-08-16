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
 * Every flag cli.ts forwards, paired with the script it is forwarded to.
 *
 * Deliberately derived from the source rather than hand-listed: a hand-listed
 * pair of tables (flags cli.ts forwards, flags this test knows about) drifts, and
 * the flag added next quarter would be exempt by default — which is the same
 * "one half was taught" shape the defect came from.
 *
 * THE FIRST VERSION OF THIS EXTRACTOR HAD THE DEFECT IT WAS WRITTEN TO CATCH.
 * It saw only literal `args.push("--flag")` and attributed each push to the next
 * `runScript` in file order. A flag routed through a HELPER — `collectGlobalArgs`,
 * which contributes `--config` to six commands — was therefore invisible, except
 * by accident: the helper is declared above the first `runScript`, so its push
 * landed on `compile.ts` and no other target was ever checked for `--config`.
 * Two targets that ignore the flag sat behind that accident. An invariant with a
 * hole is more dangerous than no invariant, because the hole is where people stop
 * looking.
 *
 * So this version resolves three things:
 *   1. HELPERS — a top-level function that pushes flags contributes them to every
 *      command that calls it.
 *   2. NON-runScript targets — `dev-build` spawns three scripts directly via
 *      `path.join(SCRIPTS_DIR, "x.ts")`, none of them through `runScript`.
 *   3. ACTION SCOPE — flags are attributed to the targets of the SAME command
 *      action, not to whatever `runScript` happens to come next in the file.
 */
function forwardedFlags(): Array<{ script: string; flag: string }> {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");

  // -- 1 · helper functions that build argv ---------------------------------
  // Helpers live in the preamble, above the first command action. A top-level
  // function body ends at the first `}` in column 0.
  const firstAction = src.indexOf(".action(");
  const preamble = src.slice(0, firstAction === -1 ? src.length : firstAction);
  const helperFlags = new Map<string, Set<string>>();
  for (const h of preamble.matchAll(/^(?:export\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm)) {
    const start = h.index!;
    const rest = preamble.slice(start);
    const end = rest.search(/^\}/m);
    const body = end === -1 ? rest : rest.slice(0, end);
    const flags = new Set<string>();
    for (const p of body.matchAll(/\.push\(\s*"(--[a-zA-Z0-9-]+)"/g)) flags.add(p[1]!);
    if (flags.size) helperFlags.set(h[1]!, flags);
  }

  // -- 2/3 · per-action attribution -----------------------------------------
  const out: Array<{ script: string; flag: string }> = [];
  for (const { targets, flags } of scanActions(src, helperFlags)) {
    for (const script of targets) for (const flag of flags) out.push({ script, flag });
  }
  return out;
}

/** One entry per command action that spawns a script: what it spawns, what it forwards. */
function scanActions(
  src: string,
  helperFlags: Map<string, Set<string>>,
): Array<{ targets: Set<string>; flags: Set<string> }> {
  const actions: Array<{ targets: Set<string>; flags: Set<string> }> = [];
  for (const chunk of src.split(/\.action\(/).slice(1)) {
    const body = chunk.split(/\n\s*\.action\(/)[0]!;

    const targets = new Set<string>();
    for (const m of body.matchAll(/runScript\(\{\s*script:\s*"([^"]+)"/g)) targets.add(m[1]!);
    for (const m of body.matchAll(/SCRIPTS_DIR,\s*"([^"]+\.ts)"/g)) targets.add(m[1]!);
    if (targets.size === 0) continue;

    const flags = new Set<string>();
    for (const m of body.matchAll(/\.push\(\s*"(--[a-zA-Z0-9-]+)"/g)) flags.add(m[1]!);
    for (const [name, contributed] of helperFlags) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(body)) for (const fl of contributed) flags.add(fl);
    }
    actions.push({ targets, flags });
  }
  return actions;
}

/** Every script cli.ts spawns from a command action, however it spawns it. */
function spawnedTargets(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");
  const all = new Set<string>();
  for (const { targets } of scanActions(src, new Map())) for (const t of targets) all.add(t);
  return all;
}

describe("flag-consumption invariant — a forwarded flag must be parsed", () => {
  const pairs = forwardedFlags();

  const has = (script: string, flag: string) =>
    pairs.some((p) => p.script === script && p.flag === flag);

  it("the extractor finds real forwarding pairs (a vacuous invariant is not one)", () => {
    // Guards the guard. If cli.ts is restructured and the regexes stop matching,
    // this file would pass by finding nothing — the exact failure mode that let
    // a tamper test on this branch pass without tampering with anything. The
    // anchor is the specific pair this file exists for: lose it and the whole
    // invariant has gone quiet.
    expect(has("sync.ts", "--repos")).toBe(true);
    expect(has("validate.ts", "--strict")).toBe(true);
    expect(has("mcp-server.ts", "--profile")).toBe(true);
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    expect(new Set(pairs.map((p) => p.script)).size).toBeGreaterThanOrEqual(2);
  });

  it("resolves flags forwarded through a HELPER, not only literal pushes", () => {
    // The hole this extractor was rewritten to close. `--config` reaches
    // compile.ts only via `collectGlobalArgs`; there is no `args.push("--config")`
    // anywhere in a command action. If this goes red, helper resolution has
    // broken and every helper-routed flag is silently exempt again.
    const src = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");
    expect(/\.action\([\s\S]*?\.push\(\s*"--config"/.test(src)).toBe(false);
    expect(has("compile.ts", "--config")).toBe(true);
  });

  it("sees targets spawned WITHOUT runScript", () => {
    // `dev-build` spawns validate.ts / compile.ts / dev-sync.ts directly through
    // `path.join(SCRIPTS_DIR, …)`. A runScript-only extractor is blind to all
    // three, so any flag those legs gain in future would be exempt by default.
    // Asserted on the TARGET scan, not on the pairs: those actions forward
    // nothing today, and an anchor that evaporates when a defect is fixed is not
    // an anchor.
    expect(spawnedTargets().has("dev-sync.ts")).toBe(true);
    expect(spawnedTargets().size).toBeGreaterThanOrEqual(4);
  });

  it("a lib only counts as a consumer when it is handed argv", () => {
    // The surface-widening half of the same hole. `lib/config.ts` contains the
    // literal "--config"; importing it is not consumption, calling it with argv
    // is. Proven both ways so neither direction can rot into a constant.
    expect(consumptionSurface("compile.ts")).toContain('"--config"'); // argv IS handed over
    const devSync = consumptionSurface("dev-sync.ts");
    expect(devSync).not.toBeNull();
    expect(devSync).toContain("dist"); // the body really was read
    expect(devSync).not.toContain('"--config"'); // …but lib/config was not admitted
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
   * A script's own body PLUS the local `./lib/*.js` modules it ACTUALLY HANDS
   * ITS ARGV TO.
   *
   * Scripts legitimately delegate argv parsing: `--config` is consumed by
   * `lib/config.ts` via `resolveHubConfigOrExit(argv, …)`, and a body-only search
   * would call that inert. But importing a lib that happens to contain the string
   * `"--config"` proves nothing — a lib cannot parse argv it was never given.
   * That looser reading is what made two ignored `--config` targets look consumed:
   * both import `loadConfig` from `lib/config.ts` and call it with a path they
   * built themselves, never with argv.
   *
   * So a lib only joins the surface when some symbol imported from it is called
   * with an argv-derived argument. Searching all of `scripts/` would be the
   * vacuous version; searching every import is the almost-vacuous version.
   */
  function consumptionSurface(script: string): string | null {
    const file = path.join(ROOT, "scripts", script);
    if (!fs.existsSync(file)) return null;
    const body = fs.readFileSync(file, "utf-8");
    const code = decomment(body);
    let surface = body;

    for (const m of body.matchAll(
      /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s+"\.\/lib\/([a-zA-Z0-9._-]+)\.js"/g,
    )) {
      const libName = m[2]!;
      const lib = path.join(ROOT, "scripts", "lib", `${libName}.ts`);
      if (!fs.existsSync(lib)) continue;

      const symbols = m[1]!
        .split(",")
        .map((s) => s.replace(/\btype\b/, "").split(/\s+as\s+/).pop()!.trim())
        .filter((s) => /^[A-Za-z0-9_$]+$/.test(s));

      // Is any of them invoked with argv? `f(argv, …)`, `f(process.argv.slice(2))`.
      const handedArgv = symbols.some((sym) => {
        const call = new RegExp(`\\b${sym}\\s*\\(([^)]*)\\)`, "g");
        for (const c of code.matchAll(call)) if (/\bargv\b/.test(c[1]!)) return true;
        return false;
      });
      if (handedArgv) surface += "\n" + fs.readFileSync(lib, "utf-8");
    }
    return decomment(surface);
  }

  for (const [script, flags] of byScript) {
    const surface = consumptionSurface(script);
    if (surface === null) continue;

    for (const flag of flags) {
      it(`${script} (or a lib it hands argv to) consumes ${flag}`, () => {
        expect(
          surface.includes(`"${flag}"`),
          `cli.ts forwards ${flag} to ${script}, but neither ${script} nor any lib ` +
            `it hands its argv to ever reads it. A flag the CLI accepts and the parser ` +
            `ignores is silently inert — the operator gets a success report about work ` +
            `done somewhere other than where they asked. Parse it, or stop forwarding ` +
            `it and refuse the flag out loud. This is AB-DEF-9.`,
        ).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 1b · The refusal is real, not just a source-level property
// ---------------------------------------------------------------------------

describe("commands that cannot honor --config refuse it out loud", () => {
  // The invariant above is satisfied by "cli.ts no longer forwards the flag",
  // which on its own would be a REGRESSION: the operator's --config would then
  // be dropped by commander instead of by the parser, and the command would run
  // against the wrong hub exactly as before, just one layer up. These cases pin
  // the half that protects the operator.
  for (const command of ["mcp-server", "dev-sync", "dev-build"]) {
    it(`${command} exits non-zero and names the alternative`, () => {
      const r = spawnSync(
        process.execPath,
        [CLI, command, "--config", path.join(os.tmpdir(), "nowhere", "agentboot.config.json")],
        { env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 120_000 },
      );
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(r.status, `\`agentboot ${command} --config …\` exited 0. Silently ignoring it is ` +
        `how this defect looked before: the operator names a hub and the command runs ` +
        `against a different one.`).not.toBe(0);
      expect(out).toContain("does not honor --config");
    });
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
