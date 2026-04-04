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
 *   agentboot install [--hub] [--connect] [--org name] [--path dir]
 *   agentboot add <type> <name>
 *   agentboot doctor [--fix] [--dry-run] [--format text|json]
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
import { ExitPromptError } from "@inquirer/core";
import { loadConfig, stripJsoncComments, type MarketplaceManifest, type MarketplaceEntry } from "./lib/config.js";

// Gracefully handle Ctrl-C during interactive prompts
process.on("uncaughtException", (err) => {
  if (err instanceof ExitPromptError) {
    console.log("\n  Cancelled.");
    process.exit(0);
  }
  throw err;
});

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

/** Recursively copy a directory tree. */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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
  .option("--quiet", "suppress non-error output")
  .option("--debug", "show debug output (LLM responses, raw data)")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts()["debug"]) {
      process.env["DEBUG"] = "1";
    }
  });

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
  .option("-s, --strict", "treat warnings as errors")
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
  .option("-d, --dry-run", "preview changes without writing")
  .option("--force", "override drift detection (overwrite modified files)")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const args = collectGlobalArgs({ config: globalOpts.config });

    if (opts.reposFile) {
      args.push("--repos", opts.reposFile);
    }
    if (opts.dryRun) {
      args.push("--dry-run");
    }
    if (opts.force) {
      args.push("--force");
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

// ---- dev-build -----------------------------------------------------------

program
  .command("dev-build")
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
    if (valResult.error) {
      console.error(`Validation failed to start: ${valResult.error.message}`);
      process.exit(1);
    }
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
    if (buildResult.error) {
      console.error(`Build failed to start: ${buildResult.error.message}`);
      process.exit(1);
    }
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
    if (syncResult.error) {
      console.error(`Dev-sync failed to start: ${syncResult.error.message}`);
      process.exit(1);
    }
    if (syncResult.status !== 0) {
      console.error("Dev-sync failed.");
      process.exit(syncResult.status ?? 1);
    }

    if (!quiet) console.log("✓ dev-build complete");
    process.exit(0);
  });

// ---- install (AB-33.2) — redesigned two-path onboarding ------------------

const installAction = async (opts: Record<string, unknown>) => {
  const { runInstall, AgentBootError } = await import("./lib/install.js");
  try {
    await runInstall({
      hub: opts["hub"] as boolean | undefined,
      connect: opts["connect"] as boolean | undefined,
      org: opts["org"] as string | undefined,
      path: opts["path"] as string | undefined,
      hubPath: opts["hubPath"] as string | undefined,
      nonInteractive: opts["nonInteractive"] as boolean | undefined,
      noSync: opts["skipSync"] as boolean | undefined,
    });
  } catch (err) {
    if (err instanceof AgentBootError) {
      process.exit(err.exitCode);
    }
    throw err;
  }
};

program
  .command("install")
  .description("Interactive onboarding — create a personas repo or connect to one")
  .option("--hub", "create a new personas repo (architect path)")
  .option("--connect", "connect this repo to an existing personas hub (developer path)")
  .option("--org <name>", "organization name")
  .option("--path <dir>", "where to create the personas repo")
  .option("--hub-path <dir>", "path to existing personas repo (for --connect)")
  .option("--non-interactive", "run without prompts (not yet implemented)")
  .option("--skip-sync", "skip the optional sync step")
  .action(installAction);

// Hidden alias: setup → install (deprecated)
program
  .command("setup", { hidden: true })
  .description("Deprecated — use `agentboot install`")
  .action(async () => {
    console.log(chalk.yellow("\n  `agentboot setup` is deprecated. Use `agentboot install` instead.\n"));
    await installAction({});
  });

// ---- import (AB-43) — LLM-powered content classification -----------------

program
  .command("import")
  .description("Scan and classify existing AI agent content (LLM-powered)")
  .option("--path <dir>", "directory or repo to scan (default: cwd)")
  .option("--parent <dir>", "scan all subdirs of a parent directory (like install does)")
  .option("--hub-path <dir>", "path to personas repo")
  .option("--overlap", "run heuristic overlap analysis")
  .option("--apply", "apply an existing import plan")
  .option("--isolated", "test prompts without user Claude settings (uses temp config)")
  .action(async (opts) => {
    const parentDir = opts["parent"] as string | undefined;
    const run = async () => {
      if (parentDir) {
        // Expanded import: scan all subdirs, categorize by strategy, 3-strategy pipeline
        const {
          scanParentForContent, categorizeByStrategy, runExpandedImport,
          applyImportPlanV2, writeStagingFileV2, printScanManifest, AgentBootError,
        } = await import("./lib/import.js");
        const hubPath = opts["hubPath"] as string | undefined;
        if (!hubPath) {
          console.log(chalk.red("  --parent requires --hub-path to specify the personas repo.\n"));
          throw new AgentBootError(1);
        }
        const resolvedHub = path.resolve(hubPath);
        const manifest = scanParentForContent(parentDir, [resolvedHub]);
        if (manifest.files.length === 0) {
          console.log(chalk.yellow("  No AI agent content found in subdirectories.\n"));
          throw new AgentBootError(0);
        }
        printScanManifest(manifest);
        const categorized = categorizeByStrategy(manifest);
        const trustedSources = new Set(manifest.files.map(f => f.absolutePath));
        const plan = runExpandedImport(categorized, manifest, resolvedHub, trustedSources);

        if (opts["apply"]) {
          const result = applyImportPlanV2(plan, resolvedHub, trustedSources);
          console.log(chalk.bold(
            `\n  ✓ Created: ${result.created}, Applied: ${result.applied}, Skipped: ${result.skipped}` +
            (result.errors.length > 0 ? `, Errors: ${result.errors.length}` : "") + "\n"
          ));
          for (const err of result.errors) console.log(chalk.red(`    ${err}`));
        } else {
          writeStagingFileV2(plan, resolvedHub, trustedSources);
          console.log(chalk.cyan(`\n  Import plan saved. Run with --apply to execute.\n`));
        }
      } else {
        const { runImport } = await import("./lib/import.js");
        await runImport({
          path: opts["path"] as string | undefined,
          hubPath: opts["hubPath"] as string | undefined,
          overlap: opts["overlap"] as boolean | undefined,
          apply: opts["apply"] as boolean | undefined,
        });
      }
    };
    try {
      if (opts["isolated"]) {
        const { withIsolatedClaude } = await import("./prompts/index.js");
        console.log(chalk.yellow("  Running in isolated mode — using temporary Claude config (your settings are untouched).\n"));
        await withIsolatedClaude(run);
      } else {
        await run();
      }
    } catch (err) {
      const { AgentBootError } = await import("./lib/import.js");
      if (err instanceof AgentBootError) {
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

// ---- add (AB-34/35/55) ----------------------------------------------------

program
  .command("add")
  .description("Scaffold a new persona, trait, gotcha, domain, hook, or classify a prompt")
  .argument("<type>", "what to add: persona, trait, gotcha, domain, hook, prompt")
  .argument("<name>", "name for the new item (lowercase-with-hyphens)")
  .action(async (type: string, name: string) => {
    // Validate name format (skip for prompt type — name is content/path, not an identifier)
    if (type !== "prompt" && !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
      console.error(chalk.red(`Name must be 1-64 lowercase alphanumeric chars with hyphens: got '${name}'`));
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

    } else if (type === "domain") {
      // AB-46/53: Domain layer scaffolding
      const domainDir = path.join(cwd, "domains", name);
      if (fs.existsSync(domainDir)) {
        console.error(chalk.red(`Domain '${name}' already exists at domains/${name}/`));
        process.exit(1);
      }

      fs.mkdirSync(path.join(domainDir, "traits"), { recursive: true });
      fs.mkdirSync(path.join(domainDir, "personas"), { recursive: true });
      fs.mkdirSync(path.join(domainDir, "instructions"), { recursive: true });

      const domainManifest = JSON.stringify({
        name,
        version: "1.0.0",
        description: `TODO — ${name} domain layer`,
        traits: [],
        personas: [],
        instructions: [],
        requires_core_version: ">=0.2.0",
      }, null, 2);

      fs.writeFileSync(path.join(domainDir, "agentboot.domain.json"), domainManifest + "\n", "utf-8");

      const readmeMd = `# ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")} Domain

## Purpose

<!-- Describe what this domain layer adds: compliance regime, industry standards, etc. -->

## Activation

Add to \`agentboot.config.json\`:
\`\`\`jsonc
{
  "domains": ["./domains/${name}"]
}
\`\`\`

## Contents

- \`traits/\` — domain-specific behavioral traits
- \`personas/\` — domain-specific personas
- \`instructions/\` — domain-level always-on instructions
`;

      fs.writeFileSync(path.join(domainDir, "README.md"), readmeMd, "utf-8");

      console.log(chalk.bold(`\n${chalk.green("✓")} Created domain: ${name}\n`));
      console.log(chalk.gray(`  domains/${name}/`));
      console.log(chalk.gray(`  ├── agentboot.domain.json`));
      console.log(chalk.gray(`  ├── README.md`));
      console.log(chalk.gray(`  ├── traits/`));
      console.log(chalk.gray(`  ├── personas/`));
      console.log(chalk.gray(`  └── instructions/\n`));
      console.log(chalk.gray(`  Next: Add domain to config: "domains": ["./domains/${name}"]`));
      console.log(chalk.gray(`  Then: agentboot validate && agentboot build\n`));

    } else if (type === "hook") {
      // AB-46: Compliance hook scaffolding
      const hooksDir = path.join(cwd, "hooks");
      const hookPath = path.join(hooksDir, `${name}.sh`);
      if (fs.existsSync(hookPath)) {
        console.error(chalk.red(`Hook '${name}' already exists at hooks/${name}.sh`));
        process.exit(1);
      }

      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }

      const hookScript = `#!/bin/bash
# AgentBoot compliance hook: ${name}
# Generated by \`agentboot add hook ${name}\`
#
# Hook events: PreToolUse, PostToolUse, Notification, Stop,
#              SubagentStart, SubagentStop, UserPromptSubmit, SessionEnd
#
# Input: JSON on stdin with hook_event_name, agent_type, tool_name, etc.
# Output: exit 0 = pass, exit 2 = block (for PreToolUse/UserPromptSubmit)
#
# To register this hook, add to agentboot.config.json:
#   "claude": {
#     "hooks": {
#       "<EventName>": [{
#         "matcher": "",
#         "hooks": [{ "type": "command", "command": "hooks/${name}.sh" }]
#       }]
#     }
#   }

INPUT=$(cat)
EVENT_NAME=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')

# TODO: Add your compliance logic here
# Example: block a tool if a condition is met
# if [ "$EVENT_NAME" = "PreToolUse" ]; then
#   TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
#   if [ "$TOOL" = "Bash" ]; then
#     echo '{"decision":"block","reason":"Bash tool is restricted by policy"}' >&2
#     exit 2
#   fi
# fi

exit 0
`;

      fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });

      console.log(chalk.bold(`\n${chalk.green("✓")} Created hook: ${name}\n`));
      console.log(chalk.gray(`  hooks/${name}.sh\n`));
      console.log(chalk.gray(`  Next: Edit the hook script to add your compliance logic.`));
      console.log(chalk.gray(`  Then: Register in agentboot.config.json under claude.hooks\n`));

    } else if (type === "prompt") {
      // AB-44: add prompt — classify and save a raw prompt or file.
      // `name` here is actually the content or file path.
      const contentOrPath = name;
      const cwd = process.cwd();
      const { runImport, AgentBootError: ImportError } = await import("./lib/import.js");

      try {
        // Check if it's a file path
        const resolvedPath = path.resolve(cwd, contentOrPath);
        const isFile = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile();

        if (!isFile) {
          // Inline prompt text — write to temp file, classify it
          const tmpDir = fs.mkdtempSync(path.join(cwd, ".agentboot-prompt-"));
          const tmpFile = path.join(tmpDir, "prompt.md");
          fs.writeFileSync(tmpFile, contentOrPath, "utf-8");
          try {
            await runImport({ file: tmpFile });
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } else {
          // File path — classify the single file
          await runImport({ file: resolvedPath });
        }
      } catch (err) {
        if (err instanceof ImportError) {
          process.exit(err.exitCode);
        }
        throw err;
      }

    } else {
      console.error(chalk.red(`Unknown type: '${type}'. Use: persona, trait, gotcha, domain, hook, prompt`));
      process.exit(1);
    }
  });

// ---- doctor (AB-36) -------------------------------------------------------

program
  .command("doctor")
  .description("Check environment and diagnose configuration issues")
  .option("--format <fmt>", "output format: text, json", "text")
  .option("--fix", "auto-fix issues that can be resolved automatically")
  .option("--dry-run", "show what --fix would do without making changes")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const isJson = opts.format === "json";
    const fixMode = opts.fix === true;
    const dryRun = opts.dryRun === true;
    if (dryRun && !fixMode && !isJson) {
      console.log(chalk.yellow("Note: --dry-run has no effect without --fix\n"));
    }
    if (!isJson) console.log(chalk.bold("\nAgentBoot — doctor\n"));
    const cwd = process.cwd();
    let issuesFound = 0;
    let issuesFixed = 0;

    interface DoctorCheck { name: string; status: "ok" | "fail" | "warn"; message: string; fixable?: boolean; fixed?: boolean }
    const checks: DoctorCheck[] = [];

    function ok(msg: string) { checks.push({ name: msg, status: "ok", message: msg }); if (!isJson) console.log(`  ${chalk.green("✓")} ${msg}`); }
    function fail(msg: string, fixable = false) { issuesFound++; checks.push({ name: msg, status: "fail", message: msg, fixable }); if (!isJson) console.log(`  ${chalk.red("✗")} ${msg}${fixable && !fixMode ? chalk.gray(" (fixable with --fix)") : ""}`); }
    function warn(msg: string, fixable = false) { checks.push({ name: msg, status: "warn", message: msg, fixable }); if (!isJson) console.log(`  ${chalk.yellow("⚠")} ${msg}${fixable && !fixMode ? chalk.gray(" (fixable with --fix)") : ""}`); }
    function fixed(msg: string) { issuesFound++; issuesFixed++; checks.push({ name: msg, status: "ok", message: msg, fixed: true }); if (!isJson) console.log(`  ${chalk.green("✓")} ${msg} ${chalk.cyan(dryRun ? "(would fix)" : "(fixed)")}`); }

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

        // Check for orgDisplayName
        if (!config.orgDisplayName || config.orgDisplayName === config.org) {
          warn(`orgDisplayName not set — compiled output will use "${config.org}" as the display name`);
          if (!isJson) console.log(chalk.gray(`      Set it with: agentboot config orgDisplayName "Your Org Name"`));
        }

        // Helper: generate a minimal SKILL.md scaffold
        function scaffoldSkillMd(name: string): string {
          return [
            "---",
            `id: ${name}`,
            `name: ${name}`,
            "version: 0.1.0",
            "---",
            "",
            `# ${name}`,
            "",
            "<!-- traits:start -->",
            "<!-- traits:end -->",
            "",
            "TODO: Define this persona.",
            "",
          ].join("\n");
        }

        // Check personas
        const enabledPersonas = config.personas?.enabled ?? [];
        const personasDir = path.join(cwd, "core", "personas");
        let personaIssues = 0;
        let personasScaffolded = 0;
        for (const p of enabledPersonas) {
          const pDir = path.join(personasDir, p);
          if (!fs.existsSync(pDir)) {
            if (fixMode) {
              if (!dryRun) {
                fs.mkdirSync(pDir, { recursive: true });
                fs.writeFileSync(path.join(pDir, "SKILL.md"), scaffoldSkillMd(p), "utf-8");
                const personaConfig = { traits: config.traits?.enabled ?? [] };
                fs.writeFileSync(path.join(pDir, "persona.config.json"), JSON.stringify(personaConfig, null, 2) + "\n", "utf-8");
              }
              personasScaffolded++;
              fixed(`Scaffolded persona: ${p}`);
            } else {
              personaIssues++; fail(`Persona not found: ${p}`, true);
            }
          } else if (!fs.existsSync(path.join(pDir, "SKILL.md"))) {
            if (fixMode) {
              if (!dryRun) {
                fs.writeFileSync(path.join(pDir, "SKILL.md"), scaffoldSkillMd(p), "utf-8");
              }
              personasScaffolded++;
              fixed(`Created missing SKILL.md for: ${p}`);
            } else {
              personaIssues++; fail(`Missing SKILL.md: ${p}`, true);
            }
          }
        }
        if (personaIssues === 0 && personasScaffolded === 0) {
          ok(`All ${enabledPersonas.length} enabled personas found`);
        } else if (personaIssues === 0 && personasScaffolded > 0) {
          ok(`All ${enabledPersonas.length} enabled personas found (${personasScaffolded} scaffolded)`);
        }

        // Check traits
        const enabledTraits = config.traits?.enabled ?? [];
        const traitsDir = path.join(cwd, "core", "traits");
        let traitIssues = 0;
        let traitsScaffolded = 0;
        for (const t of enabledTraits) {
          if (!fs.existsSync(path.join(traitsDir, `${t}.md`))) {
            if (fixMode) {
              if (!dryRun) {
                fs.mkdirSync(traitsDir, { recursive: true });
                const traitContent = `# ${t}\n\nTODO: Define this trait.\n`;
                fs.writeFileSync(path.join(traitsDir, `${t}.md`), traitContent, "utf-8");
              }
              traitsScaffolded++;
              fixed(`Created missing trait: ${t}.md`);
            } else {
              traitIssues++; fail(`Trait not found: ${t}`, true);
            }
          }
        }
        if (traitIssues === 0 && traitsScaffolded === 0) {
          ok(`All ${enabledTraits.length} enabled traits found`);
        } else if (traitIssues === 0 && traitsScaffolded > 0) {
          ok(`All ${enabledTraits.length} enabled traits found (${traitsScaffolded} scaffolded)`);
        }

        // Check core directories
        const coreDirs = ["core/personas", "core/traits", "core/instructions", "core/gotchas"];
        for (const dir of coreDirs) {
          const fullDir = path.join(cwd, dir);
          if (!fs.existsSync(fullDir)) {
            if (fixMode) {
              if (!dryRun) fs.mkdirSync(fullDir, { recursive: true });
              fixed(`Created missing directory: ${dir}/`);
            } else {
              warn(`Missing directory: ${dir}/`, true);
            }
          }
        }

        // Check repos.json
        const reposPath = config.sync?.repos ?? "./repos.json";
        const fullReposPath = path.resolve(path.dirname(configPath), reposPath);
        if (fs.existsSync(fullReposPath)) {
          ok(`repos.json found`);
        } else if (fixMode) {
          if (!dryRun) fs.writeFileSync(fullReposPath, "[]\n", "utf-8");
          fixed(`Created empty repos.json`);
        } else {
          warn(`repos.json not found at ${reposPath}`, true);
        }

        // Check dist/
        const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
        if (fs.existsSync(distPath)) {
          ok(`dist/ exists (built)`);
        } else if (fixMode) {
          if (!isJson) console.log(`  ${chalk.cyan("→")} Building dist/...`);
          if (!dryRun) {
            const compileScript = path.join(SCRIPTS_DIR, "compile.ts");
            const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
            const buildResult = spawnSync(tsx, [compileScript], {
              cwd,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            });
            if (buildResult.status === 0) {
              fixed(`Built dist/`);
            } else {
              fail(`Build failed: ${buildResult.stderr?.trim() ?? "unknown error"}`);
            }
          } else {
            fixed(`Would run \`agentboot build\``);
          }
        } else {
          warn(`dist/ not found — run \`agentboot build\``, true);
        }

      } catch (e: unknown) {
        fail(`Config parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      fail("agentboot.config.json not found");
      if (!isJson) console.log(chalk.gray("    Run `agentboot install` to create one."));
    }

    if (!isJson) console.log("");

    const issuesRemaining = issuesFound - issuesFixed;

    if (isJson) {
      console.log(JSON.stringify({ issues: issuesRemaining, issuesFound, issuesFixed, checks }, null, 2));
      process.exit(issuesRemaining > 0 ? 1 : 0);
    }

    if (issuesRemaining > 0) {
      const fixableCount = checks.filter(c => c.fixable && !c.fixed).length;
      console.log(chalk.bold(chalk.red(`✗ ${issuesRemaining} issue${issuesRemaining !== 1 ? "s" : ""} found`)));
      if (fixableCount > 0) {
        console.log(chalk.gray(`  ${fixableCount} fixable — run \`agentboot doctor --fix\`\n`));
      } else {
        console.log("");
      }
      process.exit(1);
    } else {
      if (issuesFixed > 0) {
        console.log(chalk.bold(chalk.green(`✓ All checks passed (${issuesFixed} issue${issuesFixed !== 1 ? "s" : ""} ${dryRun ? "would be " : ""}fixed)\n`)));
      } else {
        console.log(chalk.bold(chalk.green("✓ All checks passed\n")));
      }
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
      console.error(chalk.red("No agentboot.config.json found. Run `agentboot install`."));
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig(configPath);
    } catch (e: unknown) {
      console.error(chalk.red(`Failed to parse config: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }
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

    let config;
    try {
      config = loadConfig(configPath);
    } catch (e: unknown) {
      console.error(chalk.red(`Failed to parse config: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }
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
    const enabledTraits = config.traits?.enabled ?? [];
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
        if (enabledTraits.length > 0 && !enabledTraits.includes(traitName)) {
          findings.push({ rule: "unused-trait", severity: "info", file: `core/traits/${file}`, message: `Trait not in traits.enabled list` });
        }
      }
    }

    // Compiled output token check — CLAUDE.md content costs money on every turn
    // because it's injected as system-reminder, not in the cached system prompt.
    const distClaudeMd = path.join(cwd, "dist", "claude", "core", "CLAUDE.md");
    if (fs.existsSync(distClaudeMd)) {
      const compiled = fs.readFileSync(distClaudeMd, "utf-8");
      // Expand @import directives to count total tokens
      let totalContent = compiled;
      const importPattern = /^@(.+)$/gm;
      let importMatch;
      while ((importMatch = importPattern.exec(compiled)) !== null) {
        const importPath = path.join(cwd, importMatch[1]!);
        if (fs.existsSync(importPath)) {
          totalContent += "\n" + fs.readFileSync(importPath, "utf-8");
        }
      }
      const compiledTokens = Math.ceil(totalContent.length / 4);
      if (compiledTokens > tokenBudget) {
        findings.push({
          rule: "compiled-too-large",
          severity: "warn",
          file: "dist/claude/core/CLAUDE.md (compiled + @imports)",
          message: `Compiled output ~${compiledTokens} tokens exceeds budget of ${tokenBudget}. Every token costs money on every turn.`,
        });
      } else if (compiledTokens > tokenBudget * 0.8) {
        findings.push({
          rule: "compiled-too-large",
          severity: "warn",
          file: "dist/claude/core/CLAUDE.md (compiled + @imports)",
          message: `Compiled output ~${compiledTokens} tokens — approaching budget of ${tokenBudget}.`,
        });
      }
      if (!isJson) {
        console.log(chalk.gray(`  Compiled CLAUDE.md: ~${compiledTokens} tokens (budget: ${tokenBudget})`));
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
  .option("-d, --dry-run", "preview what would be removed")
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
    console.log(chalk.bold(`  ${verb}: ${removed}, skipped (modified): ${modified}, already gone: ${missing}`));

    // Auto-restore from archive if it exists.
    const archiveDir = path.join(targetRepo, targetDir, ".agentboot-archive");
    const archiveManifestPath = path.join(archiveDir, "archive-manifest.json");

    if (fs.existsSync(archiveManifestPath)) {
      let archiveManifest: { files?: Array<{ path: string }> };
      try {
        archiveManifest = JSON.parse(fs.readFileSync(archiveManifestPath, "utf-8"));
      } catch {
        console.log(chalk.yellow("\n  Archive manifest unreadable — skipping restore.\n"));
        return;
      }

      const archiveFiles = archiveManifest.files ?? [];
      console.log(chalk.cyan(`\n  Restoring ${archiveFiles.length} pre-AgentBoot file(s) from archive...`));

      let restored = 0;
      const targetBase = path.join(targetRepo, targetDir);

      const resolvedArchiveDir = path.resolve(archiveDir);
      const resolvedTargetBase = path.resolve(targetBase);

      for (const entry of archiveFiles) {
        const srcPath = path.resolve(archiveDir, entry.path);

        // Root files archived under __root__/ are restored to repo root
        let destPath: string;
        if (entry.path.startsWith("__root__/")) {
          destPath = path.resolve(targetRepo, entry.path.replace("__root__/", ""));
        } else {
          destPath = path.resolve(targetBase, entry.path);
        }

        // Path traversal protection
        if (!srcPath.startsWith(resolvedArchiveDir + path.sep)) {
          console.log(chalk.red(`    rejected ${entry.path} (path escapes archive boundary)`));
          continue;
        }
        const resolvedRepo = path.resolve(targetRepo);
        if (!destPath.startsWith(resolvedTargetBase + path.sep) &&
            !destPath.startsWith(resolvedRepo + path.sep)) {
          console.log(chalk.red(`    rejected ${entry.path} (path escapes repo boundary)`));
          continue;
        }

        if (!fs.existsSync(srcPath)) {
          console.log(chalk.gray(`    skip ${entry.path} (not in archive)`));
          continue;
        }

        if (dryRun) {
          console.log(chalk.gray(`    would restore ${entry.path}`));
        } else {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
          console.log(chalk.green(`    restored ${entry.path}`));
        }
        restored++;
      }

      // Remove the archive directory after restore (also when no files could be restored)
      if (!dryRun) {
        fs.rmSync(archiveDir, { recursive: true, force: true });
        console.log(chalk.green(`    removed .agentboot-archive/`));
      }

      console.log(chalk.bold(`\n  Restored ${restored} file(s) to pre-AgentBoot state.\n`));
    } else {
      console.log("");
    }
  });

// ---- config ---------------------------------------------------------------

program
  .command("config")
  .description("Read or write configuration values")
  .argument("[key]", "config key (e.g., org, orgDisplayName, personas.enabled)")
  .argument("[value]", "value to set (strings only — edit agentboot.config.json for complex values)")
  .action((key: string | undefined, value: string | undefined, _opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : path.join(cwd, "agentboot.config.json");

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

    // Write a config value
    const raw = fs.readFileSync(configPath, "utf-8");

    // Detect JSONC comments — writing back would destroy them
    const stripped = stripJsoncComments(raw);
    if (stripped !== raw) {
      console.error(chalk.red("Config file contains comments (JSONC)."));
      console.error(chalk.gray("  Writing would remove all comments. Edit the file directly:\n"));
      console.error(chalk.gray(`    ${configPath}\n`));
      process.exit(1);
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(stripped);
    } catch {
      console.error(chalk.red("Failed to parse config for writing."));
      process.exit(1);
    }

    const keys = key.split(".");
    let target: Record<string, unknown> = config;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      if (target[k] === undefined) {
        // Auto-create intermediate objects
        target[k] = {};
        target = target[k] as Record<string, unknown>;
      } else if (typeof target[k] === "object" && !Array.isArray(target[k]) && target[k] !== null) {
        target = target[k] as Record<string, unknown>;
      } else {
        console.error(chalk.red(`Cannot write to ${key}: "${k}" exists but is ${typeof target[k]}, not an object.`));
        console.error(chalk.gray("  Edit agentboot.config.json directly.\n"));
        process.exit(1);
      }
    }

    const finalKey = keys[keys.length - 1]!;
    const oldValue = target[finalKey];

    // Guard against overwriting non-string values (arrays, objects, numbers, booleans)
    if (oldValue !== undefined && typeof oldValue !== "string") {
      console.error(chalk.red(`Cannot overwrite ${key}: existing value is ${typeof oldValue}, not a string.`));
      console.error(chalk.gray("  Edit agentboot.config.json directly for non-string values.\n"));
      process.exit(1);
    }

    target[finalKey] = value;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    if (oldValue !== undefined) {
      console.log(chalk.green(`  ${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`));
    } else {
      console.log(chalk.green(`  ${key}: ${JSON.stringify(value)} (added)`));
    }
  });

// ---- export (AB-40) -------------------------------------------------------

program
  .command("export")
  .description("Export compiled output in a specific format")
  .option("--format <fmt>", "export format: plugin, marketplace, managed", "plugin")
  .option("--output <dir>", "output directory")
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : path.join(cwd, "agentboot.config.json");

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red("No agentboot.config.json found. Run `agentboot install`."));
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig(configPath);
    } catch (e: unknown) {
      console.error(chalk.red(`Failed to parse config: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }

    const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
    const format = opts.format;

    console.log(chalk.bold(`\nAgentBoot — export (${format})\n`));

    if (format === "plugin") {
      const pluginDir = path.join(distPath, "plugin");
      const pluginJson = path.join(pluginDir, "plugin.json");

      if (!fs.existsSync(pluginJson)) {
        console.error(chalk.red("Plugin output not found. Run `agentboot build` first."));
        console.error(chalk.gray("Ensure 'plugin' is in personas.outputFormats or build includes claude format."));
        process.exit(1);
      }

      const outputDir = opts.output
        ? path.resolve(opts.output)
        : path.join(cwd, ".claude-plugin");

      // Safety: only delete existing dir if it's within cwd or contains plugin.json
      if (fs.existsSync(outputDir)) {
        const resolvedCwd = path.resolve(cwd);
        const isSafe = outputDir.startsWith(resolvedCwd + path.sep)
          || outputDir === resolvedCwd
          || fs.existsSync(path.join(outputDir, "plugin.json"));
        if (!isSafe) {
          console.error(chalk.red(`  Refusing to delete ${outputDir} — not within project directory.`));
          console.error(chalk.gray("  Use a path within your project or an empty directory."));
          process.exit(1);
        }
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
      fs.mkdirSync(outputDir, { recursive: true });

      copyDirRecursive(pluginDir, outputDir);

      // Count files
      let fileCount = 0;
      function countFiles(dir: string): void {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (fs.statSync(full).isDirectory()) countFiles(full);
          else fileCount++;
        }
      }
      countFiles(outputDir);

      console.log(chalk.green(`  ✓ Exported plugin to ${path.relative(cwd, outputDir)}/`));
      console.log(chalk.gray(`    ${fileCount} files (plugin.json + agents, skills, traits, hooks, rules)`));
      console.log(chalk.gray(`\n  Next: agentboot publish\n`));

    } else if (format === "managed") {
      const managedDir = path.join(distPath, "managed");

      if (!fs.existsSync(managedDir)) {
        console.error(chalk.red("Managed settings not found. Enable managed.enabled in config and rebuild."));
        process.exit(1);
      }

      const outputDir = opts.output
        ? path.resolve(opts.output)
        : path.join(cwd, "managed-output");

      fs.mkdirSync(outputDir, { recursive: true });
      for (const entry of fs.readdirSync(managedDir)) {
        const srcPath = path.join(managedDir, entry);
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, path.join(outputDir, entry));
        }
      }

      console.log(chalk.green(`  ✓ Exported managed settings to ${path.relative(cwd, outputDir)}/`));
      console.log(chalk.gray(`\n  Deploy via your MDM platform (Jamf, Intune, etc.)\n`));

    } else if (format === "marketplace") {
      // Export marketplace.json scaffold
      const outputDir = opts.output ? path.resolve(opts.output) : cwd;
      const marketplacePath = path.join(outputDir, "marketplace.json");

      if (fs.existsSync(marketplacePath)) {
        console.log(chalk.yellow(`  marketplace.json already exists at ${marketplacePath}`));
        process.exit(0);
      }

      const marketplace: MarketplaceManifest = {
        $schema: "https://agentboot.dev/schema/marketplace/v1",
        name: `${config.org}-personas`,
        description: `Agentic personas marketplace for ${config.orgDisplayName ?? config.org}`,
        maintainer: config.orgDisplayName ?? config.org,
        url: "",
        entries: [],
      };

      fs.writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n", "utf-8");
      console.log(chalk.green(`  ✓ Created marketplace.json`));
      console.log(chalk.gray(`\n  Next: agentboot publish to add entries\n`));

    } else {
      console.error(chalk.red(`Unknown export format: '${format}'. Use: plugin, marketplace, managed`));
      process.exit(1);
    }
  });

// ---- publish (AB-41) ------------------------------------------------------

program
  .command("publish")
  .description("Publish compiled plugin to marketplace")
  .option("--marketplace <path>", "path to marketplace.json", "marketplace.json")
  .option("--bump <level>", "version bump: major, minor, patch")
  .option("-d, --dry-run", "preview changes without writing")
  .action((opts) => {
    const cwd = process.cwd();
    const dryRun = opts.dryRun ?? false;

    console.log(chalk.bold("\nAgentBoot — publish\n"));
    if (dryRun) console.log(chalk.yellow("  DRY RUN — no files will be modified\n"));

    // Find plugin
    const pluginJsonPath = path.join(cwd, ".claude-plugin", "plugin.json");
    const distPluginPath = path.join(cwd, "dist", "plugin", "plugin.json");

    let pluginDir: string;
    let pluginManifest: Record<string, unknown>;

    if (fs.existsSync(pluginJsonPath)) {
      pluginDir = path.join(cwd, ".claude-plugin");
      try {
        pluginManifest = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
      } catch (e: unknown) {
        console.error(chalk.red(`  Failed to parse plugin.json: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    } else if (fs.existsSync(distPluginPath)) {
      pluginDir = path.join(cwd, "dist", "plugin");
      try {
        pluginManifest = JSON.parse(fs.readFileSync(distPluginPath, "utf-8"));
      } catch (e: unknown) {
        console.error(chalk.red(`  Failed to parse plugin.json: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    } else {
      console.error(chalk.red("  No plugin found. Run `agentboot export --format plugin` first."));
      process.exit(1);
    }

    let version = (pluginManifest["version"] as string) ?? "0.0.0";

    // B8 fix: Validate semver format before bumping
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      console.error(chalk.red(`  Invalid version format: '${version}'. Expected X.Y.Z (e.g., 1.2.3)`));
      process.exit(1);
    }

    // Version bump — B6 fix: bump BEFORE hash/copy so release gets correct version
    if (opts.bump) {
      const parts = version.split(".").map(Number);
      if (opts.bump === "major") { parts[0]!++; parts[1] = 0; parts[2] = 0; }
      else if (opts.bump === "minor") { parts[1]!++; parts[2] = 0; }
      else if (opts.bump === "patch") { parts[2]!++; }
      else {
        console.error(chalk.red(`  Invalid bump level: '${opts.bump}'. Use: major, minor, patch`));
        process.exit(1);
      }
      version = parts.join(".");
      pluginManifest["version"] = version;

      // Write bumped version to source plugin.json BEFORE hashing
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify(pluginManifest, null, 2) + "\n",
        "utf-8"
      );
      console.log(chalk.cyan(`  Version bumped to ${version}`));
    }

    // Path validation for version (prevent traversal via manipulated version field)
    if (/[/\\]|\.\./.test(version)) {
      console.error(chalk.red(`  Version contains unsafe characters: '${version}'`));
      process.exit(1);
    }

    // Load or create marketplace.json
    const marketplacePath = path.resolve(cwd, opts.marketplace);
    let marketplace: MarketplaceManifest;

    if (fs.existsSync(marketplacePath)) {
      try {
        marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
      } catch (e: unknown) {
        console.error(chalk.red(`  Failed to parse marketplace.json: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    } else {
      console.log(chalk.yellow(`  marketplace.json not found — creating at ${marketplacePath}`));
      marketplace = {
        $schema: "https://agentboot.dev/schema/marketplace/v1",
        name: (pluginManifest["name"] as string) ?? "agentboot-personas",
        description: (pluginManifest["description"] as string) ?? "",
        maintainer: (pluginManifest["author"] as string) ?? "",
        entries: [],
      };
    }

    // Compute hash of plugin directory (now includes bumped version)
    const hash = createHash("sha256");
    function hashDir(dir: string): void {
      for (const entry of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          hashDir(full);
        } else {
          // Include relative path in hash for integrity (not just content)
          hash.update(path.relative(pluginDir, full));
          hash.update(fs.readFileSync(full));
        }
      }
    }
    hashDir(pluginDir);
    const sha256 = hash.digest("hex");

    // Create release entry
    const releasePath = `releases/v${version}/`;
    const entry: MarketplaceEntry = {
      type: "plugin",
      name: (pluginManifest["name"] as string) ?? "unknown",
      version,
      description: (pluginManifest["description"] as string) ?? "",
      published_at: new Date().toISOString(),
      sha256,
      path: releasePath,
    };

    // B7 fix: Dedup by type+name+version (preserves version history)
    const existingIdx = marketplace.entries.findIndex(
      (e) => e.type === "plugin" && e.name === entry.name && e.version === entry.version
    );
    if (existingIdx >= 0) {
      marketplace.entries[existingIdx] = entry;
    } else {
      marketplace.entries.push(entry);
    }

    if (dryRun) {
      console.log(chalk.gray(`  Would write marketplace.json with entry:`));
      console.log(chalk.gray(`    ${entry.name} v${entry.version} (${sha256.slice(0, 12)}...)`));
      console.log(chalk.gray(`  Would copy plugin to ${releasePath}`));
    } else {
      // Write updated marketplace.json
      fs.writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n", "utf-8");

      // Copy plugin to releases directory (version already bumped in source)
      const releaseDir = path.resolve(cwd, releasePath);
      fs.mkdirSync(releaseDir, { recursive: true });
      copyDirRecursive(pluginDir, releaseDir);

      console.log(chalk.green(`  ✓ Published ${entry.name} v${version}`));
      console.log(chalk.gray(`    SHA-256: ${sha256.slice(0, 12)}...`));
      console.log(chalk.gray(`    Path: ${releasePath}`));
    }

    console.log("");
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse();
