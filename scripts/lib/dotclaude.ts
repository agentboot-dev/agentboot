/**
 * dotclaude integration — user-level content delivery.
 *
 * Phase 11 B3: writeDirectly path only (dotclaude path deferred).
 * Writes AgentBoot skills and rules directly to ~/.claude/.
 *
 * Per cross-system audit:
 * - MUST NOT use {{ TEMPLATE_VARS }} in any content
 * - MUST NOT touch CLAUDE.md (requires dotclaude markers)
 * - MUST NOT touch settings.json (requires dotclaude deep merge)
 * - Settings must be additive only (no hooks, no permissions.deny)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

function getClaudeDir(): string {
  return path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir(), ".claude");
}

export interface WriteDirectlyResult {
  skillsWritten: string[];
  rulesWritten: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Check if ~/.claude/ exists and whether it has AgentBoot-managed content.
 */
export function detectExistingContent(): {
  claudeDirExists: boolean;
  hasManifest: boolean;
  manifestPath: string;
} {
  const claudeDir = getClaudeDir();
  const manifestPath = path.join(claudeDir, ".agentboot-user-manifest.json");
  return {
    claudeDirExists: fs.existsSync(claudeDir),
    hasManifest: fs.existsSync(manifestPath),
    manifestPath,
  };
}

/**
 * Write compiled skills and rules directly to ~/.claude/.
 * Only writes directory-slot files (skills/, rules/).
 * Skips CLAUDE.md and settings.json (requires dotclaude for safe composition).
 */
export function writeDirectly(
  distClaudeCorePath: string,
  options?: { dryRun?: boolean },
): WriteDirectlyResult {
  const claudeDir = getClaudeDir();
  const result: WriteDirectlyResult = {
    skillsWritten: [],
    rulesWritten: [],
    skipped: [],
    errors: [],
  };

  if (!fs.existsSync(distClaudeCorePath)) {
    result.errors.push(`dist path does not exist: ${distClaudeCorePath}`);
    return result;
  }

  // Write skills
  const skillsSrc = path.join(distClaudeCorePath, "skills");
  if (fs.existsSync(skillsSrc)) {
    const skillsDest = path.join(claudeDir, "skills");
    copyDirContents(skillsSrc, skillsDest, result.skillsWritten, options?.dryRun);
  }

  // Write rules (instructions compiled as rules)
  const rulesSrc = path.join(distClaudeCorePath, "rules");
  if (fs.existsSync(rulesSrc)) {
    const rulesDest = path.join(claudeDir, "rules");
    copyDirContents(rulesSrc, rulesDest, result.rulesWritten, options?.dryRun);
  }

  // Explicitly skip CLAUDE.md and settings.json (cross-system audit RISK #1 and #3)
  result.skipped.push("CLAUDE.md (requires dotclaude markers for safe append)");
  result.skipped.push("settings.json (requires dotclaude for safe merge)");

  // Write user manifest to track what we wrote
  if (!options?.dryRun) {
    const manifest = generateUserManifest([...result.skillsWritten, ...result.rulesWritten], claudeDir);
    const manifestPath = path.join(claudeDir, ".agentboot-user-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return result;
}

function copyDirContents(src: string, dest: string, written: string[], dryRun?: boolean): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!dryRun) fs.mkdirSync(destPath, { recursive: true });
      copyDirContents(srcPath, destPath, written, dryRun);
    } else {
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
      written.push(destPath);
    }
  }
}

/**
 * Generate a manifest tracking what AgentBoot wrote to ~/.claude/.
 */
export function generateUserManifest(
  writtenFiles: string[],
  claudeDir: string,
): Record<string, unknown> {
  const files = writtenFiles.map(f => {
    const relPath = path.relative(claudeDir, f);
    let hash = "";
    try {
      const content = fs.readFileSync(f, "utf-8");
      hash = createHash("sha256").update(content).digest("hex");
    } catch { /* file may not exist in dry-run */ }
    return { path: relPath, hash };
  });

  return {
    managed_by: "agentboot",
    scope: "user",
    written_at: new Date().toISOString(),
    files,
  };
}

/**
 * Remove AgentBoot-managed content from ~/.claude/.
 * Only removes files tracked in the user manifest.
 */
export function removeUserContent(): { removed: string[]; errors: string[] } {
  const { hasManifest, manifestPath } = detectExistingContent();
  const removed: string[] = [];
  const errors: string[] = [];

  if (!hasManifest) {
    return { removed, errors: ["No AgentBoot user manifest found"] };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const claudeDir = getClaudeDir();

    const resolvedClaudeDir = path.resolve(claudeDir) + path.sep;
    for (const file of manifest.files ?? []) {
      const filePath = path.resolve(path.join(claudeDir, file.path));
      // Security: prevent path traversal via tampered manifest
      if (!filePath.startsWith(resolvedClaudeDir)) {
        errors.push(`Skipped "${file.path}" — path traversal detected (resolves outside ~/.claude/)`);
        continue;
      }
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removed.push(file.path);
        }
      } catch (err) {
        errors.push(`Failed to remove ${file.path}: ${(err as Error).message}`);
      }
    }

    // Remove manifest itself
    fs.unlinkSync(manifestPath);
  } catch (err) {
    errors.push(`Failed to read manifest: ${(err as Error).message}`);
  }

  return { removed, errors };
}
