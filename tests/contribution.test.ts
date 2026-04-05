/**
 * Tests for AB-151: Marketplace contribution review workflow.
 *
 * Covers: checkOrgSpecificity, validateContribution, generateAttribution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  checkOrgSpecificity,
  validateContribution,
  generateAttribution,
} from "../scripts/lib/contribution.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-contribution-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a minimal valid contribution directory. */
function makeValidContribution(dir: string, options: {
  manifest?: Record<string, unknown>;
  contentFiles?: Array<{ name: string; content: string }>;
  readme?: boolean;
  behavioralTest?: boolean;
} = {}): void {
  fs.mkdirSync(dir, { recursive: true });

  const manifest = options.manifest ?? {
    id: "trait/test-trait",
    name: "test-trait",
    type: "trait",
    version: "1.0.0",
    description: "A test trait",
    license: "Apache-2.0",
    author: { handle: "test-user-1" },
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const contentFiles = options.contentFiles ?? [{ name: "trait.md", content: "# Test Trait\n\nClean content here." }];
  for (const f of contentFiles) {
    fs.writeFileSync(path.join(dir, f.name), f.content);
  }

  if (options.readme) {
    fs.writeFileSync(path.join(dir, "README.md"), "# Test\n\nReadme content.");
  }

  if (options.behavioralTest) {
    const testsDir = path.join(dir, "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, "behavior.yaml"), "name: test\nscenarios: []");
  }
}

// ===========================================================================
// checkOrgSpecificity
// ===========================================================================

describe("checkOrgSpecificity", () => {
  it("passes for clean content with zero matches", () => {
    const result = checkOrgSpecificity("Clean content with no org-specific references.");
    expect(result.passed).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it("detects internal-domain match (app.internal)", () => {
    const result = checkOrgSpecificity("Visit us at app.internal for details.");
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.matches.some(m => m.category === "internal-domain")).toBe(true);
  });

  it("detects internal-domain match (team.corp)", () => {
    const result = checkOrgSpecificity("Email team@company.corp for support.");
    expect(result.matches.some(m => m.category === "internal-domain")).toBe(true);
  });

  it("detects internal-infra match (vpc-abc123def)", () => {
    const result = checkOrgSpecificity("Deploy to vpc-abc123def in us-east-1.");
    expect(result.matches.some(m => m.category === "internal-infra")).toBe(true);
  });

  it("passes with exactly 1 match (threshold is <=1)", () => {
    // One internal-domain reference should still pass
    const result = checkOrgSpecificity("Check portal.internal for docs.");
    expect(result.matches).toHaveLength(1);
    expect(result.passed).toBe(true);
  });

  it("fails with 2 or more matches", () => {
    const content = "Check portal.internal and also vpc-abc123def for resources.";
    const result = checkOrgSpecificity(content);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.passed).toBe(false);
  });

  it("skips frontmatter blocks", () => {
    const content = `---
title: portal.internal
vpc: vpc-abc123def
---
Clean content below frontmatter.`;
    const result = checkOrgSpecificity(content);
    expect(result.matches).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("skips code blocks (triple backtick)", () => {
    const content = `Some text.

\`\`\`
portal.internal
vpc-abc123def
\`\`\`

More clean text.`;
    const result = checkOrgSpecificity(content);
    expect(result.matches).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("detects internal-tool-ref pattern (JIRA-style)", () => {
    const result = checkOrgSpecificity("Fixed in AB-1234 and PROJ-567.");
    expect(result.matches.some(m => m.category === "internal-tool-ref")).toBe(true);
  });

  it("detects internal-naming pattern (my-company)", () => {
    const result = checkOrgSpecificity("Use my-company package for auth.");
    expect(result.matches.some(m => m.category === "internal-naming")).toBe(true);
  });

  it("truncates long content in match to 120 chars", () => {
    const longLine = "x".repeat(200) + " portal.internal";
    const result = checkOrgSpecificity(longLine);
    for (const m of result.matches) {
      expect(m.content.length).toBeLessThanOrEqual(120);
    }
  });
});

// ===========================================================================
// validateContribution
// ===========================================================================

describe("validateContribution", () => {
  it("passes for a valid community contribution", () => {
    const dir = path.join(tmpDir, "valid-community");
    makeValidContribution(dir);

    const result = validateContribution(dir);
    expect(result.passed).toBe(true);
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it("fails when manifest.json is missing", () => {
    const dir = path.join(tmpDir, "no-manifest");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "trait.md"), "# Trait\n\nContent.");

    const result = validateContribution(dir);
    expect(result.passed).toBe(false);
    const manifestCheck = result.checks.find(c => c.name === "manifest-exists");
    expect(manifestCheck).toBeDefined();
    expect(manifestCheck!.passed).toBe(false);
  });

  it("fails when GPL license is specified in manifest", () => {
    const dir = path.join(tmpDir, "gpl-license");
    makeValidContribution(dir, {
      manifest: {
        id: "trait/gpl",
        name: "gpl",
        type: "trait",
        version: "1.0.0",
        description: "GPL trait",
        license: "GPL-3.0",
        author: { handle: "test-user-1" },
      },
    });

    const result = validateContribution(dir);
    expect(result.passed).toBe(false);
    const licenseCheck = result.checks.find(c => c.name === "license-valid");
    expect(licenseCheck).toBeDefined();
    expect(licenseCheck!.passed).toBe(false);
    expect(licenseCheck!.message).toContain("GPL");
  });

  it("fails when no content files exist", () => {
    const dir = path.join(tmpDir, "no-content");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
      id: "trait/empty", name: "empty", type: "trait", version: "1.0.0",
      description: "Empty", license: "MIT", author: { handle: "test-user-1" },
    }));

    const result = validateContribution(dir);
    expect(result.passed).toBe(false);
    const contentCheck = result.checks.find(c => c.name === "content-exists");
    expect(contentCheck).toBeDefined();
    expect(contentCheck!.passed).toBe(false);
  });

  it("detects secrets (AKIA pattern) in content files", () => {
    const dir = path.join(tmpDir, "has-secrets");
    makeValidContribution(dir, {
      contentFiles: [{ name: "trait.md", content: "# Trait\n\nKey: AKIAIOSFODNN7EXAMPLE" }],
    });

    const result = validateContribution(dir);
    expect(result.passed).toBe(false);
    const secretsCheck = result.checks.find(c => c.name === "no-secrets");
    expect(secretsCheck).toBeDefined();
    expect(secretsCheck!.passed).toBe(false);
    expect(secretsCheck!.message).toContain("Secrets detected");
  });

  it("detects org-specific content in files", () => {
    const dir = path.join(tmpDir, "org-specific");
    makeValidContribution(dir, {
      contentFiles: [{
        name: "trait.md",
        content: "# Trait\n\nUse portal.internal and vpc-abc123def for deploy.",
      }],
    });

    const result = validateContribution(dir);
    expect(result.passed).toBe(false);
    const orgCheck = result.checks.find(c => c.name === "org-specificity");
    expect(orgCheck).toBeDefined();
    expect(orgCheck!.passed).toBe(false);
  });

  // -- Verified tier --

  it("requires README.md for verified tier", () => {
    const dir = path.join(tmpDir, "verified-no-readme");
    makeValidContribution(dir, { behavioralTest: true });

    const result = validateContribution(dir, { layer: "verified" });
    expect(result.passed).toBe(false);
    const readmeCheck = result.checks.find(c => c.name === "readme-exists");
    expect(readmeCheck).toBeDefined();
    expect(readmeCheck!.passed).toBe(false);
  });

  it("requires behavioral test for verified tier", () => {
    const dir = path.join(tmpDir, "verified-no-test");
    makeValidContribution(dir, { readme: true });

    const result = validateContribution(dir, { layer: "verified" });
    expect(result.passed).toBe(false);
    const testCheck = result.checks.find(c => c.name === "behavioral-test");
    expect(testCheck).toBeDefined();
    expect(testCheck!.passed).toBe(false);
  });

  it("passes verified tier with all requirements met", () => {
    const dir = path.join(tmpDir, "verified-full");
    makeValidContribution(dir, { readme: true, behavioralTest: true });

    const result = validateContribution(dir, { layer: "verified" });
    expect(result.passed).toBe(true);
  });

  it("does not require README or behavioral test for community tier", () => {
    const dir = path.join(tmpDir, "community-no-extras");
    makeValidContribution(dir);

    const result = validateContribution(dir, { layer: "community" });
    expect(result.passed).toBe(true);
    // No behavioral-test or readme-exists checks for community
    expect(result.checks.find(c => c.name === "behavioral-test")).toBeUndefined();
    expect(result.checks.find(c => c.name === "readme-exists")).toBeUndefined();
  });

  it("fails when manifest has no license field", () => {
    const dir = path.join(tmpDir, "no-license");
    makeValidContribution(dir, {
      manifest: {
        id: "trait/nolic", name: "nolic", type: "trait", version: "1.0.0",
        description: "No license", author: { handle: "test-user-1" },
      },
    });

    const result = validateContribution(dir);
    expect(result.passed).toBe(false);
    const licenseCheck = result.checks.find(c => c.name === "license-valid");
    expect(licenseCheck).toBeDefined();
    expect(licenseCheck!.passed).toBe(false);
  });
});

// ===========================================================================
// generateAttribution
// ===========================================================================

describe("generateAttribution", () => {
  it("returns correct structure with handle", () => {
    const attr = generateAttribution("test-user-1");
    expect(attr.handle).toBe("test-user-1");
    expect(attr.profileUrl).toBe("https://agentboot.dev/u/test-user-1");
    expect(attr.org).toBeUndefined();
  });

  it("includes org when provided", () => {
    const attr = generateAttribution("test-user-1", "test-org");
    expect(attr.handle).toBe("test-user-1");
    expect(attr.org).toBe("test-org");
    expect(attr.profileUrl).toBe("https://agentboot.dev/u/test-user-1");
  });

  it("produces a valid ISO timestamp in contributedAt", () => {
    const before = new Date().toISOString();
    const attr = generateAttribution("test-user-1");
    const after = new Date().toISOString();

    // Verify it's a valid ISO date string
    expect(() => new Date(attr.contributedAt)).not.toThrow();
    expect(attr.contributedAt >= before).toBe(true);
    expect(attr.contributedAt <= after).toBe(true);
  });

  it("constructs profileUrl from handle", () => {
    const attr = generateAttribution("jane-doe");
    expect(attr.profileUrl).toBe("https://agentboot.dev/u/jane-doe");
  });
});
