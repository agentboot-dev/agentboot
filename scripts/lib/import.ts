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
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { input } from "@inquirer/prompts";

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
  type: "claude-md" | "skill" | "agent" | "rule" | "settings" | "mcp" |
        "cursorrules" | "copilot-instructions" | "copilot-prompt" | "other";
}

interface ScanResult {
  scannedAt: string;
  targetPath: string;
  files: ScannedFile[];
}

export interface Classification {
  source_file: string;
  lines: [number, number];
  content_preview: string;
  classification: "trait" | "gotcha" | "persona-rule" | "instruction" | "skip";
  suggested_name: string;
  suggested_path: string;
  overlaps_with: string | null;
  confidence: "high" | "medium" | "low";
  action: "create" | "skip" | "merge";
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
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;

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

  return [
    "You are classifying AI agent prompt content for an organization that uses AgentBoot.",
    "AgentBoot organizes prompt content into these categories:",
    "",
    "- **trait**: A reusable behavioral building block (e.g., critical-thinking, structured-output).",
    "  Traits modulate HOW an agent behaves — they are not domain rules or checklists.",
    "- **gotcha**: Path-scoped operational knowledge (e.g., 'Always use RLS on Postgres tables').",
    "  Gotchas are battle-tested rules tied to specific technologies or file paths.",
    "- **persona-rule**: Rules specific to a reviewer or generator persona (e.g., severity levels,",
    "  output format, what to check). These belong inside a persona's SKILL.md.",
    "- **instruction**: Always-on organizational directives that apply to every session",
    "  (e.g., 'Never commit .env files', 'Use TypeScript strict mode').",
    "- **skip**: Boilerplate, auto-generated content, or content not worth extracting.",
    "",
    hubContext,
    "",
    `## File to classify: ${filePath}`,
    "",
    "```",
    fileContent,
    "```",
    "",
    "Classify each distinct section of this file. A section is a coherent block of",
    "content separated by headings, horizontal rules, or topic changes.",
    "",
    "For each section, provide:",
    "- lines: [startLine, endLine] (1-indexed)",
    "- content_preview: first 100 chars of the section",
    "- classification: one of trait, gotcha, persona-rule, instruction, skip",
    "- suggested_name: kebab-case name for the extracted file",
    "- suggested_path: where it should go in the hub (e.g., core/traits/name.md)",
    "- overlaps_with: name of existing hub content this overlaps with, or null",
    "- confidence: high, medium, or low",
    "- action: 'create' (default for all non-skip), 'skip' (for skip classification)",
  ].join("\n");
}

const CLASSIFICATION_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lines: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
          content_preview: { type: "string" },
          classification: { type: "string", enum: ["trait", "gotcha", "persona-rule", "instruction", "skip"] },
          suggested_name: { type: "string" },
          suggested_path: { type: "string" },
          overlaps_with: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          action: { type: "string", enum: ["create", "skip", "merge"] },
        },
        required: ["lines", "content_preview", "classification", "suggested_name", "suggested_path", "overlaps_with", "confidence", "action"],
      },
    },
  },
  required: ["classifications"],
});

function classifyViaLLM(
  fileContent: string,
  filePath: string,
  inventory: HubInventory
): Classification[] | null {
  const prompt = buildClassificationPrompt(fileContent, filePath, inventory);

  const result = spawnSync("claude", [
    "-p", prompt,
    "--bare",
    "--output-format", "json",
    "--json-schema", CLASSIFICATION_SCHEMA,
    "--max-turns", "1",
  ], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    if (stderr.includes("not logged in") || stderr.includes("auth")) {
      console.log(chalk.red(
        "\n  This command requires Claude Code authentication.\n" +
        "  Run: claude auth login\n"
      ));
    } else {
      // Avoid leaking file paths from stderr — show only first line
      const firstLine = stderr.split("\n")[0] ?? "unknown error";
      console.log(chalk.red(`\n  Classification failed: ${firstLine}\n`));
    }
    return null;
  }

  try {
    const output = JSON.parse(result.stdout);
    // claude -p --output-format json wraps in { result, structured_output }
    const data = output.structured_output ?? output.result ?? output;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const raw = parsed.classifications ?? [];

    // Runtime validation — reject malformed items
    const VALID_TYPES = ["trait", "gotcha", "persona-rule", "instruction", "skip"];
    const VALID_ACTIONS = ["create", "skip", "merge"];
    const validated: Classification[] = [];
    for (const item of raw) {
      if (!Array.isArray(item.lines) || item.lines.length !== 2) continue;
      if (typeof item.lines[0] !== "number" || typeof item.lines[1] !== "number") continue;
      if (!VALID_TYPES.includes(item.classification)) continue;
      if (typeof item.suggested_path !== "string") continue;
      if (!VALID_ACTIONS.includes(item.action ?? "create")) item.action = "create";
      validated.push(item as Classification);
    }
    return validated;
  } catch (err) {
    console.log(chalk.red(`\n  Failed to parse classification output: ${err}\n`));
    return null;
  }
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
const ALLOWED_CLASSIFICATION_DIRS = ["core/traits/", "core/gotchas/", "core/instructions/", "core/personas/"];

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

      // Write the file
      try {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        if (item.action === "merge" && fs.existsSync(destPath)) {
          const existing = fs.readFileSync(destPath, "utf-8");
          fs.writeFileSync(destPath, existing.trimEnd() + "\n\n" + sectionContent + "\n", "utf-8");
        } else {
          fs.writeFileSync(destPath, sectionContent + "\n", "utf-8");
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

  // Step 3: Classify each file via claude -p
  const allClassifications: Classification[] = [];
  // Track trusted source files for apply-time validation
  const trustedSources = new Set<string>();

  for (const file of classifiable) {
    console.log(chalk.cyan(`\n  Classifying: ${file.relativePath}...`));
    const content = fs.readFileSync(file.path, "utf-8");
    const rawClassifications = classifyViaLLM(content, file.relativePath, inventory);

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

  // Re-read the staging file (user may have edited actions)
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
  const counts = { trait: 0, gotcha: 0, "persona-rule": 0, instruction: 0, skip: 0 };
  for (const c of classifications) {
    counts[c.classification]++;
  }

  console.log(chalk.bold("\n  Classification summary:\n"));
  if (counts.trait > 0) console.log(chalk.gray(`    Traits:       ${counts.trait}`));
  if (counts.gotcha > 0) console.log(chalk.gray(`    Gotchas:      ${counts.gotcha}`));
  if (counts["persona-rule"] > 0) console.log(chalk.gray(`    Persona rules: ${counts["persona-rule"]}`));
  if (counts.instruction > 0) console.log(chalk.gray(`    Instructions: ${counts.instruction}`));
  if (counts.skip > 0) console.log(chalk.gray(`    Skipped:      ${counts.skip}`));

  console.log(chalk.cyan(`\n  Import plan written to: ${stagingPath}`));
  console.log(chalk.gray(
    "  Review the file and edit the \"action\" field for each item:\n" +
    "    \"create\" — extract to hub as a new file\n" +
    "    \"merge\"  — append to existing hub content\n" +
    "    \"skip\"   — do not import\n"
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

export { analyzeOverlap, normalizeContent, jaccardSimilarity, scanPath };

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
