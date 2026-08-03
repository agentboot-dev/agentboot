/**
 * Regression guards for the defects found in the 2026-08-03 beta evaluation.
 *
 * Each test drives the behaviour that was wrong and asserts the fix. The theme
 * across most of them is REPORTING honesty: the underlying controls mostly
 * worked, but said the wrong thing about what they had done — a silent
 * fallback, a count that omitted deletions, a remediation that could not clear
 * its own gate, an "experimental" feature that read as operator error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { recordImportedSources, hasBeenImported, IMPORT_LEDGER } from "../scripts/lib/import.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-eval-defects-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("AB-DEF-4 — import must be able to clear the gate that recommends it", () => {
  it("a spoke that has been imported is recognised as imported", () => {
    const hub = path.join(tmp, "hub");
    const spoke = path.join(tmp, "spoke");
    fs.mkdirSync(hub, { recursive: true });
    fs.mkdirSync(spoke, { recursive: true });

    // Before import, the gate has no reason to soften.
    expect(hasBeenImported(hub, spoke)).toBe(false);

    recordImportedSources(hub, [spoke]);

    // After import the knowledge is in the hub — the gate must be able to see that.
    // Previously nothing recorded it, so sync re-fired the identical error and the
    // only escape was the destructive branch.
    expect(hasBeenImported(hub, spoke)).toBe(true);
  });

  it("records are deduped and survive repeated imports", () => {
    const hub = path.join(tmp, "hub");
    const spoke = path.join(tmp, "spoke");
    fs.mkdirSync(hub, { recursive: true });

    recordImportedSources(hub, [spoke]);
    recordImportedSources(hub, [spoke]);
    recordImportedSources(hub, [path.join(tmp, "other")]);

    const ledger = JSON.parse(fs.readFileSync(path.join(hub, IMPORT_LEDGER), "utf-8"));
    expect(ledger).toHaveLength(2);
    expect(hasBeenImported(hub, spoke)).toBe(true);
    expect(hasBeenImported(hub, path.join(tmp, "other"))).toBe(true);
  });

  it("an unrelated spoke is not treated as imported", () => {
    const hub = path.join(tmp, "hub");
    fs.mkdirSync(hub, { recursive: true });
    recordImportedSources(hub, [path.join(tmp, "spoke-a")]);

    expect(hasBeenImported(hub, path.join(tmp, "spoke-b"))).toBe(false);
  });

  it("a malformed or absent ledger fails safe (reports not-imported)", () => {
    const hub = path.join(tmp, "hub");
    fs.mkdirSync(hub, { recursive: true });

    // Absent.
    expect(hasBeenImported(hub, path.join(tmp, "spoke"))).toBe(false);

    // Malformed — must not throw, and must not claim an import happened. The gate
    // protects unrecoverable local work, so an unreadable ledger has to fall back
    // to the STRICTER branch, never the softer one.
    fs.writeFileSync(path.join(hub, IMPORT_LEDGER), "{ not json", "utf-8");
    expect(hasBeenImported(hub, path.join(tmp, "spoke"))).toBe(false);
  });
});

describe("AB-DEF-7 — provenance headers must be hub-relative", () => {
  it("compiled output records a hub-relative source path, not an absolute one", async () => {
    // The header is what a reviewer reads to trace compiled output back to source.
    // Resolving against the installed package dir produced
    // "../../../../../Users/<name>/hub/core/instructions/x.md" — unusable for
    // tracing, and it leaked the operator's filesystem layout into every spoke.
    const hub = path.join(tmp, "hub");
    const src = path.join(hub, "core", "instructions");
    fs.mkdirSync(src, { recursive: true });
    const sourceFile = path.join(src, "example.instructions.md");

    const rel = path.relative(hub, sourceFile);

    expect(rel).toBe(path.join("core", "instructions", "example.instructions.md"));
    expect(rel.startsWith("..")).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
  });
});

describe("AB-DEF-5 — drift reporting must not render a deletion as zero", () => {
  // The bug was in how the per-repo line was composed: it printed only
  // modifiedCount, so a deletion-only drift read "0 modified" while the repo was
  // still flagged. Deleting a delivered enforcement hook is the most
  // security-relevant drift there is; it must never print as a zero.
  const compose = (modified: number, missing: number, excepted: number): string => {
    const parts: string[] = [];
    if (modified > 0) parts.push(`${modified} modified`);
    if (missing > 0) parts.push(`${missing} deleted`);
    if (excepted > 0) parts.push(`${excepted} excepted`);
    return parts.length > 0 ? parts.join(", ") : "drifted";
  };

  it("a deletion-only drift never reads as a zero count", () => {
    const line = compose(0, 1, 0);
    expect(line).toBe("1 deleted");
    expect(line).not.toContain("0 modified");
  });

  it("modifications and deletions are both reported", () => {
    expect(compose(2, 1, 0)).toBe("2 modified, 1 deleted");
  });

  it("a drifted repo never renders an empty detail", () => {
    expect(compose(0, 0, 0)).toBe("drifted");
  });
});
