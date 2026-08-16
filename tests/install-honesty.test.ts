/**
 * Q112 — `agentboot install` reported success over a hub it never built.
 *
 * `runBuild` and `runSync` spawned the BARE NAME `agentboot`, resolved off PATH.
 * During the one command that runs before anything is installed, that name is
 * routinely not on PATH: a local (non-global) install, an `npx` invocation, CI,
 * a provisioning script. `spawnSync` returned `{status: null, error: ENOENT}`,
 * and install printed, in this order:
 *
 *     ✗ Build FAILED — nothing was compiled …
 *     Non-interactive install complete.          ← exit 0
 *
 * The scaffold genuinely succeeded, which is why it read as a pass. But the hub
 * had no `dist/`, nothing could be deployed from it, and a non-interactive
 * caller saw exit 0 and moved on. "The parts I did are fine" is not the question
 * an exit code answers.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FIX ALONE. Two tests were failing on CI
 * *because* of this defect — they were catching it by accident, through their
 * scaffolds coming up without a `dist/`. Repairing those tests made the symptom
 * disappear while the disease remained, leaving CI **less** informative about
 * install honesty than when it was red. This is the deliberate replacement: an
 * assertion that names the property directly instead of stumbling over it.
 *
 * The maintainer's own machine cannot reproduce the original defect — `agentboot`
 * is on PATH there via Homebrew — which is exactly why it survived. So the test
 * constructs a PATH containing `node` and nothing else.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** A PATH with `node` and nothing else — no `agentboot`, no `npx`. */
function nodeOnlyBin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nodeonly-"));
  fs.symlinkSync(process.execPath, path.join(dir, "node"));
  return dir;
}

function install(hub: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { encoding: "utf-8", timeout: 300_000, env: { NODE_NO_WARNINGS: "1", ...env } },
  );
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("install never reports success over a hub it did not build", () => {
  // POSIX symlink + PATH semantics. Windows resolution differs enough that this
  // case would be asserting something else there; the property is platform
  // neutral but this construction is not, and a case that passes for the wrong
  // reason on one platform is worth less than an honest skip.
  const posix = process.platform !== "win32";

  it.runIf(posix)("exits NON-ZERO and says INCOMPLETE when the build cannot run", () => {
    const bin = nodeOnlyBin();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-q112-fail-"));
    const hub = path.join(base, "hub");

    const r = install(hub, { PATH: bin });

    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/Install INCOMPLETE/);
    // The old message was a yellow "Build did not complete — you can run
    // `agentboot build` later", which advises running a command that will not be
    // found either. A failure has to name what actually happened.
    expect(r.out).not.toMatch(/install complete/i);
    // And the claim must be true: there really is no dist to deploy.
    expect(fs.existsSync(path.join(hub, "dist"))).toBe(false);

    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  });

  it("exits ZERO and reports complete when the build DOES run", () => {
    // The silent case. Without it this file would pass on a build that never
    // succeeds for anyone — a gate that only ever fires is as useless as one
    // that never does.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-q112-ok-"));
    const hub = path.join(base, "hub");

    const r = install(hub, { PATH: process.env.PATH });

    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/install complete/i);
    expect(r.out).not.toMatch(/INCOMPLETE/);
    expect(fs.existsSync(path.join(hub, "dist"))).toBe(true);

    fs.rmSync(base, { recursive: true, force: true });
  });

  it("resolves its own CLI rather than a bare name off PATH", () => {
    // The root cause, asserted directly so a future edit cannot quietly
    // reintroduce it. `spawnSync("agentboot", …)` is the shape that made the
    // defect invisible on any machine where AgentBoot is installed globally —
    // which is every maintainer's machine, and no CI runner's.
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "install.ts"), "utf-8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/spawnSync\(\s*["']agentboot["']/);
  });
});
