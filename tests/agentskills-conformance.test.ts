/**
 * Agent Skills specification conformance for the `skill` platform output.
 *
 * The dist/skill tree is AgentBoot's agentskills.io-compatible surface. The
 * spec (agentskills.io/specification) requires SKILL.md to BEGIN with YAML
 * frontmatter — the provenance header used to be prepended before the `---`,
 * which failed the official skills-ref validator on every persona. These
 * checks are an offline mirror of the validator's core rules; CI additionally
 * runs the official validator itself (validate.yml).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const SKILL_CORE = path.join(ROOT, "dist", "skill", "core");

beforeAll(() => {
  if (!fs.existsSync(SKILL_CORE)) {
    execSync(`${TSX} scripts/compile.ts`, { cwd: ROOT, timeout: 60_000 });
  }
});

function skillDirs(): string[] {
  return fs.readdirSync(SKILL_CORE).filter((d) => {
    const p = path.join(SKILL_CORE, d);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "SKILL.md"));
  });
}

describe("Agent Skills spec conformance (dist/skill)", () => {
  it("every emitted SKILL.md begins with YAML frontmatter (spec + skills-ref requirement)", () => {
    const dirs = skillDirs();
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) {
      const content = fs.readFileSync(path.join(SKILL_CORE, d, "SKILL.md"), "utf-8");
      expect(content.startsWith("---\n"), `${d}/SKILL.md must start with ---`).toBe(true);
    }
  });

  it("provenance survives, placed AFTER the frontmatter", () => {
    for (const d of skillDirs()) {
      const content = fs.readFileSync(path.join(SKILL_CORE, d, "SKILL.md"), "utf-8");
      const fmEnd = content.indexOf("\n---\n", 4) + 5;
      expect(fmEnd).toBeGreaterThan(5);
      expect(content.slice(fmEnd)).toContain("AgentBoot compiled output");
      expect(content.slice(0, fmEnd)).not.toContain("<!--");
    }
  });

  it("name field matches the directory name and follows spec charset/length rules", () => {
    for (const d of skillDirs()) {
      const content = fs.readFileSync(path.join(SKILL_CORE, d, "SKILL.md"), "utf-8");
      const name = /^name:\s*(.+)$/m.exec(content)?.[1]?.trim();
      expect(name, `${d}: name field present`).toBeTruthy();
      expect(name).toBe(d);
      expect(name!.length).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/); // lowercase/digits/hyphens, no leading/trailing/double hyphen
    }
  });

  it("description field is non-empty and within 1024 characters", () => {
    for (const d of skillDirs()) {
      const content = fs.readFileSync(path.join(SKILL_CORE, d, "SKILL.md"), "utf-8");
      const description = /^description:\s*(.+)$/m.exec(content)?.[1]?.trim();
      expect(description, `${d}: description present`).toBeTruthy();
      expect(description!.length).toBeGreaterThan(0);
      expect(description!.length).toBeLessThanOrEqual(1024);
    }
  });

  it("gotcha rules in claude output keep frontmatter first too (path scoping depends on it)", () => {
    const rulesDir = path.join(ROOT, "dist", "claude", "core", "rules");
    if (!fs.existsSync(rulesDir)) return; // no gotchas in this hub
    for (const f of fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"))) {
      const content = fs.readFileSync(path.join(rulesDir, f), "utf-8");
      if (content.includes("paths:")) {
        expect(content.startsWith("---\n"), `rules/${f} must start with frontmatter`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Plugin-spec conformance (dist/plugin) — offline mirror of the load-bearing
// rules; CI additionally runs the official `claude plugin validate`.
// ---------------------------------------------------------------------------

describe("Plugin spec conformance (dist/plugin)", () => {
  const PLUGIN_DIR = path.join(ROOT, "dist", "plugin");

  it("manifest lives at .claude-plugin/plugin.json (root plugin.json is invisible to the plugin system)", () => {
    expect(fs.existsSync(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(PLUGIN_DIR, "plugin.json"))).toBe(false);
    // Component dirs must sit at the plugin root, never inside .claude-plugin/
    for (const d of ["skills", "agents", "hooks"]) {
      expect(fs.existsSync(path.join(PLUGIN_DIR, d)), `${d}/ at plugin root`).toBe(true);
      expect(fs.existsSync(path.join(PLUGIN_DIR, ".claude-plugin", d))).toBe(false);
    }
  });

  it("manifest uses spec types: kebab-case name, author object, hooks reference", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf-8")
    );
    expect(manifest.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(typeof manifest.author).toBe("object"); // a bare string is a LOAD ERROR per spec
    expect(typeof manifest.author.name).toBe("string");
    expect(manifest.hooks).toBe("./hooks/hooks.json");
  });

  it("hooks are REGISTERED, not just copied: hooks.json wires every binding via CLAUDE_PLUGIN_ROOT", () => {
    const hooksConfig = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_DIR, "hooks", "hooks.json"), "utf-8")
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const events = Object.keys(hooksConfig.hooks);
    for (const required of ["UserPromptSubmit", "Stop", "PostToolUse", "SessionEnd"]) {
      expect(events, `event ${required} registered`).toContain(required);
    }
    for (const entries of Object.values(hooksConfig.hooks)) {
      for (const entry of entries) {
        for (const h of entry.hooks) {
          expect(h.command).toContain("${CLAUDE_PLUGIN_ROOT}");
          // The referenced script must actually exist in the plugin
          const script = h.command.split("/").pop()!;
          expect(fs.existsSync(path.join(PLUGIN_DIR, "hooks", script)), `hooks/${script} exists`).toBe(true);
        }
      }
    }
  });

  it("skills keep the frontmatter-first invariant inside the plugin too", () => {
    const skillsDir = path.join(PLUGIN_DIR, "skills");
    for (const d of fs.readdirSync(skillsDir)) {
      const skillMd = path.join(skillsDir, d, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      expect(fs.readFileSync(skillMd, "utf-8").startsWith("---\n"), `plugin skills/${d}`).toBe(true);
    }
  });
});
