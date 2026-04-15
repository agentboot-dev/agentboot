/**
 * gen-stats.ts
 *
 * Generates website/src/generated/stats.json from live project data.
 * Run before building the website: `npx tsx scripts/gen-stats.ts`
 *
 * Collects:
 *   - testsPasssing  — from vitest --reporter=json
 *   - tsErrors       — from tsc --noEmit (0 = clean)
 *   - corePersonas   — directory count under core/personas/
 *   - outputPlatforms — hardcoded (reflects compile.ts platform list)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "website", "src", "generated", "stats.json");

function runVitest(): number {
  console.log("  Running vitest...");
  const result = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=json"],
    { cwd: ROOT, encoding: "utf-8" }
  );
  // vitest --reporter=json writes JSON to stdout
  const raw = result.stdout ?? "";
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) {
    console.warn("  ⚠ Could not parse vitest JSON output — defaulting to 0");
    return 0;
  }
  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    return (parsed.numPassedTests as number) ?? 0;
  } catch {
    console.warn("  ⚠ vitest JSON parse error — defaulting to 0");
    return 0;
  }
}

function runTsc(): number {
  console.log("  Running tsc...");
  const result = spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  if (result.status === 0) return 0;
  // Count error lines (lines containing ": error TS")
  const lines = (result.stdout + result.stderr).split("\n");
  return lines.filter((l) => l.includes(": error TS")).length;
}

function countPersonas(): number {
  const personasDir = path.join(ROOT, "core", "personas");
  if (!fs.existsSync(personasDir)) return 0;
  return fs
    .readdirSync(personasDir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).length;
}

console.log("\nGenerating website stats...");

const stats = {
  outputPlatforms: 8,
  corePersonas: countPersonas(),
  testsPassing: runVitest(),
  tsErrors: runTsc(),
  generatedAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(stats, null, 2) + "\n", "utf-8");

console.log(`\n  ✓ stats.json written:`);
console.log(`    outputPlatforms : ${stats.outputPlatforms}`);
console.log(`    corePersonas    : ${stats.corePersonas}`);
console.log(`    testsPassing    : ${stats.testsPassing}`);
console.log(`    tsErrors        : ${stats.tsErrors}`);
console.log(`    generatedAt     : ${stats.generatedAt}\n`);
