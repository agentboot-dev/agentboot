/**
 * NF2-3 + NF2-4 — doctor's Coverage block said two things that were not true.
 *
 * NF2-4: `if (shortfalls.length === 0 && capViolations.length === 0 &&
 * covFormats.length > 1) ok("…every configured capability reaches every
 * configured platform")` printed a PASS when ZERO capabilities were configured.
 * On a hub with `instructions.enabled: []` and no managed config,
 * `CAPABILITY_SUPPORT.detect()` is false for every row and BOTH Coverage ticks
 * printed — so the operator read coverage as verified, twice, over nothing.
 *
 * That is the same "a gate that evaluates zero X is not a passing gate, it is an
 * absent one" shape NF-5 fixed for the Enforcement and Scoping blocks two
 * commits later in the same round. The Coverage ticks did not get the treatment.
 *
 * NF2-3: `CAPABILITY_SUPPORT["instructions[].applyTo"].emittedBy` was
 * `["copilot"]` while cursor, windsurf and jetbrains all emit a real path scope
 * — and APPLY_TO_PROJECTION in the same repo already classified all three as
 * `translated`. Two lists that must agree, with nothing asserting it, wired into
 * an operator-facing sentence:
 *
 *     "instructions[].applyTo — configured, but needs one of: copilot"
 *        on a hub where dist/cursor/…/zznarrow.instructions.mdc ALREADY carried
 *        `globs: "src/zzscopezz/**"` and `alwaysApply: false`
 *
 * i.e. doctor told the operator to add a platform to get a control they already
 * had, and asserted the control was "absent, not weaker" on three platforms
 * where it demonstrably was not.
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
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-cov-"));
});
afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

function hub(name: string, mutate: (c: Record<string, any>) => void, files: Record<string, string> = {}): string {
  const h = path.join(base, name);
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", h, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(h, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const cfgPath = path.join(h, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  mutate(cfg);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const b = spawnSync(process.execPath, [CLI, "build"], {
    cwd: h, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
  return h;
}

function coverageBlock(h: string): string {
  const d = spawnSync(process.execPath, [CLI, "doctor"], {
    cwd: h, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  const out = `${d.stdout ?? ""}${d.stderr ?? ""}`;
  const m = /^Coverage$([\s\S]*?)^Enforcement$/m.exec(out);
  return m ? m[1]! : `(no Coverage block found in:\n${out})`;
}

describe("NF2-4 — a Coverage tick over zero capabilities is not a pass", () => {
  let empty = "";
  beforeAll(() => {
    empty = hub("cov-empty", (c) => {
      c.personas = { ...(c.personas ?? {}), outputFormats: ["claude", "copilot", "cursor"] };
      c.instructions = { enabled: [] };
    });
  }, 600_000);

  it("says nothing was checked, rather than that everything passed", () => {
    const block = coverageBlock(empty);
    expect(block).toContain("nothing to check");
    // The exact sentence that was false. It claims a property of a set that is
    // empty, which reads to an operator as verification.
    expect(block, "the vacuous tick is still printed").not.toContain(
      "every configured capability reaches every configured platform",
    );
  }, 300_000);

  it("does not report coverage twice — the two ticks had the same wording", () => {
    const ticks = coverageBlock(empty).split("\n").filter((l) => l.includes("Capability coverage"));
    expect(ticks.length, `duplicated coverage report:\n${ticks.join("\n")}`).toBe(1);
  }, 300_000);
});

describe("NF2-4 (NEGATIVE) — with capabilities configured, the ticks are real", () => {
  let real = "";
  beforeAll(() => {
    real = hub("cov-real", (c) => {
      c.personas = { ...(c.personas ?? {}), outputFormats: ["claude", "copilot"] };
      c.managed = { enabled: true, guardrails: { denyTools: ["WebFetch"] } };
    });
  }, 600_000);

  it("counts what it evaluated, so a zero can never masquerade as a pass", () => {
    const block = coverageBlock(real);
    expect(block).not.toContain("nothing to check");
    expect(block).toMatch(/all \d+ configured capabilit/);
  }, 300_000);
});

describe("NF2-3 — doctor does not call a control absent where it is emitted", () => {
  let scoped = "";
  beforeAll(() => {
    scoped = hub(
      "cov-scope",
      (c) => {
        // cursor is a TRANSLATING platform for applyTo. Pre-fix, doctor told the
        // operator this control needed copilot.
        c.personas = { ...(c.personas ?? {}), outputFormats: ["claude", "cursor"] };
        c.instructions = { enabled: ["zznarrow.instructions"] };
      },
      {
        "core/instructions/zznarrow.instructions.md":
          '---\ndescription: narrow\napplyTo: "src/zzscopezz/**"\nscope-unsupported: acknowledged\n---\n# n\nbody\n',
      },
    );
  }, 600_000);

  it("cursor really received the scope — the premise, asserted not assumed", () => {
    const mdc = fs.readFileSync(
      path.join(scoped, "dist", "cursor", "core", "rules", "zznarrow.instructions.mdc"), "utf-8");
    expect(mdc).toContain("src/zzscopezz/**");
    expect(mdc).toContain("alwaysApply: false");
  }, 300_000);

  it("doctor does not tell the operator to add copilot to get what cursor already emits", () => {
    const block = coverageBlock(scoped);
    expect(block, `doctor: ${block}`).not.toMatch(/instructions\[\]\.applyTo[^\n]*needs one of/);
    expect(block, `doctor: ${block}`).not.toMatch(
      /instructions\[\]\.applyTo[^\n]*NOT[^\n]*cursor/,
    );
  }, 300_000);
});
