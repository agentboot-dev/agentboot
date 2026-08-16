/**
 * SHIPPED SURFACES MUST NOT INVOKE A FLAG THE CLI REJECTS.
 *
 * This is the flag-consumption invariant (E11) turned outward. That one asks
 * "does the script we spawn parse the flag we forward?" — an internal question.
 * This one asks the external half: **does the stuff we SHIP tell an adopter to
 * run something that no longer works?**
 *
 * It exists because the outward half went wrong on 2026-08-13, on this branch,
 * in the most expensive place available:
 *
 *   D1 ruled `--behavioral` CUT from the v1.0 surface. The flag was removed from
 *   `cli.ts`, so `agentboot test --behavioral` began exiting 1 with
 *   "unknown option". `.github/workflows/agentboot-ci.yml` — the PUBLISHED
 *   reusable workflow, consumed by adopters as
 *   `uses: agentboot-dev/agentboot/.github/workflows/agentboot-ci.yml@<ref>` —
 *   still ran `npx agentboot test --behavioral --allow-unevaluated` behind
 *   `if: inputs.behavioral`.
 *
 *   Every adopter passing `behavioral: true` would have gone red with an
 *   unknown-option error, caused by a change in OUR repo, in a workflow THEY
 *   call. The full suite was green at 131 files / 2685 tests throughout,
 *   because nothing tested the adopter-facing surface.
 *
 * That is the ruling's breaking half shipping while its compensating half did
 * not — and the reason it is a mechanism rather than a one-line correction is
 * that the next withdrawn flag will do exactly the same thing.
 *
 * SCOPE: the surfaces that leave this repo — published workflows, the CI
 * templates that pack into the npm tarball, and `core/skills/**` (which compiles
 * into `dist/` and syncs to every spoke). Internal docs are deliberately NOT in
 * scope: they drift, they are swept separately, and folding them in here would
 * make this fail for reasons that do not break an adopter's build.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Files that leave this repo and can tell someone to run a command. */
function shippedSurfaces(): string[] {
  const out: string[] = [];
  const roots = [
    path.join(ROOT, ".github", "workflows"),
    path.join(ROOT, "templates"),
    path.join(ROOT, "core", "skills"),
  ];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ya?ml|md)$/.test(e.name)) out.push(p);
    }
  };
  roots.forEach(walk);
  return out;
}

/**
 * Every `--flag` that appears in an `agentboot <sub> …` invocation in a shipped
 * file, paired with the subcommand it is handed to.
 *
 * Only the flags on the SAME line as an invocation count. A flag named in prose
 * is documentation, and documentation being stale is a different (also real, but
 * separately swept) problem from a build that goes red.
 */
function invokedFlags(): Array<{ file: string; sub: string; flag: string; line: number }> {
  const found: Array<{ file: string; sub: string; flag: string; line: number }> = [];
  const invoke = /\bagentboot\s+([a-z][a-z-]*)\b([^\n`|]*)/g;

  for (const file of shippedSurfaces()) {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      // A line that is clearly narrating a REMOVAL is not an invocation.
      if (/withdrawn|deprecated|no longer|removed|unknown option/i.test(line)) return;
      for (const m of line.matchAll(invoke)) {
        const sub = m[1]!;
        for (const f of (m[2] ?? "").matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)) {
          found.push({ file: path.relative(ROOT, file), sub, flag: f[1]!, line: i + 1 });
        }
      }
    });
  }
  return found;
}

/** Does `agentboot <sub> --help` list this flag? */
const helpCache = new Map<string, string>();
function helpFor(sub: string): string {
  if (!helpCache.has(sub)) {
    const r = spawnSync(process.execPath, [CLI, sub, "--help"], {
      cwd: ROOT,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      encoding: "utf-8",
      timeout: 120_000,
    });
    helpCache.set(sub, `${r.stdout ?? ""}${r.stderr ?? ""}`);
  }
  return helpCache.get(sub)!;
}

describe("shipped surfaces invoke only flags the CLI still accepts", () => {
  const invocations = invokedFlags();

  it("the extractor finds real invocations (a vacuous invariant is not one)", () => {
    // Guards the guard. If the shipped tree is restructured and the regex stops
    // matching, this file would pass by finding nothing — the failure mode that
    // let a tamper test on this branch pass without tampering with anything.
    expect(invocations.length).toBeGreaterThanOrEqual(3);
    expect(new Set(invocations.map((i) => i.file)).size).toBeGreaterThanOrEqual(2);
  });

  it("the detector can fail — a withdrawn flag is not silently accepted", () => {
    // Proves the comparison bites before it is trusted on the real corpus.
    // `--behavioral` is the exact flag D1 withdrew, so this doubles as a
    // regression guard on the ruling itself.
    expect(helpFor("test")).not.toContain("--behavioral");
  });

  for (const inv of invocations) {
    it(`${inv.file}:${inv.line} — \`agentboot ${inv.sub} ${inv.flag}\` is a real flag`, () => {
      const help = helpFor(inv.sub);
      // An unknown SUBCOMMAND surfaces as commander's error text; treat that as
      // a finding too rather than silently passing the flag check.
      expect(
        /unknown command|error: unknown/i.test(help),
        `\`agentboot ${inv.sub}\` is not a command, but ${inv.file}:${inv.line} invokes it`,
      ).toBe(false);
      expect(
        help.includes(inv.flag),
        `${inv.file}:${inv.line} tells an adopter to run \`agentboot ${inv.sub} ${inv.flag}\`, ` +
          `but the CLI no longer accepts ${inv.flag}. This file SHIPS — a published workflow, a ` +
          `packed template, or a synced skill — so removing a flag without updating it turns an ` +
          `adopter's build red for a change made in this repo. Update the surface, or keep the flag.`,
      ).toBe(true);
    });
  }
});
