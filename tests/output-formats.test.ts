/**
 * A5: `outputFormats` had FOUR different "defaults" spread across EIGHT sites.
 *
 * These tests exist because the drift, not the value, is the defect. Pinning
 * the value alone would not have caught any of the eight — every one of them
 * was individually plausible. What catches it is asserting that there is only
 * one definition and that nothing has re-introduced a literal.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_OUTPUT_FORMATS,
  VALID_OUTPUT_FORMATS,
  SYNCABLE_OUTPUT_FORMATS,
} from "../scripts/lib/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("A5 — one definition of the output-format lists", () => {
  it("every default format is a valid format", () => {
    for (const f of DEFAULT_OUTPUT_FORMATS) {
      expect(VALID_OUTPUT_FORMATS).toContain(f);
    }
  });

  it("VALID_OUTPUT_FORMATS has no duplicates", () => {
    expect(new Set(VALID_OUTPUT_FORMATS).size).toBe(VALID_OUTPUT_FORMATS.length);
  });

  it("SYNCABLE is VALID minus exactly `plugin` — derived, not re-typed", () => {
    expect([...SYNCABLE_OUTPUT_FORMATS].sort()).toEqual(
      VALID_OUTPUT_FORMATS.filter((f) => f !== "plugin").sort(),
    );
    expect(SYNCABLE_OUTPUT_FORMATS).not.toContain("plugin");
  });

  /**
   * The anti-drift guard. Every one of the eight original sites was a literal
   * fallback; this fails the moment a ninth appears.
   */
  it("no script re-introduces a literal `outputFormats ?? [...]` fallback", () => {
    const offenders: string[] = [];
    for (const rel of ["scripts/compile.ts", "scripts/cli.ts", "scripts/sync.ts", "scripts/validate.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf-8");
      src.split("\n").forEach((line, i) => {
        // Matches `outputFormats ?? [` / `outputFormats || [` when what follows
        // the bracket is anything other than the spread of the shared constant.
        const m = line.match(/outputFormats\s*(?:\?\?|\|\|)\s*\[([^\]]*)/);
        if (m && !m[1]!.includes("...DEFAULT_OUTPUT_FORMATS")) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no script re-types the valid-format list as a literal", () => {
    const offenders: string[] = [];
    for (const rel of ["scripts/compile.ts", "scripts/cli.ts", "scripts/sync.ts", "scripts/validate.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf-8");
      src.split("\n").forEach((line, i) => {
        if (/(validFormats|validPlatforms)\s*(?::[^=]*)?=\s*\[\s*"/.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
