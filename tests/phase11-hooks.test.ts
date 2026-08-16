/**
 * Phase 11 Batch 4: Windows portability (A2)
 *
 * Tests that generated hooks use node -e instead of jq,
 * and include HOME/USERPROFILE fallback.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ensureRootDist } from "./setup.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

// R4-6: existence read as freshness. tests/setup.ts::ensureRootDist() asks the
// build stamp instead — the whole reason it exists.
beforeAll(() => {
  ensureRootDist();
});

describe("A2: jq replaced with node -e in all hooks", () => {
  const hooksDir = path.join(ROOT, "dist", "claude", "core", "hooks");

  it("hooks directory exists", () => {
    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  it("no hook file references jq", () => {
    const files = fs.readdirSync(hooksDir).filter(f => f.endsWith(".sh"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(hooksDir, file), "utf-8");
      // Should not contain 'command -v jq' or 'jq -r' or 'jq -c' or 'jq -n'
      expect(content).not.toMatch(/command -v jq/);
      expect(content).not.toMatch(/jq -[rcn]/);
    }
  });

  it("all hooks use node -e for JSON parsing", () => {
    const files = fs.readdirSync(hooksDir).filter(f => f.endsWith(".sh"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(hooksDir, file), "utf-8");
      expect(content).toContain("node -e");
    }
  });

  it("all hooks check for node availability", () => {
    const files = fs.readdirSync(hooksDir).filter(f => f.endsWith(".sh"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(hooksDir, file), "utf-8");
      expect(content).toContain("command -v node");
    }
  });

  it("hooks include HOME/USERPROFILE fallback", () => {
    const files = fs.readdirSync(hooksDir).filter(f => f.endsWith(".sh"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(hooksDir, file), "utf-8");
      expect(content).toContain("USERPROFILE");
    }
  });

  it("input-scan hook starts with shebang", () => {
    const content = fs.readFileSync(path.join(hooksDir, "agentboot-input-scan.sh"), "utf-8");
    expect(content.startsWith("#!/bin/bash")).toBe(true);
  });

  it("telemetry hook generates valid JSON structure via node", () => {
    const content = fs.readFileSync(path.join(hooksDir, "agentboot-telemetry.sh"), "utf-8");
    // Should contain JSON.stringify for safe JSON construction
    expect(content).toContain("JSON.stringify");
    expect(content).toContain("JSON.parse");
  });
});

describe("A2: CLI home dir resolution", () => {
  it("cli.ts uses USERPROFILE fallback", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "cli.ts"), "utf-8");
    expect(content).toContain('process.env["USERPROFILE"]');
    expect(content).toContain("os.homedir()");
  });
});
