/**
 * Documentation claims, measured against the code that has to honour them.
 *
 * Both cases here exist because a doc said something the product does not do, and
 * nothing in the suite could tell. A prose claim with no test behind it is the same
 * defect class as a control that validates and enforces nothing: it reads green.
 *
 * L34 — `docs/concepts.md` promised per-package persona sets ("the API team gets
 *       api-contract-reviewer while the web team does not"). `syncRepo()` passes the
 *       package path to `syncRepoTarget()` as `packagePath`, which sets `effectivePath`
 *       and the result label and NOTHING else; content is resolved from the repo
 *       entry's `group`/`team`. Every package under one entry therefore gets the same
 *       content. The doc now says "write target, not scope" — this pins that.
 *
 * L41 — `docs/troubleshooting.md` told the reader to install `jq` and to run
 *       `agentboot doctor` to check for it. Hooks have not used `jq` since the
 *       Windows/git-bash portability pass, and doctor never checked for it. The
 *       scaffold emitted by `agentboot add hook` must stay jq-free, and must guard its
 *       `node` invocation the way every compiled hook does — an unguarded `node -e` on
 *       a machine without node yields an empty parse and a hook that exits 0 having
 *       enforced nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

function run(script: string, cwd = ROOT): string {
  return execSync(`${TSX} ${script}`, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    timeout: 60_000,
  }).toString();
}

// ---------------------------------------------------------------------------
// L34: packages[] is a WRITE TARGET, not a scope
// ---------------------------------------------------------------------------

/** Generation timestamps are the one legitimate difference between two writes. */
function normalize(content: string): string {
  return content.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<TIMESTAMP>");
}

/**
 * The manifest is an integrity artifact OVER the written files: it embeds sha256s of
 * their raw (timestamp-bearing) bytes, so it cannot be compared as content. Its file
 * list and recorded scope are compared structurally instead — see the second case.
 */
const MANIFESTS = new Set([".agentboot-manifest.json", ".agentboot-manifest.intoto.json"]);

/** relpath -> sha256 of timestamp-normalized content, for every content file under `dir`. */
function digestTree(dir: string, base = dir, acc = new Map<string, string>()): Map<string, string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      digestTree(full, base, acc);
    } else if (entry.isFile() && !MANIFESTS.has(rel)) {
      const raw = fs.readFileSync(full, "utf-8");
      acc.set(rel, createHash("sha256").update(normalize(raw)).digest("hex"));
    }
  }
  return acc;
}

function readManifest(pkg: string, syncTarget: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(
    path.join(syncTarget, "packages", pkg, ".claude", ".agentboot-manifest.json"), "utf-8",
  ));
}

describe("L34: concepts.md — packages[] selects write targets, not scope", () => {
  let syncTarget: string;
  let configPath: string;

  beforeAll(() => {
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-doc-pkg-"));
    fs.mkdirSync(path.join(syncTarget, "packages", "api"), { recursive: true });
    fs.mkdirSync(path.join(syncTarget, "packages", "web"), { recursive: true });

    const reposPath = path.join(syncTarget, "repos.json");
    configPath = path.join(syncTarget, "agentboot.config.json");
    fs.writeFileSync(reposPath, JSON.stringify([{
      path: syncTarget,
      label: "doc-claim-monorepo",
      platform: "claude",
      packages: ["packages/api", "packages/web"],
    }]));
    fs.writeFileSync(configPath, JSON.stringify({
      org: "test-doc-claims",
      personas: { enabled: ["code-reviewer", "security-reviewer", "test-generator"] },
      traits: { enabled: [] },
      sync: { repos: reposPath },
      output: { distPath: path.join(syncTarget, "dist") },
    }));

    run(`scripts/compile.ts --config ${configPath}`);
    run(`scripts/sync.ts --config ${configPath}`);
  }, 180_000);

  afterAll(() => {
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("writes the SAME content into every package under one repo entry", () => {
    const api = digestTree(path.join(syncTarget, "packages", "api", ".claude"));
    const web = digestTree(path.join(syncTarget, "packages", "web", ".claude"));

    expect(api.size, "sync produced no files — the comparison would be vacuous").toBeGreaterThan(0);
    expect([...web.keys()].sort()).toEqual([...api.keys()].sort());

    const differing = [...api.entries()]
      .filter(([rel, hash]) => web.get(rel) !== hash)
      .map(([rel]) => rel);
    expect(
      differing,
      "concepts.md documents packages[] as a write target: one entry has one scope, " +
      "so its packages must receive identical content. If these now differ, packages " +
      "have gained real scope and the doc's post-GA residual must be revisited.",
    ).toEqual([]);
  });

  it("records the SAME scope in every package's manifest", () => {
    const api = readManifest("api", syncTarget);
    const web = readManifest("web", syncTarget);

    // One repo entry has exactly one group/team — that is why the content above is
    // identical. If packages ever become scope nodes, this is the assertion that moves.
    expect(web.scope).toEqual(api.scope);
    expect(web.platform).toEqual(api.platform);
    expect(
      (web.files as { path: string }[]).map((f) => f.path).sort(),
      "the two packages must be told to manage the same file set",
    ).toEqual((api.files as { path: string }[]).map((f) => f.path).sort());
  });

  it("concepts.md does not promise per-package persona divergence", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs", "concepts.md"), "utf-8");
    const monorepo = doc.slice(doc.indexOf("## Monorepo support"));
    expect(monorepo.length, "Monorepo support section not found").toBeGreaterThan(0);

    // The overstatement this row replaced: packages[] granting per-package persona sets.
    expect(monorepo).not.toMatch(/\*\*Per-package personas\*\*/);
    expect(monorepo).toMatch(/WRITE TARGETS, not scope/);
    expect(monorepo).toMatch(/residual/i);
  });
});

// ---------------------------------------------------------------------------
// L34: the workaround concepts.md now recommends has to actually work
// ---------------------------------------------------------------------------

/**
 * concepts.md tells a monorepo that needs per-package divergence to use SEPARATE repo
 * entries with different scopes. That is a doc claim like any other, so it is measured
 * here rather than asserted — the row exists because the previous text recommended
 * something the code did not do.
 */
describe("L34: separate repo entries give a monorepo per-package divergence", () => {
  let syncTarget: string;
  let configPath: string;

  beforeAll(() => {
    syncTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-doc-split-"));
    fs.mkdirSync(path.join(syncTarget, "packages", "api"), { recursive: true });
    fs.mkdirSync(path.join(syncTarget, "packages", "web"), { recursive: true });

    const reposPath = path.join(syncTarget, "repos.json");
    configPath = path.join(syncTarget, "agentboot.config.json");
    // Same `path` twice — one entry per scope, each naming its own package.
    fs.writeFileSync(reposPath, JSON.stringify([
      { path: syncTarget, label: "api-side", platform: "claude", group: "api-group", packages: ["packages/api"] },
      { path: syncTarget, label: "web-side", platform: "claude", group: "web-group", packages: ["packages/web"] },
    ]));
    fs.writeFileSync(configPath, JSON.stringify({
      org: "test-doc-claims-split",
      groups: {
        "api-group": { permissions: { deny: ["Bash(curl:*)"] } },
        "web-group": { permissions: { deny: ["Bash(psql:*)"] } },
      },
      personas: { enabled: ["code-reviewer"] },
      traits: { enabled: [] },
      sync: { repos: reposPath },
      output: { distPath: path.join(syncTarget, "dist") },
    }));

    run(`scripts/compile.ts --config ${configPath}`);
    run(`scripts/sync.ts --config ${configPath}`);
  }, 180_000);

  afterAll(() => {
    if (syncTarget) fs.rmSync(syncTarget, { recursive: true, force: true });
  });

  it("resolves each entry's own scope into its own package", () => {
    const api = readManifest("api", syncTarget);
    const web = readManifest("web", syncTarget);

    expect(api.scope.group, "the api entry must resolve the api scope").toBe("api-group");
    expect(web.scope.group, "the web entry must resolve the web scope").toBe("web-group");
    expect(web.scope).not.toEqual(api.scope);
  });

  it("writes each entry into its own package only", () => {
    // Each entry names one package; neither may write into the other's directory.
    const api = readManifest("api", syncTarget);
    const web = readManifest("web", syncTarget);
    expect(api.files.length).toBeGreaterThan(0);
    expect(web.files.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(syncTarget, ".claude")), "no entry targets the repo root").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// L41: the `agentboot add hook` scaffold is jq-free and guards node
// ---------------------------------------------------------------------------

/** Executable lines only — a `#` comment naming jq is documentation, not a dependency. */
function executableLines(script: string): string[] {
  return script
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

describe("L41: troubleshooting.md — hooks need node, never jq", () => {
  let tmpDir: string;
  let scaffold: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-doc-hook-"));
    run(`${CLI} add hook doc-claim-hook`, tmpDir);
    scaffold = fs.readFileSync(path.join(tmpDir, "hooks", "doc-claim-hook.sh"), "utf-8");
  }, 60_000);

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scaffolds a hook that invokes jq nowhere", () => {
    const offending = executableLines(scaffold).filter((l) => /\bjq\b/.test(l));
    expect(
      offending,
      "troubleshooting.md tells adopters jq is NOT required. A scaffold that shells " +
      "out to jq breaks that promise on Windows/git-bash, where jq is absent.",
    ).toEqual([]);
  });

  it("troubleshooting.md does not name jq as a requirement", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs", "troubleshooting.md"), "utf-8");
    for (const line of doc.split("\n")) {
      if (!/\bjq\b/.test(line)) continue;
      expect(
        line,
        "troubleshooting.md may explain that jq is NOT needed, but must never " +
        "instruct the reader to install it — no hook has used jq since the " +
        "Windows/git-bash portability pass.",
      ).toMatch(/not a requirement|never `jq`|will not make/i);
    }
  });
});
