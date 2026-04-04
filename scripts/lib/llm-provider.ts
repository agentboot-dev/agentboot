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

      const classResult: ClassificationResult = {
        data: parsed,
      };
      if (output.usage) {
        classResult.usage = {
          inputTokens: output.usage.input_tokens ?? 0,
          outputTokens: output.usage.output_tokens ?? 0,
        };
      }
      if (output.total_cost_usd != null) {
        classResult.costUsd = output.total_cost_usd;
      }
      return classResult;
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
// AB-127: API Providers — direct API calls via fetch
// ---------------------------------------------------------------------------

/**
 * Base class for fetch-based API providers.
 * Handles common JSON schema wrapping and error handling.
 */
abstract class APIProviderBase implements LLMProvider {
  abstract readonly name: string;
  protected abstract readonly envVar: string;
  protected abstract readonly apiUrl: string;
  protected abstract readonly defaultModel: string;

  protected get apiKey(): string | undefined {
    return process.env[this.envVar];
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  unavailableReason(): string {
    return `Set ${this.envVar} environment variable to use ${this.name}.`;
  }

  abstract classify(prompt: string, jsonSchema: string): ClassificationResult | null;
}

export class AnthropicAPIProvider extends APIProviderBase {
  readonly name = "Anthropic API";
  protected readonly envVar = "ANTHROPIC_API_KEY";
  protected readonly apiUrl = "https://api.anthropic.com/v1/messages";
  protected readonly defaultModel = "claude-sonnet-4-20250514";

  classify(prompt: string, _jsonSchema: string): ClassificationResult | null {
    console.log(chalk.gray(`  Provider: ${this.name} (${this.defaultModel})`));
    try {
      // Use synchronous HTTP via spawnSync + node fetch script
      const script = `
        const r = await fetch("${this.apiUrl}", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "${this.defaultModel}",
            max_tokens: 8192,
            messages: [{ role: "user", content: ${JSON.stringify(prompt)} }],
          }),
        });
        const j = await r.json();
        process.stdout.write(JSON.stringify(j));
      `;
      const result = spawnSync("node", ["--input-type=module", "-e", script], {
        encoding: "utf-8",
        timeout: 120_000,
        env: process.env,
      });
      if (result.status !== 0) {
        console.log(chalk.red(`  Anthropic API call failed: ${result.stderr?.slice(0, 200)}`));
        return null;
      }
      const response = JSON.parse(result.stdout) as Record<string, unknown>;
      const content = (response["content"] as Array<Record<string, unknown>>)?.[0];
      const text = content?.["text"] as string ?? "";
      const parsed = JSON.parse(text);
      const usage = response["usage"] as Record<string, number> | undefined;
      const classResult: ClassificationResult = { data: parsed };
      if (usage) {
        classResult.usage = {
          inputTokens: usage["input_tokens"] ?? 0,
          outputTokens: usage["output_tokens"] ?? 0,
        };
      }
      return classResult;
    } catch (err) {
      console.log(chalk.red(`  Anthropic API error: ${err instanceof Error ? err.message : String(err)}`));
      return null;
    }
  }
}

export class OpenAIAPIProvider extends APIProviderBase {
  readonly name = "OpenAI API";
  protected readonly envVar = "OPENAI_API_KEY";
  protected readonly apiUrl = "https://api.openai.com/v1/chat/completions";
  protected readonly defaultModel = "gpt-4o";

  classify(prompt: string, _jsonSchema: string): ClassificationResult | null {
    console.log(chalk.gray(`  Provider: ${this.name} (${this.defaultModel})`));
    try {
      const script = `
        const r = await fetch("${this.apiUrl}", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
          },
          body: JSON.stringify({
            model: "${this.defaultModel}",
            max_tokens: 8192,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "Respond with valid JSON only." },
              { role: "user", content: ${JSON.stringify(prompt)} },
            ],
          }),
        });
        const j = await r.json();
        process.stdout.write(JSON.stringify(j));
      `;
      const result = spawnSync("node", ["--input-type=module", "-e", script], {
        encoding: "utf-8",
        timeout: 120_000,
        env: process.env,
      });
      if (result.status !== 0) {
        console.log(chalk.red(`  OpenAI API call failed: ${result.stderr?.slice(0, 200)}`));
        return null;
      }
      const response = JSON.parse(result.stdout) as Record<string, unknown>;
      const choices = response["choices"] as Array<Record<string, unknown>> | undefined;
      const message = choices?.[0]?.["message"] as Record<string, unknown> | undefined;
      const text = message?.["content"] as string ?? "";
      const parsed = JSON.parse(text);
      const usage = response["usage"] as Record<string, number> | undefined;
      const classResult: ClassificationResult = { data: parsed };
      if (usage) {
        classResult.usage = {
          inputTokens: usage["prompt_tokens"] ?? 0,
          outputTokens: usage["completion_tokens"] ?? 0,
        };
      }
      return classResult;
    } catch (err) {
      console.log(chalk.red(`  OpenAI API error: ${err instanceof Error ? err.message : String(err)}`));
      return null;
    }
  }
}

export class GoogleAPIProvider extends APIProviderBase {
  readonly name = "Google Gemini API";
  protected readonly envVar = "GOOGLE_API_KEY";
  protected readonly apiUrl = "https://generativelanguage.googleapis.com/v1beta/models";
  protected readonly defaultModel = "gemini-2.5-pro";

  classify(prompt: string, _jsonSchema: string): ClassificationResult | null {
    console.log(chalk.gray(`  Provider: ${this.name} (${this.defaultModel})`));
    try {
      const url = `${this.apiUrl}/${this.defaultModel}:generateContent?key=` + process.env["GOOGLE_API_KEY"];
      const script = `
        const r = await fetch(${JSON.stringify(url)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: ${JSON.stringify(prompt)} }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
          }),
        });
        const j = await r.json();
        process.stdout.write(JSON.stringify(j));
      `;
      const result = spawnSync("node", ["--input-type=module", "-e", script], {
        encoding: "utf-8",
        timeout: 120_000,
        env: process.env,
      });
      if (result.status !== 0) {
        console.log(chalk.red(`  Google API call failed: ${result.stderr?.slice(0, 200)}`));
        return null;
      }
      const response = JSON.parse(result.stdout) as Record<string, unknown>;
      const candidates = response["candidates"] as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.["content"] as Record<string, unknown> | undefined;
      const parts = content?.["parts"] as Array<Record<string, unknown>> | undefined;
      const text = parts?.[0]?.["text"] as string ?? "";
      const parsed = JSON.parse(text);
      const usageMeta = response["usageMetadata"] as Record<string, number> | undefined;
      const classResult: ClassificationResult = { data: parsed };
      if (usageMeta) {
        classResult.usage = {
          inputTokens: usageMeta["promptTokenCount"] ?? 0,
          outputTokens: usageMeta["candidatesTokenCount"] ?? 0,
        };
      }
      return classResult;
    } catch (err) {
      console.log(chalk.red(`  Google API error: ${err instanceof Error ? err.message : String(err)}`));
      return null;
    }
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
    case "anthropic-api":
      return new AnthropicAPIProvider();
    case "openai-api":
      return new OpenAIAPIProvider();
    case "google-api":
      return new GoogleAPIProvider();
    case "manual":
      return new ManualProvider();
    default:
      console.warn(chalk.yellow(`  Unknown LLM provider "${preference}", falling back to manual.`));
      return new ManualProvider();
  }
}

/**
 * Interactive provider fallback: when configured provider is unavailable,
 * offer the user a choice from available providers.
 */
export function resolveProviderWithFallback(config: AgentBootConfig): LLMProvider {
  const primary = resolveProvider(config);
  if (primary.isAvailable()) return primary;

  console.log(chalk.yellow(`  Configured provider (${primary.name}) is unavailable: ${primary.unavailableReason()}`));

  // Try fallbacks in priority order
  const fallbacks: LLMProvider[] = [
    new ClaudeCodeProvider(),
    new AnthropicAPIProvider(),
    new OpenAIAPIProvider(),
    new GoogleAPIProvider(),
  ];

  for (const provider of fallbacks) {
    if (provider.isAvailable() && provider.name !== primary.name) {
      console.log(chalk.cyan(`  Falling back to: ${provider.name}`));
      return provider;
    }
  }

  console.log(chalk.yellow("  No LLM providers available. Using manual mode."));
  return new ManualProvider();
}
