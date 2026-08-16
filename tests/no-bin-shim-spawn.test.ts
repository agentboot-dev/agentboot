/**
 * No test may launch the `node_modules/.bin` shim without a shell.
 *
 * FOUR occurrences, and patch-per-instance failed twice:
 *
 *   1. `tests/setup.ts` — the shared setup. `spawnSync` against
 *      `node_modules/.bin/tsx` fails on Windows with ENOENT and empty output,
 *      and because every test file that needs a build goes through it, the
 *      branch's first Windows CI run reported **302 failures** across subsystems
 *      that were never reached.
 *   2. Fixed. Next run: `tests/hook-scaffold-node-guard.test.ts` — same shim,
 *      same ENOENT, `execFileSync` this time.
 *   3. Same run: `tests/lint-secret-parity.test.ts` — same shim, surfacing as
 *      `SyntaxError: Unexpected end of JSON input`, because the launch failure
 *      produced empty stdout and the caller parsed it.
 *   4. A grep-shaped discriminator written to count the remaining call sites
 *      MISSED #3, because that invocation spans two lines.
 *
 * The shim is an extensionless shell script. On Windows the executable is
 * `tsx.cmd`, and `spawnSync`/`execFileSync` without a shell can launch neither.
 * `execSync` survives because it goes through a shell, which is why 30-odd other
 * call sites are fine and these were not — the difference is invisible at a
 * glance, which is exactly why a person cannot be the check.
 *
 * So: one rule, asserted mechanically. Use `TSX_BIN` / `TSX_ARGS` from
 * `tests/setup.ts`, which run tsx's own entry under `process.execPath` — no
 * shim, no shell quoting, every platform.
 *
 * This is deliberately a SOURCE check rather than a behavioural one. The defect
 * only manifests on Windows, so a behavioural test would pass on every machine a
 * developer owns and fail only after a push — which is the round trip that made
 * this cost two days.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TESTS = __dirname;

/** Every `*.test.ts` plus the shared setup. */
function testSources(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      // This file's known-bad fixtures are string literals, not real calls;
      // scanning itself would flag its own proof material.
      else if (e.name === "no-bin-shim-spawn.test.ts") continue;
      else if (/\.test\.ts$/.test(e.name) || e.name === "setup.ts") out.push(p);
    }
  };
  walk(TESTS);
  return out;
}

/**
 * Shell-less launches of the `.bin` shim.
 *
 * Matched across newlines on purpose — occurrence #4 was a discriminator that
 * only looked at single lines and therefore under-reported, which is its own
 * instance of the class this file exists to close. `execSync` is excluded
 * because it goes through a shell and resolves `tsx.cmd` via PATHEXT.
 */
function shimLaunches(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const hits: string[] = [];

  const shimVars = [...code.matchAll(/(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*path\.join\([^)]*["']\.bin["']\s*,\s*["']tsx["']\s*\)/g)]
    .map((m) => m[1]!);

  // ONLY the argv form: the shim is the FIRST ARGUMENT, so Node execs it
  // directly. `spawnSync(`"${TSX}" …`, { shell: true })` passes a command STRING
  // to a shell, which resolves `tsx.cmd` through PATHEXT and is correct on
  // Windows — four files use it and all four are fine.
  //
  // The first version of this detector allowed any 40 characters before the
  // variable and flagged all four. A check that fires on correct code is noise,
  // and noise is how a check gets switched off — so the anchor is strict:
  // whitespace only between the paren and the identifier, which still spans the
  // multi-line call that a single-line grep missed.
  for (const v of shimVars) {
    const re = new RegExp(`(spawnSync|execFileSync)\\(\\s*${v}\\s*,`, "g");
    for (const m of code.matchAll(re)) hits.push(`${m[1]}(${v}, …)`);
  }
  // The inline argv form, with no variable in between.
  for (const m of code.matchAll(/(spawnSync|execFileSync)\(\s*path\.join\([^)]*["']\.bin["']/g)) {
    hits.push(`${m[1]}(path.join(… ".bin" …))`);
  }
  return hits;
}

describe("no test launches the .bin shim without a shell", () => {
  const sources = testSources();

  it("the scan sees the corpus (an empty scan proves nothing)", () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((f) => f.endsWith("setup.ts"))).toBe(true);
  });

  it("the detector can fail — it catches both the variable form and the inline form", () => {
    // Proven against known-bad input before it is trusted on the corpus. The
    // multi-line case is included because missing it is occurrence #4.
    const varForm = `const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");\nexecFileSync(TSX, [CLI]);`;
    const multiline = `const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");\nexecFileSync(\n  TSX,\n  [CLI],\n);`;
    const inline = `spawnSync(path.join(ROOT, "node_modules", ".bin", "tsx"), [CLI]);`;
    const shellOk = `const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");\nexecSync(\`\${TSX} scripts/x.ts\`);`;
    // The command-string form WITH a shell — used by four files in this repo and
    // correct on Windows. Flagging it was this detector's own first bug.
    const shellSpawn = `const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");\nspawnSync(\`"\${TSX}" "\${cli}" x\`, { shell: true });`;

    expect(shimLaunches(varForm)).toHaveLength(1);
    expect(shimLaunches(multiline)).toHaveLength(1);
    expect(shimLaunches(inline)).toHaveLength(1);
    // execSync goes through a shell and is fine — a detector that flags it would
    // be noise, and noise is how a check gets disabled.
    expect(shimLaunches(shellOk)).toHaveLength(0);
    expect(shimLaunches(shellSpawn)).toHaveLength(0);
  });

  for (const file of testSources()) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    it(`${rel} does not spawn the shim`, () => {
      const hits = shimLaunches(fs.readFileSync(file, "utf-8"));
      expect(
        hits,
        `${rel} launches node_modules/.bin/tsx without a shell: ${hits.join(", ")}\n` +
          `That shim is an extensionless script; Windows needs tsx.cmd and cannot ` +
          `launch either without a shell, so this fails there with ENOENT and EMPTY ` +
          `output. Use TSX_BIN / TSX_ARGS from tests/setup.ts.`,
      ).toEqual([]);
    });
  }
});
