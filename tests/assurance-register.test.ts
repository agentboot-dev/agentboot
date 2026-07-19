/**
 * The assurance-claim register (docs/assurance-claims.md) is the structural
 * control against "assurance artifact claims more than mechanism delivers":
 * every public assurance claim must point at an executable probe. This test
 * mechanizes the register — a row referencing a probe file that does not
 * exist fails the build, so rows cannot silently rot.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const REGISTER = path.join(ROOT, "docs", "assurance-claims.md");

describe("assurance-claim register", () => {
  const content = fs.readFileSync(REGISTER, "utf-8");
  const rows = content
    .split("\n")
    .filter((l) => /^\|\s*\d+\s*\|/.test(l));

  it("has at least the eleven v0.16.0 claims", () => {
    expect(rows.length).toBeGreaterThanOrEqual(11);
  });

  it("every referenced repo path in the probe column exists", () => {
    const missing: string[] = [];
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const probeCell = cells[3] ?? "";
      const refs = [...probeCell.matchAll(/`([^`]+)`/g)]
        .map((m) => m[1])
        // Keep only path-shaped refs (contain a slash and an extension or known dir).
        .filter((r) => /[/\\]/.test(r) && !r.startsWith("--") && !r.includes("<"));
      for (const ref of refs) {
        if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${cells[1]}: ${ref}`);
      }
      expect(refs.length, `row ${cells[1]} names no probe file`).toBeGreaterThan(0);
    }
    expect(missing).toEqual([]);
  });

  it("every row states its honest limits", () => {
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect((cells[4] ?? "").length, `row ${cells[1]} has no limits statement`).toBeGreaterThan(10);
    }
  });
});
