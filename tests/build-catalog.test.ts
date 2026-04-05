/**
 * Tests for AB-152: AgentBoot Marketplace Catalog Builder.
 *
 * Since build-catalog.ts is a script with no exports, tests exercise it
 * via execSync and inspect the output files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "build-catalog.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-catalog-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runBuildCatalog(args: string = ""): string {
  return execSync(`npx tsx "${SCRIPT}" --output "${tmpDir}" ${args}`, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

function writeRegistry(components: Array<Record<string, unknown>>): string {
  const registryPath = path.join(tmpDir, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify({ components }, null, 2));
  return registryPath;
}

// ===========================================================================
// Basic output
// ===========================================================================

describe("AB-152: build-catalog", () => {
  it("produces index.html in the output directory", () => {
    runBuildCatalog();
    expect(fs.existsSync(path.join(tmpDir, "index.html"))).toBe(true);
  });

  it("index.html contains valid HTML structure", () => {
    runBuildCatalog();
    const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</html>");
  });

  it("index.html contains AgentBoot Marketplace branding", () => {
    runBuildCatalog();
    const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
    expect(html).toContain("AgentBoot Marketplace");
  });

  // ---------- With a custom registry ----------

  it("component cards appear when registry has entries", () => {
    const registryPath = writeRegistry([
      {
        id: "trait/test-trait",
        name: "test-trait",
        type: "trait",
        layer: "core",
        version: "1.0.0",
        description: "A synthetic test trait",
        author: { handle: "test-user-1" },
        license: "Apache-2.0",
        tags: ["testing"],
        path: "traits/core/test-trait",
        sha: "0000000000000000000000000000000000000000000000000000000000000001",
      },
    ]);

    runBuildCatalog(`--registry "${registryPath}"`);
    const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
    expect(html).toContain("test-trait");
    expect(html).toContain("A synthetic test trait");
    expect(html).toContain("card");
  });

  it("generates detail pages per component type", () => {
    const registryPath = writeRegistry([
      {
        id: "trait/detail-test",
        name: "detail-test",
        type: "trait",
        layer: "verified",
        version: "2.0.0",
        description: "Detail page test",
        author: { handle: "test-user-1" },
        license: "MIT",
        tags: ["detail"],
        path: "traits/verified/detail-test",
        sha: "0000000000000000000000000000000000000000000000000000000000000002",
      },
    ]);

    runBuildCatalog(`--registry "${registryPath}"`);
    const detailPath = path.join(tmpDir, "trait", "detail-test.html");
    expect(fs.existsSync(detailPath)).toBe(true);

    const html = fs.readFileSync(detailPath, "utf-8");
    expect(html).toContain("detail-test");
    expect(html).toContain("Detail page test");
    expect(html).toContain("2.0.0");
    expect(html).toContain("MIT");
  });

  it("generates detail pages for multiple component types", () => {
    const registryPath = writeRegistry([
      {
        id: "trait/t1", name: "t1", type: "trait", layer: "core", version: "1.0.0",
        description: "Trait one", author: { handle: "test-user-1" }, license: "MIT",
        tags: [], path: "traits/core/t1", sha: "",
      },
      {
        id: "persona/p1", name: "p1", type: "persona", layer: "core", version: "1.0.0",
        description: "Persona one", author: { handle: "test-user-1" }, license: "MIT",
        tags: [], path: "personas/core/p1", sha: "",
      },
    ]);

    runBuildCatalog(`--registry "${registryPath}"`);
    expect(fs.existsSync(path.join(tmpDir, "trait", "t1.html"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "persona", "p1.html"))).toBe(true);
  });

  it("empty registry produces valid HTML with 0 components stat", () => {
    const registryPath = writeRegistry([]);

    runBuildCatalog(`--registry "${registryPath}"`);
    const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(">0<"); // "0" inside the stat value div
  });

  it("output directory is created if it does not exist", () => {
    const nestedOutput = path.join(tmpDir, "deep", "nested", "output");
    execSync(`npx tsx "${SCRIPT}" --output "${nestedOutput}"`, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
    expect(fs.existsSync(path.join(nestedOutput, "index.html"))).toBe(true);
  });
});
