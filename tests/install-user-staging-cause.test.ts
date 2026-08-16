/**
 * `install-user` must report WHY it staged instead of writing.
 *
 * Manifest mode has four causes: the `.managed` sentinel, `--mode manifest`,
 * `userLevel.mode` in the hub config, and the `AGENTBOOT_USER_LEVEL_MODE`
 * override. The CLI printed one fixed sentence for all of them —
 * "~/.claude is externally managed" — so three of the four were reported as the
 * fourth.
 *
 * It is not a cosmetic mislabel. That sentence asserts a fact about the
 * operator's filesystem, in the present tense, that nothing checked on those
 * three paths: it claims another tool has claimed ~/.claude. An operator asking
 * "why did AgentBoot refuse to write my home directory" is sent hunting for a
 * sentinel that does not exist, and a support transcript carrying that line is
 * evidence for a state that was never observed. Same family as the rest of this
 * branch — a report whose confidence exceeds what the code actually determined.
 *
 * The sentinel case must keep saying so, which is why the control below asserts
 * it: a fix that made every cause read generically would trade one wrong answer
 * for four vague ones.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");
const MODE_ENV = "AGENTBOOT_USER_LEVEL_MODE";

let base = "";
let hub = "";
let ready = false;

function runInstallUser(
  home: string,
  extraArgs: string[] = [],
  extraEnv: Record<string, string> = {},
): { status: number; out: string } {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    USERPROFILE: home,
    NODE_NO_WARNINGS: "1",
    FORCE_COLOR: "0",
  };
  // Never inherit the override from a sibling case — it is a variable under test.
  delete env[MODE_ENV];
  Object.assign(env, extraEnv);
  const r = spawnSync("node", [CLI, "install-user", ...extraArgs], {
    cwd: hub,
    env,
    encoding: "utf-8",
    timeout: 180_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A fresh HOME, optionally carrying the sentinel an external provider drops. */
function freshHome(withSentinel: boolean): string {
  const home = fs.mkdtempSync(path.join(base, "home-"));
  if (withSentinel) {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", ".managed"), "");
  }
  return home;
}

describe("install-user names the actual cause of manifest mode", () => {
  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-stagecause-"));
    hub = path.join(base, "hub");
    const scaffoldHome = path.join(base, "scaffold-home");
    fs.mkdirSync(scaffoldHome, { recursive: true });
    const env = { ...process.env, HOME: scaffoldHome, USERPROFILE: scaffoldHome, NODE_NO_WARNINGS: "1" };
    const scaffold = spawnSync(
      "node",
      [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
      { cwd: base, env, encoding: "utf-8", timeout: 300_000 },
    );
    if (scaffold.status !== 0) {
      throw new Error(`scaffold failed: ${scaffold.stdout}${scaffold.stderr}`);
    }
    const build = spawnSync("node", [CLI, "build"], { cwd: hub, env, encoding: "utf-8", timeout: 300_000 });
    if (build.status !== 0) throw new Error(`build failed: ${build.stdout}${build.stderr}`);
    ready = true;
  }, 600_000);

  afterAll(() => {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it("the fixture built (an unbuilt fixture makes every case below vacuous)", () => {
    // beforeAll throws on a failed scaffold/build, so a broken fixture fails the
    // whole file loudly rather than skipping it into a green result. Asserted
    // here as well so the reason is named in the report.
    expect(ready).toBe(true);
  });

  it("CONTROL — the sentinel cause still says 'externally managed'", () => {
    // Guards against the lazy fix: replacing one wrong sentence with one vague
    // sentence would satisfy every other case in this file.
    const r = runInstallUser(freshHome(true));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("externally managed");
    expect(r.out).toContain(".managed");
    expect(r.out).toMatch(/Staged \d+ file\(s\) for handoff/);
  }, 300_000);

  it("`--mode manifest` with NO sentinel does not claim external management", () => {
    const r = runInstallUser(freshHome(false), ["--mode", "manifest"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/Staged \d+ file\(s\) for handoff/);
    expect(
      r.out,
      "No .managed sentinel exists on this machine. Reporting the operator's own " +
      "--mode flag as external management sends them looking for a file that is " +
      "not there, and puts an unverified claim about their filesystem in the log.",
    ).not.toContain("externally managed");
    expect(r.out).toContain("--mode manifest");
  }, 300_000);

  it("the env override with NO sentinel names the env variable", () => {
    const r = runInstallUser(freshHome(false), [], { [MODE_ENV]: "manifest" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/Staged \d+ file\(s\) for handoff/);
    expect(r.out).not.toContain("externally managed");
    expect(r.out).toContain(MODE_ENV);
  }, 300_000);

  it("a refused mode is reported as a refusal, not as external management", () => {
    // `--mode direct` against the sentinel: the sentinel IS present here, but the
    // reason this run staged is the refusal, and that is what must lead.
    const r = runInstallUser(freshHome(true), ["--mode", "direct"]);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain("Refusing a direct write");
    expect(r.out).toContain("the requested write mode was refused");
  }, 300_000);
});
