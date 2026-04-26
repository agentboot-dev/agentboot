/**
 * Drift detection — compares spoke repo files against their manifest hashes.
 *
 * Phase 11 C1.1: agentboot drift-check
 * Checks ALL platform paths (not just .claude/).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface DriftEntry {
  file: string;
  status: "clean" | "modified" | "missing" | "unmanaged";
  expectedHash?: string | undefined;
  actualHash?: string | undefined;
}

export interface DriftReport {
  repoPath: string;
  manifestFound: boolean;
  entries: DriftEntry[];
  clean: boolean;
  summary: {
    cleanCount: number;
    modifiedCount: number;
    missingCount: number;
    unmanagedCount: number;
  };
}

export interface ComplianceReport {
  generatedAt: string;
  repos: DriftReport[];
  summary: {
    totalRepos: number;
    cleanRepos: number;
    driftedRepos: number;
    noManifestRepos: number;
  };
}

interface ManifestFile {
  path: string;
  hash: string;
}

interface Manifest {
  managed_by: string;
  version: string;
  synced_at: string;
  files: ManifestFile[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Find the manifest file in a repo. Checks multiple platform-specific locations.
 */
function findManifest(repoPath: string): Manifest | null {
  // Check all known manifest locations (different platforms may use different targetDirs)
  const candidates = [
    path.join(repoPath, ".claude", ".agentboot-manifest.json"),
    path.join(repoPath, ".agentboot-manifest.json"),
    path.join(repoPath, ".cursor", ".agentboot-manifest.json"),
    path.join(repoPath, ".gemini", ".agentboot-manifest.json"),
    path.join(repoPath, ".windsurf", ".agentboot-manifest.json"),
    path.join(repoPath, ".junie", ".agentboot-manifest.json"),
    path.join(repoPath, ".agents", ".agentboot-manifest.json"),
    path.join(repoPath, ".codex", ".agentboot-manifest.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, "utf-8")) as Manifest;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Check a single repo for drift against its manifest.
 */
export function checkDrift(repoPath: string): DriftReport {
  const absPath = path.resolve(repoPath);
  const manifest = findManifest(absPath);

  if (!manifest) {
    return {
      repoPath: absPath,
      manifestFound: false,
      entries: [],
      clean: false,
      summary: { cleanCount: 0, modifiedCount: 0, missingCount: 0, unmanagedCount: 0 },
    };
  }

  const entries: DriftEntry[] = [];
  const managedPaths = new Set<string>();

  for (const file of manifest.files) {
    managedPaths.add(file.path);
    const absFilePath = path.join(absPath, file.path);

    if (!fs.existsSync(absFilePath)) {
      entries.push({ file: file.path, status: "missing", expectedHash: file.hash });
    } else {
      const content = fs.readFileSync(absFilePath, "utf-8");
      const actualHash = sha256(content);
      if (actualHash === file.hash) {
        entries.push({ file: file.path, status: "clean", expectedHash: file.hash, actualHash });
      } else {
        entries.push({ file: file.path, status: "modified", expectedHash: file.hash, actualHash });
      }
    }
  }

  // Check for unmanaged files in platform directories
  const platformDirs = [".claude", ".cursor", ".gemini", ".windsurf", ".junie", ".aiassistant", ".agents", ".codex"];
  for (const dir of platformDirs) {
    const dirPath = path.join(absPath, dir);
    if (!fs.existsSync(dirPath)) continue;
    walkDir(dirPath, absPath, (relPath) => {
      // Skip manifest files themselves and archives
      if (relPath.endsWith(".agentboot-manifest.json")) return;
      if (relPath.includes(".agentboot-archive")) return;
      if (!managedPaths.has(relPath)) {
        entries.push({ file: relPath, status: "unmanaged" });
      }
    });
  }

  const summary = {
    cleanCount: entries.filter(e => e.status === "clean").length,
    modifiedCount: entries.filter(e => e.status === "modified").length,
    missingCount: entries.filter(e => e.status === "missing").length,
    unmanagedCount: entries.filter(e => e.status === "unmanaged").length,
  };

  return {
    repoPath: absPath,
    manifestFound: true,
    entries,
    clean: summary.modifiedCount === 0 && summary.missingCount === 0,
    summary,
  };
}

function walkDir(dir: string, baseDir: string, callback: (relPath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, baseDir, callback);
    } else {
      callback(path.relative(baseDir, fullPath));
    }
  }
}

/**
 * Generate a compliance report across multiple repos from repos.json.
 * Phase 11 C1.3: local-only first (remote deferred).
 */
export function generateComplianceReport(
  repos: Array<{ path: string; label?: string }>,
  hubRoot: string,
): ComplianceReport {
  const reports: DriftReport[] = [];

  for (const repo of repos) {
    const repoPath = path.resolve(hubRoot, repo.path);
    if (!fs.existsSync(repoPath)) {
      // Skip remote/missing repos with a stub report
      reports.push({
        repoPath,
        manifestFound: false,
        entries: [],
        clean: false,
        summary: { cleanCount: 0, modifiedCount: 0, missingCount: 0, unmanagedCount: 0 },
      });
      continue;
    }
    reports.push(checkDrift(repoPath));
  }

  return {
    generatedAt: new Date().toISOString(),
    repos: reports,
    summary: {
      totalRepos: reports.length,
      cleanRepos: reports.filter(r => r.clean).length,
      driftedRepos: reports.filter(r => r.manifestFound && !r.clean).length,
      noManifestRepos: reports.filter(r => !r.manifestFound).length,
    },
  };
}
