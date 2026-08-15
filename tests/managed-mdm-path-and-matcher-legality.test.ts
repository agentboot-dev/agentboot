/**
 * L49 — two "green surface over an unenforced control" defects in compile.ts.
 *
 * 1. THE MDM TARGET PATH. The build told an MDM administrator to deploy
 *    managed-settings.json to `/Library/Application Support/Claude/` (macOS)
 *    and `C:\ProgramData\Claude\` (Windows). Claude Code reads neither. The
 *    macOS string is the Claude *Desktop* support directory; the Windows
 *    string is wrong in both components. An admin who follows it ships a
 *    profile that installs cleanly, reports success, drift-checks clean and
 *    enforces NOTHING — every HARD guardrail silently absent on every machine,
 *    behind a green build and a passing `validate`.
 *
 *    Ground truth was taken from the shipping Claude Code binary (v2.1.226),
 *    whose managed-settings root resolver is:
 *
 *        switch (platform) {
 *          case "macos":   return "/Library/Application Support/ClaudeCode";
 *          case "windows": return "C:\\Program Files\\ClaudeCode";
 *          default:        return "/etc/claude-code";
 *        }
 *
 *    Four doc pages already said `ClaudeCode/`; the code said `Claude/`. The
 *    docs were right. These tests pin the code so the two cannot drift again.
 *
 * 2. MATCHER LEGALITY. `ComplianceHookBinding.matcher` was documented
 *    "exact-match" directly above a binding emitting `Edit|Write|Bash`. If the
 *    comment had been true, that telemetry hook would have matched no tool and
 *    logged nothing, forever, silently. The comment was the wrong half: the
 *    same binary compiles the matcher with `new RegExp(...)` and `.test()`s it
 *    against the tool name, and its own settings-validation hint names the
 *    pipe form as supported. So alternation is legal — but nothing was
 *    asserting that every matcher we emit IS legal, which is what let the
 *    contradiction sit there unresolved.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MANAGED_SETTINGS_ROOTS, COMPLIANCE_HOOK_BINDINGS } from "../scripts/compile.js";

const ROOT = path.resolve(__dirname, "..");

/**
 * Run tsx's OWN entry point under the current node, never the `.bin` shim.
 *
 * `node_modules/.bin/tsx` is an extensionless shell script. On Windows the
 * executable shim is `tsx.cmd`, and `spawnSync` without a shell can launch
 * neither — it fails ENOENT with `status: null` and EMPTY stdout/stderr. That
 * is what took all five build-driven tests in this file down on the first
 * Windows CI run: nothing about the MDM path or the matchers was wrong, the
 * compiler simply never started.
 *
 * `tests/setup.ts` learned this and `scripts/cli.ts` already knew it; this file
 * did not. One call site taught and the other not is the same reader/writer
 * split this branch has spent itself closing, one level out from the product.
 *
 * Spawning `process.execPath` with `tsx/dist/cli.mjs` sidesteps shims and shell
 * quoting on every platform, so there is no second rule to keep in sync.
 */
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** Compile a throwaway hub and return the build's stdout. */
function buildAndCapture(config: Record<string, unknown>): { out: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l49-"));
  const cfgPath = path.join(dir, "agentboot.config.json");
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  const args = [TSX_CLI, path.join(ROOT, "scripts", "compile.ts"), "--config", cfgPath];
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    // Say WHY, not just that. `execFileSync` threw an ENOENT whose stdout and
    // stderr were both empty, so the one run that could have named the cause
    // reported a bare spawn error — and a diagnosis that has to be guessed at
    // costs a full CI round trip to disprove.
    const why = r.error
      ? `spawn error: ${r.error.message}`
      : `exit status ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}`;
    throw new Error(
      `buildAndCapture: compile failed — ${why}\n` +
        `  command: ${process.execPath} ${args.join(" ")}\n` +
        `${r.stdout ?? ""}${r.stderr ?? ""}`,
    );
  }
  return { out: r.stdout, dir };
}

const BASE_TRAITS = ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"];

describe("L49 — the harness itself runs on every platform we claim to support", () => {
  // This suite asserts things about an MDM control surface, so a harness that
  // cannot start the compiler on a supported platform does not report "MDM path
  // unverified on Windows" — it reports five red tests that look like product
  // defects. Pin the runner, so the shim cannot come back and cost another leg.
  it("spawns tsx's own entry point, never the .bin shim", () => {
    expect(fs.existsSync(TSX_CLI), `${TSX_CLI} must exist — tsx moved its entry`).toBe(true);
    expect(path.basename(TSX_CLI), "must be tsx's real CLI, not a platform shim").toBe("cli.mjs");
    // `.bin/tsx` is executable on macOS and linux, so nothing below this line
    // can catch its reintroduction by running — only by reading.
    expect(TSX_CLI.split(path.sep)).not.toContain(".bin");

    const src = fs.readFileSync(__filename, "utf-8");
    // Vacuity guard: a rename or a read failure must not silently satisfy the
    // scan below by handing it an empty string.
    expect(src, "could not read this test file back").toContain("function buildAndCapture");
    expect(src).toContain("spawnSync(process.execPath");

    const shimRefs = src
      .split("\n")
      .map((line, n) => ({ line: line.trim(), n: n + 1 }))
      // Comments explain WHY the shim is banned, and the assertions below name
      // it to ban it. Both are the record OF the fix, not a use of the shim.
      .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//"))
      .filter(({ line }) => !line.startsWith("expect("))
      // Two shapes: a joined segment (`path.join(…, ".bin", "tsx")`) and an
      // embedded one (`"node_modules/.bin/tsx"`). Missing either lets the shim
      // back in through the door the check was not watching.
      .filter(({ line }) => /["'`]\.bin["'`]/.test(line) || /[\\/]\.bin[\\/]/.test(line))
      .map(({ line, n }) => `${path.basename(__filename)}:${n}: ${line}`);
    expect(shimRefs, "spawn tsx/dist/cli.mjs under process.execPath instead").toEqual([]);
  });
});

function managedHub(platform: string): Record<string, unknown> {
  return {
    org: "test",
    personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
    traits: { enabled: BASE_TRAITS },
    instructions: { enabled: [] },
    managed: { enabled: true, platform, guardrails: { disableBypassPermissions: true } },
  };
}

describe("L49 — the MDM managed-settings path is canonical and correct", () => {
  it("pins the exact directory Claude Code reads, per platform", () => {
    // Pinned as literals on purpose. If Claude Code ever moves these, this test
    // must fail loudly and be re-derived FROM THE BINARY — not quietly updated
    // to match whatever the code happens to say.
    expect(MANAGED_SETTINGS_ROOTS.macos).toBe("/Library/Application Support/ClaudeCode/");
    expect(MANAGED_SETTINGS_ROOTS.windows).toBe("C:\\Program Files\\ClaudeCode\\");
    expect(MANAGED_SETTINGS_ROOTS.linux).toBe("/etc/claude-code/");
  });

  it("never emits the Claude Desktop directory, which enforces nothing", () => {
    // The specific regression: ".../Claude/" instead of ".../ClaudeCode/".
    for (const root of Object.values(MANAGED_SETTINGS_ROOTS)) {
      expect(root, `${root} is the Claude Desktop dir, not Claude Code's`)
        .not.toMatch(/Application Support\/Claude\//);
      expect(root, `${root} points at ProgramData, which Claude Code does not read`)
        .not.toMatch(/ProgramData/);
    }
  });

  // Literals, NOT references to MANAGED_SETTINGS_ROOTS. Deriving the expected
  // value from the constant under test makes the assertion move with the bug:
  // a wrong constant would still "match its own output" and pass green.
  it.each([
    ["jamf", "/Library/Application Support/ClaudeCode/"],
    ["kandji", "/Library/Application Support/ClaudeCode/"],
    ["intune", "C:\\Program Files\\ClaudeCode\\"],
    ["jumpcloud", "/etc/claude-code/"],
  ])("the build tells a %s admin the real path", (platform, expected) => {
    // End-to-end: assert on what the operator is actually TOLD, not just on the
    // constant. The defect lived in the string handed to a human.
    const { out, dir } = buildAndCapture(managedHub(platform));
    try {
      expect(out).toContain(`Target MDM path: ${expected}`);
      expect(fs.existsSync(path.join(dir, "dist", "managed", "managed-settings.json"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Claude Code's built-in tool names. A matcher naming something outside this
 * set is a hook bound to a tool that does not exist — which fails open exactly
 * like the alternation bug would have.
 */
const KNOWN_CC_TOOLS = new Set([
  "Task", "Bash", "BashOutput", "KillShell", "Glob", "Grep", "Read", "Edit",
  "Write", "NotebookEdit", "WebFetch", "WebSearch", "TodoWrite", "SlashCommand",
]);

describe("L49 — every emitted hook matcher is a legal Claude Code matcher", () => {
  it("the bindings table is non-empty and reachable", () => {
    // Guards the vacuous pass: an empty import would make every it.each below
    // silently assert nothing at all.
    expect(COMPLIANCE_HOOK_BINDINGS.length).toBeGreaterThan(0);
    expect(COMPLIANCE_HOOK_BINDINGS.some((b) => b.matcher !== "")).toBe(true);
    // An ALTERNATION must still be emitted. The contradiction this row settled
    // has a second, worse resolution available to a future editor: "fix" it by
    // narrowing `Edit|Write|Bash` to `Edit`. That silently drops Write and Bash
    // from telemetry coverage and makes every assertion below pass. Pin the
    // shape, so the only way to satisfy the suite is the correct reading.
    expect(
      COMPLIANCE_HOOK_BINDINGS.some((b) => b.matcher.includes("|")),
      "an alternation matcher must remain — see ComplianceHookBinding.matcher",
    ).toBe(true);
  });

  it("no comment in compile.ts still claims matchers are exact-match", () => {
    // The 2026-08-11 fix corrected the FIELD docstring and left the canonical
    // header comment 25 lines above it — the one the platform emitters are
    // pointed at — still asserting "matcher is EXACT-match (no substring)".
    // Two contradictory statements of the same platform fact in one file is
    // how the original defect survived review, so the file may hold exactly
    // one statement of it: the field docstring. Everything else refers.
    const src = fs.readFileSync(path.join(ROOT, "scripts", "compile.ts"), "utf-8");
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /exact.?match/i.test(line))
      // The field docstring names the retired claim to explain the correction.
      // That is the record OF the fix, not a restatement of the wrong fact.
      .filter(({ line }) => !/used to say/.test(line))
      .map(({ line, n }) => `compile.ts:${n}: ${line}`);
    expect(offenders).toEqual([]);
  });

  it("every matcher compiles as a regex and names only real tools", () => {
    for (const b of COMPLIANCE_HOOK_BINDINGS) {
      const label = `${b.script} @ ${b.ccEvent}`;
      expect(typeof b.matcher, label).toBe("string");
      if (b.matcher === "") continue; // "" = all tools, always legal

      // Claude Code does `new RegExp(matcher)` and logs
      // "Invalid regex pattern in hook matcher" on throw — an uncompilable
      // matcher is a dead hook.
      expect(() => new RegExp(b.matcher), `${label}: matcher must compile`).not.toThrow();
      const re = new RegExp(b.matcher);

      for (const branch of b.matcher.split("|")) {
        expect(branch, `${label}: empty alternation branch`).not.toBe("");
        expect(
          KNOWN_CC_TOOLS.has(branch),
          `${label}: "${branch}" is not a Claude Code tool name`,
        ).toBe(true);
        // The point of the row: the matcher must actually MATCH the tool it
        // names. This is the assertion that would have caught an exact-match
        // platform silently dropping `Edit|Write|Bash`.
        expect(re.test(branch), `${label}: matcher does not match "${branch}"`).toBe(true);
      }
    }
  });

  it("the emitted settings.json carries the same legal matchers", () => {
    // The table is the source, but the artifact is what ships. Assert both, so
    // a transform between them cannot corrupt a matcher unnoticed.
    const { dir } = buildAndCapture({
      org: "test",
      personas: { enabled: ["code-reviewer"], outputFormats: ["claude"] },
      traits: { enabled: BASE_TRAITS },
      instructions: { enabled: [] },
      managed: { enabled: true, guardrails: { requireAuditLog: true } },
    });
    try {
      const settingsPath = path.join(dir, "dist", "claude", "core", "settings.json");
      expect(fs.existsSync(settingsPath), "clean build should emit settings.json").toBe(true);
      const hooks = JSON.parse(fs.readFileSync(settingsPath, "utf-8")).hooks as
        | Record<string, Array<{ matcher?: unknown }>>
        | undefined;
      expect(hooks, "settings.json should carry hooks").toBeDefined();

      let checked = 0;
      for (const [event, entries] of Object.entries(hooks!)) {
        for (const entry of entries) {
          if (typeof entry.matcher !== "string" || entry.matcher === "") continue;
          checked++;
          expect(() => new RegExp(entry.matcher as string), `${event}: must compile`).not.toThrow();
          const re = new RegExp(entry.matcher as string);
          for (const branch of (entry.matcher as string).split("|")) {
            expect(KNOWN_CC_TOOLS.has(branch), `${event}: unknown tool "${branch}"`).toBe(true);
            expect(re.test(branch), `${event}: does not match "${branch}"`).toBe(true);
          }
        }
      }
      // Without this the loop above passes vacuously on an artifact that
      // emitted no non-empty matcher at all.
      expect(checked, "expected at least one non-empty matcher in settings.json")
        .toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
