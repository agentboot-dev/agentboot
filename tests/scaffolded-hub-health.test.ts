/**
 * NF4-6 — a hub scaffolded by `agentboot install --hub` failed its own doctor.
 *
 * `agentboot install --hub … && agentboot build` exits 0 and prints
 * "✓ Compiled 4 persona(s)". `agentboot doctor` on that same hub then exited 1
 * with ten findings:
 *
 *     ✗ Persona not found: code-reviewer (fixable with --fix)   ×4
 *     ✗ Trait not found: critical-thinking (fixable with --fix)  ×6
 *     ✗ 10 issues found
 *
 * Identical on a real `npm pack` + install, so it was not a dev-checkout
 * artifact. compile.ts merges the package bundle (ROOT/core/*) with the hub
 * (HUB_ROOT/core/*), hub winning on name, precisely so a hub can enable a
 * shipped default WITHOUT copying it locally. doctor looked only in the hub. So
 * build and doctor disagreed about the same fact, and the first thing a new
 * adopter saw was a red health check on a hub the tool had just created.
 *
 * `doctor --fix` "resolved" it by materialising copies into the hub — which
 * changes real behaviour (a local copy stops tracking package updates) to
 * satisfy a check that was wrong. A fixer for a false finding is worse than the
 * false finding.
 *
 * The invariant asserted is AGREEMENT: whatever the hub's shape, `build` and
 * `doctor` must not disagree about whether its enabled artifacts exist.
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

const ab = (args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const editConfig = (fn: (c: Record<string, any>) => void) => {
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  fn(c);
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
};

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf46-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("NF4-6 — a freshly scaffolded hub is healthy", () => {
  it("PRECONDITION: the scaffold enables personas it does NOT copy locally", () => {
    // If a future scaffold starts copying everything into the hub, this suite
    // stops testing anything and should say so rather than passing.
    const cfg = JSON.parse(fs.readFileSync(path.join(hub, "agentboot.config.json"), "utf-8"));
    const enabled: string[] = cfg.personas?.enabled ?? [];
    expect(enabled.length, "the scaffold enables no personas — fixture drifted").toBeGreaterThan(0);
    const localDir = path.join(hub, "core", "personas");
    const localCopies = fs.existsSync(localDir) ? fs.readdirSync(localDir) : [];
    expect(
      enabled.some((p) => !localCopies.includes(p)),
      "every enabled persona is copied into the hub — the package tier is no longer exercised",
    ).toBe(true);
  }, 120_000);

  it("NF4-6: build and doctor agree — the scaffold builds AND passes its health check", () => {
    expect(ab(["build"]).status, "the scaffold does not build").toBe(0);
    const d = ab(["doctor"]);
    expect(d.status, `a hub AgentBoot just created fails its own doctor:\n${d.out}`).toBe(0);
    expect(d.out).not.toMatch(/Persona not found/);
    expect(d.out).not.toMatch(/Trait not found/);
  }, 900_000);

  it("NF4-6: doctor reports the inherited artifacts as FOUND, by count", () => {
    const d = ab(["doctor"]);
    expect(d.out).toMatch(/All \d+ enabled personas found/);
    expect(d.out).toMatch(/All \d+ enabled traits found/);
  }, 300_000);

  it("NEGATIVE: a persona that exists NOWHERE is still a finding", () => {
    // The gate must resolve the package tier, not stop resolving. Without this,
    // "always pass" would look green.
    editConfig((c) => {
      c.personas.enabled = [...c.personas.enabled, "does-not-exist-anywhere"];
      c.traits = c.traits ?? {};
      c.traits.enabled = [...(c.traits.enabled ?? []), "no-such-trait"];
    });
    const d = ab(["doctor"]);
    expect(d.status).toBe(1);
    expect(d.out).toContain("Persona not found: does-not-exist-anywhere");
    expect(d.out).toContain("Trait not found: no-such-trait");
  }, 300_000);

  it("NEGATIVE: a hub-local persona missing its SKILL.md is still a finding", () => {
    editConfig((c) => {
      c.personas.enabled = c.personas.enabled.filter((p: string) => p !== "does-not-exist-anywhere");
      c.traits.enabled = c.traits.enabled.filter((t: string) => t !== "no-such-trait");
      c.personas.enabled = [...c.personas.enabled, "half-made"];
    });
    fs.mkdirSync(path.join(hub, "core", "personas", "half-made"), { recursive: true });
    const d = ab(["doctor"]);
    expect(d.status).toBe(1);
    expect(d.out).toContain("Missing SKILL.md: half-made");
  }, 300_000);
});
