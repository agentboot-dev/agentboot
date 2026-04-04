#!/usr/bin/env node

/**
 * Harness Intelligence Pipeline — SME Analysis Runner
 *
 * Reads the fetched sources JSON, loads the SME SKILL.md, builds a prompt
 * combining the SME system prompt with fetched source content, and invokes
 * `claude -p --print` to produce a structured intelligence report.
 *
 * Usage:
 *   npx tsx scripts/intelligence/run-sme.ts \
 *     --harness cc \
 *     --sources sources.json \
 *     --output report.json \
 *     --max-tokens 4096
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HarnessId = "cc" | "copilot" | "cursor" | "gemini" | "jetbrains";

interface FetchedSource {
  url: string;
  tier: 1 | 2 | 3;
  label: string;
  content: string | null;
  error?: string;
  fetchedAt: string;
}

interface FetchResult {
  harness: HarnessId;
  fetchedAt: string;
  sources: FetchedSource[];
}

type FindingCategory = "new-feature" | "breaking-change" | "deprecation" | "community-trend" | "competitive";
type TechnicalImpact = "none" | "low" | "medium" | "high" | "critical";
type RoadmapSignal = "accelerate" | "deprioritize" | "new-item" | "no-change";
type ActionRequired = "none" | "monitor" | "investigate" | "implement" | "escalate";

interface Finding {
  title: string;
  category: FindingCategory;
  source: string;
  summary: string;
  technical_impact: TechnicalImpact;
  roadmap_signal: RoadmapSignal;
  action_required: ActionRequired;
  detail: string;
}

interface SmeReport {
  harness: string;
  report_date: string;
  cycle: "nightly" | "weekly" | "ad-hoc";
  findings: Finding[];
  summary: string;
  top_action_items: string[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const HARNESS_DIR_MAP: Record<HarnessId, string> = {
  cc: "cc-sme",
  copilot: "copilot-sme",
  cursor: "cursor-sme",
  gemini: "gemini-sme",
  jetbrains: "jetbrains-sme",
};

const HARNESS_LABEL: Record<HarnessId, string> = {
  cc: "Claude Code",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  gemini: "Gemini",
  jetbrains: "JetBrains AI",
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  harness: HarnessId;
  sources: string;
  output: string;
  maxTokens: number;
  cycle: "nightly" | "weekly" | "ad-hoc";
}

function parseArgs(argv: string[]): CliArgs {
  let harness: string | undefined;
  let sources: string | undefined;
  let output: string | undefined;
  let maxTokens = 4096;
  let cycle: "nightly" | "weekly" | "ad-hoc" = "nightly";

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--harness" && i + 1 < argv.length) {
      harness = argv[++i];
    } else if (arg === "--sources" && i + 1 < argv.length) {
      sources = argv[++i];
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[++i];
    } else if (arg === "--max-tokens" && i + 1 < argv.length) {
      maxTokens = parseInt(argv[++i]!, 10);
    } else if (arg === "--cycle" && i + 1 < argv.length) {
      cycle = argv[++i] as "nightly" | "weekly" | "ad-hoc";
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!harness || !sources || !output) {
    printUsage();
    process.exit(1);
  }

  const validHarnesses: HarnessId[] = ["cc", "copilot", "cursor", "gemini", "jetbrains"];
  if (!validHarnesses.includes(harness as HarnessId)) {
    console.error(`Error: invalid harness "${harness}". Must be one of: ${validHarnesses.join(", ")}`);
    process.exit(1);
  }

  // Validate output path stays within project root
  const resolvedOutput = path.resolve(output);
  const resolvedRoot = path.resolve(ROOT);
  if (!resolvedOutput.startsWith(resolvedRoot)) {
    console.error(`Error: output path must be within the project root`);
    process.exit(1);
  }

  return { harness: harness as HarnessId, sources, output, maxTokens, cycle };
}

function printUsage(): void {
  console.log(`
Usage: run-sme --harness <id> --sources <path.json> --output <report.json>

Options:
  --harness     Harness ID: cc | copilot | cursor | gemini | jetbrains
  --sources     Path to the fetched sources JSON (from fetch-sources)
  --output      Path to write the SME report JSON
  --max-tokens  Maximum tokens for the LLM response (default: 4096)
  --cycle       Report cycle: nightly | weekly | ad-hoc (default: nightly)
  --help        Show this help message
`);
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildPrompt(skillMd: string, fetchedSources: FetchedSource[], cycle: string, harness: HarnessId): string {
  const today = new Date().toISOString().split("T")[0];
  const label = HARNESS_LABEL[harness];

  let sourceContent = "";
  for (const source of fetchedSources) {
    if (source.content) {
      sourceContent += `\n--- SOURCE: ${source.label} (Tier ${source.tier}) ---\n`;
      sourceContent += `URL: ${source.url}\n`;
      sourceContent += `Fetched: ${source.fetchedAt}\n\n`;
      // Limit per-source content to avoid blowing context budget
      const truncated = source.content.length > 10_000
        ? source.content.slice(0, 10_000) + "\n[TRUNCATED]"
        : source.content;
      sourceContent += truncated;
      sourceContent += "\n\n";
    }
  }

  const failedSources = fetchedSources.filter((s) => s.content === null);
  let failedNote = "";
  if (failedSources.length > 0) {
    failedNote = "\nNote: The following sources could not be fetched:\n";
    for (const s of failedSources) {
      failedNote += `- ${s.label} (${s.url}): ${s.error ?? "unknown error"}\n`;
    }
  }

  return `You are the ${label} SME for AgentBoot. Today is ${today}. This is a ${cycle} intelligence cycle.

${skillMd}

## Fetched Source Content

The following content was fetched from your monitored sources. Analyze it and produce your intelligence report.

${sourceContent}
${failedNote}

## Task

Analyze the source content above and produce a JSON intelligence report following the Output Format specified in your SKILL.md. The report should:

1. Identify any new features, breaking changes, deprecations, community trends, or competitive signals
2. Rate technical impact on AgentBoot for each finding
3. Classify each finding's roadmap signal
4. Provide a summary and prioritized action items
5. If there are no significant findings in the fetched content, produce a report stating that explicitly

IMPORTANT: Output ONLY valid JSON matching the report schema. No markdown fences, no explanation text outside the JSON.`;
}

// ---------------------------------------------------------------------------
// Report validation
// ---------------------------------------------------------------------------

function validateReport(data: unknown): data is SmeReport {
  if (typeof data !== "object" || data === null) return false;

  const report = data as Record<string, unknown>;
  if (typeof report["harness"] !== "string") return false;
  if (typeof report["report_date"] !== "string") return false;
  if (typeof report["cycle"] !== "string") return false;
  if (!Array.isArray(report["findings"])) return false;
  if (typeof report["summary"] !== "string") return false;
  if (!Array.isArray(report["top_action_items"])) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  // Load SME SKILL.md
  const smeDir = HARNESS_DIR_MAP[args.harness];
  const skillPath = path.join(ROOT, "internal", "harness-sme", smeDir, "SKILL.md");

  if (!fs.existsSync(skillPath)) {
    console.error(`Error: SKILL.md not found: ${skillPath}`);
    process.exit(1);
  }

  const skillMd = fs.readFileSync(skillPath, "utf-8");

  // Load fetched sources
  if (!fs.existsSync(args.sources)) {
    console.error(`Error: sources file not found: ${args.sources}`);
    process.exit(1);
  }

  const sourcesData: FetchResult = JSON.parse(fs.readFileSync(args.sources, "utf-8"));

  const sourcesWithContent = sourcesData.sources.filter((s) => s.content !== null);
  if (sourcesWithContent.length === 0) {
    console.error("Error: no sources had fetchable content. Cannot run analysis.");
    process.exit(1);
  }

  console.log(`Running ${HARNESS_LABEL[args.harness]} SME analysis...`);
  console.log(`  Sources with content: ${sourcesWithContent.length}/${sourcesData.sources.length}`);
  console.log(`  Max tokens: ${args.maxTokens}`);
  console.log(`  Cycle: ${args.cycle}`);

  // Build the prompt
  const prompt = buildPrompt(skillMd, sourcesData.sources, args.cycle, args.harness);

  // Estimate input tokens (rough: 1 token ≈ 4 chars)
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  console.log(`  Estimated input tokens: ~${estimatedInputTokens}`);

  // Invoke claude -p --print
  let rawOutput: string;
  try {
    const result = spawnSync("claude", [
      "-p", "--print",
      "--max-turns", "1",
      "--max-tokens", String(args.maxTokens),
    ], {
      input: prompt,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    if (result.status !== 0) {
      const stderr = result.stderr?.trim() ?? "";
      throw new Error(stderr || `claude exited with code ${result.status}`);
    }
    rawOutput = (result.stdout ?? "").trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error invoking claude: ${message}`);
    process.exit(1);
  }

  // Parse and validate JSON output
  let report: SmeReport;
  try {
    // Strip markdown code fences if present (LLM sometimes wraps output)
    let jsonStr = rawOutput;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!;
    }

    const parsed: unknown = JSON.parse(jsonStr);
    if (!validateReport(parsed)) {
      console.error("Error: LLM output does not match expected report schema");
      console.error("Raw output:", rawOutput.slice(0, 500));
      process.exit(1);
    }
    report = parsed;
  } catch {
    console.error("Error: LLM output is not valid JSON");
    console.error("Raw output:", rawOutput.slice(0, 500));
    process.exit(1);
  }

  // Write report
  const outputDir = path.dirname(args.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(args.output, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nWrote report to ${args.output}`);
  console.log(`  Findings: ${report.findings.length}`);
  console.log(`  Action items: ${report.top_action_items.length}`);

  // Log cost estimate
  const estimatedOutputTokens = Math.ceil(rawOutput.length / 4);
  const totalTokens = estimatedInputTokens + estimatedOutputTokens;
  console.log(`  Estimated total tokens: ~${totalTokens}`);

  // Append to per-harness costs file (avoids concurrency issues in parallel CI)
  const costsPath = path.join(ROOT, "intelligence", `costs-${args.harness}.json`);
  try {
    const costsData = fs.existsSync(costsPath)
      ? JSON.parse(fs.readFileSync(costsPath, "utf-8")) as { runs: unknown[] }
      : { runs: [] };

    costsData.runs.push({
      harness: args.harness,
      date: new Date().toISOString(),
      cycle: args.cycle,
      estimatedInputTokens,
      estimatedOutputTokens,
      totalTokens,
      findings: report.findings.length,
    });

    fs.writeFileSync(costsPath, JSON.stringify(costsData, null, 2), "utf-8");
  } catch {
    console.warn("Warning: could not update costs.json");
  }
}

export { buildPrompt, validateReport };
export type { FetchedSource as RunSmeFetchedSource, SmeReport, Finding, HarnessId as RunSmeHarnessId };

// Only run main when invoked directly (not when imported for testing)
const isDirectRun = process.argv[1]?.replace(/\.ts$/, "").replace(/\.js$/, "")
  === fileURLToPath(import.meta.url).replace(/\.ts$/, "").replace(/\.js$/, "");
if (isDirectRun) {
  main();
}
