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
import { select, input, confirm, search } from "@inquirer/prompts";

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
async function promptForPath(message: string, defaultPath?: string): Promise<string> {
  const result = await search({
    message,
    source: (term) => {
      const typed = term ?? defaultPath ?? "";
      if (!typed) {
        // Show common starting points
        const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/";
        return [
          { name: `${home} (home directory)`, value: home },
          { name: `. (current directory)`, value: process.cwd() },
          { name: `.. (parent directory)`, value: path.dirname(process.cwd()) },
        ];
      }

      // Resolve the typed path
      const resolved = path.resolve(typed);
      let dir: string;
      let prefix: string;

      try {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          dir = resolved;
          prefix = typed.endsWith("/") || typed.endsWith(path.sep) ? typed : typed + "/";
        } else {
          dir = path.dirname(resolved);
          prefix = path.dirname(typed) + "/";
        }
      } catch {
        // Path doesn't exist yet — complete from the parent
        dir = path.dirname(resolved);
        prefix = path.dirname(typed) === typed ? typed : path.dirname(typed) + "/";
      }

      // List directory entries
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith("."))
          .map(e => ({
            name: prefix + e.name + "/",
            value: path.join(dir, e.name),
          }));

        // Always include the typed path itself as an option
        const resolvedTyped = path.resolve(typed);
        const choices = [
          { name: `${resolvedTyped} (create new)`, value: resolvedTyped },
          ...dirs.slice(0, 15),
        ];
        return choices;
      } catch {
        return [{ name: `${path.resolve(typed)} (create new)`, value: path.resolve(typed) }];
      }
    },
  });

  return path.resolve(result);
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

export function scaffoldHub(targetDir: string, orgSlug: string, orgDisplayName?: string): void {
  // agentboot.config.json
  const configContent = JSON.stringify({
    org: orgSlug,
    orgDisplayName: orgDisplayName ?? orgSlug,
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
    // If the directory doesn't exist, it will be created fresh — no issue.
    if (!fs.existsSync(hubDir)) {
      fs.mkdirSync(hubDir, { recursive: true });
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
      `\n  Scaffolding here would mix persona source code with existing files.\n`
    ));

    const choice = await select({
      message: "Where should the personas repo live?",
      choices: [
        { name: `Create ${personasPath} (recommended)`, value: "sub" },
        { name: "Choose a different location", value: "custom" },
        { name: `Use ${hubDir} anyway (not recommended)`, value: "here" },
      ],
    });

    if (choice === "sub") {
      if (!fs.existsSync(personasPath)) {
        fs.mkdirSync(personasPath, { recursive: true });
      }
      return personasPath;
    } else if (choice === "custom") {
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
 * This is an educational moment, not a gate. The user can proceed with any
 * name — but we explain why "personas" is the convention and what they gain
 * by following it.
 */
async function nudgePersonasConvention(hubDir: string): Promise<string> {
  const dirName = path.basename(hubDir);

  // Already named "personas" — nothing to do.
  if (dirName === "personas") return hubDir;

  console.log(chalk.cyan(
    `\n  Convention: name this repo "personas"\n\n`
  ) + chalk.gray(
    `  AgentBoot follows a convention-over-configuration philosophy. When every\n` +
    `  org names their hub repo "personas", several things work automatically:\n\n` +
    `    - \`agentboot install\` auto-discovers it by scanning for "personas" in\n` +
    `      your GitHub org and sibling directories\n` +
    `    - New team members know where to look without being told\n` +
    `    - Docs, examples, and community answers all reference the same path\n` +
    `    - \`gh repo clone <org>/personas\` works across every AgentBoot org\n\n` +
    `  You chose "${dirName}" — that works fine. This is a recommendation,\n` +
    `  not a requirement.\n`
  ));

  const choice = await select({
    message: `Keep "${dirName}" or rename to "personas"?`,
    choices: [
      { name: `Rename to ${path.join(path.dirname(hubDir), "personas")} (recommended)`, value: "rename" },
      { name: `Keep "${dirName}"`, value: "keep" },
    ],
  });

  if (choice === "rename") {
    const personasDir = path.join(path.dirname(hubDir), "personas");
    if (fs.existsSync(personasDir)) {
      console.log(chalk.yellow(`  ${personasDir} already exists. Keeping "${dirName}".`));
      return hubDir;
    }
    // If the original dir was just created (empty), rename it.
    // If it had content, we can't rename safely — keep it.
    try {
      const entries = fs.readdirSync(hubDir);
      if (entries.length === 0) {
        fs.rmdirSync(hubDir);
        fs.mkdirSync(personasDir, { recursive: true });
        return personasDir;
      } else {
        // Directory has content (from scaffold or prior step) — rename via fs.rename
        fs.renameSync(hubDir, personasDir);
        return personasDir;
      }
    } catch {
      console.log(chalk.yellow(`  Could not rename. Keeping "${dirName}".`));
      return hubDir;
    }
  }

  return hubDir;
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
      // They need us to create one — suggest a sensible default
      const parentDir = detection.looksLikeCodeRepo ? path.dirname(cwd) : cwd;
      const suggestedPath = path.join(parentDir, "personas");

      console.log(chalk.gray(
        `\n  We'll create a new folder for your personas repo.\n`
      ));

      const choice = await select({
        message: "Where should we create it?",
        choices: [
          { name: `${suggestedPath} (recommended)`, value: "suggested" },
          { name: "Choose a different location", value: "custom" },
        ],
      });

      if (choice === "suggested") {
        hubDir = suggestedPath;
      } else {
        hubDir = await promptForPath(
          "Where should the personas repo live?",
          path.dirname(suggestedPath) + "/",
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

  // Step 1.2: Org detection — slug (machine identifier) and display name (human label)
  let orgSlug = opts.org ?? detection.gitOrg ?? null;

  if (!orgSlug) {
    // Try detecting from the hub dir's git remote
    const hubGitInfo = getGitOrgAndRepo(hubDir);
    if (hubGitInfo) orgSlug = hubGitInfo.org;
  }

  if (orgSlug) {
    const useDetected = await confirm({
      message: `Use "${orgSlug}" as your org identifier?`,
      default: true,
    });
    if (!useDetected) {
      orgSlug = await input({ message: "Org identifier (lowercase, used in package names and paths):" });
    }
  } else {
    orgSlug = await input({
      message: "Org identifier (GitHub org, username, or slug — lowercase, no spaces):",
    });
  }

  // Normalize slug: lowercase, replace spaces with hyphens
  orgSlug = orgSlug.toLowerCase().replace(/\s+/g, "-");

  // Derive a default display name from the slug
  const defaultDisplayName = orgSlug
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const orgDisplayName = await input({
    message: "Org display name (shown in compiled output):",
    default: defaultDisplayName,
  });

  // Step 1.3: Scan for existing content nearby — per-directory import offers
  const importCommands: string[] = [];
  const shouldScan = await confirm({
    message: "Scan nearby directories for existing AI agent content?",
    default: true,
  });

  if (shouldScan) {
    const siblings = scanNearby(hubDir !== cwd ? cwd : hubDir);
    const promptSiblings = siblings.filter(s => s.type === "prompts");

    if (promptSiblings.length > 0) {
      console.log(chalk.gray("\n  Found agentic content nearby:\n"));

      for (const s of promptSiblings) {
        const dirName = path.basename(s.path);
        const fileCount = s.files?.length ?? 0;
        const shouldImport = await confirm({
          message: `Found agentic content in ${dirName} (${fileCount} file${fileCount !== 1 ? "s" : ""}). Note for import?`,
          default: true,
        });
        if (shouldImport) {
          const cmd = `agentboot import --path ${shellQuote(s.path)}`;
          importCommands.push(cmd);
          console.log(chalk.gray(`    Run: ${cmd}`));
        }
      }
    } else {
      console.log(chalk.gray("\n  No existing agentic content found nearby."));
    }

    // Offer to check additional directories
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const checkMore = await confirm({
        message: "Check another folder for content?",
        default: false,
      });
      if (!checkMore) break;

      const customPath = await promptForPath("Path to check:");
      let resolved = path.resolve(customPath);
      try { resolved = fs.realpathSync(resolved); } catch { /* doesn't exist yet */ }
      const result = hasPrompts(resolved);
      if (result.found) {
        const dirName = path.basename(resolved);
        console.log(chalk.gray(`  Found ${result.files.length} file(s) in ${dirName}:`));
        for (const f of result.files.slice(0, 5)) {
          console.log(chalk.gray(`    ${f}`));
        }
        if (result.files.length > 5) {
          console.log(chalk.gray(`    ... and ${result.files.length - 5} more`));
        }
        const shouldImport = await confirm({
          message: `Note ${dirName} for import?`,
          default: true,
        });
        if (shouldImport) {
          const cmd = `agentboot import --path ${shellQuote(resolved)}`;
          importCommands.push(cmd);
          console.log(chalk.gray(`    Run: ${cmd}`));
        }
      } else {
        console.log(chalk.gray(`  No agentic content found in ${resolved}.`));
      }
    }
  }

  // Step 1.4: Scaffold
  console.log(chalk.bold(`\n  Creating personas repo for ${orgDisplayName}...\n`));

  scaffoldHub(hubDir, orgSlug, orgDisplayName);

  console.log(chalk.green("  Source code:"));
  console.log(chalk.gray("    core/personas/          4 personas (code-reviewer, security-reviewer, ...)"));
  console.log(chalk.gray("    core/traits/            6 traits (critical-thinking, structured-output, ...)"));
  console.log(chalk.gray("    core/instructions/      2 always-on instruction sets"));
  console.log(chalk.gray("    core/gotchas/           (empty — add domain knowledge here)"));
  console.log(chalk.green("\n  Build configuration:"));
  console.log(chalk.gray(`    agentboot.config.json   org: "${orgSlug}", displayName: "${orgDisplayName}"`));
  console.log(chalk.gray("    repos.json              (empty — register your repos here)"));

  // Step 1.5: Build
  //
  // AgentBoot is a build tool. The personas repo contains source code (traits,
  // personas, instructions) that gets compiled into deployable output. This is
  // like compiling TypeScript to JavaScript — the source is what you edit, the
  // output is what gets deployed.
  //
  // If the user is running `agentboot install`, then agentboot is already
  // available (globally or via npx). We can always attempt a build.

  let buildSucceeded = false;
  const shouldBuild = await confirm({
    message: "Compile personas now? (builds the deployable output)",
    default: true,
  });

  if (shouldBuild) {
    buildSucceeded = runBuild(hubDir);
  } else {
    console.log(chalk.gray(
      "\n  You can compile later by running:\n\n" +
      `    cd ${hubDir}\n` +
      "    agentboot build\n"
    ));
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

  if (importCommands.length > 0) {
    console.log(chalk.gray(`    ${step}. Import content:`));
    for (const cmd of importCommands) {
      console.log(chalk.gray(`       ${cmd}`));
    }
    step++;
  } else {
    console.log(chalk.gray(`    ${step}. Import existing:   agentboot import --path <dir>`));
    step++;
  }

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
