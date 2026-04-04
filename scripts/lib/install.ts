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
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { select, input, confirm, checkbox } from "@inquirer/prompts";

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
  promptFiles: string[];
}

export interface HasPromptsResult {
  found: boolean;
  files: string[];
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** Escape a path for safe copy-paste into a shell. */
export function shellQuote(p: string): string {
  // If the path only contains safe characters, return as-is
  if (/^[a-zA-Z0-9_./:~-]+$/.test(p)) return p;
  // Otherwise wrap in single quotes, escaping any embedded single quotes
  return "'" + p.replace(/'/g, "'\\''") + "'";
}

/**
 * Check a directory for known agentic file locations.
 * Shallow existence checks only — no file reading, no classification.
 */
export function hasPrompts(dirPath: string): HasPromptsResult {
  const files: string[] = [];

  // .claude/ non-empty (excluding agentboot artifacts)
  try {
    const claudeDir = path.join(dirPath, ".claude");
    if (fs.existsSync(claudeDir) && fs.statSync(claudeDir).isDirectory()) {
      const entries = fs.readdirSync(claudeDir);
      const excluded = new Set([".agentboot-archive", ".agentboot-manifest.json"]);
      const relevant = entries.filter(e => !excluded.has(e));
      if (relevant.length > 0) {
        for (const e of relevant) {
          files.push(`.claude/${e}`);
        }
      }
    }
  } catch { /* permission errors */ }

  // Root CLAUDE.md
  try {
    if (fs.existsSync(path.join(dirPath, "CLAUDE.md"))) {
      files.push("CLAUDE.md");
    }
  } catch { /* permission errors */ }

  // .cursorrules
  try {
    if (fs.existsSync(path.join(dirPath, ".cursorrules"))) {
      files.push(".cursorrules");
    }
  } catch { /* permission errors */ }

  // .github/copilot-instructions.md
  try {
    if (fs.existsSync(path.join(dirPath, ".github", "copilot-instructions.md"))) {
      files.push(".github/copilot-instructions.md");
    }
  } catch { /* permission errors */ }

  // .github/prompts/*.prompt.md
  try {
    const promptsDir = path.join(dirPath, ".github", "prompts");
    if (fs.existsSync(promptsDir) && fs.statSync(promptsDir).isDirectory()) {
      const entries = fs.readdirSync(promptsDir);
      for (const e of entries) {
        if (e.endsWith(".prompt.md")) {
          files.push(`.github/prompts/${e}`);
        }
      }
    }
  } catch { /* permission errors */ }

  return { found: files.length > 0, files };
}

/**
 * Extract org and repo name from a directory's git remote origin.
 * Returns null if the directory is not a git repo or has no remote.
 */
export function getGitOrgAndRepo(dirPath: string): { org: string; repo: string } | null {
  try {
    const gitResult = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: dirPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (gitResult.status !== 0 || !gitResult.stdout) return null;
    const match = gitResult.stdout.trim().match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!match) return null;
    return { org: match[1]!, repo: match[2]! };
  } catch {
    return null;
  }
}

/**
 * Add a repo entry to repos.json in the hub directory.
 * Returns false if the repo is already registered (by path or label).
 */
export function addToReposJson(hubDir: string, repoPath: string, label: string): boolean {
  const reposJsonPath = path.join(hubDir, "repos.json");
  let repos: Array<{ path: string; label?: string }> = [];
  try {
    repos = JSON.parse(fs.readFileSync(reposJsonPath, "utf-8"));
  } catch (err: unknown) {
    // File not found (ENOENT) — start fresh silently.
    // Parse errors (SyntaxError) or other — back up the corrupted file and start fresh.
    const isFileNotFound = err && typeof err === "object" && "code" in err && err.code === "ENOENT";
    if (!isFileNotFound) {
      const backupPath = reposJsonPath + ".corrupt";
      try {
        fs.copyFileSync(reposJsonPath, backupPath);
        console.warn(`  Warning: repos.json is not valid JSON. Backed up to ${path.basename(backupPath)}.`);
      } catch {
        console.warn(`  Warning: repos.json is not valid JSON. Could not create backup.`);
      }
    }
  }

  // Check for duplicates
  if (repos.some(r => r.path === repoPath || r.label === label)) {
    return false;
  }

  repos.push({ path: repoPath, label });
  fs.writeFileSync(reposJsonPath, JSON.stringify(repos, null, 2) + "\n", "utf-8");
  return true;
}

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
    promptFiles: [],
  };

  // Detect org from git remote
  if (result.isGitRepo) {
    const gitInfo = getGitOrgAndRepo(cwd);
    if (gitInfo) {
      result.gitOrg = gitInfo.org;
      result.gitRepoName = gitInfo.repo;
    }
  }

  // Populate promptFiles via hasPrompts
  const prompts = hasPrompts(cwd);
  result.promptFiles = prompts.files;

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

/**
 * Prompt for a directory path with live directory completion.
 * As the user types, matching directories are suggested.
 */
/** Pause until the user presses any key. */
function pressAnyKey(message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(chalk.green("?") + ` ${message}`);
    if (!process.stdin.isTTY) {
      process.stdout.write("\n");
      resolve();
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      // Ctrl-C
      if (data[0] === 3) {
        import("@inquirer/core").then(({ ExitPromptError }) => {
          reject(new ExitPromptError("User force closed the prompt with SIGINT"));
        });
        return;
      }
      resolve();
    });
  });
}

/** Expand shell-style `~` and `$VAR` / `${VAR}` in a path string. */
function expandPath(p: string): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/";
  let result = p;
  // ~/… or ~
  if (result === "~" || result.startsWith("~/")) {
    result = home + result.slice(1);
  }
  // $VAR or ${VAR}
  result = result.replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, braced, plain) => {
    return process.env[braced ?? plain] ?? "";
  });
  return result;
}

async function promptForPath(message: string, defaultPath?: string): Promise<string> {
  // Use Node's readline with a completer for shell-like Tab completion.
  const effectiveDefault = defaultPath ?? process.cwd();

  const completer = (line: string): [string[], string] => {
    const typed = line || effectiveDefault;
    const expanded = expandPath(typed);
    const resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(effectiveDefault, expanded);

    // Determine which directory to list and what prefix the user typed
    let dir: string;
    let partial: string;
    try {
      if (fs.statSync(resolved).isDirectory()) {
        // User typed a complete directory — list its children
        dir = resolved;
        partial = "";
      } else {
        dir = path.dirname(resolved);
        partial = path.basename(resolved);
      }
    } catch {
      // Doesn't exist — complete from parent using the trailing segment as filter
      dir = path.dirname(resolved);
      partial = path.basename(resolved);
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const matches = entries
        .filter(e => e.isDirectory() && !e.name.startsWith("."))
        .filter(e => !partial || e.name.startsWith(partial))
        .map(e => {
          // Reconstruct the completion using the user's typed prefix style
          const typedDir = typed.endsWith("/") || !partial
            ? typed
            : typed.slice(0, typed.length - partial.length);
          return typedDir + e.name + "/";
        });

      return [matches, line];
    } catch {
      return [[], line];
    }
  };

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      terminal: true,
    });

    // Show the prompt with the default in gray
    const prompt = chalk.green("?") + ` ${message} ` + chalk.gray(`(${effectiveDefault}) `);
    rl.question(prompt, (answer) => {
      rl.close();
      const typed = answer.trim() || effectiveDefault;
      const expanded = expandPath(typed);
      // Resolve relative paths against the displayed default, not cwd —
      // the user sees the default as their context, so "fortael/" should
      // mean a child of the default, not a child of the current working dir.
      const resolved = path.isAbsolute(expanded)
        ? path.resolve(expanded)
        : path.resolve(effectiveDefault, expanded);

      // If the path is a file, use the parent directory
      try {
        if (fs.statSync(resolved).isFile()) {
          console.log(chalk.yellow(`  "${resolved}" is a file. Using parent directory.`));
          resolve(path.dirname(resolved));
          return;
        }
      } catch {
        // Doesn't exist yet — that's fine, we'll create it later.
      }

      resolve(resolved);
    });

    // Handle Ctrl-C gracefully — import dynamically to avoid circular dep
    rl.on("close", () => {
      // readline emits 'close' on Ctrl-C after SIGINT
    });
    rl.on("SIGINT", () => {
      rl.close();
      // Re-raise as ExitPromptError so the global handler catches it
      import("@inquirer/core").then(({ ExitPromptError }) => {
        reject(new ExitPromptError("User force closed the prompt with SIGINT"));
      });
    });
  });
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
 * Scan nearby directories for agentboot.config.json or agentic content.
 * Checks: the parent directory itself, cwd, then sibling directories.
 * This supports both sibling layouts (hub next to spokes) and parent layouts
 * (hub is the parent directory containing spoke repos).
 */
export function scanNearby(cwd: string): Array<{ path: string; type: "hub" | "prompts"; files?: string[] }> {
  const parent = path.dirname(cwd);
  const results: Array<{ path: string; type: "hub" | "prompts"; files?: string[] }> = [];

  // Check parent directory itself (supports hub-as-parent layout)
  if (fs.existsSync(path.join(parent, "agentboot.config.json"))) {
    results.push({ path: parent, type: "hub" });
  }

  // Check cwd itself for agentic content (but not as a hub candidate —
  // if cwd were a hub, the install flow would have caught it already)
  const cwdPrompts = hasPrompts(cwd);
  if (cwdPrompts.found) {
    results.push({ path: cwd, type: "prompts", files: cwdPrompts.files });
  }

  // Check sibling directories
  try {
    for (const entry of fs.readdirSync(parent)) {
      const siblingPath = path.join(parent, entry);
      if (siblingPath === cwd) continue; // already checked above

      try {
        const stat = fs.statSync(siblingPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      if (fs.existsSync(path.join(siblingPath, "agentboot.config.json"))) {
        results.push({ path: siblingPath, type: "hub" });
      } else {
        const siblingPrompts = hasPrompts(siblingPath);
        if (siblingPrompts.found) {
          results.push({ path: siblingPath, type: "prompts", files: siblingPrompts.files });
        }
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

    let repos: Array<{ name: string; url: string }>;
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!Array.isArray(parsed)) return null;
      repos = parsed as Array<{ name: string; url: string }>;
    } catch {
      return null; // gh returned non-JSON output
    }

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

export interface ScaffoldOptions {
  agentTools?: string[];
  primaryAgent?: string;
}

export function scaffoldHub(targetDir: string, orgSlug: string, orgDisplayName?: string, opts?: ScaffoldOptions): void {
  // Ensure the target directory exists — it may not have been created yet
  // if the user chose a new path. We create it here rather than earlier so
  // that a Ctrl-C before this point doesn't leave empty directories behind.
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Derive output formats from agent tools — only compile what they use.
  // "skill" and "agents" are always included (cross-platform).
  const outputFormats = ["skill", "agents"];
  const tools = opts?.agentTools ?? ["claude-code", "copilot"];
  if (tools.includes("claude-code")) outputFormats.push("claude");
  if (tools.includes("copilot")) outputFormats.push("copilot");
  if (tools.includes("cursor")) outputFormats.push("cursor");
  // gemini output format planned for Phase 7

  // agentboot.config.json
  const configContent = JSON.stringify({
    org: orgSlug,
    orgDisplayName: orgDisplayName ?? orgSlug,
    agents: {
      tools,
      primary: opts?.primaryAgent ?? tools[0],
      llmProvider: tools.includes("claude-code") ? "claude-code" : "anthropic-api",
    },
    groups: {},
    personas: {
      enabled: ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"],
      outputFormats,
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

  // .gitignore
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, [
      "node_modules/",
      "dist/",
      ".DS_Store",
      "",
    ].join("\n"), "utf-8");
  }

  // Initialize git repo if not already one
  if (!fs.existsSync(path.join(targetDir, ".git"))) {
    const gitInit = spawnSync("git", ["init"], {
      cwd: targetDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (gitInit.status === 0) {
      console.log(chalk.gray("  Initialized git repository."));
    }
  }

  // Core directories
  const dirs = ["core/lexicon", "core/personas", "core/traits", "core/instructions", "core/gotchas"];
  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}

function runBuild(hubDir: string): boolean {
  console.log(chalk.cyan("\n  Compiling personas..."));
  console.log(chalk.gray(
    "  This reads your traits and personas from core/, composes them, and\n" +
    "  writes compiled output to dist/. The dist/ folder is what gets\n" +
    "  deployed to your repos.\n"
  ));
  const result = spawnSync("agentboot", ["build"], {
    cwd: hubDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status === 0) {
    console.log(chalk.green("  Build complete."));
    return true;
  } else {
    console.log(chalk.yellow("  Build did not complete — you can run `agentboot build` later."));
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
// Hub target validation
// ---------------------------------------------------------------------------

/**
 * Validate and potentially adjust the hub target directory.
 *
 * If the target directory exists and looks like it already has content (a git
 * repo, source files, etc.), we don't want to scaffold hub files into it —
 * that would pollute an existing project. Instead, offer to create a `personas`
 * subdirectory.
 */
async function validateHubTarget(initialDir: string): Promise<string> {
  let hubDir = initialDir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // If the directory doesn't exist, it will be created later by scaffoldHub.
    if (!fs.existsSync(hubDir)) {
      return hubDir;
    }

    // If it already has agentboot.config.json, it's already a hub — bail.
    if (fs.existsSync(path.join(hubDir, "agentboot.config.json"))) {
      console.log(chalk.yellow("\n  This directory already has agentboot.config.json."));
      console.log(chalk.gray("  Run `agentboot doctor` to check your configuration.\n"));
      throw new AgentBootError(0);
    }

    // Check if the directory has existing content that suggests it's not an
    // empty directory intended for a new personas repo.
    const entries = fs.readdirSync(hubDir).filter(e => !e.startsWith(".") || e === ".git");
    const hasGit = fs.existsSync(path.join(hubDir, ".git"));
    const hasPackageJson = fs.existsSync(path.join(hubDir, "package.json"));
    const hasSrc = fs.existsSync(path.join(hubDir, "src"));

    const hasExistingContent = entries.length > 0 && (hasGit || hasPackageJson || hasSrc);

    if (!hasExistingContent) {
      // Empty or near-empty directory — fine to use directly.
      return hubDir;
    }

    // The directory has content. Warn and offer alternatives.
    const dirName = path.basename(hubDir);
    const personasPath = path.join(hubDir, "personas");

    console.log(chalk.yellow(
      `\n  "${dirName}" already has content (${entries.length} items).` +
      `\n  That looks like an existing project — the personas repo should be` +
      `\n  a separate sibling repo, not nested inside another project.\n`
    ));

    const useSibling = await confirm({
      message: `Create the personas repo at ${personasPath} instead?`,
      default: true,
    });

    if (useSibling) {
      return personasPath;
    }

    const choice = await select({
      message: "Where should the personas repo live?",
      choices: [
        { name: "Choose a different location", value: "custom" },
        { name: `Use ${hubDir} anyway (not recommended)`, value: "here" },
      ],
    });

    if (choice === "custom") {
      const customPath = await input({
        message: "Path for the personas repo:",
        default: personasPath,
      });
      hubDir = path.resolve(customPath);
      continue; // re-validate the new target
    }

    // "here" — user insists, proceed with original path
    return hubDir;
  }
}

/**
 * Nudge toward the convention of naming the hub repo "personas".
 *
 * If the chosen name doesn't contain "personas" at all, we treat it as an
 * educational moment — explain the convention, offer to rename, and if they
 * still want the non-standard name, require explicit confirmation (default No).
 *
 * If the name contains "personas" (e.g. "acme-personas"), that's close enough.
 */
async function nudgePersonasConvention(hubDir: string): Promise<string> {
  const dirName = path.basename(hubDir);

  // Already follows the convention — nothing to do.
  if (dirName.includes("personas")) return hubDir;

  console.log(chalk.cyan(
    `\n  Naming convention: "personas"\n\n`
  ) + chalk.gray(
    `  AgentBoot follows a convention-over-configuration philosophy. When every\n` +
    `  org names their hub repo "personas", several things work automatically:\n\n` +
    `    - \`agentboot install\` auto-discovers it by scanning for "personas" in\n` +
    `      your GitHub org and sibling directories\n` +
    `    - New team members know where to look without being told\n` +
    `    - Docs, examples, and community answers all reference the same path\n` +
    `    - \`gh repo clone <org>/personas\` works across every AgentBoot org\n`
  ));

  const personasDir = path.join(path.dirname(hubDir), "personas");
  const choice = await select({
    message: `Your path ends in "${dirName}". What would you like to do?`,
    choices: [
      { name: `Rename to ${personasDir} (recommended)`, value: "rename" },
      { name: `Use "${dirName}-personas" instead`, value: "suffix" },
      { name: `Use "personas-${dirName}" instead`, value: "prefix" },
      { name: `Keep "${dirName}" as-is`, value: "keep" },
    ],
  });

  if (choice === "keep") {
    const reallyKeep = await confirm({
      message: `Are you sure you want to create the personas repo at ${hubDir}?`,
      default: false,
    });
    if (!reallyKeep) {
      // Recurse — let them pick again
      const newPath = await input({
        message: "Path for the personas repo:",
        default: personasDir,
      });
      return nudgePersonasConvention(path.resolve(newPath));
    }
    return hubDir;
  }

  // Determine the target directory based on choice
  let targetDir: string;
  if (choice === "rename") {
    targetDir = personasDir;
  } else if (choice === "suffix") {
    targetDir = path.join(path.dirname(hubDir), `${dirName}-personas`);
  } else {
    targetDir = path.join(path.dirname(hubDir), `personas-${dirName}`);
  }

  if (fs.existsSync(targetDir)) {
    console.log(chalk.yellow(`  ${targetDir} already exists. Keeping "${dirName}".`));
    return hubDir;
  }

  try {
    const entries = fs.existsSync(hubDir) ? fs.readdirSync(hubDir) : [];
    if (entries.length === 0) {
      // Empty or doesn't exist — just create the new one
      if (fs.existsSync(hubDir)) fs.rmdirSync(hubDir);
      fs.mkdirSync(targetDir, { recursive: true });
    } else {
      // Has content (from scaffold or prior step) — rename
      fs.renameSync(hubDir, targetDir);
    }
    return targetDir;
  } catch {
    console.log(chalk.yellow(`  Could not rename. Keeping "${dirName}".`));
    return hubDir;
  }
}

// ---------------------------------------------------------------------------
// Path 1: Create a new personas repo (Architect)
// ---------------------------------------------------------------------------

async function path1CreateHub(cwd: string, opts: InstallOptions, detection: DetectionResult): Promise<void> {
  // Step 1.1: Where to create the personas repo
  //
  // The personas repo is the single source of truth for agent behavior.
  // Most users coming through this path don't have one yet — they expect
  // us to create it. We ask first, then guide them to the right location.

  let hubDir: string;

  if (opts.path) {
    hubDir = path.resolve(opts.path);
  } else {
    console.log(chalk.gray(
      "\n  The personas repo is where your agent definitions live — traits,\n" +
      "  personas, instructions, and gotchas. It's a separate project from\n" +
      "  your application code, like a design system or infra-as-code repo.\n"
    ));

    const hasExisting = await confirm({
      message: "Do you already have a folder or repo for personas?",
      default: false,
    });

    if (hasExisting) {
      // They have an existing directory — let them navigate to it
      hubDir = await promptForPath("Path to your existing personas folder:");
    } else {
      // They need us to create one. Start by finding the parent directory
      // where their repos live — the personas repo will be a sibling.
      const detectedParent = detection.looksLikeCodeRepo ? path.dirname(cwd) : cwd;

      console.log(chalk.gray(
        `\n  AgentBoot expects the personas repo to live alongside your other\n` +
        `  repos as a sibling — like a design system or infra-as-code repo.\n` +
        `  We'll create a "personas" folder inside whatever parent directory\n` +
        `  you choose.\n`
      ));

      const parentDir = await promptForPath(
        "Where is the parent directory for your repos?",
        detectedParent,
      );
      const resolvedParent = path.resolve(parentDir);

      // Check if a hub or personas directory already exists as a child
      try {
        const children = fs.readdirSync(resolvedParent, { withFileTypes: true });
        for (const child of children) {
          if (!child.isDirectory()) continue;
          const childPath = path.join(resolvedParent, child.name);
          if (fs.existsSync(path.join(childPath, "agentboot.config.json"))) {
            console.log(chalk.yellow(`\n  Found an existing personas repo at ${childPath}`));
            console.log(chalk.gray("  Run `agentboot doctor` to check your configuration.\n"));
            throw new AgentBootError(0);
          }
        }
      } catch (err) {
        if (err instanceof AgentBootError) throw err;
        // Permission errors, etc. — continue normally
      }

      const suggestedPath = path.join(resolvedParent, "personas");
      const personasDirExists = fs.existsSync(suggestedPath)
        && fs.statSync(suggestedPath).isDirectory();

      const useSuggested = await confirm({
        message: personasDirExists
          ? `Found ${suggestedPath} — use it as the personas repo?`
          : `Create the personas repo at ${suggestedPath}?`,
        default: true,
      });

      if (useSuggested) {
        hubDir = suggestedPath;
      } else {
        hubDir = await promptForPath(
          "Where should the personas repo live?",
          path.resolve(parentDir) + "/",
        );
      }
    }
  }

  // Validate target directory — if it exists and has content, offer to create
  // a personas subdirectory instead of scaffolding into an existing repo.
  hubDir = await validateHubTarget(hubDir);

  // Nudge toward the "personas" naming convention if the user chose a
  // different name. This is educational, not enforced.
  hubDir = await nudgePersonasConvention(hubDir);

  // Step 1.2: Org detection — best-effort, confirmed later on first repo registration
  //
  // We gather the best guess now and write it to config. When the user
  // registers their first target repo (Step 1.6), we'll have a git remote —
  // the real GitHub org — and can confirm or update the slug at that point.
  //
  // Signals in priority order:
  //   1. Explicit --org flag (trusted)
  //   2. Git remote of the current working directory (strong)
  //   3. Git remote of the hub directory (strong, if already a repo)
  //   4. Parent directory name of the personas repo (weak guess)
  let orgSlug = opts.org ?? detection.gitOrg ?? null;

  if (!orgSlug) {
    const hubGitInfo = getGitOrgAndRepo(hubDir);
    if (hubGitInfo) orgSlug = hubGitInfo.org;
  }

  if (!orgSlug) {
    const parentName = path.basename(path.dirname(hubDir));
    const looksLikeOrg = /^[a-z][a-z0-9_-]*$/.test(parentName)
      && parentName !== "Users" && parentName !== "home" && parentName !== "tmp";
    if (looksLikeOrg) orgSlug = parentName;
  }

  // If we still have nothing, we have to ask — but keep it brief.
  if (!orgSlug) {
    console.log(chalk.gray(
      `\n  We need a short identifier for your org (e.g. your GitHub org name\n` +
      `  or username). This goes in agentboot.config.json and can be changed later.\n`
    ));
    orgSlug = await input({ message: "Org identifier:" });
  }

  // Normalize slug: lowercase, replace spaces with hyphens
  orgSlug = orgSlug.toLowerCase().replace(/\s+/g, "-");

  // Derive display name from slug — editable later in agentboot.config.json
  const orgDisplayName = orgSlug
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Step 1.3: Agent tool discovery
  //
  // Learn which agent tools the org uses. This drives output format selection
  // (no point compiling Claude output if they only use Copilot) and determines
  // whether LLM-powered features like import classification are available.

  console.log(chalk.gray(
    `\n  AgentBoot compiles personas into platform-specific formats. Knowing\n` +
    `  which tools your team uses lets us generate only what you need.\n`
  ));

  const agentTools = await checkbox({
    message: "Which AI agent tools does your org use? (space to select, enter to confirm)",
    choices: [
      { name: "Claude Code", value: "claude-code", checked: true },
      { name: "GitHub Copilot", value: "copilot" },
      { name: "Cursor", value: "cursor" },
      { name: "Gemini CLI", value: "gemini" },
    ],
  });

  // Ensure at least one tool is selected
  if (agentTools.length === 0) {
    console.log(chalk.yellow("  No tools selected — defaulting to Claude Code."));
    agentTools.push("claude-code");
  }

  let primaryAgent = agentTools[0]!;
  if (agentTools.length > 1) {
    primaryAgent = await select({
      message: "Which is the primary agent tool?",
      choices: agentTools.map(t => ({ name: t, value: t })),
    });
  }

  // Step 1.4: Scaffold
  console.log(chalk.bold(`\n  Creating personas repo for ${orgDisplayName}...\n`));

  scaffoldHub(hubDir, orgSlug, orgDisplayName, { agentTools, primaryAgent });

  console.log(chalk.green("  Source code:"));
  console.log(chalk.gray("    core/personas/          4 personas (code-reviewer, security-reviewer, ...)"));
  console.log(chalk.gray("    core/traits/            6 traits (critical-thinking, structured-output, ...)"));
  console.log(chalk.gray("    core/instructions/      2 always-on instruction sets"));
  console.log(chalk.gray("    core/gotchas/           (empty — add domain knowledge here)"));
  console.log(chalk.green("\n  Build configuration:"));
  console.log(chalk.gray(`    agentboot.config.json   org: "${orgSlug}", displayName: "${orgDisplayName}"`));
  console.log(chalk.gray("    repos.json              (empty — register your repos here)\n"));

  // Pause — let the user absorb what was just created before moving on
  await pressAnyKey(`Created personas repo for ${orgDisplayName}. Press any key to start first build...`);

  // Step 1.4: Base build — automatic, no prompt
  //
  // Build the base personas before scanning for imports. This establishes a
  // working baseline. If imports are found, we'll rebuild with them included.
  let buildSucceeded = runBuild(hubDir);

  // Step 1.6: Scan and import existing AI agent content
  //
  // Scan all subdirectories of the parent folder at once for AI agent content.
  // This uses the shared import API from import.ts so the install wizard and
  // the `agentboot import` CLI use the same code path.

  const parentOfHub = path.dirname(hubDir);
  let importedAny = false;

  // Check if Claude is available and authenticated for LLM classification
  const claudeReady = (() => {
    try {
      const versionCheck = spawnSync("claude", ["--version"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      if (versionCheck.status !== 0) return false;
      const authCheck = spawnSync("claude", ["auth", "status"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return authCheck.status === 0;
    } catch { return false; }
  })();

  if (!claudeReady) {
    // Try to log in
    console.log(chalk.gray(
      "\n  Import scans nearby repos for AI agent content and uses Claude to\n" +
      "  classify it into the right categories. You'll need to be logged in.\n"
    ));
    const shouldLogin = await confirm({
      message: "Log in to Claude now?",
      default: true,
    });
    if (shouldLogin) {
      spawnSync("claude", ["auth", "login"], { stdio: "inherit" });
    }
  }

  // Re-check after possible login
  const canClassify = (() => {
    try {
      const r = spawnSync("claude", ["auth", "status"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return r.status === 0;
    } catch { return false; }
  })();

  // Step 1 of import: Scan — always do this, it's free and fast
  const shouldScan = await confirm({
    message: `Scan subdirectories of ${parentOfHub} for existing AI agent content to import?`,
    default: true,
  });

  if (shouldScan) {
    const { scanParentForContent, printScanManifest, classifyScannedFiles, printClassificationResults, finalizeImport } =
      await import("./import.js");

    const manifest = scanParentForContent(parentOfHub, [hubDir]);
    printScanManifest(manifest);

    if (manifest.files.length > 0) {
      if (!canClassify) {
        console.log(chalk.gray(
          "  Classification requires Claude. Run `agentboot import` later to\n" +
          "  classify and import this content.\n"
        ));
      } else {
        // Educate the user on what happens next
        console.log(chalk.gray(
          "  AgentBoot will use your Claude account to classify each file into\n" +
          "  the right category (trait, gotcha, instruction, etc.). This uses\n" +
          "  one LLM call per file — typically a few cents total.\n\n" +
          "  No existing files will be modified. New files will be created in\n" +
          "  your personas repo at " + hubDir + ".\n"
        ));

        const continueImport = await confirm({
          message: "Classify and import now?",
          default: true,
        });

        if (continueImport) {
          // Step 2: Classify via LLM
          const { classifications, trustedSources } = classifyScannedFiles(manifest, hubDir);

          if (classifications.length > 0) {
            // Show summary and ask Y/n
            printClassificationResults(classifications);

            const applyNow = await confirm({
              message: "Import these artifacts into your personas repo?",
              default: true,
            });

            // Step 3: Apply or save plan
            const result = finalizeImport(classifications, trustedSources, hubDir, applyNow);

            if (applyNow && result.created > 0) {
              importedAny = true;
            }
          } else {
            console.log(chalk.gray("  No content classified.\n"));
          }
        } else {
          console.log(chalk.gray(
            "  You can import later by running:\n\n" +
            `    cd ${hubDir}\n` +
            `    agentboot import --path ${parentOfHub}\n`
          ));
        }
      }
    }
  }

  // Rebuild if imports added new content
  if (importedAny) {
    console.log(chalk.cyan("\n  Rebuilding with imported content..."));
    buildSucceeded = runBuild(hubDir);
  }

  // Step 1.6: Register first repo (optional)
  //
  // A "target repo" is any codebase where you want AI agent governance.
  // Registering it adds it to repos.json — the list of repos that receive
  // compiled personas when you run `agentboot sync`.
  //
  // The personas repo and target repos can be anywhere on your filesystem.
  // They don't need to be siblings or in the same parent directory.

  let registeredRepo = false;
  let registeredRepoName = "";
  let registeredRepoPath = "";

  console.log(chalk.bold("\n  Register a target repo\n"));
  console.log(chalk.gray(
    "  A target repo is any codebase where you want AgentBoot personas deployed.\n" +
    "  It can be anywhere on your filesystem — it does not need to be next to\n" +
    "  this personas repo.\n"
  ));

  const registerRepo = await confirm({
    message: "Register your first target repo now?",
    default: true,
  });

  if (registerRepo) {
    let promptOpts: { message: string; default?: string };
    if (detection.looksLikeCodeRepo) {
      promptOpts = {
        message: `Path to target repo (absolute or relative):`,
        default: cwd,
      };
    } else {
      promptOpts = { message: "Path to target repo (absolute or relative):" };
    }

    const repoPathInput = await input(promptOpts);
    const repoPath = path.resolve(repoPathInput);

    if (!fs.existsSync(repoPath)) {
      console.log(chalk.yellow(`  Path does not exist: ${repoPath}`));
    } else {
      // Detect repo name from git
      const gitInfo = getGitOrgAndRepo(repoPath);
      const repoName = gitInfo ? `${gitInfo.org}/${gitInfo.repo}` : path.basename(repoPath);

      // Confirm org slug — the git remote is the authoritative signal.
      // If it differs from our earlier guess, offer to update.
      if (gitInfo && gitInfo.org !== orgSlug) {
        const useGitOrg = await confirm({
          message: `Your repo's GitHub org is "${gitInfo.org}" but config has "${orgSlug}". Update to "${gitInfo.org}"?`,
          default: true,
        });
        if (useGitOrg) {
          orgSlug = gitInfo.org;
          const updatedDisplayName = orgSlug
            .split(/[-_]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          // Update the config file in place
          const configPath = path.join(hubDir, "agentboot.config.json");
          try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            config.org = orgSlug;
            config.orgDisplayName = updatedDisplayName;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
            console.log(chalk.green(`  Updated agentboot.config.json: org → "${orgSlug}"`));
          } catch {
            console.log(chalk.yellow(`  Could not update agentboot.config.json — edit it manually.`));
          }
        }
      }

      if (addToReposJson(hubDir, repoPath, repoName)) {
        console.log(chalk.green(`\n  Added ${repoName} to repos.json.`));
        registeredRepo = true;
        registeredRepoName = repoName;
        registeredRepoPath = repoPath;
      } else {
        console.log(chalk.yellow(`  ${repoName} is already registered in repos.json.`));
      }

      // Check for existing .claude/ content
      if (fs.existsSync(path.join(repoPath, ".claude"))) {
        console.log(chalk.gray(
          `\n  This repo has existing .claude/ content. On first sync, AgentBoot\n` +
          `  will archive it to .claude/.agentboot-archive/ before deploying.\n` +
          `  You can restore the original content anytime with: agentboot uninstall`
        ));
      }

      // Same-org repo registration: scan siblings for repos with matching org
      if (registeredRepo && gitInfo) {
        const parentDir = path.dirname(hubDir !== cwd ? cwd : hubDir);
        try {
          const siblingEntries = fs.readdirSync(parentDir);
          const sameOrgRepos: Array<{ dirPath: string; label: string }> = [];

          for (const entry of siblingEntries) {
            const sibPath = path.join(parentDir, entry);
            if (sibPath === hubDir || sibPath === repoPath) continue;
            try {
              if (!fs.statSync(sibPath).isDirectory()) continue;
              if (!fs.existsSync(path.join(sibPath, ".git"))) continue;
            } catch { continue; }

            const sibGit = getGitOrgAndRepo(sibPath);
            if (sibGit && sibGit.org === gitInfo.org) {
              sameOrgRepos.push({
                dirPath: sibPath,
                label: `${sibGit.org}/${sibGit.repo}`,
              });
            }
          }

          if (sameOrgRepos.length > 0) {
            console.log(chalk.gray(`\n  Found ${sameOrgRepos.length} other ${gitInfo.org} repo(s) nearby:\n`));
            for (const r of sameOrgRepos) {
              // addToReposJson handles dedup — skip silently if already registered
              const shouldRegister = await confirm({
                message: `Register ${r.label}?`,
                default: true,
              });
              if (shouldRegister) {
                if (addToReposJson(hubDir, r.dirPath, r.label)) {
                  console.log(chalk.green(`    Added ${r.label} to repos.json.`));
                } else {
                  console.log(chalk.gray(`    ${r.label} is already registered.`));
                }
              }
            }
          }
        } catch { /* permission errors scanning parent */ }

        // Offer to register additional repos manually
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const registerMore = await confirm({
            message: "Register another repo?",
            default: false,
          });
          if (!registerMore) break;

          const morePath = await promptForPath("Path to repo:");
          let resolvedMore = path.resolve(morePath);
          try { resolvedMore = fs.realpathSync(resolvedMore); } catch { /* doesn't exist */ }
          if (!fs.existsSync(resolvedMore)) {
            console.log(chalk.yellow(`  Path does not exist: ${resolvedMore}`));
            continue;
          }
          const moreGit = getGitOrgAndRepo(resolvedMore);
          const moreLabel = moreGit ? `${moreGit.org}/${moreGit.repo}` : path.basename(resolvedMore);
          if (addToReposJson(hubDir, resolvedMore, moreLabel)) {
            console.log(chalk.green(`    Added ${moreLabel} to repos.json.`));
          } else {
            console.log(chalk.yellow(`    ${moreLabel} is already registered.`));
          }
        }
      }

      // Offer to sync — only if build succeeded (dist/ exists)
      if (!opts.noSync && buildSucceeded && fs.existsSync(path.join(hubDir, "dist"))) {
        console.log(chalk.gray(
          `\n  Sync deploys the compiled personas to registered repos' .claude/ directories.\n` +
          `  This writes files locally — it does not commit or push. You review\n` +
          `  the output before committing.`
        ));

        const shouldSync = await confirm({
          message: `Deploy personas now?`,
          default: true,
        });

        if (shouldSync) {
          console.log(chalk.cyan("\n  Syncing..."));
          if (runSync(hubDir)) {
            console.log(chalk.green(`\n  Personas deployed.`));
            console.log(chalk.gray(
              `\n  To activate them, commit the .claude/ directory in each repo:\n\n` +
              `    cd ${registeredRepoPath}\n` +
              `    git add .claude/\n` +
              `    git commit -m "chore: deploy AgentBoot personas"\n\n` +
              `  Then open Claude Code in that repo and try: /review-code`
            ));
          }
        }
      } else if (!buildSucceeded) {
        console.log(chalk.gray(
          `\n  Repo registered. To deploy personas, build first:\n\n` +
          `    cd ${hubDir}\n` +
          `    agentboot build && agentboot sync`
        ));
      }
    }
  }

  // Step 1.7: Summary and next steps
  //
  // Context-aware: the summary reflects what actually happened during install,
  // so the user knows exactly where they are and what to do next.

  console.log(chalk.bold("\n  ─────────────────────────────────────────────"));
  console.log(chalk.bold(`\n  ${chalk.green("✓")} AgentBoot setup complete\n`));

  // What was created
  console.log(chalk.cyan("  What was created:\n"));
  console.log(chalk.gray(`    Personas repo:    ${hubDir}`));
  console.log(chalk.gray(`    Config:           ${hubDir}/agentboot.config.json`));
  console.log(chalk.gray(`    Org:              ${orgSlug} (${orgDisplayName})`));
  if (buildSucceeded) {
    console.log(chalk.gray(`    Compiled output:  ${hubDir}/dist/`));
  }
  if (registeredRepo) {
    console.log(chalk.gray(`    Target repo:      ${registeredRepoPath} (${registeredRepoName})`));
  }

  // Remote status
  const hubHasRemote = getGitOrgAndRepo(hubDir) !== null;

  if (!hubHasRemote) {
    console.log(chalk.gray("    Remote:           none (local only — fine for evaluation)"));
  }

  // Context-aware next steps
  console.log(chalk.cyan("\n  What to do next:\n"));

  let step = 1;

  if (!buildSucceeded) {
    console.log(chalk.gray(`    ${step}. Build personas:    cd ${hubDir} && agentboot build`));
    step++;
  }

  if (!registeredRepo) {
    console.log(chalk.gray(`    ${step}. Register a repo:   agentboot install (from your code repo)`));
    console.log(chalk.gray(`       Or edit:            ${hubDir}/repos.json`));
    step++;
  } else if (buildSucceeded && !fs.existsSync(path.join(registeredRepoPath, ".claude", ".agentboot-manifest.json"))) {
    console.log(chalk.gray(`    ${step}. Deploy personas:   cd ${hubDir} && agentboot sync`));
    step++;
  }

  console.log(chalk.gray(`    ${step}. Try it out:        Open your repo in Claude Code and run /review-code`));
  step++;
  console.log(chalk.gray(`    ${step}. Customize:         Edit personas in ${hubDir}/core/personas/`));
  step++;

  console.log(chalk.gray(`    ${step}. Import existing:   agentboot import --path <dir>`));
  step++;

  if (!hubHasRemote) {
    console.log(chalk.gray(`    ${step}. Push when ready:   gh repo create ${orgSlug}/personas --source . --private --push`));
    step++;
  }

  // Governance — brief, not a wall
  console.log(chalk.cyan("\n  Governance tips:\n"));
  console.log(chalk.gray("    - Enable branch protection on main (persona changes deserve review)"));
  console.log(chalk.gray("    - Add `agentboot validate --strict` to CI"));
  console.log(chalk.gray("    - Encourage developers to contribute — they know the prompts best"));
  console.log("");
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
    const siblings = scanNearby(cwd);
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
  const repoGitInfo = getGitOrgAndRepo(repoPath);
  const repoName = repoGitInfo ? `${repoGitInfo.org}/${repoGitInfo.repo}` : path.basename(repoPath);

  // Add to repos.json (addToReposJson handles dedup, corrupt JSON backup, and writing)
  if (!addToReposJson(hubDir, repoPath, repoName)) {
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
          // addToReposJson already wrote the file — just report
          console.log(chalk.green(`  Added ${repoName} to repos.json (direct edit — hub has uncommitted changes).`));
        } else {
          let branchCreated = false;
          try {
            gitRun(["checkout", "-b", branchName]);
            branchCreated = true;
            // addToReposJson already wrote repos.json — just stage and commit
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
        console.log(chalk.gray("  The repo was added to repos.json directly."));
      }
    } else {
      // addToReposJson already wrote the file — just report
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

  // Handle --non-interactive — use sensible defaults, env var overrides
  if (opts.nonInteractive) {
    const orgSlug = process.env["AGENTBOOT_ORG"] ?? opts.org ?? "my-org";
    const orgDisplayName = process.env["AGENTBOOT_ORG_DISPLAY"]
      ?? orgSlug.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    const enableHooks = process.env["AGENTBOOT_HOOKS"] === "true";
    const enableSync = process.env["AGENTBOOT_SYNC"] === "true";

    // Parse personas from env or use defaults
    const personasEnv = process.env["AGENTBOOT_PERSONAS"];
    const personas = personasEnv
      ? personasEnv.split(",").map(p => p.trim()).filter(Boolean)
      : ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"];

    const hubDir = opts.path ? path.resolve(opts.path) : path.resolve(cwd, "personas");

    if (opts.connect) {
      // Connect mode: must have --hub-path
      if (!opts.hubPath) {
        console.error(chalk.red("  --non-interactive --connect requires --hub-path to be specified."));
        throw new AgentBootError(1);
      }
      const resolvedHub = path.resolve(opts.hubPath);
      if (!fs.existsSync(path.join(resolvedHub, "agentboot.config.json"))) {
        console.error(chalk.red(`  No agentboot.config.json found at: ${resolvedHub}`));
        throw new AgentBootError(1);
      }

      // Register current repo with the hub
      const repoPath = cwd;
      const repoGitInfo = getGitOrgAndRepo(repoPath);
      const repoName = repoGitInfo ? `${repoGitInfo.org}/${repoGitInfo.repo}` : path.basename(repoPath);
      if (addToReposJson(resolvedHub, repoPath, repoName)) {
        console.log(chalk.green(`  Added ${repoName} to repos.json.`));
      } else {
        console.log(chalk.yellow(`  ${repoName} is already registered.`));
      }

      // Optional sync
      if (enableSync && fs.existsSync(path.join(resolvedHub, "dist"))) {
        console.log(chalk.cyan("  Syncing..."));
        runSync(resolvedHub);
      }

      console.log(chalk.green("  Non-interactive connect complete.\n"));
      return;
    }

    // Hub mode (default in non-interactive)
    console.log(chalk.cyan(`  Non-interactive mode: creating hub at ${hubDir}\n`));
    console.log(chalk.gray(`    org: ${orgSlug}`));
    console.log(chalk.gray(`    displayName: ${orgDisplayName}`));
    console.log(chalk.gray(`    personas: ${personas.join(", ")}`));
    console.log(chalk.gray(`    hooks: ${enableHooks ? "enabled" : "skipped"}`));
    console.log(chalk.gray(`    sync: ${enableSync ? "enabled" : "skipped"}\n`));

    scaffoldHub(hubDir, orgSlug, orgDisplayName);

    // Build
    const buildSucceeded = runBuild(hubDir);

    if (enableSync && buildSucceeded && fs.existsSync(path.join(hubDir, "dist"))) {
      runSync(hubDir);
    }

    console.log(chalk.green("  Non-interactive install complete.\n"));
    return;
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
