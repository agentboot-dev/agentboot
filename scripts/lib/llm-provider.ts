/**
 * LLM provider abstraction for AgentBoot.
 *
 * Abstracts the LLM backend so import and classification work with
 * different providers or no LLM at all.
 *
 * Providers:
 *   - ClaudeCodeProvider: uses `claude -p` (default, requires CC login)
 *   - ManualProvider: zero-LLM fallback, writes empty staging for manual fill
 *
 * Future (Phase 6):
 *   - AnthropicAPIProvider: direct Anthropic API via fetch
 *   - OpenAIAPIProvider: direct OpenAI API via fetch
 *   - GoogleAPIProvider: direct Google Gemini API via fetch
 */

import { spawnSync } from "node:child_process";
import chalk from "chalk";
import type { AgentBootConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  /** Raw JSON output from the LLM, parsed. */
  data: unknown;
  /** Token usage if available. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Cost in USD if available. */
  costUsd?: number;
}

export interface LLMProvider {
  /** Human-readable name for logging. */
  readonly name: string;

  /** Check if this provider is available (CLI installed, API key set, etc.). */
  isAvailable(): boolean;

  /** Human-readable reason why the provider is unavailable. */
  unavailableReason(): string;

  /**
   * Send a prompt with a JSON schema constraint and return structured output.
   * Returns null on failure (provider logs the error).
   */
  classify(prompt: string, jsonSchema: string): ClassificationResult | null;
}

// ---------------------------------------------------------------------------
// ClaudeCodeProvider — wraps `claude -p`
// ---------------------------------------------------------------------------

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = "Claude Code (claude -p)";

  isAvailable(): boolean {
    try {
      const version = spawnSync("claude", ["--version"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      if (version.status !== 0) return false;
      const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return auth.status === 0;
    } catch {
      return false;
    }
  }

  unavailableReason(): string {
    try {
      const version = spawnSync("claude", ["--version"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      if (version.status !== 0) return "Claude Code is not installed. Install from https://claude.ai/code";
    } catch {
      return "Claude Code is not installed. Install from https://claude.ai/code";
    }
    return "Claude Code is not logged in. Run: claude auth login";
  }

  classify(prompt: string, jsonSchema: string): ClassificationResult | null {
    // Pass prompt via stdin to avoid OS arg length limits and process listing exposure.
    // claude -p reads from stdin when given "-" as the prompt argument.
    const result = spawnSync("claude", [
      "-p", "-",
      "--output-format", "json",
      "--json-schema", jsonSchema,
      "--max-turns", "10",
    ], {
      input: prompt,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });

    // Show LLM response
    console.log(chalk.cyan("  ── LLM response ────────────────────────────────────────"));

    if (result.status !== 0) {
      const stderr = result.stderr?.trim() ?? "";
      const stdout = result.stdout?.trim() ?? "";
      const combined = stderr + " " + stdout;

      if (combined.includes("not logged in") || combined.includes("Not logged in") || combined.includes("/login")) {
        console.log(chalk.red("  Not logged in"));
        console.log(chalk.cyan("  ──────────────────────────────────────────────────────\n"));
        console.log(chalk.red(
          "\n  Import requires Claude Code to be logged in.\n" +
          "  Run: claude /login\n" +
          "  Then retry: agentboot import\n"
        ));
        return null;
      }

      let detail = stderr || `exit code ${result.status}`;
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.result) detail = parsed.result;
      } catch { /* not JSON */ }
      console.log(chalk.gray(`  Exit code: ${result.status}`));
      console.log(chalk.gray(`  ${detail.slice(0, 200)}`));
      console.log(chalk.cyan("  ──────────────────────────────────────────────────────\n"));
      console.log(chalk.red(`\n  Classification failed: ${detail}`));
      if (result.signal) console.log(chalk.gray(`    Signal: ${result.signal}`));
      if (process.env["DEBUG"]) {
        // Show error metadata only — stdout may contain file content from the prompt
        console.log(chalk.gray(`    stderr: ${stderr.slice(0, 300)}`));
        console.log(chalk.gray(`    stdout length: ${stdout.length} chars`));
      }
      return null;
    }

    try {
      const output = JSON.parse(result.stdout);
      const data = output.structured_output ?? output.result ?? output;
      const parsed = typeof data === "string" ? JSON.parse(data) : data;

      // Display response summary
      const items = parsed.classifications ?? [];
      if (items.length === 0) {
        console.log(chalk.gray("  (empty — no classifications returned)"));
      } else {
        for (const item of items) {
          const lines = item.lines ? `L${item.lines[0]}-${item.lines[1]}` : "?";
          const comp = item.composition_type ?? "";
          console.log(chalk.gray(
            `  ${(item.classification ?? "unknown").padEnd(14)} ${lines.padEnd(10)} ${comp.padEnd(12)} ${item.suggested_name ?? ""}`
          ));
          const preview = (item.content_preview ?? "").slice(0, 60);
          if (preview) console.log(chalk.gray(`  ${"".padEnd(14)} ${"".padEnd(10)} ${"".padEnd(12)} ${preview}`));
        }
      }

      // Token usage
      if (output.usage) {
        const u = output.usage;
        const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
        const cost = output.total_cost_usd;
        console.log(chalk.gray(`\n  Tokens: ${tokens}${cost != null ? `, Cost: $${cost.toFixed(4)}` : ""}`));
      }
      console.log(chalk.cyan("  ──────────────────────────────────────────────────────\n"));

      return {
        data: parsed,
        usage: output.usage ? {
          inputTokens: output.usage.input_tokens ?? 0,
          outputTokens: output.usage.output_tokens ?? 0,
        } : undefined,
        costUsd: output.total_cost_usd,
      };
    } catch (err) {
      console.log(chalk.gray("  (could not parse response)"));
      console.log(chalk.cyan("  ──────────────────────────────────────────────────────\n"));
      console.log(chalk.red(`\n  Failed to parse classification output: ${err}\n`));
      if (process.env["DEBUG"]) {
        console.log(chalk.gray(`    stdout length: ${result.stdout?.length ?? 0} chars`));
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// ManualProvider — zero-LLM fallback
// ---------------------------------------------------------------------------

export class ManualProvider implements LLMProvider {
  readonly name = "Manual (no LLM)";

  isAvailable(): boolean {
    return true; // Always available
  }

  unavailableReason(): string {
    return ""; // Never unavailable
  }

  classify(_prompt: string, _jsonSchema: string): ClassificationResult | null {
    console.log(chalk.yellow(
      "\n  Manual mode: no LLM classification.\n" +
      "  The import plan will be written with empty classifications.\n" +
      "  Edit the plan file manually and run `agentboot import --apply`.\n"
    ));
    return { data: { classifications: [] } };
  }
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the LLM provider from config.
 * Returns the appropriate provider based on `config.agents.llmProvider`.
 */
export function resolveProvider(config: AgentBootConfig): LLMProvider {
  const preference = config.agents?.llmProvider ?? "claude-code";

  switch (preference) {
    case "claude-code":
      return new ClaudeCodeProvider();
    case "manual":
      return new ManualProvider();
    default:
      console.warn(chalk.yellow(`  Unknown LLM provider "${preference}", falling back to manual.`));
      return new ManualProvider();
  }
}
