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
