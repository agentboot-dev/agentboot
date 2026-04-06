/**
 * Marketplace registry library.
 *
 * Provides types, cache management, search/resolve, license validation,
 * SHA verification, and manifest validation for the AgentBoot marketplace.
 *
 * Actual network fetches (git clone, GitHub API) are placeholders — the
 * `registry seed` command generates a local registry from built components
 * so users can test the full flow offline.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  id: string;                    // e.g., "trait/critical-thinking"
  name: string;
  type: "trait" | "gotcha" | "persona" | "domain";
  layer: "core" | "verified" | "community";
  version: string;
  description: string;
  author: {
    handle: string;
    org?: string;
    url?: string;
  };
  license: string;
  tags: string[];
  stats?: {
    downloads?: number;
    orgs?: number;
    lastUpdated?: string;
  };
  path: string;                  // relative path in marketplace repo
  sha: string;                   // SHA-256 of the component file
}

export interface Registry {
  $schema: string;
  version: string;
  generated: string;
  components: RegistryEntry[];
}

export interface ComponentManifest {
  id: string;
  name: string;
  type: "trait" | "gotcha" | "persona" | "domain";
  layer: "core" | "verified" | "community";
  version: string;
  description: string;
  author: { handle: string; org?: string; profileUrl?: string };
  license: string;
  tags: string[];
  compatibility: {
    agentbootMinVersion: string;
    platforms: string[];
  };
  tests?: { behavioral?: boolean; snapshot?: boolean };
  attribution?: { required: boolean; text: string };
}

export interface RegistryChannel {
  name: string;
  url: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(os.homedir(), ".agentboot", "registry", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ALLOWED_LICENSES = ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense"];
const REJECTED_LICENSES = ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only", "LGPL-2.0", "LGPL-2.1", "LGPL-3.0"];
const DEFAULT_CHANNEL: RegistryChannel = {
  name: "public",
  url: "https://github.com/agentboot/marketplace",
  priority: 1,
};

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

export function getCacheDir(): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return CACHE_DIR;
}

function getCachePath(channelName: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(channelName)) {
    throw new Error(`Invalid channel name: ${channelName}`);
  }
  return path.join(getCacheDir(), `${channelName}-registry.json`);
}

export function isCacheValid(channelName: string): boolean {
  const cachePath = getCachePath(channelName);
  if (!fs.existsSync(cachePath)) return false;
  const stat = fs.statSync(cachePath);
  return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
}

export function loadCachedRegistry(channelName: string): Registry | null {
  const cachePath = getCachePath(channelName);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Registry;
  } catch {
    return null;
  }
}

export function writeCachedRegistry(channelName: string, registry: Registry): void {
  const cachePath = getCachePath(channelName);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(registry, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Registry resolution
// ---------------------------------------------------------------------------

export function getChannels(config?: { registry?: { channels?: RegistryChannel[] } }): RegistryChannel[] {
  const channels = config?.registry?.channels ?? [DEFAULT_CHANNEL];
  return channels.sort((a, b) => a.priority - b.priority);
}

/**
 * Search across all registry channels. Returns deduplicated results (first channel wins by priority).
 */
export function searchRegistry(
  query: string,
  channels: RegistryChannel[],
  filters?: { type?: string; layer?: string; tags?: string[] }
): RegistryEntry[] {
  const results: RegistryEntry[] = [];
  const seen = new Set<string>();
  const queryLower = query.toLowerCase();

  for (const channel of channels) {
    const registry = loadCachedRegistry(channel.name);
    if (!registry) continue;

    for (const entry of registry.components) {
      if (seen.has(entry.id)) continue;

      // Apply filters
      if (filters?.type && entry.type !== filters.type) continue;
      if (filters?.layer && entry.layer !== filters.layer) continue;
      if (filters?.tags && !filters.tags.every(t => entry.tags.includes(t))) continue;

      // Match query against name, description, tags
      const matchText = `${entry.name} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase();
      if (query && !matchText.includes(queryLower)) continue;

      results.push(entry);
      seen.add(entry.id);
    }
  }

  return results;
}

/**
 * Resolve a single component by ID from registry channels (priority order).
 */
export function resolveComponent(
  id: string,
  channels: RegistryChannel[],
  version?: string
): { entry: RegistryEntry; channel: RegistryChannel } | null {
  for (const channel of channels) {
    const registry = loadCachedRegistry(channel.name);
    if (!registry) continue;

    const entry = registry.components.find(c => {
      if (c.id !== id) return false;
      if (version && c.version !== version) return false;
      return true;
    });

    if (entry) return { entry, channel };
  }
  return null;
}

// ---------------------------------------------------------------------------
// License validation
// ---------------------------------------------------------------------------

export function validateLicense(license: string): { valid: boolean; reason?: string | undefined } {
  const upper = license.toUpperCase();
  if (REJECTED_LICENSES.some(l => upper.includes(l.toUpperCase()))) {
    return { valid: false, reason: `License "${license}" is not compatible (GPL/AGPL licenses are rejected)` };
  }
  if (!ALLOWED_LICENSES.includes(license)) {
    return { valid: false, reason: `License "${license}" is not in the allowed list: ${ALLOWED_LICENSES.join(", ")}` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// SHA verification
// ---------------------------------------------------------------------------

export function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function verifySha(filePath: string, expectedSha: string): boolean {
  return computeSha256(filePath) === expectedSha;
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

export function validateManifest(manifest: Partial<ComponentManifest>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest.id) errors.push("Missing required field: id");
  if (!manifest.name) errors.push("Missing required field: name");
  if (!manifest.type) errors.push("Missing required field: type");
  if (!manifest.version) errors.push("Missing required field: version");
  if (!manifest.description) errors.push("Missing required field: description");
  if (!manifest.license) errors.push("Missing required field: license");
  if (!manifest.author?.handle) errors.push("Missing required field: author.handle");

  if (manifest.license) {
    const licenseCheck = validateLicense(manifest.license);
    if (!licenseCheck.valid) errors.push(licenseCheck.reason!);
  }

  const validTypes = ["trait", "gotcha", "persona", "domain"];
  if (manifest.type && !validTypes.includes(manifest.type)) {
    errors.push(`Invalid type "${manifest.type}". Must be one of: ${validTypes.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Refresh (placeholder — actual fetch would use git clone or GitHub API)
// ---------------------------------------------------------------------------

export function refreshCache(channels: RegistryChannel[]): void {
  for (const channel of channels) {
    const cachePath = getCachePath(channel.name);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
    console.log(chalk.gray(`  Cleared cache for channel: ${channel.name}`));
  }
  console.log(chalk.green("  Registry cache cleared. Next search/pull will fetch fresh data."));
}
