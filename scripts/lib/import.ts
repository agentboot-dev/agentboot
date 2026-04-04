/**
 * AgentBoot import command — scan and classify existing AI agent content.
 *
 * This is an LLM-powered command. It uses `claude -p` to classify content.
 * Requires an active Claude Code login.
 *
 * Flow:
 *   1. Scan target path for agentic content (deterministic)
 *   2. Read hub's existing content for context (deterministic)
 *   3. Send content to claude -p for section-level classification (LLM)
 *   4. Write staging file (.agentboot-import-plan.json)
 *   5. Wait for user to review/edit
 *   6. Apply: write classified content to hub
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { loadPrompt, loadSchema } from "../prompts/index.js";
import { type LLMProvider, ClaudeCodeProvider, resolveProviderWithFallback } from "./llm-provider.js";
import { loadConfig, resolveConfigPath, stripJsoncComments } from "./config.js";

// ---------------------------------------------------------------------------
// Error type for early exit (replaces process.exit in library code)
// ---------------------------------------------------------------------------

export class AgentBootError extends Error {
  constructor(public readonly exitCode: number) {
    super(`AgentBoot exit: ${exitCode}`);
    this.name = "AgentBootError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  path?: string | undefined;
  file?: string | undefined; // Single file to classify (used by `add prompt`)
  format?: string | undefined;
  overlap?: boolean | undefined;
  apply?: boolean | undefined;
  hubPath?: string | undefined;
}

interface ScannedFile {
  path: string;
  relativePath: string;
  lines: number;
  type: "claude-md" | "skill" | "agent" | "trait" | "rule" | "settings" | "mcp" |
        "cursorrules" | "copilot-instructions" | "copilot-prompt" | "other";
}

interface ScanResult {
  scannedAt: string;
  targetPath: string;
  files: ScannedFile[];
}

export type CompositionType = "rule" | "preference";

/** Default composition type per classification — convention over configuration. */
export const DEFAULT_COMPOSITION: Record<string, CompositionType> = {
  lexicon: "rule",
  trait: "preference",
  gotcha: "rule",
  persona: "rule",
  "persona-rule": "rule",
  instruction: "preference",
  skip: "preference",
};

export interface Classification {
  source_file: string;
  lines: [number, number];
  content_preview: string;
  classification: "trait" | "lexicon" | "gotcha" | "persona" | "persona-rule" | "instruction" | "skip";
  suggested_name: string;
  suggested_path: string;
  overlaps_with: string | null;
  confidence: "high" | "medium" | "low";
  action: "create" | "skip" | "merge";
  composition_type: CompositionType;
}

interface ImportPlan {
  hub: string;
  scanned_at: string;
  classifications: Classification[];
}

// ---------------------------------------------------------------------------
// Scan engine (deterministic, no LLM)
// ---------------------------------------------------------------------------

function scanPath(targetPath: string): ScanResult {
  const resolved = path.resolve(targetPath);
  const files: ScannedFile[] = [];

  const TEXT_EXTENSIONS = new Set([".md", ".json", ".yaml", ".yml", ".txt", ".sh", ".ts", ".js", ".toml"]);

  function classifyFile(filePath: string, relPath: string): ScannedFile | null {
    if (!fs.existsSync(filePath)) return null;
    // Use lstat to detect symlinks — skip them to prevent reading outside repo
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) return null;
    if (!lstat.isFile()) return null;

    // Skip binary files — only process text content
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !TEXT_EXTENSIONS.has(ext)) return null;

    // Double-check for binary content (null bytes in first 8KB)
    const buf = Buffer.alloc(8192);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    if (buf.subarray(0, bytesRead).includes(0)) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").length;
    const basename = path.basename(filePath);
    const dir = path.dirname(relPath);

    let type: ScannedFile["type"] = "other";
    if (basename === "CLAUDE.md") type = "claude-md";
    else if (basename === "SKILL.md") type = "skill";
    else if (dir.includes("agents")) type = "agent";
    else if (dir.includes("traits")) type = "trait";
    else if (dir.includes("rules")) type = "rule";
    else if (basename === "settings.json") type = "settings";
    else if (basename === ".mcp.json") type = "mcp";
    else if (basename === ".cursorrules") type = "cursorrules";
    else if (basename === "copilot-instructions.md") type = "copilot-instructions";
    else if (dir.includes("prompts") && basename.endsWith(".prompt.md")) type = "copilot-prompt";

    return { path: filePath, relativePath: relPath, lines, type };
  }

  // Scan .claude/ directory
  const claudeDir = path.join(resolved, ".claude");
  if (fs.existsSync(claudeDir)) {
    function walkClaude(dir: string, relBase: string): void {
      for (const entry of fs.readdirSync(dir)) {
        // Skip agentboot artifacts
        if (entry === ".agentboot-archive" || entry === ".agentboot-manifest.json") continue;
        const absPath = path.join(dir, entry);
        const relPath = relBase ? `${relBase}/${entry}` : entry;
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          walkClaude(absPath, relPath);
        } else {
          const scanned = classifyFile(absPath, `.claude/${relPath}`);
          if (scanned) files.push(scanned);
        }
      }
    }
    walkClaude(claudeDir, "");
  }

  // Root-level CLAUDE.md
  const rootClaude = path.join(resolved, "CLAUDE.md");
  if (fs.existsSync(rootClaude)) {
    const scanned = classifyFile(rootClaude, "CLAUDE.md");
    if (scanned) files.push(scanned);
  }

  // .cursorrules
  const cursorrules = path.join(resolved, ".cursorrules");
  if (fs.existsSync(cursorrules)) {
    const scanned = classifyFile(cursorrules, ".cursorrules");
    if (scanned) files.push(scanned);
  }

  // .github/copilot-instructions.md
  const copilotInstructions = path.join(resolved, ".github", "copilot-instructions.md");
  if (fs.existsSync(copilotInstructions)) {
    const scanned = classifyFile(copilotInstructions, ".github/copilot-instructions.md");
    if (scanned) files.push(scanned);
  }

  // .github/prompts/
  const promptsDir = path.join(resolved, ".github", "prompts");
  if (fs.existsSync(promptsDir)) {
    for (const entry of fs.readdirSync(promptsDir)) {
      if (entry.endsWith(".prompt.md")) {
        const scanned = classifyFile(
          path.join(promptsDir, entry),
          `.github/prompts/${entry}`
        );
        if (scanned) files.push(scanned);
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    targetPath: resolved,
    files,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Scan — discover importable files across multiple directories
// ---------------------------------------------------------------------------

export interface ScanManifest {
  parentDir: string;
  scannedAt: string;
  files: Array<{
    absolutePath: string;
    relativePath: string; // relative to the file's repo root
    repoDir: string;      // which repo this file belongs to
    repoName: string;     // basename of the repo
    lines: number;
    type: ScannedFile["type"];
  }>;
}

/**
 * Scan all subdirectories of a parent directory for importable AI agent content.
 * Skips the hub directory and non-directory entries. Returns a flat manifest
 * of all discovered files across all repos.
 *
 * This is the shared entry point for both the install wizard and `agentboot import`.
 */
export function scanParentForContent(parentDir: string, excludeDirs: string[] = []): ScanManifest {
  const resolved = path.resolve(parentDir);
  const excludeSet = new Set(excludeDirs.map(d => path.resolve(d)));
  const manifest: ScanManifest = {
    parentDir: resolved,
    scannedAt: new Date().toISOString(),
    files: [],
  };

  let entries: string[];
  try {
    entries = fs.readdirSync(resolved);
  } catch {
    return manifest;
  }

  for (const entry of entries) {
    const dirPath = path.join(resolved, entry);

    // Skip non-directories, hidden dirs, and excluded dirs
    try {
      if (!fs.statSync(dirPath).isDirectory()) continue;
    } catch { continue; }
    if (entry.startsWith(".")) continue;
    if (excludeSet.has(dirPath)) continue;

    // Skip dirs that are AgentBoot hubs
    if (fs.existsSync(path.join(dirPath, "agentboot.config.json"))) continue;

    // Use the existing scanPath to scan this repo
    const scan = scanPath(dirPath);
    for (const file of scan.files) {
      manifest.files.push({
        absolutePath: file.path,
        relativePath: file.relativePath,
        repoDir: dirPath,
        repoName: entry,
        lines: file.lines,
        type: file.type,
      });
    }
  }

  return manifest;
}

/**
 * Check if a file was compiled by AgentBoot (provenance detection).
 * Checks for the provenance header comment in the first 500 bytes.
 */
export function isAgentBootCompiled(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(500);
    fs.readSync(fd, buf, 0, 500, 0);
    fs.closeSync(fd);
    return buf.toString("utf-8").includes("AgentBoot compiled output");
  } catch {
    return false;
  }
}

/**
 * Categorize scanned files by import strategy.
 */
export interface CategorizedScan {
  wholeFile: ScanManifest["files"];   // agents, traits, rules with paths: — deterministic, no LLM
  llmClassify: ScanManifest["files"]; // CLAUDE.md, .cursorrules, copilot-instructions — need LLM
  configMerge: ScanManifest["files"]; // settings.json, .mcp.json — JSON merge
  skipped: ScanManifest["files"];     // AgentBoot-compiled, unsupported types
}

export function categorizeByStrategy(manifest: ScanManifest): CategorizedScan {
  const result: CategorizedScan = { wholeFile: [], llmClassify: [], configMerge: [], skipped: [] };

  for (const file of manifest.files) {
    // Skip AgentBoot-compiled content
    if (isAgentBootCompiled(file.absolutePath)) {
      result.skipped.push(file);
      continue;
    }

    // Skip manifests and archives
    if (file.relativePath.includes(".agentboot-")) {
      result.skipped.push(file);
      continue;
    }

    switch (file.type) {
      case "agent":
      case "trait":
        result.wholeFile.push(file);
        break;
      case "rule": {
        // Rules with paths: frontmatter are gotchas (whole-file), others need LLM
        try {
          const content = fs.readFileSync(file.absolutePath, "utf-8");
          if (content.startsWith("---") && content.includes("paths:")) {
            result.wholeFile.push(file);
          } else {
            result.llmClassify.push(file);
          }
        } catch {
          result.llmClassify.push(file);
        }
        break;
      }
      case "settings":
      case "mcp":
        result.configMerge.push(file);
        break;
      case "claude-md":
      case "skill":
      case "cursorrules":
      case "copilot-instructions":
      case "copilot-prompt":
        result.llmClassify.push(file);
        break;
      default:
        result.skipped.push(file);
    }
  }

  return result;
}

/**
 * Print a scan manifest for the user to review.
 */
export function printScanManifest(manifest: ScanManifest): void {
  if (manifest.files.length === 0) {
    console.log(chalk.gray("  No AI agent content found.\n"));
    return;
  }

  // Group by repo for display
  const byRepo = new Map<string, typeof manifest.files>();
  for (const f of manifest.files) {
    const list = byRepo.get(f.repoName) ?? [];
    list.push(f);
    byRepo.set(f.repoName, list);
  }

  console.log(chalk.green(`  Found ${manifest.files.length} file(s) across ${byRepo.size} repo(s):\n`));
  for (const [repoName, files] of byRepo) {
    console.log(chalk.white(`    ${repoName}/`));
    for (const f of files) {
      console.log(chalk.gray(`      ${f.relativePath} (${f.lines} lines, ${f.type})`));
    }
  }
  console.log();
}

/**
 * Print a classification summary as a short table.
 */
export function printClassificationResults(classifications: Classification[]): void {
  const counts: Record<string, number> = { lexicon: 0, trait: 0, gotcha: 0, persona: 0, "persona-rule": 0, instruction: 0, skip: 0 };
  for (const c of classifications) {
    const key = c.classification;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  console.log(chalk.bold("\n  Classification summary:\n"));
  for (const c of classifications) {
    if (c.action === "skip" || c.classification === "skip") continue;
    const comp = c.composition_type ?? DEFAULT_COMPOSITION[c.classification] ?? "preference";
    console.log(chalk.gray(
      `    ${c.classification.padEnd(14)} ${comp.padEnd(12)} ${c.suggested_name} → ${c.suggested_path}`
    ));
  }

  const actionable = classifications.filter(c => c.action !== "skip" && c.classification !== "skip");
  const skipped = classifications.length - actionable.length;
  console.log(chalk.gray(`\n    ${actionable.length} to import, ${skipped} skipped\n`));
}

// ---------------------------------------------------------------------------
// Hub inventory (read existing content for classification context)
// ---------------------------------------------------------------------------

interface HubInventory {
  traits: Array<{ name: string; firstLine: string }>;
  personas: Array<{ name: string; description: string }>;
  gotchas: Array<{ name: string; firstLine: string }>;
  instructions: Array<{ name: string; firstLine: string }>;
}

function readHubInventory(hubPath: string): HubInventory {
  const inventory: HubInventory = {
    traits: [],
    personas: [],
    gotchas: [],
    instructions: [],
  };

  function readFirstLine(filePath: string): string {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("---"));
      return lines[0]?.replace(/^#+\s*/, "").trim() ?? "";
    } catch { return ""; }
  }

  // Traits
  const traitsDir = path.join(hubPath, "core", "traits");
  if (fs.existsSync(traitsDir)) {
    for (const entry of fs.readdirSync(traitsDir)) {
      if (entry.endsWith(".md")) {
        inventory.traits.push({
          name: entry.replace(".md", ""),
          firstLine: readFirstLine(path.join(traitsDir, entry)),
        });
      }
    }
  }

  // Personas
  const personasDir = path.join(hubPath, "core", "personas");
  if (fs.existsSync(personasDir)) {
    for (const entry of fs.readdirSync(personasDir)) {
      const configPath = path.join(personasDir, entry, "persona.config.json");
      let description = "";
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        description = config.description ?? "";
      } catch { /* no config */ }
      inventory.personas.push({ name: entry, description });
    }
  }

  // Gotchas
  const gotchasDir = path.join(hubPath, "core", "gotchas");
  if (fs.existsSync(gotchasDir)) {
    for (const entry of fs.readdirSync(gotchasDir)) {
      if (entry.endsWith(".md")) {
        inventory.gotchas.push({
          name: entry.replace(".md", ""),
          firstLine: readFirstLine(path.join(gotchasDir, entry)),
        });
      }
    }
  }

  // Instructions
  const instructionsDir = path.join(hubPath, "core", "instructions");
  if (fs.existsSync(instructionsDir)) {
    for (const entry of fs.readdirSync(instructionsDir)) {
      if (entry.endsWith(".md")) {
        inventory.instructions.push({
          name: entry.replace(".md", ""),
          firstLine: readFirstLine(path.join(instructionsDir, entry)),
        });
      }
    }
  }

  return inventory;
}

// ---------------------------------------------------------------------------
// Classification via claude -p (LLM)
// ---------------------------------------------------------------------------

function buildClassificationPrompt(
  fileContent: string,
  filePath: string,
  inventory: HubInventory
): string {
  const hubContext = [
    "## Existing hub content (avoid duplicates):",
    "",
    "### Traits:",
    ...inventory.traits.map(t => `- ${t.name}: ${t.firstLine}`),
    ...(inventory.traits.length === 0 ? ["(none)"] : []),
    "",
    "### Personas:",
    ...inventory.personas.map(p => `- ${p.name}: ${p.description}`),
    ...(inventory.personas.length === 0 ? ["(none)"] : []),
    "",
    "### Gotchas:",
    ...inventory.gotchas.map(g => `- ${g.name}: ${g.firstLine}`),
    ...(inventory.gotchas.length === 0 ? ["(none)"] : []),
    "",
    "### Instructions:",
    ...inventory.instructions.map(i => `- ${i.name}: ${i.firstLine}`),
    ...(inventory.instructions.length === 0 ? ["(none)"] : []),
  ].join("\n");

  return loadPrompt("classify-content", {
    HUB_CONTEXT: hubContext,
    FILE_PATH: filePath,
    FILE_CONTENT: fileContent,
  });
}

const CLASSIFICATION_SCHEMA = loadSchema("classify-content");

/** Resolve the LLM provider — use config if hub is available, with automatic fallback. */
function getProvider(hubPath?: string): LLMProvider {
  if (hubPath) {
    try {
      const configPath = resolveConfigPath([], hubPath);
      const config = loadConfig(configPath);
      return resolveProviderWithFallback(config);
    } catch { /* fall through */ }
  }
  return new ClaudeCodeProvider();
}

const MAX_FILE_CONTENT_CHARS = 200_000; // ~50K tokens — safety limit for LLM prompt

function classifyViaLLM(
  fileContent: string,
  filePath: string,
  inventory: HubInventory,
  provider?: LLMProvider
): Classification[] | null {
  let content = fileContent;
  if (content.length > MAX_FILE_CONTENT_CHARS) {
    console.log(chalk.yellow(`    File truncated from ${content.length} to ${MAX_FILE_CONTENT_CHARS} chars for classification.`));
    content = content.slice(0, MAX_FILE_CONTENT_CHARS) + "\n\n<!-- truncated -->";
  }
  const prompt = buildClassificationPrompt(content, filePath, inventory);
  const llm = provider ?? new ClaudeCodeProvider();

  // Show the prompt being sent — transparency into the LLM call
  console.log(chalk.cyan("\n  ── LLM prompt ──────────────────────────────────────────"));
  const promptLines = prompt.split("\n");
  const fileStartIdx = promptLines.findIndex(l => l.startsWith("## File to classify:"));
  if (fileStartIdx > 0) {
    console.log(chalk.gray(`  Provider: ${llm.name}`));
    console.log(chalk.gray(`  Categories: lexicon, trait, gotcha, persona, persona-rule, instruction, skip`));
    console.log(chalk.gray(`  File: ${filePath} (${fileContent.split("\n").length} lines)`));
  } else {
    console.log(chalk.gray(`  ${promptLines.slice(0, 3).join("\n  ")}`));
  }
  console.log(chalk.cyan("  ──────────────────────────────────────────────────────\n"));

  // Use provider to classify
  const classifyResult = llm.classify(prompt, CLASSIFICATION_SCHEMA);
  if (!classifyResult) return null;

  const parsed = typeof classifyResult.data === "string"
    ? JSON.parse(classifyResult.data as string)
    : classifyResult.data as Record<string, unknown>;
  const raw = (parsed.classifications ?? []) as Array<Record<string, unknown>>;

    if (raw.length === 0) {
      console.log(chalk.yellow(`    LLM returned no classifications for this file.`));
      if (process.env["DEBUG"]) {
        // Redact file content — show only classification metadata
        const keys = Object.keys(parsed);
        console.log(chalk.gray(`    LLM response keys: ${keys.join(", ")}`));
      }
      return [];
    }

    // Runtime validation — reject malformed items
    const VALID_TYPES = ["lexicon", "trait", "gotcha", "persona", "persona-rule", "instruction", "skip"];
    const VALID_ACTIONS = ["create", "skip", "merge"];
    const validated: Classification[] = [];
    let skippedCount = 0;
    let invalidCount = 0;
    for (const item of raw) {
      const lines = item["lines"] as unknown;
      const classification = item["classification"] as string | undefined;
      const suggestedPath = item["suggested_path"] as string | undefined;
      const action = item["action"] as string | undefined;
      const compType = item["composition_type"] as string | undefined;
      const preview = item["content_preview"] as string | undefined;

      if (!Array.isArray(lines) || lines.length !== 2) { invalidCount++; continue; }
      if (typeof lines[0] !== "number" || typeof lines[1] !== "number") { invalidCount++; continue; }
      if (!classification || !VALID_TYPES.includes(classification)) { invalidCount++; continue; }
      if (typeof suggestedPath !== "string") { invalidCount++; continue; }
      if (!action || !VALID_ACTIONS.includes(action)) item["action"] = "create";
      // Fill in composition_type: use LLM suggestion if valid, otherwise default for the classification
      const VALID_COMPOSITIONS = ["rule", "preference"];
      if (!compType || !VALID_COMPOSITIONS.includes(compType)) {
        item["composition_type"] = DEFAULT_COMPOSITION[classification] ?? "preference";
      }
      if (classification === "skip" || item["action"] === "skip") {
        skippedCount++;
        console.log(chalk.gray(`    Skipped: lines ${lines[0]}-${lines[1]} (${preview?.slice(0, 60) ?? "no preview"})`));
        continue;
      }
      validated.push(item as unknown as Classification);
    }

    if (invalidCount > 0) {
      console.log(chalk.yellow(`    ${invalidCount} section(s) had invalid format and were dropped.`));
      if (process.env["DEBUG"]) {
        // Show metadata only — redact content_preview which may contain sensitive file content
        const itemSummaries = raw.map((r: Record<string, unknown>) =>
          `${String(r["classification"] ?? "?")}:L${String(r["lines"] ?? "?")}`
        ).join(", ");
        console.log(chalk.gray(`    Invalid items: ${itemSummaries}`));
      }
    }
    if (skippedCount > 0 && validated.length > 0) {
      console.log(chalk.gray(`    ${skippedCount} section(s) skipped by LLM (not importable content).`));
    }
    if (validated.length === 0 && skippedCount > 0) {
      console.log(chalk.yellow(`    All ${skippedCount} section(s) were classified as "skip" by the LLM.`));
      console.log(chalk.gray(`    This usually means the content is org-specific configuration rather\n` +
        `    than reusable traits, gotchas, or instructions.`));
    }

    return validated;
}

// ---------------------------------------------------------------------------
// Step 2: Classify — batch LLM classification of scanned files
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  classifications: Classification[];
  trustedSources: Set<string>;
}

/**
 * Classify a set of scanned files via LLM. Batches files from the same repo
 * together for better context. Reads the hub inventory to avoid duplicates.
 *
 * Shared by both the install wizard and `agentboot import`.
 */
export function classifyScannedFiles(
  manifest: ScanManifest,
  hubPath: string,
): ClassifyResult {
  const provider = getProvider(hubPath);
  const inventory = readHubInventory(hubPath);
  console.log(chalk.gray(
    `    Hub inventory: ${inventory.traits.length} traits, ${inventory.personas.length} personas, ` +
    `${inventory.gotchas.length} gotchas, ${inventory.instructions.length} instructions\n`
  ));

  const allClassifications: Classification[] = [];
  const trustedSources = new Set<string>();

  // Filter to classifiable file types
  const classifiable = manifest.files.filter(f =>
    ["claude-md", "skill", "agent", "rule", "cursorrules", "copilot-instructions", "copilot-prompt"].includes(f.type)
  );

  if (classifiable.length === 0) {
    console.log(chalk.yellow("  No classifiable content found.\n"));
    return { classifications: [], trustedSources };
  }

  for (const file of classifiable) {
    console.log(chalk.cyan(`  Classifying: ${file.repoName}/${file.relativePath}...`));
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    const rawClassifications = classifyViaLLM(content, file.relativePath, inventory, provider);

    if (!rawClassifications) {
      console.log(chalk.yellow(`    Skipped (classification failed)`));
      continue;
    }

    trustedSources.add(file.absolutePath);
    for (const c of rawClassifications) {
      allClassifications.push({ ...c, source_file: file.absolutePath });
    }

    console.log(chalk.green(`    ${rawClassifications.length} section(s) classified`));
  }

  return { classifications: allClassifications, trustedSources };
}

// ---------------------------------------------------------------------------
// Step 3: Apply — write classified content to hub (shared)
// ---------------------------------------------------------------------------

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
  planPath: string | null; // path to saved plan if user declined
}

/**
 * Finalize an import: apply classifications to the hub or save the plan.
 *
 * If `apply` is true, writes files to the hub immediately.
 * If `apply` is false, writes the plan to .agentboot-import-plan.json.
 *
 * Shared by both the install wizard and `agentboot import`.
 */
export function finalizeImport(
  classifications: Classification[],
  trustedSources: Set<string>,
  hubPath: string,
  apply: boolean,
): ImportResult {
  const plan: ImportPlan = {
    hub: hubPath,
    scanned_at: new Date().toISOString(),
    classifications,
  };

  if (!apply) {
    const stagingPath = writeStagingFile(plan, hubPath, trustedSources);
    console.log(chalk.cyan(`\n  Import plan saved to: ${stagingPath}`));
    console.log(chalk.gray(
      "  Review the file and run `agentboot import --apply` when ready.\n"
    ));
    return { created: 0, skipped: 0, errors: [], planPath: stagingPath };
  }

  console.log(chalk.cyan("\n  Applying import...\n"));
  const result = applyPlan(plan, hubPath, trustedSources);

  console.log(chalk.bold(
    `\n  ${chalk.green("✓")} Created: ${result.created}, Skipped: ${result.skipped}` +
    (result.errors.length > 0 ? `, Errors: ${result.errors.length}` : "") + "\n"
  ));
  for (const err of result.errors) {
    console.log(chalk.red(`    ${err}`));
  }
  console.log(chalk.gray("  Original files were not modified.\n"));

  return { ...result, planPath: null };
}

// ---------------------------------------------------------------------------
// Staging file
// ---------------------------------------------------------------------------

function writeStagingFile(
  plan: ImportPlan,
  hubPath: string,
  trustedSources: Set<string>
): string {
  const stagingPath = path.join(hubPath, ".agentboot-import-plan.json");
  fs.writeFileSync(stagingPath, JSON.stringify(plan, null, 2) + "\n", "utf-8");

  // Write trusted sources separately (NOT user-editable)
  const trustedPath = path.join(hubPath, ".agentboot-import-trusted.json");
  const trustedData = { hub: hubPath, sources: [...trustedSources] };
  fs.writeFileSync(trustedPath, JSON.stringify(trustedData, null, 2) + "\n", "utf-8");
  return stagingPath;
}

function readStagingFile(stagingPath: string): ImportPlan | null {
  try {
    return JSON.parse(fs.readFileSync(stagingPath, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Apply: write classified content to hub
// ---------------------------------------------------------------------------

/** Allowed target directories for classified content (defense in depth). */
const ALLOWED_CLASSIFICATION_DIRS = ["core/lexicon/", "core/traits/", "core/gotchas/", "core/instructions/", "core/personas/"];

function applyPlan(
  plan: ImportPlan,
  trustedHub: string,
  trustedSources: Set<string>
): { created: number; skipped: number; errors: string[] } {
  const result = { created: 0, skipped: 0, errors: [] as string[] };
  const resolvedHub = path.resolve(trustedHub);

  // Cache source file contents by path
  const sourceCache = new Map<string, string[]>();

  for (const item of plan.classifications) {
    if (item.action === "skip") {
      result.skipped++;
      continue;
    }

    if (item.action === "create" || item.action === "merge") {
      // Validate source_file against trusted set (not from editable staging file)
      const resolvedSource = path.resolve(item.source_file);
      if (!trustedSources.has(resolvedSource)) {
        result.errors.push(`Rejected source_file ${item.source_file} (not in original scan)`);
        continue;
      }

      const destPath = path.resolve(trustedHub, item.suggested_path);

      // Path traversal protection: reject paths that escape the hub directory
      if (!destPath.startsWith(resolvedHub + path.sep)) {
        result.errors.push(`Rejected ${item.suggested_path} (path escapes hub boundary)`);
        continue;
      }

      // Defense in depth: only allow writes to known classification directories
      const normalizedPath = item.suggested_path.replace(/\\/g, "/");
      if (!ALLOWED_CLASSIFICATION_DIRS.some(dir => normalizedPath.startsWith(dir))) {
        result.errors.push(`Rejected ${item.suggested_path} (not in allowed directory: ${ALLOWED_CLASSIFICATION_DIRS.join(", ")})`);
        continue;
      }

      // Read source file (cached)
      if (!sourceCache.has(resolvedSource)) {
        if (!fs.existsSync(resolvedSource)) {
          result.errors.push(`Source file not found: ${item.source_file}`);
          continue;
        }
        sourceCache.set(resolvedSource, fs.readFileSync(resolvedSource, "utf-8").split("\n"));
      }
      const sourceLines = sourceCache.get(resolvedSource)!;

      // Extract the section content
      const startLine = Math.max(0, item.lines[0] - 1); // Convert to 0-indexed
      const endLine = Math.min(sourceLines.length, item.lines[1]);
      const sectionContent = sourceLines.slice(startLine, endLine).join("\n").trim();

      if (!sectionContent) {
        result.skipped++;
        continue;
      }

      // Add composition frontmatter if the composition type differs from the default
      const defaultComp = DEFAULT_COMPOSITION[item.classification] ?? "preference";
      const comp = item.composition_type ?? defaultComp;
      let contentToWrite = sectionContent;
      if (comp !== defaultComp && item.action === "create") {
        // Inject composition into existing frontmatter or prepend new frontmatter
        if (contentToWrite.startsWith("---\n")) {
          // Has frontmatter — inject composition field after the opening ---
          contentToWrite = contentToWrite.replace("---\n", `---\ncomposition: ${comp}\n`);
        } else {
          contentToWrite = `---\ncomposition: ${comp}\n---\n\n${contentToWrite}`;
        }
      }

      // Write the file
      try {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        if (item.action === "merge" && fs.existsSync(destPath)) {
          const existing = fs.readFileSync(destPath, "utf-8");
          fs.writeFileSync(destPath, existing.trimEnd() + "\n\n" + contentToWrite + "\n", "utf-8");
        } else {
          fs.writeFileSync(destPath, contentToWrite + "\n", "utf-8");
        }

        result.created++;
        console.log(chalk.green(`    + ${item.suggested_path} (${item.classification})`));
      } catch (err) {
        result.errors.push(`Failed to write ${item.suggested_path}: ${err}`);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runImport(opts: ImportOptions): Promise<void> {
  console.log(chalk.bold("\n  AgentBoot — Import\n"));
  console.log(chalk.gray(
    "  Scan and classify existing AI agent content into your personas repo.\n" +
    "  Original files are never modified or deleted.\n"
  ));

  // Determine target path
  const targetPath = opts.path ? path.resolve(opts.path) : process.cwd();

  if (!fs.existsSync(targetPath)) {
    console.log(chalk.red(`  Path not found: ${targetPath}\n`));
    throw new AgentBootError(1);
  }

  // If --apply, apply an existing staging file
  if (opts.apply) {
    const hubPath = opts.hubPath ? path.resolve(opts.hubPath) : findHub(process.cwd());
    if (!hubPath) {
      console.log(chalk.red("  Cannot find personas repo. Use --hub-path to specify.\n"));
      throw new AgentBootError(1);
    }
    const stagingPath = path.join(hubPath, ".agentboot-import-plan.json");
    const plan = readStagingFile(stagingPath);
    if (!plan) {
      console.log(chalk.red(`  No import plan found at: ${stagingPath}\n`));
      throw new AgentBootError(1);
    }
    // Read trusted sources from the separate (non-editable) trusted file
    const trustedPath = path.join(hubPath, ".agentboot-import-trusted.json");
    let trustedSources = new Set<string>();
    try {
      const trustedData = JSON.parse(fs.readFileSync(trustedPath, "utf-8"));
      trustedSources = new Set((trustedData.sources ?? []) as string[]);
      // Use hub from trusted file, not from the editable plan
      const trustedHub = trustedData.hub as string;
      if (trustedHub) {
        console.log(chalk.cyan(`  Applying import plan (${plan.classifications.length} items)...\n`));
        const result = applyPlan(plan, trustedHub, trustedSources);
        console.log(chalk.bold(
          `\n  ${chalk.green("✓")} Created: ${result.created}, Skipped: ${result.skipped}` +
          (result.errors.length > 0 ? `, Errors: ${result.errors.length}` : "") + "\n"
        ));
        // Clean up staging + trusted files
        if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
        if (fs.existsSync(trustedPath)) fs.unlinkSync(trustedPath);
        return;
      }
    } catch {
      console.log(chalk.red("  Trusted sources file missing or corrupt (.agentboot-import-trusted.json)."));
      console.log(chalk.gray("  Re-run `agentboot import` instead of `--apply`.\n"));
      throw new AgentBootError(1);
    }
    // Fallback (should not reach here)
    if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
    if (fs.existsSync(trustedPath)) fs.unlinkSync(trustedPath);
    return;
  }

  // Find hub
  const hubPath = opts.hubPath ? path.resolve(opts.hubPath) : findHub(process.cwd());
  if (!hubPath) {
    console.log(chalk.red(
      "  Cannot find personas repo. Run from the personas repo or use --hub-path.\n" +
      "  Import requires hub access to detect overlaps with existing content.\n"
    ));
    throw new AgentBootError(1);
  }

  console.log(chalk.gray(`  Hub: ${hubPath}`));
  console.log(chalk.gray(`  Target: ${targetPath}\n`));

  // Step 1: Scan (or use single file if opts.file is set)
  let classifiable: ScannedFile[];

  if (opts.file) {
    // Single-file mode (used by `add prompt`)
    const filePath = path.resolve(opts.file);
    if (!fs.existsSync(filePath)) {
      console.log(chalk.red(`  File not found: ${filePath}\n`));
      throw new AgentBootError(1);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    classifiable = [{
      path: filePath,
      relativePath: path.basename(filePath),
      lines: content.split("\n").length,
      type: "claude-md", // Treat as classifiable content
    }];
    console.log(chalk.green(`  Classifying: ${filePath} (${classifiable[0]!.lines} lines)\n`));
  } else {
    console.log(chalk.cyan("  Scanning for agentic content..."));
    const scan = scanPath(targetPath);

    if (scan.files.length === 0) {
      console.log(chalk.yellow("  No agentic content found.\n"));
      throw new AgentBootError(0);
    }

    console.log(chalk.green(`  Found ${scan.files.length} file(s):\n`));
    for (const file of scan.files) {
      console.log(chalk.gray(`    ${file.relativePath} (${file.lines} lines, ${file.type})`));
    }

    // Filter to classifiable files (skip settings, mcp, etc.)
    classifiable = scan.files.filter(f =>
      ["claude-md", "skill", "agent", "rule", "cursorrules", "copilot-instructions", "copilot-prompt"].includes(f.type)
    );

    if (classifiable.length === 0) {
      console.log(chalk.yellow("\n  No classifiable content found (settings and MCP configs are skipped).\n"));
      throw new AgentBootError(0);
    }
  } // end of scan vs single-file branch

  // Step 2: Read hub inventory
  console.log(chalk.cyan("\n  Reading hub inventory for context..."));
  const inventory = readHubInventory(hubPath);
  console.log(chalk.gray(
    `    ${inventory.traits.length} traits, ${inventory.personas.length} personas, ` +
    `${inventory.gotchas.length} gotchas, ${inventory.instructions.length} instructions`
  ));

  // Step 3: Classify each file via LLM provider
  const allClassifications: Classification[] = [];
  const trustedSources = new Set<string>();
  const provider = getProvider(hubPath);

  for (const file of classifiable) {
    console.log(chalk.cyan(`\n  Classifying: ${file.relativePath}...`));
    const content = fs.readFileSync(file.path, "utf-8");
    const rawClassifications = classifyViaLLM(content, file.relativePath, inventory, provider);

    if (!rawClassifications) {
      console.log(chalk.yellow(`    Skipped (classification failed)`));
      continue;
    }

    // Tag each classification with its source file
    const resolvedPath = path.resolve(file.path);
    trustedSources.add(resolvedPath);
    for (const c of rawClassifications) {
      allClassifications.push({ ...c, source_file: resolvedPath });
    }

    console.log(chalk.green(`    ${rawClassifications.length} section(s) classified`));
  }

  if (allClassifications.length === 0) {
    console.log(chalk.yellow("\n  No content classified.\n"));
    throw new AgentBootError(0);
  }

  // Step 3.5: Overlap analysis (if --overlap)
  if (opts.overlap) {
    runOverlapAnalysis(allClassifications, hubPath);
  }

  // Step 4: Write staging file
  const plan: ImportPlan = {
    hub: hubPath,
    scanned_at: new Date().toISOString(),
    classifications: allClassifications,
  };

  const stagingPath = writeStagingFile(plan, hubPath, trustedSources);
  printClassificationSummary(allClassifications, stagingPath);

  // Step 5: Wait for user to review
  await input({ message: "Press enter when ready to apply (or Ctrl+C to cancel)..." });

  // Re-read the staging file (user may have edited actions and line ranges).
  // SECURITY NOTE: The user can modify line ranges to extract different content
  // than what the LLM classified. This is intentional — it allows users to adjust
  // extraction boundaries. Source files and destination paths are validated against
  // the trusted sources file and ALLOWED_CLASSIFICATION_DIRS respectively.
  const updatedPlan = readStagingFile(stagingPath);
  if (!updatedPlan) {
    console.log(chalk.red("  Import plan file was removed or is invalid.\n"));
    throw new AgentBootError(1);
  }

  // Step 6: Apply — use trusted hub and sources, not values from the editable file
  console.log(chalk.cyan("\n  Applying import plan...\n"));
  const result = applyPlan(updatedPlan, hubPath, trustedSources);

  console.log(chalk.bold(
    `\n  ${chalk.green("✓")} Created: ${result.created}, Skipped: ${result.skipped}` +
    (result.errors.length > 0 ? `, Errors: ${result.errors.length}` : "") + "\n"
  ));

  for (const err of result.errors) {
    console.log(chalk.red(`    ${err}`));
  }

  // Clean up staging + trusted files
  if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
  const trustedFilePath = path.join(hubPath, ".agentboot-import-trusted.json");
  if (fs.existsSync(trustedFilePath)) fs.unlinkSync(trustedFilePath);

  console.log(chalk.gray("  Original files were not modified. Run `agentboot build` to compile.\n"));
}

// ---------------------------------------------------------------------------
// Extracted helpers (Fix #3: runImport decomposition)
// ---------------------------------------------------------------------------

function printClassificationSummary(
  classifications: Classification[],
  stagingPath: string
): void {
  const counts = new Map<string, number>([
    ["lexicon", 0], ["trait", 0], ["gotcha", 0], ["persona", 0],
    ["persona-rule", 0], ["instruction", 0], ["skip", 0],
  ]);
  for (const c of classifications) {
    counts.set(c.classification, (counts.get(c.classification) ?? 0) + 1);
  }

  console.log(chalk.bold("\n  Classification summary:\n"));
  if (counts.get("lexicon")! > 0) console.log(chalk.gray(`    Lexicon:       ${counts.get("lexicon")}`));
  if (counts.get("trait")! > 0) console.log(chalk.gray(`    Traits:        ${counts.get("trait")}`));
  if (counts.get("gotcha")! > 0) console.log(chalk.gray(`    Gotchas:       ${counts.get("gotcha")}`));
  if (counts.get("persona")! > 0) console.log(chalk.gray(`    Personas:      ${counts.get("persona")}`));
  if (counts.get("persona-rule")! > 0) console.log(chalk.gray(`    Persona rules: ${counts.get("persona-rule")}`));
  if (counts.get("instruction")! > 0) console.log(chalk.gray(`    Instructions:  ${counts.get("instruction")}`));
  if (counts.get("skip")! > 0) console.log(chalk.gray(`    Skipped:       ${counts.get("skip")}`));

  console.log(chalk.cyan(`\n  Import plan written to: ${stagingPath}`));
  console.log(chalk.gray(
    "  Review the file and edit these fields for each item:\n" +
    "    \"action\"           — \"create\", \"merge\", or \"skip\"\n" +
    "    \"composition_type\" — \"rule\" (org wins) or \"preference\" (team wins)\n"
  ));
}

function runOverlapAnalysis(
  classifications: Classification[],
  hubPath: string
): void {
  console.log(chalk.cyan("\n  Running overlap analysis..."));

  const overlapMatches = analyzeOverlap(classifications, hubPath);

  if (overlapMatches.length > 0) {
    console.log(chalk.bold(`\n  Overlap analysis: ${overlapMatches.length} match(es)\n`));
    for (const match of overlapMatches) {
      const icon = match.level === "near-duplicate" ? chalk.red("!!") : chalk.yellow("~");
      const pct = Math.round(match.similarity * 100);
      console.log(chalk.gray(
        `    ${icon} ${match.sourceItem} ↔ ${match.targetItem} (${pct}% ${match.level})`
      ));
    }
  } else {
    console.log(chalk.green("  No overlaps detected."));
  }
}

// ---------------------------------------------------------------------------
// Overlap analysis (heuristic: Jaccard on normalized tokens)
// ---------------------------------------------------------------------------

function normalizeContent(content: string): string[] {
  return content
    .replace(/^#+\s*/gm, "")        // Strip markdown headings
    .replace(/[*_`~]/g, "")          // Strip emphasis/code markers
    .replace(/[-=]{3,}/g, "")        // Strip horizontal rules
    .replace(/\s+/g, " ")            // Collapse whitespace
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);      // Drop very short words
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface OverlapMatch {
  sourceItem: string;
  targetItem: string;
  similarity: number;
  level: "near-duplicate" | "possibly-related";
}

function analyzeOverlap(
  classifications: Classification[],
  hubPath: string
): OverlapMatch[] {
  const matches: OverlapMatch[] = [];

  // Read hub content into token sets
  const hubContent: Array<{ name: string; tokens: Set<string> }> = [];

  function loadDir(dir: string, prefix: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(dir, entry), "utf-8");
      const tokens = new Set(normalizeContent(content));
      hubContent.push({ name: `${prefix}/${entry.replace(".md", "")}`, tokens });
    }
  }

  loadDir(path.join(hubPath, "core", "traits"), "traits");
  loadDir(path.join(hubPath, "core", "gotchas"), "gotchas");
  loadDir(path.join(hubPath, "core", "instructions"), "instructions");

  // Cache source file lines per path
  const sourceCache = new Map<string, string[]>();

  // Compare each classification against hub content
  const classificationSets: Array<{ name: string; tokens: Set<string> }> = [];

  for (const item of classifications) {
    if (item.action === "skip") continue;

    // Read source lines from the classification's own source file
    if (!sourceCache.has(item.source_file)) {
      try {
        sourceCache.set(item.source_file, fs.readFileSync(item.source_file, "utf-8").split("\n"));
      } catch {
        continue; // Can't read source — skip this classification
      }
    }
    const sourceLines = sourceCache.get(item.source_file)!;

    const startLine = Math.max(0, item.lines[0] - 1);
    const endLine = Math.min(sourceLines.length, item.lines[1]);
    const sectionContent = sourceLines.slice(startLine, endLine).join("\n");
    const tokens = new Set(normalizeContent(sectionContent));
    const itemName = `${item.classification}/${item.suggested_name}`;

    // Against hub
    for (const hub of hubContent) {
      const similarity = jaccardSimilarity(tokens, hub.tokens);
      if (similarity >= 0.7) {
        matches.push({
          sourceItem: itemName,
          targetItem: hub.name,
          similarity,
          level: "near-duplicate",
        });
      } else if (similarity >= 0.5) {
        matches.push({
          sourceItem: itemName,
          targetItem: hub.name,
          similarity,
          level: "possibly-related",
        });
      }
    }

    classificationSets.push({ name: itemName, tokens });
  }

  // Cross-import comparison
  for (let i = 0; i < classificationSets.length; i++) {
    for (let j = i + 1; j < classificationSets.length; j++) {
      const a = classificationSets[i]!;
      const b = classificationSets[j]!;
      const similarity = jaccardSimilarity(a.tokens, b.tokens);
      if (similarity >= 0.7) {
        matches.push({
          sourceItem: a.name,
          targetItem: b.name,
          similarity,
          level: "near-duplicate",
        });
      } else if (similarity >= 0.5) {
        matches.push({
          sourceItem: a.name,
          targetItem: b.name,
          similarity,
          level: "possibly-related",
        });
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// AB-112: Whole-file import — agents → personas, traits → traits, rules → gotchas
// ---------------------------------------------------------------------------

export interface WholeFileImport {
  source_file: string;
  import_type: "agent" | "trait" | "rule" | "skill";
  target_path: string;
  generates: string[];       // additional files created (e.g. persona.config.json)
  persona_config?: {
    name: string;
    description: string;
    invocation: string;
    traits: string[];
  };
  action: "create" | "skip";
  composition_type: CompositionType;
  duplicate_of: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Extract trait references from agent/skill content.
 * Looks for `<!-- trait: name -->` comments and `@import` references.
 */
function extractTraitRefs(content: string): string[] {
  const refs: string[] = [];
  // <!-- trait: critical-thinking -->
  for (const m of content.matchAll(/<!--\s*trait:\s*([a-z0-9-]+)\s*-->/gi)) {
    refs.push(m[1]!);
  }
  // @.claude/traits/name.md or @traits/name.md
  for (const m of content.matchAll(/@(?:\.claude\/)?traits\/([a-z0-9-]+)\.md/gi)) {
    refs.push(m[1]!);
  }
  return [...new Set(refs)];
}

/**
 * Parse agent/skill frontmatter for name, description, model, tools.
 */
function parseAgentFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!content.startsWith("---")) return result;
  const endIdx = content.indexOf("---", 3);
  if (endIdx < 0) return result;
  const frontmatter = content.slice(3, endIdx);
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([a-zA-Z_]+)\s*:\s*(.+)/);
    if (match) result[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return result;
}

/**
 * Strip frontmatter from content (return body only).
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIdx = content.indexOf("---", 3);
  if (endIdx < 0) return content;
  return content.slice(endIdx + 3).trim();
}

/**
 * Process whole-file imports: agents → personas, traits → traits, rules with paths → gotchas.
 * Returns structured import entries for the v2 staging file.
 */
export function processWholeFileImports(
  files: CategorizedScan["wholeFile"],
  hubPath: string,
): WholeFileImport[] {
  const imports: WholeFileImport[] = [];
  const inventory = readHubInventory(hubPath);
  const existingTraits = new Set(inventory.traits.map(t => t.name));
  const existingPersonas = new Set(inventory.personas.map(p => p.name));
  const existingGotchas = new Set(inventory.gotchas.map(g => g.name));

  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    const basename = path.basename(file.absolutePath, ".md");

    switch (file.type) {
      case "agent": {
        // Agent → persona: core/personas/{name}/SKILL.md + persona.config.json
        const fm = parseAgentFrontmatter(content);
        const name = slugify(fm["name"] ?? basename);
        const description = fm["description"] ?? `Imported from ${file.repoName}`;
        const traits = extractTraitRefs(content);
        const invocation = `/${name}`;
        const isDuplicate = existingPersonas.has(name);
        const targetPath = `core/personas/${name}/SKILL.md`;
        const configPath = `core/personas/${name}/persona.config.json`;

        imports.push({
          source_file: file.absolutePath,
          import_type: "agent",
          target_path: targetPath,
          generates: [configPath],
          persona_config: { name, description, invocation, traits },
          action: isDuplicate ? "skip" : "create",
          composition_type: "rule",
          duplicate_of: isDuplicate ? `core/personas/${name}` : null,
          confidence: "high",
        });
        break;
      }

      case "trait": {
        // Trait → core/traits/{name}.md
        const name = slugify(basename);
        const isDuplicate = existingTraits.has(name);

        imports.push({
          source_file: file.absolutePath,
          import_type: "trait",
          target_path: `core/traits/${name}.md`,
          generates: [],
          action: isDuplicate ? "skip" : "create",
          composition_type: "preference",
          duplicate_of: isDuplicate ? `core/traits/${name}.md` : null,
          confidence: "high",
        });
        break;
      }

      case "rule": {
        // Rule with paths: → core/gotchas/{name}.md
        const name = slugify(basename);
        const isDuplicate = existingGotchas.has(name);

        imports.push({
          source_file: file.absolutePath,
          import_type: "rule",
          target_path: `core/gotchas/${name}.md`,
          generates: [],
          action: isDuplicate ? "skip" : "create",
          composition_type: "rule",
          duplicate_of: isDuplicate ? `core/gotchas/${name}.md` : null,
          confidence: "high",
        });
        break;
      }

      case "skill": {
        // Skill — handled in processSkillImports() for agent linking
        // Skip here, processed separately
        break;
      }
    }
  }

  return imports;
}

/**
 * Apply whole-file imports to the hub filesystem.
 *
 * Security: validates all target paths (including generates) against the hub
 * boundary AND ALLOWED_CLASSIFICATION_DIRS. Validates source files against
 * the trusted sources set.
 */
export function applyWholeFileImports(
  imports: WholeFileImport[],
  hubPath: string,
  trustedSources?: Set<string>,
): { created: number; skipped: number; errors: string[] } {
  const result = { created: 0, skipped: 0, errors: [] as string[] };
  const resolvedHub = path.resolve(hubPath);

  /** Validate a write target against hub boundary and allowlist. */
  function validateTargetPath(targetPath: string): string | null {
    const resolved = path.resolve(hubPath, targetPath);
    if (!resolved.startsWith(resolvedHub + path.sep)) {
      return `Rejected ${targetPath} (path escapes hub boundary)`;
    }
    const normalized = targetPath.replace(/\\/g, "/");
    if (!ALLOWED_CLASSIFICATION_DIRS.some(dir => normalized.startsWith(dir))) {
      return `Rejected ${targetPath} (not in allowed directory: ${ALLOWED_CLASSIFICATION_DIRS.join(", ")})`;
    }
    return null; // valid
  }

  for (const imp of imports) {
    if (imp.action === "skip") {
      result.skipped++;
      if (imp.duplicate_of) {
        console.log(chalk.gray(`    ⊘ ${imp.target_path} (duplicate of ${imp.duplicate_of})`));
      }
      continue;
    }

    // Validate target_path
    const targetErr = validateTargetPath(imp.target_path);
    if (targetErr) { result.errors.push(targetErr); continue; }
    const destPath = path.resolve(hubPath, imp.target_path);

    // Validate all generates paths
    let generatesValid = true;
    for (const genPath of imp.generates) {
      const genErr = validateTargetPath(genPath);
      if (genErr) { result.errors.push(genErr); generatesValid = false; }
    }
    if (!generatesValid) continue;

    // Validate source_file against trusted sources
    if (trustedSources) {
      const resolvedSource = path.resolve(imp.source_file);
      if (!trustedSources.has(resolvedSource)) {
        result.errors.push(`Rejected source_file ${imp.source_file} (not in original scan)`);
        continue;
      }
    }

    // Verify source is a real file, not a symlink to outside the repo
    try {
      const lstat = fs.lstatSync(imp.source_file);
      if (lstat.isSymbolicLink()) {
        result.errors.push(`Rejected ${imp.source_file} (symlink — resolve manually)`);
        continue;
      }
    } catch {
      result.errors.push(`Source file not found: ${imp.source_file}`);
      continue;
    }

    try {
      const content = fs.readFileSync(imp.source_file, "utf-8");

      if (imp.import_type === "agent") {
        const body = stripFrontmatter(content);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, body + "\n", "utf-8");

        if (imp.persona_config && imp.generates.length > 0) {
          const configDest = path.resolve(hubPath, imp.generates[0]!);
          fs.mkdirSync(path.dirname(configDest), { recursive: true });
          const config = {
            name: imp.persona_config.name,
            description: imp.persona_config.description,
            invocation: imp.persona_config.invocation,
            traits: imp.persona_config.traits,
          };
          fs.writeFileSync(configDest, JSON.stringify(config, null, 2) + "\n", "utf-8");
        }
        console.log(chalk.green(`    + ${imp.target_path} (persona from agent)`));
      } else if (imp.import_type === "trait") {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, content, "utf-8");
        console.log(chalk.green(`    + ${imp.target_path} (trait)`));
      } else if (imp.import_type === "rule") {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, content, "utf-8");
        console.log(chalk.green(`    + ${imp.target_path} (gotcha from rule)`));
      } else if (imp.import_type === "skill") {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const body = stripFrontmatter(content);
        // Linked skills append to existing SKILL.md instead of overwriting
        if (fs.existsSync(destPath)) {
          const existing = fs.readFileSync(destPath, "utf-8");
          fs.writeFileSync(destPath, existing.trimEnd() + "\n\n" + body + "\n", "utf-8");
        } else {
          fs.writeFileSync(destPath, body + "\n", "utf-8");
        }
        if (imp.persona_config && imp.generates.length > 0) {
          const configDest = path.resolve(hubPath, imp.generates[0]!);
          fs.mkdirSync(path.dirname(configDest), { recursive: true });
          const config = {
            name: imp.persona_config.name,
            description: imp.persona_config.description,
            invocation: imp.persona_config.invocation,
            traits: imp.persona_config.traits,
          };
          fs.writeFileSync(configDest, JSON.stringify(config, null, 2) + "\n", "utf-8");
        }
        console.log(chalk.green(`    + ${imp.target_path} (persona from skill)`));
      }

      result.created++;
    } catch (err) {
      result.errors.push(`Failed to write ${imp.target_path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// AB-113: Config merge — settings permissions, MCP with secret detection, hooks
// ---------------------------------------------------------------------------

export interface ConfigMergeEntry {
  source_file: string;
  merge_type: "permissions" | "mcp-servers" | "hooks";
  target: string;         // e.g. "claude.permissions", "claude.mcpServers"
  extractions: Array<{
    key: string;
    values?: string[];
    data?: Record<string, unknown>;
    confirmed: boolean;
  }>;
  warnings: string[];
}

/**
 * Heuristic secret detection for MCP env values and similar config values.
 * Checks key name patterns and string entropy.
 */
export function looksLikeSecret(key: string, value: string): boolean {
  // Check key name patterns — use word-boundary-like matching to avoid false positives
  // (e.g., "monkey" should NOT match just because it contains "key")
  const sensitiveKeyPattern = /(?:^|[_.-])(?:api[_.-]?key|secret|token|password|pwd|pass|credential|auth[_.-]?token|private[_.-]?key|signing[_.-]?key|pat)(?:$|[_.-])/i;
  if (sensitiveKeyPattern.test(key)) return true;

  // Also check common prefixed patterns
  if (/^(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)$/i.test(key)) return true;

  // Check value for known secret prefixes (provider-specific)
  if (typeof value === "string" && /^(?:sk-|ghp_|gho_|github_pat_|xoxb-|xoxp-|AKIA)/i.test(value)) return true;

  // Check value entropy — high-entropy strings >16 chars that look like base64/hex
  if (typeof value === "string" && value.length > 16) {
    const base64ish = /^[A-Za-z0-9+/=_-]{16,}$/.test(value);
    if (base64ish) {
      // Check Shannon entropy
      const freq = new Map<string, number>();
      for (const ch of value) {
        freq.set(ch, (freq.get(ch) ?? 0) + 1);
      }
      let entropy = 0;
      for (const count of freq.values()) {
        const p = count / value.length;
        entropy -= p * Math.log2(p);
      }
      // Entropy > 3.0 bits/char is suspicious for base64-like strings
      if (entropy > 3.0) return true;
    }
  }

  return false;
}

/**
 * Process config merge files: settings.json → permissions, .mcp.json → servers, hooks.
 */
export function processConfigMerges(
  files: CategorizedScan["configMerge"],
): ConfigMergeEntry[] {
  const entries: ConfigMergeEntry[] = [];

  for (const file of files) {
    let parsed: Record<string, unknown>;
    try {
      const content = fs.readFileSync(file.absolutePath, "utf-8");
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      console.log(chalk.yellow(`    Skipped ${file.relativePath} (invalid JSON)`));
      continue;
    }

    if (file.type === "settings") {
      // Extract permissions
      const permissions = parsed["permissions"] as Record<string, unknown> | undefined;
      if (permissions) {
        const allow = Array.isArray(permissions["allow"]) ? permissions["allow"] as string[] : [];
        const deny = Array.isArray(permissions["deny"]) ? permissions["deny"] as string[] : [];

        if (allow.length > 0 || deny.length > 0) {
          const extractions: ConfigMergeEntry["extractions"] = [];
          if (allow.length > 0) {
            extractions.push({ key: "allow", values: allow, confirmed: true });
          }
          if (deny.length > 0) {
            extractions.push({ key: "deny", values: deny, confirmed: true });
          }
          entries.push({
            source_file: file.absolutePath,
            merge_type: "permissions",
            target: "claude.permissions",
            extractions,
            warnings: [],
          });
        }
      }

      // Extract hooks (high-trust — require per-hook confirmation)
      const hooks = parsed["hooks"] as Record<string, unknown> | undefined;
      if (hooks && typeof hooks === "object") {
        const hookExtractions: ConfigMergeEntry["extractions"] = [];
        const warnings: string[] = [];

        for (const [event, hookDef] of Object.entries(hooks)) {
          // Hooks can be an array of hook objects or a single hook object
          const hookList = Array.isArray(hookDef) ? hookDef : [hookDef];
          for (const hook of hookList) {
            if (typeof hook !== "object" || hook === null) continue;
            const h = hook as Record<string, unknown>;
            const command = String(h["command"] ?? "");
            if (!command) continue;

            hookExtractions.push({
              key: event,
              data: { command, ...(h["args"] ? { args: h["args"] } : {}) },
              confirmed: false, // Default NO — security-first
            });
            warnings.push(`Hook "${event}: ${command}" requires confirmation`);
          }
        }

        if (hookExtractions.length > 0) {
          entries.push({
            source_file: file.absolutePath,
            merge_type: "hooks",
            target: "claude.hooks",
            extractions: hookExtractions,
            warnings,
          });
        }
      }
    } else if (file.type === "mcp") {
      // Extract MCP servers
      const mcpServers = parsed["mcpServers"] as Record<string, unknown> | undefined;
      if (mcpServers && typeof mcpServers === "object") {
        const extractions: ConfigMergeEntry["extractions"] = [];
        const warnings: string[] = [];

        for (const [serverName, serverDef] of Object.entries(mcpServers)) {
          if (typeof serverDef !== "object" || serverDef === null) continue;
          const server = serverDef as Record<string, unknown>;

          // Check env values for secrets — flag servers with secrets as unconfirmed
          let hasSecrets = false;
          const env = server["env"] as Record<string, string> | undefined;
          if (env && typeof env === "object") {
            for (const [envKey, envVal] of Object.entries(env)) {
              if (typeof envVal === "string" && looksLikeSecret(envKey, envVal)) {
                warnings.push(`MCP server "${serverName}" env "${envKey}" looks like a secret`);
                hasSecrets = true;
              }
            }
          }

          extractions.push({
            key: serverName,
            data: server as Record<string, unknown>,
            // Default to unconfirmed when secrets detected — user must review
            confirmed: !hasSecrets,
          });
        }

        if (extractions.length > 0) {
          entries.push({
            source_file: file.absolutePath,
            merge_type: "mcp-servers",
            target: "claude.mcpServers",
            extractions,
            warnings,
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Apply config merges to agentboot.config.json.
 */
export function applyConfigMerges(
  merges: ConfigMergeEntry[],
  hubPath: string,
): { applied: number; skipped: number; errors: string[] } {
  const result = { applied: 0, skipped: 0, errors: [] as string[] };
  const configPath = path.join(hubPath, "agentboot.config.json");

  if (!fs.existsSync(configPath)) {
    result.errors.push("agentboot.config.json not found");
    return result;
  }

  let config: Record<string, unknown>;
  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    // Use the shared JSONC stripper (respects string boundaries, unlike regex)
    const stripped = stripJsoncComments(configContent);
    config = JSON.parse(stripped) as Record<string, unknown>;
  } catch (err) {
    result.errors.push(`Failed to parse agentboot.config.json: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // Ensure claude section exists
  if (!config["claude"]) {
    config["claude"] = {};
  }
  const claude = config["claude"] as Record<string, unknown>;

  for (const merge of merges) {
    if (merge.merge_type === "permissions") {
      if (!claude["permissions"]) claude["permissions"] = { allow: [], deny: [] };
      const perms = claude["permissions"] as Record<string, string[]>;
      if (!Array.isArray(perms["allow"])) perms["allow"] = [];
      if (!Array.isArray(perms["deny"])) perms["deny"] = [];

      for (const extraction of merge.extractions) {
        if (!extraction.confirmed) { result.skipped++; continue; }
        const target = perms[extraction.key] ?? [];
        const existing = new Set(target);
        const newValues = (extraction.values ?? []).filter(v => !existing.has(v));
        if (newValues.length > 0) {
          perms[extraction.key] = [...target, ...newValues];
          result.applied++;
          console.log(chalk.green(`    + ${extraction.key}: ${newValues.join(", ")}`));
        } else {
          result.skipped++;
        }
      }
    } else if (merge.merge_type === "mcp-servers") {
      if (!claude["mcpServers"]) claude["mcpServers"] = {};
      const servers = claude["mcpServers"] as Record<string, unknown>;

      for (const extraction of merge.extractions) {
        if (!extraction.confirmed) { result.skipped++; continue; }
        if (servers[extraction.key]) {
          result.skipped++;
          console.log(chalk.gray(`    ⊘ MCP server "${extraction.key}" already exists`));
        } else {
          servers[extraction.key] = extraction.data;
          result.applied++;
          console.log(chalk.green(`    + MCP server "${extraction.key}"`));
        }
      }
    } else if (merge.merge_type === "hooks") {
      if (!claude["hooks"]) claude["hooks"] = {};
      const hooks = claude["hooks"] as Record<string, unknown[]>;

      for (const extraction of merge.extractions) {
        if (!extraction.confirmed) {
          result.skipped++;
          console.log(chalk.gray(`    ⊘ Hook "${extraction.key}" not confirmed, skipped`));
          continue;
        }
        if (!hooks[extraction.key]) hooks[extraction.key] = [];
        hooks[extraction.key]!.push(extraction.data!);
        result.applied++;
        console.log(chalk.green(`    + Hook "${extraction.key}"`));
      }
    }
  }

  // Write updated config. JSONC comments cannot be preserved through parse/serialize.
  // Warn the user so they can re-add comments if needed.
  console.log(chalk.yellow("    ⚠ agentboot.config.json will be rewritten as plain JSON (JSONC comments removed)"));
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (err) {
    result.errors.push(`Failed to write agentboot.config.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// AB-114: Skill import with agent linking
// ---------------------------------------------------------------------------

/**
 * Process skill files — link to imported agents or create standalone personas.
 */
export function processSkillImports(
  skillFiles: CategorizedScan["wholeFile"],
  agentImports: WholeFileImport[],
  hubPath: string,
): WholeFileImport[] {
  const imports: WholeFileImport[] = [];
  const inventory = readHubInventory(hubPath);
  const existingPersonas = new Set(inventory.personas.map(p => p.name));

  // Build a map of agent names that were imported this session
  const importedAgents = new Map<string, WholeFileImport>();
  for (const imp of agentImports) {
    if (imp.import_type === "agent" && imp.persona_config) {
      importedAgents.set(imp.persona_config.name, imp);
    }
  }

  const skills = skillFiles.filter(f => f.type === "skill");

  for (const file of skills) {
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    const fm = parseAgentFrontmatter(content);
    const skillName = slugify(fm["name"] ?? path.basename(path.dirname(file.absolutePath)));
    const agentRef = fm["agent"];
    const traits = extractTraitRefs(content);
    const description = fm["description"] ?? `Imported skill from ${file.repoName}`;

    if (agentRef) {
      // Try to link to an imported agent
      const linkedAgent = importedAgents.get(slugify(agentRef));
      if (linkedAgent && linkedAgent.persona_config) {
        // Merge skill body into the agent's SKILL.md (append)
        // Mark the skill as targeting the same persona
        const entry: WholeFileImport = {
          source_file: file.absolutePath,
          import_type: "skill",
          target_path: linkedAgent.target_path, // same persona's SKILL.md
          generates: [],
          action: "create",
          composition_type: "rule",
          duplicate_of: null,
          confidence: "high",
        };
        imports.push(entry);
        continue;
      }
    }

    // Unlinked skill or linked agent not found → create standalone persona
    const name = skillName;
    const isDuplicate = existingPersonas.has(name) || importedAgents.has(name);
    const targetPath = `core/personas/${name}/SKILL.md`;
    const configPath = `core/personas/${name}/persona.config.json`;

    imports.push({
      source_file: file.absolutePath,
      import_type: "skill",
      target_path: targetPath,
      generates: [configPath],
      persona_config: { name, description, invocation: `/${name}`, traits },
      action: isDuplicate ? "skip" : "create",
      composition_type: "rule",
      duplicate_of: isDuplicate ? `core/personas/${name}` : null,
      confidence: "medium",
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// AB-115: Cross-platform deduplication
// ---------------------------------------------------------------------------

export interface DeduplicationResult {
  cross_platform_overlaps: Array<{
    primary: { path: string; platform: string };
    duplicates: Array<{ path: string; platform: string; similarity: number }>;
  }>;
  deduplicated_count: number;
}

type Platform = "claude" | "cursor" | "copilot" | "unknown";

const PLATFORM_PRIORITY: Record<Platform, number> = {
  claude: 3,
  cursor: 2,
  copilot: 1,
  unknown: 0,
};

function detectPlatform(relPath: string): Platform {
  if (relPath.startsWith(".claude/") || relPath === "CLAUDE.md") return "claude";
  if (relPath === ".cursorrules" || relPath.startsWith(".cursor/")) return "cursor";
  if (relPath.startsWith(".github/copilot") || relPath.startsWith(".github/prompts/")) return "copilot";
  return "unknown";
}

/**
 * Deduplicate files across platforms before LLM classification.
 * Near-duplicates (>=0.7 Jaccard) keep only the highest-priority platform source.
 * Returns the filtered file list and dedup results for the staging file.
 */
export function deduplicateCrossPlatform(
  files: ScanManifest["files"],
): { filtered: ScanManifest["files"]; dedup: DeduplicationResult } {
  const dedup: DeduplicationResult = { cross_platform_overlaps: [], deduplicated_count: 0 };

  if (files.length < 2) {
    return { filtered: files, dedup };
  }

  // Build content fingerprints
  const fingerprints: Array<{
    file: typeof files[0];
    platform: Platform;
    tokens: Set<string>;
  }> = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.absolutePath, "utf-8");
      const tokens = new Set(normalizeContent(content));
      const platform = detectPlatform(file.relativePath);
      fingerprints.push({ file, platform, tokens });
    } catch {
      fingerprints.push({ file, platform: detectPlatform(file.relativePath), tokens: new Set() });
    }
  }

  // Pairwise comparison across different platforms
  const skipIndices = new Set<number>();

  for (let i = 0; i < fingerprints.length; i++) {
    if (skipIndices.has(i)) continue;
    const a = fingerprints[i]!;

    const duplicates: Array<{ path: string; platform: string; similarity: number; index: number }> = [];

    for (let j = i + 1; j < fingerprints.length; j++) {
      if (skipIndices.has(j)) continue;
      const b = fingerprints[j]!;

      // Only dedup across different platforms
      if (a.platform === b.platform) continue;

      const similarity = jaccardSimilarity(a.tokens, b.tokens);
      if (similarity >= 0.7) {
        duplicates.push({
          path: b.file.relativePath,
          platform: b.platform,
          similarity,
          index: j,
        });
      }
    }

    if (duplicates.length > 0) {
      // Determine primary (highest priority platform)
      const allCandidates = [
        { path: a.file.relativePath, platform: a.platform, index: i },
        ...duplicates.map(d => ({ path: d.path, platform: d.platform as Platform, index: d.index })),
      ];

      allCandidates.sort((x, y) =>
        PLATFORM_PRIORITY[y.platform as Platform] - PLATFORM_PRIORITY[x.platform as Platform]
      );

      const primary = allCandidates[0]!;
      const dups = allCandidates.slice(1);

      for (const dup of dups) {
        skipIndices.add(dup.index);
        dedup.deduplicated_count++;
      }

      dedup.cross_platform_overlaps.push({
        primary: { path: primary.path, platform: primary.platform },
        duplicates: dups.map(d => ({
          path: d.path,
          platform: d.platform,
          similarity: duplicates.find(dd => dd.index === d.index)?.similarity ?? 0.7,
        })),
      });
    }
  }

  const filtered = fingerprints
    .filter((_, idx) => !skipIndices.has(idx))
    .map(fp => fp.file);

  return { filtered, dedup };
}

// ---------------------------------------------------------------------------
// AB-114: Staging file v2 format
// ---------------------------------------------------------------------------

export interface ImportPlanV2 {
  version: 2;
  hub: string;
  scanned_at: string;
  scan_summary: {
    total_files: number;
    by_strategy: {
      wholefile: number;
      llm_classify: number;
      config_merge: number;
      skipped: number;
    };
  };
  classifications: Classification[];
  whole_file_imports: WholeFileImport[];
  config_merges: ConfigMergeEntry[];
  deduplication: DeduplicationResult;
}

function writeStagingFileV2(
  plan: ImportPlanV2,
  hubPath: string,
  trustedSources: Set<string>,
): string {
  const stagingPath = path.join(hubPath, ".agentboot-import-plan.json");
  fs.writeFileSync(stagingPath, JSON.stringify(plan, null, 2) + "\n", "utf-8");

  const trustedPath = path.join(hubPath, ".agentboot-import-trusted.json");
  const trustedData = { hub: hubPath, sources: [...trustedSources] };
  fs.writeFileSync(trustedPath, JSON.stringify(trustedData, null, 2) + "\n", "utf-8");
  return stagingPath;
}

function readStagingFileV2(stagingPath: string): ImportPlanV2 | null {
  try {
    const data = JSON.parse(fs.readFileSync(stagingPath, "utf-8")) as Record<string, unknown>;

    // Runtime validation: ensure required fields exist and have correct types
    if (typeof data["hub"] !== "string" || typeof data["scanned_at"] !== "string") {
      return null;
    }

    if (data["version"] === 2) {
      // Validate v2-specific arrays exist
      if (!Array.isArray(data["classifications"])) return null;
      if (!Array.isArray(data["whole_file_imports"])) return null;
      if (!Array.isArray(data["config_merges"])) return null;

      // Validate whole_file_imports entries have valid import_type and target_path prefix
      const VALID_IMPORT_TYPES = new Set(["agent", "trait", "rule", "skill"]);
      const wholeFile = data["whole_file_imports"] as Array<Record<string, unknown>>;
      for (const imp of wholeFile) {
        if (!VALID_IMPORT_TYPES.has(imp["import_type"] as string)) return null;
        const tp = imp["target_path"] as string;
        if (typeof tp !== "string") return null;
        const normalized = tp.replace(/\\/g, "/");
        if (!ALLOWED_CLASSIFICATION_DIRS.some(dir => normalized.startsWith(dir))) return null;
      }

      return data as unknown as ImportPlanV2;
    }

    // Upgrade v1 to v2 shape
    return {
      version: 2,
      hub: data["hub"] as string,
      scanned_at: data["scanned_at"] as string,
      scan_summary: { total_files: 0, by_strategy: { wholefile: 0, llm_classify: 0, config_merge: 0, skipped: 0 } },
      classifications: (data["classifications"] as Classification[]) ?? [],
      whole_file_imports: [],
      config_merges: [],
      deduplication: { cross_platform_overlaps: [], deduplicated_count: 0 },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Expanded import pipeline — orchestrates all strategies
// ---------------------------------------------------------------------------

/**
 * Run the expanded import pipeline with all three strategies.
 * Called from the import command when --parent is used or from the main import flow.
 */
export function runExpandedImport(
  categorized: CategorizedScan,
  manifest: ScanManifest,
  hubPath: string,
  trustedSources: Set<string>,
): ImportPlanV2 {
  // 1. Whole-file imports (free, instant)
  console.log(chalk.cyan("\n  Processing whole-file imports..."));
  const wholeFileImports = processWholeFileImports(categorized.wholeFile, hubPath);

  // 1b. Skill imports with agent linking
  const skillImports = processSkillImports(categorized.wholeFile, wholeFileImports, hubPath);
  const allWholeFile = [...wholeFileImports, ...skillImports];

  if (allWholeFile.length > 0) {
    const actionable = allWholeFile.filter(i => i.action === "create");
    const skipped = allWholeFile.length - actionable.length;
    console.log(chalk.green(`    ${actionable.length} to import, ${skipped} duplicates skipped`));
  } else {
    console.log(chalk.gray("    No whole-file imports found"));
  }

  // 2. Config merges (free, security confirm for hooks)
  console.log(chalk.cyan("\n  Processing config merges..."));
  const configMerges = processConfigMerges(categorized.configMerge);

  if (configMerges.length > 0) {
    for (const merge of configMerges) {
      console.log(chalk.gray(`    ${merge.merge_type}: ${merge.extractions.length} extraction(s)`));
      for (const warning of merge.warnings) {
        console.log(chalk.yellow(`    ⚠ ${warning}`));
      }
    }
  } else {
    console.log(chalk.gray("    No config merges found"));
  }

  // 3. Cross-platform dedup on LLM-classify files
  console.log(chalk.cyan("\n  Checking cross-platform duplicates..."));
  const { filtered: dedupedFiles, dedup } = deduplicateCrossPlatform(categorized.llmClassify);

  if (dedup.deduplicated_count > 0) {
    console.log(chalk.green(`    Deduplicated ${dedup.deduplicated_count} cross-platform duplicate(s)`));
    for (const overlap of dedup.cross_platform_overlaps) {
      console.log(chalk.gray(
        `      Primary: ${overlap.primary.path} (${overlap.primary.platform})`
      ));
      for (const dup of overlap.duplicates) {
        console.log(chalk.gray(
          `      ↳ Skipped: ${dup.path} (${dup.platform}, ${Math.round(dup.similarity * 100)}% similar)`
        ));
      }
    }
  } else {
    console.log(chalk.gray("    No cross-platform duplicates found"));
  }

  // 4. LLM classification on deduped files
  let classifications: Classification[] = [];
  if (dedupedFiles.length > 0) {
    // Convert to ScanManifest for classifyScannedFiles
    const classifyManifest: ScanManifest = {
      parentDir: manifest.parentDir,
      scannedAt: manifest.scannedAt,
      files: dedupedFiles,
    };
    const classifyResult = classifyScannedFiles(classifyManifest, hubPath);
    classifications = classifyResult.classifications;
    for (const src of classifyResult.trustedSources) {
      trustedSources.add(src);
    }
  }

  // Build v2 plan
  const plan: ImportPlanV2 = {
    version: 2,
    hub: hubPath,
    scanned_at: new Date().toISOString(),
    scan_summary: {
      total_files: manifest.files.length,
      by_strategy: {
        wholefile: categorized.wholeFile.length,
        llm_classify: categorized.llmClassify.length,
        config_merge: categorized.configMerge.length,
        skipped: categorized.skipped.length,
      },
    },
    classifications,
    whole_file_imports: allWholeFile,
    config_merges: configMerges,
    deduplication: dedup,
  };

  return plan;
}

/**
 * Apply a v2 import plan to the hub.
 */
export function applyImportPlanV2(
  plan: ImportPlanV2,
  hubPath: string,
  trustedSources: Set<string>,
): { created: number; skipped: number; applied: number; errors: string[] } {
  const result = { created: 0, skipped: 0, applied: 0, errors: [] as string[] };

  // Apply whole-file imports
  if (plan.whole_file_imports.length > 0) {
    console.log(chalk.cyan("\n  Applying whole-file imports..."));
    const wf = applyWholeFileImports(plan.whole_file_imports, hubPath, trustedSources);
    result.created += wf.created;
    result.skipped += wf.skipped;
    result.errors.push(...wf.errors);
  }

  // Apply config merges
  if (plan.config_merges.length > 0) {
    console.log(chalk.cyan("\n  Applying config merges..."));
    const cm = applyConfigMerges(plan.config_merges, hubPath);
    result.applied += cm.applied;
    result.skipped += cm.skipped;
    result.errors.push(...cm.errors);
  }

  // Apply LLM classifications (existing applyPlan logic)
  if (plan.classifications.length > 0) {
    console.log(chalk.cyan("\n  Applying LLM classifications..."));
    const cl = applyPlan(
      { hub: hubPath, scanned_at: plan.scanned_at, classifications: plan.classifications },
      hubPath,
      trustedSources,
    );
    result.created += cl.created;
    result.skipped += cl.skipped;
    result.errors.push(...cl.errors);
  }

  return result;
}

export {
  analyzeOverlap, normalizeContent, jaccardSimilarity, scanPath, applyPlan,
  buildClassificationPrompt, ALLOWED_CLASSIFICATION_DIRS,
  detectPlatform, slugify, parseAgentFrontmatter, stripFrontmatter, extractTraitRefs,
  writeStagingFileV2, readStagingFileV2,
};

// ---------------------------------------------------------------------------
// Hub finder
// ---------------------------------------------------------------------------

function findHub(startDir: string): string | null {
  // Check cwd
  if (fs.existsSync(path.join(startDir, "agentboot.config.json"))) {
    return startDir;
  }

  // Check siblings
  const parent = path.dirname(startDir);
  try {
    for (const entry of fs.readdirSync(parent)) {
      const siblingPath = path.join(parent, entry);
      if (siblingPath === startDir) continue;
      try {
        if (fs.statSync(siblingPath).isDirectory() &&
            fs.existsSync(path.join(siblingPath, "agentboot.config.json"))) {
          return siblingPath;
        }
      } catch { continue; }
    }
  } catch { /* permission denied */ }

  return null;
}
