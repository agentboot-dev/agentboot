/**
 * L33 — `agentboot lint` was measuring the PRE-COMPOSITION source.
 *
 * The persona a model loads is the COMPOSED artifact: SKILL.md plus its traits,
 * gotchas and overlays. lint read `core/personas/<n>/SKILL.md`, divided the
 * character count by four, and scored THAT against `output.tokenBudget`. On
 * this repo the largest source is ~3,331 estimated tokens against the 8,000
 * default, so the error-severity `prompt-too-long` branch could not fire at
 * all — while three personas are 27–49% over budget once composed. A budget
 * check that cannot reach its own threshold is a green surface over a control
 * that enforces nothing, and `compile.ts` had already fixed this identical
 * defect on the build side (B11: prompt size is a property of the COMPOSED
 * persona, which is why the build writes `dist/persona-sizes.json`).
 *
 * Two properties are pinned here, and the second is the one that would
 * otherwise rot:
 *
 *  1. lint exits NON-ZERO on a persona whose composed size exceeds `failAt`,
 *     and agrees with the build about which personas those are.
 *  2. when `dist/persona-sizes.json` is absent, lint SAYS the composed budget
 *     went unchecked. Silently measuring nothing would reproduce the defect one
 *     file over — "I checked nothing" and "I checked everything and it was
 *     fine" must not print the same.
 *
 * The fixture is a hub scaffolded by `install --hub`, which has NO local
 * core/personas sources — the shape a new adopter actually gets, and the shape
 * on which a composed check hung off the source loop silently does nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Status read WITHOUT a pipe — a piped $? is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

interface Finding { rule: string; severity: string; file: string; message: string }

/**
 * Parses the machine surface from STDOUT alone — the dist-freshness notice goes
 * to stderr, and folding the two together makes the payload unparseable.
 *
 * A parse failure THROWS. An earlier draft of this helper returned [] instead,
 * which turned every "no findings of kind X" assertion green for the wrong
 * reason — precisely the vacuous-check failure this suite exists to catch.
 */
function lintJson(args: string[] = []): { status: number; findings: Finding[]; out: string } {
  const r = spawnSync(
    process.execPath,
    [CLI, "lint", "--format", "json", "--severity", "info", ...args],
    { cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  let findings: unknown;
  try {
    findings = JSON.parse(r.stdout ?? "");
  } catch (e) {
    throw new Error(`lint --format json emitted no parseable array on stdout (${String(e)}). Raw:\n${out}`);
  }
  if (!Array.isArray(findings)) throw new Error(`lint --format json did not emit an array. Raw:\n${out}`);
  return { status: r.status ?? -1, findings: findings as Finding[], out };
}

let base: string;
let hub: string;
let sizes: Record<string, number>;

function setBudget(budget: { warnAt?: number; failAt?: number } | undefined): void {
  const p = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
  cfg.output = { ...(cfg.output ?? {}) };
  if (budget) cfg.output.tokenBudget = budget;
  else delete cfg.output.tokenBudget;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-lint-composed-")));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`hub scaffold failed: ${inst.stdout}${inst.stderr}`);
  const b = ab(["build"], hub);
  if (b.status !== 0) throw new Error(`hub build failed: ${b.out}`);
  sizes = JSON.parse(fs.readFileSync(path.join(hub, "dist", "persona-sizes.json"), "utf-8")).personas;
}, 900_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("L33: lint scores the COMPOSED persona, not its source", () => {
  it("the premise: composed sizes dwarf the sources, and this hub has no local sources at all", () => {
    // If this ever stops holding, the rest of the file is measuring nothing —
    // so it is asserted rather than assumed.
    expect(Object.keys(sizes).length).toBeGreaterThan(0);
    expect(Math.max(...Object.values(sizes))).toBeGreaterThan(8000);
    const localPersonas = path.join(hub, "core", "personas");
    const localSources = fs.existsSync(localPersonas) ? fs.readdirSync(localPersonas) : [];
    expect(localSources.length, "scaffolded hub carries no persona sources").toBe(0);
  });

  it("over failAt -> ERROR and exit 1, naming every persona the BUILD would fail on", () => {
    const failAt = 9000;
    setBudget({ warnAt: 8000, failAt });
    const expected = Object.entries(sizes).filter(([, n]) => n > failAt).map(([n]) => n);
    expect(expected.length, "fixture must have at least one persona over failAt").toBeGreaterThan(0);

    const r = lintJson();
    const errors = r.findings.filter((f) => f.rule === "compiled-too-large" && f.severity === "error");
    expect(errors.map((f) => f.message).join(" | ")).toBeTruthy();
    for (const name of expected) {
      expect(errors.some((f) => f.message.includes(`'${name}'`)), `${name} must be an error`).toBe(true);
    }
    expect(errors.length).toBe(expected.length);
    expect(r.status, r.out).toBe(1);

    // The two surfaces must agree: lint calls it an error exactly when the
    // build refuses to produce the tree.
    const build = ab(["build"], hub);
    expect(build.status, build.out).toBe(1);
    for (const name of expected) expect(build.out).toContain(name);
  }, 600_000);

  it("over warnAt but under failAt -> WARN, and lint stays exit 0", () => {
    setBudget({ warnAt: 8000, failAt: 999_999 });
    const overWarn = Object.entries(sizes).filter(([, n]) => n > 8000).map(([n]) => n);
    expect(overWarn.length).toBeGreaterThan(0);

    const r = lintJson();
    const warns = r.findings.filter((f) => f.rule === "compiled-too-large" && f.severity === "warn");
    for (const name of overWarn) {
      expect(warns.some((f) => f.message.includes(`'${name}'`)), `${name} must warn`).toBe(true);
    }
    expect(r.findings.some((f) => f.severity === "error")).toBe(false);
    expect(r.status, r.out).toBe(0);
  }, 300_000);

  it("the source-only rule cannot substitute: it never fires while composed personas are over", () => {
    setBudget({ warnAt: 8000 });
    const r = lintJson();
    // This is the defect restated as an assertion. A hub with no local sources
    // produces no source finding at all, yet the budget IS breached — so a
    // suite that only watched `prompt-too-long` would have seen a clean run.
    expect(r.findings.some((f) => f.rule === "prompt-too-long")).toBe(false);
    expect(r.findings.some((f) => f.rule === "compiled-too-large")).toBe(true);
  }, 300_000);

  it("no persona-sizes.json -> lint SAYS the composed budget went unchecked", () => {
    setBudget({ warnAt: 8000 });
    const sizesPath = path.join(hub, "dist", "persona-sizes.json");
    const saved = fs.readFileSync(sizesPath, "utf-8");
    try {
      fs.rmSync(sizesPath);
      const r = lintJson();
      const unknown = r.findings.filter((f) => f.rule === "compiled-size-unknown");
      expect(unknown.length, r.out).toBe(1);
      expect(unknown[0]!.severity).toBe("warn");
      expect(unknown[0]!.message).toMatch(/NOT checked/);
      expect(unknown[0]!.message).toMatch(/agentboot build/);
      // And it must not quietly claim the personas are fine.
      expect(r.findings.some((f) => f.rule === "compiled-too-large")).toBe(false);
      // A hub with nothing else wrong must not print the all-clear line while
      // a whole dimension went unmeasured.
      const text = ab(["lint"], hub);
      expect(text.out).not.toMatch(/No issues found/);
      expect(text.out).toMatch(/compiled-size-unknown/);
    } finally {
      fs.writeFileSync(sizesPath, saved);
    }
  }, 300_000);

  it("a malformed persona-sizes.json is reported, not swallowed", () => {
    setBudget({ warnAt: 8000 });
    const sizesPath = path.join(hub, "dist", "persona-sizes.json");
    const saved = fs.readFileSync(sizesPath, "utf-8");
    try {
      fs.writeFileSync(sizesPath, "{ not json");
      const r = lintJson();
      const unknown = r.findings.filter((f) => f.rule === "compiled-size-unknown");
      expect(unknown.length, r.out).toBe(1);
      expect(unknown[0]!.message).toMatch(/unreadable/);
    } finally {
      fs.writeFileSync(sizesPath, saved);
    }
  }, 300_000);

  it("a persona missing from the sizes file is flagged UNCHECKED, not assumed fine", () => {
    setBudget({ warnAt: 8000 });
    const sizesPath = path.join(hub, "dist", "persona-sizes.json");
    const saved = fs.readFileSync(sizesPath, "utf-8");
    try {
      const doc = JSON.parse(saved);
      const dropped = Object.keys(doc.personas)[0]!;
      delete doc.personas[dropped];
      fs.writeFileSync(sizesPath, JSON.stringify(doc));
      const r = lintJson();
      const unknown = r.findings.filter((f) => f.rule === "compiled-size-unknown");
      expect(unknown.length, r.out).toBe(1);
      expect(unknown[0]!.message).toContain(dropped);
      expect(unknown[0]!.message).toMatch(/UNCHECKED/);
    } finally {
      fs.writeFileSync(sizesPath, saved);
    }
  }, 300_000);
});
