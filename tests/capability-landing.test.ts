/**
 * B3 — the missing class: does each CAPABILITY_SUPPORT row's artifact actually LAND?
 *
 * `CAPABILITY_SUPPORT` is a table of claims: "if you configure X, platforms
 * [P…] emit it." Everything built on it — the build gate, doctor's Coverage
 * block, the shortfall report — is only as true as those claims. And the claims
 * were checked by reading the emitters, not by running them: the `plugin` row
 * shipped WRONG three separate times, and the artifact-landing assertions added
 * in the previous round cover exactly the rows that were fixed in that round.
 *
 * This is the general harness. One hub per ROW, configured with that row alone,
 * built with exactly that row's claimed platforms, and the emitted tree grepped
 * for a marker that can only have come from the configured value. A row that
 * claims a platform which does not emit it goes red here — which is the failure
 * that let the plugin row ship wrong, three times, behind a green suite.
 *
 * WHY ONE ROW PER HUB. The first attempt at this configured everything at once
 * and produced two false findings in five minutes: `mcp.enforceApproved`
 * correctly filtered out the `claude.mcpServers` fixture (so that row looked
 * unemitted), and an invalid `ab.modelOverrides` value was correctly rejected
 * (so that row looked unemitted too). Isolation is not tidiness here; it is what
 * makes the result mean anything.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CAPABILITY_SUPPORT, effectiveEmitters } from "../scripts/lib/conformance.js";
import { PLATFORM_REQUIRES } from "../scripts/lib/config.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-b3-"));
});
afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

interface RowFixture {
  /** Config fragment that makes this row's `detect()` fire — and nothing else's. */
  config: Record<string, unknown>;
  /**
   * Evidence the capability reached a platform tree: a string that can only be
   * present because the value above was configured, or a file that only exists
   * when it was.
   */
  marker: { kind: "content"; text: string } | { kind: "file"; suffix: string };
  /** Extra hub files the fixture needs (relative path → contents). */
  files?: Record<string, string>;
  /** Set when the row is expected to land NOWHERE, with the reason. */
  landsNowhere?: string;
}

/**
 * One fixture per row. The table below is a SECOND list, so the first test
 * asserts it covers CAPABILITY_SUPPORT exactly — a row added without a fixture
 * is a row whose claim nobody checked, which is the whole defect.
 */
const FIXTURES: Record<string, RowFixture> = {
  "claude.hooks": {
    config: {
      claude: {
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/zzhookzz.sh" }] }] },
      },
    },
    marker: { kind: "content", text: "/zzhookzz.sh" },
  },
  "claude.permissions.deny": {
    config: { claude: { permissions: { deny: ["Bash(zzdenyzz:*)"] } } },
    marker: { kind: "content", text: "zzdenyzz" },
  },
  "claude.permissions.allow": {
    config: { claude: { permissions: { allow: ["Read(zzallowzz)"] } } },
    marker: { kind: "content", text: "zzallowzz" },
  },
  "claude.mcpServers": {
    config: { claude: { mcpServers: { zzmcpzz: { command: "/bin/true" } } } },
    marker: { kind: "content", text: "zzmcpzz" },
  },
  "claude.settings": {
    config: { claude: { settings: { zzsettingzz: "1" } } },
    marker: { kind: "content", text: "zzsettingzz" },
  },
  "mcp.enforceApproved": {
    config: { mcp: { enforceApproved: true, approved: [{ name: "zzapprovedzz", command: "/bin/true" }] } },
    marker: { kind: "content", text: "zzapprovedzz" },
  },
  "ab.modelOverrides": {
    // The keys are /ab AGENT file names and the value must be a valid alias;
    // an invalid one is rejected with a warning, which is correct and is what
    // made the naive fixture look like a defect.
    config: { ab: { modelOverrides: { "ab-query": "opus" } } },
    marker: { kind: "content", text: "model: opus" },
  },
  "managed.guardrails.disableBypassPermissions": {
    config: { managed: { enabled: true, guardrails: { disableBypassPermissions: true } } },
    // The emitted key is `disableBypassPermissionsMode`, not the config key —
    // a case-insensitive guess at the marker made this row look broken on the
    // first run. The marker has to be what the EMITTER writes.
    marker: { kind: "content", text: "disableBypassPermissionsMode" },
  },
  "compliance.inputScan.scannerCommand": {
    config: { compliance: { inputScan: { enabled: true, scannerCommand: "/zzscannerzz" } } },
    marker: { kind: "content", text: "zzscannerzz" },
  },
  "compliance.outputScan.blocking": {
    config: { compliance: { outputScan: { enabled: true, blocking: true } } },
    marker: { kind: "file", suffix: "agentboot-output-scan.sh" },
  },
  "managed.guardrails.denyTools": {
    config: { managed: { enabled: true, guardrails: { denyTools: ["ZZDENYTOOLZZ"] } } },
    marker: { kind: "content", text: "ZZDENYTOOLZZ" },
  },
  "managed.guardrails.requireAuditLog": {
    config: { managed: { enabled: true, guardrails: { requireAuditLog: true } } },
    marker: { kind: "file", suffix: "agentboot-telemetry.sh" },
  },
  "managed.guardrails.forcePlugins": {
    config: { managed: { enabled: true, guardrails: { forcePlugins: ["zzpluginzz"] } } },
    marker: { kind: "content", text: "zzpluginzz" },
    landsNowhere:
      "emittedBy is EMPTY by declaration — the key is typed, documented, accepted, and read " +
      "by no code path. This case asserts the row's own claim, which is that nothing emits it.",
  },
  "instructions[].applyTo": {
    config: { instructions: { enabled: ["zznarrowzz.instructions"] } },
    files: {
      "core/instructions/zznarrowzz.instructions.md":
        '---\ndescription: narrow\napplyTo: "src/zzscopezz/**"\nscope-unsupported: acknowledged\n---\n# n\nbody\n',
    },
    marker: { kind: "content", text: "src/zzscopezz/**" },
  },
  "gotchas[].paths": {
    config: { gotchas: { enabled: ["zzgotchazz"] } },
    files: {
      "core/gotchas/zzgotchazz.md":
        '---\ndescription: g\npaths: "src/zzpathzz/**"\n---\n# g\nbody\n',
    },
    marker: { kind: "content", text: "src/zzpathzz/**" },
  },
};

function scaffold(name: string): string {
  const hub = path.join(base, name);
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
  return hub;
}

/** Does `marker` appear anywhere under `dir`? */
function markerPresent(dir: string, marker: RowFixture["marker"]): boolean {
  if (!fs.existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (marker.kind === "file") {
        if (e.name === marker.suffix) return true;
        continue;
      }
      try {
        if (fs.readFileSync(p, "utf-8").includes(marker.text)) return true;
      } catch { /* unreadable → not evidence */ }
    }
  }
  return false;
}

describe("B3 — every CAPABILITY_SUPPORT row's artifact lands on every platform it claims", () => {
  it("B3-0: the fixture table covers CAPABILITY_SUPPORT exactly", () => {
    // Two lists that must agree. A row added without a fixture is a row whose
    // claim nobody checked; a fixture for a row that no longer exists is dead
    // weight that makes the coverage number a lie.
    const rows = CAPABILITY_SUPPORT.map((r) => r.id).sort();
    expect(Object.keys(FIXTURES).sort()).toEqual(rows);
    expect(rows.length).toBeGreaterThan(10);
  });

  for (const row of CAPABILITY_SUPPORT) {
    const fx = FIXTURES[row.id];
    if (!fx) continue; // B3-0 is the failure for this; do not double-report.

    it(`B3 [${row.id}]: lands on ${row.emittedBy.join(", ") || "(nothing, by declaration)"}`, () => {
      // Build with exactly this row's claimed platforms, plus whatever they
      // REQUIRE — `plugin` is assembled from dist/claude, so a plugin-only build
      // is refused by the build gate and would prove nothing about the row.
      const needed = new Set<string>(row.emittedBy);
      for (const p of row.emittedBy) {
        for (const req of PLATFORM_REQUIRES[p] ?? []) needed.add(req);
      }
      // `landsNowhere` rows have no platforms of their own; give them a target
      // so the build produces something to search.
      const formats = needed.size > 0 ? [...needed] : ["claude"];

      const hub = scaffold(row.id.replace(/[^a-z0-9]+/gi, "-"));
      for (const [rel, body] of Object.entries(fx.files ?? {})) {
        const abs = path.join(hub, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
      }
      const cfgPath = path.join(hub, "agentboot.config.json");
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      cfg.personas = { ...(cfg.personas ?? {}), outputFormats: formats };
      Object.assign(cfg, fx.config);
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

      const b = spawnSync(process.execPath, [CLI, "build"], {
        cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
      });
      const out = `${b.stdout ?? ""}${b.stderr ?? ""}`;
      const dist = path.join(hub, "dist");

      if (fx.landsNowhere) {
        // The row's own claim, asserted rather than assumed: emittedBy is empty,
        // so the capability gate REFUSES the build and names the key. If this
        // ever starts landing, the row is wrong and its gate is pure noise.
        expect(effectiveEmitters(row, formats), fx.landsNowhere).toEqual([]);
        expect(b.status, `the capability gate did not refuse: ${out}`).toBe(1);
        expect(out).toContain(row.id);
        expect(markerPresent(dist, fx.marker), fx.landsNowhere).toBe(false);
        return;
      }

      expect(b.status, `build failed: ${out}`).toBe(0);

      const missing = effectiveEmitters(row, formats)
        .filter((platform) => !markerPresent(path.join(dist, platform), fx.marker));
      expect(
        missing,
        `${row.id} claims these platforms emit it, and no artifact under dist/<platform>/ ` +
          `carries the configured value: ${missing.join(", ")}. Either the emitter is missing ` +
          `or the CAPABILITY_SUPPORT row overstates its reach — the plugin row shipped wrong ` +
          `three times through exactly this gap.`
      ).toEqual([]);
    }, 300_000);
  }
});
