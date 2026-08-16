/**
 * A4 — `status` printed `Platforms:` and `Repos (N)` four lines apart and never
 * compared them.
 *
 * Displaying a contradiction on one screen and expecting the operator to
 * cross-reference two lists by eye is not a check. The repo in question can
 * NEVER receive anything: the hub does not build the tree sync would copy from.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { unbuiltRepoPlatforms, resolveRepoPlatforms } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 180_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scaffoldHub(tag: string): { base: string; hub: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `agentboot-${tag}-`));
  const hub = path.join(base, "hub");
  const r = spawnSync(
    "node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);
  return { base, hub };
}

describe("resolveRepoPlatforms — one normalization, shared", () => {
  it("U1: resolves the aliases operators actually type", () => {
    expect(resolveRepoPlatforms({ platform: "claude-code" })).toEqual(["claude"]);
    expect(resolveRepoPlatforms({ platforms: ["github-copilot", "openai-codex"] }))
      .toEqual(["copilot", "codex"]);
  });

  it("U2: defaults to claude, and the array form wins over the singular", () => {
    expect(resolveRepoPlatforms({})).toEqual(["claude"]);
    expect(resolveRepoPlatforms({ platform: "claude", platforms: ["cursor"] })).toEqual(["cursor"]);
  });
});

describe("unbuiltRepoPlatforms — the comparison that was never made", () => {
  it("U3: names the platform AND every repo that targets it", () => {
    const out = unbuiltRepoPlatforms(
      [
        { label: "web", platform: "cursor" },
        { label: "api", platform: "cursor" },
        { label: "ops", platform: "claude" },
      ],
      ["skill", "claude", "copilot"],
    );
    expect(out).toEqual([{ platform: "cursor", repos: ["web", "api"] }]);
  });

  it("U4 (NEGATIVE): a hub that builds everything its repos target reports nothing", () => {
    // If this ever fires, `status` cries wolf on every healthy hub and the
    // finding is trained away inside a week.
    expect(unbuiltRepoPlatforms(
      [{ label: "web", platform: "cursor" }, { label: "api", platforms: ["claude", "copilot"] }],
      ["claude", "copilot", "cursor"],
    )).toEqual([]);
  });

  it("U5: an ALIAS on either side still matches — this is why the fn is shared with sync", () => {
    expect(unbuiltRepoPlatforms([{ label: "web", platform: "claude-code" }], ["claude"])).toEqual([]);
    expect(unbuiltRepoPlatforms([{ label: "web", platform: "claude" }], ["claude-code"])).toEqual([]);
  });

  it("U6: an entry with no platform at all defaults to claude and is judged on that", () => {
    expect(unbuiltRepoPlatforms([{ label: "web" }], ["copilot"]))
      .toEqual([{ platform: "claude", repos: ["web"] }]);
    expect(unbuiltRepoPlatforms([{ label: "web" }], ["claude"])).toEqual([]);
  });

  it("U7: falls back to the path when a repo entry has no label", () => {
    expect(unbuiltRepoPlatforms([{ path: "../web", platform: "cursor" }], ["claude"]))
      .toEqual([{ platform: "cursor", repos: ["../web"] }]);
  });
});

describe("A4 integration: status surfaces it, doctor fails on it", () => {
  it("I1: status names the mismatch; doctor exits 1", () => {
    const { hub } = scaffoldHub("a4");
    expect(ab(["build"], hub).status).toBe(0);

    type Check = { status: string; message: string };
    const doctorChecks = (): Check[] =>
      (JSON.parse(ab(["doctor", "--format", "json"], hub).out).checks as Check[]);

    // Healthy first — otherwise the assertions below cannot tell a working gate
    // from a broken command. (A freshly scaffolded hub already exits 1 from
    // doctor for unrelated reasons — personas/traits resolve from the package,
    // not the hub — so the discriminating signal is the CHECK, not the code.)
    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ label: "ok-repo", path: "../ok", platform: "claude", scope: "core" }], null, 2),
    );
    expect(ab(["status"], hub).out).not.toContain("does not build it");
    expect(doctorChecks().filter((c) => c.message.includes("can never be synced"))).toEqual([]);
    expect(doctorChecks().some((c) => c.status === "ok" && c.message.includes("Every repos.json platform is built"))).toBe(true);

    fs.writeFileSync(
      path.join(hub, "repos.json"),
      JSON.stringify([{ label: "web", path: "../web", platform: "cursor", scope: "core" }], null, 2),
    );

    const status = ab(["status"], hub);
    expect(status.out).toContain("repos.json targets `cursor`");
    expect(status.out).toContain("web");

    // fail(), not warn() — the repo can never receive anything at all.
    const bad = doctorChecks().filter((c) => c.message.includes("can never be synced"));
    expect(bad.length).toBe(1);
    expect(bad[0]!.status).toBe("fail");
    expect(bad[0]!.message).toContain("cursor");

    // The machine-readable surface carries it too.
    const json = JSON.parse(ab(["status", "--format", "json"], hub).out);
    expect(json.unbuiltPlatforms).toEqual([{ platform: "cursor", repos: ["web"] }]);
  }, 300_000);
});
