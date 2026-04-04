#!/usr/bin/env node

/**
 * Harness Intelligence Pipeline — Source Fetcher
 *
 * Reads the sources.md knowledge file for a given harness SME, parses the
 * tiered source URLs, fetches content from each source, and writes a JSON
 * file with the fetched content for downstream SME analysis.
 *
 * Usage:
 *   npx tsx scripts/intelligence/fetch-sources.ts --harness cc --output sources.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HarnessId = "cc" | "copilot" | "cursor" | "gemini" | "jetbrains";

interface ParsedSource {
  url: string;
  tier: 1 | 2 | 3;
  label: string;
  description: string;
}

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

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  harness: HarnessId;
  output: string;
}

function parseArgs(argv: string[]): CliArgs {
  let harness: string | undefined;
  let output: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--harness" && i + 1 < argv.length) {
      harness = argv[++i];
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!harness || !output) {
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

  return { harness: harness as HarnessId, output };
}

function printUsage(): void {
  console.log(`
Usage: fetch-sources --harness <id> --output <path.json>

Options:
  --harness   Harness ID: cc | copilot | cursor | gemini | jetbrains
  --output    Path to write the fetched sources JSON
  --help      Show this help message
`);
}

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

function parseSourcesMd(content: string): ParsedSource[] {
  const sources: ParsedSource[] = [];
  let currentTier: 1 | 2 | 3 = 1;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Detect tier headers
    const tierMatch = line.match(/^##\s+Tier\s+(\d)/);
    if (tierMatch) {
      const tierNum = parseInt(tierMatch[1]!, 10);
      if (tierNum >= 1 && tierNum <= 3) {
        currentTier = tierNum as 1 | 2 | 3;
      }
      continue;
    }

    // Detect source entries: "- **Label**: URL"
    const sourceMatch = line.match(/^-\s+\*\*(.+?)\*\*:\s*(https?:\/\/\S+)/);
    if (sourceMatch) {
      const label = sourceMatch[1]!;
      const url = sourceMatch[2]!;

      // Next line is typically the description
      let description = "";
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!.trim();
        if (nextLine.startsWith("-")) {
          description = nextLine.replace(/^-\s*/, "");
        }
      }

      sources.push({ url, tier: currentTier, label, description });
    }
  }

  return sources;
}

// ---------------------------------------------------------------------------
// Content fetching
// ---------------------------------------------------------------------------

async function fetchSourceContent(source: ParsedSource): Promise<FetchedSource> {
  const fetchedAt = new Date().toISOString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    // For GitHub API URLs, use the API endpoint for releases
    const url = toFetchableUrl(source.url);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AgentBoot-Intelligence/1.0",
        "Accept": "text/html, application/json, text/plain",
        ...(process.env["GITHUB_TOKEN"] && url.includes("api.github.com")
          ? { "Authorization": `Bearer ${process.env["GITHUB_TOKEN"]}` }
          : {}),
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        url: source.url,
        tier: source.tier,
        label: source.label,
        content: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
        fetchedAt,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    let content: string;

    if (contentType.includes("application/json")) {
      const json = await response.json();
      content = JSON.stringify(json, null, 2);
    } else {
      const text = await response.text();
      // Truncate very large responses to keep pipeline manageable
      content = text.length > 50_000 ? text.slice(0, 50_000) + "\n\n[TRUNCATED]" : text;
    }

    return {
      url: source.url,
      tier: source.tier,
      label: source.label,
      content,
      fetchedAt,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return {
      url: source.url,
      tier: source.tier,
      label: source.label,
      content: null,
      error: message,
      fetchedAt,
    };
  }
}

/**
 * Convert user-facing URLs to API-friendly URLs where possible.
 * For example, GitHub release pages become GitHub API release endpoints.
 */
function toFetchableUrl(url: string): string {
  // GitHub releases page → GitHub API releases endpoint
  const ghReleasesMatch = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/?$/,
  );
  if (ghReleasesMatch) {
    return `https://api.github.com/repos/${ghReleasesMatch[1]}/${ghReleasesMatch[2]}/releases?per_page=5`;
  }

  // GitHub issues page → GitHub API issues endpoint
  const ghIssuesMatch = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?$/,
  );
  if (ghIssuesMatch) {
    return `https://api.github.com/repos/${ghIssuesMatch[1]}/${ghIssuesMatch[2]}/issues?per_page=10&state=open&sort=updated`;
  }

  return url;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const smeDir = HARNESS_DIR_MAP[args.harness];
  const sourcesPath = path.join(ROOT, "internal", "harness-sme", smeDir, "knowledge", "sources.md");

  if (!fs.existsSync(sourcesPath)) {
    console.error(`Error: sources file not found: ${sourcesPath}`);
    process.exit(1);
  }

  const sourcesContent = fs.readFileSync(sourcesPath, "utf-8");
  const parsedSources = parseSourcesMd(sourcesContent);

  if (parsedSources.length === 0) {
    console.error(`Error: no sources found in ${sourcesPath}`);
    process.exit(1);
  }

  console.log(`Fetching ${parsedSources.length} sources for ${args.harness}...`);

  // Fetch all sources concurrently
  const fetchedSources = await Promise.all(
    parsedSources.map(async (source) => {
      console.log(`  [Tier ${source.tier}] ${source.label}: ${source.url}`);
      const result = await fetchSourceContent(source);
      if (result.error) {
        console.log(`    ⚠ ${result.error}`);
      } else {
        const contentLen = result.content?.length ?? 0;
        console.log(`    ✓ ${contentLen} chars`);
      }
      return result;
    }),
  );

  const result: FetchResult = {
    harness: args.harness,
    fetchedAt: new Date().toISOString(),
    sources: fetchedSources,
  };

  // Ensure output directory exists
  const outputDir = path.dirname(args.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(args.output, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\nWrote fetched sources to ${args.output}`);

  const successCount = fetchedSources.filter((s) => s.content !== null).length;
  const failCount = fetchedSources.filter((s) => s.content === null).length;
  console.log(`Results: ${successCount} succeeded, ${failCount} failed`);
}

export { parseSourcesMd, toFetchableUrl };
export type { ParsedSource, FetchedSource, FetchResult };

// Only run main when invoked directly (not when imported for testing)
const isDirectRun = process.argv[1]?.replace(/\.ts$/, "").replace(/\.js$/, "")
  === fileURLToPath(import.meta.url).replace(/\.ts$/, "").replace(/\.js$/, "");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
