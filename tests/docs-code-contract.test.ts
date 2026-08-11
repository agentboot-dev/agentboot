import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Docs↔code contract.
 *
 * A reference page that describes a control is itself a control surface: an
 * operator who cannot learn a limit, a legal value or a wire format from the
 * published docs cannot configure it, and cannot audit it either. Every
 * assertion here therefore derives its expectation FROM THE CODE — a constant,
 * a validator, an emitted string — and then checks that the published page says
 * it. A doc test that hard-codes both sides proves only that someone typed the
 * same thing twice.
 *
 * Each extractor fails loudly when it cannot find its subject in the source. An
 * extractor that quietly yields an empty set turns the whole file green while
 * measuring nothing, which is the vacuous-pass class this repo keeps closing.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** Pull a `{ "key": "value" }` object literal out of a source file by name. */
function extractStringMap(src: string, declName: string): Record<string, string> {
  const m = src.match(new RegExp(`const ${declName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!m) throw new Error(`could not locate \`${declName}\` — re-derive this test against the current source`);
  const out: Record<string, string> = {};
  for (const pair of m[1]!.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out[pair[1]!] = pair[2]!;
  if (Object.keys(out).length === 0) throw new Error(`\`${declName}\` parsed to an empty map`);
  return out;
}

describe("L36 — ab.modelOverrides is documented with keys, defaults and legal values", () => {
  const compileSrc = read("scripts/compile.ts");
  const docs = read("docs/configuration.md");

  it("documents every /ab agent key and its default model", () => {
    const defaults = extractStringMap(compileSrc, "defaultModels");
    expect(Object.keys(defaults).length).toBeGreaterThanOrEqual(5);
    for (const [agent, model] of Object.entries(defaults)) {
      // The key must be named, and its default must appear on the same line —
      // a table row, not two unrelated mentions elsewhere on the page.
      const row = docs
        .split("\n")
        .find((l) => l.includes("modelOverrides") && l.includes(agent) && l.includes(`\`${model}\``));
      expect(row, `docs/configuration.md has no row giving ${agent}'s default model (${model})`).toBeTruthy();
    }
  });

  it("documents ab-query's haiku default as the cost rationale", () => {
    const defaults = extractStringMap(compileSrc, "defaultModels");
    expect(defaults["ab-query"], "ab-query is no longer the cheap agent — re-derive the doc").toBe("haiku");
    expect(docs).toMatch(/ab-query[^\n]*haiku|haiku[^\n]*ab-query/i);
  });

  it("documents every legal ab.modelOverrides value the validator accepts", () => {
    const aliasBlock = compileSrc.match(/const VALID_AB_MODEL_ALIASES = new Set\(\[([^\]]*)\]\)/);
    if (!aliasBlock) throw new Error("could not locate VALID_AB_MODEL_ALIASES");
    const aliases = [...aliasBlock[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      expect(docs, `docs/configuration.md never names the legal value "${alias}"`).toContain(`\`${alias}\``);
    }
    // …and the escape hatch for an explicit model id.
    expect(docs).toContain("^claude-[a-z0-9.-]+$");
  });

  it("documents ab-query's read-only deny list", () => {
    const m = compileSrc.match(/const defaultDisallowedTools[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
    if (!m) throw new Error("could not locate defaultDisallowedTools");
    const tools = [...m[1]!.matchAll(/"([^"]+)"/g)].map((t) => t[1]!).filter((t) => t !== "ab-query");
    expect(tools).toContain("Bash");
    for (const tool of tools) {
      expect(docs, `docs/configuration.md never names ab-query's denied tool "${tool}"`).toContain(tool);
    }
    expect(docs).toContain("disallowedTools");
  });

  it("states honestly that an invalid override warns rather than failing the build", () => {
    // The emitted warning is the operator's ONLY signal, so the page must not
    // imply the build rejects a typo. Pin the behaviour to the emitter.
    expect(compileSrc).toContain("Ignoring invalid ab.modelOverrides");
    expect(docs).toMatch(/Ignoring invalid ab\.modelOverrides/);
    expect(docs).toMatch(/does not fail the build/i);
  });
});
