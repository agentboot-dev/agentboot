/**
 * Cross-platform MCP configs + the user-level (~/.claude) write SPI.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensureRootDist } from "./setup.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

beforeAll(() => {
  // NF-1: ask the build stamp, not fs.existsSync — a dist/ another test file
  // pruned still EXISTS, which is how this suite became order-dependent.
  ensureRootDist();
});

// ---------------------------------------------------------------------------
// MCP Config Expansion
// ---------------------------------------------------------------------------

describe("MCP config expansion: cursor", () => {
  it("dist/cursor/ contains .cursor/mcp.json with agentboot entry", () => {
    const mcpPath = path.join(ROOT, "dist", "cursor", "core", ".cursor", "mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.agentboot).toBeDefined();
    expect(content.mcpServers.agentboot.command).toBe("npx");
  });
});

describe("MCP config expansion: jetbrains", () => {
  it("dist/jetbrains/ contains .junie/mcp/mcp.json", () => {
    const mcpPath = path.join(ROOT, "dist", "jetbrains", "core", ".junie", "mcp", "mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.agentboot).toBeDefined();
  });
});

describe("MCP config expansion: gemini", () => {
  it("dist/gemini/ contains .gemini/settings.json with mcpServers", () => {
    const settingsPath = path.join(ROOT, "dist", "gemini", "core", ".gemini", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.agentboot).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// user-level writeDirectly
// ---------------------------------------------------------------------------

import {
  writeDirectly, detectExistingContent, removeUserContent, findTemplateVars,
  isExternallyManaged, resolveUserLevelMode, stageForHandoff, installUserLevel,
} from "../scripts/lib/user-scope.js";

describe("user-level writeDirectly", () => {
  let tempHome: string;
  let origHome: string | undefined;

  beforeAll(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-userscope-"));
    origHome = process.env["HOME"];
    process.env["HOME"] = tempHome;
    // Create a minimal .claude dir
    fs.mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
  });

  afterEach(() => {
    // Cleanup between tests
  });

  afterAll(() => {
    if (origHome !== undefined) {
      process.env["HOME"] = origHome;
    } else {
      delete process.env["HOME"];
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("writes skills and rules to ~/.claude/", () => {
    const distPath = path.join(ROOT, "dist", "claude", "core");
    const result = writeDirectly(distPath);
    expect(result.errors).toHaveLength(0);
    expect(result.skillsWritten.length).toBeGreaterThan(0);
  });

  it("does NOT write CLAUDE.md (composed file)", () => {
    const claudeMdPath = path.join(tempHome, ".claude", "CLAUDE.md");
    // writeDirectly should not create or modify CLAUDE.md
    // (it's listed in skipped)
    const distPath = path.join(ROOT, "dist", "claude", "core");
    const result = writeDirectly(distPath);
    expect(result.skipped).toContain("CLAUDE.md (composed file — left to the external provider)");
  });

  it("does NOT write settings.json (composed file)", () => {
    const distPath = path.join(ROOT, "dist", "claude", "core");
    const result = writeDirectly(distPath);
    expect(result.skipped).toContain("settings.json (composed file — left to the external provider)");
  });

  it("generates user manifest tracking written files", () => {
    const manifestPath = path.join(tempHome, ".claude", ".agentboot-user-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.managed_by).toBe("agentboot");
    expect(manifest.scope).toBe("user");
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it("detectExistingContent finds the manifest", () => {
    const detection = detectExistingContent();
    expect(detection.claudeDirExists).toBe(true);
    expect(detection.hasManifest).toBe(true);
  });

  it("removeUserContent cleans up managed files", () => {
    const { removed, errors } = removeUserContent();
    expect(errors).toHaveLength(0);
    expect(removed.length).toBeGreaterThan(0);
    // Manifest should be removed too
    const detection = detectExistingContent();
    expect(detection.hasManifest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// user-level template-var guard (cross-system audit RISK #2)
// ---------------------------------------------------------------------------

describe("user-level template-var guard", () => {
  it("findTemplateVars detects {{ vars }} and dedupes, ignoring clean content", () => {
    expect(findTemplateVars("no vars here")).toEqual([]);
    expect(
      findTemplateVars("hello {{ HUB_NAME }} and {{ORG}} and {{ HUB_NAME }} again")
    ).toEqual(["{{ HUB_NAME }}", "{{ORG}}"]);
  });

  it("writeDirectly skips files with unresolved template vars, writes clean ones", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-tmplguard-"));
    const origHome = process.env["HOME"];
    process.env["HOME"] = tmp;
    try {
      fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
      const distCore = path.join(tmp, "dist-core");
      const skillsDir = path.join(distCore, "skills");
      fs.mkdirSync(path.join(skillsDir, "poisoned"), { recursive: true });
      fs.mkdirSync(path.join(skillsDir, "clean"), { recursive: true });
      fs.writeFileSync(
        path.join(skillsDir, "poisoned", "SKILL.md"),
        "---\nname: poisoned\n---\n\nHub is {{ HUB_NAME }}.\n"
      );
      fs.writeFileSync(
        path.join(skillsDir, "clean", "SKILL.md"),
        "---\nname: clean\n---\n\nFully resolved content.\n"
      );

      const result = writeDirectly(distCore);

      // Poisoned file is reported and NOT delivered to ~/.claude/
      expect(result.errors.some((e) => e.includes("{{ HUB_NAME }}"))).toBe(true);
      expect(
        fs.existsSync(path.join(tmp, ".claude", "skills", "poisoned", "SKILL.md"))
      ).toBe(false);
      // Clean file is still delivered
      expect(
        fs.existsSync(path.join(tmp, ".claude", "skills", "clean", "SKILL.md"))
      ).toBe(true);
    } finally {
      if (origHome !== undefined) process.env["HOME"] = origHome;
      else delete process.env["HOME"];
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// user-scope module existence
// ---------------------------------------------------------------------------

describe("user-scope module", () => {
  it("scripts/lib/user-scope.ts exists", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts", "lib", "user-scope.ts"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §I: user-level write SPI (mode resolution + sentinel + staging/handoff)
// ---------------------------------------------------------------------------

describe("user-level write SPI (§I)", () => {
  let tmp: string;
  let claudeDir: string;
  let distCore: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-spi-"));
    claudeDir = path.join(tmp, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    // A minimal compiled slot to deliver.
    distCore = path.join(tmp, "dist", "claude", "core");
    fs.mkdirSync(path.join(distCore, "skills", "demo"), { recursive: true });
    fs.writeFileSync(path.join(distCore, "skills", "demo", "SKILL.md"), "# Demo\nresolved content.");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("auto mode writes directly when the slot is NOT externally managed", () => {
    expect(isExternallyManaged(claudeDir)).toBe(false);
    expect(resolveUserLevelMode(undefined, claudeDir)).toBe("direct");
    const res = installUserLevel(distCore, undefined, { claudeDir, stagingDir: path.join(tmp, "stage") });
    expect(res.mode).toBe("direct");
  });

  it("auto mode defers to manifest when the ~/.claude/.managed sentinel is present", () => {
    fs.writeFileSync(path.join(claudeDir, ".managed"), "");
    expect(isExternallyManaged(claudeDir)).toBe(true);
    expect(resolveUserLevelMode(undefined, claudeDir)).toBe("manifest");
    const stagingDir = path.join(tmp, "stage");
    const res = installUserLevel(distCore, undefined, { claudeDir, stagingDir });
    expect(res.mode).toBe("manifest");
    // Staged, with a handoff manifest — and ~/.claude was NOT written.
    expect(fs.existsSync(path.join(stagingDir, "skills", "demo", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(stagingDir, ".agentboot-handoff.json"))).toBe(true);
    expect(fs.existsSync(path.join(claudeDir, "skills", "demo", "SKILL.md"))).toBe(false);
  });

  it("explicit mode overrides the sentinel (direct even when managed; manifest even when not)", () => {
    fs.writeFileSync(path.join(claudeDir, ".managed"), "");
    expect(resolveUserLevelMode({ userLevel: { mode: "direct" } } as never, claudeDir)).toBe("direct");
    fs.rmSync(path.join(claudeDir, ".managed"));
    expect(resolveUserLevelMode({ userLevel: { mode: "manifest" } } as never, claudeDir)).toBe("manifest");
  });

  it("stageForHandoff enforces the template-var guard", () => {
    fs.writeFileSync(path.join(distCore, "skills", "demo", "SKILL.md"), "# Demo\n{{ unresolved_var }}");
    const stagingDir = path.join(tmp, "stage");
    const res = stageForHandoff(distCore, stagingDir);
    expect(res.errors.some(e => e.includes("unresolved_var") || e.includes("template var"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E2 — removeUserContent() had no production caller
// ---------------------------------------------------------------------------

/**
 * `install-user` writes into ~/.claude/ and `removeUserContent()` has existed to
 * undo it since the SPI landed — with zero callers outside tests. User-level
 * artifacts were therefore installable and, in production, permanently
 * unremovable: a revoked user-level control could not be withdrawn by any
 * command the product ships.
 */
describe("E2 — `agentboot uninstall --user`", () => {
  const CLI_E2 = path.join(path.resolve(__dirname, ".."), "bin", "agentboot.js");

  function runE2(args: string[], home: string, cwd: string) {
    const r = spawnSync("node", [CLI_E2, ...args], {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home, NODE_NO_WARNINGS: "1" },
      encoding: "utf-8",
      timeout: 180_000,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  function scaffoldE2Hub(): { base: string; hub: string; home: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-e2-"));
    const hub = path.join(base, "hub");
    const home = path.join(base, "home");
    fs.mkdirSync(home, { recursive: true });
    const r = spawnSync("node",
      [CLI_E2, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
      { cwd: base, env: { ...process.env, HOME: home, USERPROFILE: home, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 });
    if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
    return { base, hub, home };
  }

  it("E2-1: removes what install-user wrote, and the manifest with it", () => {
    const { hub, home } = scaffoldE2Hub();
    expect(runE2(["build"], home, hub).status).toBe(0);
    expect(runE2(["install-user"], home, hub).status).toBe(0);

    const userManifest = path.join(home, ".claude", ".agentboot-user-manifest.json");
    expect(fs.existsSync(userManifest)).toBe(true);
    const tracked = (JSON.parse(fs.readFileSync(userManifest, "utf-8")).files as Array<{ path: string }>)
      .map((f) => path.join(home, ".claude", f.path));
    expect(tracked.length).toBeGreaterThan(0);
    for (const f of tracked) expect(fs.existsSync(f), f).toBe(true);

    const un = runE2(["uninstall", "--user"], home, hub);
    expect(un.status).toBe(0);
    for (const f of tracked) expect(fs.existsSync(f), f).toBe(false);
    expect(fs.existsSync(userManifest)).toBe(false);
  }, 300_000);

  it("E2-2: --dry-run reports the tracked files and removes nothing", () => {
    const { hub, home } = scaffoldE2Hub();
    expect(runE2(["build"], home, hub).status).toBe(0);
    expect(runE2(["install-user"], home, hub).status).toBe(0);
    const userManifest = path.join(home, ".claude", ".agentboot-user-manifest.json");

    const dry = runE2(["uninstall", "--user", "--dry-run"], home, hub);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain("would remove");
    expect(fs.existsSync(userManifest)).toBe(true);
  }, 300_000);

  it("E2-3: says so when there is nothing installed — a skip must not read as a removal", () => {
    const { hub, home } = scaffoldE2Hub();
    const un = runE2(["uninstall", "--user"], home, hub);
    expect(un.status).toBe(0);
    expect(un.out).toContain("No AgentBoot user manifest found");
  }, 300_000);

  it("E2-4: a REPO uninstall says that user-level content was not touched", () => {
    // The dangerous silence: "AgentBoot is removed" vs "AgentBoot is removed
    // from this repo". An operator who believes the first while the second is
    // true has org instructions still loading in every session on the machine.
    const { hub, home } = scaffoldE2Hub();
    expect(runE2(["build"], home, hub).status).toBe(0);
    expect(runE2(["install-user"], home, hub).status).toBe(0);

    const spoke = path.join(path.dirname(hub), "spoke-e2");
    fs.mkdirSync(path.join(spoke, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(spoke, ".claude", ".agentboot-manifest.json"),
      JSON.stringify({ managed_by: "agentboot", files: [] }),
    );
    const un = runE2(["uninstall", "--repo", spoke], home, hub);
    expect(un.out).toContain("user-level AgentBoot content is also installed");
    expect(un.out).toContain("agentboot uninstall --user");
  }, 300_000);
});

// ---------------------------------------------------------------------------
// E1 — install-user never pruned AND de-listed
// ---------------------------------------------------------------------------

/**
 * `writeDirectly` was a pure copy-in, and the manifest it wrote recorded only
 * the NEW write set. So an artifact revoked at the hub was dropped from tracking
 * while remaining on disk in ~/.claude/, still loading in every session — and
 * invisible to `uninstall --user`, which only removes what the manifest lists.
 * 47ef85c's own commit message calls that "strictly worse than leaving it
 * tracked-and-stale".
 */
describe("E1 — install-user withdraws revoked artifacts", () => {
  const CLI_E1 = path.join(path.resolve(__dirname, ".."), "bin", "agentboot.js");

  function runE1(args: string[], home: string, cwd: string) {
    const r = spawnSync("node", [CLI_E1, ...args], {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home, NODE_NO_WARNINGS: "1" },
      encoding: "utf-8",
      timeout: 180_000,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  function scaffoldE1(): { hub: string; home: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-e1-"));
    const hub = path.join(base, "hub");
    const home = path.join(base, "home");
    fs.mkdirSync(home, { recursive: true });
    const r = spawnSync("node",
      [CLI_E1, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
      { cwd: base, env: { ...process.env, HOME: home, USERPROFILE: home, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 });
    if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
    return { hub, home };
  }

  function editCfg(hub: string, fn: (c: any) => void): void {
    const p = path.join(hub, "agentboot.config.json");
    const c = JSON.parse(fs.readFileSync(p, "utf-8"));
    fn(c);
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  }

  const trackedPaths = (home: string): string[] =>
    (JSON.parse(fs.readFileSync(path.join(home, ".claude", ".agentboot-user-manifest.json"), "utf-8"))
      .files as Array<{ path: string }>).map((f) => f.path);

  it("E1-1: a revoked skill is removed from disk AND is not left untracked", () => {
    const { hub, home } = scaffoldE1();
    expect(runE1(["build"], home, hub).status).toBe(0);
    expect(runE1(["install-user"], home, hub).status).toBe(0);

    const revoked = path.join(home, ".claude", "skills", "gen-tests", "SKILL.md");
    expect(fs.existsSync(revoked)).toBe(true); // precondition
    expect(trackedPaths(home)).toContain("skills/gen-tests/SKILL.md");

    editCfg(hub, (c) => {
      c.personas.enabled = c.personas.enabled.filter((p: string) => p !== "test-generator");
    });
    expect(runE1(["build"], home, hub).status).toBe(0);
    const again = runE1(["install-user"], home, hub);
    expect(again.status).toBe(0);
    expect(again.out).toContain("Withdrew 1 revoked artifact(s)");
    expect(again.out).toContain("skills/gen-tests/SKILL.md");

    expect(fs.existsSync(revoked)).toBe(false);
    expect(trackedPaths(home)).not.toContain("skills/gen-tests/SKILL.md");
    // The rest is untouched.
    expect(fs.existsSync(path.join(home, ".claude", "skills", "review-code", "SKILL.md"))).toBe(true);
  }, 300_000);

  it("E1-2: a steady-state re-install prunes nothing, and SAYS so", () => {
    // "0 revoked" and "pruning never ran" printing identically is what let the
    // defect live. Both must be distinguishable.
    const { hub, home } = scaffoldE1();
    expect(runE1(["build"], home, hub).status).toBe(0);
    expect(runE1(["install-user"], home, hub).status).toBe(0);
    const second = runE1(["install-user"], home, hub);
    expect(second.status).toBe(0);
    expect(second.out).toContain("pruned: 0 revoked artifact(s)");
    expect(second.out).not.toContain("Withdrew");
  }, 300_000);

  it("E1-3: a locally-edited revoked artifact is KEPT, warned about, and stays tracked", () => {
    // Silently discarding a local edit is the destructive-surprise class. But
    // dropping it from the manifest would reproduce the original defect exactly:
    // on disk, active, and removable by no command.
    const { hub, home } = scaffoldE1();
    expect(runE1(["build"], home, hub).status).toBe(0);
    expect(runE1(["install-user"], home, hub).status).toBe(0);

    const edited = path.join(home, ".claude", "skills", "gen-tests", "SKILL.md");
    fs.appendFileSync(edited, "\n<!-- local edit -->\n");

    editCfg(hub, (c) => {
      c.personas.enabled = c.personas.enabled.filter((p: string) => p !== "test-generator");
    });
    expect(runE1(["build"], home, hub).status).toBe(0);
    const again = runE1(["install-user"], home, hub);
    expect(again.status).toBe(0);
    expect(again.out).toContain("edited locally, still active");
    expect(fs.existsSync(edited)).toBe(true);
    expect(trackedPaths(home)).toContain("skills/gen-tests/SKILL.md");
  }, 300_000);

  it("E1-4: a first install (no previous manifest) prunes nothing", () => {
    const { hub, home } = scaffoldE1();
    expect(runE1(["build"], home, hub).status).toBe(0);
    const first = runE1(["install-user"], home, hub);
    expect(first.status).toBe(0);
    expect(first.out).toContain("pruned: 0 revoked artifact(s)");
  }, 300_000);
});

// ---------------------------------------------------------------------------
// R1-3 — one path spelling for the user manifest
// ---------------------------------------------------------------------------

/**
 * E1's prune builds its keep-set with `toManifestPath()` (POSIX-normalized)
 * while `generateUserManifest()` wrote `path.relative()` unmodified. On Windows
 * the manifest held `skills\ab\SKILL.md` and the keep-set held
 * `skills/ab/SKILL.md`, so every previously-delivered file missed `kept.has()`,
 * was classified as a revoked orphan, hashed equal (it had just been rewritten
 * unchanged), and was UNLINKED: a second `agentboot install-user` on Windows
 * deleted the artifacts it had installed a moment earlier.
 *
 * The E1 cases above cannot see this — on POSIX the two spellings coincide, and
 * the Windows leg of CI (validate.yml runs `npm test` on windows-latest) had not
 * been run for this branch. These assertions are OS-independent: they pin the
 * INVARIANT (the two producers agree) rather than the platform.
 */
describe("R1-3 — the manifest and the keep-set must spell a path the same way", () => {
  it("R1-3-1: generateUserManifest records exactly what toManifestPath produces", async () => {
    const { generateUserManifest, toManifestPath } = await import("../scripts/lib/user-scope.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-r13-"));
    const file = path.join(dir, "skills", "ab", "SKILL.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");

    const manifest = generateUserManifest([file], dir) as { files: Array<{ path: string }> };
    // This equality IS the defect: pre-fix the left side was path.relative()
    // and the right side was path.relative().replace(/\\/g, "/").
    expect(manifest.files[0].path).toBe(toManifestPath(dir, file));
  });

  it("R1-3-2: a Windows-shaped path is normalized, not recorded with backslashes", async () => {
    const { generateUserManifest } = await import("../scripts/lib/user-scope.js");
    // Windows-shaped inputs, evaluated on whatever OS is running. The recorded
    // path must not carry a separator the keep-set will never produce.
    const claudeDir = "C:\\Users\\x\\.claude";
    const file = "C:\\Users\\x\\.claude\\skills\\ab\\SKILL.md";
    const manifest = generateUserManifest([file], claudeDir) as { files: Array<{ path: string }> };
    expect(manifest.files[0].path).not.toContain("\\");
  });

  it("R1-3-3: a legacy backslash manifest is read as POSIX, so the upgrade prunes nothing", async () => {
    const { loadUserManifestHashes } = await import("../scripts/lib/user-scope.js");
    // Fixing only the writer would make the FIRST post-upgrade install treat
    // every legacy entry as an orphan — the same deletion, once, on the way out.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-r13b-"));
    fs.writeFileSync(
      path.join(dir, ".agentboot-user-manifest.json"),
      JSON.stringify({ files: [{ path: "skills\\ab\\SKILL.md", hash: "deadbeef" }] })
    );
    const loaded = loadUserManifestHashes(dir)!;
    expect(loaded.has("skills/ab/SKILL.md")).toBe(true);
    expect(loaded.has("skills\\ab\\SKILL.md")).toBe(false);
  });

  it("R1-3-4: the staging handoff manifest normalizes too — an external provider consumes it", () => {
    // Same class, second producer. Asserted by reading the source rather than
    // by running Windows: what must hold is that neither manifest writer calls
    // bare path.relative().
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "user-scope.ts"), "utf-8");
    const manifestBlocks = src.split("\n").filter((l) => /path:\s*rel/.test(l));
    expect(manifestBlocks.length).toBeGreaterThan(0);
    // Every `rel`/`relPath` fed into a manifest entry is produced by toManifestPath.
    for (const m of src.matchAll(/const (rel|relPath) = (.+);/g)) {
      expect(m[2], `${m[1]} bypasses toManifestPath`).toContain("toManifestPath(");
    }
  });
});
