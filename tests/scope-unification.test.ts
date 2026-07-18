/**
 * UI-7/UI-8/UI-9: scope-layout unification + hub /ab skill install.
 *
 * UI-7: validate and compile honored DIFFERENT team-scope source layouts —
 *   validate walked groups/<g>/teams/<t>/ (nested) while compile discovered
 *   teams/<g>/<t>/ (sibling). The same hub content was guarded by one command
 *   and invisible to the other. Both commands now honor both layouts (plus
 *   canonical nodes/<path>/) via one resolver.
 * UI-8: compile writes scope output to dist/{platform}/nodes/<g>/<t>/ but sync
 *   only read dist/{platform}/groups|teams/ — team content built clean and
 *   never reached a spoke's .claude/. Sync now reads the nodes layout, and
 *   compile loudly warns about scope-level CONTENT files it does not compile.
 * UI-9: install wrote /ab subagent definitions to the hub's .claude/agents/
 *   but never installed the compiled /ab SKILL — the quickstart failed in the
 *   hub itself. installHubSkills() copies compiled skills into .claude/skills/.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { installHubSkills } from "../scripts/lib/install.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 60_000,
  }).toString();
}

const TEAM_CONFIG = {
  org: "acme",
  personas: { enabled: ["team-helper"], outputFormats: ["claude", "skill"] },
  traits: { enabled: [] },
  groups: { platform: { teams: ["api"] } },
  validation: { secretPatterns: [] },
};

function writeTeamPersona(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "persona.config.json"), JSON.stringify({
    name: "Team Helper", description: "team-scoped helper", invocation: "/team-helper", traits: {},
  }));
  fs.writeFileSync(path.join(dir, "SKILL.md"),
    "---\nname: team-helper\ndescription: team helper\n---\n# Team Helper\nteam-scope content marker XYZZY\n");
}

function mkTeamHub(layout: "nested" | "sibling" | "nodes"): string {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scope-"));
  fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
  fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify(TEAM_CONFIG));
  const personaDir =
    layout === "nested" ? path.join(hub, "groups", "platform", "teams", "api", "personas", "team-helper")
    : layout === "sibling" ? path.join(hub, "teams", "platform", "api", "personas", "team-helper")
    : path.join(hub, "nodes", "platform", "api", "personas", "team-helper");
  writeTeamPersona(personaDir);
  return hub;
}

describe("UI-7: one scope-source layout contract for validate AND compile", () => {
  for (const layout of ["nested", "sibling", "nodes"] as const) {
    it(`compile discovers a team persona in the ${layout} layout`, () => {
      const hub = mkTeamHub(layout);
      try {
        const out = run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
        expect(out).toContain("platform/api/team-helper");
        expect(out).not.toContain("(no node-level overrides found)");
        expect(fs.existsSync(path.join(hub, "dist", "claude", "nodes", "platform", "api", "skills", "team-helper", "SKILL.md"))).toBe(true);
      } finally {
        fs.rmSync(hub, { recursive: true, force: true });
      }
    });
  }

  it("validate catches a HARD override in the SIBLING teams layout (the mirror gap)", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scope-hard-"));
    try {
      fs.mkdirSync(path.join(hub, "core", "traits"), { recursive: true });
      fs.writeFileSync(path.join(hub, "core", "traits", "security-check.md"),
        "---\nguardrail: hard\n---\n# Security Check\nAlways verify.\n");
      const rogue = path.join(hub, "teams", "platform", "api", "personas", "rogue");
      fs.mkdirSync(rogue, { recursive: true });
      fs.writeFileSync(path.join(rogue, "persona.config.json"),
        JSON.stringify({ name: "Rogue", traits: { "security-check": "OFF" } }));
      fs.writeFileSync(path.join(hub, "agentboot.config.json"), JSON.stringify({
        org: "acme", personas: { enabled: [] }, traits: { enabled: ["security-check"] },
        validation: { secretPatterns: [] },
      }));
      let output = "";
      try {
        output = run(`scripts/validate.ts --config ${path.join(hub, "agentboot.config.json")}`);
      } catch (err: any) {
        output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      }
      expect(output).toContain("HARD");
      expect(output).toContain("security-check");
      expect(output).toContain("team/platform/api");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

describe("UI-8: team scope reaches the claude surface end-to-end", () => {
  it("sync delivers node-scope personas to the spoke's .claude/", () => {
    const hub = mkTeamHub("nested");
    const spoke = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scope-spoke-"));
    try {
      fs.writeFileSync(path.join(hub, "repos.json"), JSON.stringify([
        { path: spoke, platform: "claude", group: "platform", team: "api" },
      ]));
      run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      run(`scripts/sync.ts --config ${path.join(hub, "agentboot.config.json")} --adopt-existing`);
      const delivered = path.join(spoke, ".claude", "skills", "team-helper", "SKILL.md");
      expect(fs.existsSync(delivered)).toBe(true);
      expect(fs.readFileSync(delivered, "utf-8")).toContain("XYZZY");
      expect(fs.existsSync(path.join(spoke, ".claude", "agents", "team-helper.md"))).toBe(true);
      // Composition inputs must NOT ship to spokes from the node scope
      expect(fs.existsSync(path.join(spoke, ".claude", "managed-settings.d"))).toBe(false);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
      fs.rmSync(spoke, { recursive: true, force: true });
    }
  });

  it("compile warns LOUDLY about scope-level content files it does not compile", () => {
    const hub = mkTeamHub("sibling");
    try {
      const traitsDir = path.join(hub, "teams", "platform", "api", "traits");
      fs.mkdirSync(traitsDir, { recursive: true });
      fs.writeFileSync(path.join(traitsDir, "security-check.md"), "# team trait override\n");
      const out = run(`scripts/compile.ts --config ${path.join(hub, "agentboot.config.json")}`);
      expect(out).toContain("produce NO output");
      expect(out).toContain("traits");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});

describe("UI-9: compiled skills installed into the hub's own .claude/skills/", () => {
  it("installHubSkills copies dist skills so /ab resolves in the hub", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scope-skills-"));
    try {
      const src = path.join(hub, "dist", "claude", "core", "skills", "ab");
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, "SKILL.md"), "---\nname: ab\n---\nskill body");
      const count = installHubSkills(hub);
      expect(count).toBe(1);
      expect(fs.readFileSync(path.join(hub, ".claude", "skills", "ab", "SKILL.md"), "utf-8")).toContain("skill body");
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });

  it("returns 0 quietly when no compiled skills exist", () => {
    const hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scope-noskills-"));
    try {
      expect(installHubSkills(hub)).toBe(0);
    } finally {
      fs.rmSync(hub, { recursive: true, force: true });
    }
  });
});
