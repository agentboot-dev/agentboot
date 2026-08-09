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
 *   agentboot test [--behavioral] [--snapshot] [--regression]
 *   agentboot migrate [--path dir] [--revert] [--dry-run] [--org name]
 *   agentboot uninstall [--repo path] [--dry-run]
 *   agentboot config [key] [value]
 *   agentboot <command> --help
 */

import { Command, Option } from "commander";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import chalk from "chalk";
import { createHash } from "node:crypto";
import { ExitPromptError } from "@inquirer/core";
import { loadConfig, stripJsoncComments, validatePluginManifest, envHubConfig, DEFAULT_OUTPUT_FORMATS, unbuiltRepoPlatforms, type AgentBootConfig, type MarketplaceManifest, type MarketplaceEntry } from "./lib/config.js";
import { detectGitignoreConflicts } from "./lib/gitignore.js";
import { findManifestPath } from "./lib/drift.js";
import { PLATFORM_ENFORCEMENT, effectiveEmitters, resolveEnforcement, type CapabilityContext } from "./lib/conformance.js";
import {
  findHardArtifacts, capabilityViolations, capabilityShortfalls,
  countNarrowlyScopedInstructions, countScopedGotchas,
} from "./lib/guardrail-scan.js";
import { degradedFormats } from "./lib/scope-projection.js";
import {
  loadExceptionsFile, validateExceptions, HUB_EXCEPTIONS_FILE,
  type PolicyException,
} from "./lib/exceptions.js";
import { stampIdentity, mintId } from "./lib/artifact-identity.js";
import { checkDistFreshness, staleDistMessage, readDistStamp, type DistFreshness } from "./lib/dist-stamp.js";

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
    cwd: process.cwd(),
    stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit",
    env: { ...process.env },
    // Windows: `npx` is npx.cmd and can't be spawned without a shell (ENOENT).
    shell: process.platform === "win32",
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

/**
 * A3 / N1: refuse to REPORT GREEN against a dist/ that does not correspond to
 * the hub config.
 *
 * `drift-check` and `audit` both exited 0 in the N1 repro. Neither is wrong in
 * isolation — each spoke really did match its manifest, and the hub sources
 * really were healthy. What made the pair dangerous is what the operator reads
 * off them: "governance is in force." After a failed build the manifests
 * describe the policy that was in force BEFORE the edit, so a clean report is
 * a report about the superseded policy, delivered in the present tense.
 *
 * A dist/ that does not exist at all is NOT stale — it is unbuilt, which is a
 * legitimate state for a hub being audited before its first build. That case
 * says so out loud rather than passing quietly, because "I checked nothing" and
 * "I checked everything and it was fine" must not print the same.
 */
function assertDistFreshOrExit(configPath: string, config: AgentBootConfig, command: string): void {
  const distPath = path.resolve(path.dirname(configPath), config.output?.distPath ?? "./dist");
  if (!fs.existsSync(distPath)) {
    console.log(chalk.yellow(`  ⚠ dist/ has never been built — \`${command}\` cannot speak to what is deployed.`));
    return;
  }
  const freshness = checkDistFreshness(distPath, config, path.dirname(configPath));
  if (!freshness.fresh) {
    console.error(chalk.red(staleDistMessage(freshness, command)));
    process.exit(1);
  }
}

/**
 * R1-4: load a hub config, or say "this is not a hub" and exit 1.
 *
 * `loadConfig` THROWS when the file is absent. Every command action here is an
 * async function with no handler, so an unguarded call does not print an error —
 * it prints a raw Node stack trace and exits 7. Measured outside a hub before
 * this: `audit`, `drift-check`, `mcp-verify` and `telemetry-inspect` all did,
 * `--format json` included, so a machine consumer got a stack trace on stderr
 * where it expected JSON.
 *
 * `drift-check` had been given an fs.existsSync guard for exactly this and the
 * siblings had not — the recurring shape. One helper, and a test that runs every
 * command in an empty directory and asserts none of them emits a stack trace.
 */
function loadHubConfigOrExit(configPath: string, command: string): AgentBootConfig {
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`✗ No agentboot.config.json found — \`${command}\` needs a hub.`));
    console.error(chalk.gray(`    Looked for: ${configPath}`));
    console.error(chalk.gray("    Run it from a hub directory, or pass -c <path>."));
    process.exit(1);
  }
  try {
    return loadConfig(configPath);
  } catch (e: unknown) {
    console.error(chalk.red(`✗ Failed to read ${configPath}: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

/**
 * The `reports` posture (see scripts/lib/dist-consumers.ts).
 *
 * `doctor`, `status` and `lint` exist to TELL the operator what state the hub is
 * in. Exiting before their checks run would withhold the very answer they were
 * run to get — "why is my hub unhealthy?" is not usefully answered by refusing
 * to look. They print the same finding, in the same words as the gate, and get
 * it back so they can fold it into their own result and exit code.
 *
 * This is not a weaker posture. What is forbidden is SILENCE, not continuing:
 * `status` printing a successful-looking build time for a build that failed is
 * the defect; `status` printing "the last build FAILED" and carrying on is the
 * fix.
 *
 * Returns null when dist/ has never been built (nothing to be stale about), or
 * the failed freshness result otherwise.
 */
function reportDistFreshness(
  configPath: string,
  config: AgentBootConfig,
  command: string,
): DistFreshness | null {
  const distPath = path.resolve(path.dirname(configPath), config.output?.distPath ?? "./dist");
  if (!fs.existsSync(distPath)) return null;
  const freshness = checkDistFreshness(distPath, config, path.dirname(configPath));
  if (freshness.fresh) return null;
  console.error(chalk.red(staleDistMessage(freshness, command, "report")));
  return freshness;
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
  .command("baseline")
  .description("Archive a dated conformance snapshot — starts the platform-behaviour baseline (XP4)")
  .option("--config <path>", "path to agentboot.config.json")
  .option("--dir <path>", "archive directory (default: .agentboot/baseline)")
  .action(async (opts: { config?: string; dir?: string }) => {
    // XP4 / Continental Drift, pre-GA slice.
    //
    // Platforms change their semantics silently — a Tuesday release with no
    // changelog — and the corpus's TEXT does not move, so drift-check reports
    // green while the governance quietly stops working. Detecting that needs a
    // BASELINE, and a baseline cannot be backfilled: probes that begin at 1.4
    // cannot say how the platforms behaved at 1.0.
    //
    // This is deliberately only the archive. No analysis, no comparison, no
    // reporting surface — that is the Continental Drift epic and it is post-GA.
    // The point is to start a clock that cannot be restarted.
    const cwd = opts.config ? path.dirname(path.resolve(opts.config)) : process.cwd();
    const outDir = opts.dir ? path.resolve(opts.dir) : path.join(cwd, ".agentboot", "baseline");
    fs.mkdirSync(outDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Read the hub's configured distPath. Hardcoding `dist` meant a hub with
    // `output.distPath` set archived nothing, forever, on a schedule.
    const baselineConfigPath = opts.config
      ? path.resolve(opts.config)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
    const baselineConfig = fs.existsSync(baselineConfigPath) ? loadConfig(baselineConfigPath) : null;
    const distPath = baselineConfig
      ? path.resolve(path.dirname(baselineConfigPath), baselineConfig.output?.distPath ?? "./dist")
      : path.join(cwd, "dist");

    // The archive is meant to be citable years later. A snapshot taken off a
    // stale dist/ records the previous policy under today's date, which is worse
    // than a gap — a gap is visibly a gap.
    if (baselineConfig) assertDistFreshOrExit(baselineConfigPath, baselineConfig, "baseline");

    const manifests: Record<string, unknown> = {};
    // The point of the archive is OBSERVED platform behaviour. A manifest whose
    // every control is `untested`/`not-applicable` records no observation at
    // all — it is a snapshot of "we did not look".
    let observedProbes = 0;
    if (fs.existsSync(distPath)) {
      for (const platform of fs.readdirSync(distPath)) {
        const mf = path.join(distPath, platform, "enforcement-manifest.json");
        if (!fs.existsSync(mf)) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(mf, "utf-8")) as { controls?: Array<{ status?: string }> };
          manifests[platform] = parsed;
          observedProbes += (parsed.controls ?? [])
            .filter((c) => c.status === "pass" || c.status === "fail").length;
        } catch {
          manifests[platform] = { error: "unparseable enforcement-manifest.json" };
        }
      }
    }

    if (Object.keys(manifests).length === 0) {
      // Silence is not success: an empty archive must say so and fail, or the
      // baseline quietly accumulates nothing and looks healthy for a year.
      console.error(chalk.red(`  ✗ No enforcement manifests found in ${path.relative(cwd, distPath) || distPath}.`));
      console.error(chalk.gray("    Run `agentboot conformance` first — it writes dist/<platform>/enforcement-manifest.json."));
      console.error(chalk.gray("    Nothing was archived."));
      process.exit(1);
    }

    if (observedProbes === 0) {
      // A file count is not a measurement. Manifests exist here, so the
      // emptiness check above passes and the CI `find | wc -l` assertion passes
      // — while the snapshot contains zero probe results. Banking that as
      // history is worse than banking nothing, because it looks like history.
      console.error(chalk.red("  ✗ Every control in every manifest is untested or not-applicable — this snapshot records NO observed behaviour."));
      console.error(chalk.gray(`    ${Object.keys(manifests).length} manifest(s) present, 0 probes executed.`));
      console.error(chalk.gray("    A baseline of unmeasured platforms cannot answer \"how did the platform behave in August\" later."));
      console.error(chalk.gray("    Fix: make `agentboot conformance` produce real probe results (it needs bash, and a built dist/), then re-run."));
      console.error(chalk.gray("    Nothing was archived."));
      process.exit(1);
    }

    const snapshot = {
      schema: 1,
      capturedAt: new Date().toISOString(),
      agentbootVersion: getVersion(),
      note: "Point-in-time platform enforcement behaviour. Archive only — comparison is post-GA (Continental Drift).",
      observedProbes,
      platforms: manifests,
    };
    const outFile = path.join(outDir, `conformance-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf-8");

    const count = fs.readdirSync(outDir).filter((f) => f.startsWith("conformance-")).length;
    console.log(chalk.bold(`\n  ${chalk.green("✓")} Baseline archived`));
    console.log(chalk.gray(`    ${path.relative(cwd, outFile)}`));
    console.log(chalk.gray(`    ${Object.keys(manifests).length} platform(s) · ${observedProbes} observed probe(s) · ${count} snapshot(s) on record\n`));
  });

program
  .command("identity")
  .description("Stamp permanent artifact identifiers (decision-0005) — mints missing ids, refreshes content hashes")
  .option("--config <path>", "path to agentboot.config.json")
  .option("--dry-run", "report what would change without writing")
  .action(async (opts: { config?: string; dryRun?: boolean }) => {
    // decision-0005. Backfill exists because identity cannot be applied to the
    // past — every artifact that goes unstamped before the 1.0 tag can only ever
    // date from whenever it is finally stamped.
    const cwd = opts.config ? path.dirname(path.resolve(opts.config)) : process.cwd();
    const dirs = [
      path.join(cwd, "core", "instructions"),
      path.join(cwd, "core", "traits"),
      path.join(cwd, "core", "gotchas"),
    ];
    let minted = 0, refreshed = 0, skipped = 0, seen = 0;
    const collisions = new Map<string, string>();

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const full = path.join(dir, file);
        const before = fs.readFileSync(full, "utf-8");
        // Never stamp navigational files — a README is not a governed artifact.
        if (/^(README|index)\.md$/i.test(file)) { skipped++; seen++; continue; }
        const slug = file.replace(/\.(instructions|gotchas?)?\.?md$/, "").replace(/\.md$/, "");
        // Traits/gotchas carry no frontmatter by convention; create it for them.
        const r = stampIdentity(before, { slug, createFrontmatter: true });
        seen++;
        if (!r.changed) { skipped++; continue; }

        const id = r.content.match(/^id:\s*(\S+)$/m)?.[1];
        if (id) {
          const prior = collisions.get(id);
          // Should be impossible, but a duplicated id silently merges two
          // artifacts' histories forever — worth one comparison to never find out.
          if (prior) {
            console.error(chalk.red(`  ✗ duplicate id ${id}: ${prior} and ${path.relative(cwd, full)}`));
            process.exit(1);
          }
          collisions.set(id, path.relative(cwd, full));
        }

        if (r.minted) minted++; else refreshed++;
        if (!opts.dryRun) fs.writeFileSync(full, r.content, "utf-8");
        console.log(chalk.gray(`  ${r.minted ? "mint " : "hash "} ${path.relative(cwd, full)}`));
      }
    }

    const verb = opts.dryRun ? "would be" : "";
    console.log(chalk.bold(`\n  ${seen} artifact(s) scanned`));
    console.log(`  ${chalk.green(String(minted))} id(s) ${verb} minted · ${refreshed} hash(es) ${verb} refreshed · ${skipped} unchanged`);
    if (opts.dryRun) console.log(chalk.yellow("  --dry-run: nothing written"));
    console.log("");
  });

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
  .option("--adopt-existing", "allow a FIRST sync to replace pre-existing bespoke instruction files (they are archived; consider import first)")
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
    if (opts.adoptExisting) {
      args.push("--adopt-existing");
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
      {
        cwd: ROOT,
        stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit",
        // Windows: `npx` is npx.cmd and needs a shell to resolve (ENOENT otherwise).
        shell: process.platform === "win32",
      },
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
      {
        cwd: ROOT,
        stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit",
        // Windows: `npx` is npx.cmd and needs a shell to resolve (ENOENT otherwise).
        shell: process.platform === "win32",
      },
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
      {
        cwd: ROOT,
        stdio: quiet ? ["inherit", "ignore", "pipe"] : "inherit",
        // Windows: `npx` is npx.cmd and needs a shell to resolve (ENOENT otherwise).
        shell: process.platform === "win32",
      },
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
  .option("--non-interactive", "run without prompts (uses env var defaults)")
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

// §I: user-level (~/.claude) install. AgentBoot is the default provider for the
// user-level slot; if another tool manages ~/.claude (a ~/.claude/.managed
// sentinel, or userLevel.mode: "manifest"), it stages for handoff instead.
program
  .command("install-user")
  .description("Install compiled skills/rules to ~/.claude (or stage for an external manager)")
  .option("--dry-run", "show what would be written/staged without changing anything")
  .option("--mode <mode>", "override the write mode: auto (default), direct, or manifest")
  .action(async (opts, cmd) => {
    if (opts.mode && !["auto", "direct", "manifest"].includes(opts.mode)) {
      console.error(chalk.red("--mode must be one of: auto, direct, manifest"));
      process.exit(1);
    }
    const { installUserLevel } = await import("./lib/user-scope.js");
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config as string)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
    const config = fs.existsSync(configPath) ? loadConfig(configPath) : undefined;
    // A2-residual: install-user is a SECOND delivery channel — it writes org
    // policy onto a developer's machine — and its only precondition was
    // fs.existsSync(distCore). That is existence read as freshness, the exact
    // pattern the sync gate was written to kill: a failed build leaves dist/
    // byte-identical, so a revoked control installs with two green ticks.
    if (config) assertDistFreshOrExit(configPath, config, "install-user");
    const distCore = path.join(cwd, config?.output?.distPath ?? "./dist", "claude", "core");
    if (!fs.existsSync(distCore)) {
      console.error(chalk.red("dist/claude/core not found — run `agentboot build` first."));
      process.exit(1);
    }

    const effectiveConfig = opts.mode
      ? { ...(config ?? {}), userLevel: { mode: opts.mode } }
      : config;

    console.log(chalk.bold("\nAgentBoot — install-user\n"));
    const res = installUserLevel(distCore, effectiveConfig as AgentBootConfig, { dryRun: opts.dryRun });

    if (res.mode === "direct") {
      const r = res.direct!;
      for (const e of r.errors) console.log(chalk.red(`  ✗ ${e}`));
      console.log(chalk.green(`  ✓ ${opts.dryRun ? "Would write" : "Wrote"} ${r.skillsWritten.length} skill file(s) + ${r.rulesWritten.length} rule file(s) to ~/.claude/`));
      // E1: report the withdrawal explicitly. "0 revoked" and "pruning never
      // ran" must not print identically — that equivalence is what let a
      // revoked user-level artifact sit on disk, untracked, indefinitely.
      const removedUser = r.pruned.filter((p) => p.status === "removed");
      const blockedUser = r.pruned.filter((p) => p.status === "blocked");
      if (removedUser.length > 0) {
        console.log(chalk.green(`  ✓ ${opts.dryRun ? "Would withdraw" : "Withdrew"} ${removedUser.length} revoked artifact(s) from ~/.claude/`));
        for (const p of removedUser) console.log(chalk.gray(`      ${p.path}`));
      } else {
        console.log(chalk.gray(`  ~/.claude/ pruned: 0 revoked artifact(s)`));
      }
      if (blockedUser.length > 0) {
        // Not an error: a local edit is a decision. But it must be SEEN — the
        // artifact is revoked at the hub and still active on this machine.
        console.log(chalk.yellow(`  ⚠ ${blockedUser.length} revoked artifact(s) kept — edited locally, still active:`));
        for (const p of blockedUser) console.log(chalk.yellow(`      ${p.path}`));
        console.log(chalk.gray(`    Remove with: agentboot uninstall --user`));
      }
      for (const s of r.skipped) console.log(chalk.gray(`  – skipped ${s}`));
      if (r.errors.length) process.exit(1);
    } else {
      const s = res.staged!;
      for (const e of s.errors) console.log(chalk.red(`  ✗ ${e}`));
      console.log(chalk.yellow(`  ~/.claude is externally managed — ${opts.dryRun ? "would stage" : "staged"} ${s.staged.length} file(s) for handoff.`));
      console.log(chalk.gray(`  Staging dir: ${s.stagingDir}`));
      console.log(chalk.gray(`  Manifest:    ${s.manifestPath}`));
      if (s.errors.length) process.exit(1);
    }
    console.log("");
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
  .option("--non-interactive", "run without prompts (auto-apply high-confidence matches)")
  .option("--retry-failed", "retry previously timed-out files from .agentboot-import-failed.json")
  .option("--isolated", "test prompts without user Claude settings (uses temp config)")
  .option("--url <github-url>", "import from a GitHub URL (repo or raw file)")
  .action(async (opts) => {
    const parentDir = opts["parent"] as string | undefined;
    const urlOpt = opts["url"] as string | undefined;

    // Phase 11 B2: Handle --url flag
    if (urlOpt) {
      const { importFromUrl, AgentBootError } = await import("./lib/import.js");
      const hubPath = opts["hubPath"] as string | undefined ?? process.cwd();
      console.log(chalk.cyan(`\n  Importing from URL: ${urlOpt}\n`));
      try {
        const result = await importFromUrl(urlOpt, hubPath);
        console.log(chalk.green(`  ✓ Downloaded ${result.type} to ${result.tempDir}`));
        console.log(chalk.gray(`    Run 'agentboot import --path ${result.tempDir}' to classify content.\n`));
      } catch (err) {
        if (err instanceof AgentBootError) process.exit(err.exitCode);
        console.error(chalk.red(`  ✗ ${(err as Error).message}\n`));
        process.exit(1);
      }
      return;
    }

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
            `\n  ✓ Created: ${result.created}, Updated: ${result.updated}, Applied: ${result.applied}, Skipped: ${result.skipped}` +
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
          nonInteractive: opts["nonInteractive"] as boolean | undefined,
          retryFailed: opts["retryFailed"] as boolean | undefined,
        });
      }
    };
    try {
      if (opts["isolated"]) {
        const { withIsolatedClaude } = await import("./prompts/index.js");
        console.log(chalk.yellow("  Running in isolated mode — using temporary Claude config (your settings are untouched).\n"));
        await withIsolatedClaude(async () => {
          // UI fail-fast: isolation usually removes Claude Code auth. Probing now —
          // before any scanning/classification work — turns a silent mid-import
          // degradation to manual mode into an up-front, actionable message.
          const { probeAnyProvider } = await import("./lib/llm-provider.js");
          const available = probeAnyProvider();
          if (!available) {
            console.log(chalk.yellow(
              "  ⚠ No LLM available under the isolated config.\n" +
              "    Classification will run in MANUAL mode: the import plan will contain\n" +
              "    empty classifications for you to fill in by hand.\n" +
              "    For LLM classification, either:\n" +
              "      - run without --isolated (uses your logged-in Claude Code), or\n" +
              "      - set ANTHROPIC_API_KEY (or OPENAI_API_KEY / GOOGLE_API_KEY) for this run.\n"
            ));
          } else {
            console.log(chalk.gray(`  LLM available in isolated mode: ${available}\n`));
          }
          await run();
        });
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
  .description("Scaffold a persona, trait, instruction, gotcha, domain, hook, or template — or classify a prompt")
  .argument("<type>", "what to add: persona, trait, instruction, gotcha, domain, hook, prompt, template")
  .argument("<name>", "name for the new item (lowercase-with-hyphens); for template, the template name")
  .action(async (type: string, name: string, _opts, cmd) => {
    // Validate name format (skip for prompt type — name is content/path, not an identifier)
    if (type !== "prompt" && !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
      console.error(chalk.red(`Name must be 1-64 lowercase alphanumeric chars with hyphens: got '${name}'`));
      process.exit(1);
    }

    // Scaffold into the resolved hub, not blindly cwd: honor --config /
    // AGENTBOOT_HUB so `add persona foo --config <hub>` writes into <hub>.
    const globalOpts = cmd.optsWithGlobals();
    const hubConfig = globalOpts.config ? path.resolve(globalOpts.config as string) : envHubConfig();
    const cwd = hubConfig ? path.dirname(hubConfig) : process.cwd();

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

    } else if (type === "instruction") {
      // The docs tell operators that org-wide instructions live in
      // core/instructions/, but `add` had no scaffold for that artifact type and
      // neither the filename convention (`.instructions.md`) nor the frontmatter
      // schema was documented anywhere. The only way to discover either was to
      // read compiled output in dist/ — so an assistant working from the docs
      // could not author one, and a guessed schema produces a file build ignores.
      const instructionsDir = path.join(cwd, "core", "instructions");
      const instructionPath = path.join(instructionsDir, `${name}.instructions.md`);
      if (fs.existsSync(instructionPath)) {
        console.error(chalk.red(`Instruction '${name}' already exists at core/instructions/${name}.instructions.md`));
        process.exit(1);
      }

      if (!fs.existsSync(instructionsDir)) {
        fs.mkdirSync(instructionsDir, { recursive: true });
      }

      // decision-0005: every artifact is born with a permanent identifier.
      // Minted at creation because identity cannot be applied retroactively —
      // an id added later can only date from later.
      const instructionMd = `---
id: ${mintId()}
slug: ${name}
description: "TODO — brief description of this instruction"
# applyTo is a comma-separated glob list. "**" = always on, every file.
# NARROWING this requires \`scope-unsupported: acknowledged\` below when any
# configured target cannot express path scoping (claude, skill, plugin, agents,
# codex, gemini) — those platforms deliver the rule always-on, with a Scope:
# preamble in the emitted file. Cursor, Windsurf and JetBrains receive the exact
# scope; Copilot reads applyTo natively.
applyTo: "**"
# scope-unsupported: acknowledged
# Uncomment to make this a HARD guardrail that lower scopes cannot override or
# downgrade. Without it the instruction is a soft preference teams may adapt.
# guardrail: hard
# Reserved (XP3): declared change-rate for this artifact. Nothing consumes it yet.
#   constitutional — rare, high ceremony, decade-scale
#   statutory      — normal review, year-scale
#   ephemeral      — write it in a morning, expires, no ceremony
# tier: statutory
---

# ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}

<!-- Always-on guidance compiled into every platform's instruction surface.
     Keep it short: this is loaded on every session, so it competes for context. -->

- **TODO:** First instruction — state the rule AND the reason behind it
`;

      fs.writeFileSync(instructionPath, instructionMd, "utf-8");

      console.log(chalk.bold(`\n${chalk.green("✓")} Created instruction: ${name}\n`));
      console.log(chalk.gray(`  core/instructions/${name}.instructions.md\n`));
      console.log(chalk.gray(`  Next: Edit applyTo: to scope it, and uncomment guardrail: hard to make it non-overridable.\n`));

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
# Parse JSON with node (guaranteed present wherever the harness runs) rather than
# jq, which is not installed on Windows/git-bash — keeps this hook portable.
EVENT_NAME=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(String(JSON.parse(d).hook_event_name||''))}catch{process.stdout.write('')}})")

# TODO: Add your compliance logic here
# Example: block a tool if a condition is met
# if [ "$EVENT_NAME" = "PreToolUse" ]; then
#   TOOL=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(String(JSON.parse(d).tool_name||''))}catch{process.stdout.write('')}})")
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

    } else if (type === "template") {
      // §L: install a pre-packaged harness bundle from the shipped templates.
      // A template is a ready-to-tune set of hub files (persona + config, etc.)
      // that maps directly into the user's hub layout.
      const harnessDir = path.join(ROOT, "templates", "harness");
      const templateDir = path.join(harnessDir, name);
      const manifestPath = path.join(templateDir, "template.json");

      if (!fs.existsSync(manifestPath)) {
        const available = fs.existsSync(harnessDir)
          ? fs.readdirSync(harnessDir).filter((d) => fs.existsSync(path.join(harnessDir, d, "template.json")))
          : [];
        console.error(chalk.red(`Unknown template: '${name}'.`));
        if (available.length > 0) {
          console.error(chalk.gray(`  Available templates: ${available.join(", ")}`));
        }
        process.exit(1);
      }

      let manifest: { name?: string; activation?: string };
      try {
        manifest = JSON.parse(stripJsoncComments(fs.readFileSync(manifestPath, "utf-8")));
      } catch {
        console.error(chalk.red(`Template '${name}' has an unreadable template.json`));
        process.exit(1);
        return;
      }

      const filesRoot = path.join(templateDir, "files");
      if (!fs.existsSync(filesRoot)) {
        console.error(chalk.red(`Template '${name}' has no files/ payload`));
        process.exit(1);
      }

      // Collect the payload (recursive), then check for conflicts BEFORE writing
      // anything — an `add template` either applies cleanly or not at all.
      const toCopy: Array<{ src: string; rel: string }> = [];
      const walk = (dir: string, rel: string): void => {
        for (const entry of fs.readdirSync(dir)) {
          const abs = path.join(dir, entry);
          const r = rel ? `${rel}/${entry}` : entry;
          if (fs.statSync(abs).isDirectory()) walk(abs, r);
          else toCopy.push({ src: abs, rel: r });
        }
      };
      walk(filesRoot, "");

      const conflicts = toCopy.filter((f) => fs.existsSync(path.join(cwd, f.rel)));
      if (conflicts.length > 0) {
        console.error(chalk.red(`Refusing to overwrite existing files:`));
        for (const c of conflicts) console.error(chalk.gray(`  ${c.rel}`));
        process.exit(1);
      }

      for (const f of toCopy) {
        const dest = path.join(cwd, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(f.src, dest);
      }

      console.log(chalk.bold(`\n${chalk.green("✓")} Added template: ${manifest.name ?? name}\n`));
      for (const f of toCopy) console.log(chalk.gray(`  ${f.rel}`));
      if (manifest.activation) {
        console.log(chalk.gray(`\n  ${manifest.activation}\n`));
      }

    } else {
      console.error(chalk.red(`Unknown type: '${type}'. Use: persona, trait, instruction, gotcha, domain, hook, prompt, template`));
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

    // Respect AGENTBOOT_HUB env var so doctor can run from any directory
    const hubEnv = process.env["AGENTBOOT_HUB"];
    const cwd = hubEnv ? path.resolve(hubEnv) : process.cwd();
    if (hubEnv) {
      if (!fs.existsSync(path.join(cwd, "agentboot.config.json"))) {
        const msg = `AGENTBOOT_HUB is set but doesn't appear to be a valid hub (missing agentboot.config.json)`;
        if (isJson) {
          console.log(JSON.stringify({ issues: 1, issuesFound: 1, issuesFixed: 0, checks: [{ name: msg, status: "fail", message: msg }] }, null, 2));
        } else {
          console.log(chalk.yellow(`  ⚠ ${msg}`));
          console.log(chalk.gray(`    AGENTBOOT_HUB=${hubEnv}\n`));
        }
      }
      if (!isJson) {
        console.log(chalk.gray(`  Hub: ${cwd} (from AGENTBOOT_HUB)\n`));
      }
    }

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
    // The floor is package.json engines (>=22) — doctor must agree with it,
    // not advertise a laxer one.
    const nodeV = process.version;
    const nodeMajor = parseInt(nodeV.slice(1), 10);
    if (nodeMajor >= 22) ok(`Node.js ${nodeV}`);
    else fail(`Node.js ${nodeV} — requires >=22 (package.json engines)`);

    const gitResult = spawnSync("git", ["--version"], { encoding: "utf-8", timeout: 10_000 });
    if (gitResult.status === 0) ok(gitResult.stdout.trim());
    else fail("git not found");

    const claudeResult = spawnSync("claude", ["--version"], { encoding: "utf-8", timeout: 10_000 });
    if (claudeResult.status === 0) ok(`Claude Code ${claudeResult.stdout.trim()}`);
    else warn("Claude Code not found (optional)");

    if (!isJson) console.log("");

    // 2. Configuration
    if (!isJson) console.log(chalk.cyan("Configuration"));
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");

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

        // B.1: gitignore conflicts across synced repos. A managed file that a repo's
        // .gitignore excludes is invisible to the team AND to drift-check, silently
        // defeating governance. Blocker (fail → exit 1); not auto-fixable because
        // editing a repo's .gitignore needs human intent (why was the pattern there?).
        if (fs.existsSync(fullReposPath)) {
          try {
            const reposArr = JSON.parse(
              stripJsoncComments(fs.readFileSync(fullReposPath, "utf-8")),
            ) as Array<{ path?: string; label?: string }>;
            let anyConflict = false;
            let checkedAnyRepo = false;
            for (const r of Array.isArray(reposArr) ? reposArr : []) {
              if (!r?.path) continue;
              const repoPath = path.resolve(path.dirname(configPath), r.path);
              if (!fs.existsSync(repoPath)) continue;
              const manifestPath = findManifestPath(repoPath);
              if (!manifestPath) continue; // never synced — nothing managed to check
              let managed: string[] = [];
              try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
                  files?: Array<{ path: string }>;
                };
                managed = (manifest.files ?? []).map((f) => f.path).filter(Boolean);
              } catch {
                continue;
              }
              checkedAnyRepo = true;
              const conflicts = detectGitignoreConflicts(repoPath, managed);
              if (conflicts.length > 0) {
                anyConflict = true;
                const label = r.label ?? path.basename(r.path);
                const first = conflicts[0]!;
                const where = first.source
                  ? ` (rule: ${first.source}${first.fromGlobal ? " — your GLOBAL gitignore, not this repo" : ""})`
                  : "";
                fail(
                  `${conflicts.length} managed file(s) gitignored in ${label} — synced but not committed (e.g. ${first.file}${where}); ${first.fromGlobal ? "edit your global excludes file" : "remove or anchor the .gitignore pattern"}`,
                );
              }
            }
            if (checkedAnyRepo && !anyConflict) ok("No gitignore conflicts in synced repos");

            // A4: repos.json targets a platform the hub does not build. sync
            // refuses at ship time, but only for the repos that run — this is a
            // static contradiction between two files, and doctor is where a
            // static contradiction belongs. fail(), not warn(): the repo will
            // NEVER receive anything.
            const entries = (Array.isArray(reposArr) ? reposArr : []) as Array<{
              label?: string; path?: string; platform?: string; platforms?: string[];
            }>;
            const declaredFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
            const unbuilt = unbuiltRepoPlatforms(entries, declaredFormats);
            for (const u of unbuilt) {
              fail(
                `repos.json targets \`${u.platform}\` but personas.outputFormats = [${declaredFormats.join(", ")}] — ` +
                `${u.repos.join(", ")} can never be synced`,
              );
            }
            if (entries.length > 0 && unbuilt.length === 0) {
              ok(`Every repos.json platform is built by the hub`);
            }
          } catch {
            // repos.json unparseable — the check above already surfaced that.
          }
        }

        // Check dist/
        //
        // V5: `dist/ exists (built)` was a green tick for a tree whose last
        // build FAILED — in the one command an operator runs to ask whether
        // the hub is healthy. Existence is not builtness. doctor takes the
        // `reports` posture (dist-consumers.ts): it says what is wrong instead
        // of refusing to run its other checks, and the finding counts as a
        // FAILED check, so `doctor` still exits non-zero.
        const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
        if (fs.existsSync(distPath)) {
          const distFreshness = checkDistFreshness(distPath, config, path.dirname(configPath));
          if (distFreshness.fresh) {
            ok(`dist/ exists and its last build succeeded against this config`);
          } else {
            fail(
              `dist/ exists but is NOT trustworthy — ${distFreshness.reason}. ` +
              `A failed build leaves the previous dist/ byte-identical, so the files being ` +
              `there is not evidence they reflect current policy. Fix: run \`agentboot build\` ` +
              `and let it succeed.`,
            );
          }
        } else if (fixMode) {
          if (!isJson) console.log(`  ${chalk.cyan("→")} Building dist/...`);
          if (!dryRun) {
            const compileScript = path.join(SCRIPTS_DIR, "compile.ts");
            const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
            const buildResult = spawnSync(tsx, [compileScript], {
              cwd,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              // Windows: the .bin/tsx shim is tsx.cmd — resolve it via the shell
              // (otherwise spawnSync ENOENTs and doctor --fix reports a false build failure).
              shell: process.platform === "win32",
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

        // AB-120: Composition diagnostics
        if (!isJson) { console.log(""); console.log(chalk.cyan("Composition")); }

        // 120a: Missing composition manifests
        const distPath2 = path.resolve(cwd, config.output?.distPath ?? "./dist");
        if (fs.existsSync(distPath2)) {
          const manifestPath = path.join(distPath2, "claude", "core", "composition-manifest.json");
          if (fs.existsSync(manifestPath)) {
            ok("Composition manifest found in dist/");
          } else {
            warn("dist/ exists but no composition-manifest.json — rebuild with `agentboot build`");
          }
        }

        // 120b: Orphaned composition overrides
        const overrides = (config.composition as Record<string, unknown> | undefined)?.["overrides"] as Record<string, string> | undefined;
        if (overrides && typeof overrides === "object") {
          for (const [filePath] of Object.entries(overrides)) {
            const fullOverridePath = path.join(cwd, filePath);
            if (!fs.existsSync(fullOverridePath)) {
              warn(`Orphaned composition override: "${filePath}" does not exist`);
            }
          }
          if (Object.keys(overrides).length > 0) {
            const orphanCount = Object.keys(overrides).filter(
              fp => !fs.existsSync(path.join(cwd, fp))
            ).length;
            if (orphanCount === 0) ok(`All ${Object.keys(overrides).length} composition overrides reference existing files`);
          }
        }

        // 120c: Shadow detection (filename collisions across scopes)
        const coreDir = path.join(cwd, "core");
        const groupsDir = path.join(cwd, "groups");
        const teamsDir = path.join(cwd, "teams");
        const coreFiles = new Set<string>();
        if (fs.existsSync(coreDir)) {
          function walkCore(dir: string): void {
            for (const entry of fs.readdirSync(dir)) {
              const full = path.join(dir, entry);
              if (fs.statSync(full).isDirectory()) walkCore(full);
              else if (full.endsWith(".md")) coreFiles.add(path.relative(coreDir, full).replace(/\\/g, "/"));
            }
          }
          walkCore(coreDir);
        }
        let shadowCount = 0;
        function checkShadows(scopeDir: string, _scopeLabel: string): void {
          if (!fs.existsSync(scopeDir)) return;
          function walkScope(dir: string): void {
            for (const entry of fs.readdirSync(dir)) {
              const full = path.join(dir, entry);
              if (fs.statSync(full).isDirectory()) walkScope(full);
              else if (full.endsWith(".md")) {
                const rel = path.relative(scopeDir, full).replace(/\\/g, "/");
                if (coreFiles.has(rel)) { shadowCount++; }
              }
            }
          }
          walkScope(scopeDir);
        }
        if (fs.existsSync(groupsDir)) {
          for (const g of fs.readdirSync(groupsDir)) {
            const gp = path.join(groupsDir, g);
            if (fs.statSync(gp).isDirectory()) checkShadows(gp, `groups/${g}`);
          }
        }
        if (fs.existsSync(teamsDir)) {
          for (const g of fs.readdirSync(teamsDir)) {
            const gp = path.join(teamsDir, g);
            if (!fs.statSync(gp).isDirectory()) continue;
            for (const t of fs.readdirSync(gp)) {
              const tp = path.join(gp, t);
              if (fs.statSync(tp).isDirectory()) checkShadows(tp, `teams/${g}/${t}`);
            }
          }
        }
        if (shadowCount > 0) {
          warn(`${shadowCount} scope shadow(s) found — run \`agentboot validate\` for details`);
        } else if (coreFiles.size > 0) {
          ok("No scope shadows detected");
        }

        // AB-121: Tool/format consistency check
        if (!isJson) { console.log(""); console.log(chalk.cyan("Consistency")); }
        const tools = (config.agents as Record<string, unknown> | undefined)?.["tools"] as string[] | undefined;
        const formats = config.personas?.outputFormats as string[] | undefined;
        if (tools && formats) {
          const TOOL_FORMAT_MAP: Record<string, string> = {
            "copilot": "copilot", "cursor": "cursor", "claude-code": "claude",
            "claude": "claude", "agents": "agents",
          };
          for (const tool of tools) {
            const expectedFormat = TOOL_FORMAT_MAP[tool];
            if (expectedFormat && !formats.includes(expectedFormat)) {
              warn(
                `agents.tools includes "${tool}" but personas.outputFormats is missing "${expectedFormat}" — ` +
                `add "${expectedFormat}" to outputFormats to generate output for this platform`
              );
            }
          }
          const noMismatch = tools.every(t => {
            const ef = TOOL_FORMAT_MAP[t];
            return !ef || formats.includes(ef);
          });
          if (noMismatch) ok("Tool and output format configuration is consistent");
        } else {
          ok("Tool/format consistency (no agents.tools configured)");
        }

        // Capability coverage (2026-08-08). Coverage answers "was it emitted at
        // all?"; Enforcement answers "how strongly?". Coverage is the prior
        // question and must be read first: an operator who learns "cursor is
        // advisory" already knew that, and still does not learn that their
        // PreToolUse hook produced zero files.
        if (!isJson) { console.log(""); console.log(chalk.cyan("Coverage")); }
        {
          // A5: was `?? []` — Coverage iterated over zero platforms and printed
          // clean for every hub that omits personas.outputFormats.
          const covFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
          const narrow = countNarrowlyScopedInstructions(
            [path.join(ROOT, "core", "instructions"), path.join(cwd, "core", "instructions")],
            config.instructions?.enabled,
          );
          const scopedG = countScopedGotchas(path.join(cwd, "core", "gotchas"));
          const capCtx: CapabilityContext = {
            config, narrowlyScopedInstructions: narrow, scopedGotchas: scopedG,
          };
          let activeEx: PolicyException[] = [];
          try {
            const loaded = loadExceptionsFile(path.join(cwd, HUB_EXCEPTIONS_FILE));
            if (loaded.length > 0) activeEx = validateExceptions(loaded).active;
          } catch { /* unreadable → treated as empty, so the gate still fires */ }

          const capViolations = capabilityViolations(capCtx, covFormats, activeEx);
          if (capViolations.length === 0) {
            ok("Capability coverage — every configured capability has a target that emits it");
          } else {
            for (const v of capViolations) {
              // B1: report the EFFECTIVE emitters. Naming a platform whose
              // emitter is itself gated on a format this hub does not build
              // would send the operator to add a target that changes nothing.
              const effective = effectiveEmitters(v.row, covFormats);
              const needs = v.row.emittedBy.length === 0
                ? "implemented on no platform"
                : effective.length === 0
                  ? `needs one of: ${v.row.emittedBy.join(", ")} — every emitter for this key is gated on a format this hub does not build`
                  : `needs one of: ${effective.join(", ")}`;
              if (v.waivedBy) {
                warn(`${v.row.id} — gap accepted under ${v.waivedBy.id} (owner: ${v.waivedBy.owner}, expires ${v.waivedBy.expires})`);
              } else if (v.row.severity === "error") {
                // fail() drives the exit code; warn() does not. That distinction
                // is the whole point of the severity split.
                fail(`${v.row.id} — configured, but ${needs}`);
              } else {
                warn(`${v.row.id} — configured, but ${needs}`);
              }
            }
          }

          // H5: the OTHER axis — a capability that reaches some configured
          // platforms and not others. `capabilityViolations` is the
          // reaches-nothing gate by design; partial coverage went unreported by
          // ANY per-capability surface, so the only signal was the platform-level
          // Enforcement advisory below, which does not say WHICH control fails to
          // reach WHICH target. "Your hub has advisory platforms" is read once
          // and stopped being seen; "denyTools does not reach cursor, gemini" is
          // actionable.
          //
          // Advisory, never fail(): partial coverage is the normal state of a
          // multi-platform org, and a gate that fires on the normal state is how
          // a check becomes noise inside a week.
          const shortfalls = capabilityShortfalls(capCtx, covFormats);
          for (const sf of shortfalls) {
            warn(
              `${sf.row.id} — reaches ${sf.honoured.join(", ")} but NOT ${sf.missing.join(", ")}; ` +
              `on those targets this control is absent, not weaker`,
            );
          }
          if (shortfalls.length === 0 && capViolations.length === 0 && covFormats.length > 1) {
            ok("Capability coverage — every configured capability reaches every configured platform");
          }
        }

        // B12: enforcement honesty — when the org has configured HARD policy
        // (managed guardrails, deny lists, blocking output scan), say plainly
        // which output platforms can actually enforce it and which only receive
        // instructions. Ambiguity here is how compliance theater happens.
        if (!isJson) { console.log(""); console.log(chalk.cyan("Enforcement")); }
        // The trigger reads BOTH planes. `guardrail: hard` is an ARTIFACT-level
        // declaration, and deriving this from config keys alone is what let a HARD
        // guardrail ship to platforms that cannot enforce it behind a green report
        // (confirmed 2026-08-07). Same scan the compiler uses.
        const hardArtifacts = findHardArtifacts({
          instructions: [path.join(cwd, "core", "instructions")],
          traits: [path.join(cwd, "core", "traits")],
        });
        const hasHardPolicy =
          Boolean(config.managed?.enabled) ||
          Boolean(config.managed?.guardrails?.denyTools?.length) ||
          Boolean(config.claude?.permissions?.deny?.length) ||
          Boolean(config.compliance?.outputScan?.blocking) ||
          // A fail-closed DLP scanner is hard policy by any definition. Its
          // omission is why doctor printed "no hard org policy configured"
          // against a config declaring one (observed 2026-08-08).
          Boolean(config.compliance?.inputScan?.scannerCommand) ||
          hardArtifacts.length > 0;
        // A5: was `?? []` — same absent-gate defect as Coverage above.
        const enforcementFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
        // D2: the classification is the conformance harness's SSOT — doctor
        // reads the same table `agentboot conformance` tests empirically.
        if (hasHardPolicy) {
          if (hardArtifacts.length > 0) {
            const acked = hardArtifacts.filter(a => a.acknowledgedAdvisory).length;
            ok(
              `${hardArtifacts.length} artifact(s) declare \`guardrail: hard\`` +
              (acked > 0 ? ` (${acked} acknowledged as advisory-only on unenforceable targets)` : "")
            );
          }
          for (const fmt of enforcementFormats) {
            if (!PLATFORM_ENFORCEMENT[fmt]) {
              // Previously `continue` — a platform dropped from the Enforcement
              // report with no trace, in a function whose entire job is honesty.
              // The compile-time coverage assertion makes this unreachable, which
              // is exactly why it should say so rather than skip.
              warn(`${fmt}: no enforcement classification — cannot state whether org policy is enforced here`);
              continue;
            }
            // B2: resolve against THIS build. doctor positively asserted
            // "✓ plugin: org policy is enforceable — bundles Claude Code hooks"
            // on a plugin-only hub whose dist/plugin/ had no hooks.json. The
            // operator was not merely un-warned, they were reassured.
            const e = resolveEnforcement(fmt, enforcementFormats);
            if (e.unmetRequires.length > 0) {
              // fail(), not warn(): the org configured HARD policy and this
              // target has no mechanism at all. Nothing is degraded here —
              // nothing exists.
              fail(`${fmt}: org policy is NOT enforced here — ${e.detail}`);
            } else if (e.level === "enforced") {
              ok(`${fmt}: org policy is enforceable — ${e.detail}`);
            } else {
              warn(
                `${fmt}: org policy is ${e.level.toUpperCase()} on this platform — ${e.detail}. ` +
                `Prompt instructions are not a security boundary; see docs/platform-capability-matrix.md`
              );
            }
          }
        } else {
          ok("Enforcement (no hard org policy configured — nothing requires platform enforcement)");
        }

        // F-6: scoping is a THIRD question — not "how strongly is it enforced"
        // but "did the target even receive the scope the operator wrote".
        if (!isJson) { console.log(""); console.log(chalk.cyan("Scoping")); }
        {
          const degraded = degradedFormats(enforcementFormats);
          const scopedNarrow = countNarrowlyScopedInstructions(
            [path.join(ROOT, "core", "instructions"), path.join(cwd, "core", "instructions")],
            config.instructions?.enabled,
          );
          if (degraded.length === 0 || scopedNarrow === 0) {
            ok("Path scoping is expressible on every configured target");
          } else {
            // warn(), not fail(): a correctly-authored hub's doctor exit code
            // must not change. The BUILD is where an unacknowledged scope
            // stops the pipeline.
            warn(
              `${scopedNarrow} scoped instruction(s) delivered always-on on ${degraded.join(", ")} ` +
              `(acknowledged on the artifact; the emitted files carry a Scope: preamble)`,
            );
          }
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

// ---- test (AB-123/124) — behavioral and snapshot testing ------------------

program
  .command("test")
  .description("Run behavioral and snapshot tests for personas")
  .option("--behavioral", "run behavioral tests (requires LLM, costs money)")
  .option("--snapshot", "create or update snapshot baseline from current dist/")
  .option("--regression", "compare current dist/ against saved snapshot")
  .option("--test-dir <dir>", "directory with behavioral test YAML files", "tests/behavioral")
  // The LLM-as-Judge evaluation is not part of the advertised v1.0 surface —
  // its flags are hidden (still functional, just not surfaced in help).
  .addOption(new Option("--judge", "run LLM-as-Judge evaluation tests (5-dimension scoring)").hideHelp())
  .addOption(new Option("--verbose", "show detailed rationale per dimension (for --judge)").hideHelp())
  .addOption(new Option("--min-score <score>", "minimum passing score for --judge (default: 3.0)").argParser(parseFloat).hideHelp())
  .option("--snapshot-file <path>", "path to snapshot baseline file", ".agentboot-snapshot.json")
  .option("--allow-unevaluated", "proceed when scenario expectations have no mechanical evaluator (the count is still reported)")
  .action(async (opts, cmd) => {
    const {
      runBehavioralTestsDetailed, createSnapshot, compareSnapshots,
      saveSnapshot, loadSnapshot, printSnapshotDiff,
    } = await import("./lib/test-runner.js");

    // -c/--config is a program-level global; read the merged view and let the
    // explicit flag win (the documented "explicit flag always wins" contract).
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config as string)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
    const config = fs.existsSync(configPath) ? loadConfig(configPath) : null;
    // A-class: snapshots and behavioral runs are claims ABOUT the compiled
    // tree. A green run against a superseded tree is a false pass, and
    // --snapshot banks it as the baseline every later run is compared to.
    if (config) assertDistFreshOrExit(configPath, config, "test");
    const distPath = path.resolve(cwd, config?.output?.distPath ?? "./dist");

    console.log(chalk.bold("\nAgentBoot — test\n"));

    let exitCode = 0;

    // Snapshot create/update
    if (opts["snapshot"]) {
      console.log(chalk.cyan("  Creating snapshot baseline..."));
      if (!fs.existsSync(distPath)) {
        console.log(chalk.red("  dist/ not found — run `agentboot build` first.\n"));
        process.exit(1);
      }
      const baseline = createSnapshot(distPath);
      const snapshotPath = path.resolve(cwd, opts["snapshotFile"] as string);
      saveSnapshot(baseline, snapshotPath);
      console.log(chalk.green(`  ✓ Snapshot saved (${baseline.entries.length} files) → ${path.relative(cwd, snapshotPath)}\n`));
    }

    // Regression test
    if (opts["regression"]) {
      console.log(chalk.cyan("  Running regression test..."));
      const snapshotPath = path.resolve(cwd, opts["snapshotFile"] as string);
      const baseline = loadSnapshot(snapshotPath);
      if (!baseline) {
        console.log(chalk.red(`  Snapshot not found: ${snapshotPath}`));
        console.log(chalk.gray("  Create one with: agentboot test --snapshot\n"));
        process.exit(1);
      }
      if (!fs.existsSync(distPath)) {
        console.log(chalk.red("  dist/ not found — run `agentboot build` first.\n"));
        process.exit(1);
      }
      const current = createSnapshot(distPath);
      const diff = compareSnapshots(baseline, current);
      printSnapshotDiff(diff);
      const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;
      if (totalChanges > 0) {
        console.log(chalk.yellow(`\n  ${totalChanges} difference(s) from baseline.`));
        console.log(chalk.gray("  Update baseline with: agentboot test --snapshot\n"));
        exitCode = 1;
      } else {
        console.log(chalk.green("  ✓ No regression detected.\n"));
      }
    }

    // Behavioral tests
    if (opts["behavioral"]) {
      console.log(chalk.cyan("  Running behavioral tests...\n"));
      const testDir = path.resolve(cwd, opts["testDir"] as string);
      const run = runBehavioralTestsDetailed(testDir, distPath);
      const results = run.results;

      // J1: SILENCE IS NOT SUCCESS. A scenario file that produced no runnable
      // case, and an `expect:` key with no evaluator, are both "we did not
      // check this" — and both used to be invisible. `agentboot test
      // --behavioral` returned [] for every file in this repo and said nothing,
      // under a CI step that treats exit 0 as a pass.
      if (run.filesSeen.length === 0) {
        console.error(chalk.red(
          `  ✗ No scenario files in ${path.relative(cwd, testDir) || testDir}/ — nothing was checked.\n`));
        exitCode = 1;
      }
      for (const f of run.filesWithNoCases) {
        console.error(chalk.red(
          `  ✗ ${f} produced NO runnable test case — every expectation in it is unevaluable.`));
        exitCode = 1;
      }
      if (run.unevaluated.length > 0) {
        const byKey = new Map<string, number>();
        for (const u of run.unevaluated) byKey.set(u.key, (byKey.get(u.key) ?? 0) + 1);
        const top = [...byKey.entries()].sort((a, b) => b[1] - a[1]);
        console.error(chalk.yellow(
          `\n  ⚠ ${run.unevaluated.length} expectation(s) across ${run.filesSeen.length} file(s) have NO evaluator:`));
        for (const [key, n] of top) console.error(chalk.gray(`      ${key} ×${n}`));
        console.error(chalk.gray(
          "    These are judgements about a conversation, not string matches. They are NOT\n" +
          "    checked. A run that ignored them and reported green would be checking a\n" +
          "    fraction of what the scenario files assert.\n" +
          "    Pass --allow-unevaluated to proceed anyway (the count is still printed).\n"));
        if (!opts["allowUnevaluated"]) exitCode = 1;
      }

      if (results.length === 0) {
        console.error(chalk.red("  ✗ No behavioral test cases ran.\n"));
        exitCode = 1;
      } else {
        const passed = results.filter(r => r.passed).length;
        const failed = results.length - passed;
        console.log("");
        if (failed > 0) {
          console.log(chalk.red(`  ✗ ${failed}/${results.length} behavioral test(s) failed.\n`));
          exitCode = 1;
        } else {
          console.log(chalk.green(
            `  ✓ All ${passed} behavioral test(s) passed ` +
            `(${run.unevaluated.length} expectation(s) unevaluated).\n`));
        }
      }
    }

    // If no flags specified, show help
    // AB-156: LLM-as-Judge evaluation
    if (opts["judge"]) {
      const { loadJudgeTestCases, estimateJudgeCost } = await import("./lib/judge.js");
      const testCases = loadJudgeTestCases(path.join(ROOT, "tests"));
      if (testCases.length === 0) {
        console.log(chalk.yellow("\n  No judge test cases found in tests/judge/"));
        console.log(chalk.gray("  Create YAML or JSON test cases to get started.\n"));
      } else {
        const cost = estimateJudgeCost(testCases);
        console.log(chalk.bold(`\n  LLM-as-Judge: ${testCases.length} test case(s)`));
        console.log(chalk.gray(`  Estimated cost: ~$${cost.totalUsd} (${cost.breakdown})`));
        if (opts["dryRun"]) {
          for (const tc of testCases) {
            console.log(chalk.gray(`    - ${tc.persona}: ${tc.ground_truth.must_find?.map((f: { topic: string }) => f.topic).join(", ") ?? "general"}`));
          }
        } else {
          console.log(chalk.yellow("  LLM provider required. Test cases loaded and validated."));
          const resultsDir = path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir(), ".agentboot", "judge-results");
          fs.mkdirSync(resultsDir, { recursive: true });
          fs.writeFileSync(path.join(resultsDir, "last-run-summary.json"),
            JSON.stringify({ timestamp: new Date().toISOString(), testCases: testCases.length, status: "pending_provider" }, null, 2) + "\n", "utf-8");
        }
      }
    }

    if (!opts["behavioral"] && !opts["snapshot"] && !opts["regression"] && !opts["judge"]) {
      console.log(chalk.gray("  Specify a test type:\n"));
      console.log(chalk.gray("    --behavioral   Run behavioral tests (LLM-powered, costs money)"));
      console.log(chalk.gray("    --snapshot     Create/update snapshot baseline from dist/"));
      console.log(chalk.gray("    --regression   Compare current dist/ against saved snapshot\n"));
    }

    process.exit(exitCode);
  });

// ---- status (AB-37) -------------------------------------------------------

program
  .command("status")
  .description("Show deployment status across synced repositories")
  .option("--format <fmt>", "output format: text, json", "text")
  .action(async (opts, cmd) => {
    // A4-residual: a status readout that describes a stale tree must not exit 0.
    // `status` is a health surface; reporting the problem and then returning
    // success is the same false-green as not reporting it at all.
    let distStale = false;
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");

    if (!fs.existsSync(configPath)) {
      // UI-13: "run install" is a dead end (and wrong) when this is a synced
      // SPOKE or a hub is already registered — say what IS true and route there.
      console.error(chalk.red("No agentboot.config.json found in this directory."));
      const { findManifestPath } = await import("./lib/drift.js");
      const spokeManifest = findManifestPath(cwd);
      if (spokeManifest) {
        console.error(chalk.gray(
          `  This repo looks like a synced SPOKE (${path.relative(cwd, spokeManifest)} present) — ` +
          `spokes don't carry a config; status runs against the hub.`
        ));
      }
      try {
        const { listHubs, getDefaultHub } = await import("./lib/registry.js");
        const hubs = listHubs();
        if (hubs.length > 0) {
          const def = getDefaultHub();
          console.error(chalk.gray(`  Registered hub${hubs.length > 1 ? "s" : ""} (agentboot hubs):`));
          for (const h of hubs.slice(0, 5)) {
            console.error(chalk.gray(`    - ${h.path}${def && path.resolve(h.path) === path.resolve(def) ? " (default)" : ""}`));
          }
          const target = def ?? hubs[0]!.path;
          console.error(chalk.gray(`  Try: agentboot status --config ${path.join(target, "agentboot.config.json")}`));
        } else {
          console.error(chalk.gray("  No hubs registered. Run `agentboot install` to create one, or `agentboot connect <hub-path>` to register an existing hub."));
        }
      } catch {
        console.error(chalk.gray("  Run `agentboot install` to create a hub, or `agentboot connect <hub-path>` to register one."));
      }
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
    const outputFormats = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
    const targetDir = config.sync?.targetDir ?? ".claude";

    // Load repos
    const reposPath = path.resolve(path.dirname(configPath), config.sync?.repos ?? "./repos.json");
    let repos: Array<{ path: string; platform?: string; platforms?: string[]; group?: string; team?: string; label?: string }> = [];
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
        // A4: machine consumers need the comparison too — a field that is
        // always `[]` on a healthy hub is how a monitor learns to alert.
        unbuiltPlatforms: unbuiltRepoPlatforms(repos, outputFormats),
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
    // A4: the two lists are printed four lines apart; compare them in code.
    // Displaying a contradiction and expecting the operator to cross-reference
    // by eye is not a check. sync catches this, but only at ship time and only
    // for the repos it reaches.
    const unbuilt = unbuiltRepoPlatforms(repos, outputFormats);
    if (unbuilt.length > 0) {
      for (const u of unbuilt) {
        console.log(chalk.red(
          `  ✗ repos.json targets \`${u.platform}\` but the hub does not build it — ${u.repos.join(", ")}`,
        ));
      }
      console.log(chalk.gray(
        `    Fix: add the platform to personas.outputFormats, or change/remove the repo entry.`,
      ));
    }
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
        // Show platforms (supports both singular and array format)
        const repoPlatforms = repo.platforms && repo.platforms.length > 0
          ? repo.platforms
          : [repo.platform ?? "claude"];
        const platformsStr = repoPlatforms.join(", ");
        console.log(`    ${label} [${scope}] [${platformsStr}] — ${syncInfo}`);
      }
      console.log("");
    }

    // A4-residual: report dist/ freshness from the STAMP, not from the
    // directory's mtime.
    //
    // The old line was `fs.statSync(distPath).mtime` sitting directly beside a
    // file that records the build OUTCOME. A failed build leaves the tree
    // byte-identical, so the mtime is the timestamp of the last SUCCESSFUL
    // build and status printed it unchanged seconds after a build failed —
    // a successful-looking build time for a build that did not succeed, at
    // exit 0. `status` takes the `reports` posture (dist-consumers.ts): it
    // exists to describe the hub, so it says what is wrong rather than
    // refusing to say anything.
    const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
    if (fs.existsSync(distPath)) {
      const stamp = readDistStamp(distPath);
      if (!stamp) {
        console.log(chalk.yellow(
          `  Last build: unknown — dist/ carries no build stamp. Run \`agentboot build\`.\n`,
        ));
      } else if (stamp.status === "failed") {
        console.log(chalk.red(`  Last build: ${stamp.builtAt} — FAILED`));
        if (stamp.failureReason) console.log(chalk.red(`              ${stamp.failureReason}`));
        console.log(chalk.gray(
          "              The tree on disk is the output of an EARLIER build.\n",
        ));
      } else {
        console.log(chalk.gray(`  Last build: ${stamp.builtAt}\n`));
      }
      // Separately from the stamp's own status: has the config moved since?
      if (reportDistFreshness(configPath, config, "status")) distStale = true;
    } else {
      console.log(chalk.yellow("  dist/ not found — run `agentboot build`\n"));
    }
    if (distStale) process.exitCode = 1;
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
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");

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
    // A-class: lint's dist/ read is one advisory token count. Refusing to lint
    // the SOURCES because the compiled tree is stale would be an outage, so
    // lint takes the `reports` posture — but a token count taken from a
    // superseded tree must not be presented as the current one.
    if (fs.existsSync(distClaudeMd)) {
      reportDistFreshness(configPath, config, "lint (compiled-output token check)");
    }
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

// ---- migrate (AB-126) — convert repo into AgentBoot hub -------------------

program
  .command("migrate")
  .description("Convert an existing repo into an AgentBoot hub")
  .option("--path <dir>", "repo directory to migrate (default: cwd)")
  .option("--revert", "undo a previous migration using saved backup")
  .option("--dry-run", "preview what would change without modifying files")
  .option("--org <name>", "org slug for the new hub (default: directory name)")
  .action(async (opts) => {
    const { runMigrate } = await import("./lib/migrate.js");
    runMigrate({
      path: opts["path"] as string | undefined,
      revert: opts["revert"] as boolean | undefined,
      dryRun: opts["dryRun"] as boolean | undefined,
      org: opts["org"] as string | undefined,
    });
  });

// ---- uninstall (AB-45) ----------------------------------------------------

program
  .command("uninstall")
  .description("Remove AgentBoot managed files from a repository (or from ~/.claude/ with --user)")
  .option("--repo <path>", "target repository path")
  .option("--user", "remove user-level content from ~/.claude/ instead of a repo")
  .option("-d, --dry-run", "preview what would be removed")
  .action(async (opts) => {
    const dryRun = opts.dryRun ?? false;

    // E2: `install-user` writes into ~/.claude/ and `removeUserContent()` has
    // existed to undo it since the SPI landed — with ZERO callers outside tests.
    // So user-level artifacts were installable and, in production, permanently
    // unremovable: a revoked user-level control could not be withdrawn by any
    // command the product ships.
    if (opts.user) {
      const { removeUserContent, detectExistingContent } = await import("./lib/user-scope.js");
      console.log(chalk.bold("\nAgentBoot — uninstall (user level)\n"));
      const { hasManifest, manifestPath: userManifest } = detectExistingContent();
      if (!hasManifest) {
        console.log(chalk.yellow("  No AgentBoot user manifest found in ~/.claude/ — nothing to uninstall."));
        console.log(chalk.gray("  User-level content is written by `agentboot install-user`.\n"));
        process.exit(0);
      }
      if (dryRun) {
        // Report from the manifest without touching anything. A dry run that
        // silently did nothing would be indistinguishable from an empty install.
        let files: Array<{ path: string }> = [];
        try {
          files = (JSON.parse(fs.readFileSync(userManifest, "utf-8")).files ?? []) as Array<{ path: string }>;
        } catch { /* reported below as 0 files */ }
        console.log(chalk.yellow(`  DRY RUN — ${files.length} tracked file(s) would be removed from ~/.claude/\n`));
        for (const f of files) console.log(chalk.gray(`    would remove ${f.path}`));
        console.log("");
        process.exit(0);
      }
      const { removed, errors } = removeUserContent();
      for (const r of removed) console.log(chalk.green(`    removed ${r}`));
      for (const e of errors) console.log(chalk.red(`    ✗ ${e}`));
      console.log("");
      console.log(chalk.bold(`  removed: ${removed.length}, errors: ${errors.length}\n`));
      // A partial removal is not a success: the untouched files are still active
      // in every session on this machine.
      process.exit(errors.length > 0 ? 1 : 0);
    }

    const targetRepo = opts.repo ? path.resolve(opts.repo) : process.cwd();
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

    // E2: user-level content lives in ~/.claude/ and is NOT touched by a repo
    // uninstall. Saying so is the difference between "AgentBoot is removed" and
    // "AgentBoot is removed from this repo" — an operator who believes the first
    // while the second is true has org instructions still loading in every
    // session on this machine.
    {
      const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir();
      const userManifest = path.join(home, ".claude", ".agentboot-user-manifest.json");
      if (fs.existsSync(userManifest)) {
        console.log(chalk.yellow(
          `\n  Note: user-level AgentBoot content is also installed in ~/.claude/ and was NOT removed.`,
        ));
        console.log(chalk.gray(`    Remove it with: agentboot uninstall --user`));
      }
    }

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

// ---- Phase 11: governance commands ----------------------------------------

program
  .command("conformance")
  .description("Empirically test compiled enforcement (hooks: block/deny/timeouts/malformed input) per platform and write dist/<platform>/enforcement-manifest.json")
  .option("--platform <name>", "test a single platform (default: all configured output formats)")
  .option("--format <type>", "output format: text or json", "text")
  .option("--allow-untested", "exit 0 even when a declared control could not be probed (local convenience — never in CI)")
  .action(async (opts, cmd) => {
    const { runConformance } = await import("./lib/conformance.js");
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config as string)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red("No agentboot.config.json found — run conformance from the hub (or set AGENTBOOT_HUB)."));
      process.exit(1);
    }
    const { loadConfig } = await import("./lib/config.js");
    const config = loadConfig(configPath);
    const hubDir = path.dirname(configPath);
    const distPath = path.resolve(hubDir, config.output?.distPath ?? "./dist");
    if (!fs.existsSync(distPath)) {
      console.error(chalk.red(`dist/ not found at ${distPath} — run \`agentboot build\` first.`));
      process.exit(1);
    }
    // A2: probing a stale dist/ measures the policy it REPLACED, and then writes
    // that measurement into dist/<platform>/enforcement-manifest.json — where
    // `baseline` archives it and `evidence-pack` hands it to an auditor. Verified
    // before this gate: a failed rebuild that revoked denyTools left the deny
    // hook on disk, and conformance reported `deny-tools not-applicable` (reading
    // the NEW config against the OLD tree) and exited 0.
    assertDistFreshOrExit(configPath, config, "conformance");
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")) as { version: string };
    // A5: was `?? ["claude"]` — conformance tested one platform where the build
    // produces three, so two thirds of the hub went unprobed and reported clean.
    const configured = config.personas?.outputFormats ?? [...DEFAULT_OUTPUT_FORMATS];
    const platforms = opts["platform"] ? [opts["platform"] as string] : configured;

    const run = runConformance(distPath, platforms, config, pkg.version);

    // "Could not verify" must not resolve upward. A control that declares a
    // mechanism and could not be exercised (bash absent, script missing from
    // dist/) is UNTESTED — recording that in the manifest and then exiting 0
    // under "✓ All probed controls behave as declared" is a skip reading as a
    // pass, on the one command whose whole job is empirical verification.
    // Verified before this change: with bash off PATH every control came back
    // untested and `conformance` still exited 0 with the green line.
    const allowUntested = opts["allowUntested"] === true;
    const notGreen = run.failedPlatforms.length > 0 || (!allowUntested && run.untestedPlatforms.length > 0);

    if (opts["format"] === "json") {
      console.log(JSON.stringify({
        bashAvailable: run.bashAvailable,
        failedPlatforms: run.failedPlatforms,
        untestedPlatforms: run.untestedPlatforms,
        probedControls: run.probedControls,
        manifests: run.manifests,
      }, null, 2));
      process.exit(notGreen ? 1 : 0);
    }

    console.log(chalk.bold("\n  AgentBoot — platform conformance\n"));
    if (!run.bashAvailable) {
      console.log(chalk.yellow("  ⚠ bash not available — hook behavior recorded as UNTESTED, not assumed.\n"));
    }
    for (const m of run.manifests) {
      const levelColor = m.declared.level === "enforced" ? chalk.green
        : m.declared.level === "advisory" ? chalk.gray : chalk.yellow;
      console.log(`  ${chalk.bold(m.platform)} — declared ${levelColor(m.declared.level.toUpperCase())}`);
      for (const c of m.controls) {
        const icon = c.status === "pass" ? chalk.green("✓")
          : c.status === "fail" ? chalk.red("✗")
          : c.status === "untested" ? chalk.yellow("?") : chalk.gray("–");
        console.log(`    ${icon} ${c.control.padEnd(12)} ${c.status}${c.reason ? chalk.gray(` — ${c.reason}`) : ""}`);
        for (const p of c.probes.filter((p) => !p.pass)) {
          console.log(chalk.red(`        FAILED: ${p.probe} — expected ${p.expected}, observed ${p.observed}`));
        }
      }
      // Only name a file that exists. This line was unconditional while the
      // write was guarded — verified with dist/claude and dist/cursor deleted:
      // both paths printed, `ls` confirmed neither file was there.
      const written = run.manifestPaths[m.platform];
      console.log(written
        ? chalk.gray(`    manifest: ${written}`)
        : chalk.yellow(`    manifest: NOT WRITTEN — no dist/${m.platform}/ tree to write it into`));
      console.log("");
    }
    if (run.failedPlatforms.length > 0) {
      console.log(chalk.red(`  ✗ Conformance FAILED on: ${run.failedPlatforms.join(", ")}\n`));
    }
    if (run.untestedPlatforms.length > 0) {
      const line = `  ${allowUntested ? "⚠" : "✗"} UNTESTED controls on: ${run.untestedPlatforms.join(", ")} — ${run.probedControls} control(s) actually probed.`;
      console.log((allowUntested ? chalk.yellow : chalk.red)(line));
      console.log(chalk.gray(run.bashAvailable
        ? "      A declared hook is missing from dist/ — run `agentboot build`, or the platform is not emitting it."
        : "      No bash on this machine (Windows without Git Bash) — install one, or pass --allow-untested to accept an unverified run."));
      console.log("");
    }
    if (notGreen) process.exit(1);
    if (run.probedControls === 0) {
      // Every control was not-applicable. Nothing failed, but nothing was
      // measured either, and those must not print the same sentence.
      console.log(chalk.yellow("  ⚠ No control was probed — this configuration declares no enforceable mechanism on any target.\n"));
      return;
    }
    console.log(chalk.green(`  ✓ All ${run.probedControls} probed control(s) behave as declared.\n`));
  });

// ---- v0.19.0: MCP tool-definition digest pinning (rug-pull defense) --------

program
  .command("mcp-pin")
  .description("Record a sha256 digest over each approved MCP server's live tool definitions — the pin `agentboot mcp-verify` re-checks for rug-pulls")
  .option("-c, --config <path>", "path to agentboot.config.json")
  .option("--server <name>", "pin a single approved server (default: every approved server with a command or url)")
  .option("--write", "update agentboot.config.json in place (toolsDigest + toolsDigestRecordedAt; per-tool hashes go to agentboot.mcp-pins.json)")
  .action(async (_opts, cmd: Command) => {
    const { resolveConfigPath } = await import("./lib/config.js");
    const { pinServer, pinSidecarPath, loadPinSidecar, savePinSidecar } = await import("./lib/mcp-pin.js");

    // -c/--config is also a program-level global; commander 15 binds the value
    // there, so read the merged view.
    const opts = cmd.optsWithGlobals();
    const configPath = resolveConfigPath(opts["config"] ? ["--config", opts["config"] as string] : [], process.cwd());
    const config = loadHubConfigOrExit(configPath, "mcp-pin");
    const approved = config.mcp?.approved ?? [];
    const wanted = opts["server"] as string | undefined;
    const targets = approved.filter((s) => (s.command || s.url) && (!wanted || s.name === wanted));

    if (targets.length === 0) {
      if (wanted) {
        console.error(chalk.red(`  ✗ No approved MCP server named "${wanted}" with a command or url in ${configPath}`));
        process.exit(1);
      }
      console.log(chalk.yellow("\n  No approved MCP servers with a command or url — nothing to pin.\n"));
      return;
    }

    console.log(chalk.bold("\n  AgentBoot — mcp-pin\n"));
    const write = opts["write"] === true;
    const sidecarPath = pinSidecarPath(configPath);
    const sidecar = loadPinSidecar(sidecarPath);
    const pins = new Map<string, { digest: string; recordedAt: string }>();
    let failures = 0;

    for (const server of targets) {
      const r = await pinServer(server);
      if ("error" in r) {
        failures++;
        console.log(chalk.red(`  ✗ ${server.name} — ${r.error}`));
        continue;
      }
      console.log(`  ${chalk.green("✓")} ${server.name} — sha256:${r.digest.slice(0, 16)}… (${r.toolCount} tool${r.toolCount === 1 ? "" : "s"})`);
      console.log(chalk.gray(`      registry: ${server.registry ?? "unvetted — set mcp.approved[].registry"}`));
      if (server.toolsDigest && server.toolsDigest !== r.digest) {
        console.log(chalk.yellow(`      replaces previous pin ${server.toolsDigest.slice(0, 16)}… (recorded ${server.toolsDigestRecordedAt ?? "unknown"})`));
      }
      pins.set(server.name, { digest: r.digest, recordedAt: r.recordedAt });
      sidecar[server.name] = { digest: r.digest, recordedAt: r.recordedAt, toolHashes: r.toolHashes };
      if (!write) {
        console.log(chalk.gray(`      would record toolsDigest=${r.digest} (run with --write)`));
      }
    }

    if (write && pins.size > 0) {
      const raw = JSON.parse(stripJsoncComments(fs.readFileSync(configPath, "utf-8"))) as Record<string, unknown>;
      const mcp = raw["mcp"] as Record<string, unknown> | undefined;
      const rawApproved = Array.isArray(mcp?.["approved"]) ? (mcp["approved"] as Array<Record<string, unknown>>) : [];
      for (const entry of rawApproved) {
        const pin = pins.get(String(entry["name"]));
        if (pin) {
          entry["toolsDigest"] = pin.digest;
          entry["toolsDigestRecordedAt"] = pin.recordedAt;
        }
      }
      fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n");
      savePinSidecar(sidecarPath, sidecar);
      console.log(chalk.green(`\n  Wrote ${pins.size} pin${pins.size === 1 ? "" : "s"} to ${path.basename(configPath)} + ${path.basename(sidecarPath)}`));
      console.log(chalk.yellow("  Note: --write re-serializes the config with JSON.stringify(…, 2) — JSONC comments are not preserved."));
    }

    console.log("");
    if (failures > 0) process.exit(1);
  });

program
  .command("mcp-verify")
  .description("Re-hash each approved MCP server's live tool definitions against its recorded toolsDigest — the use-time rug-pull check (run in CI / before rollout)")
  .option("-c, --config <path>", "path to agentboot.config.json")
  .option("--server <name>", "verify a single approved server")
  .option("--strict", "unpinned approved servers FAIL instead of warn")
  .option("--pins <path>", "spoke side: verify against a synced mcp-pins.json (e.g. .claude/mcp-pins.json) instead of a hub config")
  .action(async (_opts, cmd: Command) => {
    const { resolveConfigPath } = await import("./lib/config.js");
    const { verifyServer, pinSidecarPath, loadPinSidecar } = await import("./lib/mcp-pin.js");

    // -c/--config is also a program-level global; commander 15 binds the value
    // there, so read the merged view.
    const opts = cmd.optsWithGlobals();
    let approved: NonNullable<NonNullable<import("./lib/config.js").AgentBootConfig["mcp"]>["approved"]>;
    let configPath: string;
    if (opts["pins"]) {
      // Spoke side: the compiled pins artifact (synced into the platform config
      // dir) IS the approved list — no hub config needed to run the rug-pull check.
      configPath = path.resolve(opts["pins"] as string);
      const pinsFile = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { approved?: typeof approved };
      approved = pinsFile.approved ?? [];
    } else {
      configPath = resolveConfigPath(opts["config"] ? ["--config", opts["config"] as string] : [], process.cwd());
      const config = loadHubConfigOrExit(configPath, "mcp-verify");
      approved = config.mcp?.approved ?? [];
    }
    const wanted = opts["server"] as string | undefined;
    const inScope = approved.filter((s) => !wanted || s.name === wanted);
    const targets = inScope.filter((s) => s.command || s.url);
    // R1-I: an approved server with neither `command` nor `url` used to vanish —
    // dropped from `targets` AND absent from the summary counts. An org that
    // approved a server it cannot reach got a clean report about the ones it
    // could, or "nothing to verify" and exit 0 if all of them were like that.
    // An unreachable approval is an UNVERIFIED approval; it must be counted.
    const undescribed = inScope.filter((s) => !s.command && !s.url);

    if (targets.length === 0) {
      if (wanted) {
        console.error(chalk.red(`  ✗ No approved MCP server named "${wanted}" with a command or url in ${configPath}`));
        process.exit(1);
      }
      if (undescribed.length > 0) {
        console.error(chalk.red(
          `\n  ✗ ${undescribed.length} approved MCP server(s) declare neither \`command\` nor \`url\`, so NONE could be verified:`));
        for (const s of undescribed) console.error(chalk.red(`      ${s.name}`));
        console.error(chalk.gray("    An approved server that cannot be reached is an unverified one, not an absent one.\n"));
        process.exit(1);
      }
      console.log(chalk.yellow("\n  No approved MCP servers — nothing to verify.\n"));
      return;
    }

    const describeAge = (iso: string): string => {
      const ms = Date.now() - Date.parse(iso);
      if (Number.isNaN(ms)) return `at ${iso}`;
      const days = Math.floor(ms / 86_400_000);
      return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
    };

    // Fail-closed on the CI/spoke path: verifying against a compiled --pins
    // artifact, an entry with no toolsDigest means the pin was never recorded or
    // was STRIPPED — either way the rug-pull check is a no-op for that server,
    // which must not read as "verified". Hub-side interactive runs stay warn-only
    // for incremental adoption unless --strict.
    const strict = opts["strict"] === true || opts["pins"] !== undefined;
    console.log(chalk.bold("\n  AgentBoot — mcp-verify\n"));
    const sidecar = loadPinSidecar(pinSidecarPath(configPath));
    let okCount = 0, mismatched = 0, unpinned = 0, errors = 0;

    for (const server of targets) {
      if (!server.toolsDigest) {
        unpinned++;
        const msg = `${server.name} — not pinned (no toolsDigest). Record one: agentboot mcp-pin --server ${server.name} --write`;
        console.log(strict ? chalk.red(`  ✗ ${msg}`) : chalk.yellow(`  ⚠ ${msg}`));
        continue;
      }
      const baseline = sidecar[server.name]?.toolHashes;
      const r = await verifyServer(server, baseline ? { baselineToolHashes: baseline } : {});
      if ("error" in r) {
        errors++;
        console.log(chalk.red(`  ✗ ${server.name} — ${r.error}`));
        continue;
      }
      if (r.ok) {
        okCount++;
        const age = server.toolsDigestRecordedAt ? ` (pinned ${describeAge(server.toolsDigestRecordedAt)})` : "";
        console.log(`  ${chalk.green("✓")} ${server.name} — tool definitions match the pin${age} (${r.toolCount} tool${r.toolCount === 1 ? "" : "s"})`);
        continue;
      }
      mismatched++;
      console.log(chalk.red(`  ✗ ${server.name} — TOOL DEFINITIONS CHANGED since the pin`));
      console.log(chalk.red(`      expected sha256:${r.expected.slice(0, 16)}…  actual sha256:${r.actual.slice(0, 16)}…`));
      if (r.added.length > 0) console.log(chalk.red(`      added:   ${r.added.join(", ")}`));
      if (r.removed.length > 0) console.log(chalk.red(`      removed: ${r.removed.join(", ")}`));
      if (r.changed.length > 0) console.log(chalk.red(`      changed: ${r.changed.join(", ")}`));
      if (r.added.length + r.removed.length + r.changed.length === 0) {
        console.log(baseline
          ? chalk.yellow("      no per-tool difference identified — the baseline may predate the current pin; re-pin with --write")
          : chalk.yellow(`      per-tool diff unavailable — no baseline in ${path.basename(pinSidecarPath(configPath))}; re-pin with --write to record one`));
      }
    }

    // R1-I: undescribed servers appear in the summary. Leaving them out made the
    // denominator smaller than the org's approved list, which is the quiet way
    // to report a clean surface you did not look at.
    if (undescribed.length > 0) {
      for (const s of undescribed) {
        console.log(chalk.yellow(`  ⚠ ${s.name} — NOT VERIFIABLE: no \`command\` or \`url\` in mcp.approved`));
      }
    }
    const summary =
      `${okCount} ok, ${mismatched} mismatched, ${unpinned} unpinned, ` +
      `${undescribed.length} unverifiable, ${errors} error${errors === 1 ? "" : "s"}`;
    const failed = mismatched > 0 || errors > 0 || (strict && (unpinned > 0 || undescribed.length > 0));
    if (failed) {
      console.log(chalk.red(`\n  ✗ mcp-verify: ${summary}\n`));
      process.exit(1);
    }
    // Never render a plain green "verified" while any server is unchecked — an
    // unpinned server is not evidence of a clean surface, and a bare ✓ reads as
    // one. Only all-pinned-and-matching earns the green check.
    if (unpinned > 0 || undescribed.length > 0) {
      const why = [
        unpinned > 0 ? `${unpinned} unpinned` : "",
        undescribed.length > 0 ? `${undescribed.length} with no command/url` : "",
      ].filter(Boolean).join(", ");
      console.log(chalk.yellow(`\n  ⚠ mcp-verify: ${summary} — UNVERIFIED: ${why}. Run mcp-pin --write, or --strict to fail.\n`));
    } else {
      console.log(chalk.green(`\n  ✓ mcp-verify: ${summary}\n`));
    }
  });

program
  .command("verify-manifest")
  .description("Verify a synced manifest: content digest, per-file hashes, SSH signature, signer identity")
  .option("--repo <path>", "repo to verify (default: cwd)")
  .option("--manifest <path>", "explicit path to a .agentboot-manifest.json")
  .option("--require-signed", "FAIL if the manifest carries no signature (the only defense against signature stripping — set this in CI when the hub signs)")
  .option("--allowed-signers <path>", "OpenSSH allowed_signers file to authenticate the signer identity against")
  .option("--signer <principal>", "expected signer principal in the allowed_signers file (default: discovered via find-principals)")
  .action(async (opts) => {
    const { verifyManifestFile } = await import("./lib/provenance.js");
    const { findManifestPath } = await import("./lib/drift.js");

    const repoPath = path.resolve((opts["repo"] as string | undefined) ?? process.cwd());
    const manifestPath = opts["manifest"]
      ? path.resolve(opts["manifest"] as string)
      : findManifestPath(repoPath);
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      console.error(chalk.red(`  ✗ No .agentboot-manifest.json found under ${repoPath}`));
      process.exit(1);
    }

    console.log(chalk.bold("\n  AgentBoot — verify-manifest\n"));
    console.log(chalk.gray(`  Manifest: ${manifestPath}\n`));

    const v = verifyManifestFile(manifestPath, {
      repoRoot: opts["manifest"] ? undefined : repoPath,
      requireSignature: opts["requireSigned"] === true,
      allowedSignersPath: opts["allowedSigners"] as string | undefined,
      signerPrincipal: opts["signer"] as string | undefined,
    });

    console.log(v.digestOk
      ? chalk.green(`  ✓ Content digest OK (sha256:${v.computedDigest.slice(0, 12)}…)`)
      : chalk.red(`  ✗ Content digest MISMATCH — manifest was modified after sync` +
          (v.recordedDigest ? ` (recorded ${v.recordedDigest.slice(0, 12)}…, computed ${v.computedDigest.slice(0, 12)}…)` : "")));

    if (v.fileMismatches.length === 0) {
      console.log(chalk.green("  ✓ All listed files match their recorded hashes"));
    } else {
      console.log(chalk.red(`  ✗ ${v.fileMismatches.length} file(s) differ from the manifest:`));
      for (const m of v.fileMismatches) {
        console.log(chalk.red(`      ${m.path} ${m.actual === null ? "(missing)" : "(modified)"}`));
      }
    }

    if (v.signatureOk === null) {
      console.log(chalk.gray("  – No signature present (hub has sync.signing disabled)"));
    } else if (v.signatureOk) {
      console.log(chalk.green("  ✓ SSH signature valid for the recorded digest"));
      if (v.signerPublicKey) console.log(chalk.gray(`      signer: ${v.signerPublicKey.split(" ").slice(0, 2).join(" ")}`));
    } else {
      console.log(chalk.red("  ✗ SSH signature INVALID or missing-but-required"));
    }
    if (v.signerVerified === true) {
      console.log(chalk.green(`  ✓ Signer authenticated against allowed_signers (principal: ${v.signerPrincipal})`));
    } else if (v.signerVerified === false) {
      console.log(chalk.red("  ✗ Signer NOT authenticated against allowed_signers"));
    }

    for (const err of v.errors) console.log(chalk.yellow(`  ⚠ ${err}`));

    // v0.19.0: verify the in-toto/DSSE attestation when the hub emitted one.
    let attestationFailed = false;
    const attestationPath = manifestPath.replace(/\.agentboot-manifest\.json$/, ".agentboot-manifest.intoto.json");
    if (attestationPath !== manifestPath && fs.existsSync(attestationPath)) {
      const { verifyAttestationFile } = await import("./lib/provenance.js");
      const a = verifyAttestationFile(attestationPath, manifestPath, {
        allowedSignersPath: opts["allowedSigners"] as string | undefined,
        signerPrincipal: opts["signer"] as string | undefined,
      });
      console.log("");
      console.log(a.statementOk
        ? chalk.green("  ✓ Attestation: well-formed in-toto v1 statement")
        : chalk.red("  ✗ Attestation payload malformed"));
      if (a.subjectsMatchManifest === null) {
        // No manifest to bind the attestation to → it proves only "someone
        // signed some statement", not "this manifest is attested". That is not
        // a pass; a self-signed statement about a different manifest must not
        // read as verified.
        console.log(chalk.red("  ✗ Attestation could not be bound to a manifest — unverified (a signature alone attests nothing)"));
      } else {
        console.log(a.subjectsMatchManifest
          ? chalk.green("  ✓ Attestation subjects match the manifest's file digests")
          : chalk.red("  ✗ Attestation subjects DIVERGE from the manifest"));
      }
      if (a.signatureOk !== null) {
        console.log(a.signatureOk
          ? chalk.green("  ✓ Attestation SSHSIG valid over the DSSE PAE")
          : chalk.red("  ✗ Attestation signature INVALID"));
      }
      if (a.signerVerified === true) {
        console.log(chalk.green(`  ✓ Attestation signer authenticated (principal: ${a.signerPrincipal})`));
      } else if (a.signerVerified === false) {
        console.log(chalk.red("  ✗ Attestation signer NOT authenticated"));
      }
      for (const err of a.errors) console.log(chalk.yellow(`  ⚠ ${err}`));
      console.log(chalk.gray(
        "    (Standard in-toto predicate, SSHSIG signature — verifiable here or via ssh-keygen; " +
        "not a Sigstore bundle: no transparency log, no CI-identity certificate.)"));
      attestationFailed =
        !a.statementOk || a.subjectsMatchManifest !== true ||
        a.signatureOk === false || a.signerVerified === false;
    }

    // State the trust posture honestly — what this verification establishes.
    const postureLine: Record<string, string> = {
      "none": "no integrity data — pre-0.14 manifest, nothing established",
      "integrity-only": "INTEGRITY ONLY — detects accidental modification. NOT tamper-evident: " +
        "an editor can recompute the unsigned digest. Enable sync.signing and verify with " +
        "--require-signed --allowed-signers for tamper evidence.",
      "signed-unauthenticated": "SIGNED, signer unauthenticated — the signature is valid but the " +
        "signer identity was not checked. Pass --allowed-signers to authenticate it.",
      "signed-authenticated": "SIGNED + AUTHENTICATED — tamper-evident against the allowed_signers trust root.",
    };
    console.log(chalk.bold(`\n  Trust posture: ${postureLine[v.posture]}\n`));

    const ok =
      v.digestOk &&
      v.fileMismatches.length === 0 &&
      v.signatureOk !== false &&
      v.signerVerified !== false &&
      !attestationFailed;
    process.exit(ok ? 0 : 1);
  });

program
  .command("drift-check")
  .description("Check spoke repos for drift against their manifest")
  .option("--repo <path>", "Check a specific repo (defaults to all repos in repos.json)")
  .option("--format <type>", "Output format: text or json", "text")
  .option("--verbose", "list the individual drifted files for each repo")
  .action(async (opts, cmd) => {
    const { checkDrift, generateComplianceReport } = await import("./lib/drift.js");
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();

    // A3: a clean drift report off a stale dist/ is a clean report about the
    // PREVIOUS policy. Gate both branches. When drift-check is run from inside a
    // spoke there is no hub config to check against, and that is fine — the
    // command is then answering a purely spoke-local question.
    {
      const hubConfigPath = globalOpts.config
        ? path.resolve(globalOpts.config)
        : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
      if (fs.existsSync(hubConfigPath)) {
        assertDistFreshOrExit(hubConfigPath, loadConfig(hubConfigPath), "drift-check");
      }
    }

    if (opts.repo) {
      const report = checkDrift(path.resolve(opts.repo));
      if (!report.manifestFound) {
        console.log(chalk.yellow("  No AgentBoot manifest found."));
        process.exit(2);
      }
      if (opts.format === "json") {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(chalk.bold(`\n  Drift check: ${path.basename(report.repoPath)}\n`));
        for (const entry of report.entries) {
          const icon = entry.status === "clean" ? chalk.green("✓")
            : entry.status === "unmanaged" ? chalk.yellow("?")
            : entry.status === "excepted" ? chalk.cyan("◦")
            : chalk.red("✗");
          const suffix = entry.status === "excepted" ? ` (approved exception ${entry.exceptionId})` : "";
          console.log(`    ${icon} ${entry.file} — ${entry.status}${suffix}`);
        }
        if (report.exceptionIssues) {
          for (const issue of report.exceptionIssues) console.log(chalk.yellow(`    ⚠ ${issue}`));
        }
        console.log(`\n  Result: ${report.summary.modifiedCount} modified, ${report.summary.missingCount} missing, ${report.summary.exceptedCount} excepted (approved), ${report.summary.cleanCount} clean\n`);
      }
      process.exit(report.clean ? 0 : 1);
    } else {
      // Check all repos from repos.json
      const configPath = globalOpts.config
        ? path.resolve(globalOpts.config)
        : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
      // R1-4: the all-repos branch is the HUB side of drift-check; without a hub
      // config there is no repos.json to read. It used to reach loadConfig
      // unguarded and die with a stack trace at exit 7.
      const config = loadHubConfigOrExit(configPath, "drift-check");
      const reposPath = config.sync?.repos ? path.resolve(path.dirname(configPath), config.sync.repos) : path.join(path.dirname(configPath), "repos.json");
      // An unreadable repos.json used to degrade to `repos = []`, which produced
      // "Summary: 0/0 clean, 0 drifted" and exit 0 — a compliance report that
      // checked nothing, in the sentence shape of a clean one. Reproduced by
      // writing `{{{` into repos.json. Say what happened and fail.
      let repos: Array<{ path: string; label?: string }> = [];
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(reposPath, "utf-8"));
        if (!Array.isArray(parsed)) throw new Error("not a JSON array of repo entries");
        repos = parsed as Array<{ path: string; label?: string }>;
      } catch (err: unknown) {
        console.error(chalk.red(`\n  ✗ Cannot read the repo registry — no repo was checked.`));
        console.error(chalk.gray(`      ${reposPath}`));
        console.error(chalk.gray(`      ${err instanceof Error ? err.message : String(err)}\n`));
        process.exit(1);
      }
      if (repos.length === 0) {
        // Zero registered repos is a legitimate state, but it is "nothing to
        // check", not "everything is clean". They must not print alike.
        console.log(chalk.yellow(`\n  ⚠ No repos registered in ${path.basename(reposPath)} — nothing was checked.\n`));
        return;
      }
      const report = generateComplianceReport(repos, path.dirname(configPath));
      if (opts.format === "json") {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(chalk.bold(`\n  Compliance Report — ${report.generatedAt}\n`));
        for (const r of report.repos) {
          // An unchecked repo is not a yellow footnote. Deleting one JSON file
          // was the cheapest way to make an org-wide compliance report green.
          const icon = r.clean ? chalk.green("✓") : chalk.red("✗");
          const label = path.basename(r.repoPath);
          // A repo can drift by modification OR deletion. Reporting only
          // modifiedCount rendered a deletion-only drift as "0 modified" — a line
          // that reads as a no-op in a compliance report while the repo is in fact
          // flagged. Deleting a delivered enforcement hook is the most
          // security-relevant drift there is; it must never print as a zero.
          const parts: string[] = [];
          if (r.summary.modifiedCount > 0) parts.push(`${r.summary.modifiedCount} modified`);
          if (r.summary.missingCount > 0) parts.push(`${r.summary.missingCount} deleted`);
          if (r.summary.exceptedCount > 0) parts.push(`${r.summary.exceptedCount} excepted`);
          // F-1: a revoked control still live here must be named, not folded
          // into a generic "drifted" — it is a different remediation entirely.
          if (r.summary.retiredCount > 0) parts.push(`${r.summary.retiredCount} retired-but-present`);
          const detail = !r.pathExists
            ? "UNCHECKED — repo path not found on this machine"
            : !r.manifestFound
            ? "UNCHECKED — no AgentBoot manifest (never synced, or the manifest was deleted)"
            : r.clean
              ? "clean"
              : parts.length > 0
                ? parts.join(", ")
                : "drifted";
          console.log(`    ${icon} ${label} — ${detail}`);
          // --verbose names the individual files. Without this the compliance
          // report says a repo drifted but never which file, so the operator has
          // to re-run per-repo to act on it.
          if (opts.verbose && r.manifestFound && !r.clean) {
            for (const entry of r.entries) {
              if (entry.status === "clean" || entry.status === "unmanaged") continue;
              const mark = entry.status === "excepted" ? chalk.cyan("◦") : chalk.red("✗");
              const suffix = entry.status === "excepted" ? ` (approved exception ${entry.exceptionId})` : "";
              const state = entry.status === "missing" ? "deleted"
                : entry.status === "retired" ? "retired — revoked at the hub, still present here"
                : entry.status;
              console.log(`        ${mark} ${entry.file} — ${state}${suffix}`);
            }
          }
        }
        const unchecked = report.summary.noManifestRepos;
        console.log(`\n  Summary: ${report.summary.cleanRepos}/${report.summary.totalRepos} clean, ${report.summary.driftedRepos} drifted, ${unchecked} UNCHECKED (${report.summary.unreachableRepos} unreachable)\n`);
        if (unchecked > 0) {
          console.log(chalk.red(`  ✗ ${unchecked} repo(s) could not be checked — this report does not speak for them.`));
          console.log(chalk.gray(`      A missing manifest is not evidence of compliance. Re-sync the repo, or`));
          console.log(chalk.gray(`      remove it from ${path.basename(reposPath)} if it is no longer governed.\n`));
        }
      }
      // A repo that was not checked must not exit 0. `drift-check --repo` has
      // always exited 2 on a missing manifest; the all-repos path folded the
      // same state into the green branch, so deleting .agentboot-manifest.json
      // on a spoke made the org-wide report pass. The two modes now agree.
      process.exit(report.summary.driftedRepos > 0 || report.summary.noManifestRepos > 0 ? 1 : 0);
    }
  });

program
  .command("audit")
  .description("Audit the hub for health issues (orphaned traits, dead gotchas, scope shadows)")
  .option("--format <type>", "Output format: text or json", "text")
  .action(async (opts, cmd) => {
    const { runAudit } = await import("./lib/audit.js");
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");
    const hubRoot = path.dirname(configPath);

    // A3: `audit` reports on hub health, and an operator reads "✓ No issues
    // found" as "the hub is in the state I asked for". After a failed build the
    // hub SOURCES are healthy and the deployed tree is not — so the clean
    // verdict is true and misleading. Refuse rather than qualify.
    //
    // R1-4: through the helper, because A3's unconditional loadConfig made
    // `agentboot audit` outside a hub die with a stack trace and exit 7.
    assertDistFreshOrExit(configPath, loadHubConfigOrExit(configPath, "audit"), "audit");

    const report = runAudit(hubRoot);

    if (opts.format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(chalk.bold(`\n  Hub Audit\n`));
      if (report.findings.length === 0) {
        console.log(chalk.green("  ✓ No issues found\n"));
      } else {
        for (const f of report.findings) {
          const icon = f.severity === "error" ? chalk.red("✗") : f.severity === "warn" ? chalk.yellow("⚠") : chalk.gray("ℹ");
          console.log(`    ${icon} [${f.type}] ${f.message}${f.file ? ` (${f.file})` : ""}`);
        }
        console.log(`\n  Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info\n`);
      }
    }
    process.exit(report.summary.errors > 0 ? 1 : 0);
  });

program
  .command("hubs")
  .description("List registered hubs")
  .option("--prune", "remove registered hubs whose path no longer exists on disk")
  .action(async (opts) => {
    const { listHubs, getDefaultHub, pruneHubs } = await import("./lib/registry.js");

    if (opts.prune) {
      const removed = pruneHubs();
      if (removed.length === 0) {
        console.log(chalk.gray("  No dead hubs to prune — all registered paths exist."));
      } else {
        console.log(chalk.green(`  ✓ Pruned ${removed.length} dead hub(s):`));
        for (const hub of removed) {
          console.log(chalk.gray(`    ${hub.org ?? "(no org)"} → ${hub.path}`));
        }
      }
      console.log("");
    }

    const hubs = listHubs();
    const defaultHub = getDefaultHub();

    if (hubs.length === 0) {
      console.log(chalk.yellow("  No hubs registered. Run 'agentboot connect <path>' to register one."));
    } else {
      console.log(chalk.bold("\n  Registered hubs:\n"));
      for (const hub of hubs) {
        const marker = hub.path === defaultHub ? chalk.green(" (default)") : "";
        console.log(`    ${hub.org ?? "(no org)"} → ${hub.path}${marker}`);
      }
      console.log("");
    }
  });

program
  .command("connect")
  .description("Register a hub and set it as default")
  .argument("[path]", "Path to the hub directory", ".")
  .action(async (hubPath: string) => {
    const { registerHub } = await import("./lib/registry.js");
    const absPath = path.resolve(hubPath);
    const configPath = path.join(absPath, "agentboot.config.json");
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red(`  No agentboot.config.json found at ${absPath}`));
      process.exit(1);
    }
    const config = loadConfig(configPath);
    registerHub(absPath, config.org);
    console.log(chalk.green(`  ✓ Hub registered: ${config.org ?? absPath}`));
    console.log(chalk.gray(`    Path: ${absPath}`));
  });

program
  .command("use")
  .description("Switch the default hub")
  .argument("<path>", "Path to the hub to set as default")
  .action(async (hubPath: string) => {
    const { setDefaultHub } = await import("./lib/registry.js");
    try {
      setDefaultHub(path.resolve(hubPath));
      console.log(chalk.green(`  ✓ Default hub set to: ${path.resolve(hubPath)}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ ${(err as Error).message}`));
      process.exit(1);
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
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");

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
  .option("--format <fmt>", "export format: plugin, managed, agentskills", "plugin")
  .option("--output <dir>", "output directory")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");

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

    // A3-residual: export PACKAGES dist/ into a distributable — a plugin
    // directory, an agentskills bundle told to submit itself to a public
    // directory. That is a higher-consequence path than `audit`, which was
    // gated first, and it was shipping superseded policy at exit 0.
    assertDistFreshOrExit(configPath, config, "export");
    const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");
    const format = opts.format;

    console.log(chalk.bold(`\nAgentBoot — export (${format})\n`));

    if (format === "plugin") {
      const pluginDir = path.join(distPath, "plugin");
      const pluginJson = path.join(pluginDir, ".claude-plugin", "plugin.json");

      if (!fs.existsSync(pluginJson)) {
        console.error(chalk.red("Plugin output not found. Run `agentboot build` first."));
        console.error(chalk.gray("Ensure 'plugin' is in personas.outputFormats or build includes claude format."));
        process.exit(1);
      }

      // AB-131: Validate plugin.json against CC plugin spec
      try {
        const pluginManifest = JSON.parse(fs.readFileSync(pluginJson, "utf-8"));
        const validationWarnings = validatePluginManifest(pluginManifest);
        if (validationWarnings.length > 0) {
          console.log(chalk.yellow("  Plugin manifest warnings:"));
          for (const w of validationWarnings) {
            const icon = w.level === "error" ? chalk.red("  ✗") : chalk.yellow("  ⚠");
            console.log(`${icon} ${w.field}: ${w.message}`);
          }
          console.log(""); // blank line after warnings
        }
      } catch (e) {
        console.log(chalk.yellow(`  Could not validate plugin.json: ${e instanceof Error ? e.message : String(e)}`));
      }

      const outputDir = opts.output
        ? path.resolve(opts.output)
        : path.join(cwd, ".claude-plugin");

      // Safety: only delete existing dir if it's within cwd or contains plugin.json
      if (fs.existsSync(outputDir)) {
        const resolvedCwd = path.resolve(cwd);
        const isSafe = outputDir.startsWith(resolvedCwd + path.sep)
          || outputDir === resolvedCwd
          || fs.existsSync(path.join(outputDir, "plugin.json"))
          || fs.existsSync(path.join(outputDir, ".claude-plugin", "plugin.json"));
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

    } else if (format === "agentskills") {
      // AB-162: agentskills.io listing export
      const { generateSkillsIndex } = await import("./lib/export.js");
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
      const index = generateSkillsIndex(distPath, {
        org: config.org,
        orgDisplayName: config.orgDisplayName as string | undefined,
        version: pkg.version as string | undefined,
      });
      const outputPath = opts.output ?? path.join(distPath, "skills-index.json");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(index, null, 2) + "\n", "utf-8");
      console.log(chalk.green(`\n✓ Exported ${index.skills.length} skill(s) to ${outputPath}`));
      console.log(chalk.gray("  Submit this file to agentskills.io for directory listing."));

    } else {
      console.error(chalk.red(`Unknown export format: '${format}'. Use: plugin, managed, agentskills`));
      process.exit(1);
    }
  });

// ---- publish (AB-41) ------------------------------------------------------
// GA surface-pruning (R.2): the marketplace/publish subsystem is not advertised
// in v1.0 — hidden (not deleted) so it stays reversible for a post-GA decision.

program
  .command("publish", { hidden: true })
  .description("Publish compiled plugin to marketplace")
  .option("--marketplace <path>", "path to marketplace.json", "marketplace.json")
  .option("--bump <level>", "version bump: major, minor, patch")
  .option("-d, --dry-run", "preview changes without writing")
  .action((opts) => {
    const cwd = process.cwd();
    const dryRun = opts.dryRun ?? false;
    // A-class: `publish` is `export`'s consequence made public. If the hub it
    // runs in has a config, the tree it is about to publish must be current.
    const publishConfigPath = envHubConfig() ?? path.join(cwd, "agentboot.config.json");
    if (fs.existsSync(publishConfigPath)) {
      assertDistFreshOrExit(publishConfigPath, loadConfig(publishConfigPath), "publish");
    }

    console.log(chalk.bold("\nAgentBoot — publish\n"));
    if (dryRun) console.log(chalk.yellow("  DRY RUN — no files will be modified\n"));

    // Find plugin
    const pluginJsonPath = path.join(cwd, ".claude-plugin", "plugin.json");
    const distPluginPath = path.join(cwd, "dist", "plugin", ".claude-plugin", "plugin.json");

    let pluginDir: string;
    let manifestPath: string;
    let pluginManifest: Record<string, unknown>;

    if (fs.existsSync(pluginJsonPath)) {
      pluginDir = path.join(cwd, ".claude-plugin");
      manifestPath = pluginJsonPath;
      try {
        pluginManifest = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
      } catch (e: unknown) {
        console.error(chalk.red(`  Failed to parse plugin.json: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    } else if (fs.existsSync(distPluginPath)) {
      pluginDir = path.join(cwd, "dist", "plugin");
      manifestPath = distPluginPath;
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
        manifestPath,
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

// ---- cost-estimate (AB-139) -----------------------------------------------

program
  .command("cost-estimate")
  .description("Calculate projected monthly costs per persona across the org")
  .option("--model <model>", "Claude model: haiku, sonnet, opus", "sonnet")
  .option("--invocations <n>", "invocations per persona per team member per month", "100")
  .option("--team-size <n>", "number of team members", "10")
  .option("--json", "output in JSON format")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const cwd = process.cwd();
    const configPath = globalOpts.config
      ? path.resolve(globalOpts.config)
      : envHubConfig() ?? path.join(cwd, "agentboot.config.json");

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

    // A-class: cost-estimate states what the DEPLOYED prompt costs. Computed
    // from a superseded tree that is a wrong number stated as a fact.
    assertDistFreshOrExit(configPath, config, "cost-estimate");

    const { estimateCosts, MODEL_PRICING } = await import("./lib/cost-estimate.js");

    const model = opts.model as "haiku" | "sonnet" | "opus";
    if (!MODEL_PRICING[model]) {
      console.error(chalk.red(`Unknown model: '${model}'. Use: haiku, sonnet, opus`));
      process.exit(1);
    }

    const invocations = parseInt(opts.invocations, 10);
    const teamSize = parseInt(opts.teamSize, 10);

    if (isNaN(invocations) || invocations <= 0) {
      console.error(chalk.red("--invocations must be a positive integer."));
      process.exit(1);
    }
    if (isNaN(teamSize) || teamSize <= 0) {
      console.error(chalk.red("--team-size must be a positive integer."));
      process.exit(1);
    }

    const enabledPersonas = config.personas?.enabled ?? [];
    const distPath = path.resolve(cwd, config.output?.distPath ?? "./dist");

    if (!fs.existsSync(distPath)) {
      console.error(chalk.red("dist/ not found. Run `agentboot build` first."));
      process.exit(1);
    }

    const result = estimateCosts({
      distPath,
      enabledPersonas,
      model,
      invocations,
      teamSize,
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    console.log(chalk.bold("\nAgentBoot — cost-estimate\n"));
    console.log(chalk.gray(`  Model: ${model}  |  Team size: ${teamSize}  |  Invocations/persona/member/month: ${invocations}\n`));

    // Table header
    const colPersona = 24;
    const colTokens = 14;
    const colInvocations = 22;
    const colCost = 18;

    console.log(
      "  " +
      "Persona".padEnd(colPersona) +
      "Tokens".padEnd(colTokens) +
      "Monthly Invocations".padEnd(colInvocations) +
      "Est. Monthly Cost"
    );
    console.log("  " + "-".repeat(colPersona + colTokens + colInvocations + colCost));

    for (const p of result.personas) {
      const tokens = p.inputTokens > 0 ? p.inputTokens.toLocaleString() : chalk.yellow("n/a");
      const inv = p.monthlyInvocations.toLocaleString();
      const cost = p.inputTokens > 0
        ? `$${p.monthlyCostUsd.toFixed(2)}`
        : chalk.yellow("$0.00");

      console.log(
        "  " +
        p.persona.padEnd(colPersona) +
        String(tokens).padEnd(colTokens) +
        inv.padEnd(colInvocations) +
        cost
      );
    }

    console.log("  " + "-".repeat(colPersona + colTokens + colInvocations + colCost));
    console.log(
      "  " +
      chalk.bold("Total".padEnd(colPersona)) +
      "".padEnd(colTokens) +
      "".padEnd(colInvocations) +
      chalk.bold(`$${result.totalMonthlyCostUsd.toFixed(2)}`)
    );
    console.log("");
    console.log(chalk.gray("  Note: Estimates assume ~4 chars/token and output tokens = 2x input tokens."));
    console.log(chalk.gray("  Actual costs depend on conversation length, caching, and usage patterns.\n"));
  });

// ---- mcp-server (AB-140) ---------------------------------------------------

program
  .command("mcp-server")
  .description("Start the MCP server (JSON-RPC over stdio)")
  .option(
    "--profile <profile>",
    "tool profile: read-only (default; inspection tools only) or maintainer (adds build/sync/propose_change)",
  )
  .action((opts, cmd) => {
    const globalOpts = cmd.optsWithGlobals();
    const args = collectGlobalArgs(globalOpts);
    if (opts["profile"]) args.push("--profile", opts["profile"] as string);
    runScript({
      script: "mcp-server.ts",
      args,
      verbose: globalOpts.verbose,
      quiet: globalOpts.quiet,
    });
  });

// ---- telemetry-inspect (B6) ------------------------------------------------

program
  .command("telemetry-inspect")
  .description("Show exactly what telemetry would be emitted under the current config — schema, sample events, and log status")
  .option("-c, --config <path>", "path to agentboot.config.json")
  .action(async (_opts, cmd: Command) => {
    // Merged view — the program-level -c/--config global captures the value.
    const opts = cmd.optsWithGlobals();
    const { resolveConfigPath } = await import("./lib/config.js");
    const { TELEMETRY_EVENTS, TELEMETRY_SCHEMA_VERSION, sampleEvents } = await import("./lib/telemetry-schema.js");
    const configPath = resolveConfigPath(opts["config"] ? ["--config", opts["config"] as string] : [], process.cwd());
    const config = loadHubConfigOrExit(configPath, "telemetry-inspect");
    const t = config.telemetry ?? {};
    const enabled = t.enabled === true;
    const devIdMode = (t.includeDevId ?? false) as false | string;

    console.log(chalk.bold("\nAgentBoot — telemetry-inspect"));
    console.log(chalk.gray(`Config: ${configPath}\n`));
    console.log(`  Enabled:        ${enabled ? chalk.green("yes") : chalk.yellow("no (nothing is emitted)")}`);
    console.log(`  Dev identifier: ${devIdMode === false ? "off (dev_id always empty)" : devIdMode === "hashed" ? "hashed (SHA-256 of git email — PSEUDONYMOUS, not anonymous)" : `${devIdMode} (raw email — identifies the developer)`}`);
    console.log(`  Log path:       ${t.logPath ?? "~/.agentboot/telemetry.ndjson"} (local file${t.sink ? "" : "; nothing is transmitted"})`);
    if (t.sink) {
      console.log(`  Org sink:       ${t.sink.url} ${chalk.yellow("(org-configured — batches ship there via `agentboot telemetry-ship`; AgentBoot itself has no default endpoint)")}`);
    }
    console.log(`  Schema version: ${TELEMETRY_SCHEMA_VERSION}\n`);

    console.log(chalk.bold("  Event types and every field they may carry:"));
    for (const [name, spec] of Object.entries(TELEMETRY_EVENTS)) {
      console.log(`\n  ${chalk.cyan(name)} — ${spec.emittedOn}`);
      for (const [field, f] of Object.entries(spec.fields)) {
        console.log(`    ${field.padEnd(12)} ${f.type.padEnd(7)} ${f.purpose}${f.identifiesPerson ? chalk.yellow("  [may identify a person]") : ""}`);
      }
    }

    console.log(chalk.bold("\n  Sample emissions under this config:"));
    for (const ev of Object.values(sampleEvents(devIdMode))) {
      console.log(`    ${JSON.stringify(ev)}`);
    }
    console.log(chalk.gray(
      "\n  Prompts, responses, code, file paths, and tool arguments have no field in this\n" +
      "  schema — they cannot be emitted. The conformance test (tests/band-b.test.ts)\n" +
      "  executes the generated hook and fails if its output deviates from this schema.\n"
    ));
  });

// ---- evidence-pack (auditor evidence export) --------------------------------

program
  .command("evidence-pack")
  .description("Export a signed, digest-protected evidence bundle: enforcement state, drift, manifest trust postures, guardrails, telemetry chain")
  .option("-c, --config <path>", "path to agentboot.config.json")
  .option("--out <path>", "output file (default: agentboot-evidence-<date>.json)")
  .option("--telemetry-batches <dir>", "shipped telemetry batch dir to include chain evidence for")
  .action(async (_opts, cmd: Command) => {
    // Merged view — the program-level -c/--config global captures the value.
    const opts = cmd.optsWithGlobals();
    const { buildEvidencePack } = await import("./lib/evidence-pack.js");
    const { resolveConfigPath } = await import("./lib/config.js");

    const configPath = resolveConfigPath(opts["config"] ? ["--config", opts["config"] as string] : [], process.cwd());
    const config = loadHubConfigOrExit(configPath, "evidence-pack");
    const hubPath = path.dirname(configPath);
    const distPath = path.resolve(hubPath, config.output?.distPath ?? "./dist");

    let repos: Array<{ path: string; platform?: string; group?: string; team?: string }> = [];
    try {
      const reposFile = path.resolve(hubPath, config.sync?.repos ?? "./repos.json");
      repos = JSON.parse(fs.readFileSync(reposFile, "utf-8"));
    } catch { /* no repos registered — hub-only evidence is still valid */ }

    const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version as string;
    const signKeyPath = config.sync?.signing?.enabled ? config.sync.signing.sshKeyPath : undefined;

    console.log(chalk.bold("\n  AgentBoot — evidence-pack\n"));
    // The evidence pack is the artifact an AUDITOR reads, digest-protected and
    // SSH-signed. Built off a stale dist/ it describes the policy the org
    // REPLACED, in the present tense, under a valid signature — the exact shape
    // this product exists to prevent. `sync`, `drift-check` and `audit` already
    // refuse; the compliance deliverable must refuse hardest.
    assertDistFreshOrExit(configPath, config, "evidence-pack");
    const { pack, signingError } = buildEvidencePack({
      hubPath, config, agentbootVersion: version, repos, distPath,
      telemetryBatchDir: opts["telemetryBatches"] as string | undefined,
      signKeyPath,
    });

    const out = path.resolve(
      (opts["out"] as string | undefined) ??
      `agentboot-evidence-${new Date().toISOString().slice(0, 10)}.json`,
    );
    fs.writeFileSync(out, JSON.stringify(pack, null, 2) + "\n", { mode: 0o600 });

    console.log(`  Hub:        ${pack.hub.hub_commit ?? "(not a git repo)"}${pack.hub.hub_dirty ? chalk.yellow(" DIRTY") : ""}`);
    // R1-G: name the platform SET the pack was computed over. "2 with
    // enforcement manifests" is not a claim until the denominator is stated.
    console.log(`  Platforms:  ${pack.enforcement.platform_set.platforms.join(", ")} ` +
      `(from ${pack.enforcement.platform_set.source})`);
    console.log(`              ${Object.keys(pack.enforcement.manifests).length} with enforcement manifests` +
      (pack.enforcement.unprobed_platforms.length ? chalk.yellow(` — UNPROBED: ${pack.enforcement.unprobed_platforms.join(", ")} (run \`agentboot conformance\`)`) : ""));
    if (pack.enforcement.derived_platforms.length > 0) {
      console.log(chalk.gray(
        `              derived output present for: ${pack.enforcement.derived_platforms.join(", ")} ` +
        `— not configured targets, so \`conformance\` does not probe them`));
    }
    console.log(`  Repos:      ${pack.repos.length} (${pack.repos.filter((r) => r.drift.clean === true).length} drift-clean)`);
    console.log(`  Exceptions: ${pack.guardrails.exceptions.length} (${pack.guardrails.exceptions.filter((e) => e.expired).length} expired)`);
    if (pack.telemetry.chain) {
      console.log(`  Telemetry:  ${pack.telemetry.chain.batches} batch(es), ${pack.telemetry.chain.signed} signed, ${pack.telemetry.chain.gaps.length} gap(s)`);
    }
    console.log(pack.integrity?.signature
      ? chalk.green(`  ✓ Pack signed (${pack.integrity.pack_digest.slice(0, 12)}…)`)
      : chalk.yellow(`  – Pack digest-only (${pack.integrity?.pack_digest.slice(0, 12)}…) — enable sync.signing for a signed pack`));
    if (signingError) {
      console.error(chalk.red(`  ✗ Signing FAILED: ${signingError}`));
      process.exit(1);
    }
    console.log(chalk.gray(`\n  Written: ${out}\n`));
  });

// ---- telemetry-ship / telemetry-verify (D3) --------------------------------

program
  .command("telemetry-ship")
  .description("Spool hash-chained telemetry events into digest-chained (optionally signed) batches and POST them to the org's configured sink")
  .option("-c, --config <path>", "path to agentboot.config.json (hub side)")
  .option("--sink-config <path>", "explicit telemetry-sink.json (spoke side; default: nearest .claude/telemetry-sink.json)")
  .option("--log <path>", "telemetry log to ship (default: config logPath or ~/.agentboot/telemetry.ndjson)")
  .option("--spool-only", "build batches but do not POST (spool for a later run)")
  .action(async (_opts, cmd: Command) => {
    // -c/--config is also a program-level global; commander binds the value
    // there, so read the merged view (a bare opts["config"] is always empty).
    const opts = cmd.optsWithGlobals();
    const { spoolTelemetry, shipSpool, findSinkConfig, defaultSpoolDir } = await import("./lib/telemetry-sink.js");
    const { resolveConfigPath, loadConfig } = await import("./lib/config.js");

    // Resolve config: hub config if present, else the synced sink JSON.
    let sink = null;
    let logPath = opts["log"] as string | undefined;
    let signKeyPath: string | null = null;
    try {
      const configPath = resolveConfigPath(opts["config"] ? ["--config", opts["config"] as string] : [], process.cwd());
      const config = loadConfig(configPath);
      sink = config.telemetry?.sink ?? null;
      logPath = logPath ?? config.telemetry?.logPath;
      if (config.sync?.signing?.enabled && config.sync.signing.sshKeyPath && (sink?.sign ?? true)) {
        signKeyPath = config.sync.signing.sshKeyPath;
      }
    } catch { /* no hub config here — spoke side */ }
    if (!sink) sink = findSinkConfig(opts["sinkConfig"] as string | undefined);

    if (!sink) {
      console.error(chalk.red("  ✗ No telemetry sink configured — set telemetry.sink in the hub config (there is no default endpoint)."));
      process.exit(1);
    }
    const resolvedLog = (logPath ?? path.join(os.homedir(), ".agentboot", "telemetry.ndjson"))
      .replace(/^~\//, os.homedir() + "/");
    const spoolDir = sink.spoolDir ?? defaultSpoolDir();

    console.log(chalk.bold("\n  AgentBoot — telemetry-ship\n"));
    console.log(chalk.gray(`  Log:   ${resolvedLog}`));
    console.log(chalk.gray(`  Spool: ${spoolDir}`));
    console.log(chalk.gray(`  Sink:  ${sink.url} (org-configured)\n`));

    const spool = spoolTelemetry(resolvedLog, spoolDir, {
      batchSize: sink.batchSize ?? 100,
      signKeyPath,
    });
    console.log(`  Spooled ${spool.eventsSpooled} event(s) into ${spool.batchesWritten} batch(es)${spool.signed ? chalk.green(" [signed]") : ""}`);
    if (spool.logReset) console.log(chalk.yellow("  ⚠ Local log shrank below the cursor (rotation/truncation) — re-read from the start; the sink dedups by batch sequence."));
    if (spool.corruptLines > 0) console.log(chalk.yellow(`  ⚠ ${spool.corruptLines} unparseable log line(s) skipped (surfaced, not silently dropped).`));
    if (spool.signingError) {
      // Signing is all-or-nothing: nothing was written and the cursor did NOT
      // advance, so these events retain their chance to be signed on the next
      // run with a working key — they are NOT shipped unsigned.
      console.error(chalk.red(`  ✗ Signing FAILED: ${spool.signingError}`));
      console.error(chalk.red("    Nothing was spooled and the cursor is unchanged — fix the signing key and re-run; events will be signed then, not shipped unsigned."));
      process.exit(1);
    }

    if (opts["spoolOnly"]) {
      console.log(chalk.gray("  --spool-only: not shipping.\n"));
      return;
    }
    const ship = await shipSpool(spoolDir, sink);
    console.log(`  Shipped ${ship.shipped} batch(es)` + (ship.failed ? chalk.red(` — ${ship.failed} failed (kept in spool for retry)`) : ""));
    for (const e of ship.errors) console.error(chalk.yellow(`  ⚠ ${e}`));
    console.log("");
    process.exit(ship.failed > 0 ? 1 : 0);
  });

program
  .command("telemetry-verify")
  .description("Verify the hash chain of a local telemetry log and/or the digest chain, sequence continuity and signatures of shipped batches")
  .option("--log <path>", "NDJSON telemetry log to verify")
  .option("--batches <dir>", "directory of batch files to verify (e.g. the spool's shipped/ dir or the sink's store)")
  .option("--require-signed", "FAIL if any batch is unsigned or its signature does not verify (the only defense against signature stripping — set this in CI)")
  .option("--allowed-signers <path>", "OpenSSH allowed_signers file to authenticate batch signatures against")
  .option("--signer <principal>", "expected signer principal")
  .option("--partial", "the directory holds a deliberate SLICE of the chain (e.g. the live spool root) — do not fail because it does not begin at batch 1")
  .action(async (opts) => {
    const { verifyTelemetryLog, verifyBatchChain } = await import("./lib/telemetry-sink.js");
    if (!opts["log"] && !opts["batches"]) {
      console.error(chalk.red("  ✗ Nothing to verify — pass --log and/or --batches."));
      process.exit(1);
    }
    let failed = false;
    console.log(chalk.bold("\n  AgentBoot — telemetry-verify\n"));

    if (opts["log"]) {
      const v = verifyTelemetryLog(path.resolve(opts["log"] as string));
      console.log(`  Log: ${v.lines} line(s) — ${v.chained} chained, ${v.unchained} pre-chain, ${v.forks} fork(s)`);
      if (v.forks > 0) console.log(chalk.yellow("    forks = concurrent hook writes chaining off the same parent — a warning, not tampering"));
      for (const f of v.failures) console.log(chalk.red(`    ✗ line ${f.line}: ${f.reason}`));
      console.log(v.ok
        ? chalk.green("  ✓ Log chain verifies — no post-write edits, deletions, or reordering detected")
        : chalk.red("  ✗ Log chain FAILED"));
      console.log(chalk.gray("    (The chain is unkeyed: it detects modification, it cannot prevent a full consistent rewrite — signed shipped batches are the tamper-evident control.)\n"));
      failed = failed || !v.ok;
    }

    if (opts["batches"]) {
      const dir = path.resolve(opts["batches"] as string);
      // Enforce signatures in the lib (not just count them): --require-signed
      // fails on any unsigned/invalid batch — the actual defense against
      // signature stripping — and --allowed-signers authenticates each signer.
      const v = verifyBatchChain(dir, {
        requireSigned: opts["requireSigned"] === true,
        allowPartial: opts["partial"] === true,
        allowedSignersPath: opts["allowedSigners"] as string | undefined,
        signerPrincipal: opts["signer"] as string | undefined,
      });
      console.log(`  Batches: ${v.batches} — ${v.signed} signed`
        + (v.signatureVerified ? `, ${v.signatureVerified} signature(s) verified` : "")
        + (v.signerAuthenticated ? `, ${v.signerAuthenticated} signer(s) authenticated` : ""));
      if (v.gaps.length > 0) console.log(chalk.red(`    ✗ sequence gap(s): batch ${v.gaps.join(", ")} missing — deleted or never delivered`));
      for (const f of v.failures) console.log(chalk.red(`    ✗ ${f.file}: ${f.reason}`));
      if (!opts["requireSigned"] && !opts["allowedSigners"] && v.signed < v.batches) {
        console.log(chalk.yellow(`    ⚠ ${v.batches - v.signed} batch(es) unsigned — pass --require-signed to fail on stripped signatures.`));
      }
      if (v.truncatedPrefix && opts["partial"]) {
        console.log(chalk.yellow("    ⚠ this directory does not begin at batch 1 — accepted under --partial; it is a slice, not the whole chain."));
      }
      console.log(v.ok
        ? chalk.green("  ✓ Batch chain verifies — digests intact, sequence continuous"
            + (v.truncatedPrefix ? " within this slice" : " from batch 1")
            + (opts["requireSigned"] || opts["allowedSigners"] ? ", signatures enforced" : ""))
        : chalk.red("  ✗ Batch chain FAILED"));
      console.log("");
      failed = failed || !v.ok;
    }

    process.exit(failed ? 1 : 0);
  });

// ---------------------------------------------------------------------------
// AB-150: Marketplace CLI commands
// ---------------------------------------------------------------------------

const marketplaceCmd = program
  // GA surface-pruning (R.2): hidden in v1.0 (the marketplace was cut) — kept for
  // a post-GA decision, not advertised in top-level help.
  .command("marketplace", { hidden: true })
  .description("Marketplace: search, pull, and publish components");

marketplaceCmd
  .command("search [query]")
  .description("Search the marketplace registry")
  .option("--type <type>", "Filter by component type (trait, gotcha, persona, domain)")
  .option("--layer <layer>", "Filter by trust layer (core, verified, community)")
  .option("--tags <tags>", "Filter by tags (comma-separated)")
  .option("--json", "Output as JSON")
  .action(async (query: string = "", opts) => {
    const { searchRegistry, getChannels, loadCachedRegistry } = await import("./lib/marketplace.js");
    const config = loadConfig(path.join(ROOT, "agentboot.config.json"));
    const channels = getChannels(config as any);
    const hasCache = channels.some((ch: any) => loadCachedRegistry(ch.name) !== null);
    if (!hasCache) {
      console.log(chalk.yellow("No registry cache found. Run: agentboot registry seed"));
      process.exit(0);
    }
    const tags = opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined;
    const results = searchRegistry(query, channels, { type: opts.type, layer: opts.layer, tags });
    if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
    if (results.length === 0) { console.log(chalk.yellow(`No components found matching "${query}"`)); return; }
    console.log(chalk.bold(`\nFound ${results.length} component(s):\n`));
    for (const entry of results) {
      const badge = entry.layer === "verified" ? chalk.green(`[${entry.layer}]`) : chalk.gray(`[${entry.layer}]`);
      console.log(`  ${chalk.bold(entry.id.padEnd(35))} ${badge}  ${entry.description}`);
    }
    console.log(chalk.gray(`\nInstall with: agentboot marketplace pull <id>`));
  });

marketplaceCmd
  .command("pull <id>")
  .description("Install a component from the marketplace registry")
  .option("--version <version>", "Pin to specific version")
  .option("--dry-run", "Show what would be written without writing")
  .option("--force", "Overwrite existing component")
  .action(async (id: string, opts) => {
    const { resolveComponent, getChannels, validateLicense } = await import("./lib/marketplace.js");
    const config = loadConfig(path.join(ROOT, "agentboot.config.json"));
    const channels = getChannels(config as any);
    const resolved = resolveComponent(id, channels, opts.version);
    if (!resolved) { console.error(chalk.red(`Component not found: ${id}`)); process.exit(1); }
    const { entry, channel } = resolved;
    console.log(chalk.bold(`\nPulling ${entry.id}@${entry.version} from ${channel.name}...`));
    const typeDir = entry.type === "domain" ? "domains" : `${entry.type}s`;
    const targetDir = path.join(ROOT, "core", typeDir, entry.name);
    // Path traversal protection
    const validTypes = ["trait", "gotcha", "persona", "domain"];
    if (!validTypes.includes(entry.type)) { console.error(chalk.red(`Invalid component type: ${entry.type}`)); process.exit(1); }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.name)) { console.error(chalk.red(`Invalid component name: ${entry.name}`)); process.exit(1); }
    const resolvedTarget = path.resolve(targetDir);
    const boundary = path.resolve(ROOT, "core");
    if (!resolvedTarget.startsWith(boundary + path.sep) && resolvedTarget !== boundary) { console.error(chalk.red("Path traversal detected")); process.exit(1); }
    if (fs.existsSync(targetDir) && !opts.force) { console.error(chalk.red(`Already exists. Use --force.`)); process.exit(1); }
    if (opts.dryRun) { console.log(chalk.yellow(`  [dry-run] Would write to: ${path.relative(ROOT, targetDir)}`)); return; }
    const licenseCheck = validateLicense(entry.license);
    if (!licenseCheck.valid) { console.error(chalk.red(`License: ${licenseCheck.reason}`)); process.exit(1); }
    console.log(chalk.green("  ✓ License check passed") + chalk.gray(` (${entry.license})`));
    fs.mkdirSync(targetDir, { recursive: true });
    const manifest = { ...entry, installedFrom: channel.name, installedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    console.log(chalk.green(`  ✓ Written to ${path.relative(ROOT, targetDir)}`));
    console.log(chalk.gray(`\nNext: add "${entry.name}" to agentboot.config.json → ${entry.type}s.enabled`));
  });

marketplaceCmd
  .command("publish [component]")
  .description("Publish a component to the marketplace")
  .option("--layer <layer>", "Target layer: community or verified", "community")
  .option("--dry-run", "Show what would be submitted without submitting")
  .action(async (component: string | undefined, opts) => {
    const { validateLicense } = await import("./lib/marketplace.js");
    if (!component) { console.error(chalk.red("Usage: agentboot marketplace publish <type>/<name>")); process.exit(1); }
    const parts = component.split("/");
    if (parts.length !== 2) { console.error(chalk.red("Format: <type>/<name>")); process.exit(1); }
    const [type, name] = parts;
    const typeDir = type === "domain" ? "domains" : `${type}s`;
    const componentDir = path.join(ROOT, "core", typeDir, name!);
    if (!fs.existsSync(componentDir)) { console.error(chalk.red(`Not found: ${componentDir}`)); process.exit(1); }
    console.log(chalk.bold(`\nPre-publish checks for ${component}:`));
    const contentFiles = fs.readdirSync(componentDir).filter(f => f.endsWith(".md"));
    if (contentFiles.length === 0 && type !== "domain") { console.error(chalk.red("  ✗ No content files")); process.exit(1); }
    console.log(chalk.green("  ✓ Content file found"));
    const manifestPath = path.join(componentDir, "manifest.json");
    let manifest: any = {};
    if (fs.existsSync(manifestPath)) { try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {} }
    const license = manifest.license;
    if (!license) { console.error(chalk.red("  ✗ No license in manifest")); process.exit(1); }
    const licenseCheck = validateLicense(license);
    if (!licenseCheck.valid) { console.error(chalk.red(`  ✗ ${licenseCheck.reason}`)); process.exit(1); }
    console.log(chalk.green(`  ✓ License: ${license}`));
    const secretPatterns = [/AKIA[A-Z0-9]{16}/, /sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{36}/];
    let secretsFound = false;
    for (const file of contentFiles) {
      const content = fs.readFileSync(path.join(componentDir, file), "utf-8");
      for (const p of secretPatterns) { if (p.test(content)) { secretsFound = true; break; } }
    }
    if (secretsFound) { console.error(chalk.red("  ✗ Secrets detected")); process.exit(1); }
    console.log(chalk.green("  ✓ No secrets detected"));
    if (opts.dryRun) { console.log(chalk.yellow(`\n  [dry-run] Would submit PR for ${component}`)); return; }
    console.log(chalk.green("\n  All pre-publish checks passed."));
  });

// ---------------------------------------------------------------------------
// AB-150: Registry management commands
// ---------------------------------------------------------------------------

const registryCmd = program
  // GA surface-pruning (R.2): part of the hidden marketplace subsystem.
  .command("registry", { hidden: true })
  .description("Manage marketplace registry channels");

registryCmd
  .command("channels")
  .description("List configured registry channels")
  .action(async () => {
    const { getChannels, loadCachedRegistry } = await import("./lib/marketplace.js");
    const config = loadConfig(path.join(ROOT, "agentboot.config.json"));
    const channels = getChannels(config as any);
    console.log(chalk.bold("\nConfigured registry channels:\n"));
    for (const ch of channels) {
      const cached = loadCachedRegistry(ch.name);
      const status = cached ? chalk.green(`cached (${cached.components.length} components)`) : chalk.gray("not cached");
      console.log(`  ${chalk.bold(ch.name)} (priority: ${ch.priority})\n    URL: ${ch.url}\n    Cache: ${status}`);
    }
  });

registryCmd
  .command("refresh")
  .description("Clear and refresh all registry caches")
  .action(async () => {
    const { refreshCache, getChannels } = await import("./lib/marketplace.js");
    const config = loadConfig(path.join(ROOT, "agentboot.config.json"));
    refreshCache(getChannels(config as any));
  });

registryCmd
  .command("status")
  .description("Show cache age and channel health")
  .action(async () => {
    const { getChannels, getCacheDir } = await import("./lib/marketplace.js");
    const config = loadConfig(path.join(ROOT, "agentboot.config.json"));
    const channels = getChannels(config as any);
    console.log(chalk.bold("\nRegistry status:\n"));
    console.log(`  Cache dir: ${getCacheDir()}`);
    for (const ch of channels) {
      const cachePath = path.join(getCacheDir(), `${ch.name}-registry.json`);
      if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        const ageHours = Math.round((Date.now() - stat.mtimeMs) / (1000 * 60 * 60) * 10) / 10;
        const stale = Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000;
        console.log(`  ${ch.name}: ${stale ? chalk.yellow("stale") : chalk.green("fresh")} (${ageHours}h ago)`);
      } else {
        console.log(`  ${ch.name}: ${chalk.gray("no cache")}`);
      }
    }
  });

registryCmd
  .command("seed")
  .description("Generate a local registry from built components (for testing)")
  .action(async () => {
    const { writeCachedRegistry, computeSha256 } = await import("./lib/marketplace.js");
    const traitDir = path.join(ROOT, "core", "traits");
    const components: any[] = [];
    if (fs.existsSync(traitDir)) {
      for (const file of fs.readdirSync(traitDir).filter(f => f.endsWith(".md"))) {
        const name = path.basename(file, ".md");
        components.push({
          id: `trait/${name}`, name, type: "trait", layer: "core", version: "1.0.0",
          description: `Core trait: ${name}`, author: { handle: "agentboot" },
          license: "Apache-2.0", tags: ["core"], path: `traits/core/${name}`,
          sha: computeSha256(path.join(traitDir, file)),
        });
      }
    }
    const registry = { $schema: "https://agentboot.dev/schemas/registry/v1.json", version: "1", generated: new Date().toISOString(), components };
    writeCachedRegistry("public", registry);
    console.log(chalk.green(`\n✓ Seeded registry with ${components.length} component(s)`));
  });

registryCmd
  .command("validate-contrib <path>")
  .description("Validate a component for marketplace contribution")
  .option("--layer <layer>", "Target layer: community or verified", "community")
  .action(async (componentPath: string, opts) => {
    const { validateContribution } = await import("./lib/contribution.js");
    const absPath = path.resolve(componentPath);
    if (!fs.existsSync(absPath)) { console.error(chalk.red(`Not found: ${absPath}`)); process.exit(1); }
    console.log(chalk.bold(`\nValidating contribution: ${path.basename(absPath)}\n`));
    const result = validateContribution(absPath, { layer: opts.layer });
    for (const check of result.checks) {
      console.log(`  ${check.passed ? chalk.green("✓") : chalk.red("✗")} ${check.name}: ${check.message}`);
    }
    console.log();
    if (result.passed) { console.log(chalk.green("All checks passed!")); }
    else { console.log(chalk.red("Some checks failed.")); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// AB-153: Optimize command
// ---------------------------------------------------------------------------

program
  .command("optimize")
  .description("Analyze persona telemetry and generate optimization recommendations")
  .option("--since <date>", "Start date (YYYY-MM-DD)")
  .option("--until <date>", "End date (YYYY-MM-DD)")
  .option("--scope <scope>", "Filter by scope (e.g., team:platform/*)")
  .option("--report", "Generate HTML report")
  .option("--output-dir <path>", "Output directory for report", ".")
  .option("--json", "Output raw JSON metrics")
  .action(async (opts, cmd) => {
    const { loadTelemetry, aggregateMetrics, generateModelRecommendations, analyzeCoverage, printOptimizeReport, generateHtmlReport } = await import("./lib/optimize.js");
    const events = loadTelemetry({ since: opts.since, until: opts.until, scope: opts.scope });
    if (events.length === 0) {
      console.log(chalk.yellow("\nNo telemetry found. Run some personas first, or check ~/.agentboot/telemetry/"));
      process.exit(0);
    }
    const metrics = aggregateMetrics(events);
    const recommendations = generateModelRecommendations(metrics);
    // Config is optional and only feeds coverage-gap analysis. Honor the
    // explicit --config / AGENTBOOT_HUB override, else the user's hub (cwd);
    // never the package dir (ROOT has no config in a published install), and
    // tolerate its absence rather than crashing.
    const globalOpts = cmd.optsWithGlobals();
    const cwdConfigPath = globalOpts.config
      ? path.resolve(globalOpts.config as string)
      : envHubConfig() ?? path.join(process.cwd(), "agentboot.config.json");
    const config = fs.existsSync(cwdConfigPath) ? loadConfig(cwdConfigPath) : null;
    const enabledPersonas = config?.personas?.enabled ?? [];
    const knownScopes = metrics.map((m: any) => m.scope).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
    const gaps = analyzeCoverage(metrics, enabledPersonas, knownScopes);
    if (opts.json) { console.log(JSON.stringify({ metrics, recommendations, gaps }, null, 2)); return; }
    // UI-15: tell the report how many events actually carry cost/token fields
    const eventMix = {
      total: events.length,
      withCost: events.filter((e: any) => e.cost_usd !== undefined || e.input_tokens !== undefined).length,
    };
    printOptimizeReport(metrics, recommendations, gaps, {}, eventMix);
    if (opts.report) {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
      const html = generateHtmlReport(metrics, recommendations, gaps, {}, pkg.version);
      const date = new Date().toISOString().split("T")[0];
      const reportPath = path.join(opts.outputDir ?? ".", `agentboot-optimize-${date}.html`);
      fs.writeFileSync(reportPath, html, "utf-8");
      console.log(chalk.green(`\n✓ Report written to ${reportPath}`));
    }
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse();
