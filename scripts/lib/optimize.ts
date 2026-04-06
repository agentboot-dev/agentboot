/**
 * AB-153: Telemetry aggregation and cost analysis for AgentBoot.
 *
 * Reads structured NDJSON telemetry logs and produces cost analysis,
 * model recommendations, and coverage gap reports. No LLM calls —
 * pure aggregation and arithmetic.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  event: string;
  persona_id: string;
  model?: string;
  scope?: string;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  findings_count?: {
    CRITICAL?: number;
    ERROR?: number;
    WARN?: number;
    INFO?: number;
  };
  timestamp: string;
  status?: string;
  dev_id?: string;
  session_id?: string;
  build_version?: string;
  rephrased?: boolean;
}

export interface PersonaMetrics {
  personaId: string;
  scope: string;
  model: string;
  invocations: number;
  totalCostUsd: number;
  avgCostPerInvocation: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  findingsByLevel: Record<"CRITICAL" | "ERROR" | "WARN" | "INFO", number>;
  rephrasedCount: number;
  rephraseRate: number;
  avgDurationMs: number;
  lastInvoked: string;
}

export interface OptimizeOptions {
  since?: string | undefined;    // YYYY-MM-DD
  until?: string | undefined;    // YYYY-MM-DD
  scope?: string | undefined;    // e.g., "team:platform/*"
  report?: boolean | undefined;
  outputDir?: string | undefined;
}

// ---------------------------------------------------------------------------
// Model pricing (per 1M tokens, approximate)
// ---------------------------------------------------------------------------

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.80, output: 4.0 },
  // Fallback
  "default": { input: 3.0, output: 15.0 },
};

// ---------------------------------------------------------------------------
// Telemetry loading
// ---------------------------------------------------------------------------

const DEFAULT_TELEMETRY_DIR = path.join(os.homedir(), ".agentboot", "telemetry");

export function loadTelemetry(
  options: OptimizeOptions = {},
  telemetryDir: string = DEFAULT_TELEMETRY_DIR
): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];

  // Support both single file and daily files
  const legacyFile = telemetryDir + ".ndjson";
  const dailyDir = telemetryDir;

  const filesToRead: string[] = [];

  // Check for daily NDJSON files (YYYY-MM-DD.ndjson)
  if (fs.existsSync(dailyDir) && fs.statSync(dailyDir).isDirectory()) {
    const files = fs.readdirSync(dailyDir)
      .filter(f => f.endsWith(".ndjson"))
      .sort();

    for (const file of files) {
      const datePart = path.basename(file, ".ndjson");
      if (options.since && datePart < options.since) continue;
      if (options.until && datePart > options.until) continue;
      filesToRead.push(path.join(dailyDir, file));
    }
  }

  // Also check legacy single file
  if (fs.existsSync(legacyFile)) {
    filesToRead.push(legacyFile);
  }

  for (const filePath of filesToRead) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as TelemetryEvent;

          // Date filtering for legacy file
          if (options.since && event.timestamp < options.since + "T00:00:00Z") continue;
          if (options.until && event.timestamp > options.until + "T23:59:59Z") continue;

          // Scope filtering
          if (options.scope && (!event.scope || !matchScope(event.scope, options.scope))) continue;

          events.push(event);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return events;
}

function matchScope(eventScope: string, filterScope: string): boolean {
  if (filterScope.endsWith("/*")) {
    const prefix = filterScope.slice(0, -2);
    return eventScope.startsWith(prefix);
  }
  return eventScope === filterScope;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregateMetrics(events: TelemetryEvent[]): PersonaMetrics[] {
  // Filter to persona invocation events with "completed" status
  const invocations = events.filter(e =>
    e.event === "persona_invocation" && e.status === "completed"
  );

  // Group by persona x scope x model
  const groups = new Map<string, TelemetryEvent[]>();
  for (const event of invocations) {
    const key = `${event.persona_id}|${event.scope ?? "unknown"}|${event.model ?? "unknown"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }

  const metrics: PersonaMetrics[] = [];

  for (const [key, group] of groups) {
    const [personaId, scope, model] = key.split("|");

    const totalInputTokens = group.reduce((s, e) => s + (e.input_tokens ?? 0), 0);
    const totalOutputTokens = group.reduce((s, e) => s + (e.output_tokens ?? 0), 0);
    const totalDurationMs = group.reduce((s, e) => s + (e.duration_ms ?? 0), 0);
    const rephrasedCount = group.filter(e => e.rephrased).length;

    // Calculate cost
    const pricing = MODEL_PRICING[model!] ?? MODEL_PRICING["default"]!;
    const totalCostUsd = group.reduce((s, e) => {
      if (e.cost_usd !== undefined) return s + e.cost_usd;
      const inputCost = (e.input_tokens ?? 0) / 1_000_000 * pricing.input;
      const outputCost = (e.output_tokens ?? 0) / 1_000_000 * pricing.output;
      return s + inputCost + outputCost;
    }, 0);

    // Aggregate findings
    const findingsByLevel = { CRITICAL: 0, ERROR: 0, WARN: 0, INFO: 0 };
    for (const e of group) {
      if (e.findings_count) {
        findingsByLevel.CRITICAL += e.findings_count.CRITICAL ?? 0;
        findingsByLevel.ERROR += e.findings_count.ERROR ?? 0;
        findingsByLevel.WARN += e.findings_count.WARN ?? 0;
        findingsByLevel.INFO += e.findings_count.INFO ?? 0;
      }
    }

    const timestamps = group.map(e => e.timestamp).sort();

    metrics.push({
      personaId: personaId!,
      scope: scope!,
      model: model!,
      invocations: group.length,
      totalCostUsd,
      avgCostPerInvocation: totalCostUsd / group.length,
      totalInputTokens,
      totalOutputTokens,
      findingsByLevel,
      rephrasedCount,
      rephraseRate: rephrasedCount / group.length,
      avgDurationMs: totalDurationMs / group.length,
      lastInvoked: timestamps[timestamps.length - 1]!,
    });
  }

  // Sort by total cost descending
  return metrics.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export interface ModelRecommendation {
  personaId: string;
  currentModel: string;
  recommendedModel: string;
  projectedSavingsUsd: number;
  risk: string;
  rationale: string;
}

export function generateModelRecommendations(metrics: PersonaMetrics[]): ModelRecommendation[] {
  const recommendations: ModelRecommendation[] = [];

  // Group metrics by persona (aggregate across scopes for recommendation)
  const byPersona = new Map<string, PersonaMetrics[]>();
  for (const m of metrics) {
    if (!byPersona.has(m.personaId)) byPersona.set(m.personaId, []);
    byPersona.get(m.personaId)!.push(m);
  }

  for (const [personaId, personaMetrics] of byPersona) {
    const totalCost = personaMetrics.reduce((s, m) => s + m.totalCostUsd, 0);
    const totalInvocations = personaMetrics.reduce((s, m) => s + m.invocations, 0);
    const totalRephrased = personaMetrics.reduce((s, m) => s + m.rephrasedCount, 0);
    const avgRephraseRate = totalInvocations > 0 ? totalRephrased / totalInvocations : 0;
    const totalCritical = personaMetrics.reduce((s, m) => s + m.findingsByLevel.CRITICAL, 0);
    const primaryModel = personaMetrics[0]?.model ?? "unknown";

    // Recommend downgrade from Opus to Sonnet if:
    // - rephrase rate < 10% (quality is acceptable)
    // - cost savings significant
    if (primaryModel.includes("opus") && avgRephraseRate < 0.10) {
      const projectedSavings = totalCost * 0.7; // Sonnet ~70% cheaper than Opus
      const risk = totalCritical > 0
        ? `${totalCritical} CRITICAL findings may need Opus-level reasoning`
        : "Low risk — quality metrics support downgrade";

      recommendations.push({
        personaId,
        currentModel: primaryModel,
        recommendedModel: "claude-sonnet-4-6",
        projectedSavingsUsd: Math.round(projectedSavings * 100) / 100,
        risk,
        rationale: `Rephrase rate ${(avgRephraseRate * 100).toFixed(1)}% is below 10% threshold. ${totalInvocations} invocations.`,
      });
    }

    // Recommend upgrade from Haiku to Sonnet if rephrase rate > 20%
    if (primaryModel.includes("haiku") && avgRephraseRate > 0.20) {
      recommendations.push({
        personaId,
        currentModel: primaryModel,
        recommendedModel: "claude-sonnet-4-6",
        projectedSavingsUsd: 0, // This is an upgrade, not a saving
        risk: "Quality improvement — higher rephrase rate indicates Haiku may be insufficient",
        rationale: `Rephrase rate ${(avgRephraseRate * 100).toFixed(1)}% exceeds 20% threshold.`,
      });
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Coverage analysis
// ---------------------------------------------------------------------------

export interface CoverageGap {
  scope: string;
  persona: string;
  message: string;
}

export function analyzeCoverage(
  metrics: PersonaMetrics[],
  enabledPersonas: string[],
  knownScopes: string[]
): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  const coveredPairs = new Set(
    metrics.map(m => `${m.scope}:${m.personaId}`)
  );

  for (const scope of knownScopes) {
    for (const persona of enabledPersonas) {
      if (!coveredPairs.has(`${scope}:${persona}`)) {
        gaps.push({
          scope,
          persona,
          message: `${scope} has 0 ${persona} invocations in the analysis period`,
        });
      }
    }
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

export function printOptimizeReport(
  metrics: PersonaMetrics[],
  recommendations: ModelRecommendation[],
  gaps: CoverageGap[],
  _options: OptimizeOptions
): void {
  const totalCost = metrics.reduce((s, m) => s + m.totalCostUsd, 0);
  const totalInvocations = metrics.reduce((s, m) => s + m.invocations, 0);

  console.log(chalk.bold(`\nAnalyzing ${totalInvocations} invocations...\n`));

  // Cost table
  console.log(chalk.bold("=== Cost Analysis ===\n"));
  console.log(`Total cost: ${chalk.bold("$" + totalCost.toFixed(2))}\n`);

  if (metrics.length > 0) {
    console.log("Top personas by cost:\n");
    const topN = metrics.slice(0, 10);
    for (let i = 0; i < topN.length; i++) {
      const m = topN[i]!;
      const pct = totalCost > 0 ? ((m.totalCostUsd / totalCost) * 100).toFixed(0) : "0";
      const model = m.model.replace("claude-", "").replace(/-\d+$/, "");
      console.log(
        `  ${(i + 1).toString().padStart(2)}. ${m.personaId.padEnd(25)} ${model.padEnd(10)} $${m.totalCostUsd.toFixed(2).padStart(8)} (${pct}%)    ${m.scope}`
      );
    }
  }

  // Model recommendations
  if (recommendations.length > 0) {
    console.log(chalk.bold("\n=== Model Recommendations ===\n"));
    for (const rec of recommendations) {
      const arrow = `${rec.currentModel.replace("claude-", "")} -> ${rec.recommendedModel.replace("claude-", "")}`;
      const savings = rec.projectedSavingsUsd > 0
        ? chalk.green(`could save ~$${rec.projectedSavingsUsd}/mo`)
        : chalk.yellow("quality upgrade (cost increase)");
      console.log(`  ${rec.personaId}: ${arrow} ${savings}`);
      console.log(chalk.gray(`    ${rec.rationale}`));
      console.log(chalk.gray(`    Risk: ${rec.risk}`));
      console.log();
    }
  }

  // Coverage gaps
  if (gaps.length > 0) {
    console.log(chalk.bold("=== Coverage Gaps ===\n"));
    for (const gap of gaps.slice(0, 10)) {
      console.log(chalk.yellow(`  ${gap.message}`));
    }
    if (gaps.length > 10) {
      console.log(chalk.gray(`  ... and ${gaps.length - 10} more gaps`));
    }
  }
}

// ---------------------------------------------------------------------------
// HTML Report generation
// ---------------------------------------------------------------------------

export function generateHtmlReport(
  metrics: PersonaMetrics[],
  recommendations: ModelRecommendation[],
  gaps: CoverageGap[],
  _options: OptimizeOptions,
  version: string = "0.9.0"
): string {
  const totalCost = metrics.reduce((s, m) => s + m.totalCostUsd, 0);
  const totalInvocations = metrics.reduce((s, m) => s + m.invocations, 0);
  const date = new Date().toISOString().split("T")[0];

  // Build cost bar chart SVG
  const maxCost = metrics.length > 0 ? metrics[0]!.totalCostUsd : 1;
  const barHeight = 30;
  const barGap = 5;
  const chartWidth = 600;
  const labelWidth = 200;
  const topN = metrics.slice(0, 10);
  const chartHeight = topN.length * (barHeight + barGap) + 20;

  let barsSvg = "";
  for (let i = 0; i < topN.length; i++) {
    const m = topN[i]!;
    const y = i * (barHeight + barGap);
    const barW = maxCost > 0 ? (m.totalCostUsd / maxCost) * (chartWidth - labelWidth - 80) : 0;
    const color = m.model.includes("opus") ? "#e74c3c" : m.model.includes("haiku") ? "#2ecc71" : "#3498db";
    barsSvg += `<text x="0" y="${y + 20}" font-size="12" fill="#333">${escapeHtml(m.personaId)}</text>`;
    barsSvg += `<rect x="${labelWidth}" y="${y}" width="${barW}" height="${barHeight}" fill="${color}" rx="3"/>`;
    barsSvg += `<text x="${labelWidth + barW + 5}" y="${y + 20}" font-size="11" fill="#666">$${m.totalCostUsd.toFixed(2)}</text>`;
  }

  const costChart = `<svg width="${chartWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg">${barsSvg}</svg>`;

  // Build recommendations HTML
  let recsHtml = "";
  for (const rec of recommendations) {
    recsHtml += `<div style="margin:10px 0;padding:10px;background:#f8f9fa;border-radius:4px;">
      <strong>${escapeHtml(rec.personaId)}</strong>: ${escapeHtml(rec.currentModel)} -> ${escapeHtml(rec.recommendedModel)}
      ${rec.projectedSavingsUsd > 0 ? `<span style="color:green;"> (save ~$${rec.projectedSavingsUsd}/mo)</span>` : ""}
      <p style="color:#666;margin:4px 0;">${escapeHtml(rec.rationale)}</p>
      <p style="color:#999;margin:4px 0;">Risk: ${escapeHtml(rec.risk)}</p>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentBoot Optimize Report — ${date}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    .summary { display: flex; gap: 20px; margin: 20px 0; }
    .stat { background: #f0f4f8; padding: 15px 25px; border-radius: 8px; text-align: center; }
    .stat .value { font-size: 2em; font-weight: bold; }
    .stat .label { color: #666; font-size: 0.9em; }
    .legend { display: flex; gap: 15px; margin: 10px 0; }
    .legend span { display: flex; align-items: center; gap: 5px; font-size: 0.85em; }
    .legend .dot { width: 12px; height: 12px; border-radius: 50%; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; }
    .gap { color: #e67e22; padding: 4px 0; }
    footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #ddd; color: #999; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>AgentBoot Optimize Report</h1>
  <p style="color:#666;">Generated: ${new Date().toISOString()} | Period: last 30 days</p>

  <div class="summary">
    <div class="stat"><div class="value">$${totalCost.toFixed(2)}</div><div class="label">Total Cost</div></div>
    <div class="stat"><div class="value">${totalInvocations}</div><div class="label">Invocations</div></div>
    <div class="stat"><div class="value">${metrics.length}</div><div class="label">Persona x Scope Combos</div></div>
    <div class="stat"><div class="value">${recommendations.length}</div><div class="label">Recommendations</div></div>
  </div>

  <h2>Cost Breakdown</h2>
  <div class="legend">
    <span><span class="dot" style="background:#e74c3c;"></span> Opus</span>
    <span><span class="dot" style="background:#3498db;"></span> Sonnet</span>
    <span><span class="dot" style="background:#2ecc71;"></span> Haiku</span>
  </div>
  ${costChart}

  <h2>Detailed Metrics</h2>
  <table>
    <tr><th>Persona</th><th>Model</th><th>Invocations</th><th>Cost</th><th>Rephrase Rate</th><th>Avg Duration</th></tr>
    ${metrics.map(m => `<tr>
      <td>${escapeHtml(m.personaId)}</td>
      <td>${escapeHtml(m.model.replace("claude-", ""))}</td>
      <td>${m.invocations}</td>
      <td>$${m.totalCostUsd.toFixed(2)}</td>
      <td>${(m.rephraseRate * 100).toFixed(1)}%</td>
      <td>${(m.avgDurationMs / 1000).toFixed(1)}s</td>
    </tr>`).join("")}
  </table>

  ${recommendations.length > 0 ? `<h2>Recommendations</h2>${recsHtml}` : ""}

  ${gaps.length > 0 ? `<h2>Coverage Gaps</h2>${gaps.map(g => `<p class="gap">Warning: ${escapeHtml(g.message)}</p>`).join("")}` : ""}

  <footer>Generated by AgentBoot v${version} — <a href="https://agentboot.dev">agentboot.dev</a></footer>
</body>
</html>`;
}
