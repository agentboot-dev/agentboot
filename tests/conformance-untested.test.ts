/**
 * R1-A — `agentboot conformance` reported success for a run that measured nothing.
 *
 * The harness was already honest at the DATA layer: a control it cannot execute
 * is recorded `untested`, never `pass`. The RUN layer was not. `failedPlatforms`
 * counted only `fail`, so a machine with no bash produced a full sheet of
 * `untested` and then printed
 *
 *     ✓ All probed controls behave as declared.
 *
 * and exited 0 — on the one command in the product whose entire job is empirical
 * verification, and the command the weekly `conformance-baseline` workflow runs
 * before archiving its snapshot. A skip must alarm as loudly as a failure.
 *
 * Both directions are pinned: the fresh, bash-present run must still be green,
 * or the gate is just an outage.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { runConformance, isUntested, bashCandidates, type ControlResult } from "../scripts/lib/conformance.js";
import type { AgentBootConfig } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/**
 * Merge overrides onto the inherited environment.
 *
 * On Windows environment variables are case-INSENSITIVE, but a spread of
 * `process.env` is an ordinary JS object carrying whatever casing the OS used.
 * `{ ...process.env, ProgramFiles: x }` therefore leaves an inherited
 * `PROGRAMFILES` sitting beside the override and the child can resolve either —
 * which is how a test that believed it had removed bash kept finding it. Strip
 * every case-insensitive duplicate of a key we are overriding.
 */
function childEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
  if (process.platform === "win32") {
    const overridden = new Set(Object.keys(overrides).map((k) => k.toLowerCase()));
    for (const k of Object.keys(merged)) if (overridden.has(k.toLowerCase())) delete merged[k];
  }
  return { ...merged, ...overrides };
}

/** Run the real CLI. Status is read WITHOUT a pipe — a piped $? is the pipe's. */
function ab(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: childEnv(env),
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

let base: string;
let hub: string;
/** A PATH containing nothing at all — probeBash() finds no bash through it. */
let emptyBinDir: string;

/**
 * An environment in which NO bash is discoverable — on every platform.
 *
 * Emptying PATH is sufficient on POSIX and was NOT sufficient on Windows: Git
 * for Windows is found through `%ProgramFiles%` (see `bashCandidates`), and on
 * a Windows CI runner Git Bash is on PATH by design, so the three negatives
 * below ran with bash present. They did not silently pass — they failed loudly,
 * which is the only reason this was caught — but the shape to avoid is
 * "skip the negative on Windows": hook execution is *most* fragile there, and a
 * skipped negative on that platform is worth close to nothing. So the case is
 * expressed platform-correctly instead, by blanking every root the resolver
 * consults rather than by blanking PATH and hoping.
 */
const noBash = (): NodeJS.ProcessEnv => ({
  PATH: emptyBinDir,
  Path: emptyBinDir,
  ProgramFiles: emptyBinDir,
  ProgramW6432: emptyBinDir,
  "ProgramFiles(x86)": emptyBinDir,
  LOCALAPPDATA: emptyBinDir,
  AGENTBOOT_BASH: "",
});

/**
 * The negatives assert an ABSENCE (no green claim), and an absence is satisfied
 * by a crash, an early exit, or a bad flag just as well as by the product
 * behaving. So every negative also asserts the run got far enough to produce a
 * report, and that the untestedness came from the BASH probe specifically —
 * "the hook script is missing from dist/" is a different untested reason and
 * must not be able to stand in for this one.
 */
function assertUntestedBecauseNoBash(out: string): void {
  expect(out, "the run never produced a report — an absent green line proves nothing here")
    .toMatch(/AgentBoot — platform conformance/);
  expect(out, "claude's controls were never reported on").toMatch(/claude — declared/);
  expect(out, "untested for some reason OTHER than the missing bash")
    .toMatch(/bash not available on this machine/);
  expect(out).toMatch(/UNTESTED controls on/);
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-conf-untested-"));
  hub = path.join(base, "hub");
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.personas = { ...(cfg.personas ?? {}), outputFormats: ["claude", "cursor"] };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const build = ab(["build"], hub);
  if (build.status !== 0) throw new Error(`build failed: ${build.out}`);

  emptyBinDir = path.join(base, "empty-bin");
  fs.mkdirSync(emptyBinDir, { recursive: true });
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("conformance — a run that measured nothing is not a pass", () => {
  it("POSITIVE: the normal run still exits 0 and reports how many controls were probed", () => {
    const r = ab(["conformance"], hub);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/probed control\(s\) behave as declared/);
    // The count must be real, not decorative.
    expect(r.out).not.toMatch(/✓ All 0 probed/);
  }, 300_000);

  it("NEGATIVE: with no bash on PATH every control is untested — exit 1, no green line", () => {
    const r = ab(["conformance"], hub, noBash());
    assertUntestedBecauseNoBash(r.out);
    expect(r.out).not.toMatch(/behave as declared/);
    expect(r.status, r.out).toBe(1);
  }, 300_000);

  it("--allow-untested is an explicit, visible opt-out — exit 0 but still no green claim", () => {
    const r = ab(["conformance", "--allow-untested"], hub, noBash());
    expect(r.status, r.out).toBe(0);
    assertUntestedBecauseNoBash(r.out);
    expect(r.out).not.toMatch(/behave as declared/);
  }, 300_000);

  it("--format json exits 1 on an untested run and carries the counts a CI job can assert on", () => {
    const r = ab(["conformance", "--format", "json"], hub, noBash());
    expect(r.status, r.out).toBe(1);
    const parsed = JSON.parse(r.out.slice(r.out.indexOf("{"))) as {
      bashAvailable: boolean; untestedPlatforms: string[]; probedControls: number;
    };
    expect(parsed.bashAvailable).toBe(false);
    expect(parsed.untestedPlatforms).toContain("claude");
    expect(parsed.probedControls).toBe(0);
  }, 300_000);

  /**
   * A second, independent lever on the same gate — and the one that is
   * identical on every platform, so it cannot be argued away as environmental.
   * An operator who points AGENTBOOT_BASH at something that will not run must
   * be told the controls were not measured; falling back to some other bash
   * would be the silent substitution the harness exists to catch.
   */
  it("an explicitly named bash that does not run is UNTESTED, not quietly replaced", () => {
    const r = ab(["conformance"], hub, { AGENTBOOT_BASH: path.join(emptyBinDir, "no-such-bash") });
    assertUntestedBecauseNoBash(r.out);
    expect(r.out).not.toMatch(/behave as declared/);
    expect(r.status, r.out).toBe(1);
  }, 300_000);
});

/**
 * The resolver itself, asserted from any host.
 *
 * `probeBash()` can only ever report what THIS machine has, so the Windows
 * branch was unasserted on the CI legs that run most often. These pin the
 * candidate list directly — including the property the negatives depend on:
 * that the environment fully determines it.
 */
describe("bashCandidates — bash discovery is environment-determined", () => {
  it("finds Git Bash under every root Windows actually installs it to", () => {
    const c = bashCandidates(
      {
        ProgramFiles: "C:\\Program Files",
        ProgramW6432: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
      },
      "win32",
    );
    expect(c[0]).toBe("bash");
    expect(c).toContain(path.join("C:\\Program Files", "Git", "bin", "bash.exe"));
    // The per-user installer's default location — the one the hardcoded path
    // could not see, so those operators were told UNTESTED with bash on disk.
    expect(c).toContain(path.join("C:\\Users\\dev\\AppData\\Local", "Programs", "Git", "bin", "bash.exe"));
    expect(c).toContain(path.join("C:\\Program Files (x86)", "Git", "bin", "bash.exe"));
    expect(new Set(c).size).toBe(c.length); // ProgramFiles === ProgramW6432 is the norm
  });

  it("with those roots blanked there is nothing to find — the gate is reachable on Windows", () => {
    expect(bashCandidates({}, "win32")).toEqual(["bash"]);
  });

  it("AGENTBOOT_BASH is the ONLY candidate when set — no silent substitution", () => {
    expect(bashCandidates({ AGENTBOOT_BASH: "/opt/bash", ProgramFiles: "C:\\Program Files" }, "win32"))
      .toEqual(["/opt/bash"]);
    // Blank is "unset", not "a bash called empty string".
    expect(bashCandidates({ AGENTBOOT_BASH: "  " }, "linux")).toEqual(["bash"]);
  });

  it("no Windows path leaks onto a POSIX host", () => {
    expect(bashCandidates({ ProgramFiles: "C:\\Program Files" }, "darwin")).toEqual(["bash"]);
  });
});

describe("runConformance — the counts the CLI gates on", () => {
  it("probedControls counts only controls that actually executed a probe", () => {
    const dist = path.join(hub, "dist");
    const config = JSON.parse(fs.readFileSync(path.join(hub, "agentboot.config.json"), "utf-8"));
    const run = runConformance(dist, ["claude", "cursor"], config, "test");
    // cursor has no hook mechanism at all — not-applicable, never probed.
    const cursor = run.manifests.find((m) => m.platform === "cursor")!;
    expect(cursor.controls.every((c: ControlResult) => c.status === "not-applicable")).toBe(true);
    // claude's hooks exist and were exercised.
    expect(run.probedControls).toBeGreaterThan(0);
    expect(run.untestedPlatforms).toEqual([]);
  }, 300_000);

  it("isUntested is the single predicate — a status rename cannot silently un-gate the CLI", () => {
    expect(isUntested({ control: "x", mechanism: "hook script", declared_level: "enforced", status: "untested", probes: [] })).toBe(true);
    expect(isUntested({ control: "x", mechanism: "hook script", declared_level: "enforced", status: "pass", probes: [] })).toBe(false);
  });
});

/**
 * conformance printed a manifest path for a file it did not write.
 *
 * `runConformance` writes dist/<platform>/enforcement-manifest.json only
 * `if (fs.existsSync(platformDir))`, with no else branch, while the CLI printed
 * `manifest: dist/${m.platform}/enforcement-manifest.json` unconditionally.
 * Verified with dist/claude and dist/cursor deleted: both paths were printed and
 * `ls` confirmed neither file existed. 1feb969 fixed the exit code — untested is
 * no longer a pass — and left the phantom path in the report.
 *
 * A report that names a nonexistent evidence file is worse than one that says
 * nothing: the path is what an auditor is told to go and read.
 */
describe("conformance — the report names only files that exist", () => {
  it("manifestPaths carries a platform only when its manifest was written", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "ab-phantom-"));
    const dist = path.join(hub, "dist");
    fs.mkdirSync(path.join(dist, "claude"), { recursive: true });
    // cursor is configured but has NO tree — the state that produced the phantom.
    const config = {
      org: "acme", personas: { outputFormats: ["claude", "cursor"] },
    } as unknown as AgentBootConfig;

    const run = runConformance(dist, ["claude", "cursor"], config, "0.0.0");
    expect(Object.keys(run.manifestPaths)).toEqual(["claude"]);
    expect(fs.existsSync(path.join(dist, "claude", "enforcement-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dist, "cursor", "enforcement-manifest.json"))).toBe(false);
    // Both platforms still get a manifest OBJECT in the run — the reading
    // happened, it just could not be persisted. The two facts are separate.
    expect(run.manifests.map((m) => m.platform).sort()).toEqual(["claude", "cursor"]);
  });
});
