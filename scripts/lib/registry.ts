/**
 * Global hub registry — manages registered hubs at ~/.agentboot/config.json.
 *
 * Phase 11 A3: Enables /ab to work in any spoke repo by resolving the hub
 * from a global registry instead of requiring AGENTBOOT_HUB env var.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function getRegistryDir(): string {
  return path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir(), ".agentboot");
}

function getRegistryPath(): string {
  return path.join(getRegistryDir(), "config.json");
}

export interface RegistryHub {
  path: string;
  org?: string | undefined;
  registeredAt: string;
}

export interface Registry {
  version: 1;
  defaultHub?: string | undefined;
  hubs: RegistryHub[];
}

/**
 * Load the global hub registry. Returns an empty registry if the file
 * doesn't exist. On parse error, backs up the corrupt file and returns fresh.
 */
export function loadRegistry(): Registry {
  if (!fs.existsSync(getRegistryPath())) {
    return { version: 1, hubs: [] };
  }
  try {
    const raw = fs.readFileSync(getRegistryPath(), "utf-8");
    return JSON.parse(raw) as Registry;
  } catch {
    // Phase 11 audit: backup corrupt file before replacing (data loss prevention)
    const backupPath = `${getRegistryPath()}.corrupt.${Date.now()}`;
    try {
      fs.copyFileSync(getRegistryPath(), backupPath);
      console.warn(`Registry file corrupt. Backed up to ${backupPath}. Starting fresh.`);
    } catch {
      // Backup failed — continue with fresh registry
    }
    return { version: 1, hubs: [] };
  }
}

/**
 * Save the registry atomically (write to temp, rename).
 */
export function saveRegistry(registry: Registry): void {
  if (!fs.existsSync(getRegistryDir())) {
    fs.mkdirSync(getRegistryDir(), { recursive: true });
  }
  const tmpPath = `${getRegistryPath()}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2));
  fs.renameSync(tmpPath, getRegistryPath());
}

/**
 * Register a hub. Updates existing entry if path already registered.
 * Sets as default if it's the first hub.
 */
export function registerHub(hubPath: string, org?: string): void {
  const absPath = path.resolve(hubPath);
  const registry = loadRegistry();

  const existing = registry.hubs.find(h => h.path === absPath);
  if (existing) {
    existing.org = org ?? existing.org;
    existing.registeredAt = new Date().toISOString();
  } else {
    registry.hubs.push({
      path: absPath,
      org,
      registeredAt: new Date().toISOString(),
    });
  }

  // Auto-set default if first hub
  if (!registry.defaultHub || registry.hubs.length === 1) {
    registry.defaultHub = absPath;
  }

  saveRegistry(registry);
}

/**
 * Get the default hub path, or null if none registered.
 */
export function getDefaultHub(): string | null {
  const registry = loadRegistry();
  if (registry.defaultHub) return registry.defaultHub;
  // Single-hub orgs: auto-select the only hub
  if (registry.hubs.length === 1) return registry.hubs[0]!.path;
  return null;
}

/**
 * List all registered hubs.
 */
export function listHubs(): RegistryHub[] {
  return loadRegistry().hubs;
}

/**
 * Set the default hub by path. Throws if the path is not registered.
 */
export function setDefaultHub(hubPath: string): void {
  const absPath = path.resolve(hubPath);
  const registry = loadRegistry();
  const found = registry.hubs.find(h => h.path === absPath);
  if (!found) {
    throw new Error(`Hub not registered: ${absPath}. Run 'agentboot connect ${absPath}' first.`);
  }
  registry.defaultHub = absPath;
  saveRegistry(registry);
}

/**
 * Remove a hub from the registry.
 */
export function removeHub(hubPath: string): void {
  const absPath = path.resolve(hubPath);
  const registry = loadRegistry();
  registry.hubs = registry.hubs.filter(h => h.path !== absPath);
  if (registry.defaultHub === absPath) {
    registry.defaultHub = registry.hubs[0]?.path;
  }
  saveRegistry(registry);
}
