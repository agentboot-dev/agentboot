#!/usr/bin/env node

/**
 * AgentBoot CLI entry point.
 *
 * Provides the `agentboot` command with subcommands for building, validating,
 * syncing, and managing agentic personas.
 *
 * Usage:
 *   agentboot build [-c config]
 *   agentboot validate [--strict]
 *   agentboot sync [--repos-file path] [--dry-run]
 *   agentboot setup [--skip-detect]
 *   agentboot add <type> <name>
 *   agentboot doctor [--format text|json]
 *   agentboot status [--format text|json]
 *   agentboot lint [--persona name] [--severity level] [--format text|json]
 *   agentboot uninstall [--repo path] [--dry-run]
 *   agentboot config [key] [value]
 *   agentboot <command> --help
 */

import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { createHash } from "node:crypto";
import { loadConfig } from "./lib/config.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPTS_DIR = __dirname;
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Version (read from package.json)
// ---------------------------------------------------------------------------

function getVersion(): string {
  const pkgPath = path.join(ROOT, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Script runner — delegates to existing tsx scripts
// ---------------------------------------------------------------------------

interface RunOptions {
  script: string;
  args: string[];
  verbose?: boolean;
  quiet?: boolean;
}

function runScript({ script, args, verbose, quiet }: RunOptions): never {
  const scriptPath = path.join(SCRIPTS_DIR, script);

  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: script not found: ${scriptPath}`);
    process.exit(1);
  }

  if (verbose) {
    console.log(`→ tsx ${scriptPath} ${args.join(" ")}`);
  }

  const result = spawnSync("npx", ["tsx", scriptPath, ...args], {
    cwd: ROOT,
    stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit",
    env: { ...process.env },
  });

  if (result.error) {
    console.error(`Failed to run script: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect global flags that should be forwarded to scripts. */
function collectGlobalArgs(opts: { config?: string }): string[] {
  const args: string[] = [];
  if (opts.config) {
    args.push("--config", opts.config);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("agentboot")
  .description(
    "Convention over configuration for agentic development teams.\nCompile, validate, and distribute agentic personas.",
  )
  .version(getVersion(), "-v, --version")
  .option("-c, --config <path>", "path to agentboot.config.json")
  .option("--verbose", "show detailed output")
  .option("--quiet", "suppress non-error output");

// ---- build ----------------------------------------------------------------

program
  .command("build")
  .description("Compile traits into persona output files")
  .action((_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const args = collectGlobalArgs({ config: globalOpts.config });

    runScript({
      script: "compile.ts",
      args,
      verbose: globalOpts.verbose,
      quiet: globalOpts.quiet,
    });
  });

// ---- validate -------------------------------------------------------------

program
  .command("validate")
  .description("Run pre-build validation checks")
  .option("--strict", "treat warnings as errors")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const args = collectGlobalArgs({ config: globalOpts.config });

    if (opts.strict) {
      args.push("--strict");
    }

    runScript({
      script: "validate.ts",
      args,
      verbose: globalOpts.verbose,
      quiet: globalOpts.quiet,
    });
  });

// ---- sync -----------------------------------------------------------------

program
  .command("sync")
  .description("Distribute compiled output to target repositories")
  .option("--repos-file <path>", "path to repos.json")
  .option("--dry-run", "preview changes without writing")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const args = collectGlobalArgs({ config: globalOpts.config });

    if (opts.reposFile) {
      args.push("--repos", opts.reposFile);
    }
    if (opts.dryRun) {
      args.push("--dry-run");
    }

    runScript({
      script: "sync.ts",
      args,
      verbose: globalOpts.verbose,
      quiet: globalOpts.quiet,
    });
  });

// ---- dev-sync -------------------------------------------------------------

program
  .command("dev-sync", { hidden: true })
  .description("Copy dist/ to local repo for dogfooding (internal)")
  .action((_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const args = collectGlobalArgs({ config: globalOpts.config });

    runScript({
      script: "dev-sync.ts",
      args,
      verbose: globalOpts.verbose,
      quiet: globalOpts.quiet,
    });
  });

// ---- full-build -----------------------------------------------------------

program
  .command("full-build")
  .description("Run clean → validate → build → dev-sync pipeline")
  .action((_opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const baseArgs = collectGlobalArgs({ config: globalOpts.config });
    const quiet = globalOpts.quiet;

    // Clean
    if (!quiet) console.log("→ clean");
    const distPath = path.join(ROOT, "dist");
    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true, force: true });
    }

    // Validate
    if (!quiet) console.log("→ validate");
    const valResult = spawnSync(
      "npx",
      ["tsx", path.join(SCRIPTS_DIR, "validate.ts"), ...baseArgs],
      { cwd: ROOT, stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit" },
    );
    if (valResult.status !== 0) {
      console.error("Validation failed.");
      process.exit(valResult.status ?? 1);
    }

    // Build
    if (!quiet) console.log("→ build");
    const buildResult = spawnSync(
      "npx",
      ["tsx", path.join(SCRIPTS_DIR, "compile.ts"), ...baseArgs],
      { cwd: ROOT, stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit" },
    );
    if (buildResult.status !== 0) {
      console.error("Build failed.");
      process.exit(buildResult.status ?? 1);
    }

    // Dev-sync
    if (!quiet) console.log("→ dev-sync");
    const syncResult = spawnSync(
      "npx",
      ["tsx", path.join(SCRIPTS_DIR, "dev-sync.ts"), ...baseArgs],
      { cwd: ROOT, stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit" },
    );
    if (syncResult.status !== 0) {
      console.error("Dev-sync failed.");
      process.exit(syncResult.status ?? 1);
    }

    if (!quiet) console.log("✓ full-build complete");
  });

// ---- setup (AB-33) --------------------------------------------------------

program
  .command("setup")
  .description("Interactive setup wizard for new repos")
  .option("--skip-detect", "skip auto-detection")
  .action(async (opts) => {
    const cwd = process.cwd();
    console.log(chalk.bold("\nAgentBoot — setup\n"));

    // Detect existing setup
    if (!opts.skipDetect) {
      const hasConfig = fs.existsSync(path.join(cwd, "agentboot.config.json"));
      const hasClaude = fs.existsSync(path.join(cwd, ".claude"));
      if (hasConfig) {
        console.log(chalk.yellow("  ⚠ agentboot.config.json already exists in this directory."));
        console.log(chalk.gray("  Run `agentboot doctor` to check your configuration.\n"));
        process.exit(0);
      }
      if (hasClaude) {
        console.log(chalk.gray("  Detected existing .claude/ directory."));
      }
    }

    // Detect org from git remote
    let orgName = "my-org";
    try {
      const gitResult = spawnSync("git", ["remote", "get-url", "origin"], {
        cwd,
        encoding: "utf-8",
      });
      if (gitResult.stdout) {
        const match = gitResult.stdout.match(/[/:]([\w-]+)\//);
        if (match) orgName = match[1]!;
      }
    } catch { /* no git, use default */ }

    console.log(chalk.cyan(`  Detected org: ${orgName}`));

    // Scaffold config
    const configContent = JSON.stringify({
      org: orgName,
      orgDisplayName: orgName,
      groups: {},
      personas: {
        enabled: ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"],
        outputFormats: ["skill", "claude", "copilot"],
      },
      traits: {
        enabled: [
          "critical-thinking", "structured-output", "source-citation",
          "confidence-signaling", "audit-trail", "schema-awareness",
        ],
      },
      instructions: { enabled: ["baseline.instructions", "security.instructions"] },
      output: { distPath: "./dist", provenanceHeaders: true, tokenBudget: { warnAt: 8000 } },
      sync: { repos: "./repos.json", dryRun: false },
    }, null, 2);

    fs.writeFileSync(path.join(cwd, "agentboot.config.json"), configContent + "\n", "utf-8");
    console.log(chalk.green("  ✓ Created agentboot.config.json"));

    // Scaffold repos.json if it doesn't exist
    if (!fs.existsSync(path.join(cwd, "repos.json"))) {
      fs.writeFileSync(path.join(cwd, "repos.json"), "[]\n", "utf-8");
      console.log(chalk.green("  ✓ Created repos.json"));
    }

    // Create core directories
    const dirs = ["core/personas", "core/traits", "core/instructions", "core/gotchas"];
    for (const dir of dirs) {
      const fullPath = path.join(cwd, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(chalk.green(`  ✓ Created ${dir}/`));
      }
    }

    console.log(chalk.bold(`\n${chalk.green("✓")} Setup complete.`));
    console.log(chalk.gray("\n  Next steps:"));
    console.log(chalk.gray("    1. Add personas to core/personas/"));
    console.log(chalk.gray("    2. Add traits to core/traits/"));
    console.log(chalk.gray("    3. Run: agentboot build"));
    console.log(chalk.gray("    4. Run: agentboot sync\n"));
  });

// ---- add (AB-34/35/55) ----------------------------------------------------

program
  .command("add")
  .description("Scaffold a new persona, trait, or gotcha")
  .argument("<type>", "what to add: persona, trait, gotcha")
  .argument("<name>", "name for the new item (lowercase-with-hyphens)")
  .action((type: string, name: string) => {
    // Validate name format
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      console.error(chalk.red(`Name must be lowercase alphanumeric with hyphens: got '${name}'`));
      process.exit(1);
    }

    const cwd = process.cwd();

    if (type === "persona") {
      const personaDir = path.join(cwd, "core", "personas", name);
      if (fs.existsSync(personaDir)) {
        console.error(chalk.red(`Persona '${name}' already exists at core/personas/${name}/`));
        process.exit(1);
      }

      fs.mkdirSync(personaDir, { recursive: true });

      // AB-55: Prompt style guide baked into scaffold template
      const skillMd = `---
name: ${name}
description: TODO — one sentence describing this persona's purpose
version: 0.1.0
---

# ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}

## Identity

<!-- One sentence: role + specialization + stance -->

## Setup

<!-- Numbered steps to execute before producing output -->
1. Read the diff, file, or context provided
2. Determine operating mode from arguments

## Rules

<!-- Numbered checklist. Specific, imperative, testable. 20 rules maximum.
     Style guide:
     - Use imperative voice: "Verify that..." not "It should be verified..."
     - Be specific: "Check that every async function has a try/catch" not "Handle errors"
     - Make rules falsifiable — each should be testable as pass/fail
     - Each rule addresses one concern
     - Show examples of violations where possible
     - Cite sources when relevant (e.g., "Per OWASP A03:2021")
     - Include confidence guidance: "Flag as WARN if uncertain, ERROR if confirmed"
-->

1. TODO — First rule

<!-- traits:start -->
<!-- traits:end -->

## Output Format

<!-- Define exact output schema. Include severity levels if this is a reviewer persona.
     Example:
     | Severity | When to use |
     |----------|-------------|
     | CRITICAL | Security vulnerability, data loss risk |
     | ERROR    | Bug that will cause incorrect behavior |
     | WARN     | Code smell, potential issue |
     | INFO     | Suggestion, style preference |
-->

## What Not To Do

<!-- Explicit exclusions and anti-patterns.
     - Do not suggest changes outside the scope of what was requested
     - Do not refactor code that was not asked to be refactored
-->
`;

      const configJson = JSON.stringify({
        name: name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        description: "TODO — one sentence describing this persona's purpose",
        invocation: `/${name}`,
        traits: [],
      }, null, 2);

      fs.writeFileSync(path.join(personaDir, "SKILL.md"), skillMd, "utf-8");
      fs.writeFileSync(path.join(personaDir, "persona.config.json"), configJson + "\n", "utf-8");

      console.log(chalk.bold(`\n${chalk.green("✓")} Created persona: ${name}\n`));
      console.log(chalk.gray(`  core/personas/${name}/`));
      console.log(chalk.gray(`  ├── SKILL.md`));
      console.log(chalk.gray(`  └── persona.config.json\n`));
      console.log(chalk.gray(`  Next: Edit SKILL.md to define your persona's rules.`));
      console.log(chalk.gray(`  Then: agentboot validate && agentboot build\n`));

    } else if (type === "trait") {
      const traitsDir = path.join(cwd, "core", "traits");
      const traitPath = path.join(traitsDir, `${name}.md`);
      if (fs.existsSync(traitPath)) {
        console.error(chalk.red(`Trait '${name}' already exists at core/traits/${name}.md`));
        process.exit(1);
      }

      if (!fs.existsSync(traitsDir)) {
        fs.mkdirSync(traitsDir, { recursive: true });
      }

      const traitMd = `# ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}

## When to Apply

<!-- Describe the activation condition for this trait.
     Example: "When reviewing code that handles authentication or authorization" -->

## What to Do

<!-- Specific behavioral guidance. Use imperative voice.
     Example: "Verify that all authentication checks occur before authorization checks" -->

## What Not to Do

<!-- Anti-patterns to avoid.
     Example: "Do not suggest disabling TLS verification even in test environments" -->
`;

      fs.writeFileSync(traitPath, traitMd, "utf-8");

      console.log(chalk.bold(`\n${chalk.green("✓")} Created trait: ${name}\n`));
      console.log(chalk.gray(`  core/traits/${name}.md\n`));
      console.log(chalk.gray(`  Next: Edit the trait file and add it to a persona's traits list.\n`));

    } else if (type === "gotcha") {
      const gotchasDir = path.join(cwd, "core", "gotchas");
      const gotchaPath = path.join(gotchasDir, `${name}.md`);
      if (fs.existsSync(gotchaPath)) {
        console.error(chalk.red(`Gotcha '${name}' already exists at core/gotchas/${name}.md`));
        process.exit(1);
      }

      if (!fs.existsSync(gotchasDir)) {
        fs.mkdirSync(gotchasDir, { recursive: true });
      }

      const gotchaMd = `---
description: "TODO — brief description of this gotcha"
paths:
  - "**/*.ts"
---

# ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}

<!-- Path-scoped knowledge: battle-tested rules that activate for matching files.
     Sources: post-incident reviews, onboarding notes, repeated code review comments. -->

- **TODO:** First gotcha rule — explain the what AND the why
`;

      fs.writeFileSync(gotchaPath, gotchaMd, "utf-8");

      console.log(chalk.bold(`\n${chalk.green("✓")} Created gotcha: ${name}\n`));
      console.log(chalk.gray(`  core/gotchas/${name}.md\n`));
      console.log(chalk.gray(`  Next: Edit the paths: frontmatter and add your rules.\n`));

    } else {
      console.error(chalk.red(`Unknown type: '${type}'. Use: persona, trait, gotcha`));
      process.exit(1);
    }
  });

// ---- doctor (AB-36) -------------------------------------------------------

program
  .command("doctor")
  .description("Check environment and diagnose configuration issues")
  .option("--format <fmt>", "output format: text, json", "text")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const isJson = opts.format === "json";
    if (!isJson) console.log(chalk.bold("\nAgentBoot — doctor\n"));
    const cwd = process.cwd();
    let issues = 0;

    interface DoctorCheck { name: string; status: "ok" | "fail" | "warn"; message: string }
    const checks: DoctorCheck[] = [];

    function ok(msg: string) { checks.push({ name: msg, status: "ok", message: msg }); if (!isJson) console.log(`  ${chalk.green("✓")} ${msg}`); }
    function fail(msg: string) { issues++; checks.push({ name: msg, status: "fail", message: msg }); if (!isJson) console.log(`  ${chalk.red("✗")} ${msg}`); }
    function warn(msg: string) { checks.push({ name: msg, status: "warn", message: msg }); if (!isJson) console.log(`  ${chalk.yellow("⚠")} ${msg}`); }

    // 1. Environment
    if (!isJson) console.log(chalk.cyan("Environment"));
    const nodeV = process.version;
    const nodeMajor = parseInt(nodeV.slice(1), 10);
    if (nodeMajor >= 18) ok(`Node.js ${nodeV}`);
    else fail(`Node.js ${nodeV} — requires >=18`);

    const gitResult = spawnSync("git", ["--version"], { encoding: "utf-8" });
    if (gitResult.status === 0) ok(gitResult.stdout.trim());
    else fail("git not found");

    const claudeResult = spawnSync("claude", ["--version"], { encoding: "utf-8" });
    if (claudeResult.status === 0) ok(`Claude Code ${claudeResult.stdout.trim()}`);
    else warn("Claude Code not found (optional)");

    if (!isJson) console.log("");

    // 2. Configuration
    if (!isJson) console.log(chalk.cyan("Configuration"));
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : path.join(cwd, "agentboot.config.json");

    if (fs.existsSync(configPath)) {
      ok(`agentboot.config.json found`);
      try {
        const config = loadConfig(configPath);
        ok(`Config parses successfully (org: ${config.org})`);

        // Check personas
        const enabledPersonas = config.personas?.enabled ?? [];
        const personasDir = path.join(cwd, "core", "personas");
        let personaIssues = 0;
        for (const p of enabledPersonas) {
          const pDir = path.join(personasDir, p);
          if (!fs.existsSync(pDir)) { personaIssues++; fail(`Persona not found: ${p}`); }
          else if (!fs.existsSync(path.join(pDir, "SKILL.md"))) { personaIssues++; fail(`Missing SKILL.md: ${p}`); }
        }
        if (personaIssues === 0) ok(`All ${enabledPersonas.length} enabled personas found`);

        // Check traits
        const enabledTraits = config.traits?.enabled ?? [];
        const traitsDir = path.join(cwd, "core", "traits");
        let traitIssues = 0;
        for (const t of enabledTraits) {
          if (!fs.existsSync(path.join(traitsDir, `${t}.md`))) { traitIssues++; fail(`Trait not found: ${t}`); }
        }
        if (traitIssues === 0) ok(`All ${enabledTraits.length} enabled traits found`);

        // Check repos.json
        const reposPath = config.sync?.repos ?? "./repos.json";
        const fullReposPath = path.resolve(path.dirname(configPath), reposPath);
        if (fs.existsSync(fullReposPath)) ok(`repos.json found`);
        else warn(`repos.json not found at ${reposPath}`);

        // Check dist/
        const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
        if (fs.existsSync(distPath)) ok(`dist/ exists (built)`);
        else warn(`dist/ not found — run \`agentboot build\``);

      } catch (e: unknown) {
        fail(`Config parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      fail("agentboot.config.json not found");
      if (!isJson) console.log(chalk.gray("    Run `agentboot setup` to create one."));
    }

    if (!isJson) console.log("");

    if (isJson) {
      console.log(JSON.stringify({ issues, checks }, null, 2));
      process.exit(issues > 0 ? 1 : 0);
    }

    if (issues > 0) {
      console.log(chalk.bold(chalk.red(`✗ ${issues} issue${issues !== 1 ? "s" : ""} found\n`)));
      process.exit(1);
    } else {
      console.log(chalk.bold(chalk.green("✓ All checks passed\n")));
    }
  });

// ---- status (AB-37) -------------------------------------------------------

program
  .command("status")
  .description("Show deployment status across synced repositories")
  .option("--format <fmt>", "output format: text, json", "text")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : path.join(cwd, "agentboot.config.json");

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red("No agentboot.config.json found. Run `agentboot setup`."));
      process.exit(1);
    }

    const config = loadConfig(configPath);
    const pkgPath = path.join(ROOT, "package.json");
    const version = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version : "unknown";

    const enabledPersonas = config.personas?.enabled ?? [];
    const enabledTraits = config.traits?.enabled ?? [];
    const outputFormats = config.personas?.outputFormats ?? ["skill", "claude", "copilot"];
    const targetDir = config.sync?.targetDir ?? ".claude";

    // Load repos
    const reposPath = path.resolve(path.dirname(configPath), config.sync?.repos ?? "./repos.json");
    let repos: Array<{ path: string; platform?: string; group?: string; team?: string; label?: string }> = [];
    if (fs.existsSync(reposPath)) {
      try { repos = JSON.parse(fs.readFileSync(reposPath, "utf-8")); } catch { /* empty */ }
    }

    if (opts.format === "json") {
      const status = {
        org: config.org,
        version,
        personas: enabledPersonas,
        traits: enabledTraits,
        outputFormats,
        repos: repos.map((r) => {
          const manifestPath = path.join(r.path, targetDir, ".agentboot-manifest.json");
          let manifest = null;
          if (fs.existsSync(manifestPath)) {
            try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch { /* skip */ }
          }
          return { ...r, manifest };
        }),
      };
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
    }

    console.log(chalk.bold("\nAgentBoot — status\n"));
    console.log(`  Org:       ${chalk.cyan(config.orgDisplayName ?? config.org)}`);
    console.log(`  Version:   ${version}`);
    console.log(`  Personas:  ${enabledPersonas.length} enabled (${enabledPersonas.join(", ")})`);
    console.log(`  Traits:    ${enabledTraits.length} enabled`);
    console.log(`  Platforms: ${outputFormats.join(", ")}`);
    console.log("");

    if (repos.length === 0) {
      console.log(chalk.gray("  No repos registered in repos.json.\n"));
    } else {
      console.log(chalk.cyan(`  Repos (${repos.length}):`));
      for (const repo of repos) {
        const label = repo.label ?? repo.path;
        const manifestPath = path.join(repo.path, targetDir, ".agentboot-manifest.json");
        let syncInfo = chalk.gray("never synced");

        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            const syncedAt = manifest.synced_at ?? "unknown";
            const fileCount = manifest.files?.length ?? 0;
            syncInfo = chalk.green(`synced ${syncedAt} (${fileCount} files)`);
          } catch { /* skip */ }
        }

        const scope = repo.team ? `${repo.group}/${repo.team}` : repo.group ?? "core";
        console.log(`    ${label} [${scope}] — ${syncInfo}`);
      }
      console.log("");
    }

    // Check dist/ freshness
    const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
    if (fs.existsSync(distPath)) {
      const stat = fs.statSync(distPath);
      console.log(chalk.gray(`  Last build: ${stat.mtime.toISOString()}\n`));
    } else {
      console.log(chalk.yellow("  dist/ not found — run `agentboot build`\n"));
    }
  });

// ---- lint (AB-38) ---------------------------------------------------------

program
  .command("lint")
  .description("Static analysis for prompt quality and token budgets")
  .option("--persona <name>", "lint specific persona only")
  .option("--severity <level>", "minimum severity: info, warn, error", "warn")
  .option("--format <fmt>", "output format: text, json", "text")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : path.join(cwd, "agentboot.config.json");

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red("No agentboot.config.json found."));
      process.exit(1);
    }

    const config = loadConfig(configPath);
    const isJson = opts.format === "json";
    if (!isJson) console.log(chalk.bold("\nAgentBoot — lint\n"));

    interface Finding {
      rule: string;
      severity: "info" | "warn" | "error";
      file: string;
      line?: number;
      message: string;
    }

    const findings: Finding[] = [];
    const severityOrder = { info: 0, warn: 1, error: 2 };
    const minSeverity = severityOrder[opts.severity as keyof typeof severityOrder] ?? 1;

    const personasDir = path.join(cwd, "core", "personas");
    const enabledPersonas = config.personas?.enabled ?? [];
    const tokenBudget = config.output?.tokenBudget?.warnAt ?? 8000;

    // Vague language patterns
    const vaguePatterns = [
      { pattern: /\bbe thorough\b/i, msg: "Vague: 'be thorough' — specify what to check" },
      { pattern: /\btry to\b/i, msg: "Weak: 'try to' — use imperative voice" },
      { pattern: /\bif possible\b/i, msg: "Vague: 'if possible' — specify the condition" },
      { pattern: /\bbest practice/i, msg: "Vague: 'best practice' — cite the specific practice" },
      { pattern: /\bwhen appropriate\b/i, msg: "Vague: 'when appropriate' — define the criteria" },
      { pattern: /\bas needed\b/i, msg: "Vague: 'as needed' — specify the condition" },
    ];

    // Secret patterns
    const secretPatterns = [
      { pattern: /\bsk-[a-zA-Z0-9]{20,}/, msg: "Possible API key (sk-...)" },
      { pattern: /\bghp_[a-zA-Z0-9]{36}/, msg: "Possible GitHub token (ghp_...)" },
      { pattern: /\bAKIA[A-Z0-9]{16}/, msg: "Possible AWS key (AKIA...)" },
      { pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ/, msg: "Possible JWT token" },
      { pattern: /password\s*[:=]\s*["'][^"']+["']/i, msg: "Hardcoded password" },
    ];

    for (const personaName of enabledPersonas) {
      if (opts.persona && personaName !== opts.persona) continue;

      const personaDir = path.join(personasDir, personaName);
      const skillPath = path.join(personaDir, "SKILL.md");

      if (!fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, "utf-8");
      const lines = content.split("\n");

      // Token budget check
      const estimatedTokens = Math.ceil(content.length / 4);
      if (estimatedTokens > tokenBudget) {
        findings.push({
          rule: "prompt-too-long",
          severity: "error",
          file: `core/personas/${personaName}/SKILL.md`,
          message: `Estimated ${estimatedTokens} tokens exceeds budget of ${tokenBudget}`,
        });
      } else if (estimatedTokens > tokenBudget * 0.8) {
        findings.push({
          rule: "prompt-too-long",
          severity: "warn",
          file: `core/personas/${personaName}/SKILL.md`,
          message: `Estimated ${estimatedTokens} tokens — approaching budget of ${tokenBudget}`,
        });
      }

      // Line count check
      if (lines.length > 1000) {
        findings.push({ rule: "prompt-too-long", severity: "error", file: `core/personas/${personaName}/SKILL.md`, message: `${lines.length} lines — max recommended is 1000` });
      } else if (lines.length > 500) {
        findings.push({ rule: "prompt-too-long", severity: "warn", file: `core/personas/${personaName}/SKILL.md`, message: `${lines.length} lines — consider trimming (warn at 500)` });
      }

      // Vague language
      for (let i = 0; i < lines.length; i++) {
        for (const vp of vaguePatterns) {
          if (vp.pattern.test(lines[i]!)) {
            findings.push({
              rule: "vague-instruction",
              severity: "warn",
              file: `core/personas/${personaName}/SKILL.md`,
              line: i + 1,
              message: vp.msg,
            });
          }
        }

        // Secrets
        for (const sp of secretPatterns) {
          if (sp.pattern.test(lines[i]!)) {
            findings.push({
              rule: "credential-in-prompt",
              severity: "error",
              file: `core/personas/${personaName}/SKILL.md`,
              line: i + 1,
              message: sp.msg,
            });
          }
        }
      }

      // Missing output format section
      if (!/## output format/i.test(content)) {
        findings.push({
          rule: "missing-output-format",
          severity: "info",
          file: `core/personas/${personaName}/SKILL.md`,
          message: "No '## Output Format' section found",
        });
      }
    }

    // Also lint traits
    const traitsDir = path.join(cwd, "core", "traits");
    if (fs.existsSync(traitsDir)) {
      for (const file of fs.readdirSync(traitsDir).filter((f) => f.endsWith(".md"))) {
        const content = fs.readFileSync(path.join(traitsDir, file), "utf-8");
        const lines = content.split("\n");

        if (lines.length > 100) {
          findings.push({ rule: "trait-too-long", severity: "warn", file: `core/traits/${file}`, message: `${lines.length} lines — traits should be concise (<100 lines)` });
        }

        // Check for unused trait
        const traitName = file.replace(/\.md$/, "");
        const enabledTraits = config.traits?.enabled ?? [];
        if (enabledTraits.length > 0 && !enabledTraits.includes(traitName)) {
          findings.push({ rule: "unused-trait", severity: "info", file: `core/traits/${file}`, message: `Trait not in traits.enabled list` });
        }
      }
    }

    // Filter by severity
    const filtered = findings.filter((f) => severityOrder[f.severity] >= minSeverity);

    if (opts.format === "json") {
      console.log(JSON.stringify(filtered, null, 2));
      const hasErrors = filtered.some((f) => f.severity === "error");
      process.exit(hasErrors ? 1 : 0);
    }

    if (filtered.length === 0) {
      console.log(chalk.bold(chalk.green("✓ No issues found\n")));
      process.exit(0);
    }

    // Group by file
    const byFile = new Map<string, Finding[]>();
    for (const f of filtered) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }

    for (const [file, fileFindings] of byFile) {
      console.log(chalk.cyan(`  ${file}`));
      for (const f of fileFindings) {
        const sev = f.severity === "error" ? chalk.red(f.severity.toUpperCase())
          : f.severity === "warn" ? chalk.yellow(f.severity.toUpperCase())
          : chalk.gray(f.severity.toUpperCase());
        const loc = f.line ? `:${f.line}` : "";
        console.log(`    ${sev} [${f.rule}]${loc} ${f.message}`);
      }
      console.log("");
    }

    const errorCount = filtered.filter((f) => f.severity === "error").length;
    const warnCount = filtered.filter((f) => f.severity === "warn").length;
    const infoCount = filtered.filter((f) => f.severity === "info").length;

    const parts: string[] = [];
    if (errorCount) parts.push(chalk.red(`${errorCount} error${errorCount !== 1 ? "s" : ""}`));
    if (warnCount) parts.push(chalk.yellow(`${warnCount} warning${warnCount !== 1 ? "s" : ""}`));
    if (infoCount) parts.push(chalk.gray(`${infoCount} info`));

    console.log(`  ${parts.join(", ")}\n`);
    process.exit(errorCount > 0 ? 1 : 0);
  });

// ---- uninstall (AB-45) ----------------------------------------------------

program
  .command("uninstall")
  .description("Remove AgentBoot managed files from a repository")
  .option("--repo <path>", "target repository path")
  .option("--dry-run", "preview what would be removed")
  .action((opts) => {
    const targetRepo = opts.repo ? path.resolve(opts.repo) : process.cwd();
    const dryRun = opts.dryRun ?? false;
    const targetDir = ".claude";
    const manifestPath = path.join(targetRepo, targetDir, ".agentboot-manifest.json");

    console.log(chalk.bold("\nAgentBoot — uninstall\n"));
    console.log(chalk.gray(`  Target: ${targetRepo}`));

    if (dryRun) {
      console.log(chalk.yellow("  DRY RUN — no files will be removed\n"));
    } else {
      console.log("");
    }

    if (!fs.existsSync(manifestPath)) {
      console.log(chalk.yellow("  No .agentboot-manifest.json found — nothing to uninstall."));
      console.log(chalk.gray("  This repo may not have been synced by AgentBoot.\n"));
      process.exit(0);
    }

    let manifest: { files?: Array<{ path: string; hash: string }>; version?: string; synced_at?: string };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      console.error(chalk.red("  Failed to parse manifest file."));
      process.exit(1);
    }

    const files = manifest.files ?? [];
    console.log(chalk.cyan(`  Found ${files.length} managed file(s) (synced ${manifest.synced_at ?? "unknown"})\n`));

    let removed = 0;
    let modified = 0;
    let missing = 0;

    // Resolve boundary for path traversal protection
    const boundary = path.resolve(targetRepo);

    for (const entry of files) {
      // Manifest paths are repo-relative (include .claude/ prefix)
      const fullPath = path.resolve(targetRepo, entry.path);

      // Path traversal protection: reject paths that escape the repo
      if (!fullPath.startsWith(boundary + path.sep) && fullPath !== boundary) {
        console.log(chalk.red(`    rejected ${entry.path} (path escapes repo boundary)`));
        continue;
      }

      if (!fs.existsSync(fullPath)) {
        missing++;
        console.log(chalk.gray(`    skip ${entry.path} (already removed)`));
        continue;
      }

      // Check if file was modified after sync (read as Buffer to match sync.ts hashing)
      const currentContent = fs.readFileSync(fullPath);
      const currentHash = createHash("sha256").update(currentContent).digest("hex");

      if (currentHash !== entry.hash) {
        modified++;
        console.log(chalk.yellow(`    modified ${entry.path} (hash mismatch — skipping)`));
        continue;
      }

      if (dryRun) {
        console.log(chalk.gray(`    would remove ${entry.path}`));
      } else {
        fs.unlinkSync(fullPath);
        // Clean up empty parent directories (stay within repo boundary)
        let dir = path.dirname(fullPath);
        while (dir.startsWith(boundary + path.sep) && dir !== boundary) {
          try {
            const entries = fs.readdirSync(dir);
            if (entries.length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
            else break;
          } catch { break; }
        }
        console.log(chalk.green(`    removed ${entry.path}`));
      }
      removed++;
    }

    // Remove manifest itself (also when all files were already gone)
    if (!dryRun && (removed > 0 || (missing > 0 && modified === 0))) {
      fs.unlinkSync(manifestPath);
      console.log(chalk.green(`    removed .agentboot-manifest.json`));
    }

    console.log("");
    const verb = dryRun ? "would remove" : "removed";
    console.log(chalk.bold(`  ${verb}: ${removed}, skipped (modified): ${modified}, already gone: ${missing}\n`));
  });

// ---- config ---------------------------------------------------------------

program
  .command("config")
  .description("View configuration (read-only)")
  .argument("[key]", "config key (e.g., personas.enabled)")
  .argument("[value]", "not yet supported")
  .action((key?: string, value?: string) => {
    const cwd = process.cwd();
    const configPath = path.join(cwd, "agentboot.config.json");

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red("No agentboot.config.json found."));
      process.exit(1);
    }

    if (!key) {
      // Show current config
      const content = fs.readFileSync(configPath, "utf-8");
      console.log(content);
      process.exit(0);
    }

    if (!value) {
      // Read a specific key
      const config = loadConfig(configPath);
      const keys = key.split(".");
      let current: unknown = config;
      for (const k of keys) {
        if (current && typeof current === "object" && k in current) {
          current = (current as Record<string, unknown>)[k];
        } else {
          console.error(chalk.red(`Key not found: ${key}`));
          process.exit(1);
        }
      }
      console.log(typeof current === "object" ? JSON.stringify(current, null, 2) : String(current));
      process.exit(0);
    }

    console.error(chalk.red(`Config writes are not yet supported. Edit agentboot.config.json directly.`));
    console.error(chalk.gray(`  agentboot config ${key}   ← read a value`));
    console.error(chalk.gray(`  agentboot config         ← show full config`));
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse();
