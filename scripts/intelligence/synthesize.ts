#!/usr/bin/env node

/**
 * Harness Intelligence Pipeline — Report Synthesizer
 *
 * Reads per-harness report JSONs from a directory, feeds them to the Strategic
 * Analyst persona for cross-cutting analysis, and writes both a structured JSON
 * report and a human-readable PENDING-REVIEW.md digest.
 *
 * The Strategic Analyst runs AFTER all per-harness SMEs complete. It reads their
 * individual reports and produces competitive analysis, roadmap implications,
 * risk flags, marketing signals, and feature matrix updates.
 *
 * Usage:
 *   npx tsx scripts/intelligence/synthesize.ts --reports dir --output weekly-digest.md [--skip-llm]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Finding {
  title: string;
  category: string;
  source: string;
  summary: string;
  technical_impact: string;
  roadmap_signal: string;
  action_required: string;
  detail: string;
}

interface SmeReport {
  harness: string;
  report_date: string;
  cycle: string;
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

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  reports: string;
  output: string;
  skipLlm: boolean;
  maxTokens: number;
  cycle: "nightly" | "weekly" | "ad-hoc";
}

function parseArgs(argv: string[]): CliArgs {
  let reports: string | undefined;
  let output: string | undefined;
  let skipLlm = false;
  let maxTokens = 8192;
  let cycle: "nightly" | "weekly" | "ad-hoc" = "nightly";

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reports" && i + 1 < argv.length) {
      reports = argv[++i];
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[++i];
    } else if (arg === "--skip-llm") {
      skipLlm = true;
    } else if (arg === "--max-tokens" && i + 1 < argv.length) {
      maxTokens = parseInt(argv[++i]!, 10);
      if (isNaN(maxTokens) || maxTokens <= 0) {
        console.error("Error: --max-tokens must be a positive integer");
        process.exit(1);
      }
      if (maxTokens > 32768) {
        console.error("Error: --max-tokens exceeds maximum of 32768");
        process.exit(1);
      }
    } else if (arg === "--cycle" && i + 1 < argv.length) {
      const validCycles = ["nightly", "weekly", "ad-hoc"];
      const rawCycle = argv[++i]!;
      if (!validCycles.includes(rawCycle)) {
        console.error(`Error: --cycle must be one of: ${validCycles.join(", ")}`);
        process.exit(1);
      }
      cycle = rawCycle as "nightly" | "weekly" | "ad-hoc";
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!reports || !output) {
    printUsage();
    process.exit(1);
  }

  // Validate output path stays within project root
  const resolvedOutput = path.resolve(output);
  const resolvedRoot = path.resolve(ROOT);
  if (!resolvedOutput.startsWith(resolvedRoot)) {
    console.error(`Error: output path must be within the project root`);
    process.exit(1);
  }

  return { reports, output, skipLlm, maxTokens, cycle };
}

function printUsage(): void {
  console.log(`
Usage: synthesize --reports <dir> --output <weekly-digest.md>

Options:
  --reports     Directory containing per-harness report JSON files
  --output      Path to write the synthesized digest
  --skip-llm    Skip LLM-powered strategic analysis (produce merge-only digest)
  --max-tokens  Maximum tokens for the Strategic Analyst LLM response (default: 8192)
  --cycle       Report cycle: nightly | weekly | ad-hoc (default: nightly)
  --help        Show this help message
`);
}

// ---------------------------------------------------------------------------
// Synthesis (stub — merges reports into markdown)
// ---------------------------------------------------------------------------

function synthesizeReports(reports: SmeReport[]): string {
  const today = new Date().toISOString().split("T")[0];

  let md = `# Harness Intelligence Digest — ${today}\n\n`;
  md += `> **Status**: PENDING HUMAN REVIEW\n`;
  md += `> **Note**: This is an auto-generated merge of per-harness reports. `;
  md += `LLM-powered strategic synthesis will be added in Phase 8 (AB-141).\n\n`;

  // Aggregate stats
  const totalFindings = reports.reduce((sum, r) => sum + r.findings.length, 0);
  const allActionItems = reports.flatMap((r) => r.top_action_items);
  const criticalFindings = reports.flatMap((r) =>
    r.findings.filter((f) => f.technical_impact === "critical" || f.technical_impact === "high"),
  );

  md += `## Summary\n\n`;
  md += `- **Harnesses analyzed**: ${reports.length}\n`;
  md += `- **Total findings**: ${totalFindings}\n`;
  md += `- **High/Critical findings**: ${criticalFindings.length}\n`;
  md += `- **Action items**: ${allActionItems.length}\n\n`;

  // High-priority items first
  if (criticalFindings.length > 0) {
    md += `## High-Priority Findings\n\n`;
    for (const finding of criticalFindings) {
      md += `### ${finding.title}\n\n`;
      md += `- **Impact**: ${finding.technical_impact}\n`;
      md += `- **Category**: ${finding.category}\n`;
      md += `- **Roadmap signal**: ${finding.roadmap_signal}\n`;
      md += `- **Action**: ${finding.action_required}\n`;
      md += `- **Source**: ${finding.source}\n\n`;
      md += `${finding.summary}\n\n`;
    }
  }

  // All action items
  if (allActionItems.length > 0) {
    md += `## Action Items\n\n`;
    for (const item of allActionItems) {
      md += `- ${item}\n`;
    }
    md += "\n";
  }

  // Per-harness summaries
  md += `## Per-Harness Summaries\n\n`;
  for (const report of reports) {
    md += `### ${report.harness} (${report.report_date})\n\n`;
    md += `${report.summary}\n\n`;
    if (report.findings.length > 0) {
      md += `**Findings (${report.findings.length}):**\n\n`;
      for (const finding of report.findings) {
        md += `- **${finding.title}** [${finding.technical_impact}] — ${finding.summary}\n`;
      }
      md += "\n";
    }
  }

  md += `---\n\n`;
  md += `*Generated by AgentBoot Intelligence Pipeline on ${new Date().toISOString()}*\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Strategic Analyst — LLM-powered synthesis (AB-141)
// ---------------------------------------------------------------------------

interface StrategicAnalysis {
  type: "strategic-analysis";
  report_date: string;
  cycle: string;
  harnesses_analyzed: string[];
  executive_summary: string;
  competitive_landscape: unknown[];
  roadmap_implications: unknown[];
  risk_flags: unknown[];
  marketing_signals: unknown[];
  feature_matrix_updates: unknown[];
  meta: Record<string, unknown>;
}

function buildStrategicPrompt(skillMd: string, reports: SmeReport[], cycle: string): string {
  const today = new Date().toISOString().split("T")[0];

  let reportsContent = "";
  for (const report of reports) {
    reportsContent += `\n--- HARNESS REPORT: ${report.harness} (${report.report_date}) ---\n`;
    reportsContent += JSON.stringify(report, null, 2);
    reportsContent += "\n\n";
  }

  return `You are the Strategic Analyst for AgentBoot. Today is ${today}. This is a ${cycle} intelligence cycle.

${skillMd}

## Per-Harness SME Reports

The following reports were produced by the per-harness SME personas. Analyze them
and produce your strategic analysis report.

${reportsContent}

## Task

Read all per-harness reports above and produce a JSON strategic analysis report
following the Output Format specified in your SKILL.md. The report should:

1. Synthesize findings across all harnesses into cross-cutting insights
2. Identify competitive landscape shifts
3. Flag roadmap implications with priority levels (urgent/strategic/monitor)
4. Assess risks to AgentBoot's model
5. Extract marketing and positioning signals
6. Note any feature matrix changes
7. If the per-harness reports contain no significant findings, produce a minimal report stating that

IMPORTANT: Output ONLY valid JSON matching the strategic analysis schema. No markdown fences, no explanation text outside the JSON.`;
}

function validateStrategicReport(data: unknown): data is StrategicAnalysis {
  if (typeof data !== "object" || data === null) return false;

  const report = data as Record<string, unknown>;
  if (report["type"] !== "strategic-analysis") return false;
  if (typeof report["report_date"] !== "string") return false;
  if (typeof report["executive_summary"] !== "string") return false;
  if (!Array.isArray(report["competitive_landscape"])) return false;
  if (!Array.isArray(report["roadmap_implications"])) return false;
  if (!Array.isArray(report["risk_flags"])) return false;
  if (!Array.isArray(report["marketing_signals"])) return false;
  if (!Array.isArray(report["feature_matrix_updates"])) return false;

  return true;
}

function runStrategicAnalyst(reports: SmeReport[], maxTokens: number, cycle: string): StrategicAnalysis | null {
  const skillPath = path.join(ROOT, "internal", "harness-sme", "strategic-analyst", "SKILL.md");

  if (!fs.existsSync(skillPath)) {
    console.error(`Error: Strategic Analyst SKILL.md not found at expected location`);
    return null;
  }

  const skillMd = fs.readFileSync(skillPath, "utf-8");
  const prompt = buildStrategicPrompt(skillMd, reports, cycle);

  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  console.log(`\nRunning Strategic Analyst...`);
  console.log(`  Input reports: ${reports.length}`);
  console.log(`  Max tokens: ${maxTokens}`);
  console.log(`  Estimated input tokens: ~${estimatedInputTokens}`);

  let rawOutput: string;
  try {
    const result = spawnSync("claude", [
      "-p", "--print",
      "--max-turns", "1",
      "--max-tokens", String(maxTokens),
      "--model", "opus",
    ], {
      input: prompt,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 180_000, // 3 minute timeout (strategic analysis is heavier)
      maxBuffer: 10 * 1024 * 1024,
    });
    // Check for spawn errors (timeout, ENOENT) before checking exit status
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const stderr = result.stderr?.trim() ?? "";
      throw new Error(stderr || `claude exited with code ${result.status}`);
    }
    rawOutput = (result.stdout ?? "").trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error invoking claude for strategic analysis: ${message}`);
    return null;
  }

  // Parse and validate
  try {
    let jsonStr = rawOutput;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!;
    }

    const parsed: unknown = JSON.parse(jsonStr);
    if (!validateStrategicReport(parsed)) {
      console.error("Error: Strategic Analyst output does not match expected schema");
      console.error("Raw output:", rawOutput.slice(0, 100));
      return null;
    }

    const estimatedOutputTokens = Math.ceil(rawOutput.length / 4);
    console.log(`  Strategic analysis complete`);
    console.log(`  Estimated total tokens: ~${estimatedInputTokens + estimatedOutputTokens}`);

    return parsed;
  } catch {
    console.error("Error: Strategic Analyst output is not valid JSON");
    console.error("Raw output:", rawOutput.slice(0, 100));
    return null;
  }
}

function formatStrategicDigest(analysis: StrategicAnalysis, mergeDigest: string): string {
  const today = new Date().toISOString().split("T")[0];

  let md = `# Strategic Intelligence Digest — ${today}\n\n`;
  md += `> **Status**: PENDING HUMAN REVIEW\n\n`;

  // Executive summary
  md += `## Executive Summary\n\n`;
  md += `${analysis.executive_summary}\n\n`;

  // Competitive landscape
  if (analysis.competitive_landscape.length > 0) {
    md += `## Competitive Landscape Changes\n\n`;
    for (const item of analysis.competitive_landscape as Array<Record<string, unknown>>) {
      md += `### ${item["signal"] ?? "Unknown"}\n\n`;
      md += `- **Nature**: ${item["nature"] ?? "unknown"}\n`;
      md += `- **Harnesses**: ${(item["harnesses_involved"] as string[] ?? []).join(", ")}\n`;
      md += `- **AgentBoot impact**: ${item["agentboot_impact"] ?? "unknown"}\n`;
      md += `- **Confidence**: ${item["confidence"] ?? "unknown"}\n\n`;
      md += `${item["detail"] ?? ""}\n\n`;
    }
  }

  // Roadmap implications
  const urgent = (analysis.roadmap_implications as Array<Record<string, unknown>>)
    .filter((r) => r["priority"] === "urgent");
  const strategic = (analysis.roadmap_implications as Array<Record<string, unknown>>)
    .filter((r) => r["priority"] === "strategic");

  if (urgent.length > 0) {
    md += `## Urgent Roadmap Items\n\n`;
    for (const item of urgent) {
      md += `- **${item["title"]}** — ${item["recommended_action"]} [${item["confidence"]}]\n`;
    }
    md += "\n";
  }

  if (strategic.length > 0) {
    md += `## Strategic Roadmap Items\n\n`;
    for (const item of strategic) {
      md += `- **${item["title"]}** — ${item["recommended_action"]} [${item["confidence"]}]\n`;
    }
    md += "\n";
  }

  // Risk flags
  const highRisks = (analysis.risk_flags as Array<Record<string, unknown>>)
    .filter((r) => r["severity"] === "high" || r["severity"] === "critical");
  if (highRisks.length > 0) {
    md += `## Risk Flags (High/Critical)\n\n`;
    for (const risk of highRisks) {
      md += `### ${risk["title"]} [${(risk["severity"] as string ?? "").toUpperCase()}]\n\n`;
      md += `- **Type**: ${risk["risk_type"]}\n`;
      md += `- **Harnesses**: ${(risk["harnesses_affected"] as string[] ?? []).join(", ")}\n`;
      md += `- **Mitigation**: ${risk["mitigation"]}\n\n`;
      md += `${risk["detail"]}\n\n`;
    }
  }

  // Marketing signals
  if (analysis.marketing_signals.length > 0) {
    md += `## Marketing Signals\n\n`;
    for (const signal of analysis.marketing_signals as Array<Record<string, unknown>>) {
      md += `- **${signal["signal"]}** [${signal["type"]}] — ${signal["detail"]} (${signal["actionability"]})\n`;
    }
    md += "\n";
  }

  // Meta
  const meta = analysis.meta;
  md += `## Analysis Meta\n\n`;
  md += `- **Findings ingested**: ${meta["total_findings_ingested"] ?? 0}\n`;
  md += `- **High/Critical findings**: ${meta["high_critical_findings"] ?? 0}\n`;
  md += `- **Analysis confidence**: ${meta["analysis_confidence"] ?? "unknown"}\n`;
  md += `- **Rationale**: ${meta["confidence_rationale"] ?? "n/a"}\n\n`;

  md += `---\n\n`;
  md += `## Per-Harness Detail\n\n`;
  md += `<details>\n<summary>Expand per-harness merge digest</summary>\n\n`;
  md += mergeDigest;
  md += `\n</details>\n\n`;

  md += `---\n\n`;
  md += `*Generated by AgentBoot Intelligence Pipeline (Strategic Analyst) on ${new Date().toISOString()}*\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.reports)) {
    console.error(`Error: reports directory not found: ${args.reports}`);
    process.exit(1);
  }

  const reportFiles = fs.readdirSync(args.reports).filter((f) => f.endsWith(".json"));

  if (reportFiles.length === 0) {
    console.error(`Error: no JSON report files found in ${args.reports}`);
    process.exit(1);
  }

  console.log(`Synthesizing ${reportFiles.length} reports from ${args.reports}...`);

  const reports: SmeReport[] = [];
  for (const file of reportFiles) {
    const filePath = path.join(args.reports, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SmeReport;
      reports.push(data);
      console.log(`  Loaded: ${file} (${data.harness}, ${data.findings.length} findings)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  Warning: could not parse ${file}: ${message}`);
    }
  }

  if (reports.length === 0) {
    console.error("Error: no valid reports could be loaded");
    process.exit(1);
  }

  // Always produce the merge-only digest as a baseline
  const mergeDigest = synthesizeReports(reports);

  let finalDigest: string;

  if (args.skipLlm) {
    console.log(`\nSkipping LLM-powered strategic analysis (--skip-llm)`);
    finalDigest = mergeDigest;
  } else {
    // Run the Strategic Analyst persona (AB-141)
    const analysis = runStrategicAnalyst(reports, args.maxTokens, args.cycle);

    if (analysis) {
      // Write the raw strategic analysis JSON alongside the digest
      const analysisJsonPath = args.output.replace(/\.md$/, ".strategic.json");
      fs.writeFileSync(analysisJsonPath, JSON.stringify(analysis, null, 2), "utf-8");
      console.log(`Wrote strategic analysis JSON to ${analysisJsonPath}`);

      finalDigest = formatStrategicDigest(analysis, mergeDigest);
    } else {
      console.warn("Warning: Strategic Analyst failed. Falling back to merge-only digest.");
      finalDigest = mergeDigest;
    }
  }

  // Write digest
  const outputDir = path.dirname(args.output);
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(args.output, finalDigest, "utf-8");
  console.log(`\nWrote digest to ${args.output}`);

  // Also write to intelligence/PENDING-REVIEW.md
  const pendingPath = path.join(ROOT, "intelligence", "PENDING-REVIEW.md");
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.writeFileSync(pendingPath, finalDigest, "utf-8");
  console.log(`Wrote copy to ${pendingPath}`);

  // Generate roadmap suggestions (AB-163)
  const suggestions = generateRoadmapSuggestions(reports);
  const roadmapPath = writeRoadmapSuggestions(suggestions, ROOT);
  console.log(`Wrote ${suggestions.length} roadmap suggestion(s) to ${roadmapPath}`);
}

// ---------------------------------------------------------------------------
// Roadmap Suggestions (AB-163)
// ---------------------------------------------------------------------------

export interface RoadmapSuggestion {
  title: string;
  rationale: string;
  evidence: string[];
  priority: "HIGH" | "MEDIUM" | "LOW";
  suggestedPhase: string;
  source: "telemetry" | "community" | "incident" | "trend";
}

/**
 * Extracts actionable roadmap suggestions from synthesis results.
 *
 * Scans findings for patterns that indicate improvements:
 * - High rephrase rates → persona needs calibration
 * - Repeated errors → new gotcha rule needed
 * - Missing coverage → new persona or trait needed
 * - Cost spikes → model optimization needed
 */
export function generateRoadmapSuggestions(reports: SmeReport[]): RoadmapSuggestion[] {
  const suggestions: RoadmapSuggestion[] = [];
  const allFindings = reports.flatMap((r) => r.findings);

  // Pattern 1: Critical/high impact findings → HIGH priority suggestions
  const criticalFindings = allFindings.filter(
    (f) => f.technical_impact === "critical" || f.technical_impact === "high",
  );
  for (const finding of criticalFindings) {
    suggestions.push({
      title: `Address: ${finding.title}`,
      rationale: `Finding with ${finding.technical_impact} technical impact requires attention. ${finding.roadmap_signal !== "no-change" ? `Roadmap signal: ${finding.roadmap_signal}.` : ""}`,
      evidence: [`[${finding.source}] ${finding.summary}`],
      priority: finding.technical_impact === "critical" ? "HIGH" : "MEDIUM",
      suggestedPhase: finding.action_required === "escalate" ? "current" : "next",
      source: categorizeSource(finding.category),
    });
  }

  // Pattern 2: Repeated categories across reports → systemic issue
  const categoryCount = new Map<string, Finding[]>();
  for (const finding of allFindings) {
    const existing = categoryCount.get(finding.category) ?? [];
    existing.push(finding);
    categoryCount.set(finding.category, existing);
  }
  for (const [category, findings] of categoryCount) {
    if (findings.length >= 2) {
      // Skip if we already created HIGH suggestions for all of these
      const nonCritical = findings.filter(
        (f) => f.technical_impact !== "critical" && f.technical_impact !== "high",
      );
      if (nonCritical.length > 0 || findings.length >= 3) {
        suggestions.push({
          title: `Recurring pattern: ${category}`,
          rationale: `Category "${category}" appeared ${findings.length} times across reports. Recurring patterns may indicate a need for a new gotcha rule or persona trait.`,
          evidence: findings.map((f) => `[${f.source}] ${f.title}: ${f.summary}`),
          priority: findings.length >= 3 ? "HIGH" : "MEDIUM",
          suggestedPhase: "next",
          source: "trend",
        });
      }
    }
  }

  // Pattern 3: Multiple action items from a single harness → coverage gap
  for (const report of reports) {
    if (report.top_action_items.length >= 3) {
      suggestions.push({
        title: `Coverage gap in ${report.harness} harness`,
        rationale: `${report.top_action_items.length} action items from a single harness suggest a coverage gap that may require a new persona or trait.`,
        evidence: report.top_action_items.map((item) => `[${report.harness}] ${item}`),
        priority: "MEDIUM",
        suggestedPhase: "next",
        source: "telemetry",
      });
    }
  }

  // Pattern 4: Reports with no findings from a harness that normally has them
  for (const report of reports) {
    if (report.findings.length === 0 && report.top_action_items.length === 0) {
      suggestions.push({
        title: `Silent harness: ${report.harness}`,
        rationale: `Harness "${report.harness}" produced no findings and no action items. This may indicate the harness is stale or its sources are no longer relevant.`,
        evidence: [`[${report.harness}] Zero findings on ${report.report_date}`],
        priority: "LOW",
        suggestedPhase: "backlog",
        source: "telemetry",
      });
    }
  }

  // Deduplicate by title (keep higher priority)
  const seen = new Map<string, RoadmapSuggestion>();
  const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  for (const s of suggestions) {
    const existing = seen.get(s.title);
    if (!existing || priorityOrder[s.priority]! < priorityOrder[existing.priority]!) {
      seen.set(s.title, s);
    }
  }

  // Sort by priority: HIGH > MEDIUM > LOW
  return [...seen.values()].sort(
    (a, b) => priorityOrder[a.priority]! - priorityOrder[b.priority]!,
  );
}

function categorizeSource(category: string): RoadmapSuggestion["source"] {
  if (category.includes("community") || category.includes("forum") || category.includes("discussion")) {
    return "community";
  }
  if (category.includes("incident") || category.includes("outage") || category.includes("breaking")) {
    return "incident";
  }
  if (category.includes("trend") || category.includes("pattern") || category.includes("signal")) {
    return "trend";
  }
  return "telemetry";
}

/**
 * Formats roadmap suggestions as a structured markdown document.
 */
export function formatRoadmapSuggestionsMd(suggestions: RoadmapSuggestion[]): string {
  const timestamp = new Date().toISOString();

  let md = `# Roadmap Suggestions\n\n`;
  md += `> Auto-generated by AgentBoot intelligence pipeline. **Human review required before acting on any suggestion.**\n`;
  md += `> Generated: ${timestamp}\n\n`;

  const groups: Record<string, RoadmapSuggestion[]> = { HIGH: [], MEDIUM: [], LOW: [] };
  for (const s of suggestions) {
    groups[s.priority]!.push(s);
  }

  for (const priority of ["HIGH", "MEDIUM", "LOW"] as const) {
    const items = groups[priority]!;
    if (items.length === 0) continue;

    md += `## ${priority} Priority\n\n`;
    for (const s of items) {
      md += `### ${s.title}\n`;
      md += `- **Rationale:** ${s.rationale}\n`;
      md += `- **Evidence:**\n`;
      for (const e of s.evidence) {
        md += `  - ${e}\n`;
      }
      md += `- **Suggested Phase:** ${s.suggestedPhase}\n`;
      md += `- **Source:** ${s.source}\n\n`;
    }
  }

  if (suggestions.length === 0) {
    md += `_No suggestions generated from current intelligence cycle._\n\n`;
  }

  md += `---\n\n`;
  md += `## Raw JSON\n\n`;
  md += "```json\n";
  md += JSON.stringify(suggestions, null, 2);
  md += "\n```\n";

  return md;
}

/**
 * Writes roadmap suggestions to docs/internal/plans/roadmap-suggestions.md.
 */
export function writeRoadmapSuggestions(suggestions: RoadmapSuggestion[], rootDir: string): string {
  const outputPath = path.join(rootDir, "docs", "internal", "plans", "roadmap-suggestions.md");
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const md = formatRoadmapSuggestionsMd(suggestions);
  fs.writeFileSync(outputPath, md, "utf-8");
  return outputPath;
}

export { synthesizeReports, buildStrategicPrompt, validateStrategicReport, runStrategicAnalyst };
export type { SmeReport as SynthSmeReport, Finding as SynthFinding, StrategicAnalysis };

// Only run main when invoked directly (not when imported for testing)
const isDirectRun = process.argv[1]?.replace(/\.ts$/, "").replace(/\.js$/, "")
  === fileURLToPath(import.meta.url).replace(/\.ts$/, "").replace(/\.js$/, "");
if (isDirectRun) {
  main();
}
