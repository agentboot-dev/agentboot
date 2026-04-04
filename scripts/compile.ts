/**
 * AgentBoot compile script.
 *
 * Reads agentboot.config.json, traverses core/traits/ and core/personas/,
 * composes each persona by inlining trait content, and writes output to
 * dist/{platform}/ — one self-contained distribution per platform.
 *
 * Output structure:
 *   dist/skill/   — cross-platform SKILL.md (agentskills.io, traits inlined)
 *   dist/claude/  — Claude Code native (.claude/ format)
 *   dist/copilot/ — GitHub Copilot (.github/ format)
 *
 * Each platform folder contains the full scope hierarchy:
 *   dist/{platform}/core/
 *   dist/{platform}/groups/{group}/
 *   dist/{platform}/teams/{group}/{team}/
 *
 * Trait injection points in SKILL.md:
 *   <!-- traits:start -->
 *   (existing content is replaced on each build)
 *   <!-- traits:end -->
 *
 * Usage:
 *   npm run build
 *   tsx scripts/compile.ts
 *   tsx scripts/compile.ts --config path/to/agentboot.config.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  type AgentBootConfig,
  type PersonaConfig,
  type DomainManifest,
  type PluginManifest,
  type ResolvedTrait,
  resolveConfigPath,
  loadConfig,
  stripJsoncComments,
  flattenNodes,
  groupsToNodes,
  normalizeTraitRefs,
  DEFAULT_WEIGHT,
} from "./lib/config.js";
import { parseFrontmatter, resolveCompositionType } from "./lib/frontmatter.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface TraitContent {
  name: string;
  content: string;
  filePath: string;
}

interface CompileResult {
  persona: string;
  platforms: string[];
  traitsInjected: string[];
  scope: "core" | "group" | "team";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fatal(msg: string): never {
  console.error(chalk.red(`✗ FATAL: ${msg}`));
  process.exit(1);
}

function log(msg: string): void {
  console.log(msg);
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function provenanceHeader(sourceFile: string, config: AgentBootConfig): string {
  const relSource = path.relative(ROOT, sourceFile);
  const timestamp = new Date().toISOString();
  const org = config.orgDisplayName ?? config.org;
  return [
    `<!-- ============================================================ -->`,
    `<!-- AgentBoot compiled output — do not edit manually.           -->`,
    `<!-- Source:    ${relSource.padEnd(44)} -->`,
    `<!-- Compiled:  ${timestamp.padEnd(44)} -->`,
    `<!-- Org:       ${org.padEnd(44)} -->`,
    `<!-- ============================================================ -->`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Trait loading
// ---------------------------------------------------------------------------

function loadTraits(
  coreTraitsDir: string,
  enabledTraits: string[] | undefined
): Map<string, TraitContent> {
  const traits = new Map<string, TraitContent>();

  if (!fs.existsSync(coreTraitsDir)) {
    log(chalk.yellow(`  ⚠ Traits directory not found: ${coreTraitsDir} — skipping trait injection`));
    return traits;
  }

  const traitFiles = fs.readdirSync(coreTraitsDir).filter((f) => f.endsWith(".md"));

  for (const file of traitFiles) {
    const traitName = path.basename(file, ".md");

    if (enabledTraits && !enabledTraits.includes(traitName)) {
      continue;
    }

    const filePath = path.join(coreTraitsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    traits.set(traitName, {
      name: traitName,
      content: content.trim(),
      filePath,
    });
  }

  return traits;
}

// ---------------------------------------------------------------------------
// Lexicon loading — ubiquitous language term definitions
// ---------------------------------------------------------------------------

interface LexiconEntry {
  term: string;
  definition: string;
  extras?: Record<string, string> | undefined; // includes, format, usage, see, etc.
}

/**
 * Load lexicon entries from core/lexicon/ directory.
 * Supports both YAML (.yaml/.yml) and Markdown (.md) formats.
 *
 * YAML format:
 *   terms:
 *     full-build:
 *       definition: Complete validation pipeline.
 *       includes: lint, typecheck, test, build
 *
 * Markdown format:
 *   **full-build**: Complete validation pipeline. Includes lint, typecheck, test, build.
 */
function loadLexicon(lexiconDir: string): LexiconEntry[] {
  const entries: LexiconEntry[] = [];

  if (!fs.existsSync(lexiconDir)) {
    return entries;
  }

  for (const file of fs.readdirSync(lexiconDir).sort()) {
    const filePath = path.join(lexiconDir, file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".yaml" || ext === ".yml") {
      // Parse YAML-like term definitions (simple key: value parsing, no yaml dependency)
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      let currentTerm: string | null = null;
      let currentDef = "";
      const currentExtras: Record<string, string> = {};

      for (const line of lines) {
        // Skip "terms:" header
        if (line.trim() === "terms:" || line.trim() === "" || line.trim().startsWith("#")) continue;

        // Top-level term (2-space indent, ends with colon)
        const termMatch = line.match(/^  (\S+):$/);
        if (termMatch) {
          // Save previous term
          if (currentTerm && currentDef) {
            entries.push({ term: currentTerm, definition: currentDef, extras: Object.keys(currentExtras).length > 0 ? { ...currentExtras } : undefined });
          }
          currentTerm = termMatch[1]!;
          currentDef = "";
          for (const k of Object.keys(currentExtras)) delete currentExtras[k];
          continue;
        }

        // Property of current term (4-space indent)
        const propMatch = line.match(/^    (\w+):\s*(.+)$/);
        if (propMatch && currentTerm) {
          const [, key, value] = propMatch;
          if (key === "definition") {
            currentDef = value!;
          } else {
            currentExtras[key!] = value!;
          }
        }
      }
      // Save last term
      if (currentTerm && currentDef) {
        entries.push({ term: currentTerm, definition: currentDef, extras: Object.keys(currentExtras).length > 0 ? { ...currentExtras } : undefined });
      }
    } else if (ext === ".md") {
      // Parse markdown term definitions: **term**: definition
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const mdMatch = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
        if (mdMatch) {
          entries.push({ term: mdMatch[1]!, definition: mdMatch[2]! });
        }
      }
    }
  }

  return entries;
}

/**
 * Compile lexicon entries into a compact glossary block for CLAUDE.md output.
 * Optimized for token density — term + definition on one line, minimal markdown.
 */
function compileLexiconBlock(entries: LexiconEntry[]): string {
  if (entries.length === 0) return "";

  const lines = ["## Lexicon", ""];
  for (const entry of entries) {
    let line = `- **${entry.term}**: ${entry.definition}`;
    if (entry.extras) {
      const extraParts = Object.entries(entry.extras)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      line += ` (${extraParts})`;
    }
    lines.push(line);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Persona config loading
// ---------------------------------------------------------------------------

function loadPersonaConfig(personaDir: string): PersonaConfig | null {
  const configPath = path.join(personaDir, "persona.config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(stripJsoncComments(raw)) as PersonaConfig;
  } catch {
    log(chalk.yellow(`  ⚠ Failed to parse persona.config.json in ${personaDir}`));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trait injection
// ---------------------------------------------------------------------------

const TRAITS_START_MARKER = "<!-- traits:start -->";
const TRAITS_END_MARKER = "<!-- traits:end -->";

// ---------------------------------------------------------------------------
// AB-134: Trait calibration preambles
// ---------------------------------------------------------------------------

/**
 * Per-trait calibration text keyed by weight threshold.
 * Only traits that opt into calibration are listed here.
 * The key is the numeric weight as a string (e.g., "0.3").
 */
const TRAIT_CALIBRATIONS: Record<string, Record<string, string>> = {
  "critical-thinking": {
    "0.3": "Apply light scrutiny: surface only CRITICAL findings. Trust the author's intent; flag only clear defects with high confidence. Suppress WARN/NOTE/INFO.",
    "0.5": "Apply standard scrutiny: surface CRITICAL and ERROR findings reliably. Flag WARN items that represent real risk. Omit nitpicks and style preferences.",
    "0.7": "Apply thorough scrutiny: actively seek hidden issues. Surface all CRITICAL/ERROR/WARN. Flag MEDIUM-confidence concerns. Question non-obvious design choices.",
    "1.0": "Apply adversarial scrutiny: assume hostile or incorrect input. Verify every assumption. Surface all findings at all severity levels. Treat absence of proof as a concern.",
  },
};

/**
 * Build a calibration preamble for a trait at a given weight.
 * Returns empty string if the trait has no calibration or weight is DEFAULT.
 */
export function buildWeightPreamble(traitName: string, weight: number): string {
  const calibrations = TRAIT_CALIBRATIONS[traitName];
  if (!calibrations) return "";

  // Only inject preamble when weight differs from default
  if (weight === DEFAULT_WEIGHT) return "";

  // Find the closest calibration text for this weight.
  // Use toFixed(1) to match keys like "1.0" (String(1.0) produces "1", not "1.0").
  const key = weight.toFixed(1);
  if (calibrations[key]) return calibrations[key]!;

  // Find the nearest defined key
  const keys = Object.keys(calibrations).map(Number).sort((a, b) => a - b);
  let closest = keys[0]!;
  let closestDist = Math.abs(weight - closest);
  for (const k of keys) {
    const dist = Math.abs(weight - k);
    if (dist < closestDist) {
      closest = k;
      closestDist = dist;
    }
  }
  return calibrations[closest.toFixed(1)] ?? "";
}

function injectTraits(
  skillContent: string,
  resolvedTraits: ResolvedTrait[],
  traits: Map<string, TraitContent>,
  personaName: string
): { result: string; injected: string[] } {
  const injected: string[] = [];
  const missing: string[] = [];

  const blocks: string[] = [];
  for (const { name: traitName, weight } of resolvedTraits) {
    // Skip traits with weight 0.0 (OFF)
    if (weight === 0.0) continue;

    const trait = traits.get(traitName);
    if (!trait) {
      missing.push(traitName);
      continue;
    }
    injected.push(traitName);

    // Build weight annotation and optional calibration preamble
    const weightLabel = weight !== DEFAULT_WEIGHT
      ? ` (weight: ${weight})`
      : "";
    const preamble = buildWeightPreamble(traitName, weight);
    const preambleBlock = preamble ? `${preamble}\n\n` : "";

    blocks.push(
      `<!-- trait: ${traitName}${weightLabel} -->\n${preambleBlock}${trait.content}\n<!-- /trait: ${traitName} -->`
    );
  }

  if (missing.length > 0) {
    log(
      chalk.yellow(
        `  ⚠ [${personaName}] Traits not found (skipped): ${missing.join(", ")}`
      )
    );
  }

  const injectedBlock =
    blocks.length > 0
      ? `\n\n${blocks.join("\n\n")}\n\n`
      : "\n\n<!-- no traits configured -->\n\n";

  const startIdx = skillContent.indexOf(TRAITS_START_MARKER);
  const endIdx = skillContent.indexOf(TRAITS_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = skillContent.slice(0, startIdx + TRAITS_START_MARKER.length);
    const after = skillContent.slice(endIdx);
    return {
      result: `${before}${injectedBlock}${after}`,
      injected,
    };
  }

  return {
    result: `${skillContent.trimEnd()}\n\n${TRAITS_START_MARKER}${injectedBlock}${TRAITS_END_MARKER}\n`,
    injected,
  };
}

// ---------------------------------------------------------------------------
// Platform-specific output builders
// ---------------------------------------------------------------------------

function buildSkillOutput(
  _personaName: string,
  _personaConfig: PersonaConfig | null,
  composedContent: string,
  config: AgentBootConfig,
  skillPath: string
): string {
  const provenanceEnabled = config.output?.provenanceHeaders !== false;
  return provenanceEnabled
    ? `${provenanceHeader(skillPath, config)}${composedContent}`
    : composedContent;
}

/**
 * Build CC-native skill file.
 * CC expects: .claude/skills/{skill-name}.md with description frontmatter.
 * The skill name comes from the invocation (e.g., "/review-code" → "review-code").
 */
function buildClaudeOutput(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  _config: AgentBootConfig
): { content: string; skillName: string } {
  const invocation = personaConfig?.invocation ?? `/${personaName}`;
  const skillName = invocation.replace(/^\//, "");
  const description = personaConfig?.description ?? personaName;
  // Escape for YAML double-quoted strings
  const safeDescription = description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/---/g, "\\-\\-\\-");

  // AB-18: CC skill frontmatter with context:fork → delegates to agent
  const frontmatterLines: string[] = [
    "---",
    `description: "${safeDescription}"`,
    "context: fork",
    `agent: "${personaName}"`,
  ];

  // Optional: include model override if specified
  if (personaConfig?.model) {
    frontmatterLines.push(`model: "${personaConfig.model}"`);
  }

  frontmatterLines.push("---", "");

  // Strip any existing frontmatter from composed content (it's SKILL.md format)
  const withoutFrontmatter = composedContent.replace(/^---\n[\s\S]*?\n---\n*/, "");

  return {
    content: `${frontmatterLines.join("\n")}\n${withoutFrontmatter}`,
    skillName,
  };
}

function buildCopilotOutput(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  config: AgentBootConfig,
  skillPath: string
): string {
  const header = `# ${personaConfig?.name ?? personaName} (AgentBoot)\n\n`;
  const description = personaConfig?.description
    ? `${personaConfig.description}\n\n---\n\n`
    : "";
  // Strip HTML comments for Copilot output.
  const stripped = composedContent.replace(/<!--[\s\S]*?-->/g, "").trim();
  return `${provenanceHeader(skillPath, config)}${header}${description}${stripped}\n`;
}

// ---------------------------------------------------------------------------
// Cursor output: .cursor/rules/*/RULE.md
// ---------------------------------------------------------------------------

function buildCursorRule(
  name: string,
  content: string,
  options?: { globs?: string[] | undefined; alwaysApply?: boolean }
): string {
  const lines: string[] = ["---"];
  lines.push(`description: "${name}"`);
  if (options?.globs && options.globs.length > 0) {
    if (options.globs.length === 1) {
      lines.push(`globs: "${options.globs[0]}"`);
    } else {
      lines.push("globs:");
      for (const glob of options.globs) {
        lines.push(`  - "${glob}"`);
      }
    }
  }
  lines.push(`alwaysApply: ${options?.alwaysApply ?? false}`);
  lines.push("---", "");
  // Strip HTML comments and trait markers for clean Cursor output
  const stripped = content.replace(/<!--[\s\S]*?-->/g, "").trim();
  lines.push(stripped);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Copilot agents: .github/agents/*.agent.md
// ---------------------------------------------------------------------------

function buildCopilotAgent(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  _config: AgentBootConfig
): string {
  const description = personaConfig?.description ?? personaName;
  const stripped = composedContent.replace(/<!--[\s\S]*?-->/g, "").replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
  return `---\ndescription: "${description}"\n---\n\n${stripped}\n`;
}

// ---------------------------------------------------------------------------
// Persona compilation — writes to each platform's dist folder
// ---------------------------------------------------------------------------

function compilePersona(
  personaName: string,
  personaDir: string,
  traits: Map<string, TraitContent>,
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  groupName?: string,
  teamName?: string
): CompileResult {
  const skillPath = path.join(personaDir, "SKILL.md");
  const scope: "core" | "group" | "team" = teamName ? "team" : groupName ? "group" : "core";

  if (!fs.existsSync(skillPath)) {
    log(chalk.yellow(`  ⚠ [${personaName}] No SKILL.md found — skipping`));
    return { persona: personaName, platforms: [], traitsInjected: [], scope };
  }

  const personaConfig = loadPersonaConfig(personaDir);
  const skillContent = fs.readFileSync(skillPath, "utf-8");

  // Determine which traits to inject (supports both array and weight-object formats).
  let resolvedTraits: ResolvedTrait[] = personaConfig?.traits
    ? normalizeTraitRefs(personaConfig.traits)
    : [];

  if (groupName && personaConfig?.groups?.[groupName]?.traits) {
    const groupTraits = normalizeTraitRefs(personaConfig.groups[groupName]!.traits!);
    resolvedTraits = [...resolvedTraits, ...groupTraits];
  }

  if (teamName && personaConfig?.teams?.[teamName]?.traits) {
    const teamTraits = normalizeTraitRefs(personaConfig.teams[teamName]!.traits!);
    resolvedTraits = [...resolvedTraits, ...teamTraits];
  }

  // Deduplicate by name — last occurrence wins (team > group > core)
  const seen = new Map<string, ResolvedTrait>();
  for (const rt of resolvedTraits) {
    seen.set(rt.name, rt);
  }
  resolvedTraits = [...seen.values()];

  const { result: composed, injected } = injectTraits(
    skillContent,
    resolvedTraits,
    traits,
    personaName
  );

  const outputFormats = config.personas?.outputFormats ?? ["skill", "claude", "copilot"];
  const platforms: string[] = [];

  // Write to dist/{platform}/{scopePath}/{persona}/ (or skills/{name}/ for claude)
  // e.g., dist/skill/core/code-reviewer/SKILL.md
  //        dist/claude/core/skills/review-code/SKILL.md

  if (outputFormats.includes("skill")) {
    const outDir = path.join(distPath, "skill", scopePath, personaName);
    ensureDir(outDir);
    const content = buildSkillOutput(personaName, personaConfig, composed, config, skillPath);
    fs.writeFileSync(path.join(outDir, "SKILL.md"), content, "utf-8");
    if (personaConfig) {
      fs.writeFileSync(
        path.join(outDir, "persona.config.json"),
        JSON.stringify(personaConfig, null, 2) + "\n",
        "utf-8"
      );
    }
    platforms.push("skill");
  }

  if (outputFormats.includes("claude")) {
    const { content, skillName } = buildClaudeOutput(personaName, personaConfig, composed, config);
    // CC-native: write to dist/claude/{scope}/skills/{skillName}/SKILL.md
    const skillDir = path.join(distPath, "claude", scopePath, "skills", skillName);
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");
    platforms.push("claude");
  }

  if (outputFormats.includes("claude")) {
    // AB-17: Write agent file to dist/claude/{scope}/agents/{personaName}.md
    const agentDir = path.join(distPath, "claude", scopePath, "agents");
    ensureDir(agentDir);

    const model = personaConfig?.model;  // undefined = omit from frontmatter
    const permMode = personaConfig?.permissionMode;
    const agentDescription = personaConfig?.description ?? personaName;
    // Escape for YAML double-quoted strings: backslashes, quotes, newlines, and --- sequences.
    const safeDescription = agentDescription
      .replace(/\\/g, "\\\\")   // backslashes first (before other escapes add more)
      .replace(/"/g, '\\"')     // double quotes
      .replace(/\n/g, " ")      // newlines → spaces
      .replace(/\t/g, " ")      // tabs → spaces
      .replace(/\0/g, "")       // null bytes → remove
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // other control chars → remove
      .replace(/---/g, "\\-\\-\\-"); // prevent YAML document markers
    const withoutFrontmatter = composed.replace(/^---\n[\s\S]*?\n---\n*/, "");
    const agentFrontmatter: string[] = [
      "---",
      `name: "${personaName}"`,
      `description: "${safeDescription}"`,
    ];
    if (model) agentFrontmatter.push(`model: "${model}"`);
    if (permMode && permMode !== "default") agentFrontmatter.push(`permissionMode: "${permMode}"`);
    if (personaConfig?.maxTurns) agentFrontmatter.push(`maxTurns: ${personaConfig.maxTurns}`);
    // Tool restrictions — CC enforces these at runtime
    if (personaConfig?.disallowedTools && personaConfig.disallowedTools.length > 0) {
      agentFrontmatter.push(`disallowedTools:`);
      for (const tool of personaConfig.disallowedTools) {
        agentFrontmatter.push(`  - "${tool}"`);
      }
    }
    if (personaConfig?.tools && personaConfig.tools.length > 0) {
      agentFrontmatter.push(`tools:`);
      for (const tool of personaConfig.tools) {
        agentFrontmatter.push(`  - "${tool}"`);
      }
    }
    agentFrontmatter.push("---");
    const agentContent = [...agentFrontmatter, "", withoutFrontmatter].join("\n");

    fs.writeFileSync(path.join(agentDir, `${personaName}.md`), agentContent, "utf-8");
  }

  if (outputFormats.includes("copilot")) {
    const outDir = path.join(distPath, "copilot", scopePath, personaName);
    ensureDir(outDir);
    const content = buildCopilotOutput(personaName, personaConfig, composed, config, skillPath);
    fs.writeFileSync(path.join(outDir, "copilot-instructions.md"), content, "utf-8");
    if (personaConfig) {
      fs.writeFileSync(
        path.join(outDir, "persona.config.json"),
        JSON.stringify(personaConfig, null, 2) + "\n",
        "utf-8"
      );
    }
    platforms.push("copilot");

    // AB-110: Copilot agent definitions (.github/agents/*.agent.md)
    const copilotAgentDir = path.join(distPath, "copilot", scopePath, "agents");
    ensureDir(copilotAgentDir);
    const agentContent = buildCopilotAgent(personaName, personaConfig, composed, config);
    fs.writeFileSync(path.join(copilotAgentDir, `${personaName}.agent.md`), agentContent, "utf-8");
  }

  if (outputFormats.includes("cursor")) {
    // AB-129: Cursor persona as a flat .mdc file with alwaysApply: true
    const cursorRulesDir = path.join(distPath, "cursor", scopePath, "rules");
    ensureDir(cursorRulesDir);
    const cursorContent = buildCursorRule(
      personaConfig?.description ?? personaName,
      composed,
      { alwaysApply: true }
    );
    fs.writeFileSync(path.join(cursorRulesDir, `${personaName}.mdc`), cursorContent, "utf-8");
    platforms.push("cursor");
  }

  return { persona: personaName, platforms, traitsInjected: injected, scope };
}

// ---------------------------------------------------------------------------
// Always-on instructions compilation — writes to each platform
// ---------------------------------------------------------------------------

function compileInstructions(
  instructionsDir: string,
  enabledInstructions: string[] | undefined,
  distPath: string,
  scopePath: string,
  config: AgentBootConfig,
  outputFormats: string[]
): void {
  if (!fs.existsSync(instructionsDir)) {
    return;
  }

  const files = fs.readdirSync(instructionsDir).filter((f) => f.endsWith(".md"));
  const provenanceEnabled = config.output?.provenanceHeaders !== false;

  for (const platform of outputFormats) {
    if (platform === "agents" || platform === "plugin") continue; // handled separately
    // CC and Cursor use "rules/" for always-on instructions; other platforms use "instructions/"
    const dirName = (platform === "claude" || platform === "cursor") ? "rules" : "instructions";
    const outDir = path.join(distPath, platform, scopePath, dirName);
    ensureDir(outDir);

    for (const file of files) {
      const name = path.basename(file, ".md");
      if (enabledInstructions && !enabledInstructions.includes(name)) {
        continue;
      }
      const srcPath = path.join(instructionsDir, file);
      let content = fs.readFileSync(srcPath, "utf-8");

      // Strip HTML comments for copilot/cursor output
      if (platform === "copilot" || platform === "cursor") {
        content = content.replace(/<!--[\s\S]*?-->/g, "").trim() + "\n";
      }

      let finalContent: string;
      if (!provenanceEnabled) {
        finalContent = content;
      } else if (platform === "claude") {
        // For CC rules, frontmatter must be the first thing in the file.
        // Insert provenance after the closing --- of frontmatter.
        const fmMatch = content.match(/^(---\n[\s\S]*?\n---\n)/);
        if (fmMatch) {
          const afterFm = content.slice(fmMatch[1]!.length);
          finalContent = `${fmMatch[1]}\n${provenanceHeader(srcPath, config)}${afterFm}`;
        } else {
          finalContent = `${provenanceHeader(srcPath, config)}${content}`;
        }
      } else {
        finalContent = `${provenanceHeader(srcPath, config)}${content}`;
      }
      fs.writeFileSync(path.join(outDir, file), finalContent, "utf-8");
    }
  }
}

// ---------------------------------------------------------------------------
// AB-52: Gotchas compilation — path-scoped knowledge rules
// ---------------------------------------------------------------------------

function compileGotchas(
  gotchasDir: string,
  distPath: string,
  scopePath: string,
  config: AgentBootConfig,
  outputFormats: string[]
): void {
  if (!fs.existsSync(gotchasDir)) {
    return;
  }

  const gotchaFiles = fs.readdirSync(gotchasDir).filter(
    (f) => f.endsWith(".md") && f !== "README.md"
  );

  if (gotchaFiles.length === 0) return;

  log(chalk.gray(`  Gotchas: ${gotchaFiles.length} rule(s)`));

  for (const file of gotchaFiles) {
    const content = fs.readFileSync(path.join(gotchasDir, file), "utf-8");
    const provenanceEnabled = config.output?.provenanceHeaders !== false;
    const header = provenanceEnabled
      ? provenanceHeader(path.join(gotchasDir, file), config)
      : "";

    // Write to claude rules (gotchas are path-scoped rules)
    if (outputFormats.includes("claude")) {
      const rulesDir = path.join(distPath, "claude", scopePath, "rules");
      ensureDir(rulesDir);
      fs.writeFileSync(path.join(rulesDir, file), `${header}${content}`, "utf-8");
    }

    // Write to skill output as well
    if (outputFormats.includes("skill")) {
      const gotchaOutDir = path.join(distPath, "skill", scopePath, "gotchas");
      ensureDir(gotchaOutDir);
      fs.writeFileSync(path.join(gotchaOutDir, file), `${header}${content}`, "utf-8");
    }

    // AB-129: Cursor output — gotchas become glob-scoped .mdc rules
    if (outputFormats.includes("cursor")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      // Strip surrounding quotes from YAML values (parseFrontmatter preserves them)
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      const globs = pathsStr ? pathsStr.split(",").map(p => p.trim()).filter(Boolean) : undefined;
      const name = path.basename(file, ".md");
      const cursorRulesDir = path.join(distPath, "cursor", scopePath, "rules");
      ensureDir(cursorRulesDir);
      const cursorDesc = (fm?.get("description") ?? name).replace(/^["']|["']$/g, "");
      const cursorContent = buildCursorRule(
        cursorDesc,
        content.replace(/^---\n[\s\S]*?\n---\n*/, ""), // strip frontmatter
        { globs, alwaysApply: false }
      );
      fs.writeFileSync(path.join(cursorRulesDir, `${name}.mdc`), cursorContent, "utf-8");
    }

    // AB-130: Copilot scoped instructions — gotchas with paths: become .instructions.md
    if (outputFormats.includes("copilot")) {
      const fm = parseFrontmatter(content);
      const rawPaths = fm?.get("paths");
      // Strip surrounding quotes from YAML values (parseFrontmatter preserves them)
      const pathsStr = rawPaths?.replace(/^["']|["']$/g, "");
      if (pathsStr) {
        const name = path.basename(file, ".md");
        const description = (fm?.get("description") ?? name).replace(/^["']|["']$/g, "");
        const copilotInstrDir = path.join(distPath, "copilot", scopePath, "instructions");
        ensureDir(copilotInstrDir);
        const strippedContent = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
        const copilotInstrContent = [
          "---",
          `description: "${description}"`,
          `applyTo: "${pathsStr}"`,
          "---",
          "",
          strippedContent,
          "",
        ].join("\n");
        fs.writeFileSync(path.join(copilotInstrDir, `${name}.instructions.md`), copilotInstrContent, "utf-8");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PERSONAS.md index generation — writes to each platform
// ---------------------------------------------------------------------------

function generatePersonasIndex(
  results: CompileResult[],
  config: AgentBootConfig,
  personasBaseDir: string,
  distPath: string,
  scopePath: string,
  outputFormats: string[]
): void {
  const org = config.orgDisplayName ?? config.org;
  const lines: string[] = [
    `<!-- AgentBoot generated — do not edit manually. Org: ${org} -->`,
    "",
    `# Available Personas`,
    "",
    `> Generated by AgentBoot for **${org}**. Run \`npm run build\` to refresh.`,
    "",
    "| Persona | Invocation | Description |",
    "|---|---|---|",
  ];

  for (const result of results.filter((r) => r.platforms.length > 0)) {
    const personaConfigPath = path.join(personasBaseDir, result.persona, "persona.config.json");
    let invocation = `/${result.persona}`;
    let description = "";

    if (fs.existsSync(personaConfigPath)) {
      try {
        const pc = JSON.parse(fs.readFileSync(personaConfigPath, "utf-8")) as PersonaConfig;
        invocation = pc.invocation ?? invocation;
        description = pc.description ?? "";
      } catch {
        // ignore
      }
    }

    lines.push(`| **${result.persona}** | \`${invocation}\` | ${description} |`);
  }

  lines.push("", `*Last compiled: ${new Date().toISOString()}*`, "");
  const content = lines.join("\n");

  for (const platform of outputFormats) {
    const outDir = path.join(distPath, platform, scopePath);
    ensureDir(outDir);
    fs.writeFileSync(path.join(outDir, "PERSONAS.md"), content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// AB-19: CLAUDE.md with @import directives + trait files
// ---------------------------------------------------------------------------

function generateClaudeMd(
  traitNames: string[],
  traits: Map<string, TraitContent>,
  instructionFileNames: string[],
  config: AgentBootConfig,
  distPath: string,
  scopePath: string,
  personaConfigs?: Map<string, PersonaConfig>,
  lexiconEntries?: LexiconEntry[]
): void {
  const org = config.orgDisplayName ?? config.org;

  // Write trait files to dist/claude/{scopePath}/traits/
  const traitsDir = path.join(distPath, "claude", scopePath, "traits");
  ensureDir(traitsDir);

  for (const traitName of traitNames) {
    const trait = traits.get(traitName);
    if (trait) {
      fs.writeFileSync(path.join(traitsDir, `${traitName}.md`), trait.content, "utf-8");
    }
  }

  // Build CLAUDE.md with @import directives
  const lines: string[] = [
    `# AgentBoot — ${org}`,
    "",
    "<!-- Auto-generated. Do not edit manually. -->",
    "",
  ];

  // Lexicon first — context compression primitives that all other sections reference
  if (lexiconEntries && lexiconEntries.length > 0) {
    lines.push(compileLexiconBlock(lexiconEntries));
  }

  if (traitNames.length > 0) {
    lines.push("## Traits", "");
    for (const traitName of traitNames) {
      if (traits.has(traitName)) {
        lines.push(`@.claude/traits/${traitName}.md`);
      }
    }
    lines.push("");
  }

  if (instructionFileNames.length > 0) {
    lines.push("## Instructions", "");
    for (const instrName of instructionFileNames) {
      lines.push(`@.claude/rules/${instrName}.md`);
    }
    lines.push("");
  }

  // AB-77: First-session welcome fragment
  if (personaConfigs && personaConfigs.size > 0) {
    lines.push("## Available Personas", "");
    for (const [, pc] of personaConfigs) {
      const cmd = pc.invocation ?? `/${pc.name}`;
      lines.push(`- \`${cmd}\` — ${pc.description}`);
    }
    lines.push("");
  }

  const claudeMdPath = path.join(distPath, "claude", scopePath, "CLAUDE.md");
  fs.writeFileSync(claudeMdPath, lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// AGENTS.md generation — universal cross-tool standard
// ---------------------------------------------------------------------------

function generateAgentsMd(
  config: AgentBootConfig,
  distPath: string,
  personaConfigs: Map<string, PersonaConfig>,
  instructionFileNames: string[],
  lexiconEntries: LexiconEntry[],
  instructionsDir: string
): void {
  const org = config.orgDisplayName ?? config.org;
  const lines: string[] = [
    `# ${org} — Agent Configuration`,
    "",
    `> Generated by [AgentBoot](https://agentboot.dev). Do not edit manually.`,
    "",
  ];

  // Lexicon section
  if (lexiconEntries.length > 0) {
    lines.push("## Terminology", "");
    for (const entry of lexiconEntries) {
      let line = `- **${entry.term}**: ${entry.definition}`;
      if (entry.extras) {
        const extraParts = Object.entries(entry.extras).map(([k, v]) => `${k}: ${v}`).join("; ");
        line += ` (${extraParts})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  // Coding conventions (from instructions)
  if (instructionFileNames.length > 0) {
    lines.push("## Coding Conventions", "");
    for (const instrName of instructionFileNames) {
      const instrPath = path.join(instructionsDir, `${instrName}.md`);
      if (fs.existsSync(instrPath)) {
        const content = fs.readFileSync(instrPath, "utf-8");
        // Skip frontmatter block, then find first non-heading, non-empty line
        const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
        const summaryLines = contentWithoutFrontmatter.split("\n")
          .filter(l => l.trim() && !l.startsWith("#"));
        const summary = summaryLines[0]?.trim() ?? instrName;
        lines.push(`- **${instrName}**: ${summary}`);
      }
    }
    lines.push("");
  }

  // Agent definitions
  if (personaConfigs.size > 0) {
    lines.push("## Agents", "");
    for (const [name, pc] of personaConfigs) {
      const description = pc.description ?? name;
      const invocation = pc.invocation ?? `/${name}`;
      lines.push(`### ${name}`);
      lines.push("");
      lines.push(`- **Description**: ${description}`);
      lines.push(`- **Invocation**: \`${invocation}\``);
      if (pc.model) lines.push(`- **Model**: ${pc.model}`);
      if (pc.traits) {
        const traitNames = Array.isArray(pc.traits) ? pc.traits : Object.keys(pc.traits);
        if (traitNames.length > 0) {
          lines.push(`- **Traits**: ${traitNames.join(", ")}`);
        }
      }
      lines.push("");
    }
  }

  const agentsDir = path.join(distPath, "agents");
  ensureDir(agentsDir);
  fs.writeFileSync(path.join(agentsDir, "AGENTS.md"), lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// Composition manifest generation
// ---------------------------------------------------------------------------

/**
 * Generate composition-manifest.json for a scope directory.
 * Maps relative file paths to their resolved composition types.
 * Used by sync.ts to enforce rule/preference merge semantics.
 */
function generateCompositionManifest(
  distPath: string,
  platform: string,
  scopePath: string,
  config: AgentBootConfig
): void {
  const scopeDir = path.join(distPath, platform, scopePath);
  if (!fs.existsSync(scopeDir)) return;

  const manifest: Record<string, string> = {};
  const configOverrides = config.composition?.overrides;
  const configDefaults = config.composition?.defaults;

  function walkDir(dir: string, relBase: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const absPath = path.join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      if (fs.statSync(absPath).isDirectory()) {
        walkDir(absPath, relPath);
      } else if (entry.endsWith(".md")) {
        const content = fs.readFileSync(absPath, "utf-8");
        const fm = parseFrontmatter(content);
        manifest[relPath] = resolveCompositionType(relPath, fm, configOverrides, configDefaults);
      }
    }
  }

  walkDir(scopeDir, "");

  if (Object.keys(manifest).length > 0) {
    fs.writeFileSync(
      path.join(scopeDir, "composition-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8"
    );
  }
}

// AB-26: settings.json generation
// ---------------------------------------------------------------------------

function generateSettingsJson(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  const hooks = config.claude?.hooks;
  const permissions = config.claude?.permissions;

  if (!hooks && !permissions) return;

  // Validate hooks structure (must be an object with string keys)
  if (hooks && typeof hooks !== "object") {
    log(chalk.yellow("  ⚠ config.claude.hooks must be an object — skipping settings.json"));
    return;
  }
  if (permissions) {
    if (permissions.allow && !Array.isArray(permissions.allow)) {
      log(chalk.yellow("  ⚠ config.claude.permissions.allow must be an array — skipping"));
      return;
    }
    if (permissions.deny && !Array.isArray(permissions.deny)) {
      log(chalk.yellow("  ⚠ config.claude.permissions.deny must be an array — skipping"));
      return;
    }
  }

  // Security: hooks execute shell commands in target repos — warn prominently
  if (hooks) {
    log(chalk.red("  ⚠ CAUTION: settings.json contains hooks that execute shell commands in target repos."));
    log(chalk.red("    Review claude.hooks in agentboot.config.json carefully before syncing."));
    // Validate hook event names against known CC events
    const validEvents = [
      "PreToolUse", "PostToolUse", "Notification", "Stop",
      "SubagentStop", "SubagentStart", "UserPromptSubmit", "SessionEnd",
    ];
    for (const key of Object.keys(hooks)) {
      if (!validEvents.includes(key)) {
        log(chalk.yellow(`    ⚠ Unknown hook event: "${key}" — may not be recognized by Claude Code`));
      }
    }
  } else {
    log(chalk.yellow("  ⚠ Generating settings.json with permissions — these will be synced to all target repos"));
  }

  const settings: Record<string, unknown> = {};
  if (hooks) settings["hooks"] = hooks;
  if (permissions) settings["permissions"] = permissions;

  const settingsPath = path.join(distPath, "claude", scopePath, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// AB-27: .mcp.json generation
// ---------------------------------------------------------------------------

function generateMcpJson(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  const mcpServers = config.claude?.mcpServers;
  if (!mcpServers) return;

  if (typeof mcpServers !== "object") {
    log(chalk.yellow("  ⚠ config.claude.mcpServers must be an object — skipping .mcp.json"));
    return;
  }

  log(chalk.yellow("  ⚠ Generating .mcp.json with MCP servers — these will be synced to all target repos"));

  const mcpJson = { mcpServers };
  const mcpPath = path.join(distPath, "claude", scopePath, ".mcp.json");
  fs.writeFileSync(mcpPath, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// AB-53: Domain layer loading
// ---------------------------------------------------------------------------

function loadDomainManifest(domainDir: string): DomainManifest | null {
  const manifestPath = path.join(domainDir, "agentboot.domain.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as DomainManifest;
  } catch {
    log(chalk.yellow(`  ⚠ Failed to parse agentboot.domain.json in ${domainDir}`));
    return null;
  }
}

function compileDomains(
  config: AgentBootConfig,
  configDir: string,
  distPath: string,
  traits: Map<string, TraitContent>,
  outputFormats: string[]
): CompileResult[] {
  const domains = config.domains;
  if (!domains || domains.length === 0) return [];

  log(chalk.cyan("\nCompiling domain layers..."));
  const results: CompileResult[] = [];

  for (const domainRef of domains) {
    const domainPath = typeof domainRef === "string"
      ? path.resolve(configDir, domainRef)
      : path.resolve(configDir, domainRef.path ?? `./domains/${domainRef.name}`);

    if (!fs.existsSync(domainPath)) {
      log(chalk.yellow(`  ⚠ Domain not found: ${domainPath}`));
      continue;
    }

    // S3 fix: path traversal protection — resolve symlinks then check boundary
    const boundary = path.resolve(configDir);
    const realDomainPath = fs.realpathSync(domainPath);
    if (!realDomainPath.startsWith(boundary + path.sep) && realDomainPath !== boundary) {
      log(chalk.red(`  ✗ Domain path escapes project boundary: ${domainPath} → ${realDomainPath}`));
      continue;
    }

    const manifest = loadDomainManifest(domainPath);
    const domainName = manifest?.name ?? path.basename(domainPath);
    log(chalk.gray(`  Domain: ${domainName}${manifest?.version ? ` v${manifest.version}` : ""}`));

    // Load domain-specific traits
    const domainTraitsDir = path.join(domainPath, "traits");
    if (fs.existsSync(domainTraitsDir)) {
      const domainTraits = loadTraits(domainTraitsDir, undefined);
      for (const [name, trait] of domainTraits) {
        if (traits.has(name)) {
          log(chalk.yellow(`    ⚠ Domain trait '${name}' shadows existing trait`));
        }
        traits.set(name, trait);
      }
      log(chalk.gray(`    + ${domainTraits.size} trait(s)`));
    }

    // Compile domain personas
    const domainPersonasDir = path.join(domainPath, "personas");
    if (fs.existsSync(domainPersonasDir)) {
      const personaDirs = fs.readdirSync(domainPersonasDir).filter((entry) =>
        fs.statSync(path.join(domainPersonasDir, entry)).isDirectory()
      );
      for (const personaName of personaDirs) {
        const personaDir = path.join(domainPersonasDir, personaName);
        const result = compilePersona(
          personaName,
          personaDir,
          traits,
          config,
          distPath,
          `domains/${domainName}`
        );
        results.push(result);
        log(`    ${chalk.green("✓")} ${personaName}`);
      }
    }

    // Compile domain instructions
    const domainInstructionsDir = path.join(domainPath, "instructions");
    compileInstructions(
      domainInstructionsDir,
      undefined,
      distPath,
      `domains/${domainName}`,
      config,
      outputFormats
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// AB-57: Plugin structure generation
// ---------------------------------------------------------------------------

function generatePluginOutput(
  config: AgentBootConfig,
  distPath: string,
  allResults: CompileResult[],
  personasBaseDir: string,
  traits: Map<string, TraitContent>
): void {
  const pluginDir = path.join(distPath, "plugin");
  ensureDir(pluginDir);

  const pkgPath = path.join(ROOT, "package.json");
  const pkg = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    : { version: "0.0.0" };

  const personas: PluginManifest["personas"] = [];
  const traitEntries: PluginManifest["traits"] = [];
  const hookEntries: PluginManifest["hooks"] = [];
  const ruleEntries: PluginManifest["rules"] = [];

  // Copy agents and skills from claude output
  const claudeCorePath = path.join(distPath, "claude", "core");

  // Agents
  const agentsDir = path.join(claudeCorePath, "agents");
  const pluginAgentsDir = path.join(pluginDir, "agents");
  if (fs.existsSync(agentsDir)) {
    ensureDir(pluginAgentsDir);
    for (const file of fs.readdirSync(agentsDir)) {
      fs.copyFileSync(path.join(agentsDir, file), path.join(pluginAgentsDir, file));
    }
  }

  // Skills
  const skillsDir = path.join(claudeCorePath, "skills");
  const pluginSkillsDir = path.join(pluginDir, "skills");
  if (fs.existsSync(skillsDir)) {
    ensureDir(pluginSkillsDir);
    for (const skillFolder of fs.readdirSync(skillsDir)) {
      const src = path.join(skillsDir, skillFolder);
      if (fs.statSync(src).isDirectory()) {
        const dest = path.join(pluginSkillsDir, skillFolder);
        ensureDir(dest);
        for (const file of fs.readdirSync(src)) {
          fs.copyFileSync(path.join(src, file), path.join(dest, file));
        }
      }
    }
  }

  // Traits
  const pluginTraitsDir = path.join(pluginDir, "traits");
  ensureDir(pluginTraitsDir);
  for (const [name, trait] of traits) {
    fs.writeFileSync(path.join(pluginTraitsDir, `${name}.md`), trait.content, "utf-8");
    traitEntries.push({ id: name, path: `traits/${name}.md` });
  }

  // Rules
  const rulesDir = path.join(claudeCorePath, "rules");
  const pluginRulesDir = path.join(pluginDir, "rules");
  if (fs.existsSync(rulesDir)) {
    ensureDir(pluginRulesDir);
    for (const file of fs.readdirSync(rulesDir)) {
      fs.copyFileSync(path.join(rulesDir, file), path.join(pluginRulesDir, file));
      ruleEntries.push({ path: `rules/${file}` });
    }
  }

  // Hooks directory (compliance hooks go here)
  const pluginHooksDir = path.join(pluginDir, "hooks");
  ensureDir(pluginHooksDir);

  // Build persona entries
  for (const result of allResults.filter((r) => r.platforms.length > 0 && r.scope === "core")) {
    const personaConfigPath = path.join(personasBaseDir, result.persona, "persona.config.json");
    let pc: PersonaConfig | null = null;
    if (fs.existsSync(personaConfigPath)) {
      try {
        pc = JSON.parse(fs.readFileSync(personaConfigPath, "utf-8")) as PersonaConfig;
      } catch { /* skip */ }
    }

    const invocation = pc?.invocation ?? `/${result.persona}`;
    const skillName = invocation.replace(/^\//, "");

    personas.push({
      id: result.persona,
      name: pc?.name ?? result.persona,
      description: pc?.description ?? "",
      model: pc?.model,
      agent_path: `agents/${result.persona}.md`,
      skill_path: `skills/${skillName}/SKILL.md`,
    });
  }

  // Generate plugin.json
  const pluginManifest: PluginManifest = {
    name: `@${config.org}/${config.org}-personas`,
    version: pkg.version,
    description: `Agentic personas for ${config.orgDisplayName ?? config.org}`,
    author: config.orgDisplayName ?? config.org,
    license: "Apache-2.0",
    agentboot_version: pkg.version,
    personas,
    traits: traitEntries,
    hooks: hookEntries.length > 0 ? hookEntries : undefined,
    rules: ruleEntries.length > 0 ? ruleEntries : undefined,
  };

  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(pluginManifest, null, 2) + "\n",
    "utf-8"
  );

  log(chalk.gray(`  → Plugin output written to dist/plugin/`));
}

// ---------------------------------------------------------------------------
// AB-59/60/63: Compliance & audit trail hook generation
// ---------------------------------------------------------------------------

function generateComplianceHooks(
  config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  const hooksDir = path.join(distPath, "claude", scopePath, "hooks");
  ensureDir(hooksDir);

  // AB-59: Input scanning hook (UserPromptSubmit)
  // S4 fix: use printf instead of echo to avoid flag interpretation
  // S5 fix: add set -uo pipefail and jq dependency check
  // Note: -e intentionally omitted because grep -q returns 1 on no-match
  const inputScanHook = `#!/bin/bash
# AgentBoot compliance hook — input scanning (AB-59)
# Event: UserPromptSubmit
# Generated by AgentBoot. Do not edit manually.

set -uo pipefail
command -v jq >/dev/null 2>&1 || { echo '{"decision":"block","reason":"AgentBoot: jq is required for input scanning"}'; exit 2; }

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty') || { echo '{"decision":"block","reason":"AgentBoot: Failed to parse hook input"}'; exit 2; }

# Scan for potential credential leaks in prompts
PATTERNS=(
  'password[[:space:]]*[:=]'
  'api[_-]?key[[:space:]]*[:=]'
  'secret[[:space:]]*[:=]'
  'token[[:space:]]*[:=]'
  'AKIA[A-Z0-9]{16}'
  'sk-[a-zA-Z0-9]{20,}'
  'ghp_[a-zA-Z0-9]{36}'
  'xox[bp]-[a-zA-Z0-9-]+'
  'sk_live_[a-zA-Z0-9]+'
  'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'
)

for pattern in "\${PATTERNS[@]}"; do
  if printf '%s' "$PROMPT" | grep -qiE "$pattern"; then
    echo '{"decision":"block","reason":"AgentBoot: Potential credential detected in prompt. Remove secrets before proceeding."}'
    exit 2
  fi
done

exit 0
`;

  // AB-60: Output scanning hook (Stop)
  const outputScanHook = `#!/bin/bash
# AgentBoot compliance hook — output scanning (AB-60)
# Event: Stop
# Generated by AgentBoot. Do not edit manually.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
RESPONSE=$(printf '%s' "$INPUT" | jq -r '.response // empty') || exit 0

# Scan for accidental credential exposure in output
PATTERNS=(
  'AKIA[A-Z0-9]{16}'
  'sk-[a-zA-Z0-9]{20,}'
  'ghp_[a-zA-Z0-9]{36}'
  'eyJ[a-zA-Z0-9_-]{10,}\\.eyJ'
  'xox[bp]-[a-zA-Z0-9-]+'
  'sk_live_[a-zA-Z0-9]+'
  'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'
)

for pattern in "\${PATTERNS[@]}"; do
  if printf '%s' "$RESPONSE" | grep -qiE "$pattern"; then
    echo "AgentBoot WARNING: Potential credential in output — review before sharing" >&2
  fi
done

exit 0
`;

  // AB-63: Audit trail hook (SubagentStart/Stop, PostToolUse, SessionEnd)
  // S1 fix: use jq for safe JSON construction (no shell interpolation)
  // S2 fix: validate and sanitize telemetry.logPath
  let rawLogPath = config.telemetry?.logPath ?? "$HOME/.agentboot/telemetry.ndjson";
  // Normalize ~ to $HOME (~ is not expanded inside bash variable defaults)
  rawLogPath = rawLogPath.replace(/^~\//, "$HOME/");
  // Always reject path traversal
  if (/\.\./.test(rawLogPath)) {
    log(chalk.red(`  ✗ telemetry.logPath contains path traversal: ${rawLogPath}`));
    log(chalk.red(`    Use a simple path like ~/.agentboot/telemetry.ndjson`));
    process.exit(1);
  }
  // Reject shell metacharacters, exempting only a leading $HOME
  const pathWithoutHome = rawLogPath.replace(/^\$HOME/, "");
  if (/[`$|;&\n]/.test(pathWithoutHome)) {
    log(chalk.red(`  ✗ telemetry.logPath contains unsafe shell characters: ${rawLogPath}`));
    log(chalk.red(`    Use a simple path like ~/.agentboot/telemetry.ndjson`));
    process.exit(1);
  }

  const includeDevId = config.telemetry?.includeDevId ?? false;

  let devIdBlock = "";
  if (includeDevId === "hashed" || includeDevId === "email") {
    if (includeDevId === "email") {
      log(chalk.yellow(`  ⚠ telemetry.includeDevId "email" now defaults to hashed for privacy.`));
      log(chalk.yellow(`    Use "email-raw" to explicitly include raw emails (not recommended).`));
    }
    devIdBlock = `DEV_ID=$(git config user.email 2>/dev/null | shasum -a 256 | cut -d' ' -f1)`;
  } else if (includeDevId === "email-raw") {
    log(chalk.yellow(`  ⚠ telemetry.includeDevId is "email-raw" — raw emails will be in telemetry logs.`));
    log(chalk.yellow(`    Consider "hashed" for privacy compliance (GDPR, data minimization).`));
    devIdBlock = `DEV_ID=$(git config user.email 2>/dev/null || echo "unknown")`;
  } else {
    devIdBlock = `DEV_ID=""`;
  }

  const auditTrailHook = `#!/bin/bash
# AgentBoot audit trail hook (AB-63)
# Events: SubagentStart, SubagentStop, PostToolUse, SessionEnd
# Generated by AgentBoot. Do not edit manually.

command -v jq >/dev/null 2>&1 || exit 0

TELEMETRY_LOG="\${AGENTBOOT_TELEMETRY_LOG:-${rawLogPath}}"
umask 077
mkdir -p "$(dirname "$TELEMETRY_LOG")"

INPUT=$(cat)
EVENT_NAME=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
${devIdBlock}

# Use jq for safe JSON construction — prevents shell injection via agent_type/tool_name
case "$EVENT_NAME" in
  SubagentStart)
    printf '%s' "$INPUT" | jq -c --arg ts "$TIMESTAMP" --arg status "started" --arg dev "$DEV_ID" \\
      '{event:"persona_invocation",persona_id:.agent_type,timestamp:$ts,status:$status,dev_id:$dev}' >> "$TELEMETRY_LOG"
    ;;
  SubagentStop)
    printf '%s' "$INPUT" | jq -c --arg ts "$TIMESTAMP" --arg status "completed" --arg dev "$DEV_ID" \\
      '{event:"persona_invocation",persona_id:.agent_type,timestamp:$ts,status:$status,dev_id:$dev}' >> "$TELEMETRY_LOG"
    ;;
  PostToolUse)
    printf '%s' "$INPUT" | jq -c --arg ts "$TIMESTAMP" --arg dev "$DEV_ID" \\
      '{event:"hook_execution",persona_id:.agent_type,tool_name:.tool_name,timestamp:$ts,dev_id:$dev}' >> "$TELEMETRY_LOG"
    ;;
  SessionEnd)
    jq -n -c --arg ts "$TIMESTAMP" --arg dev "$DEV_ID" \\
      '{event:"session_summary",timestamp:$ts,dev_id:$dev}' >> "$TELEMETRY_LOG"
    ;;
esac

exit 0
`;

  // AB-122: PreToolUse compliance hook — block denied tool patterns
  const denyTools = config.managed?.guardrails?.denyTools ?? [];
  let preToolUseHook = "";
  if (denyTools.length > 0) {
    const patterns = denyTools.map(p => `  '${p.replace(/'/g, "'\\''")}'`).join("\n");
    preToolUseHook = `#!/bin/bash
# AgentBoot compliance hook — PreToolUse tool blocking (AB-122)
# Event: PreToolUse
# Generated by AgentBoot. Do not edit manually.

set -uo pipefail
# Fail-closed: if jq is missing, block the tool (compliance requires enforcement)
command -v jq >/dev/null 2>&1 || { echo '{"decision":"block","reason":"AgentBoot: jq required for compliance hooks"}'; exit 2; }

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty') || { echo '{"decision":"block","reason":"AgentBoot: Failed to parse hook input"}'; exit 2; }

DENY_PATTERNS=(
${patterns}
)

for pattern in "\${DENY_PATTERNS[@]}"; do
  if [[ "$TOOL_NAME" == "$pattern" ]]; then
    echo "{\\"decision\\":\\"block\\",\\"reason\\":\\"AgentBoot: Tool \\\\\\"$TOOL_NAME\\\\\\" is blocked by organization policy.\\"}"
    exit 2
  fi
done

exit 0
`;
    fs.writeFileSync(path.join(hooksDir, "agentboot-pretooluse.sh"), preToolUseHook, { mode: 0o755 });
  }

  fs.writeFileSync(path.join(hooksDir, "agentboot-input-scan.sh"), inputScanHook, { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, "agentboot-output-scan.sh"), outputScanHook, { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, "agentboot-telemetry.sh"), auditTrailHook, { mode: 0o755 });

  // Also generate the plugin hooks
  const pluginHooksDir = path.join(distPath, "plugin", "hooks");
  if (fs.existsSync(path.join(distPath, "plugin"))) {
    ensureDir(pluginHooksDir);
    fs.writeFileSync(path.join(pluginHooksDir, "agentboot-input-scan.sh"), inputScanHook, { mode: 0o755 });
    fs.writeFileSync(path.join(pluginHooksDir, "agentboot-output-scan.sh"), outputScanHook, { mode: 0o755 });
    fs.writeFileSync(path.join(pluginHooksDir, "agentboot-telemetry.sh"), auditTrailHook, { mode: 0o755 });
    if (preToolUseHook) {
      fs.writeFileSync(path.join(pluginHooksDir, "agentboot-pretooluse.sh"), preToolUseHook, { mode: 0o755 });
    }
  }

  const hookList = denyTools.length > 0
    ? "input-scan, output-scan, telemetry, pretooluse"
    : "input-scan, output-scan, telemetry";
  log(chalk.gray(`  → Compliance hooks written (${hookList})`));
}

// ---------------------------------------------------------------------------
// AB-59/60/63: Generate settings.json hooks entries for compliance
// ---------------------------------------------------------------------------

function generateComplianceSettingsJson(
  _config: AgentBootConfig,
  distPath: string,
  scopePath: string
): void {
  // Read existing settings.json if any, merge compliance hooks into it
  const settingsPath = path.join(distPath, "claude", scopePath, "settings.json");
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch { /* start fresh */ }
  }

  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown>;

  // B1 fix: append compliance hooks instead of overwriting user-defined hooks
  const appendHook = (event: string, entry: unknown) => {
    hooks[event] = [
      ...(Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []),
      entry,
    ];
  };

  // AB-59: Input scanning
  appendHook("UserPromptSubmit", {
    matcher: "",
    hooks: [{ type: "command", command: ".claude/hooks/agentboot-input-scan.sh", timeout: 5000 }],
  });

  // AB-60: Output scanning
  appendHook("Stop", {
    matcher: "",
    hooks: [{ type: "command", command: ".claude/hooks/agentboot-output-scan.sh", timeout: 5000, async: true }],
  });

  // AB-63: Audit trail
  appendHook("SubagentStart", {
    matcher: "",
    hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
  });
  appendHook("SubagentStop", {
    matcher: "",
    hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
  });
  appendHook("PostToolUse", {
    matcher: "Edit|Write|Bash",
    hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
  });
  // B3 fix: register SessionEnd (matches the case in telemetry hook script)
  appendHook("SessionEnd", {
    matcher: "",
    hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
  });

  // AB-122: PreToolUse compliance hook (only if denyTools configured)
  if ((_config.managed?.guardrails?.denyTools ?? []).length > 0) {
    appendHook("PreToolUse", {
      matcher: "",
      hooks: [{ type: "command", command: ".claude/hooks/agentboot-pretooluse.sh", timeout: 5000 }],
    });
  }

  settings["hooks"] = hooks;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// AB-64: Telemetry NDJSON schema file
// ---------------------------------------------------------------------------

function generateTelemetrySchema(distPath: string): void {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://agentboot.dev/schema/telemetry-event/v1",
    title: "AgentBoot Telemetry Event",
    type: "object",
    required: ["event", "persona_id", "timestamp"],
    properties: {
      event: {
        type: "string",
        enum: ["persona_invocation", "persona_error", "hook_execution", "session_summary"],
        description: "Event type",
      },
      persona_id: { type: "string", description: "Persona identifier" },
      persona_version: { type: "string", description: "Persona version" },
      model: { type: "string", description: "Model used" },
      scope: { type: "string", description: "Scope path: 'org:group:team'" },
      input_tokens: { type: "integer" },
      output_tokens: { type: "integer" },
      thinking_tokens: { type: "integer" },
      tool_calls: { type: "integer" },
      duration_ms: { type: "integer" },
      cost_usd: { type: "number" },
      findings_count: {
        type: "object",
        properties: {
          CRITICAL: { type: "integer" },
          ERROR: { type: "integer" },
          WARN: { type: "integer" },
          INFO: { type: "integer" },
        },
      },
      suggestions: { type: "integer" },
      timestamp: { type: "string", format: "date-time" },
      session_id: { type: "string" },
      dev_id: { type: "string", description: "Developer identifier (hashed or email per config)" },
      status: { type: "string", enum: ["started", "completed", "error"] },
      tool_name: { type: "string", description: "Tool name for hook_execution events" },
    },
  };

  const schemaDir = path.join(distPath, "schema");
  ensureDir(schemaDir);
  fs.writeFileSync(
    path.join(schemaDir, "telemetry-event.v1.json"),
    JSON.stringify(schema, null, 2) + "\n",
    "utf-8"
  );
  log(chalk.gray(`  → Telemetry schema written to dist/schema/`));
}

// ---------------------------------------------------------------------------
// AB-61: Managed settings artifact generation
// ---------------------------------------------------------------------------

function generateManagedSettings(config: AgentBootConfig, distPath: string): void {
  const managed = config.managed;
  if (!managed?.enabled) return;

  log(chalk.cyan("\nGenerating managed settings..."));

  const managedDir = path.join(distPath, "managed");
  ensureDir(managedDir);

  // Managed settings carry HARD guardrails only
  const managedSettings: Record<string, unknown> = {};

  // Permissions: deny dangerous tools
  if (managed.guardrails?.denyTools && managed.guardrails.denyTools.length > 0) {
    managedSettings["permissions"] = {
      deny: managed.guardrails.denyTools,
    };
  }

  // Force audit logging
  if (managed.guardrails?.requireAuditLog) {
    managedSettings["hooks"] = {
      SubagentStart: [
        {
          matcher: "",
          hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
        },
      ],
      SubagentStop: [
        {
          matcher: "",
          hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh", timeout: 3000, async: true }],
        },
      ],
    };
  }

  fs.writeFileSync(
    path.join(managedDir, "managed-settings.json"),
    JSON.stringify(managedSettings, null, 2) + "\n",
    "utf-8"
  );

  // Managed CLAUDE.md (minimal, HARD guardrails only)
  const managedClaudeMd = [
    `# ${config.orgDisplayName ?? config.org} — Managed Configuration`,
    "",
    "<!-- Managed by IT. Do not modify. -->",
    "",
    "This configuration is enforced by your organization's IT policy.",
    "Contact your platform team for changes.",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(managedDir, "CLAUDE.md"), managedClaudeMd, "utf-8");

  // MCP config if needed
  if (config.claude?.mcpServers) {
    fs.writeFileSync(
      path.join(managedDir, "managed-mcp.json"),
      JSON.stringify({ mcpServers: config.claude.mcpServers }, null, 2) + "\n",
      "utf-8"
    );
  }

  // Output path guidance
  const platformPaths: Record<string, string> = {
    jamf: "/Library/Application Support/Claude/",
    intune: "C:\\ProgramData\\Claude\\",
    jumpcloud: "/etc/claude-code/",
    kandji: "/Library/Application Support/Claude/",
    other: "./managed-output/",
  };
  const platform = managed.platform ?? "other";
  const targetPath = platformPaths[platform] ?? platformPaths["other"];

  log(chalk.gray(`  → Managed settings written to dist/managed/`));
  log(chalk.gray(`  → Target MDM path: ${targetPath}`));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const configPath = resolveConfigPath(argv, ROOT);

  log(chalk.bold("\nAgentBoot — compile"));
  log(chalk.gray(`Config: ${configPath}\n`));

  const config = loadConfig(configPath);
  const configDir = path.dirname(configPath);

  const distPath = path.resolve(
    configDir,
    config.output?.distPath ?? "./dist"
  );

  // Optional: fail on dirty dist.
  if (config.output?.failOnDirtyDist && fs.existsSync(distPath)) {
    const entries = fs.readdirSync(distPath);
    if (entries.length > 0) {
      fatal(
        `dist/ is not empty and failOnDirtyDist is enabled. Run: rm -rf ${distPath}`
      );
    }
  }

  ensureDir(distPath);

  const coreDir = path.join(ROOT, "core");
  const coreLexiconDir = path.join(coreDir, "lexicon");
  const corePersonasDir = path.join(coreDir, "personas");
  const coreTraitsDir = path.join(coreDir, "traits");
  const coreInstructionsDir = path.join(coreDir, "instructions");

  const validFormats = ["skill", "claude", "copilot", "cursor", "agents", "plugin"];
  const outputFormats = config.personas?.outputFormats ?? ["skill", "claude", "copilot"];
  const unknownFormats = outputFormats.filter((f) => !validFormats.includes(f));
  if (unknownFormats.length > 0) {
    console.error(chalk.red(`Unknown output format(s): ${unknownFormats.join(", ")}. Valid: ${validFormats.join(", ")}`));
    process.exit(1);
  }

  // AB-88: Resolve N-tier scope tree
  // B13 fix: warn if both groups and nodes defined
  if (config.groups && config.nodes) {
    log(chalk.yellow("  ⚠ Both 'groups' and 'nodes' defined — 'nodes' takes precedence. Remove 'groups' to suppress this warning."));
  }
  const scopeNodes = config.nodes
    ? config.nodes
    : config.groups
      ? groupsToNodes(config.groups)
      : undefined;

  // Load lexicon (first — other artifacts reference lexicon terms).
  const lexiconEntries = loadLexicon(coreLexiconDir);
  if (lexiconEntries.length > 0) {
    log(chalk.cyan(`Lexicon loaded: ${lexiconEntries.length} term(s)`));
    for (const entry of lexiconEntries) {
      log(chalk.gray(`  + ${entry.term}`));
    }
  }

  // Load traits.
  const enabledTraits = config.traits?.enabled;
  const traits = loadTraits(coreTraitsDir, enabledTraits);

  log(chalk.cyan(`Traits loaded: ${traits.size}`));
  for (const name of traits.keys()) {
    log(chalk.gray(`  + ${name}`));
  }
  log(chalk.cyan(`Output formats: ${outputFormats.join(", ")}`));
  log("");

  const enabledPersonas = config.personas?.enabled;

  // Discover persona directories.
  const personaDirs = new Map<string, string>();

  if (fs.existsSync(corePersonasDir)) {
    for (const entry of fs.readdirSync(corePersonasDir)) {
      const dir = path.join(corePersonasDir, entry);
      if (fs.statSync(dir).isDirectory()) {
        personaDirs.set(entry, dir);
      }
    }
  }

  if (config.personas?.customDir) {
    const extendDir = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(extendDir)) {
      for (const entry of fs.readdirSync(extendDir)) {
        const dir = path.join(extendDir, entry);
        if (fs.statSync(dir).isDirectory()) {
          if (personaDirs.has(entry)) {
            log(chalk.yellow(`  ⚠ Extension persona overrides core: ${entry}`));
          }
          personaDirs.set(entry, dir);
        }
      }
    } else {
      log(chalk.yellow(`  ⚠ Extension path not found: ${extendDir}`));
    }
  }

  const allResults: CompileResult[] = [];

  // ---------------------------------------------------------------------------
  // 1. Compile core personas → dist/{platform}/core/{persona}/
  // ---------------------------------------------------------------------------

  log(chalk.cyan("Compiling core personas..."));

  for (const [personaName, personaDir] of personaDirs) {
    if (enabledPersonas && !enabledPersonas.includes(personaName)) {
      log(chalk.gray(`  - ${personaName} (disabled)`));
      continue;
    }

    const result = compilePersona(
      personaName,
      personaDir,
      traits,
      config,
      distPath,
      "core"              // scopePath → dist/{platform}/core/{persona}/
    );

    allResults.push(result);

    const traitsNote =
      result.traitsInjected.length > 0
        ? chalk.gray(` [traits: ${result.traitsInjected.join(", ")}]`)
        : chalk.gray(" [no traits]");
    log(`  ${chalk.green("✓")} ${personaName}${traitsNote}`);
  }

  // Compile always-on instructions.
  compileInstructions(
    coreInstructionsDir,
    config.instructions?.enabled,
    distPath,
    "core",
    config,
    outputFormats
  );

  // AB-52: Compile gotchas (path-scoped knowledge rules)
  const coreGotchasDir = path.join(coreDir, "gotchas");
  compileGotchas(coreGotchasDir, distPath, "core", config, outputFormats);

  // Collect instruction file names (shared by Claude and AGENTS.md output)
  const instrFileNames: string[] = [];
  if (fs.existsSync(coreInstructionsDir)) {
    const instrFiles = fs.readdirSync(coreInstructionsDir).filter((f) => f.endsWith(".md"));
    for (const file of instrFiles) {
      const name = path.basename(file, ".md");
      if (!config.instructions?.enabled || config.instructions.enabled.includes(name)) {
        instrFileNames.push(name);
      }
    }
  }

  // AB-19/26/27: Claude-specific output (CLAUDE.md, settings.json, .mcp.json)
  if (outputFormats.includes("claude")) {
    // Collect persona configs for welcome fragment (AB-77)
    const personaConfigs = new Map<string, PersonaConfig>();
    for (const [personaName, personaDir] of personaDirs) {
      if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
      const pc = loadPersonaConfig(personaDir);
      if (pc) personaConfigs.set(personaName, pc);
    }

    generateClaudeMd(
      [...traits.keys()],
      traits,
      instrFileNames,
      config,
      distPath,
      "core",
      personaConfigs,
      lexiconEntries
    );

    generateSettingsJson(config, distPath, "core");
    generateMcpJson(config, distPath, "core");

    // AB-111: Generate managed-settings.d/ scope fragments
    // Alphabetical naming for scope precedence: 00-org wins over 10-group wins over 20-team
    if (config.managed || config.claude?.permissions || config.claude?.hooks) {
      const managedDir = path.join(distPath, "claude", "core", "managed-settings.d");
      ensureDir(managedDir);
      const fragment: Record<string, unknown> = {};
      if (config.claude?.permissions) fragment["permissions"] = config.claude.permissions;
      if (config.claude?.hooks) fragment["hooks"] = config.claude.hooks;
      if (config.managed) {
        if (config.managed.guardrails?.disableBypassPermissions) {
          fragment["disableBypassPermissionsMode"] = "disable";
        }
      }
      if (Object.keys(fragment).length > 0) {
        fs.writeFileSync(
          path.join(managedDir, "00-org.json"),
          JSON.stringify(fragment, null, 2) + "\n",
          "utf-8"
        );
      }
    }
  }

  // AGENTS.md — universal cross-tool output (always generated if format enabled)
  if (outputFormats.includes("agents")) {
    log(chalk.cyan("\nGenerating AGENTS.md..."));
    const personaConfigs = new Map<string, PersonaConfig>();
    for (const [personaName, personaDir] of personaDirs) {
      if (enabledPersonas && !enabledPersonas.includes(personaName)) continue;
      const pc = loadPersonaConfig(personaDir);
      if (pc) personaConfigs.set(personaName, pc);
    }
    generateAgentsMd(config, distPath, personaConfigs, instrFileNames, lexiconEntries, coreInstructionsDir);
    log(chalk.green("  AGENTS.md generated"));
  }

  // Generate composition manifests for core scope (all platforms)
  for (const fmt of outputFormats) {
    if (fmt === "agents" || fmt === "plugin") continue; // No scope merging for these
    generateCompositionManifest(distPath, fmt, "core", config);
  }

  // ---------------------------------------------------------------------------
  // 2. Compile scope nodes (AB-88: N-tier replaces flat groups/teams)
  //    Also provides backward compat with legacy groups/teams config.
  // ---------------------------------------------------------------------------

  if (scopeNodes) {
    log(chalk.cyan("\nCompiling scope nodes..."));
    const flatNodes = flattenNodes(scopeNodes);
    let nodePersonasFound = false;

    for (const { path: nodePath } of flatNodes) {
      // Look for personas at nodes/{path}/personas/
      const nodePersonasDir = path.join(ROOT, "nodes", nodePath, "personas");

      // Also check legacy paths: groups/{name}/personas/ and teams/{group}/{team}/personas/
      const parts = nodePath.split("/");
      const legacyGroupDir = parts.length === 1
        ? path.join(ROOT, "groups", parts[0]!, "personas")
        : undefined;
      const legacyTeamDir = parts.length === 2
        ? path.join(ROOT, "teams", parts[0]!, parts[1]!, "personas")
        : undefined;

      const personasDir = fs.existsSync(nodePersonasDir)
        ? nodePersonasDir
        : legacyGroupDir && fs.existsSync(legacyGroupDir)
          ? legacyGroupDir
          : legacyTeamDir && fs.existsSync(legacyTeamDir)
            ? legacyTeamDir
            : null;

      if (!personasDir) continue;

      nodePersonasFound = true;
      const nodePersonaDirs = fs.readdirSync(personasDir).filter((entry) =>
        fs.statSync(path.join(personasDir, entry)).isDirectory()
      );

      for (const personaName of nodePersonaDirs) {
        if (enabledPersonas && !enabledPersonas.includes(personaName)) {
          continue;
        }

        const personaDir = path.join(personasDir, personaName);
        // Use first part as group name, second as team name for trait resolution
        const groupName = parts[0];
        const teamName = parts.length >= 2 ? parts[parts.length - 1] : undefined;

        const result = compilePersona(
          personaName,
          personaDir,
          traits,
          config,
          distPath,
          `nodes/${nodePath}`,
          groupName,
          teamName
        );
        allResults.push(result);
        log(`  ${chalk.green("✓")} ${nodePath}/${personaName}`);
      }
    }

    if (!nodePersonasFound) {
      log(chalk.gray("  (no node-level overrides found)"));
    }

    // Generate composition manifests for scope nodes
    for (const { path: nodePath } of flatNodes) {
      for (const fmt of outputFormats) {
        if (fmt === "agents" || fmt === "plugin") continue;
        generateCompositionManifest(distPath, fmt, `nodes/${nodePath}`, config);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2b. AB-53: Compile domain layers
  // ---------------------------------------------------------------------------

  const domainResults = compileDomains(config, configDir, distPath, traits, outputFormats);
  allResults.push(...domainResults);

  // ---------------------------------------------------------------------------
  // 4. Generate PERSONAS.md index in each platform
  // ---------------------------------------------------------------------------

  generatePersonasIndex(allResults, config, corePersonasDir, distPath, "core", outputFormats);
  log(chalk.gray("\n  → PERSONAS.md written to each platform"));

  // ---------------------------------------------------------------------------
  // 5. AB-57: Plugin output generation
  // ---------------------------------------------------------------------------

  // B5 fix: Only generate plugin output when claude format is active (plugin is always derived from claude)
  if (outputFormats.includes("claude")) {
    generatePluginOutput(config, distPath, allResults, corePersonasDir, traits);
  }

  // ---------------------------------------------------------------------------
  // 6. AB-59/60/63: Compliance & audit trail hooks
  // ---------------------------------------------------------------------------

  if (outputFormats.includes("claude")) {
    generateComplianceHooks(config, distPath, "core");
    generateComplianceSettingsJson(config, distPath, "core");
  }

  // ---------------------------------------------------------------------------
  // 7. AB-64: Telemetry NDJSON schema
  // ---------------------------------------------------------------------------

  generateTelemetrySchema(distPath);

  // ---------------------------------------------------------------------------
  // 8. AB-61: Managed settings
  // ---------------------------------------------------------------------------

  generateManagedSettings(config, distPath);

  // ---------------------------------------------------------------------------
  // 9. AB-25: Token budget estimation
  // ---------------------------------------------------------------------------

  const tokenBudget = config.output?.tokenBudget?.warnAt ?? 8000;
  log(chalk.cyan("\nToken estimates:"));

  for (const result of allResults.filter((r) => r.platforms.length > 0)) {
    const skillPath = path.join(distPath, "skill", "core", result.persona, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, "utf-8");
      const estimatedTokens = Math.ceil(content.length / 4);

      if (estimatedTokens > tokenBudget) {
        log(
          chalk.yellow(
            `  ⚠ [${result.persona}] estimated ${estimatedTokens} tokens (budget: ${tokenBudget})`
          )
        );
      } else {
        log(chalk.gray(`  ${result.persona}: ~${estimatedTokens} tokens`));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const successCount = allResults.filter((r) => r.platforms.length > 0).length;

  log(
    chalk.bold(
      `\n${chalk.green("✓")} Compiled ${successCount} persona(s) × ${outputFormats.length} platform(s) → ${path.relative(ROOT, distPath)}/`
    )
  );
  for (const fmt of outputFormats) {
    log(chalk.gray(`  → dist/${fmt}/`));
  }
}

try {
  main();
} catch (err: unknown) {
  console.error(chalk.red("Unexpected error:"), err);
  process.exit(1);
}
