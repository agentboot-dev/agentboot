/**
 * Export module for generating agentskills.io listing files.
 *
 * Reads compiled SKILL.md files from dist/skill/core/ and produces a
 * skills-index.json suitable for submission to the agentskills.io directory.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { parseFrontmatter } from "./frontmatter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillsIndexEntry {
  name: string;
  description: string;
  version: string;
  author: string;
  invocation: string;
  platforms: string[];
  source: string;       // URL to source repo
  skillPath: string;    // relative path within the dist
}

export interface SkillsIndex {
  $schema: string;
  generator: string;
  generatedAt: string;
  skills: SkillsIndexEntry[];
}

// ---------------------------------------------------------------------------
// Export to agentskills.io format
// ---------------------------------------------------------------------------

export function generateSkillsIndex(
  distPath: string,
  config: { org: string; orgDisplayName?: string | undefined; version?: string | undefined }
): SkillsIndex {
  const skillsDir = path.join(distPath, "skill", "core");
  const skills: SkillsIndexEntry[] = [];

  if (!fs.existsSync(skillsDir)) {
    // R4-5: "Run: agentboot build" was wrong advice on the common cause — the
    // build had just succeeded and simply does not emit `skill`. Wrong advice
    // that precedes a green tick is how an operator learns to ignore the line.
    console.log(chalk.yellow(
      "  No dist/skill/core/ found — either the hub does not build the `skill` output\n" +
      "  format, or no persona compiled. This export is derived from dist/skill/.",
    ));
    return {
      $schema: "https://agentskills.io/schema/skills-index/v1.json",
      generator: "agentboot",
      generatedAt: new Date().toISOString(),
      skills: [],
    };
  }

  const personaDirs = fs.readdirSync(skillsDir).filter(entry => {
    const entryPath = path.join(skillsDir, entry);
    return fs.statSync(entryPath).isDirectory();
  });

  for (const personaName of personaDirs) {
    const skillMdPath = path.join(skillsDir, personaName, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, "utf-8");
    const fm = parseFrontmatter(content);

    // Read persona.config.json for additional metadata
    const configPath = path.join(skillsDir, personaName, "persona.config.json");
    let personaConfig: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      try {
        personaConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch { /* skip malformed config */ }
    }

    skills.push({
      name: (personaConfig["name"] as string) ?? personaName,
      description:
        (personaConfig["description"] as string) ??
        fm?.get("description")?.replace(/^["']|["']$/g, "") ??
        personaName,
      version: config.version ?? "1.0.0",
      author: config.orgDisplayName ?? config.org,
      invocation: (personaConfig["invocation"] as string) ?? `/${personaName}`,
      platforms:
        (personaConfig["outputFormats"] as string[]) ??
        ["claude", "copilot", "cursor", "gemini", "windsurf", "agents"],
      source: `https://github.com/${config.org}/personas`,
      skillPath: `skill/core/${personaName}/SKILL.md`,
    });
  }

  return {
    $schema: "https://agentskills.io/schema/skills-index/v1.json",
    generator: "agentboot",
    generatedAt: new Date().toISOString(),
    skills,
  };
}
