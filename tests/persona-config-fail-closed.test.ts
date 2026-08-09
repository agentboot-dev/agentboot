/**
 * NF3-7 — an unreadable persona policy was a warning, and the persona shipped.
 *
 * loadPersonaConfig() caught the parse error, printed a yellow
 * `⚠ Failed to parse persona.config.json in <dir>`, and returned null. Every
 * downstream reader is `personaConfig?.disallowedTools`,
 * `personaConfig?.tools`, `pc?.hooks` — all no-ops on null — so the persona
 * compiled and SHIPPED with its entire config silently absent, including its
 * tool restrictions, and the build exited 0.
 *
 * "I could not read the policy" resolving to "there is no policy" is the
 * fail-open-on-unknown-data class. The asymmetry that decides it: a persona with
 * NO config file is a legitimate, common state; a persona with a config that
 * cannot be PARSED is an operator who wrote a policy and got none of it, and the
 * only two outcomes are "stop" or "ship the agent unrestricted".
 *
 * Both directions are asserted: a gate that refuses a persona with no config at
 * all would be an outage, since that is the default shape.
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
let personaDir = "";

const ab = (args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const cfgPath = () => path.join(personaDir, "persona.config.json");
const agentFile = () => path.join(hub, "dist", "claude", "core", "agents", "code-reviewer.md");

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf37-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
  // A hub-local copy of a shipped persona, so the config under test is the one
  // the build reads.
  personaDir = path.join(hub, "core", "personas", "code-reviewer");
  fs.mkdirSync(personaDir, { recursive: true });
  fs.cpSync(path.join(ROOT, "core", "personas", "code-reviewer"), personaDir, { recursive: true });
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("NF3-7 — an unreadable persona policy stops the build", () => {
  it("precondition: a VALID config builds and the restriction reaches the agent", () => {
    fs.writeFileSync(cfgPath(), JSON.stringify({ disallowedTools: ["Bash"] }));
    const r = ab(["build"]);
    expect(r.status, r.out).toBe(0);
    expect(fs.readFileSync(agentFile(), "utf-8"), "the control never shipped, so this test proves nothing")
      .toContain("disallowedTools:");
  }, 300_000);

  it("NF3-7: a TRUNCATED config is fatal, and names the file and the consequence", () => {
    fs.writeFileSync(cfgPath(), '{"disallowedTools":["Bash"],');
    const r = ab(["build"]);
    expect(r.status, `a persona shipped with its policy silently absent:\n${r.out}`).toBe(1);
    expect(r.out).toContain("persona.config.json");
    expect(r.out, "the refusal did not say what would have been lost").toMatch(/restriction/i);
  }, 300_000);

  it("NF3-7: a config that PARSES but is not an object is fatal too", () => {
    // 42, a bare string, null and [] all parse, and every field read off them is
    // undefined — the same silent no-policy outcome by another route.
    //
    // The exit code ALONE cannot prove this. Mutating the shape check away left
    // all seven tests green, because countPersonaScopeControls() also fails
    // closed on an unreadable persona config and the capability gate exits 1 on
    // its own. Two guards is correct defence in depth; a test that cannot tell
    // them apart is not a test of either. So assert the REASON.
    for (const bad of ["42", '"hello"', "null", "[]"]) {
      fs.writeFileSync(cfgPath(), bad);
      const r = ab(["build"]);
      expect(r.status, `persona.config.json = ${bad} shipped an unrestricted persona:\n${r.out}`).toBe(1);
      expect(
        r.out,
        `${bad} was refused by some OTHER gate, so the shape check is unproven:\n${r.out}`,
      ).toContain("is not a JSON object");
    }
  }, 600_000);

  it("NF3-7: the failed build does NOT leave a shipped agent claiming to be restricted", () => {
    fs.writeFileSync(cfgPath(), "{ not json");
    ab(["build"]);
    // A failed build leaves the previous dist/ byte-identical by design, so the
    // guarantee is the STAMP, not the file: nothing downstream may treat this
    // tree as current.
    const stamp = JSON.parse(
      fs.readFileSync(path.join(hub, "dist", ".agentboot-build.json"), "utf-8"));
    expect(stamp.status).toBe("failed");
  }, 300_000);

  it("NEGATIVE: a persona with NO persona.config.json builds — that is the default shape", () => {
    fs.rmSync(cfgPath(), { force: true });
    const r = ab(["build"]);
    expect(r.status, `refusing a persona that simply has no config is an outage:\n${r.out}`).toBe(0);
  }, 300_000);

  it("NEGATIVE: an EMPTY object is a valid config, not an unreadable one", () => {
    fs.writeFileSync(cfgPath(), "{}");
    expect(ab(["build"]).status).toBe(0);
  }, 300_000);

  it("NEGATIVE: JSONC comments still parse — the strip step is not collateral damage", () => {
    fs.writeFileSync(cfgPath(), '// the org deny list\n{"disallowedTools":["Bash"]}\n');
    const r = ab(["build"]);
    expect(r.status, r.out).toBe(0);
    expect(fs.readFileSync(agentFile(), "utf-8")).toContain("disallowedTools:");
  }, 300_000);
});
