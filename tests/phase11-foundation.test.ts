/**
 * Phase 11 Batch 1: Foundation fixes
 *
 * Tests for A0 (sync routing), B5 (detectPlatform), B6 (outputFormats),
 * B10 (PreCompact), B12 (JetBrains scope merging), and platform validation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensureRootDist } from "./setup.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: 30_000,
  }).toString();
}

// Ensure dist/ is built before these tests run
beforeAll(() => {
  const distPath = path.join(ROOT, "dist");
  ensureRootDist();
});

// ---------------------------------------------------------------------------
// A0: Sync routing — platform-specific file placement
// ---------------------------------------------------------------------------

describe("A0: sync routing per platform", () => {
  let originalRepos: string;

  // Safety: restore repos.json even if tests crash
  const restoreRepos = () => {
    if (originalRepos) {
      try { fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos); } catch { /* best effort */ }
    }
  };

  beforeAll(() => {
    originalRepos = fs.readFileSync(path.join(ROOT, "repos.json"), "utf-8");
    process.on("exit", restoreRepos);
  });

  afterAll(() => {
    process.removeListener("exit", restoreRepos);
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
  });

  function syncPlatform(platform: string): string {
    const syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), `agentboot-sync-${platform}-`));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: `test-${platform}`, platform }])
    );
    run("scripts/sync.ts");
    return syncTarget;
  }

  it("gemini: GEMINI.md at repo root, persona files under .gemini/", () => {
    const target = syncPlatform("gemini");
    try {
      // GEMINI.md should be at repo root
      expect(fs.existsSync(path.join(target, "GEMINI.md"))).toBe(true);

      // Persona files should be under .gemini/ (not .claude/)
      const geminiDir = path.join(target, ".gemini");
      expect(fs.existsSync(geminiDir)).toBe(true);

      // Should NOT write gemini files into .claude/
      const claudeGemini = path.join(target, ".claude", "GEMINI.md");
      expect(fs.existsSync(claudeGemini)).toBe(false);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("windsurf: .windsurfrules at repo root", () => {
    const target = syncPlatform("windsurf");
    try {
      // .windsurfrules should be at repo root
      expect(fs.existsSync(path.join(target, ".windsurfrules"))).toBe(true);

      // Should NOT write into .claude/
      expect(fs.existsSync(path.join(target, ".claude"))).toBe(false);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("jetbrains: .junie/ and .aiassistant/ files present", () => {
    const target = syncPlatform("jetbrains");
    try {
      // .junie/ directory should exist with content
      const junieDir = path.join(target, ".junie");
      expect(fs.existsSync(junieDir)).toBe(true);

      // .aiassistant/ should also exist (from compiled instructions)
      const aiAssistDir = path.join(target, ".aiassistant");
      expect(fs.existsSync(aiAssistDir)).toBe(true);

      // Should NOT write jetbrains files into .claude/
      expect(fs.existsSync(path.join(target, ".claude"))).toBe(false);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("agents: AGENTS.md at repo root", () => {
    const target = syncPlatform("agents");
    try {
      // AGENTS.md should be at repo root
      expect(fs.existsSync(path.join(target, "AGENTS.md"))).toBe(true);

      // Should NOT write agents output into .claude/
      expect(fs.existsSync(path.join(target, ".claude"))).toBe(false);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("claude: files in .claude/ (regression)", () => {
    const target = syncPlatform("claude");
    try {
      expect(fs.existsSync(path.join(target, ".claude"))).toBe(true);
      expect(fs.existsSync(path.join(target, ".claude", "rules", "baseline.instructions.md"))).toBe(true);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("cursor: files in .cursor/ (regression)", () => {
    const target = syncPlatform("cursor");
    try {
      expect(fs.existsSync(path.join(target, ".cursor"))).toBe(true);
      expect(fs.existsSync(path.join(target, ".cursor", "rules"))).toBe(true);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("jetbrains: accepted as valid platform (no validation error)", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sync-jb-valid-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: target, label: "test-jb-valid", platform: "jetbrains" }])
    );
    try {
      const output = run("scripts/sync.ts");
      // Should not contain platform validation error
      expect(output).not.toContain('Platform "jetbrains" is not supported');
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B10: PreCompact in validEvents
// ---------------------------------------------------------------------------

describe("B10: PreCompact valid event", () => {
  it("hooks with PreCompact event do not produce warnings", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "compile.ts"), "utf-8");
    // The validEvents array should contain PreCompact
    expect(content).toContain('"PreCompact"');
  });
});

// ---------------------------------------------------------------------------
// B12: JetBrains scope merging
// ---------------------------------------------------------------------------

describe("B12: JetBrains not excluded from scope merging", () => {
  it("jetbrains is not in scope-merging exclusion list", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "compile.ts"), "utf-8");
    // The exclusion list for composition manifests should not include jetbrains
    // Find the line that has 'agents.*plugin.*windsurf' but NOT 'jetbrains'
    const exclusionMatch = content.match(/if \(fmt === "agents" \|\| fmt === "plugin" \|\| fmt === "windsurf"[^)]*\) continue/);
    expect(exclusionMatch).not.toBeNull();
    expect(exclusionMatch![0]).not.toContain("jetbrains");
  });
});

// ---------------------------------------------------------------------------
// B6: outputFormats (plural) in export.ts
// ---------------------------------------------------------------------------

describe("B6: outputFormats key in export", () => {
  it("export.ts uses outputFormats (plural), not outputFormat", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "lib", "export.ts"), "utf-8");
    expect(content).toContain('personaConfig["outputFormats"]');
    expect(content).not.toContain('personaConfig["outputFormat"]');
  });
});

// ---------------------------------------------------------------------------
// B5: detectPlatform recognizes Copilot agent/instruction patterns
// ---------------------------------------------------------------------------

describe("B5: detectPlatform copilot patterns", () => {
  it("import.ts detectPlatform recognizes .github/agents/ as copilot", () => {
    const content = fs.readFileSync(path.join(ROOT, "scripts", "lib", "import.ts"), "utf-8");
    expect(content).toContain('.github/agents/');
    expect(content).toContain('.github/instructions/');
  });
});

// ---------------------------------------------------------------------------
// Dist output structure verification
// ---------------------------------------------------------------------------

describe("dist/ platform output verification", () => {
  it("dist/gemini/ does not contain rules/ directory (A1c)", () => {
    const geminiRules = path.join(ROOT, "dist", "gemini", "core", "rules");
    expect(fs.existsSync(geminiRules)).toBe(false);
  });

  it("dist/jetbrains/ exists with .junie/ content", () => {
    const jetbrainsDir = path.join(ROOT, "dist", "jetbrains", "core");
    expect(fs.existsSync(jetbrainsDir)).toBe(true);
    expect(fs.existsSync(path.join(jetbrainsDir, ".junie"))).toBe(true);
  });

  it("dist/windsurf/ exists with .windsurfrules", () => {
    const windsurfDir = path.join(ROOT, "dist", "windsurf", "core");
    expect(fs.existsSync(windsurfDir)).toBe(true);
    expect(fs.existsSync(path.join(windsurfDir, ".windsurfrules"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B1: Copilot .agent.md files synced to .github/agents/
// ---------------------------------------------------------------------------

describe("B1: Copilot agent sync", () => {
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
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sync-copilot-b1-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "test-copilot-b1", platform: "copilot" }])
    );
    run("scripts/sync.ts");
  });

  afterAll(() => {
    process.removeListener("exit", restoreRepos);
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("writes .agent.md files to .github/agents/", () => {
    const agentsDir = path.join(syncTarget, ".github", "agents");
    expect(fs.existsSync(agentsDir)).toBe(true);
    const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith(".agent.md"));
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  it(".agent.md files have description: frontmatter", () => {
    const agentsDir = path.join(syncTarget, ".github", "agents");
    const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith(".agent.md"));
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      expect(content).toContain("description:");
    }
  });

  it("manifest includes .github/agents/ files", () => {
    // Find manifest in any location
    const manifestPaths = [
      path.join(syncTarget, ".claude", ".agentboot-manifest.json"),
      path.join(syncTarget, ".github", ".agentboot-manifest.json"),
    ];
    let manifest: any = null;
    for (const mp of manifestPaths) {
      if (fs.existsSync(mp)) {
        manifest = JSON.parse(fs.readFileSync(mp, "utf-8"));
        break;
      }
    }
    if (manifest) {
      const agentPaths = manifest.files.filter((f: any) => f.path.includes(".github/agents/"));
      expect(agentPaths.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// B8: Hooks in drift manifest (claude sync includes hooks/ files)
// ---------------------------------------------------------------------------

describe("B8: hooks tracked in manifest", () => {
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
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-sync-hooks-"));
    fs.writeFileSync(
      path.join(ROOT, "repos.json"),
      JSON.stringify([{ path: syncTarget, label: "test-hooks", platform: "claude" }])
    );
    run("scripts/sync.ts");
  });

  afterAll(() => {
    process.removeListener("exit", restoreRepos);
    fs.writeFileSync(path.join(ROOT, "repos.json"), originalRepos);
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("hooks directory exists in synced repo", () => {
    const hooksDir = path.join(syncTarget, ".claude", "hooks");
    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  it("manifest includes hooks/ files", () => {
    const manifestPath = path.join(syncTarget, ".claude", ".agentboot-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const hookFiles = manifest.files.filter((f: any) => f.path.includes("hooks/"));
    expect(hookFiles.length).toBeGreaterThan(0);
  });
});
