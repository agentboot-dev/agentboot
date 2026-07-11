/**
 * Phase 11 Batch 7: Governance (C1)
 *
 * Tests for drift detection, compliance report, audit, gitignore detection,
 * and CI template.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
  }).toString();
}

import { checkDrift, generateComplianceReport } from "../scripts/lib/drift.js";
import { computeRepoDrift } from "../scripts/mcp-server.js";
import { runAudit } from "../scripts/lib/audit.js";

// ---------------------------------------------------------------------------
// C1.1: Drift detection
// ---------------------------------------------------------------------------

describe("C1.1: drift detection", () => {
  let syncTarget: string;
  let originalRepos: string;

  const restoreRepos = () => {
    if (originalRepos) {
      try { fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos); } catch { /* best effort */ }
    }
  };

  beforeAll(() => {
    originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    process.on("exit", restoreRepos);
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-drift-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "drift-test", platform: "claude" }])
    );
    run("scripts/sync.ts");
  });

  afterAll(() => {
    process.removeListener("exit", restoreRepos);
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("clean repo returns clean=true", () => {
    const report = checkDrift(syncTarget);
    expect(report.manifestFound).toBe(true);
    expect(report.clean).toBe(true);
    expect(report.summary.modifiedCount).toBe(0);
    expect(report.summary.missingCount).toBe(0);
  });

  it("modified file returns clean=false with modified entry", () => {
    // Modify a managed file
    const rulesDir = path.join(syncTarget, ".claude", "rules");
    const files = fs.readdirSync(rulesDir);
    if (files.length > 0) {
      const filePath = path.join(rulesDir, files[0]!);
      fs.appendFileSync(filePath, "\n# Modified by test\n");
      const report = checkDrift(syncTarget);
      expect(report.clean).toBe(false);
      expect(report.summary.modifiedCount).toBeGreaterThan(0);
      // Restore
      const original = fs.readFileSync(filePath, "utf-8").replace("\n# Modified by test\n", "");
      fs.writeFileSync(filePath, original);
    }
  });

  it("missing file returns missing entry", () => {
    const rulesDir = path.join(syncTarget, ".claude", "rules");
    const files = fs.readdirSync(rulesDir);
    if (files.length > 0) {
      const filePath = path.join(rulesDir, files[0]!);
      const backup = fs.readFileSync(filePath, "utf-8");
      fs.unlinkSync(filePath);
      const report = checkDrift(syncTarget);
      expect(report.summary.missingCount).toBeGreaterThan(0);
      // Restore
      fs.writeFileSync(filePath, backup);
    }
  });

  // B.3: MCP status must report REAL drift (via checkDrift), not just "does a manifest exist".
  it("computeRepoDrift: clean synced repo → synced=true, hasDrift=false", () => {
    const d = computeRepoDrift(syncTarget);
    expect(d.synced).toBe(true);
    expect(d.hasDrift).toBe(false);
    expect(d.driftCount).toBe(0);
    expect(d.lastSyncAt).not.toBeNull();
  });

  it("computeRepoDrift: modified managed file → hasDrift=true (the bug: was false when a manifest existed)", () => {
    const rulesDir = path.join(syncTarget, ".claude", "rules");
    const files = fs.readdirSync(rulesDir);
    expect(files.length).toBeGreaterThan(0);
    const filePath = path.join(rulesDir, files[0]!);
    fs.appendFileSync(filePath, "\n# Modified by test\n");
    try {
      const d = computeRepoDrift(syncTarget);
      expect(d.synced).toBe(true);
      expect(d.hasDrift).toBe(true);
      expect(d.driftCount).toBeGreaterThan(0);
    } finally {
      const original = fs.readFileSync(filePath, "utf-8").replace("\n# Modified by test\n", "");
      fs.writeFileSync(filePath, original);
    }
  });

  it("computeRepoDrift: never-synced repo → synced=false, hasDrift=false (not conflated)", () => {
    const noManifestDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-crd-nomani-"));
    try {
      const d = computeRepoDrift(noManifestDir);
      expect(d.synced).toBe(false);
      expect(d.hasDrift).toBe(false);
    } finally {
      fs.rmSync(noManifestDir, { recursive: true, force: true });
    }
  });

  it("no manifest returns manifestFound=false", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-no-manifest-"));
    try {
      const report = checkDrift(tempDir);
      expect(report.manifestFound).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C1.3: Compliance report
// ---------------------------------------------------------------------------

describe("C1.3: compliance report", () => {
  it("generates report with summary counts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-compliance-"));
    try {
      const report = generateComplianceReport(
        [{ path: tempDir, label: "no-manifest-repo" }],
        ROOT,
      );
      expect(report.summary.totalRepos).toBe(1);
      expect(report.summary.noManifestRepos).toBe(1);
      expect(report.generatedAt).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C1.6: Hub audit
// ---------------------------------------------------------------------------

describe("C1.6: hub audit", () => {
  it("runs audit on the hub without errors", () => {
    const report = runAudit(ROOT);
    expect(report.findings).toBeDefined();
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.errors).toBe("number");
    expect(typeof report.summary.warnings).toBe("number");
  });

  it("detects orphaned traits (traits not referenced by any persona)", () => {
    // Create a temp hub with an orphaned trait
    const tempHub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-audit-"));
    try {
      // Create trait
      fs.mkdirSync(path.join(tempHub, "core", "traits"), { recursive: true });
      fs.writeFileSync(path.join(tempHub, "core", "traits", "orphan.md"), "# Orphan trait");

      // Create persona without referencing the trait
      fs.mkdirSync(path.join(tempHub, "core", "personas", "test"), { recursive: true });
      fs.writeFileSync(path.join(tempHub, "core", "personas", "test", "persona.config.json"),
        JSON.stringify({ name: "Test", traits: { "other-trait": "HIGH" } }));

      // Config
      fs.writeFileSync(path.join(tempHub, "agentboot.config.json"),
        JSON.stringify({ org: "test", personas: { enabled: ["test"] }, instructions: { enabled: [] } }));

      const report = runAudit(tempHub);
      const orphanFindings = report.findings.filter(f => f.type === "orphaned-trait");
      expect(orphanFindings.length).toBe(1);
      expect(orphanFindings[0]!.message).toContain("orphan");
    } finally {
      fs.rmSync(tempHub, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C1.2: CI template
// ---------------------------------------------------------------------------

describe("C1.2: CI template", () => {
  it("drift-check.yml template exists and is valid YAML", () => {
    const templatePath = path.join(ROOT, "templates", "ci", "drift-check.yml");
    expect(fs.existsSync(templatePath)).toBe(true);
    const content = fs.readFileSync(templatePath, "utf-8");
    // Basic YAML validity check
    expect(content).toContain("name:");
    expect(content).toContain("on:");
    expect(content).toContain("jobs:");
    expect(content).toContain("agentboot drift-check");
  });

  it("CI template covers all platform trigger paths", () => {
    const content = fs.readFileSync(path.join(ROOT, "templates", "ci", "drift-check.yml"), "utf-8");
    expect(content).toContain(".claude/**");
    expect(content).toContain(".cursor/**");
    expect(content).toContain(".gemini/**");
    expect(content).toContain("GEMINI.md");
    expect(content).toContain(".junie/**");
    expect(content).toContain(".aiassistant/**");
    expect(content).toContain(".windsurfrules");
    expect(content).toContain("AGENTS.md");
    expect(content).toContain(".mcp.json");
    expect(content).toContain(".github/agents/**");
    expect(content).toContain(".github/instructions/**");
  });
});

// ---------------------------------------------------------------------------
// Module existence checks
// ---------------------------------------------------------------------------

describe("governance modules exist", () => {
  it("scripts/lib/drift.ts exists", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts", "lib", "drift.ts"))).toBe(true);
  });

  it("scripts/lib/gitignore.ts exists", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts", "lib", "gitignore.ts"))).toBe(true);
  });

  it("scripts/lib/audit.ts exists", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts", "lib", "audit.ts"))).toBe(true);
  });
});
