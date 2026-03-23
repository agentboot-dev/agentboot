/**
 * AgentBoot install command — interactive onboarding wizard.
 *
 * Two paths:
 *   Path 1 (Architect): Create a new personas repo (hub)
 *   Path 2 (Developer): Connect a code repo to an existing hub
 *
 * This is a deterministic, non-LLM command. It never calls an LLM.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { select, input, confirm } from "@inquirer/prompts";

export class AgentBootError extends Error {
  constructor(public readonly exitCode: number) {
    super(`AgentBoot exit: ${exitCode}`);
    this.name = "AgentBootError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallOptions {
  hub?: boolean | undefined;
  connect?: boolean | undefined;
  org?: string | undefined;
  path?: string | undefined;
  hubPath?: string | undefined;
  nonInteractive?: boolean | undefined;
  noSync?: boolean | undefined;
  skipDetect?: boolean | undefined;
}

interface DetectionResult {
  isGitRepo: boolean;
  hasPackageJson: boolean;
  hasSrcDir: boolean;
  hasAgentbootConfig: boolean;
  hasClaudeDir: boolean;
  hasManifest: boolean;
  gitOrg: string | null;
  gitRepoName: string | null;
  looksLikeCodeRepo: boolean;
  claudeArtifacts: string[];
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

export function detectCwd(cwd: string): DetectionResult {
  const result: DetectionResult = {
    isGitRepo: fs.existsSync(path.join(cwd, ".git")),
    hasPackageJson: fs.existsSync(path.join(cwd, "package.json")),
    hasSrcDir: fs.existsSync(path.join(cwd, "src")),
    hasAgentbootConfig: fs.existsSync(path.join(cwd, "agentboot.config.json")),
    hasClaudeDir: fs.existsSync(path.join(cwd, ".claude")),
    hasManifest: fs.existsSync(path.join(cwd, ".claude", ".agentboot-manifest.json")),
    gitOrg: null,
    gitRepoName: null,
    looksLikeCodeRepo: false,
    claudeArtifacts: [],
  };

  // Detect org from git remote
  if (result.isGitRepo) {
    try {
      const gitResult = spawnSync("git", ["remote", "get-url", "origin"], {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (gitResult.stdout) {
        const match = gitResult.stdout.trim().match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
        if (match) {
          result.gitOrg = match[1]!;
          result.gitRepoName = match[2]!;
        }
      }
    } catch { /* no git */ }
  }

  // Heuristic: does this look like a code repo (not a personas hub)?
  result.looksLikeCodeRepo =
    (result.hasPackageJson || result.hasSrcDir) && !result.hasAgentbootConfig;

  // Inventory existing .claude/ artifacts
  if (result.hasClaudeDir) {
    const claudeBase = path.join(cwd, ".claude");
    const check = (rel: string) => {
      if (fs.existsSync(path.join(claudeBase, rel))) {
        result.claudeArtifacts.push(rel);
      }
    };
    check("CLAUDE.md");
    if (fs.existsSync(path.join(claudeBase, "agents"))) {
      const agents = fs.readdirSync(path.join(claudeBase, "agents"));
      for (const a of agents) result.claudeArtifacts.push(`agents/${a}`);
    }
    if (fs.existsSync(path.join(claudeBase, "skills"))) {
      const skills = fs.readdirSync(path.join(claudeBase, "skills"));
      for (const s of skills) result.claudeArtifacts.push(`skills/${s}`);
    }
    if (fs.existsSync(path.join(claudeBase, "rules"))) {
      const rules = fs.readdirSync(path.join(claudeBase, "rules"));
      for (const r of rules) result.claudeArtifacts.push(`rules/${r}`);
    }
    check("settings.json");
    check(".mcp.json");
  }

  return result;
}

function detectGhAvailable(): boolean {
  try {
    const result = spawnSync("gh", ["--version"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function detectGhAuthenticated(): boolean {
  try {
    const result = spawnSync("gh", ["auth", "status"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Shallow scan sibling directories for agentboot.config.json or .claude/.
 * Returns list of found paths with their type.
 */
function scanSiblings(cwd: string): Array<{ path: string; type: "hub" | "claude" }> {
  const parent = path.dirname(cwd);
  const results: Array<{ path: string; type: "hub" | "claude" }> = [];

  try {
    for (const entry of fs.readdirSync(parent)) {
      const siblingPath = path.join(parent, entry);
      if (siblingPath === cwd) continue;

      try {
        const stat = fs.statSync(siblingPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      if (fs.existsSync(path.join(siblingPath, "agentboot.config.json"))) {
        results.push({ path: siblingPath, type: "hub" });
      } else if (fs.existsSync(path.join(siblingPath, ".claude"))) {
        results.push({ path: siblingPath, type: "claude" });
      }
    }
  } catch { /* permission denied, etc. */ }

  return results;
}

/**
 * Search GitHub org for a personas repo using `gh`.
 */
function searchGitHubOrg(org: string): string | null {
  try {
    // Search for repos named "personas" or "agent-personas"
    const result = spawnSync("gh", [
      "repo", "list", org,
      "--json", "name,url",
      "--limit", "100",
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.status !== 0) return null;

    const repos = JSON.parse(result.stdout) as Array<{ name: string; url: string }>;
    const match = repos.find(r =>
      r.name === "personas" ||
      r.name === "agent-personas" ||
      r.name.endsWith("-personas")
    );

    return match?.url ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scaffold helpers
// ---------------------------------------------------------------------------

export function scaffoldHub(targetDir: string, orgName: string): void {
  // agentboot.config.json
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

  fs.writeFileSync(path.join(targetDir, "agentboot.config.json"), configContent + "\n", "utf-8");

  // repos.json
  if (!fs.existsSync(path.join(targetDir, "repos.json"))) {
    fs.writeFileSync(path.join(targetDir, "repos.json"), "[]\n", "utf-8");
  }

  // Core directories
  const dirs = ["core/personas", "core/traits", "core/instructions", "core/gotchas"];
  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}

function runBuild(hubDir: string): boolean {
  console.log(chalk.cyan("\n  Compiling personas..."));
  const result = spawnSync("agentboot", ["build"], {
    cwd: hubDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status === 0) {
    console.log(chalk.green("  Compiled successfully."));
    return true;
  } else {
    console.log(chalk.yellow("  Build skipped — run `agentboot build` from the personas repo."));
    return false;
  }
}

function runSync(hubDir: string): boolean {
  const result = spawnSync("agentboot", ["sync"], {
    cwd: hubDir,
    encoding: "utf-8",
    stdio: "inherit",
  });
  return result.status === 0;
}

// ---------------------------------------------------------------------------
// Path 1: Create a new personas repo (Architect)
// ---------------------------------------------------------------------------

async function path1CreateHub(cwd: string, opts: InstallOptions, detection: DetectionResult): Promise<void> {
  // Step 1.1: Where to create it
  let hubDir: string;

  if (opts.path) {
    hubDir = path.resolve(opts.path);
  } else if (detection.looksLikeCodeRepo) {
    const parentDir = path.dirname(cwd);
    const suggestedPath = path.join(parentDir, "personas");

    console.log(chalk.yellow(
      `\n  This looks like an application repo (${path.basename(cwd)}), not a good\n` +
      `  home for your org's persona source code.\n\n` +
      `  The personas repo should be its own project — like a design system\n` +
      `  or infrastructure repo.`
    ));

    const choice = await select({
      message: "Where should the personas repo live?",
      choices: [
        { name: `Create ${suggestedPath} (recommended)`, value: "suggested" },
        { name: "Create in a different location", value: "custom" },
        { name: "Use this directory anyway (not recommended)", value: "here" },
      ],
    });

    if (choice === "suggested") {
      hubDir = suggestedPath;
    } else if (choice === "custom") {
      const customPath = await input({
        message: "Path:",
        default: suggestedPath,
      });
      hubDir = path.resolve(customPath);
    } else {
      hubDir = cwd;
    }
  } else {
    // cwd looks like a good place (empty or non-code directory)
    const useHere = await confirm({
      message: `Use this directory (${cwd})?`,
      default: true,
    });

    if (useHere) {
      hubDir = cwd;
    } else {
      const customPath = await input({ message: "Path:" });
      hubDir = path.resolve(customPath);
    }
  }

  // Create directory if needed
  if (!fs.existsSync(hubDir)) {
    fs.mkdirSync(hubDir, { recursive: true });
  }

  // Step 1.2: Org detection
  let orgName = opts.org ?? detection.gitOrg ?? null;

  if (!orgName) {
    // Try detecting from the hub dir's git remote
    try {
      const gitResult = spawnSync("git", ["remote", "get-url", "origin"], {
        cwd: hubDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (gitResult.stdout) {
        const match = gitResult.stdout.trim().match(/[/:]([\w.-]+)\//);
        if (match) orgName = match[1]!;
      }
    } catch { /* no git */ }
  }

  if (orgName) {
    const useDetected = await confirm({
      message: `Use "${orgName}" as your org name?`,
      default: true,
    });
    if (!useDetected) {
      orgName = await input({ message: "Org name:" });
    }
  } else {
    orgName = await input({
      message: "Org name (GitHub org or username):",
    });
  }

  // Step 1.3: Scan for existing content nearby (with permission)
  const shouldScan = await confirm({
    message: "Scan nearby directories for existing AI agent content?",
    default: true,
  });

  if (shouldScan) {
    const siblings = scanSiblings(hubDir !== cwd ? cwd : hubDir);
    const claudeSiblings = siblings.filter(s => s.type === "claude");

    if (claudeSiblings.length > 0) {
      console.log(chalk.gray(`\n  Found agentic content in ${claudeSiblings.length} nearby repo(s):`));
      for (const s of claudeSiblings.slice(0, 5)) {
        console.log(chalk.gray(`    ${s.path}/.claude/`));
      }
      if (claudeSiblings.length > 5) {
        console.log(chalk.gray(`    ... and ${claudeSiblings.length - 5} more`));
      }
      console.log(chalk.gray(
        `\n  You can import this content later with: agentboot import --path <dir>`
      ));
    } else {
      console.log(chalk.gray("\n  No existing agentic content found nearby."));
    }
  }

  // Step 1.4: Scaffold
  console.log(chalk.bold(`\n  Creating personas repo for ${orgName}...\n`));

  scaffoldHub(hubDir, orgName);

  console.log(chalk.green("  Source code:"));
  console.log(chalk.gray("    core/personas/          4 personas (code-reviewer, security-reviewer, ...)"));
  console.log(chalk.gray("    core/traits/            6 traits (critical-thinking, structured-output, ...)"));
  console.log(chalk.gray("    core/instructions/      2 always-on instruction sets"));
  console.log(chalk.gray("    core/gotchas/           (empty — add domain knowledge here)"));
  console.log(chalk.green("\n  Build configuration:"));
  console.log(chalk.gray(`    agentboot.config.json   org: "${orgName}"`));
  console.log(chalk.gray("    repos.json              (empty — register your repos here)"));

  // Step 1.5: Auto-build
  const hasNodeModules = fs.existsSync(path.join(hubDir, "node_modules"));
  if (hasNodeModules) {
    runBuild(hubDir);
  } else {
    console.log(chalk.gray("\n  Run `npm install && agentboot build` to compile personas."));
  }

  // Step 1.6: Register first repo (optional)
  const registerRepo = await confirm({
    message: "Register your first target repo now?",
    default: true,
  });

  if (registerRepo) {
    const repoPathInput = await input(
      detection.looksLikeCodeRepo
        ? { message: "Path to a local repo:", default: cwd }
        : { message: "Path to a local repo:" }
    );
    const repoPath = path.resolve(repoPathInput);

    if (!fs.existsSync(repoPath)) {
      console.log(chalk.yellow(`  Path does not exist: ${repoPath}`));
    } else {
      // Detect repo name from git
      let repoName = path.basename(repoPath);
      try {
        const gitResult = spawnSync("git", ["remote", "get-url", "origin"], {
          cwd: repoPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        if (gitResult.stdout) {
          const match = gitResult.stdout.trim().match(/[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
          if (match) repoName = match[1]!;
        }
      } catch { /* no git */ }

      // Add to repos.json
      const reposJsonPath = path.join(hubDir, "repos.json");
      let repos: Array<{ path: string; label?: string }> = [];
      try {
        repos = JSON.parse(fs.readFileSync(reposJsonPath, "utf-8"));
      } catch { /* empty or invalid */ }

      repos.push({ path: repoPath, label: repoName });
      fs.writeFileSync(reposJsonPath, JSON.stringify(repos, null, 2) + "\n", "utf-8");
      console.log(chalk.green(`\n  Added ${repoName} to repos.json.`));

      // Check for existing .claude/ content
      if (fs.existsSync(path.join(repoPath, ".claude"))) {
        console.log(chalk.gray(
          `  This repo has existing .claude/ content. On first sync, it will be\n` +
          `  archived to .claude/.agentboot-archive/. You can restore it with\n` +
          `  agentboot uninstall.`
        ));
      }

      // Offer to sync
      if (!opts.noSync && hasNodeModules && fs.existsSync(path.join(hubDir, "dist"))) {
        const shouldSync = await confirm({
          message: "Deploy personas to this repo now?",
          default: true,
        });

        if (shouldSync) {
          console.log(chalk.cyan("\n  Syncing..."));
          if (runSync(hubDir)) {
            console.log(chalk.green("\n  Personas deployed. Try: /review-code"));
          }
        }
      }
    }
  }

  // Step 1.7: Governance recommendations
  console.log(chalk.bold("\n  Recommendations for your personas repo:\n"));
  console.log(chalk.gray(
    "    Branch protection:\n" +
    "      Enable branch protection on 'main' with required PR reviews.\n" +
    "      Persona changes should go through code review.\n"
  ));
  console.log(chalk.gray(
    "    Contributing path:\n" +
    "      Developers who use personas daily are your best contributors.\n" +
    "      A low-friction PR workflow lets them improve the prompts they know best.\n"
  ));
  console.log(chalk.gray(
    "    CI validation:\n" +
    "      Add `agentboot validate --strict` to your CI pipeline.\n"
  ));

  // Step 1.8: Next steps
  console.log(chalk.bold(`${chalk.green("✓")} Persona source code lives at: ${hubDir}\n`));
  console.log(chalk.gray("  Next steps:"));
  console.log(chalk.gray("    1. Review personas:    Browse core/personas/ and customize"));
  console.log(chalk.gray("    2. Add more repos:     Edit repos.json or run `agentboot install` from a repo"));
  console.log(chalk.gray("    3. Import existing:    agentboot import --path ~/work/"));
  console.log(chalk.gray("    4. Set up CI:          agentboot validate --strict in your pipeline\n"));
}

// ---------------------------------------------------------------------------
// Path 2: Connect this repo to an existing hub (Developer)
// ---------------------------------------------------------------------------

async function path2ConnectToHub(cwd: string, opts: InstallOptions, detection: DetectionResult): Promise<void> {
  let hubDir: string | null = opts.hubPath ? path.resolve(opts.hubPath) : null;

  // Step 2.1: Find the hub
  if (!hubDir) {
    console.log(chalk.gray("\n  Looking for your org's personas repo...\n"));

    // Check siblings
    const siblings = scanSiblings(cwd);
    const hubSiblings = siblings.filter(s => s.type === "hub");

    if (hubSiblings.length === 1) {
      const foundHub = hubSiblings[0]!;
      const useFound = await confirm({
        message: `Found personas repo: ${foundHub.path}. Connect to it?`,
        default: true,
      });
      if (useFound) {
        hubDir = foundHub.path;
      }
    } else if (hubSiblings.length > 1) {
      const choice = await select({
        message: "Multiple personas repos found. Which one?",
        choices: [
          ...hubSiblings.map(h => ({ name: h.path, value: h.path })),
          { name: "Enter a different path", value: "__custom__" },
        ],
      });
      hubDir = choice === "__custom__" ? null : choice;
    }

    // Try GitHub org search if gh is available
    if (!hubDir && detection.gitOrg) {
      const hasGh = detectGhAvailable();

      if (!hasGh) {
        const ghChoice = await select({
          message: "GitHub CLI (gh) is not installed. It can help find your org's personas repo.",
          choices: [
            { name: "Exit and install gh manually (https://cli.github.com)", value: "exit" },
            { name: "Skip — I'll enter the hub path manually", value: "skip" },
            { name: "Continue without gh", value: "continue" },
          ],
        });

        if (ghChoice === "exit") {
          console.log(chalk.gray("\n  Install gh, then run `agentboot install` again.\n"));
          throw new AgentBootError(0);
        }
      } else if (detectGhAuthenticated()) {
        console.log(chalk.gray(`  Searching GitHub org "${detection.gitOrg}" for personas repo...`));
        const ghUrl = searchGitHubOrg(detection.gitOrg);
        if (ghUrl) {
          console.log(chalk.cyan(`  Found: ${ghUrl}`));
          console.log(chalk.gray("  Clone it locally, then run `agentboot install --connect` again."));
          console.log(chalk.gray(`  Or: gh repo clone ${detection.gitOrg}/personas\n`));
          throw new AgentBootError(0);
        } else {
          console.log(chalk.gray("  No personas repo found in your GitHub org."));
        }
      }
    }

    // Manual entry fallback
    if (!hubDir) {
      const choice = await select({
        message: "How would you like to connect?",
        choices: [
          { name: "Enter the local path to your org's personas repo", value: "path" },
          { name: "My org doesn't have one yet (create one now)", value: "create" },
        ],
      });

      if (choice === "create") {
        return path1CreateHub(cwd, opts, detection);
      }

      const hubPathInput = await input({ message: "Path to personas repo:" });
      hubDir = path.resolve(hubPathInput);
    }
  }

  // Validate hub
  if (!hubDir || !fs.existsSync(path.join(hubDir, "agentboot.config.json"))) {
    console.log(chalk.red(`\n  No agentboot.config.json found at: ${hubDir ?? "(none)"}`));
    console.log(chalk.gray("  Make sure the path points to a valid personas repo.\n"));
    throw new AgentBootError(1);
  }

  console.log(chalk.green(`\n  Connected to personas repo: ${hubDir}`));

  // Step 2.2: Register via branch + PR
  const repoPath = cwd;
  let repoName = path.basename(repoPath);
  try {
    const gitResult = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (gitResult.stdout) {
      const match = gitResult.stdout.trim().match(/[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
      if (match) repoName = match[1]!;
    }
  } catch { /* no git */ }

  // Add to repos.json
  const reposJsonPath = path.join(hubDir, "repos.json");
  let repos: Array<{ path: string; label?: string }> = [];
  try {
    repos = JSON.parse(fs.readFileSync(reposJsonPath, "utf-8"));
  } catch { /* empty */ }

  // Check if already registered
  if (repos.some(r => r.path === repoPath || r.label === repoName)) {
    console.log(chalk.yellow(`  ${repoName} is already registered in repos.json.`));
  } else {
    // Try branch + PR approach
    const hasGh = detectGhAvailable() && detectGhAuthenticated();
    const branchName = `add-repo/${path.basename(repoPath)}`;

    const useGhPr = hasGh && await confirm({
      message: "Create a branch and PR to register this repo? (recommended)",
      default: true,
    });

    if (useGhPr) {
      try {
        const gitRun = (args: string[]) => {
          const r = spawnSync("git", args, { cwd: hubDir!, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
          if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.trim() ?? "unknown error"}`);
          }
          return r.stdout?.trim() ?? "";
        };

        // Check that hub working tree is clean before branching
        const statusResult = spawnSync("git", ["status", "--porcelain"], {
          cwd: hubDir!, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
        });
        if (statusResult.stdout?.trim()) {
          console.log(chalk.yellow("  Hub repo has uncommitted changes. Falling back to direct edit."));
          repos.push({ path: repoPath, label: repoName });
          fs.writeFileSync(reposJsonPath, JSON.stringify(repos, null, 2) + "\n", "utf-8");
          console.log(chalk.green(`  Added ${repoName} to repos.json (direct edit).`));
          // Skip PR flow — fall through to the rest of path 2
        } else {
          let branchCreated = false;
          try {
            gitRun(["checkout", "-b", branchName]);
            branchCreated = true;
            repos.push({ path: repoPath, label: repoName });
            fs.writeFileSync(reposJsonPath, JSON.stringify(repos, null, 2) + "\n", "utf-8");
            gitRun(["add", "repos.json"]);
            gitRun(["commit", "-m", `chore: register ${repoName}`]);
            gitRun(["push", "-u", "origin", branchName]);

            const prResult = spawnSync("gh", [
              "pr", "create",
              "--title", `chore: register ${repoName}`,
              "--body", `Register ${repoName} for AgentBoot persona sync.\n\nPath: ${repoPath}`,
            ], { cwd: hubDir!, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

            if (prResult.status === 0) {
              console.log(chalk.green(`  PR created: ${prResult.stdout.trim()}`));
            } else {
              console.log(chalk.yellow(`  Branch pushed. Create a PR manually from: ${branchName}`));
            }
          } finally {
            // Always return to previous branch, even on failure
            if (branchCreated) {
              try {
                spawnSync("git", ["checkout", "-"], { cwd: hubDir!, stdio: ["pipe", "pipe", "pipe"] });
              } catch { /* best effort */ }
            }
          }
        }
      } catch (err) {
        console.log(chalk.yellow(`  Could not create PR: ${err}`));
        console.log(chalk.gray("  Add this entry to repos.json manually:"));
        console.log(chalk.gray(`    { "path": "${repoPath}", "label": "${repoName}" }`));
      }
    } else {
      // Direct edit (solo developers or manual preference)
      repos.push({ path: repoPath, label: repoName });
      fs.writeFileSync(reposJsonPath, JSON.stringify(repos, null, 2) + "\n", "utf-8");
      console.log(chalk.green(`  Added ${repoName} to repos.json.`));
    }
  }

  // Step 2.3: Handle existing content
  if (detection.claudeArtifacts.length > 0) {
    console.log(chalk.gray(`\n  This repo has existing agent content:`));
    for (const artifact of detection.claudeArtifacts.slice(0, 8)) {
      console.log(chalk.gray(`    .claude/${artifact}`));
    }
    if (detection.claudeArtifacts.length > 8) {
      console.log(chalk.gray(`    ... and ${detection.claudeArtifacts.length - 8} more`));
    }
    console.log(chalk.gray(
      `\n  On first sync, this content will be archived to .claude/.agentboot-archive/.\n` +
      `  To import it into the personas repo: agentboot import --path .`
    ));
  }

  // Step 2.4: Build and sync
  if (fs.existsSync(path.join(hubDir, "dist"))) {
    if (!opts.noSync) {
      const shouldSync = await confirm({
        message: "Deploy personas to this repo now?",
        default: true,
      });

      if (shouldSync) {
        console.log(chalk.cyan("\n  Syncing..."));
        if (runSync(hubDir)) {
          console.log(chalk.green("\n  Done. Try: /review-code\n"));
        }
      }
    }
  } else {
    console.log(chalk.gray(
      `\n  The personas repo needs to be compiled first.\n` +
      `  Run from the personas repo:\n` +
      `    cd ${hubDir}\n` +
      `    agentboot build && agentboot sync\n`
    ));
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runInstall(opts: InstallOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.bold("\n  AgentBoot — Personas-as-Code\n"));
  console.log(chalk.gray(
    "  AgentBoot manages your AI agent behavior as source code: versioned,\n" +
    "  reviewed, tested, and deployed from a central repo to every project\n" +
    "  in your org.\n"
  ));

  // Handle --non-interactive
  if (opts.nonInteractive) {
    console.log(chalk.red("  --non-interactive is not yet implemented."));
    console.log(chalk.gray("  This feature is planned for a future release.\n"));
    throw new AgentBootError(1);
  }

  const detection = detectCwd(cwd);

  // If already a hub, redirect to doctor
  if (detection.hasAgentbootConfig && !opts.connect) {
    console.log(chalk.yellow("  agentboot.config.json already exists in this directory."));
    console.log(chalk.gray("  Run `agentboot doctor` to check your configuration.\n"));
    throw new AgentBootError(0);
  }

  // If already managed by AgentBoot, note it
  if (detection.hasManifest && !opts.hub) {
    console.log(chalk.gray("  This repo is already managed by AgentBoot (manifest found).\n"));
  }

  // Determine path from flags or ask
  if (opts.hub) {
    await path1CreateHub(cwd, opts, detection);
  } else if (opts.connect) {
    await path2ConnectToHub(cwd, opts, detection);
  } else {
    const choice = await select({
      message: "What are you setting up?",
      choices: [
        { name: "A new personas repo (first time for your org)", value: "hub" },
        { name: "Connect this repo to an existing personas repo", value: "connect" },
      ],
    });

    if (choice === "hub") {
      await path1CreateHub(cwd, opts, detection);
    } else {
      await path2ConnectToHub(cwd, opts, detection);
    }
  }
}
