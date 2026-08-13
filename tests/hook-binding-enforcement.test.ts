/**
 * Q73 — a missing hook BINDING was invisible to both honesty surfaces.
 *
 * A compiled hook script is inert on its own. `agentboot-pretooluse.sh` only
 * ever runs because a binding artifact names it against an event:
 * `dist/plugin/hooks/hooks.json` for the plugin, `dist/claude/core/settings.json`
 * for Claude Code, `.codex/hooks.json` for Codex, `.github/hooks/agentboot.json`
 * for Copilot. Delete the binding and the enforcement is gone.
 *
 * Measured at d9de530, on a `["claude","plugin"]` hub with `denyTools`
 * configured, after `rm dist/plugin/hooks/hooks.json`:
 *
 *     agentboot doctor       → "✓ plugin: org policy is enforceable — … via
 *                               the plugin's hooks.json"      exit 0
 *     agentboot conformance  → 4 × "✓ pass" for plugin, under
 *                              "✓ All 8 probed control(s) behave as declared"
 *                                                             exit 0
 *
 * Both surfaces reported a governance control was in force while the file that
 * would enforce it was absent — and doctor named that exact file in the
 * sentence asserting it. The conformance harness executed the scripts directly,
 * so the probes were true and the conclusion was false: it never asked whether
 * anything would call them.
 *
 * BOTH directions are pinned in every case below. A gate that turns an intact
 * build red is an outage, not a gate — and this branch has already shipped a
 * tamper test that passed without tampering, so the positive case is not
 * decoration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hookBindingForPlatform,
  readHookBinding,
  isScriptBound,
  runConformance,
  type ControlResult,
} from "../scripts/lib/conformance.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Run the real CLI. Status is read WITHOUT a pipe — a piped $? is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

interface Check { status: string; message: string }
const doctorChecks = (hub: string): Check[] =>
  (JSON.parse(ab(["doctor", "--format", "json"], hub).out) as { checks: Check[] }).checks;

let base: string;
let hub: string;
let distPath: string;

/** Absolute path of a platform's binding, plus its pristine bytes. */
function binding(platform: string): { file: string; bytes: string } {
  const file = hookBindingForPlatform(distPath, platform)!;
  return { file, bytes: fs.readFileSync(file, "utf-8") };
}

/** Delete a binding, run `body`, put it back whatever happens. */
function withBindingRemoved<T>(platform: string, body: () => T): T {
  const { file, bytes } = binding(platform);
  fs.rmSync(file);
  try {
    return body();
  } finally {
    fs.writeFileSync(file, bytes, "utf-8");
  }
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hook-binding-"));
  hub = path.join(base, "hub");
  const scaffold = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (scaffold.status !== 0) throw new Error(`hub scaffold failed: ${scaffold.stdout}${scaffold.stderr}`);

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
  cfg["personas"] = { ...(cfg["personas"] as object), outputFormats: ["claude", "plugin"] };
  // Hard org policy, so doctor's Enforcement section runs and the deny-tools
  // control is probed rather than not-applicable.
  cfg["managed"] = { enabled: true, guardrails: { denyTools: ["WebFetch"] } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const build = ab(["build"], hub);
  if (build.status !== 0) throw new Error(`build failed: ${build.out}`);
  distPath = path.join(hub, "dist");
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("readHookBinding — the artifact nobody was reading", () => {
  it("resolves a binding path for every hook-bearing platform, and none for advisory ones", () => {
    for (const p of ["claude", "codex", "copilot", "plugin"]) {
      expect(hookBindingForPlatform("/d", p), p).not.toBeNull();
    }
    for (const p of ["cursor", "gemini", "windsurf", "jetbrains", "agents", "skill"]) {
      expect(hookBindingForPlatform("/d", p), p).toBeNull();
    }
  });

  it("reads the real binding and reports the scripts it wires up", () => {
    const b = readHookBinding(distPath, "plugin");
    expect(b.state).toBe("present");
    if (b.state !== "present") throw new Error("unreachable");
    // Every emitted script is bound — an intact build has no orphan.
    for (const script of fs.readdirSync(path.join(distPath, "plugin", "hooks")).filter((f) => f.endsWith(".sh"))) {
      expect(isScriptBound(b, script), script).toBe(true);
    }
    expect(isScriptBound(b, "agentboot-not-a-real-hook.sh")).toBe(false);
  });

  it("distinguishes MISSING from NOT-BUILT — the remedies are different", () => {
    expect(readHookBinding(distPath, "codex").state).toBe("not-built");
    withBindingRemoved("plugin", () => {
      expect(readHookBinding(distPath, "plugin").state).toBe("missing");
    });
    expect(readHookBinding(distPath, "plugin").state).toBe("present");
  });

  it("an unparseable binding is `unreadable`, never silently empty", () => {
    const { file, bytes } = binding("plugin");
    fs.writeFileSync(file, "{ this is not json", "utf-8");
    try {
      expect(readHookBinding(distPath, "plugin").state).toBe("unreadable");
    } finally {
      fs.writeFileSync(file, bytes, "utf-8");
    }
  });
});

describe("conformance — a hook bound to nothing is not a passing control", () => {
  it("POSITIVE: the intact build is still green on every control", () => {
    const r = ab(["conformance"], hub);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/probed control\(s\) behave as declared/);
    expect(r.out).not.toMatch(/hook-binding/);
  }, 300_000);

  it("NEGATIVE: deleting dist/plugin/hooks/hooks.json fails every plugin control and exits 1", () => {
    const r = withBindingRemoved("plugin", () => ab(["conformance"], hub));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/Conformance FAILED on: plugin/);
    expect(r.out).toMatch(/hook-binding/);
    expect(r.out).toMatch(/hooks\.json is ABSENT/);
    // The green claim must be gone, not merely accompanied by a warning.
    expect(r.out).not.toMatch(/behave as declared/);
  }, 300_000);

  it("NEGATIVE: the same deletion on Claude Code's settings.json is caught too", () => {
    // The defect was reported against `plugin`; it is a property of every
    // platform whose scripts are bound by a separate file. Fixing only the
    // reported instance is how the next one ships.
    const r = withBindingRemoved("claude", () => ab(["conformance"], hub));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/Conformance FAILED on: claude/);
    expect(r.out).toMatch(/settings\.json is ABSENT/);
  }, 300_000);

  it("a binding that omits ONE script fails only that control — the rest stay honest", () => {
    const { file, bytes } = binding("plugin");
    // Strip the PreToolUse binding, keep the file valid and the others intact.
    const doc = JSON.parse(bytes) as { hooks?: Record<string, unknown> };
    delete doc.hooks?.["PreToolUse"];
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf-8");
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(hub, "agentboot.config.json"), "utf-8"));
      const run = runConformance(distPath, ["plugin"], cfg, "test");
      const byControl = new Map(
        (run.manifests[0]!.controls as ControlResult[]).map((c) => [c.control, c]),
      );
      expect(byControl.get("deny-tools")!.status).toBe("fail");
      expect(byControl.get("deny-tools")!.reason).toMatch(/no event binds it/);
      expect(byControl.get("input-scan")!.status).toBe("pass");
      expect(byControl.get("output-scan")!.status).toBe("pass");
      expect(run.failedPlatforms).toContain("plugin");
    } finally {
      fs.writeFileSync(file, bytes, "utf-8");
    }
  }, 300_000);
});

describe("doctor — the sentence named the file it never opened", () => {
  it("POSITIVE: the intact build still gets the enforceability claim, and exit 0", () => {
    const claim = doctorChecks(hub).filter((c) => c.message.startsWith("plugin: org policy is enforceable"));
    expect(claim).toHaveLength(1);
    expect(claim[0]!.status).toBe("ok");
    expect(ab(["doctor"], hub).status).toBe(0);
  }, 300_000);

  it("NEGATIVE: with hooks.json deleted doctor makes NO positive claim and exits non-zero", () => {
    withBindingRemoved("plugin", () => {
      const checks = doctorChecks(hub).filter((c) => c.message.startsWith("plugin:"));
      expect(checks).toHaveLength(1);
      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toContain("NOT enforced");
      expect(checks[0]!.message).toContain("hooks.json");
      expect(checks[0]!.message).toContain("MISSING");
      // No surviving ✓ about plugin enforcement anywhere in the report.
      expect(doctorChecks(hub).some(
        (c) => c.status === "ok" && /plugin.*enforceab/i.test(c.message),
      )).toBe(false);
      expect(ab(["doctor"], hub).status).not.toBe(0);
    });
  }, 300_000);

  it("NEGATIVE: same for Claude Code's settings.json", () => {
    withBindingRemoved("claude", () => {
      const checks = doctorChecks(hub).filter((c) => c.message.startsWith("claude: org policy"));
      expect(checks).toHaveLength(1);
      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toContain("settings.json");
    });
  }, 300_000);
});
