/**
 * AgentBoot validate script.
 *
 * Runs a suite of checks against the AgentBoot source tree and config before
 * a build is allowed to proceed. All checks are independent — every failure
 * is reported before the process exits.
 *
 * Checks:
 *   1. All personas in agentboot.config.json exist in core/personas/
 *   2. All traits referenced in persona configs exist in core/traits/
 *   3. All SKILL.md files have required frontmatter (name, description)
 *   4. No obvious secrets or credentials in trait/persona definitions
 *
 * Usage:
 *   npm run validate
 *   tsx scripts/validate.ts
 *   tsx scripts/validate.ts --config path/to/agentboot.config.json
 *   tsx scripts/validate.ts --strict   (treats warnings as errors)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  type AgentBootConfig,
  type PersonaConfig,
  resolveConfigPath,
  loadConfig,
  stripJsoncComments,
} from "./lib/config.js";
import {
  parseFrontmatter,
  DEFAULT_SECRET_PATTERNS,
  scanForSecrets,
} from "./lib/frontmatter.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  passed: boolean;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function check(name: string): CheckResult {
  return { name, passed: true, warnings: [], errors: [] };
}

function fail(result: CheckResult, msg: string): void {
  result.errors.push(msg);
  result.passed = false;
}

function warn(result: CheckResult, msg: string): void {
  result.warnings.push(msg);
}

function printResult(result: CheckResult, strictMode: boolean): void {
  const effectivePassed = result.passed && (strictMode ? result.warnings.length === 0 : true);

  if (effectivePassed) {
    console.log(`  ${chalk.green("✓")} ${result.name}`);
  } else {
    console.log(`  ${chalk.red("✗")} ${result.name}`);
  }

  for (const err of result.errors) {
    console.log(chalk.red(`      ERROR: ${err}`));
  }

  for (const w of result.warnings) {
    const icon = strictMode ? chalk.red("WARN (strict)") : chalk.yellow("WARN");
    console.log(`      ${icon}: ${w}`);
  }
}

function isEffectiveFail(result: CheckResult, strictMode: boolean): boolean {
  if (!result.passed) return true;
  if (strictMode && result.warnings.length > 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Check 1: Persona existence
// ---------------------------------------------------------------------------

function checkPersonaExistence(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check("Persona existence — all enabled personas found in core/personas/");
  const enabledPersonas = config.personas?.enabled;

  if (!enabledPersonas || enabledPersonas.length === 0) {
    warn(result, "No personas enabled in config. Nothing will be compiled.");
    return result;
  }

  const corePersonasDir = path.join(ROOT, "core", "personas");
  const extendDir = config.personas?.customDir
    ? path.resolve(configDir, config.personas.customDir)
    : null;

  // Collect all available persona directories.
  const available = new Set<string>();

  if (fs.existsSync(corePersonasDir)) {
    for (const entry of fs.readdirSync(corePersonasDir)) {
      if (fs.statSync(path.join(corePersonasDir, entry)).isDirectory()) {
        available.add(entry);
      }
    }
  }

  if (extendDir && fs.existsSync(extendDir)) {
    for (const entry of fs.readdirSync(extendDir)) {
      if (fs.statSync(path.join(extendDir, entry)).isDirectory()) {
        available.add(entry);
      }
    }
  }

  for (const persona of enabledPersonas) {
    if (!available.has(persona)) {
      fail(
        result,
        `Persona "${persona}" is enabled in config but no directory found. ` +
          `Expected: core/personas/${persona}/ or ${config.personas?.customDir ?? "(no extend path)"}/${persona}/`
      );
    }
  }

  if (result.passed) {
    // Also warn about personas that exist but are not enabled.
    const disabled = [...available].filter((p) => !enabledPersonas.includes(p));
    if (disabled.length > 0) {
      warn(result, `Personas in core/ not enabled: ${disabled.join(", ")}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 2: Trait references
// ---------------------------------------------------------------------------

function checkTraitReferences(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check(
    "Trait references — all persona.config.json trait entries exist in core/traits/"
  );

  const coreTraitsDir = path.join(ROOT, "core", "traits");
  const enabledTraits = config.traits?.enabled;

  // Collect available trait names.
  const availableTraits = new Set<string>();
  if (fs.existsSync(coreTraitsDir)) {
    for (const file of fs.readdirSync(coreTraitsDir)) {
      if (file.endsWith(".md")) {
        availableTraits.add(path.basename(file, ".md"));
      }
    }
  }

  if (availableTraits.size === 0) {
    warn(result, "No trait files found in core/traits/. Trait injection will be skipped.");
    return result;
  }

  // Scan all persona.config.json files.
  const personaRoots: string[] = [path.join(ROOT, "core", "personas")];
  if (config.personas?.customDir) {
    const ext = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(ext)) personaRoots.push(ext);
  }

  for (const root of personaRoots) {
    if (!fs.existsSync(root)) continue;

    for (const personaName of fs.readdirSync(root)) {
      const personaDir = path.join(root, personaName);
      if (!fs.statSync(personaDir).isDirectory()) continue;

      const configPath = path.join(personaDir, "persona.config.json");
      if (!fs.existsSync(configPath)) continue;

      let personaConfig: PersonaConfig;
      try {
        personaConfig = JSON.parse(stripJsoncComments(fs.readFileSync(configPath, "utf-8"))) as PersonaConfig;
      } catch {
        fail(result, `[${personaName}] persona.config.json is not valid JSON`);
        continue;
      }

      // Collect all trait references in this persona config.
      const traitRefs = new Set<string>();
      for (const t of personaConfig.traits ?? []) traitRefs.add(t);
      for (const g of Object.values(personaConfig.groups ?? {})) {
        for (const t of g.traits ?? []) traitRefs.add(t);
      }
      for (const tm of Object.values(personaConfig.teams ?? {})) {
        for (const t of tm.traits ?? []) traitRefs.add(t);
      }

      for (const traitRef of traitRefs) {
        if (!availableTraits.has(traitRef)) {
          fail(
            result,
            `[${personaName}] References trait "${traitRef}" which does not exist in core/traits/`
          );
        } else if (enabledTraits && !enabledTraits.includes(traitRef)) {
          warn(
            result,
            `[${personaName}] References trait "${traitRef}" which exists but is not in traits.enabled`
          );
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 3: SKILL.md frontmatter
// ---------------------------------------------------------------------------

function checkSkillFrontmatter(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check("SKILL.md frontmatter — required fields present (name, description)");

  const personaRoots: string[] = [path.join(ROOT, "core", "personas")];
  if (config.personas?.customDir) {
    const ext = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(ext)) personaRoots.push(ext);
  }

  let skillsChecked = 0;

  for (const root of personaRoots) {
    if (!fs.existsSync(root)) continue;

    for (const personaName of fs.readdirSync(root)) {
      const personaDir = path.join(root, personaName);
      if (!fs.statSync(personaDir).isDirectory()) continue;

      const skillPath = path.join(personaDir, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        warn(result, `[${personaName}] No SKILL.md found`);
        continue;
      }

      skillsChecked++;
      const content = fs.readFileSync(skillPath, "utf-8");
      const fields = parseFrontmatter(content);

      if (!fields) {
        fail(
          result,
          `[${personaName}] SKILL.md has no frontmatter block (expected ---\\n...\\n--- at top of file)`
        );
        continue;
      }

      if (!fields.has("name") || fields.get("name") === "") {
        fail(result, `[${personaName}] SKILL.md frontmatter missing required field: name`);
      }
      if (!fields.has("description") || fields.get("description") === "") {
        fail(result, `[${personaName}] SKILL.md frontmatter missing required field: description`);
      }
    }
  }

  if (skillsChecked === 0) {
    warn(result, "No SKILL.md files found. Has the persona directory been populated?");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 4: Secret / credential scan
// ---------------------------------------------------------------------------

/**
 * Detect regex patterns likely to cause catastrophic backtracking.
 * Rejects patterns with nested quantifiers like (a+)+, (a*)*b, etc.
 */
export function isUnsafeRegex(pattern: string): boolean {
  // Reject patterns longer than 200 chars
  if (pattern.length > 200) return true;
  // Reject nested quantifiers: (x+)+, (x*)+, (x+)*, (x{n,})+, etc.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return true;
  // Reject patterns with multiple adjacent overlapping quantifiers
  if (/[+*]{2,}/.test(pattern)) return true;
  return false;
}

export function buildSecretPatterns(config: AgentBootConfig): RegExp[] {
  const configPatterns: RegExp[] = [];
  for (const p of config.validation?.secretPatterns ?? []) {
    if (isUnsafeRegex(p)) {
      console.error(`  ⚠ Rejected secretPattern "${p.slice(0, 50)}..." — potential catastrophic backtracking`);
      continue;
    }
    try {
      configPatterns.push(new RegExp(p));
    } catch (e: unknown) {
      console.error(`  ⚠ Invalid secretPattern regex "${p}": ${e instanceof Error ? e.message : String(e)} — skipping`);
    }
  }
  return [...DEFAULT_SECRET_PATTERNS, ...configPatterns];
}

function checkNoSecrets(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check("Secret scan — no credentials or keys in trait/persona definitions");
  const patterns = buildSecretPatterns(config);

  const scanRoots: string[] = [
    path.join(ROOT, "core", "traits"),
    path.join(ROOT, "core", "personas"),
  ];

  if (config.personas?.customDir) {
    const ext = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(ext)) scanRoots.push(ext);
  }

  for (const root of scanRoots) {
    if (!fs.existsSync(root)) continue;

    // Recursively find all .md and .json files.
    const files = walkDir(root, [".md", ".json"]);

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf-8");
      const hits = scanForSecrets(content, patterns);
      for (const hit of hits) {
        fail(
          result,
          `Potential secret at ${path.relative(ROOT, filePath)}:${hit.line} ` +
            `(matched pattern: ${hit.pattern})`
        );
      }
    }
  }

  return result;
}

function walkDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, extensions));
    } else if (extensions.some((ext) => full.endsWith(ext))) {
      results.push(full);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const configPath = resolveConfigPath(argv, ROOT);
  const forceStrict = argv.includes("--strict");

  console.log(chalk.bold("\nAgentBoot — validate"));
  console.log(chalk.gray(`Config: ${configPath}\n`));

  const config = loadConfig(configPath);
  const configDir = path.dirname(configPath);
  const strictMode = forceStrict || (config.validation?.strictMode ?? false);

  if (strictMode) {
    console.log(chalk.yellow("  ⚑ Strict mode: warnings treated as errors\n"));
  }

  // Run all checks.
  const checks: CheckResult[] = [
    checkPersonaExistence(config, configDir),
    checkTraitReferences(config, configDir),
    checkSkillFrontmatter(config, configDir),
    checkNoSecrets(config, configDir),
  ];

  // Print results.
  for (const c of checks) {
    printResult(c, strictMode);
  }

  // Summary.
  const failures = checks.filter((c) => isEffectiveFail(c, strictMode));
  const warnings = checks.reduce((acc, c) => acc + c.warnings.length, 0);

  console.log("");
  if (failures.length === 0) {
    console.log(
      chalk.bold(
        chalk.green(`✓ All ${checks.length} checks passed`) +
          (warnings > 0 ? chalk.yellow(` (${warnings} warning${warnings > 1 ? "s" : ""})`) : "")
      )
    );
    process.exit(0);
  } else {
    const errorCount = failures.reduce((acc, c) => acc + c.errors.length, 0);
    console.log(
      chalk.bold(
        chalk.red(
          `✗ ${failures.length} check${failures.length > 1 ? "s" : ""} failed ` +
            `(${errorCount} error${errorCount > 1 ? "s" : ""}, ` +
            `${warnings} warning${warnings > 1 ? "s" : ""})`
        )
      )
    );
    process.exit(1);
  }
}

// Only run main() when executed directly, not when imported for testing
const isDirectRun = process.argv[1]?.includes("validate");
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(chalk.red("Unexpected error:"), err);
    process.exit(1);
  });
}
