/**
 * Regression tests for the getting-started evaluator journey.
 *
 * An audit executed the documented getting-started flow against the published
 * npm package and found deterministic (zero-LLM) failures:
 *
 *  (a) install wizard git detection: a freshly `git init`-ed empty directory
 *      was treated as "an existing project", bouncing brand-new users into
 *      the "create a personas subdirectory instead?" flow.
 *  (b) the scaffolded hub shipped no package.json/package-lock.json while the
 *      hub CI/CD guide's workflow runs `setup-node cache: 'npm'` + `npm ci`,
 *      both of which hard-fail without a lockfile.
 *  (c) documented `import --url` forms hard-failed: github.com /raw/ file
 *      URLs (the "Raw" button link) were misparsed as repos and handed to
 *      `git clone`, and tree URLs were cloned verbatim (not clonable).
 *  (d) the marketplace default channel pointed at a nonexistent repo
 *      (github.com/agentboot/marketplace).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  checkHubTargetContent,
  sanitizeNpmName,
  scaffoldHub,
} from "../scripts/lib/install.js";
import { parseGitHubUrl, toCloneUrl } from "../scripts/lib/import.js";
import { getChannels } from "../scripts/lib/marketplace.js";

// ---------------------------------------------------------------------------
// (a) Hub target git detection — fresh dir / git init / repo with commits
// ---------------------------------------------------------------------------

describe("(a) checkHubTargetContent: wizard git detection", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-journey-a-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("nonexistent directory: no existing content", () => {
    const result = checkHubTargetContent(path.join(tempDir, "does-not-exist"));
    expect(result).toEqual({ hasExistingContent: false, visibleEntryCount: 0 });
  });

  it("fresh empty directory, no git: no existing content", () => {
    const result = checkHubTargetContent(tempDir);
    expect(result).toEqual({ hasExistingContent: false, visibleEntryCount: 0 });
  });

  it("freshly `git init`-ed directory with zero commits: no existing content (the audit break)", () => {
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    const result = checkHubTargetContent(tempDir);
    expect(result.hasExistingContent).toBe(false);
    expect(result.visibleEntryCount).toBe(0);
  });

  it("git repo with commits and files: IS existing content", () => {
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    fs.writeFileSync(path.join(tempDir, "README.md"), "# existing project\n");
    execSync(
      "git add . && git -c user.name=t -c user.email=t@t commit -m init",
      { cwd: tempDir, stdio: "pipe" },
    );
    const result = checkHubTargetContent(tempDir);
    expect(result.hasExistingContent).toBe(true);
    expect(result.visibleEntryCount).toBe(1);
  });

  it("directory with package.json (no git): IS existing content", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"app"}\n');
    expect(checkHubTargetContent(tempDir).hasExistingContent).toBe(true);
  });

  it("directory with src/ (no git): IS existing content", () => {
    fs.mkdirSync(path.join(tempDir, "src"));
    expect(checkHubTargetContent(tempDir).hasExistingContent).toBe(true);
  });

  it("directory with only loose files and no project markers: not existing content", () => {
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "hello\n");
    expect(checkHubTargetContent(tempDir).hasExistingContent).toBe(false);
  });

  it("scaffoldHub into a pre-`git init`-ed zero-commit dir works and creates the initial commit", () => {
    execSync("git init", { cwd: tempDir, stdio: "pipe" });
    expect(() => scaffoldHub(tempDir, "test-org", "Test Org")).not.toThrow();
    const log = execSync("git log --oneline -1", { cwd: tempDir, encoding: "utf-8" });
    expect(log).toContain("initialize AgentBoot personas hub");
    // git rev-parse HEAD must now succeed (exactly one commit history root)
    const commits = execSync("git rev-list --count HEAD", { cwd: tempDir, encoding: "utf-8" });
    expect(commits.trim()).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// (b) Scaffolded hub is `npm ci`-compatible
// ---------------------------------------------------------------------------

describe("(b) scaffoldHub: package.json + package-lock.json pair", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-journey-b-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a matching package.json and package-lock.json", () => {
    scaffoldHub(tempDir, "acme", "Acme");
    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf-8"));
    const lock = JSON.parse(fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf-8"));
    expect(pkg.private).toBe(true);
    expect(lock.lockfileVersion).toBe(3);
    // npm ci rejects the pair unless name/version match exactly
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""]).toEqual({ name: pkg.name, version: pkg.version });
  });

  it("`npm ci --dry-run` accepts the scaffolded manifest/lockfile pair (offline)", () => {
    scaffoldHub(tempDir, "acme", "Acme");
    const result = spawnSync(
      "npm",
      ["ci", "--dry-run", "--offline", "--no-audit", "--no-fund"],
      { cwd: tempDir, encoding: "utf-8", timeout: 60_000, shell: process.platform === "win32" },
    );
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
      return; // npm not installed in this environment — nothing to verify
    }
    expect(result.status, result.stderr).toBe(0);
  });

  it("leaves a pre-existing package.json alone and does not invent a lockfile for it", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), '{"name": "my-app"}\n');
    scaffoldHub(tempDir, "acme", "Acme");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf-8"))
      .toBe('{"name": "my-app"}\n');
    // A handwritten lockfile for a manifest we don't own could mismatch —
    // scaffold must not create one.
    expect(fs.existsSync(path.join(tempDir, "package-lock.json"))).toBe(false);
  });

  it("does not overwrite a pre-existing package-lock.json on re-scaffold", () => {
    scaffoldHub(tempDir, "acme", "Acme");
    const lockBefore = fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf-8");
    scaffoldHub(tempDir, "acme", "Acme");
    expect(fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf-8")).toBe(lockBefore);
  });

  it("sanitizeNpmName produces valid npm names", () => {
    expect(sanitizeNpmName("personas")).toBe("personas");
    expect(sanitizeNpmName("My Personas Repo")).toBe("my-personas-repo");
    expect(sanitizeNpmName(".hidden")).toBe("hidden");
    expect(sanitizeNpmName("___")).toBe("personas");
    expect(sanitizeNpmName("")).toBe("personas");
  });
});

// ---------------------------------------------------------------------------
// (c) import --url: documented URL forms
// ---------------------------------------------------------------------------

describe("(c) parseGitHubUrl: documented URL scheme acceptance", () => {
  it("accepts github.com /raw/ file URLs (the 'Raw' button link) as file imports", () => {
    const result = parseGitHubUrl("https://github.com/org/repo/raw/main/CLAUDE.md");
    expect(result).toEqual({
      type: "blob-file",
      owner: "org",
      repo: "repo",
      branch: "main",
      filePath: "CLAUDE.md",
    });
  });

  it("accepts /raw/ URLs with nested paths", () => {
    const result = parseGitHubUrl("https://github.com/org/repo/raw/main/.claude/skills/x/SKILL.md");
    expect(result?.type).toBe("blob-file");
    expect(result?.filePath).toBe(".claude/skills/x/SKILL.md");
  });

  it("still accepts /blob/ file URLs", () => {
    const result = parseGitHubUrl("https://github.com/org/repo/blob/main/SKILL.md");
    expect(result?.type).toBe("blob-file");
    expect(result?.filePath).toBe("SKILL.md");
  });

  it("still accepts raw.githubusercontent.com URLs, including refs/heads form", () => {
    expect(parseGitHubUrl("https://raw.githubusercontent.com/org/repo/main/SKILL.md")?.type)
      .toBe("raw-file");
    expect(parseGitHubUrl("https://raw.githubusercontent.com/org/repo/refs/heads/main/SKILL.md")?.type)
      .toBe("raw-file");
  });

  it("treats tree URLs as repo references", () => {
    expect(parseGitHubUrl("https://github.com/org/repo/tree/main/docs"))
      .toEqual({ type: "repo", owner: "org", repo: "repo" });
  });

  it("toCloneUrl reconstructs a clonable URL from any repo reference", () => {
    // The clone must never use the raw user string: tree URLs, trailing
    // slashes, and query strings are valid references but not clonable.
    for (const url of [
      "https://github.com/some-org/some-repo",
      "https://github.com/some-org/some-repo/",
      "https://github.com/some-org/some-repo.git",
      "https://github.com/some-org/some-repo/tree/main/docs",
      "https://github.com/some-org/some-repo?tab=readme",
      "https://www.github.com/some-org/some-repo",
    ]) {
      const parsed = parseGitHubUrl(url);
      expect(parsed?.type, url).toBe("repo");
      expect(toCloneUrl(parsed!), url).toBe("https://github.com/some-org/some-repo.git");
    }
  });

  it("security checks are not weakened", () => {
    // non-HTTPS rejected
    expect(parseGitHubUrl("http://github.com/org/repo")).toBeNull();
    // non-GitHub hosts rejected
    expect(parseGitHubUrl("https://evil.com/org/repo")).toBeNull();
    // Percent-encoded traversal rejected. (Literal `../` segments never reach
    // the check — WHATWG URL parsing normalizes them away before pathname is
    // read, so they cannot smuggle a traversal either.)
    expect(parseGitHubUrl("https://github.com/org/repo/raw/main/..%2Fsecrets")).toBeNull();
    expect(parseGitHubUrl("https://raw.githubusercontent.com/org/repo/main/..%2F..%2Fetc/passwd")).toBeNull();
    // owner/repo that could read as a git CLI flag rejected
    expect(parseGitHubUrl("https://github.com/-owner/repo")).toBeNull();
    expect(parseGitHubUrl("https://github.com/org/-repo")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) Marketplace default channel points at a real repo
// ---------------------------------------------------------------------------

describe("(d) marketplace default channel", () => {
  it("defaults to the canonical agentboot-dev/agentboot repo", () => {
    const channels = getChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0]!.url).toBe("https://github.com/agentboot-dev/agentboot");
  });
});
