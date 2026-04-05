/**
 * Unit tests for the marketplace registry library (scripts/lib/marketplace.ts).
 *
 * Tests cover:
 * - validateManifest() — valid manifest passes, missing fields fail
 * - validateLicense() — Apache-2.0 passes, GPL-3.0 rejects
 * - searchRegistry() — filters by type, layer, tags
 * - computeSha256() — deterministic hash
 * - CLI command existence (search, pull, publish, registry show up in --help)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  validateManifest,
  validateLicense,
  searchRegistry,
  resolveComponent,
  computeSha256,
  verifySha,
  getChannels,
  loadCachedRegistry,
  writeCachedRegistry,
  getCacheDir,
  type RegistryEntry,
  type RegistryChannel,
  type Registry,
  type ComponentManifest,
} from "../scripts/lib/marketplace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "trait/test-trait",
    name: "test-trait",
    type: "trait",
    layer: "core",
    version: "1.0.0",
    description: "A test trait",
    author: { handle: "tester" },
    license: "Apache-2.0",
    tags: ["test"],
    path: "traits/core/test-trait",
    sha: "abc123",
    ...overrides,
  };
}

function makeRegistry(components: RegistryEntry[]): Registry {
  return {
    $schema: "https://agentboot.dev/schemas/registry/v1.json",
    version: "1",
    generated: new Date().toISOString(),
    components,
  };
}

function makeChannel(name: string, priority: number = 1): RegistryChannel {
  return { name, url: `https://example.com/${name}`, priority };
}

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

describe("validateManifest", () => {
  it("accepts a fully valid manifest", () => {
    const manifest: Partial<ComponentManifest> = {
      id: "trait/good",
      name: "good",
      type: "trait",
      version: "1.0.0",
      description: "A good trait",
      license: "MIT",
      author: { handle: "dev" },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects an empty manifest", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });

  it("rejects missing id", () => {
    const result = validateManifest({
      name: "x", type: "trait", version: "1.0.0",
      description: "d", license: "MIT", author: { handle: "a" },
    } as Partial<ComponentManifest>);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: id");
  });

  it("rejects missing author.handle", () => {
    const result = validateManifest({
      id: "trait/x", name: "x", type: "trait", version: "1.0.0",
      description: "d", license: "MIT", author: {} as any,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: author.handle");
  });

  it("rejects invalid type", () => {
    const result = validateManifest({
      id: "x/y", name: "y", type: "widget" as any, version: "1.0.0",
      description: "d", license: "MIT", author: { handle: "a" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Invalid type"))).toBe(true);
  });

  it("rejects GPL license via manifest validation", () => {
    const result = validateManifest({
      id: "trait/x", name: "x", type: "trait", version: "1.0.0",
      description: "d", license: "GPL-3.0", author: { handle: "a" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("GPL"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateLicense
// ---------------------------------------------------------------------------

describe("validateLicense", () => {
  it("accepts Apache-2.0", () => {
    expect(validateLicense("Apache-2.0")).toEqual({ valid: true });
  });

  it("accepts MIT", () => {
    expect(validateLicense("MIT")).toEqual({ valid: true });
  });

  it("accepts BSD-3-Clause", () => {
    expect(validateLicense("BSD-3-Clause")).toEqual({ valid: true });
  });

  it("accepts ISC", () => {
    expect(validateLicense("ISC")).toEqual({ valid: true });
  });

  it("accepts Unlicense", () => {
    expect(validateLicense("Unlicense")).toEqual({ valid: true });
  });

  it("rejects GPL-3.0", () => {
    const result = validateLicense("GPL-3.0");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("GPL");
  });

  it("rejects AGPL-3.0", () => {
    const result = validateLicense("AGPL-3.0");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("GPL");
  });

  it("rejects GPL-2.0-only", () => {
    const result = validateLicense("GPL-2.0-only");
    expect(result.valid).toBe(false);
  });

  it("rejects unknown license", () => {
    const result = validateLicense("WTFPL");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not in the allowed list");
  });
});

// ---------------------------------------------------------------------------
// searchRegistry
// ---------------------------------------------------------------------------

describe("searchRegistry", () => {
  let tmpDir: string;
  const channelName = "test-search";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mkt-test-"));
    // Monkey-patch HOME to isolate cache
    process.env._ORIG_HOME = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = process.env._ORIG_HOME;
    delete process.env._ORIG_HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedTestRegistry(components: RegistryEntry[]) {
    writeCachedRegistry(channelName, makeRegistry(components));
  }

  it("returns all components when query is empty", () => {
    const entries = [makeEntry({ id: "trait/a", name: "a" }), makeEntry({ id: "trait/b", name: "b" })];
    seedTestRegistry(entries);
    const results = searchRegistry("", [makeChannel(channelName)]);
    expect(results).toHaveLength(2);
  });

  it("filters by query text", () => {
    seedTestRegistry([
      makeEntry({ id: "trait/critical", name: "critical", description: "Critical thinking" }),
      makeEntry({ id: "trait/audit", name: "audit", description: "Audit trail" }),
    ]);
    const results = searchRegistry("critical", [makeChannel(channelName)]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("trait/critical");
  });

  it("filters by type", () => {
    seedTestRegistry([
      makeEntry({ id: "trait/a", name: "a", type: "trait" }),
      makeEntry({ id: "gotcha/b", name: "b", type: "gotcha" }),
    ]);
    const results = searchRegistry("", [makeChannel(channelName)], { type: "gotcha" });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("gotcha");
  });

  it("filters by layer", () => {
    seedTestRegistry([
      makeEntry({ id: "trait/a", name: "a", layer: "core" }),
      makeEntry({ id: "trait/b", name: "b", layer: "community" }),
    ]);
    const results = searchRegistry("", [makeChannel(channelName)], { layer: "community" });
    expect(results).toHaveLength(1);
    expect(results[0].layer).toBe("community");
  });

  it("filters by tags", () => {
    seedTestRegistry([
      makeEntry({ id: "trait/a", name: "a", tags: ["security", "core"] }),
      makeEntry({ id: "trait/b", name: "b", tags: ["quality"] }),
    ]);
    const results = searchRegistry("", [makeChannel(channelName)], { tags: ["security"] });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("trait/a");
  });

  it("deduplicates across channels (first channel wins)", () => {
    // Same ID in both channels — priority channel wins
    const ch1 = makeChannel("ch1", 1);
    const ch2 = makeChannel("ch2", 2);
    writeCachedRegistry("ch1", makeRegistry([
      makeEntry({ id: "trait/x", name: "x", description: "from ch1" }),
    ]));
    writeCachedRegistry("ch2", makeRegistry([
      makeEntry({ id: "trait/x", name: "x", description: "from ch2" }),
    ]));
    const results = searchRegistry("", [ch1, ch2]);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe("from ch1");
  });
});

// ---------------------------------------------------------------------------
// resolveComponent
// ---------------------------------------------------------------------------

describe("resolveComponent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mkt-resolve-"));
    process.env._ORIG_HOME = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = process.env._ORIG_HOME;
    delete process.env._ORIG_HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a component by ID", () => {
    const ch = makeChannel("resolve-test");
    writeCachedRegistry("resolve-test", makeRegistry([
      makeEntry({ id: "trait/target", name: "target", version: "2.0.0" }),
    ]));
    const result = resolveComponent("trait/target", [ch]);
    expect(result).not.toBeNull();
    expect(result!.entry.id).toBe("trait/target");
    expect(result!.channel.name).toBe("resolve-test");
  });

  it("resolves with version pinning", () => {
    const ch = makeChannel("resolve-ver");
    writeCachedRegistry("resolve-ver", makeRegistry([
      makeEntry({ id: "trait/x", name: "x", version: "1.0.0" }),
      makeEntry({ id: "trait/x-v2", name: "x", version: "2.0.0" }),
    ]));
    const result = resolveComponent("trait/x", [ch], "1.0.0");
    expect(result).not.toBeNull();
    expect(result!.entry.version).toBe("1.0.0");
  });

  it("returns null for missing component", () => {
    const ch = makeChannel("resolve-empty");
    writeCachedRegistry("resolve-empty", makeRegistry([]));
    expect(resolveComponent("trait/missing", [ch])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSha256 / verifySha
// ---------------------------------------------------------------------------

describe("computeSha256", () => {
  let tmpFile: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-sha-"));
    tmpFile = path.join(tmpDir, "test.txt");
    fs.writeFileSync(tmpFile, "hello world\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  });

  it("produces a deterministic hex hash", () => {
    const hash1 = computeSha256(tmpFile);
    const hash2 = computeSha256(tmpFile);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when file content changes", () => {
    const hash1 = computeSha256(tmpFile);
    fs.writeFileSync(tmpFile, "different content\n", "utf-8");
    const hash2 = computeSha256(tmpFile);
    expect(hash1).not.toBe(hash2);
  });

  it("verifySha returns true for matching hash", () => {
    const hash = computeSha256(tmpFile);
    expect(verifySha(tmpFile, hash)).toBe(true);
  });

  it("verifySha returns false for wrong hash", () => {
    expect(verifySha(tmpFile, "0".repeat(64))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getChannels
// ---------------------------------------------------------------------------

describe("getChannels", () => {
  it("returns default channel when no config provided", () => {
    const channels = getChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("public");
  });

  it("returns custom channels sorted by priority", () => {
    const channels = getChannels({
      registry: {
        channels: [
          { name: "private", url: "https://priv", priority: 2 },
          { name: "public", url: "https://pub", priority: 1 },
        ],
      },
    });
    expect(channels[0].name).toBe("public");
    expect(channels[1].name).toBe("private");
  });
});

// ---------------------------------------------------------------------------
// CLI command existence
// ---------------------------------------------------------------------------

describe("CLI marketplace commands", () => {
  it("marketplace and registry commands appear in --help", () => {
    const result = spawnSync("npx", ["tsx", path.join(ROOT, "scripts", "cli.ts"), "--help"], {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 30_000,
    });
    const stdout = result.stdout?.toString() ?? "";
    expect(stdout).toContain("marketplace");
    expect(stdout).toContain("registry");
  });

  it("marketplace subcommands (search, pull, publish) appear in marketplace --help", () => {
    const result = spawnSync("npx", ["tsx", path.join(ROOT, "scripts", "cli.ts"), "marketplace", "--help"], {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 30_000,
    });
    const stdout = result.stdout?.toString() ?? "";
    expect(stdout).toContain("search");
    expect(stdout).toContain("pull");
    expect(stdout).toContain("publish");
  });

  it("registry subcommands (channels, refresh, status, seed) appear in registry --help", () => {
    const result = spawnSync("npx", ["tsx", path.join(ROOT, "scripts", "cli.ts"), "registry", "--help"], {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 30_000,
    });
    const stdout = result.stdout?.toString() ?? "";
    expect(stdout).toContain("channels");
    expect(stdout).toContain("refresh");
    expect(stdout).toContain("status");
    expect(stdout).toContain("seed");
  });
});
