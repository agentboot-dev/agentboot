/**
 * Cost estimation logic for AgentBoot personas.
 *
 * Calculates projected monthly costs per persona based on token counts,
 * invocation frequency, team size, and model pricing.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelName = "haiku" | "sonnet" | "opus";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface PersonaCostEstimate {
  persona: string;
  inputTokens: number;
  outputTokens: number;
  monthlyInvocations: number;
  monthlyCostUsd: number;
}

export interface CostEstimateResult {
  model: ModelName;
  teamSize: number;
  invocationsPerPersona: number;
  personas: PersonaCostEstimate[];
  totalMonthlyCostUsd: number;
}

// ---------------------------------------------------------------------------
// Pricing data (per million tokens)
// ---------------------------------------------------------------------------

export const MODEL_PRICING: Record<ModelName, ModelPricing> = {
  haiku:  { inputPerMTok: 0.25,  outputPerMTok: 1.25 },
  sonnet: { inputPerMTok: 3.0,   outputPerMTok: 15.0 },
  opus:   { inputPerMTok: 15.0,  outputPerMTok: 75.0 },
};

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

/**
 * Estimate the token count of a text using the ~4 chars/token heuristic.
 * This matches the approach used by the lint command.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the monthly cost for a single persona.
 *
 * @param inputTokens - tokens per invocation (from the SKILL.md content)
 * @param invocations - invocations per month per team member
 * @param teamSize - number of team members
 * @param pricing - model pricing data
 * @param outputMultiplier - ratio of output tokens to input tokens (default: 2x)
 */
export function calculatePersonaCost(
  inputTokens: number,
  invocations: number,
  teamSize: number,
  pricing: ModelPricing,
  outputMultiplier = 2,
): number {
  const outputTokens = inputTokens * outputMultiplier;
  const totalInvocations = invocations * teamSize;

  const inputCost = (inputTokens * totalInvocations / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens * totalInvocations / 1_000_000) * pricing.outputPerMTok;

  return inputCost + outputCost;
}

/**
 * Read compiled SKILL.md files and estimate costs for all enabled personas.
 */
export function estimateCosts(opts: {
  distPath: string;
  enabledPersonas: string[];
  model: ModelName;
  invocations: number;
  teamSize: number;
}): CostEstimateResult {
  const { distPath, enabledPersonas, model, invocations, teamSize } = opts;
  const pricing = MODEL_PRICING[model];
  const personas: PersonaCostEstimate[] = [];

  for (const persona of enabledPersonas) {
    const skillPath = path.join(distPath, "skill", "core", persona, "SKILL.md");
    let inputTokens = 0;

    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, "utf-8");
      inputTokens = estimateTokens(content);
    }

    const outputTokens = inputTokens * 2;
    const monthlyInvocations = invocations * teamSize;
    const monthlyCostUsd = calculatePersonaCost(inputTokens, invocations, teamSize, pricing);

    personas.push({
      persona,
      inputTokens,
      outputTokens,
      monthlyInvocations,
      monthlyCostUsd,
    });
  }

  const totalMonthlyCostUsd = personas.reduce((sum, p) => sum + p.monthlyCostUsd, 0);

  return {
    model,
    teamSize,
    invocationsPerPersona: invocations,
    personas,
    totalMonthlyCostUsd,
  };
}
