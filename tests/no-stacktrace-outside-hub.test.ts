/**
 * R1-4 — a command run outside a hub must say so, not crash.
 *
 * `loadConfig` throws when the file is absent and every command action is an
 * async function with no handler, so an unguarded call does not print an error —
 * it prints a raw Node stack trace and exits 7. A3 added an unconditional
 * `loadConfig` to `audit`, which is how it was noticed; `drift-check`,
 * `mcp-verify` and `telemetry-inspect` were doing the same thing already. Under
 * `--format json` a machine consumer got a stack trace on stderr where it
 * expected JSON.
 *
 * `drift-check` had been given an fs.existsSync guard for exactly this on ONE of
 * its two branches. That is the recurring shape on this branch: one call site
 * fixed, the siblings left. So this does not test four commands — it enumerates
 * every command the CLI declares and asserts none of them can do it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let empty = "";

beforeAll(() => {
  empty = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nohub-"));
});
afterAll(() => {
  if (empty) fs.rmSync(empty, { recursive: true, force: true });
});

/**
 * Commands NOT probed, each for a stated reason. Anything not listed here is
 * probed — a new command cannot opt out by being new.
 */
const NOT_PROBED: Record<string, string> = {
  install: "scaffolds a hub — running it in the temp dir would create one",
  setup: "alias of install",
  "dev-build": "maintainer-only; builds this repo, not the cwd",
  "dev-sync": "maintainer-only",
  "mcp-server": "starts a long-lived stdio server and would hang the probe",
  uninstall: "destructive; asks before acting",
  migrate: "rewrites hub files in place",
  import: "reads an external repo, needs an argument",
  connect: "needs a hub id argument",
  use: "needs a hub id argument",
  pull: "marketplace subcommand, needs an id",
  search: "marketplace subcommand",
  publish: "marketplace subcommand name collision; the top-level one IS probed",
  seed: "registry subcommand that writes",
  "validate-contrib": "needs a path argument",
};

function cliCommands(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");
  const names = new Set<string>();
  for (const m of src.matchAll(/^\s*\.command\("([a-z0-9-]+)"/gm)) names.add(m[1]!);
  return [...names].filter((n) => !(n in NOT_PROBED)).sort();
}

const COMMANDS = cliCommands();

describe("R1-4 — no command emits a raw stack trace outside a hub", () => {
  it("the enumeration is non-empty — an empty probe list is a vacuous check", () => {
    expect(COMMANDS.length).toBeGreaterThan(10);
    for (const known of ["audit", "drift-check", "mcp-verify", "telemetry-inspect"]) {
      expect(COMMANDS, `${known} dropped out of the probe set`).toContain(known);
    }
  });

  for (const cmd of COMMANDS) {
    it(`${cmd}: fails honestly, not with a Node stack trace`, () => {
      const r = spawnSync(process.execPath, [CLI, cmd], {
        cwd: empty,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
        encoding: "utf-8",
        timeout: 120_000,
      });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      // The signature of an unhandled throw escaping a command action.
      expect(out, `${cmd} printed a stack trace`).not.toMatch(/^\s+at [A-Za-z_$][\w$.]* \(/m);
      expect(out, `${cmd} printed the rethrow site`).not.toContain("cli.ts:56");
      // Exit 7 is what an unhandled async rejection produces here. Any
      // deliberate refusal is 1 or 2; a success is 0.
      expect(r.status, `${cmd} exited ${r.status} — the unhandled-rejection code`).not.toBe(7);

      // R1-4 residual: "no stack frame" and "not exit 7" are BOTH satisfied by a
      // FALSE GREEN, which is what was actually happening. In the dev checkout
      // `resolveConfigPath`'s last fallback is <packageRoot>/agentboot.config.json,
      // which exists — so `agentboot validate` in an empty directory printed
      // "Config: /…/agentboot/agentboot.config.json" and "✓ All 12 checks passed",
      // exit 0, having validated THE AGENTBOOT REPO'S OWN HUB. The test could not
      // see it, and `npm pack` does not ship that file, so the same code path in a
      // real install threw a raw stack trace out of loadConfig.
      //
      // So: whatever a command does outside a hub, it must not claim to have
      // acted on one. Naming the package root in the output is the tell.
      expect(out, `${cmd} silently adopted the AgentBoot package's own hub`).not.toContain(
        path.join(ROOT, "agentboot.config.json"),
      );
    }, 180_000);
  }

  /**
   * The three commands that reach a hub config through `runScript` rather than
   * through a `loadHubConfigOrExit` call in cli.ts. They were the false-green
   * carriers, so they get the assertion the generic probe cannot make: an exit
   * code, not merely a shape of output.
   */
  for (const cmd of ["validate", "build", "sync"]) {
    it(`${cmd}: REFUSES outside a hub — a false green is worse than a stack trace`, () => {
      const env = { ...process.env, NODE_NO_WARNINGS: "1" };
      delete (env as Record<string, string | undefined>)["AGENTBOOT_HUB"];
      const r = spawnSync(process.execPath, [CLI, cmd], {
        cwd: empty, env, encoding: "utf-8", timeout: 300_000,
      });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(r.status, `${cmd} exited 0 outside a hub:\n${out}`).toBe(1);
      expect(out).toContain("needs a hub");
      expect(out, `${cmd} validated a hub that is not here`).not.toMatch(/All \d+ checks passed/);
      expect(out).not.toMatch(/^\s+at [A-Za-z_$][\w$.]* \(/m);
    }, 300_000);
  }
});
