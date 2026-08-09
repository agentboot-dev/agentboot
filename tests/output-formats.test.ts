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

/**
 * R1-5 — unification resolved the drift by deleting an output surface.
 *
 * A5 unified four different answers to "what is the default outputFormats?"
 * onto one constant, and picked the SHORTEST of them. That dropped `agents`
 * from `compilePersona`'s fallback — the one site whose in-code comment
 * specifically asserted it had to be there ("agents is a first-class official
 * output — the fallback must agree with the install/export defaults, which
 * always include it").
 *
 * Reproduced: a hub whose config omits `personas.outputFormats` built
 * "✓ Compiled 4 persona(s) × 3 platform(s)" and `ls dist` showed no `agents/`.
 * Because sync prunes against the previous manifest, the next sync would then
 * WITHDRAW AGENTS.md artifacts already delivered to spokes.
 *
 * Either default is defensible; silently removing a shipped output surface is
 * not. The invariant asserted here is the one that was actually violated: the
 * fallback and what `install` scaffolds must agree.
 */
describe("R1-5 — the default and what install scaffolds agree", () => {
  it("R1-5-1: `agents` is in DEFAULT_OUTPUT_FORMATS", () => {
    expect(DEFAULT_OUTPUT_FORMATS).toContain("agents");
  });

  it("R1-5-2: install.ts scaffolds every format the fallback claims", () => {
    // The two lists that must agree, compared in code. `scaffoldConfig` seeds
    // `["skill", "agents"]` and pushes per-tool formats on top, so the
    // unconditional seed is the part a config-less hub must match.
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "install.ts"), "utf-8");
    const seed = /const outputFormats = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    expect(seed, "install.ts no longer seeds outputFormats where expected").toContain("skill");
    for (const f of seed.split(",").map((x) => x.trim().replace(/['"]/g, "")).filter(Boolean)) {
      expect(
        DEFAULT_OUTPUT_FORMATS,
        `install always scaffolds "${f}" but a config that omits personas.outputFormats ` +
          `would not build it — that is the drift A5 unified away and then re-created`
      ).toContain(f);
    }
  });
});
