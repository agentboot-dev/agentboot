/**
 * Phase 11 Batch 5: Global hub registry (A3)
 *
 * Tests for scripts/lib/registry.ts — hub registration, resolution,
 * default management, and corrupt file recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We test the registry by temporarily pointing it at a temp dir.
// The module uses os.homedir() internally, so we mock the path.
import {
  loadRegistry,
  saveRegistry,
  registerHub,
  getDefaultHub,
  listHubs,
  setDefaultHub,
  removeHub,
  type Registry,
} from "../scripts/lib/registry.js";

describe("A3: Global hub registry", () => {
  let tempDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-registry-"));
    origHome = process.env["HOME"];
    // Override HOME so registry reads/writes to temp dir
    process.env["HOME"] = tempDir;
  });

  afterEach(() => {
    if (origHome !== undefined) {
      process.env["HOME"] = origHome;
    } else {
      delete process.env["HOME"];
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadRegistry returns empty for missing file", () => {
    const registry = loadRegistry();
    expect(registry.version).toBe(1);
    expect(registry.hubs).toEqual([]);
    expect(registry.defaultHub).toBeUndefined();
  });

  it("saveRegistry + loadRegistry roundtrip", () => {
    const registry: Registry = {
      version: 1,
      defaultHub: "/path/to/hub",
      hubs: [{ path: "/path/to/hub", org: "test-org", registeredAt: "2026-04-26T00:00:00Z" }],
    };
    saveRegistry(registry);
    const loaded = loadRegistry();
    expect(loaded.defaultHub).toBe("/path/to/hub");
    expect(loaded.hubs).toHaveLength(1);
    expect(loaded.hubs[0]!.org).toBe("test-org");
  });

  it("registerHub + listHubs roundtrip", () => {
    const hubPath = path.join(tempDir, "my-hub");
    fs.mkdirSync(hubPath);
    registerHub(hubPath, "my-org");
    const hubs = listHubs();
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.path).toBe(hubPath);
    expect(hubs[0]!.org).toBe("my-org");
  });

  it("registerHub auto-sets default for first hub", () => {
    const hubPath = path.join(tempDir, "first-hub");
    fs.mkdirSync(hubPath);
    registerHub(hubPath);
    expect(getDefaultHub()).toBe(hubPath);
  });

  it("registerHub updates existing entry instead of duplicating", () => {
    const hubPath = path.join(tempDir, "dup-hub");
    fs.mkdirSync(hubPath);
    registerHub(hubPath, "org-v1");
    registerHub(hubPath, "org-v2");
    const hubs = listHubs();
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.org).toBe("org-v2");
  });

  it("getDefaultHub returns null when no hubs registered", () => {
    expect(getDefaultHub()).toBeNull();
  });

  it("setDefaultHub switches the active hub", () => {
    const hub1 = path.join(tempDir, "hub-1");
    const hub2 = path.join(tempDir, "hub-2");
    fs.mkdirSync(hub1);
    fs.mkdirSync(hub2);
    registerHub(hub1, "org-1");
    registerHub(hub2, "org-2");
    expect(getDefaultHub()).toBe(hub1); // first registered = default
    setDefaultHub(hub2);
    expect(getDefaultHub()).toBe(hub2);
  });

  it("setDefaultHub throws for unregistered hub", () => {
    expect(() => setDefaultHub("/nonexistent")).toThrow("Hub not registered");
  });

  it("removeHub removes entry and updates default", () => {
    const hub1 = path.join(tempDir, "rem-hub-1");
    const hub2 = path.join(tempDir, "rem-hub-2");
    fs.mkdirSync(hub1);
    fs.mkdirSync(hub2);
    registerHub(hub1);
    registerHub(hub2);
    removeHub(hub1);
    expect(listHubs()).toHaveLength(1);
    expect(getDefaultHub()).toBe(hub2);
  });

  it("removeHub clears the default to undefined (not '') when the last hub is removed", () => {
    const hub = path.join(tempDir, "solo-hub");
    fs.mkdirSync(hub);
    registerHub(hub);
    expect(getDefaultHub()).toBe(hub);
    removeHub(hub);
    expect(listHubs()).toHaveLength(0);
    expect(getDefaultHub()).toBeNull();
    // Explicit: defaultHub must be undefined, never "" — an empty-string default is a
    // truthy/falsy footgun in getDefaultHub()/resolveHubRoot() (it is falsy, so behavior
    // happens to be correct, but the value should stay undefined per the type).
    expect(loadRegistry().defaultHub).toBeUndefined();
  });

  it("corrupt file is backed up and fresh registry returned", () => {
    const registryDir = path.join(tempDir, ".agentboot");
    fs.mkdirSync(registryDir, { recursive: true });
    const registryPath = path.join(registryDir, "config.json");
    fs.writeFileSync(registryPath, "NOT VALID JSON {{{");
    const registry = loadRegistry();
    expect(registry.hubs).toEqual([]);
    // Backup file should exist
    const backups = fs.readdirSync(registryDir).filter(f => f.startsWith("config.json.corrupt."));
    expect(backups.length).toBe(1);
  });

  it("single-hub auto-select: getDefaultHub returns the only hub even without explicit default", () => {
    const hubPath = path.join(tempDir, "only-hub");
    fs.mkdirSync(hubPath);
    // Manually write a registry with no defaultHub but one entry
    const registryDir = path.join(tempDir, ".agentboot");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, "config.json"), JSON.stringify({
      version: 1,
      hubs: [{ path: hubPath, registeredAt: "2026-04-26T00:00:00Z" }],
    }));
    expect(getDefaultHub()).toBe(hubPath);
  });
});
