/**
 * Prompt loader — prompts as code.
 *
 * All LLM prompts live in scripts/prompts/ as markdown templates with
 * {{VARIABLE}} placeholders and companion .schema.json files for structured
 * output. This module loads and interpolates them.
 *
 * Usage:
 *   import { loadPrompt, loadSchema, withIsolatedClaude } from "../prompts/index.js";
 *   const prompt = loadPrompt("classify-content", { FILE_PATH: "CLAUDE.md", ... });
 *   const schema = loadSchema("classify-content");
 *
 *   // Test a prompt without user settings influencing results:
 *   await withIsolatedClaude(() => { ... });
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROMPTS_DIR = path.dirname(__filename);

/**
 * Load a prompt template and interpolate variables.
 *
 * @param name - Prompt file name without extension (e.g., "classify-content")
 * @param vars - Key-value pairs to replace {{KEY}} placeholders
 * @returns The interpolated prompt string
 */
export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  const template = fs.readFileSync(filePath, "utf-8");
  // Single-pass replacement to prevent double-substitution (e.g., file content
  // containing {{HUB_CONTEXT}} being re-processed as a placeholder).
  const result = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
  return result;
}

/**
 * Load a JSON schema for structured LLM output.
 *
 * @param name - Schema file name without extension (e.g., "classify-content")
 * @returns The schema as a JSON string (ready to pass to --json-schema)
 */
export function loadSchema(name: string): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.schema.json`);
  // Read and re-stringify to strip formatting — claude --json-schema wants compact JSON
  const schema = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return JSON.stringify(schema);
}

// ---------------------------------------------------------------------------
// Isolated Claude — test prompts without user settings
// ---------------------------------------------------------------------------

/**
 * Run a function with Claude user settings temporarily removed.
 *
 * Backs up ~/.claude/settings.json, ~/.claude/CLAUDE.md, and
 * ~/.claude/settings.local.json, replaces them with empty defaults,
 * runs the callback, then restores the originals — even if the callback
 * throws or the process is interrupted.
 *
 * This gives `claude -p` a "fresh install" experience so you can verify
 * that prompts are self-contained and don't depend on user config.
 */
/**
 * Run a function with Claude user settings isolated.
 *
 * Creates a temporary .claude directory with empty settings and sets
 * CLAUDE_CONFIG_DIR to point Claude at it. The user's real ~/.claude/
 * files are never touched — no race conditions, no SIGKILL data loss.
 *
 * The temporary directory is cleaned up in a finally block.
 */
export async function withIsolatedClaude<T>(fn: () => T | Promise<T>): Promise<T> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-isolated-"));
  const tmpClaudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(tmpClaudeDir, { recursive: true });
  fs.writeFileSync(path.join(tmpClaudeDir, "settings.json"), "{}\n", "utf-8");

  // Save original env and override for the callback
  const originalConfigDir = process.env["CLAUDE_CONFIG_DIR"];
  process.env["CLAUDE_CONFIG_DIR"] = tmpClaudeDir;

  try {
    return await fn();
  } finally {
    // Restore original env
    if (originalConfigDir !== undefined) {
      process.env["CLAUDE_CONFIG_DIR"] = originalConfigDir;
    } else {
      delete process.env["CLAUDE_CONFIG_DIR"];
    }
    // Clean up temp directory
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
