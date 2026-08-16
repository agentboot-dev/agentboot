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
  /**
   * R4-3: did this persona's size actually get MEASURED?
   *
   * `false` means the number beside it is a placeholder, not a finding. A
   * `monthlyCostUsd: 0` that means "we could not look" and a `monthlyCostUsd: 0`
   * that means "this persona is free" are different facts, and the JSON output
   * had no way to tell them apart.
   */
  measured: boolean;
}

export interface CostEstimateResult {
  model: ModelName;
  teamSize: number;
  invocationsPerPersona: number;
  personas: PersonaCostEstimate[];
  totalMonthlyCostUsd: number;
  /** Personas whose size could not be read from dist/. Empty on a healthy hub. */
  unmeasured: string[];
  /** Where the sizes came from, so the number is attributable. */
  source: "persona-sizes.json" | "skill/SKILL.md" | "none";
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
 * R4-3: per-persona size, measured from the COMPOSED persona.
 *
 * This function used to be `fs.existsSync(dist/skill/core/<p>/SKILL.md)` with an
 * empty else, and `skill` is one of ten output formats. On any hub that does not
 * build `skill` the file does not exist, so every persona measured 0 and the
 * command reported, exit 0, with no diagnostic:
 *
 *     outputFormats [skill,claude,copilot]  Total $1230.80  (10244/11358/7941/7754 tokens)
 *     outputFormats [claude,copilot]        Total    $0.00  (0/0/0/0 tokens)
 *
 * `--json` was worse: `"totalMonthlyCostUsd": 0` with no marker at all.
 *
 * This is NF3-3 verbatim, one file over — the token-budget gate had the same
 * `dist/skill/.../SKILL.md`-behind-an-existsSync shape and was fixed by measuring
 * the composed persona instead. `dist/persona-sizes.json` is the artifact that
 * fix produced: platform-independent, written by every successful build, and
 * already the estimate the build itself reports. Use it, fall back to SKILL.md
 * for a pre-N1 tree, and NAME what could not be measured.
 */
function readPersonaSizes(distPath: string): Record<string, number> | null {
  const p = path.join(distPath, "persona-sizes.json");
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as { personas?: unknown };
    const personas = parsed.personas;
    if (!personas || typeof personas !== "object" || Array.isArray(personas)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(personas as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    // Unreadable is not "zero tokens" — fall through to the SKILL.md path and,
    // failing that, report the persona as unmeasured.
    return null;
  }
}

/**
 * Read the compiled persona sizes and estimate costs for all enabled personas.
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
  const unmeasured: string[] = [];

  const sizes = readPersonaSizes(distPath);
  let source: CostEstimateResult["source"] = sizes ? "persona-sizes.json" : "none";

  for (const persona of enabledPersonas) {
    let inputTokens = sizes?.[persona] ?? 0;

    if (inputTokens === 0) {
      // Fallback for a dist/ built before persona-sizes.json carried this
      // persona. Still platform-bound, so it is the fallback and not the source.
      const skillPath = path.join(distPath, "skill", "core", persona, "SKILL.md");
      if (fs.existsSync(skillPath)) {
        inputTokens = estimateTokens(fs.readFileSync(skillPath, "utf-8"));
        if (inputTokens > 0 && source !== "persona-sizes.json") source = "skill/SKILL.md";
      }
    }

    const measured = inputTokens > 0;
    if (!measured) unmeasured.push(persona);

    const outputTokens = inputTokens * 2;
    const monthlyInvocations = invocations * teamSize;
    const monthlyCostUsd = calculatePersonaCost(inputTokens, invocations, teamSize, pricing);

    personas.push({
      persona,
      inputTokens,
      outputTokens,
      monthlyInvocations,
      monthlyCostUsd,
      measured,
    });
  }

  const totalMonthlyCostUsd = personas.reduce((sum, p) => sum + p.monthlyCostUsd, 0);

  return {
    model,
    teamSize,
    invocationsPerPersona: invocations,
    personas,
    totalMonthlyCostUsd,
    unmeasured,
    source,
  };
}
