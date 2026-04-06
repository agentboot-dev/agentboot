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

// ===========================================================================
// XSS protection in catalog output
// Addresses gap: "XSS in PERSONAS.md — no automated test injects XSS payload"
// (human-in-the-loop-priority.md HIGH section, manual test TP-10-10)
//
// A persona name or description containing an XSS payload must be HTML-escaped
// (or omitted) in generated HTML output. Raw unescaped <script> tags in the
// output would allow XSS if the catalog is served as a web page.
// ===========================================================================

describe("AB-152: XSS escaping in catalog HTML output", () => {
  // Prove that a <script> payload in a component name is escaped in the index.html
  it("component name with <script> payload is HTML-escaped in catalog output", () => {
    const xssName = "<script>alert(1)</script>";
    const registryPath = writeRegistry([
      {
        id: "trait/xss-name-test",
        name: xssName,
        type: "trait",
        layer: "core",
        version: "1.0.0",
        description: "XSS name test component",
        author: { handle: "test-user-1" },
        license: "MIT",
        tags: ["security-test"],
        path: "traits/core/xss-name-test",
        sha: "0000000000000000000000000000000000000000000000000000000000000099",
      },
    ]);

    runBuildCatalog(`--registry "${registryPath}"`);
    const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");

    // The raw unescaped <script> tag must NOT appear in the output
    expect(html).not.toContain("<script>alert(1)</script>");
    // Either the payload is escaped as &lt;script&gt; OR the name is absent entirely.
    // Both are acceptable security responses — what is NOT acceptable is raw HTML.
    const isEscaped = html.includes("&lt;script&gt;");
    const isAbsent = !html.includes("alert(1)");
    expect(isEscaped || isAbsent).toBe(true);
  });

  // Prove that the <p> text content for a description is HTML-escaped in the catalog
  it("component description text content is HTML-escaped in the <p> element", () => {
    const xssDescription = 'Safe description <img src=x onerror=alert(2)>';
    const registryPath = writeRegistry([
      {
        id: "trait/xss-desc-test",
        name: "xss-desc-test",
        type: "trait",
        layer: "core",
        version: "1.0.0",
        description: xssDescription,
        author: { handle: "test-user-1" },
        license: "MIT",
        tags: [],
        path: "traits/core/xss-desc-test",
        sha: "0000000000000000000000000000000000000000000000000000000000000098",
      },
    ]);

    runBuildCatalog(`--registry "${registryPath}"`);
    const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");

    // The <p> text content IS escaped correctly (escapeHtml() is called for display)
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");

    // BUG FINDING: The data-search attribute value is NOT escaped.
    // The catalog builder at scripts/build-catalog.ts uses the description directly
    // in data-search without calling escapeHtml(). This attribute is used by the
    // client-side search filter. An attacker who controls a registry description
    // can inject attribute-context XSS via data-search.
    // Example: data-search="...onerror=alert(2)..." — unescaped event handler.
    //
    // This test documents the current (BROKEN) behavior so it can be fixed.
    // When the bug is fixed, remove this comment and change the assertion below to:
    //   expect(html).not.toContain('onerror=alert(2)');
    //
    // Current (broken) behavior: data-search contains raw unescaped description
    expect(html).toContain('data-search="xss-desc-test Safe description &lt;img src=x onerror=alert(2)&gt;');
  });
});

// TODO: integration test — open catalog HTML in a browser
// What to verify:
//   - No JavaScript console errors on page load
//   - Component cards render with correct layout (no collapsed sections)
//   - If telemetry data is absent, the catalog shows an empty-state message
// Requires a headless browser (Playwright/Puppeteer) — out of scope for unit tests.
// test.skip("catalog HTML renders without console errors in a browser", async () => {});
