/**
 * Drift detection — compares spoke repo files against their manifest hashes.
 *
 * Phase 11 C1.1: agentboot drift-check
 * Checks ALL platform paths (not just .claude/).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  loadExceptionsFile, validateExceptions, driftExceptionFor,
  REPO_EXCEPTIONS_FILE, type PolicyException,
} from "./exceptions.js";

export interface DriftEntry {
  file: string;
  status: "clean" | "modified" | "missing" | "unmanaged" | "excepted" | "retired";
  expectedHash?: string | undefined;
  actualHash?: string | undefined;
  /** B7: id of the active policy exception covering this drift, when status is "excepted". */
  exceptionId?: string;
}

export interface DriftReport {
  repoPath: string;
  /**
   * Does the repo exist on disk at all? "Unreachable" and "synced but the
   * manifest was deleted" are different remediations and used to print the same
   * `? (no manifest)` line, so neither could be acted on.
   */
  pathExists: boolean;
  manifestFound: boolean;
  entries: DriftEntry[];
  clean: boolean;
  summary: {
    cleanCount: number;
    modifiedCount: number;
    missingCount: number;
    unmanagedCount: number;
    /** B7: drifted files covered by an unexpired policy exception. */
    exceptedCount: number;
    /** F-1: artifacts revoked at the hub that sync could NOT withdraw from this
     *  repo and that are still present on disk. An unremediated revocation. */
    retiredCount: number;
  };
  /** B7: problems with the repo's exceptions file (expired entries etc.). */
  exceptionIssues?: string[];
}

export interface ComplianceReport {
  generatedAt: string;
  repos: DriftReport[];
  summary: {
    totalRepos: number;
    cleanRepos: number;
    driftedRepos: number;
    /** Repos with no readable manifest — UNCHECKED, not clean. */
    noManifestRepos: number;
    /** Repos whose path does not exist locally — also unchecked. */
    unreachableRepos: number;
  };
}

interface ManifestFile {
  path: string;
  hash: string;
}

interface RetiredFile {
  path: string;
  reason: string;
}

interface Manifest {
  managed_by: string;
  version: string;
  synced_at: string;
  files: ManifestFile[];
  /** F-1: revoked-but-not-removable artifacts recorded by the last sync. */
  retired?: RetiredFile[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Find the manifest file in a repo. Checks multiple platform-specific locations.
 */
// All known manifest locations — different platforms write to different targetDirs.
function manifestCandidates(repoPath: string): string[] {
  return [
    path.join(repoPath, ".claude", ".agentboot-manifest.json"),
    path.join(repoPath, ".agentboot-manifest.json"),
    path.join(repoPath, ".cursor", ".agentboot-manifest.json"),
    path.join(repoPath, ".gemini", ".agentboot-manifest.json"),
    path.join(repoPath, ".windsurf", ".agentboot-manifest.json"),
    path.join(repoPath, ".junie", ".agentboot-manifest.json"),
    path.join(repoPath, ".agents", ".agentboot-manifest.json"),
    path.join(repoPath, ".codex", ".agentboot-manifest.json"),
  ];
}

/**
 * Return the path to the repo's AgentBoot manifest (first existing candidate), or
 * null if unsynced. Exposed so callers can stat the real manifest (e.g. for a
 * last-synced timestamp) instead of guessing a single location.
 */
export function findManifestPath(repoPath: string): string | null {
  for (const candidate of manifestCandidates(repoPath)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findManifest(repoPath: string): Manifest | null {
  for (const candidate of manifestCandidates(repoPath)) {
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
      pathExists: fs.existsSync(absPath),
      manifestFound: false,
      entries: [],
      clean: false,
      summary: { cleanCount: 0, modifiedCount: 0, missingCount: 0, unmanagedCount: 0, exceptedCount: 0, retiredCount: 0 },
    };
  }

  // B7: load the repo's policy exceptions. Only ACTIVE (unexpired, well-formed)
  // entries are honored; expired ones surface as issues so the drift resurfaces
  // loudly rather than staying silently waived.
  let activeExceptions: PolicyException[] = [];
  let exceptionIssues: string[] = [];
  try {
    const list = loadExceptionsFile(path.join(absPath, REPO_EXCEPTIONS_FILE));
    if (list.length > 0) {
      const v = validateExceptions(list);
      activeExceptions = v.active;
      exceptionIssues = [...v.errors, ...v.warnings];
    }
  } catch (e) {
    exceptionIssues = [`${REPO_EXCEPTIONS_FILE}: unreadable (${e instanceof Error ? e.message : String(e)}) — no exceptions honored`];
  }

  const entries: DriftEntry[] = [];
  const managedPaths = new Set<string>();

  for (const file of manifest.files) {
    managedPaths.add(file.path);
    const absFilePath = path.join(absPath, file.path);

    const pushDrift = (status: "missing" | "modified", actualHash?: string) => {
      const exception = driftExceptionFor(file.path, activeExceptions);
      if (exception) {
        entries.push({ file: file.path, status: "excepted", expectedHash: file.hash, actualHash, exceptionId: exception.id });
      } else {
        entries.push({ file: file.path, status, expectedHash: file.hash, actualHash });
      }
    };

    if (!fs.existsSync(absFilePath)) {
      pushDrift("missing");
    } else {
      const content = fs.readFileSync(absFilePath, "utf-8");
      const actualHash = sha256(content);
      if (actualHash === file.hash) {
        entries.push({ file: file.path, status: "clean", expectedHash: file.hash, actualHash });
      } else {
        pushDrift("modified", actualHash);
      }
    }
  }

  // F-1: a control the org withdrew that is still live here. These files are
  // deliberately absent from manifest.files (sync no longer delivers them), so
  // the loop above cannot see them — which is exactly how drift-check used to
  // report "clean" BECAUSE the artifact had stopped being tracked.
  for (const retired of manifest.retired ?? []) {
    managedPaths.add(retired.path);
    if (fs.existsSync(path.join(absPath, retired.path))) {
      entries.push({ file: retired.path, status: "retired" });
    }
  }

  // Check for unmanaged files in platform directories
  const platformDirs = [".claude", ".cursor", ".gemini", ".windsurf", ".junie", ".aiassistant", ".agents", ".codex"];
  for (const dir of platformDirs) {
    const dirPath = path.join(absPath, dir);
    if (!fs.existsSync(dirPath)) continue;
    walkDir(dirPath, absPath, (relPath) => {
      // Skip manifest files themselves, attestations, and archives
      if (relPath.endsWith(".agentboot-manifest.json")) return;
      if (relPath.endsWith(".agentboot-manifest.intoto.json")) return;
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
    exceptedCount: entries.filter(e => e.status === "excepted").length,
    retiredCount: entries.filter(e => e.status === "retired").length,
  };

  return {
    repoPath: absPath,
    pathExists: true,
    manifestFound: true,
    entries,
    // "clean" = AgentBoot-managed content is intact (nothing modified or missing).
    // Unmanaged files (a dev's own .claude/ additions) are reported in the summary
    // and entries but deliberately do NOT flip `clean` — they are user content, not
    // drift of managed artifacts, and treating them as violations would flag almost
    // every real repo. Callers that care about unmanaged files read summary.unmanagedCount.
    // Excepted entries are approved drift — visible in the report, but they do
    // not fail the repo. Unauthorized drift (modified/missing) still does.
    // F-1: a revoked control still live on a spoke is NOT a clean repo.
    clean: summary.modifiedCount === 0 && summary.missingCount === 0 && summary.retiredCount === 0,
    summary,
    ...(exceptionIssues.length > 0 ? { exceptionIssues } : {}),
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
        pathExists: false,
        manifestFound: false,
        entries: [],
        clean: false,
        summary: { cleanCount: 0, modifiedCount: 0, missingCount: 0, unmanagedCount: 0, exceptedCount: 0, retiredCount: 0 },
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
      // A repo whose manifest is absent was NOT checked. It is not clean and it
      // is not drifted — it is unknown, and the caller must be able to tell the
      // difference, because "unknown" was previously folded into the exit-0 path.
      noManifestRepos: reports.filter(r => !r.manifestFound).length,
      unreachableRepos: reports.filter(r => !r.pathExists).length,
    },
  };
}
