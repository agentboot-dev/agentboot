/**
 * AB-154: LLM-powered trait weight recommendations.
 * AB-155: Apply workflow for writing recommendations to persona.config.json.
 */

import fs from "node:fs";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeightRecommendation {
  trait: string;
  current: string;
  recommended: string;
  rationale: string;
}

export interface PersonaWeightAnalysis {
  personaId: string;
  recommendations: WeightRecommendation[];
  summary: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  llmCostUsd: number;
}

// ---------------------------------------------------------------------------
// Weight label mapping
// ---------------------------------------------------------------------------

const WEIGHT_LABELS: Record<number, string> = {
  0.0: "OFF", 0.3: "LOW", 0.5: "MEDIUM", 0.7: "HIGH", 1.0: "MAX",
};

const LABEL_TO_WEIGHT: Record<string, number> = {
  OFF: 0.0, LOW: 0.3, MEDIUM: 0.5, HIGH: 0.7, MAX: 1.0,
};

export function weightToLabel(weight: number): string {
  return WEIGHT_LABELS[weight] ?? `${weight}`;
}

export function labelToWeight(label: string): number {
  return LABEL_TO_WEIGHT[label.toUpperCase()] ?? 0.5;
}

// ---------------------------------------------------------------------------
// Recommendation prompt construction
// ---------------------------------------------------------------------------

export function buildRecommendationPrompt(
  personaId: string,
  personaDescription: string,
  traitWeights: Record<string, string>,
  traitDefinitions: Record<string, string>,
  metrics: { invocations: number; rephraseRate: number; findings: Record<string, number>; avgTokens: number }
): string {
  const weightsYaml = Object.entries(traitWeights).map(([n, w]) => `  ${n}: ${w}`).join("\n");
  const defs = Object.entries(traitDefinitions).map(([n, d]) => `  ${n}: ${d}`).join("\n");

  return `You are a persona calibration analyst reviewing trait weights.

PERSONA: ${personaId}
DESCRIPTION: ${personaDescription}

CURRENT TRAIT WEIGHTS:
${weightsYaml}

TRAIT DEFINITIONS:
${defs}

PERFORMANCE METRICS (last 30 days):
- Invocations: ${metrics.invocations}
- Rephrase rate: ${(metrics.rephraseRate * 100).toFixed(1)}% (above 15% = needs calibration)
- Finding distribution: CRITICAL=${metrics.findings["CRITICAL"] ?? 0}, ERROR=${metrics.findings["ERROR"] ?? 0}, WARN=${metrics.findings["WARN"] ?? 0}, INFO=${metrics.findings["INFO"] ?? 0}
- Average tokens per invocation: ${metrics.avgTokens}

CALIBRATION GUIDANCE:
- HIGH = full trait enforcement, prominent in output
- MEDIUM = present but not dominant
- LOW = activated only when directly relevant
- MAX = maximum intensity (use sparingly)
- OFF = trait excluded

Respond with JSON only:
{
  "recommendations": [{ "trait": "name", "current": "HIGH", "recommended": "MEDIUM", "rationale": "..." }],
  "summary": "One-sentence summary",
  "confidence": "HIGH|MEDIUM|LOW"
}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function parseRecommendationResponse(text: string): {
  recommendations: WeightRecommendation[];
  summary: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
} | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.recommendations)) return null;

    const validLevels = ["HIGH", "MEDIUM", "LOW", "MAX", "OFF"];
    const recs: WeightRecommendation[] = parsed.recommendations
      .filter((r: Record<string, unknown>) => r["trait"] && r["current"] && r["recommended"] && r["rationale"])
      .map((r: Record<string, unknown>) => ({
        trait: r["trait"] as string,
        current: validLevels.includes((r["current"] as string).toUpperCase()) ? (r["current"] as string).toUpperCase() : r["current"] as string,
        recommended: validLevels.includes((r["recommended"] as string).toUpperCase()) ? (r["recommended"] as string).toUpperCase() : r["recommended"] as string,
        rationale: r["rationale"] as string,
      }));

    const confidence = ["HIGH", "MEDIUM", "LOW"].includes(parsed.confidence?.toUpperCase())
      ? parsed.confidence.toUpperCase() as "HIGH" | "MEDIUM" | "LOW"
      : "MEDIUM" as const;

    return { recommendations: recs, summary: parsed.summary ?? "", confidence };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

export function printWeightDiff(
  personaId: string,
  recommendations: WeightRecommendation[],
  summary: string,
  confidence: string
): void {
  console.log(chalk.bold(`\nWeight Recommendations for ${personaId}:\n`));
  for (const rec of recommendations) {
    const changed = rec.current !== rec.recommended;
    const arrow = `${rec.current} → ${rec.recommended}`;
    const marker = changed ? chalk.yellow("← suggested") : chalk.gray("(no change)");
    console.log(`  ${rec.trait.padEnd(25)} ${arrow.padEnd(20)} ${marker}`);
    if (changed) console.log(chalk.gray(`    ${rec.rationale}`));
  }
  console.log(chalk.gray(`\nSummary: ${summary}`));
  console.log(chalk.gray(`Confidence: ${confidence}`));
}

// ---------------------------------------------------------------------------
// Apply changes to persona.config.json
// ---------------------------------------------------------------------------

export function applyWeightChanges(
  personaConfigPath: string,
  recommendations: WeightRecommendation[]
): { changed: boolean; diff: string[] } {
  if (!fs.existsSync(personaConfigPath)) {
    return { changed: false, diff: ["Config file not found"] };
  }
  const config = JSON.parse(fs.readFileSync(personaConfigPath, "utf-8"));
  const diff: string[] = [];
  let changed = false;

  if (!config.traits || typeof config.traits !== "object" || Array.isArray(config.traits)) {
    return { changed: false, diff: ["Traits must be weight-object format"] };
  }

  for (const rec of recommendations) {
    if (rec.current === rec.recommended) continue;
    if (config.traits[rec.trait] !== undefined) {
      diff.push(`${rec.trait}: ${rec.current} → ${rec.recommended}`);
      config.traits[rec.trait] = rec.recommended;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(personaConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  return { changed, diff };
}
