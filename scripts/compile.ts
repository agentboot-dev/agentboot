/**
 * AgentBoot compile script.
 *
 * Reads agentboot.config.json, traverses core/traits/ and core/personas/,
 * composes each persona by inlining trait content at marked positions in
 * each SKILL.md, and writes output to dist/.
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
import { glob } from "glob";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function resolveConfigPath(argv: string[]): string {
  const idx = argv.indexOf("--config");
  if (idx !== -1 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]!);
  }
  return path.join(ROOT, "agentboot.config.json");
}

/**
 * Strip single-line // comments from a JSONC string, respecting string literals.
 * A naive line-level regex would incorrectly strip // inside URLs or regex patterns
 * that appear as JSON string values. This parser tracks whether we are inside a
 * quoted string (handling escaped quotes) before deciding to truncate a line.
 */
function stripJsoncComments(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    let inString = false;
    let i = 0;
    let out = "";

    while (i < line.length) {
      const ch = line[i]!;

      if (inString) {
        out += ch;
        if (ch === "\\" && i + 1 < line.length) {
          // Escaped character — consume the next char verbatim.
          i++;
          out += line[i]!;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
          out += ch;
        } else if (ch === "/" && line[i + 1] === "/") {
          // Single-line comment outside a string — truncate here.
          break;
        } else {
          out += ch;
        }
      }
      i++;
    }

    result.push(out.trimEnd());
  }

  return result.join("\n");
}

function loadConfig(configPath: string): AgentBootConfig {
  if (!fs.existsSync(configPath)) {
    fatal(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const stripped = stripJsoncComments(raw);
  try {
    return JSON.parse(stripped) as AgentBootConfig;
  } catch (err) {
    fatal(`Failed to parse config: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentBootConfig {
  org: string;
  orgDisplayName?: string;
  groups?: Record<string, GroupConfig>;
  personas?: {
    enabled?: string[];
    extend?: string;
    outputFormats?: string[];
  };
  traits?: {
    enabled?: string[];
  };
  instructions?: {
    enabled?: string[];
  };
  output?: {
    distPath?: string;
    provenanceHeaders?: boolean;
    failOnDirtyDist?: boolean;
  };
}

interface GroupConfig {
  label?: string;
  teams?: string[];
  traitsEnabled?: string[];
}

interface PersonaConfig {
  name: string;
  description: string;
  invocation?: string;
  traits?: string[];
  groups?: Record<string, { traits?: string[] }>;
  teams?: Record<string, { traits?: string[] }>;
}

interface TraitContent {
  name: string;
  content: string;
  filePath: string;
}

interface CompileResult {
  persona: string;
  outputFiles: string[];
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

    // If a restricted list is given, only load enabled traits.
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

function injectTraits(
  skillContent: string,
  traitNames: string[],
  traits: Map<string, TraitContent>,
  personaName: string
): { result: string; injected: string[] } {
  const injected: string[] = [];
  const missing: string[] = [];

  // Build the injected block content.
  const blocks: string[] = [];
  for (const traitName of traitNames) {
    const trait = traits.get(traitName);
    if (!trait) {
      missing.push(traitName);
      continue;
    }
    injected.push(traitName);
    blocks.push(
      `<!-- trait: ${traitName} -->\n${trait.content}\n<!-- /trait: ${traitName} -->`
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

  // If the SKILL.md already has markers, replace the content between them.
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

  // No markers — append the traits block at the end.
  return {
    result: `${skillContent.trimEnd()}\n\n${TRAITS_START_MARKER}${injectedBlock}${TRAITS_END_MARKER}\n`,
    injected,
  };
}

// ---------------------------------------------------------------------------
// Persona compilation
// ---------------------------------------------------------------------------

function compilePersona(
  personaName: string,
  personaDir: string,
  traits: Map<string, TraitContent>,
  config: AgentBootConfig,
  outputDir: string,
  scope: "core" | "group" | "team",
  groupName?: string,
  teamName?: string
): CompileResult {
  const skillPath = path.join(personaDir, "SKILL.md");

  if (!fs.existsSync(skillPath)) {
    log(chalk.yellow(`  ⚠ [${personaName}] No SKILL.md found — skipping`));
    return { persona: personaName, outputFiles: [], traitsInjected: [], scope };
  }

  const personaConfig = loadPersonaConfig(personaDir);
  const skillContent = fs.readFileSync(skillPath, "utf-8");

  // Determine which traits to inject.
  // Priority: team-level traits > group-level traits > persona default traits
  let traitNames: string[] = personaConfig?.traits ?? [];

  if (groupName && personaConfig?.groups?.[groupName]?.traits) {
    traitNames = [...traitNames, ...(personaConfig.groups[groupName]!.traits ?? [])];
  }

  if (teamName && personaConfig?.teams?.[teamName]?.traits) {
    traitNames = [...traitNames, ...(personaConfig.teams[teamName]!.traits ?? [])];
  }

  // Deduplicate while preserving order.
  traitNames = [...new Set(traitNames)];

  const { result: composed, injected } = injectTraits(
    skillContent,
    traitNames,
    traits,
    personaName
  );

  // Prepend provenance header if enabled.
  const provenanceEnabled = config.output?.provenanceHeaders !== false;
  const finalContent = provenanceEnabled
    ? `${provenanceHeader(skillPath, config)}${composed}`
    : composed;

  // Write SKILL.md.
  const outputDir_ = path.join(outputDir, personaName);
  ensureDir(outputDir_);

  const outputFiles: string[] = [];

  const outputFormats = config.personas?.outputFormats ?? ["skill", "claude", "copilot"];

  if (outputFormats.includes("skill")) {
    const outPath = path.join(outputDir_, "SKILL.md");
    fs.writeFileSync(outPath, finalContent, "utf-8");
    outputFiles.push(outPath);
  }

  if (outputFormats.includes("claude")) {
    const claudeContent = buildClaudeFragment(personaName, personaConfig, finalContent, config);
    const outPath = path.join(outputDir_, "CLAUDE.md");
    fs.writeFileSync(outPath, claudeContent, "utf-8");
    outputFiles.push(outPath);
  }

  if (outputFormats.includes("copilot")) {
    const copilotContent = buildCopilotFragment(personaName, personaConfig, finalContent, config);
    const outPath = path.join(outputDir_, "copilot-instructions.md");
    fs.writeFileSync(outPath, copilotContent, "utf-8");
    outputFiles.push(outPath);
  }

  // Copy persona.config.json if present.
  const personaConfigPath = path.join(personaDir, "persona.config.json");
  if (fs.existsSync(personaConfigPath)) {
    fs.copyFileSync(personaConfigPath, path.join(outputDir_, "persona.config.json"));
  }

  return { persona: personaName, outputFiles, traitsInjected: injected, scope };
}

// ---------------------------------------------------------------------------
// Output format builders
// ---------------------------------------------------------------------------

function buildClaudeFragment(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  config: AgentBootConfig
): string {
  const invocation = personaConfig?.invocation ?? `/${personaName}`;
  const description = personaConfig?.description ?? "";
  const header = `# ${personaConfig?.name ?? personaName}\n\n`;
  const invocationBlock = `**Invocation:** \`${invocation}\`\n\n`;
  const descBlock = description ? `${description}\n\n---\n\n` : "";
  return `${provenanceHeader(personaName, config)}${header}${invocationBlock}${descBlock}${composedContent}`;
}

function buildCopilotFragment(
  personaName: string,
  personaConfig: PersonaConfig | null,
  composedContent: string,
  config: AgentBootConfig
): string {
  // GitHub Copilot reads copilot-instructions.md as plain Markdown instructions.
  // Strip any SKILL.md-specific frontmatter and emit clean Markdown.
  const header = `# ${personaConfig?.name ?? personaName} (AgentBoot)\n\n`;
  const description = personaConfig?.description
    ? `${personaConfig.description}\n\n---\n\n`
    : "";
  // Strip <!-- ... --> comments from the composed content for Copilot output.
  const stripped = composedContent.replace(/<!--[\s\S]*?-->/g, "").trim();
  return `${provenanceHeader(personaName, config)}${header}${description}${stripped}\n`;
}

// ---------------------------------------------------------------------------
// Always-on instructions compilation
// ---------------------------------------------------------------------------

function compileInstructions(
  instructionsDir: string,
  enabledInstructions: string[] | undefined,
  outputDir: string,
  config: AgentBootConfig
): void {
  if (!fs.existsSync(instructionsDir)) {
    return;
  }

  const files = fs.readdirSync(instructionsDir).filter((f) => f.endsWith(".md"));
  const outDir = path.join(outputDir, "instructions");
  ensureDir(outDir);

  for (const file of files) {
    const name = path.basename(file, ".md");
    if (enabledInstructions && !enabledInstructions.includes(name)) {
      continue;
    }
    const srcPath = path.join(instructionsDir, file);
    const content = fs.readFileSync(srcPath, "utf-8");
    const provenanceEnabled = config.output?.provenanceHeaders !== false;
    const finalContent = provenanceEnabled
      ? `${provenanceHeader(srcPath, config)}${content}`
      : content;
    fs.writeFileSync(path.join(outDir, file), finalContent, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// PERSONAS.md index generation
// ---------------------------------------------------------------------------

function generatePersonasIndex(
  results: CompileResult[],
  config: AgentBootConfig,
  personasBaseDir: string,
  outputDir: string
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

  for (const result of results.filter((r) => r.outputFiles.length > 0)) {
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
  fs.writeFileSync(path.join(outputDir, "PERSONAS.md"), lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const configPath = resolveConfigPath(argv);

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
  const corePersonasDir = path.join(coreDir, "personas");
  const coreTraitsDir = path.join(coreDir, "traits");
  const coreInstructionsDir = path.join(coreDir, "instructions");

  // Determine which traits are available.
  const enabledTraits = config.traits?.enabled;
  const traits = loadTraits(coreTraitsDir, enabledTraits);

  log(chalk.cyan(`Traits loaded: ${traits.size}`));
  for (const name of traits.keys()) {
    log(chalk.gray(`  + ${name}`));
  }
  log("");

  // Determine which personas to compile.
  const enabledPersonas = config.personas?.enabled;

  // Discover all persona directories.
  const personaDirs = new Map<string, string>(); // name → absolute path

  if (fs.existsSync(corePersonasDir)) {
    for (const entry of fs.readdirSync(corePersonasDir)) {
      const dir = path.join(corePersonasDir, entry);
      if (fs.statSync(dir).isDirectory()) {
        personaDirs.set(entry, dir);
      }
    }
  }

  // Merge extension personas (higher specificity wins on name collision).
  if (config.personas?.extend) {
    const extendDir = path.resolve(configDir, config.personas.extend);
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
  // 1. Compile core (studio-wide) personas
  // ---------------------------------------------------------------------------

  log(chalk.cyan("Compiling core personas..."));
  const coreOutputDir = path.join(distPath, "core");
  ensureDir(coreOutputDir);

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
      coreOutputDir,
      "core"
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
    coreOutputDir,
    config
  );

  // ---------------------------------------------------------------------------
  // 2. Compile group-level overrides
  // ---------------------------------------------------------------------------

  if (config.groups) {
    log(chalk.cyan("\nCompiling group-level personas..."));

    for (const [groupName, groupConfig] of Object.entries(config.groups)) {
      const groupPersonasDir = path.join(ROOT, "groups", groupName, "personas");

      if (!fs.existsSync(groupPersonasDir)) {
        // No group-specific persona overrides — this is fine.
        continue;
      }

      const groupOutputDir = path.join(distPath, "groups", groupName);
      ensureDir(groupOutputDir);

      const groupPersonaDirs = fs.readdirSync(groupPersonasDir).filter((entry) =>
        fs.statSync(path.join(groupPersonasDir, entry)).isDirectory()
      );

      for (const personaName of groupPersonaDirs) {
        if (enabledPersonas && !enabledPersonas.includes(personaName)) {
          continue;
        }

        const personaDir = path.join(groupPersonasDir, personaName);
        const result = compilePersona(
          personaName,
          personaDir,
          traits,
          config,
          groupOutputDir,
          "group",
          groupName
        );
        allResults.push(result);
        log(`  ${chalk.green("✓")} ${groupName}/${personaName}`);
      }

      void groupConfig; // suppress unused-variable warning
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Compile team-level overrides
  // ---------------------------------------------------------------------------

  if (config.groups) {
    log(chalk.cyan("\nCompiling team-level personas..."));
    let teamPersonasFound = false;

    for (const [groupName, groupConfig] of Object.entries(config.groups)) {
      const teams = groupConfig.teams ?? [];

      for (const teamName of teams) {
        const teamPersonasDir = path.join(ROOT, "teams", groupName, teamName, "personas");

        if (!fs.existsSync(teamPersonasDir)) {
          continue;
        }

        teamPersonasFound = true;
        const teamOutputDir = path.join(distPath, "teams", groupName, teamName);
        ensureDir(teamOutputDir);

        const teamPersonaDirs = fs.readdirSync(teamPersonasDir).filter((entry) =>
          fs.statSync(path.join(teamPersonasDir, entry)).isDirectory()
        );

        for (const personaName of teamPersonaDirs) {
          if (enabledPersonas && !enabledPersonas.includes(personaName)) {
            continue;
          }

          const personaDir = path.join(teamPersonasDir, personaName);
          const result = compilePersona(
            personaName,
            personaDir,
            traits,
            config,
            teamOutputDir,
            "team",
            groupName,
            teamName
          );
          allResults.push(result);
          log(`  ${chalk.green("✓")} ${groupName}/${teamName}/${personaName}`);
        }
      }
    }

    if (!teamPersonasFound) {
      log(chalk.gray("  (no team-level overrides found)"));
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Generate PERSONAS.md index
  // ---------------------------------------------------------------------------

  generatePersonasIndex(allResults, config, corePersonasDir, coreOutputDir);
  log(chalk.gray("\n  → PERSONAS.md written"));

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const successCount = allResults.filter((r) => r.outputFiles.length > 0).length;
  const fileCount = allResults.reduce((acc, r) => acc + r.outputFiles.length, 0);

  log(
    chalk.bold(
      `\n${chalk.green("✓")} Compiled ${successCount} persona(s), ${fileCount} output file(s) → ${path.relative(ROOT, distPath)}/`
    )
  );
}

main().catch((err: unknown) => {
  console.error(chalk.red("Unexpected error:"), err);
  process.exit(1);
});
