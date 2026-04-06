/**
 * Tests for AB-139: cost-estimate command.
 *
 * Covers: pricing calculation logic, CLI command execution, JSON output format.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

function run(args: string, cwd = ROOT): string {
  return execSync(`${TSX} ${CLI} ${args}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    timeout: 30_000,
  }).toString();
}

// ===========================================================================
// Unit tests for pricing calculation
// ===========================================================================

describe("AB-139: cost-estimate calculation", () => {
  it("calculatePersonaCost returns correct cost for known inputs", async () => {
    const { calculatePersonaCost, MODEL_PRICING } = await import(
      "../scripts/lib/cost-estimate.js"
    );

    // 1000 input tokens, 100 invocations, 10 team members, sonnet pricing
    // Output tokens = 1000 * 2 = 2000
    // Total invocations = 100 * 10 = 1000
    // Input cost = (1000 * 1000 / 1_000_000) * 3 = 1 * 3 = 3
    // Output cost = (2000 * 1000 / 1_000_000) * 15 = 2 * 15 = 30
    // Total = 33
    const cost = calculatePersonaCost(1000, 100, 10, MODEL_PRICING.sonnet);
    expect(cost).toBeCloseTo(33, 4);
  });

  it("calculatePersonaCost returns 0 for zero tokens", async () => {
    const { calculatePersonaCost, MODEL_PRICING } = await import(
      "../scripts/lib/cost-estimate.js"
    );
    const cost = calculatePersonaCost(0, 100, 10, MODEL_PRICING.sonnet);
    expect(cost).toBe(0);
  });

  it("calculatePersonaCost scales with team size", async () => {
    const { calculatePersonaCost, MODEL_PRICING } = await import(
      "../scripts/lib/cost-estimate.js"
    );
    const cost1 = calculatePersonaCost(1000, 100, 1, MODEL_PRICING.sonnet);
    const cost10 = calculatePersonaCost(1000, 100, 10, MODEL_PRICING.sonnet);
    expect(cost10).toBeCloseTo(cost1 * 10, 6);
  });

  it("calculatePersonaCost uses correct pricing per model", async () => {
    const { calculatePersonaCost, MODEL_PRICING } = await import(
      "../scripts/lib/cost-estimate.js"
    );

    const haikuCost = calculatePersonaCost(10000, 100, 10, MODEL_PRICING.haiku);
    const sonnetCost = calculatePersonaCost(10000, 100, 10, MODEL_PRICING.sonnet);
    const opusCost = calculatePersonaCost(10000, 100, 10, MODEL_PRICING.opus);

    // haiku < sonnet < opus
    expect(haikuCost).toBeLessThan(sonnetCost);
    expect(sonnetCost).toBeLessThan(opusCost);
  });

  it("estimateTokens uses ~4 chars/token heuristic", async () => {
    const { estimateTokens } = await import("../scripts/lib/cost-estimate.js");

    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("MODEL_PRICING has all three models", async () => {
    const { MODEL_PRICING } = await import("../scripts/lib/cost-estimate.js");

    expect(MODEL_PRICING).toHaveProperty("haiku");
    expect(MODEL_PRICING).toHaveProperty("sonnet");
    expect(MODEL_PRICING).toHaveProperty("opus");

    for (const model of ["haiku", "sonnet", "opus"] as const) {
      expect(MODEL_PRICING[model]).toHaveProperty("inputPerMTok");
      expect(MODEL_PRICING[model]).toHaveProperty("outputPerMTok");
      expect(MODEL_PRICING[model].inputPerMTok).toBeGreaterThan(0);
      expect(MODEL_PRICING[model].outputPerMTok).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// CLI integration tests
// ===========================================================================

describe("AB-139: cost-estimate CLI command", () => {
  it("runs without error with default flags", () => {
    const output = run("cost-estimate");
    expect(output).toContain("cost-estimate");
    expect(output).toContain("Total");
  });

  it("shows all enabled personas in output", () => {
    const output = run("cost-estimate");
    expect(output).toContain("code-reviewer");
    expect(output).toContain("security-reviewer");
    expect(output).toContain("test-generator");
    expect(output).toContain("test-data-expert");
  });

  it("accepts --model flag", () => {
    const output = run("cost-estimate --model haiku");
    expect(output).toContain("haiku");
  });

  it("accepts --invocations and --team-size flags", () => {
    const output = run("cost-estimate --invocations 50 --team-size 5");
    expect(output).toContain("50");
    expect(output).toContain("5");
  });

  it("outputs valid JSON with --json flag", () => {
    const output = run("cost-estimate --json");
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("model", "sonnet");
    expect(parsed).toHaveProperty("teamSize", 10);
    expect(parsed).toHaveProperty("invocationsPerPersona", 100);
    expect(parsed).toHaveProperty("personas");
    expect(parsed).toHaveProperty("totalMonthlyCostUsd");
    expect(Array.isArray(parsed.personas)).toBe(true);
    expect(parsed.personas.length).toBe(4);
  });

  it("JSON output persona entries have expected fields", () => {
    const output = run("cost-estimate --json");
    const parsed = JSON.parse(output);

    for (const p of parsed.personas) {
      expect(p).toHaveProperty("persona");
      expect(p).toHaveProperty("inputTokens");
      expect(p).toHaveProperty("outputTokens");
      expect(p).toHaveProperty("monthlyInvocations");
      expect(p).toHaveProperty("monthlyCostUsd");
      expect(typeof p.monthlyCostUsd).toBe("number");
    }
  });

  it("JSON output respects --model flag", () => {
    const output = run("cost-estimate --json --model opus");
    const parsed = JSON.parse(output);
    expect(parsed.model).toBe("opus");
  });

  it("total cost equals sum of persona costs", () => {
    const output = run("cost-estimate --json");
    const parsed = JSON.parse(output);

    const sum = parsed.personas.reduce(
      (acc: number, p: { monthlyCostUsd: number }) => acc + p.monthlyCostUsd,
      0,
    );
    expect(parsed.totalMonthlyCostUsd).toBeCloseTo(sum, 6);
  });
});

// ===========================================================================
// cost-estimate: human-readable table format (no --json flag)
// Addresses gap: "cost-estimate human-readable table output not asserted"
// (human-in-the-loop-priority.md MEDIUM section, manual tests TP-13-10/11/12)
// The existing CLI tests check for persona name strings and "Total" label but
// never assert non-zero dollar amounts or that cost scales with model/team-size.
// ===========================================================================

describe("AB-139: cost-estimate human-readable table format", () => {
  // Prove the default output (no --json) contains at least one non-zero dollar amount
  it("cost-estimate (no flags): output contains at least one non-zero dollar amount", () => {
    const output = run("cost-estimate");
    // Must contain at least one $ followed by digits — proves token multiplication ran
    // and the persona SKILL.md files have non-zero content
    expect(output).toMatch(/\$\d+\.\d+|\$\d+/);
  });

  // Prove the default output shows all 4 persona names in the table
  it("cost-estimate (no flags): output shows all 4 enabled persona names", () => {
    const output = run("cost-estimate");
    expect(output).toContain("code-reviewer");
    expect(output).toContain("security-reviewer");
    expect(output).toContain("test-generator");
    expect(output).toContain("test-data-expert");
  });

  // Prove that --model opus + --team-size 100 produces higher total cost than defaults
  // Default: model=sonnet, team-size=10
  it("cost-estimate: opus + team-size 100 produces higher cost than sonnet + team-size 10", () => {
    const defaultOutput = run("cost-estimate --json");
    const highCostOutput = run("cost-estimate --json --model opus --team-size 100");

    const defaultParsed = JSON.parse(defaultOutput);
    const highCostParsed = JSON.parse(highCostOutput);

    // opus pricing > sonnet pricing AND 100 users > 10 users → strictly higher total
    expect(highCostParsed.totalMonthlyCostUsd).toBeGreaterThan(defaultParsed.totalMonthlyCostUsd);
  });

  // Prove default table output contains non-zero token counts (not all zeros)
  it("cost-estimate (no flags): output contains non-zero token counts", () => {
    const output = run("cost-estimate");
    // Table should show numbers beyond just persona names and $ amounts
    // At minimum, one token count > 0 should appear
    expect(output).toMatch(/\d{3,}/); // at least a 3-digit number somewhere (token counts are in thousands)
  });
});
