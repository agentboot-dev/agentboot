/**
 * v0.16.0 hardening — regression tests for the adversarial-audit findings.
 *
 * Sibling-scope isolation: a spoke registered to one team must never receive
 *   a sibling team's node content, and the sync manifest must not certify it.
 *   (The old group-level walk excluded only the registered team's subtree, so
 *   every OTHER team's subtree leaked into every spoke.)
 * Stop-hook payload truth: the generated output-scan hook must read the field
 *   the platform actually sends (`last_assistant_message`), not a field that
 *   has never existed (`response`) — with a transcript-file fallback.
 * Telemetry schema unity: the published JSON Schema must be generated from
 *   the canonical event spec and accept every event shape the hooks emit —
 *   including `session_summary`, which the old hand-written schema rejected.
 * Secret-scan surface: the validate secret scan must cover the full compiler
 *   input surface (gotchas, instructions, scope layouts), not just two dirs.
 */

import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  TELEMETRY_EVENTS,
  PROHIBITED_TELEMETRY_FIELDS,
  buildTelemetryJsonSchema,
  sampleEvents,
} from "../scripts/lib/telemetry-schema.js";
import { childScopeNames, hubContentRoots } from "../scripts/lib/scope-layout.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 120_000,
  }).toString();
}

function mkTwoTeamHub(): string {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-twoteam-"));
  fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
  fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
    org: "acme",
    personas: { enabled: ["api-helper", "web-helper"], outputFormats: ["claude", "skill"] },
    traits: { enabled: [] },
    groups: { platform: { teams: ["api", "web"] } },
    validation: { secretPatterns: [] },
  }));
  const writePersona = (team: string, name: string, marker: string) => {
    const dir = path.join(hub, "nodes", "platform", team, "personas", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "persona.config.json"), JSON.stringify({
      name, description: `${team} helper`, invocation: `/${name}`, traits: {},
    }));
    fs.writeFileSync(path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${team} helper\n---\n# ${name}\n${marker}\n`);
  };
  writePersona("api", "api-helper", "API-TEAM-MARKER-ALPHA");
  writePersona("web", "web-helper", "WEB-TEAM-MARKER-OMEGA");
  return hub;
}

describe("sibling-scope isolation (two-team repro)", () => {
  it("a spoke registered to team api receives NO web-team content and the manifest certifies none", () => {
    const hub = mkTwoTeamHub();
    const spoke = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-twoteam-spoke-"));
    try {
      fs.writeFileSync(path.join(hub, "repos.json"), JSON.stringify([
        { path: spoke, platform: "claude", group: "platform", team: "api" },
      ]));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      run(`scripts/sync.ts --config ${path.join(hub, "agentboot.config.json")} --adopt-existing`);

      // Own team's content arrived.
      const own = path.join(spoke, ".claude", "skills", "api-helper", "SKILL.md");
      expect(fs.existsSync(own)).toBe(true);
      expect(fs.readFileSync(own, "utf-8")).toContain("API-TEAM-MARKER-ALPHA");

      // Sibling team's content did NOT arrive — anywhere in the spoke.
      const leaked: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir)) {
          const abs = path.join(dir, e);
          if (fs.statSync(abs).isDirectory()) walk(abs);
          else if (fs.readFileSync(abs, "utf-8").includes("WEB-TEAM-MARKER-OMEGA") ||
                   e.includes("web-helper")) leaked.push(abs);
        }
      };
      walk(spoke);
      expect(leaked).toEqual([]);

      // The signed/digested manifest must not certify sibling content either.
      const manifestPath = path.join(spoke, ".claude", ".agentboot-manifest.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = fs.readFileSync(manifestPath, "utf-8");
        expect(manifest).not.toContain("web-helper");
      }
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
    }
  });

  it("childScopeNames enumerates every child of a scope (the authority sync filters by)", () => {
    const config = { org: "acme", groups: { platform: { teams: ["api", "web"] } } } as any;
    expect(childScopeNames(config, "platform").sort()).toEqual(["api", "web"]);
    expect(childScopeNames(config, "")).toEqual(["platform"]);
    expect(childScopeNames(config, "nonexistent")).toEqual([]);
  });
});

describe("Stop-hook output scan reads the real payload", () => {
  function generatedStopHook(): string {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-stophook-"));
    try {
      fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme",
        personas: { enabled: [], outputFormats: ["claude"] },
        traits: { enabled: [] },
        compliance: { outputScan: { enabled: true, blocking: true } },
        validation: { secretPatterns: [] },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const hookPath = path.join(hub, "dist", "claude", "core", "hooks", "agentboot-output-scan.sh");
      expect(fs.existsSync(hookPath)).toBe(true);
      return fs.readFileSync(hookPath, "utf-8");
    } finally {
      // keep file content; hub dir no longer needed
    }
  }

  function runHookScript(script: string, payload: object): { status: number; stdout: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-hookrun-"));
    const file = path.join(dir, "hook.sh");
    fs.writeFileSync(file, script, { mode: 0o755 });
    const res = spawnSync("bash", [file], {
      input: JSON.stringify(payload), encoding: "utf-8", timeout: 20_000,
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: res.status ?? -1, stdout: res.stdout ?? "" };
  }

  const AWS_CANARY = "AKIA" + "IOSFODNN7EXAMPLE";

  it("clean last_assistant_message passes", () => {
    const script = generatedStopHook();
    const r = runHookScript(script, { hook_event_name: "Stop", last_assistant_message: "refactored the parser cleanly" });
    expect(r.status).toBe(0);
  });

  it("secret in last_assistant_message blocks (exit 2 + decision:block)", () => {
    const script = generatedStopHook();
    const r = runHookScript(script, { hook_event_name: "Stop", last_assistant_message: `creds: ${AWS_CANARY}` });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('"decision":"block"');
  });

  it("falls back to the transcript file when last_assistant_message is absent", () => {
    const script = generatedStopHook();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-transcript-"));
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `here: ${AWS_CANARY}` }] } }),
    ].join("\n") + "\n");
    const r = runHookScript(script, { hook_event_name: "Stop", transcript_path: transcript });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('"decision":"block"');
  });

  it("the generated hook never references the phantom `response` field", () => {
    const script = generatedStopHook();
    expect(script).not.toMatch(/j\.response/);
    expect(script).toContain("last_assistant_message");
  });
});

describe("telemetry schema is generated from the canonical event spec", () => {
  const schema = buildTelemetryJsonSchema();

  it("accepts every sample event the hooks emit (including session_summary)", () => {
    const branches: any[] = schema.oneOf;
    for (const [name, ev] of Object.entries(sampleEvents("hashed"))) {
      const branch = branches.find((b) => b.properties.event.const === name);
      expect(branch, `schema branch for ${name}`).toBeTruthy();
      // required fields all present on the sample
      for (const req of branch.required) {
        expect(Object.keys(ev), `${name} missing required ${req}`).toContain(req);
      }
      // sample has no fields outside the branch's properties (additionalProperties: false)
      for (const key of Object.keys(ev)) {
        expect(Object.keys(branch.properties), `${name} field ${key} undeclared`).toContain(key);
      }
    }
  });

  it("declares exactly the canonical event set and bans content-carrying fields", () => {
    const branches: any[] = schema.oneOf;
    expect(branches.map((b) => b.properties.event.const).sort())
      .toEqual(Object.keys(TELEMETRY_EVENTS).sort());
    for (const b of branches) {
      expect(b.additionalProperties).toBe(false);
      for (const banned of PROHIBITED_TELEMETRY_FIELDS) {
        expect(Object.keys(b.properties)).not.toContain(banned);
      }
    }
  });

  it("compile writes the generated schema (not a hand-written one) to dist", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-telemetry-"));
    try {
      fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme", personas: { enabled: [], outputFormats: ["claude"] },
        traits: { enabled: [] }, validation: { secretPatterns: [] },
      }));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      const written = JSON.parse(fs.readFileSync(
        path.join(hub, "dist", "schema", "telemetry-event.v1.json"), "utf-8"));
      expect(written).toEqual(JSON.parse(JSON.stringify(schema)));
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

describe("secret scan covers the full compiler input surface", () => {
  const AWS_CANARY = "AKIA" + "IOSFODNN7EXAMPLE";

  function mkHubWithSecretAt(relPath: string): string {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-secretscan-"));
    fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
    fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
      org: "acme", personas: { enabled: [] }, traits: { enabled: [] },
      groups: { platform: { teams: ["api"] } },
    }));
    const abs = path.join(hub, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `# doc\naws_access_key_id = ${AWS_CANARY}\n`);
    return hub;
  }

  for (const rel of [
    "core/gotchas/deploy.md",
    "core/instructions/setup.md",
    "nodes/platform/api/personas/helper/SKILL.md",
    "teams/platform/api/notes.md",
  ]) {
    it(`catches a bare AWS key in ${rel}`, () => {
      const hub = mkHubWithSecretAt(rel);
      try {
        const res = spawnSync(TSX, ["scripts/validate.ts", "--config", path.join(hub, "agentboot.config.json")], {
          cwd: ROOT, encoding: "utf-8", timeout: 120_000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        const out = (res.stdout ?? "") + (res.stderr ?? "");
        expect(res.status, `validate must fail for secret in ${rel}`).not.toBe(0);
        expect(out).toContain("Potential secret");
      } finally {
        fs.rmSync(hub, { recursive: true, force: true });
      }
    });
  }

  it("hubContentRoots enumerates core + scope layouts", () => {
    const hub = mkHubWithSecretAt("core/gotchas/x.md");
    try {
      fs.mkdirSync(path.join(hub, "nodes"), { recursive: true });
      fs.mkdirSync(path.join(hub, "groups"), { recursive: true });
      const roots = hubContentRoots({ org: "acme" } as any, hub).map((r) => path.basename(r)).sort();
      expect(roots).toContain("core");
      expect(roots).toContain("nodes");
      expect(roots).toContain("groups");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});
