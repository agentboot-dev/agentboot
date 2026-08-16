/**
 * NF3-3 — `output.tokenBudget` could not fire unless `skill` was an outputFormat.
 *
 * B11 shipped prompt-size discipline as two things: a build-failing gate
 * (`output.tokenBudget.failAt`) and an artifact an operator diffs in hub PRs
 * (`dist/persona-sizes.json`). Both were measured from ONE platform's file:
 *
 *     const skillPath = path.join(distPath, "skill", "core", result.persona, "SKILL.md");
 *     if (fs.existsSync(skillPath)) { …measure, warn, fail… }
 *
 * On any hub that does not build the `skill` format, that file does not exist,
 * the loop body never ran, and:
 *
 *   - `failAt` never fired — a configured CI gate that cannot fail;
 *   - `warnAt` never warned;
 *   - `persona-sizes.json` was written with `"personas": {}` — the PR-diff
 *     artifact, present and empty;
 *   - the build printed the "Token estimates:" header with nothing under it and
 *     exited 0.
 *
 * Reproduced on a scaffolded hub before this change with `failAt: 200` and four
 * personas of ~8k–11k tokens each:
 *
 *   outputFormats ["skill","agents","claude","copilot"] → exit 1, four named
 *   outputFormats ["claude","copilot","agents"]         → exit 0, zero mentions
 *                                                         of failAt, personas {}
 *
 * A check that cannot fail is not a check, and an empty header is silence
 * reading as success. Prompt size is a property of the COMPOSED persona, not of
 * any one platform's wrapper, so it is measured where it is composed and
 * carried on the compile result — there is no platform whose absence can switch
 * the budget off.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf3-3-"));
});
afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

function hubWith(name: string, mutate: (cfg: Record<string, any>) => void): string {
  const hub = path.join(base, name);
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, any>;
  mutate(cfg);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return hub;
}

function build(hub: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, "build"], {
    cwd: hub,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const NO_SKILL = ["claude", "copilot", "agents"];

describe("NF3-3: tokenBudget does not depend on the skill outputFormat", () => {
  it("failAt FAILS the build on a hub that does not build `skill`", () => {
    const hub = hubWith("no-skill-failat", (cfg) => {
      cfg["personas"] = { ...cfg["personas"], outputFormats: NO_SKILL };
      cfg["output"] = { ...cfg["output"], tokenBudget: { warnAt: 100, failAt: 200 } };
    });

    const b = build(hub);

    expect(b.status).not.toBe(0);
    expect(b.out).toMatch(/exceeds tokenBudget\.failAt/);
    expect(b.out).toMatch(/code-reviewer/);
  });

  it("persona-sizes.json is populated on a hub that does not build `skill`", () => {
    const hub = hubWith("no-skill-sizes", (cfg) => {
      cfg["personas"] = { ...cfg["personas"], outputFormats: NO_SKILL };
    });

    const b = build(hub);
    expect(b.status).toBe(0);

    const report = JSON.parse(
      fs.readFileSync(path.join(hub, "dist", "persona-sizes.json"), "utf-8"),
    ) as { personas: Record<string, number> };

    // The PR-diff artifact was written with `{}` before this change.
    expect(Object.keys(report.personas).length).toBeGreaterThan(0);
    for (const size of Object.values(report.personas)) {
      expect(size).toBeGreaterThan(0);
    }
    // And the estimates are actually reported, not just banked in a file —
    // either as a gray "~N tokens" line or as a warnAt ⚠, depending on size.
    expect(b.out).toMatch(/\[code-reviewer\] estimated \d+ tokens|code-reviewer: ~\d+ tokens/);
  });

  it("warnAt warns on a hub that does not build `skill`", () => {
    const hub = hubWith("no-skill-warnat", (cfg) => {
      cfg["personas"] = { ...cfg["personas"], outputFormats: NO_SKILL };
      cfg["output"] = { ...cfg["output"], tokenBudget: { warnAt: 100 } };
    });

    const b = build(hub);
    expect(b.status).toBe(0);
    expect(b.out).toMatch(/budget: 100/);
  });

  it("CONTROL: a hub WITH `skill` still fails, so this is not a regression of B11", () => {
    const hub = hubWith("with-skill-failat", (cfg) => {
      cfg["output"] = { ...cfg["output"], tokenBudget: { failAt: 200 } };
    });
    const b = build(hub);
    expect(b.status).not.toBe(0);
    expect(b.out).toMatch(/exceeds tokenBudget\.failAt/);
  });

  it("CONTROL: a generous budget passes on both shapes, so the gate is not blanket-failing", () => {
    for (const [name, formats] of [
      ["generous-no-skill", NO_SKILL],
      ["generous-with-skill", undefined],
    ] as const) {
      const hub = hubWith(name, (cfg) => {
        if (formats) cfg["personas"] = { ...cfg["personas"], outputFormats: formats };
        cfg["output"] = { ...cfg["output"], tokenBudget: { warnAt: 1_000_000, failAt: 1_000_000 } };
      });
      expect(build(hub).status).toBe(0);
    }
  });
});
