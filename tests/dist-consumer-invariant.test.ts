/**
 * A-class — no command may read dist/ without declaring what it does about the
 * freshness stamp.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * N1 established that a failed build leaves dist/ byte-identical, so file
 * presence is not evidence of current policy. The gate was then bolted onto
 * consumers one at a time as somebody happened to notice them: sync, then
 * drift-check and audit, then conformance, baseline and evidence-pack. Three
 * separate sessions each believed they had found the last one. They had not —
 * install-user (which writes org policy onto a developer's machine), export and
 * publish (which package and distribute it), test, cost-estimate, doctor,
 * status and lint were all still reading a superseded tree and reporting green.
 *
 * The gated set and the consumer set were two hand-maintained lists. This
 * branch's own norm names that failure: TWO LISTS THAT MUST AGREE WILL DRIFT —
 * assert the invariant in code instead.
 *
 * HOW THIS ASSERTS IT
 * -------------------
 * The consumer set is DERIVED from scripts/cli.ts by parsing the command
 * blocks; only the POSTURE is declared, in scripts/lib/dist-consumers.ts. A
 * command that begins reading dist/ and is not declared fails here. A command
 * declared `gated` that stops calling assertDistFreshOrExit fails here. Neither
 * can happen silently, which is the whole point.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DIST_CONSUMERS } from "../scripts/lib/dist-consumers.js";

const ROOT = path.resolve(__dirname, "..");
const CLI_SRC = path.join(ROOT, "scripts", "cli.ts");

interface CommandBlock {
  name: string;
  body: string;
}

/**
 * Slice scripts/cli.ts into one block per `program.command("<name>")`.
 *
 * Deliberately a source parse and not a runtime probe: the invariant must hold
 * for every command, including ones that need a hub, a network, or an LLM to
 * run, and a runtime enumeration would quietly test only the cheap ones.
 */
function commandBlocks(): CommandBlock[] {
  const lines = fs.readFileSync(CLI_SRC, "utf-8").split("\n");
  const starts: Array<{ name: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\.command\("([a-z0-9-]+)"/.exec(lines[i]!);
    if (m) starts.push({ name: m[1]!, line: i });
  }
  return starts.map((s, k) => ({
    name: s.name,
    body: lines.slice(s.line, k + 1 < starts.length ? starts[k + 1]!.line : lines.length).join("\n"),
  }));
}

/**
 * Does this command block read dist/?
 *
 * Intentionally broad: over-matching costs one registry entry, under-matching
 * costs a consumer that ships superseded policy. Every historical miss —
 * install-user's `path.join(cwd, …, "claude", "core")`, publish's
 * `path.join(cwd, "dist", "plugin", …)`, status's `fs.statSync(distPath)` —
 * is caught by one of these.
 */
function readsDist(body: string): boolean {
  return (
    /\bdistPath\b/.test(body) ||
    /"dist"/.test(body) ||
    /distCore|distPluginPath|distClaudeMd/.test(body) ||
    /readDistStamp|checkDistFreshness|DIST_STAMP/.test(body)
  );
}

const BLOCKS = commandBlocks();
const CONSUMERS = BLOCKS.filter((b) => readsDist(b.body));

describe("A-class — every dist/ consumer declares a freshness posture", () => {
  it("the parse found the CLI's commands at all — an empty enumeration is a vacuous check", () => {
    // Without this, a change to how commands are declared turns the whole file
    // into a green no-op, which is the failure mode it exists to prevent.
    expect(BLOCKS.length).toBeGreaterThan(20);
    expect(CONSUMERS.length).toBeGreaterThan(8);
    // Known consumers must be found by the detector, or the detector is broken.
    for (const known of ["sync", "install-user", "export", "status", "doctor", "conformance"]) {
      expect(
        BLOCKS.some((b) => b.name === known),
        `command \`${known}\` disappeared from the parse`
      ).toBe(true);
    }
  });

  it("A-1: every command that reads dist/ is declared in DIST_CONSUMERS", () => {
    const undeclared = CONSUMERS.map((c) => c.name).filter((n) => !DIST_CONSUMERS[n]);
    expect(
      undeclared,
      `these commands read dist/ with no declared freshness posture — add them to ` +
        `scripts/lib/dist-consumers.ts with a posture and a reason: ${undeclared.join(", ")}`
    ).toEqual([]);
  });

  it("A-2: every command declared `gated` actually calls the gate", () => {
    const syncSrc = fs.readFileSync(path.join(ROOT, "scripts", "sync.ts"), "utf-8");
    const missing: string[] = [];
    for (const [name, decl] of Object.entries(DIST_CONSUMERS)) {
      if (decl.posture !== "gated") continue;
      if (decl.gateIn === "scripts/sync.ts") {
        if (!/assertDistFreshOrExit|checkDistFreshness/.test(syncSrc)) missing.push(name);
        continue;
      }
      const block = BLOCKS.find((b) => b.name === name);
      expect(block, `DIST_CONSUMERS names \`${name}\`, which is not a CLI command`).toBeDefined();
      if (!/assertDistFreshOrExit\(/.test(block!.body)) missing.push(name);
    }
    expect(
      missing,
      `declared gated but never calls assertDistFreshOrExit: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("A-3: every command declared `reports` actually reports", () => {
    const missing: string[] = [];
    for (const [name, decl] of Object.entries(DIST_CONSUMERS)) {
      if (decl.posture !== "reports") continue;
      const block = BLOCKS.find((b) => b.name === name)!;
      // Either it calls the shared reporter, or it reads the stamp itself and
      // says what it found. `doctor` folds the finding into its own check list;
      // `status` prints the build outcome. Both are reporting; neither is silent.
      const reports =
        /reportDistFreshness\(/.test(block.body) ||
        /readDistStamp\(/.test(block.body) ||
        /checkDistFreshness\(/.test(block.body);
      if (!reports) missing.push(name);
    }
    expect(
      missing,
      `declared reports but consults nothing about dist/ freshness: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("A-4: `reports` and `producer` postures each carry a stated reason", () => {
    // "It's just a producer" / "it only reports" is exactly the claim that must
    // not be assertable by hand-wave — it is how eight consumers stayed ungated.
    for (const [name, decl] of Object.entries(DIST_CONSUMERS)) {
      if (decl.posture === "gated") continue;
      expect(decl.reason, `${name} takes the ${decl.posture} posture with no reason given`)
        .toBeTruthy();
      expect((decl.reason ?? "").length, `${name}'s reason is too thin to be one`)
        .toBeGreaterThan(40);
    }
  });

  it("A-5: DIST_CONSUMERS names no command that does not exist", () => {
    const names = new Set(BLOCKS.map((b) => b.name));
    const ghosts = Object.keys(DIST_CONSUMERS).filter((n) => !names.has(n));
    expect(ghosts, `declared but not a CLI command: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("A-6: the gate itself still fails closed on every unknown", () => {
    // The registry is only worth having if what it points at refuses. Guard the
    // one branch that would make every `gated` entry meaningless.
    const cli = fs.readFileSync(CLI_SRC, "utf-8");
    const fn = /function assertDistFreshOrExit[\s\S]*?\n}/.exec(cli)?.[0] ?? "";
    expect(fn).toContain("process.exit(1)");
    expect(fn).toContain("checkDistFreshness");
  });
});
