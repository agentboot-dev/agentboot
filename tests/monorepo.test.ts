/**
 * AB-142: Monorepo support tests.
 *
 * Tests that sync correctly handles the `packages` field in repos.json entries,
 * deploying personas to individual package subdirectories within a monorepo.
 *
 * Uses isolated temp config + repos files to avoid contention with pipeline.test.ts
 * which also modifies the shared repos.json during parallel test execution.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
  }).toString();
}

/**
 * Create a temp config + repos.json pair for sync testing.
 * Returns the --config flag to pass to sync.ts.
 */
function createTempSyncConfig(
  tempDir: string,
  repos: unknown[]
): string {
  const reposPath = path.join(tempDir, "repos.json");
  const configPath = path.join(tempDir, "agentboot.config.json");

  fs.writeFileSync(reposPath, JSON.stringify(repos));
  fs.writeFileSync(configPath, JSON.stringify({
    org: "test-monorepo",
    personas: { enabled: ["review-code", "review-security", "gen-tests", "gen-testdata"] },
    traits: { enabled: [] },
    sync: { repos: reposPath },
    output: { distPath: path.join(ROOT, "dist") },
  }));

  return configPath;
}

// Ensure dist/ is built before sync tests run.
beforeAll(() => {
  const distPath = path.join(ROOT, "dist");
  if (!fs.existsSync(path.join(distPath, "claude", "core"))) {
    run("scripts/compile.ts");
  }
});

// ---------------------------------------------------------------------------
// Monorepo sync with packages config
// ---------------------------------------------------------------------------

describe("AB-142: monorepo sync with packages", () => {
  let syncTarget: string;
  let configPath: string;

  beforeAll(() => {
    // Create a fake monorepo with two packages
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-monorepo-"));
    fs.mkdirSync(path.join(syncTarget, "packages", "api"), { recursive: true });
    fs.mkdirSync(path.join(syncTarget, "packages", "web"), { recursive: true });

    configPath = createTempSyncConfig(syncTarget, [{
      path: syncTarget,
      label: "monorepo-test",
      platform: "claude",
      packages: ["packages/api", "packages/web"],
    }]);
  });

  afterAll(() => {
    if (syncTarget) {
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  it("syncs to each package subdirectory", () => {
    const output = run(`scripts/sync.ts --config ${configPath}`);
    // Should report success for both packages
    expect(output).toContain("packages/api");
    expect(output).toContain("packages/web");
  });

  it("creates .claude/ in each package", () => {
    expect(fs.existsSync(path.join(syncTarget, "packages", "api", ".claude"))).toBe(true);
    expect(fs.existsSync(path.join(syncTarget, "packages", "web", ".claude"))).toBe(true);
  });

  it("does NOT create .claude/ at repo root", () => {
    // With packages configured, sync targets packages — not repo root.
    expect(fs.existsSync(path.join(syncTarget, ".claude"))).toBe(false);
  });

  it("writes skills to each package", () => {
    const skills = ["review-code", "review-security", "gen-tests", "gen-testdata"];
    for (const pkg of ["api", "web"]) {
      for (const skill of skills) {
        const skillPath = path.join(syncTarget, "packages", pkg, ".claude", "skills", skill, "SKILL.md");
        expect(fs.existsSync(skillPath), `packages/${pkg} should have skills/${skill}/SKILL.md`).toBe(true);
      }
    }
  });

  it("generates per-package manifests", () => {
    for (const pkg of ["api", "web"]) {
      const manifestPath = path.join(syncTarget, "packages", pkg, ".claude", ".agentboot-manifest.json");
      expect(fs.existsSync(manifestPath), `packages/${pkg} should have manifest`).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest.managed_by).toBe("agentboot");
      expect(Array.isArray(manifest.files)).toBe(true);
      expect(manifest.files.length).toBeGreaterThan(0);
    }
  });

  it("writes PERSONAS.md to each package", () => {
    for (const pkg of ["api", "web"]) {
      expect(
        fs.existsSync(path.join(syncTarget, "packages", pkg, ".claude", "PERSONAS.md"))
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Skipping non-existent packages
// ---------------------------------------------------------------------------

describe("AB-142: non-existent package handling", () => {
  let syncTarget: string;
  let configPath: string;

  beforeAll(() => {
    // Create monorepo with only one of the configured packages existing
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-monorepo-missing-"));
    fs.mkdirSync(path.join(syncTarget, "packages", "api"), { recursive: true });
    // Note: packages/web does NOT exist

    configPath = createTempSyncConfig(syncTarget, [{
      path: syncTarget,
      label: "monorepo-missing-pkg",
      platform: "claude",
      packages: ["packages/api", "packages/web"],
    }]);
  });

  afterAll(() => {
    if (syncTarget) {
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  it("warns about non-existent packages and reports errors", () => {
    // Sync should complete (with errors for missing packages) but not crash
    try {
      const output = run(`scripts/sync.ts --config ${configPath}`);
      // If it succeeds, it should still mention the missing package
      expect(output).toContain("packages/web");
    } catch (err: any) {
      // sync exits non-zero when there are errors — this is expected
      const output = err.stdout?.toString() ?? err.message;
      expect(output).toContain("does not exist");
    }
  });

  it("syncs to the existing package", () => {
    expect(fs.existsSync(path.join(syncTarget, "packages", "api", ".claude"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Monorepo detection warning (unconfigured)
// ---------------------------------------------------------------------------

describe("AB-142: monorepo detection warning", () => {
  let syncTarget: string;
  let configPath: string;

  beforeAll(() => {
    // Create a repo that looks like a monorepo (has packages/) but no packages config
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-monorepo-detect-"));
    fs.mkdirSync(path.join(syncTarget, "packages", "core"), { recursive: true });
    fs.mkdirSync(path.join(syncTarget, "packages", "ui"), { recursive: true });

    configPath = createTempSyncConfig(syncTarget, [{
      path: syncTarget,
      label: "monorepo-detect-test",
      platform: "claude",
      // No packages field — should trigger detection warning
    }]);
  });

  afterAll(() => {
    if (syncTarget) {
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  it("warns about detected monorepo structure", () => {
    const output = run(`scripts/sync.ts --config ${configPath}`);
    expect(output).toContain("Monorepo structure detected");
    expect(output).toContain("packages");
  });

  it("still syncs to repo root when no packages configured", () => {
    // Without packages config, sync falls back to repo root
    expect(fs.existsSync(path.join(syncTarget, ".claude"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Apps directory detection
// ---------------------------------------------------------------------------

describe("AB-142: apps/ directory monorepo detection", () => {
  let syncTarget: string;
  let configPath: string;

  beforeAll(() => {
    // Create a repo that uses apps/ instead of packages/
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-monorepo-apps-"));
    fs.mkdirSync(path.join(syncTarget, "apps", "frontend"), { recursive: true });
    fs.mkdirSync(path.join(syncTarget, "apps", "backend"), { recursive: true });

    configPath = createTempSyncConfig(syncTarget, [{
      path: syncTarget,
      label: "apps-monorepo-test",
      platform: "claude",
    }]);
  });

  afterAll(() => {
    if (syncTarget) {
      fs.rmSync(syncTarget, { recursive: true, force: true });
    }
  });

  it("detects apps/ directory as monorepo structure", () => {
    const output = run(`scripts/sync.ts --config ${configPath}`);
    expect(output).toContain("Monorepo structure detected");
  });
});
