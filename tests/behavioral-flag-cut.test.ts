/**
 * D1 (ruled 2026-08-11) — `agentboot test --behavioral` is CUT from the 1.0
 * surface, and the removal is pinned here so it cannot drift back in.
 *
 * The flag was advertised on four surfaces and only ONE of them carried the
 * experimental caveat, while 52 of the scenario expectations it runs have no
 * mechanical evaluator. An advertised flag whose expectations nothing can check
 * is a capability claim with no mechanism behind it.
 *
 * The runner itself is deliberately untouched — `behavioralFindings` and its
 * verdict logic keep their own suites (`behavioral-verdict`,
 * `behavioral-file-vacuity`). The ruling is about what 1.0 OFFERS.
 *
 * VACUITY GUARD. "unknown option" is the response to any string, so proving the
 * flag is rejected proves nothing on its own — a CLI that had failed to load at
 * all would produce the same shape. Every negative below is therefore paired
 * with a positive on a flag that must still work.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

function ab(args: string[]): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("D1 — `agentboot test` no longer advertises --behavioral", () => {
  it("--help does not offer the flag, and DOES still offer the surface that shipped", () => {
    const help = ab(["test", "--help"]);
    expect(help.status, help.out).toBe(0);
    // The vacuity guard: if the extractor were reading an empty string these
    // would fail too.
    expect(help.out).toContain("--snapshot");
    expect(help.out).toContain("--regression");
    expect(help.out).not.toContain("--behavioral");
    // Its two companion flags configured the behavioral run and nothing else;
    // leaving them advertised would be the same defect one flag over.
    expect(help.out).not.toContain("--test-dir");
    expect(help.out).not.toContain("--allow-unevaluated");
  }, 120_000);

  it("the flag is NOT ACCEPTED — passing it is an error, not a silent no-op", () => {
    // Silently ignoring an unknown flag would be the worse outcome: the
    // operator would believe a behavioral run had happened.
    const r = ab(["test", "--behavioral"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/unknown option '--behavioral'/);
  }, 120_000);

  it.each(["--test-dir", "--allow-unevaluated"])("%s is not accepted either", (flag) => {
    const r = ab(["test", flag, "x"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(new RegExp(`unknown option '${flag}'`));
  }, 120_000);

  it("POSITIVE: the command still parses its shipped flags — this is a cut, not an outage", () => {
    // Run from the repo root with no hub config: parsing must succeed and the
    // command must reach its own diagnostics rather than commander's.
    const r = ab(["test", "--snapshot-file", "x.json"]);
    expect(r.out).not.toMatch(/unknown option/);
  }, 120_000);
});
