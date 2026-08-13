/**
 * The QA harness measures the release gate, so a defect in the harness is a
 * defect in every measurement taken with it. These tests pin the three helpers
 * whose failure mode is SILENT — each would return a plausible wrong answer
 * rather than throwing, which is how a green run stops meaning anything.
 *
 * The suite itself (scripts/qa/p0-suite.ts) is not run here: it takes about a
 * minute and drives real builds. Run it directly, with --prove.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  assertNoStackTrace,
  sha256Tree,
  stripJsonComments,
} from "../scripts/qa/harness.js";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "qa-harness-test-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("stripJsonComments", () => {
  it("strips line and block comments", () => {
    const src = `{
      // a leading comment
      "a": 1, // trailing
      /* block
         spanning lines */
      "b": 2
    }`;
    expect(JSON.parse(stripJsonComments(src))).toEqual({ a: 1, b: 2 });
  });

  it("does NOT eat a // inside a string literal", () => {
    // The naive regex strip that this helper replaces truncates the URL here
    // and produces a parse error that reads like a product bug.
    const src = '{ "sink": "https://example.invalid/ingest", "n": 1 }';
    expect(JSON.parse(stripJsonComments(src))).toEqual({
      sink: "https://example.invalid/ingest",
      n: 1,
    });
  });

  it("does not treat an escaped quote as the end of a string", () => {
    const src = '{ "s": "a \\" // not a comment", "n": 2 }';
    expect(JSON.parse(stripJsonComments(src))).toEqual({ s: 'a " // not a comment', n: 2 });
  });
});

describe("assertNoStackTrace", () => {
  it("accepts a plain CLI error sentence", () => {
    expect(() =>
      assertNoStackTrace("✗ repos.json not found: /tmp/nope.json", "case")
    ).not.toThrow();
  });

  it("rejects real V8 frames", () => {
    const out = [
      "Error: ENOENT: no such file or directory",
      "    at readFileSync (node:fs:1234:5)",
      "    at Object.<anonymous> (/app/scripts/sync.ts:10:3)",
    ].join("\n");
    expect(() => assertNoStackTrace(out, "case")).toThrow(/stack trace/);
  });

  it("does not fire on prose that merely contains the word 'at'", () => {
    expect(() =>
      assertNoStackTrace("  Repo path does not exist at /tmp/missing", "case")
    ).not.toThrow();
  });
});

describe("sha256Tree", () => {
  it("changes when a file's bytes change", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "one");
    const before = sha256Tree(root);
    fs.writeFileSync(path.join(root, "a.md"), "two");
    expect(sha256Tree(root)).not.toBe(before);
  });

  it("changes when a file is added or removed, not just edited", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "one");
    const before = sha256Tree(root);
    fs.writeFileSync(path.join(root, "b.md"), "");
    expect(sha256Tree(root)).not.toBe(before);
    fs.rmSync(path.join(root, "b.md"));
    expect(sha256Tree(root)).toBe(before);
  });

  it("changes when a file moves, even though the bytes are unchanged", () => {
    // A digest over contents alone would call a misplaced sync idempotent.
    const root = tmp();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "a.md"), "same bytes");
    const before = sha256Tree(root);
    fs.renameSync(path.join(root, "a.md"), path.join(root, "sub", "a.md"));
    expect(sha256Tree(root)).not.toBe(before);
  });

  it("ignores .git so a commit in the target repo is not read as drift", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "one");
    const before = sha256Tree(root);
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main");
    expect(sha256Tree(root)).toBe(before);
  });
});
