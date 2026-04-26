/**
 * Hub audit — scans for health issues in the AgentBoot hub.
 *
 * Phase 11 C1.6: agentboot audit
 * Detection only — no --fix flag (deferred to 1.x).
 */

import fs from "node:fs";
import path from "node:path";
import { stripJsoncComments } from "./config.js";

export interface AuditFinding {
  type: "orphaned-trait" | "unused-instruction" | "scope-shadow" | "manifest-drift";
  severity: "error" | "warn" | "info";
  message: string;
  file?: string | undefined;
}

export interface AuditReport {
  findings: AuditFinding[];
  summary: { errors: number; warnings: number; info: number };
}

/**
 * Run a full audit of the hub.
 */
export function runAudit(hubRoot: string): AuditReport {
  const findings: AuditFinding[] = [];

  // 1. Orphaned traits — traits in core/traits/ not referenced by any persona config
  findOrphanedTraits(hubRoot, findings);

  // 2. Unused instructions — instructions in core/instructions/ not in config.enabled
  findUnusedInstructions(hubRoot, findings);

  // 3. Manifest drift — dist/ out of date with source
  checkManifestDrift(hubRoot, findings);

  const summary = {
    errors: findings.filter(f => f.severity === "error").length,
    warnings: findings.filter(f => f.severity === "warn").length,
    info: findings.filter(f => f.severity === "info").length,
  };

  return { findings, summary };
}

function findOrphanedTraits(hubRoot: string, findings: AuditFinding[]): void {
  const traitsDir = path.join(hubRoot, "core", "traits");
  if (!fs.existsSync(traitsDir)) return;

  const traitFiles = fs.readdirSync(traitsDir).filter(f => f.endsWith(".md"));
  const traitNames = traitFiles.map(f => path.basename(f, ".md"));

  // Collect all trait references from persona configs
  const referencedTraits = new Set<string>();
  const personasDir = path.join(hubRoot, "core", "personas");
  if (fs.existsSync(personasDir)) {
    for (const dir of fs.readdirSync(personasDir)) {
      const configPath = path.join(personasDir, dir, "persona.config.json");
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          const traits = config.traits;
          if (Array.isArray(traits)) {
            for (const t of traits) referencedTraits.add(typeof t === "string" ? t : "");
          } else if (traits && typeof traits === "object") {
            for (const key of Object.keys(traits)) referencedTraits.add(key);
          }
        } catch { /* ignore malformed configs */ }
      }
    }
  }

  for (const trait of traitNames) {
    if (!referencedTraits.has(trait)) {
      findings.push({
        type: "orphaned-trait",
        severity: "warn",
        message: `Trait "${trait}" is not referenced by any persona config`,
        file: path.join("core", "traits", `${trait}.md`),
      });
    }
  }
}

function findUnusedInstructions(hubRoot: string, findings: AuditFinding[]): void {
  const instructionsDir = path.join(hubRoot, "core", "instructions");
  if (!fs.existsSync(instructionsDir)) return;

  // Load config to check enabled instructions
  const configPath = path.join(hubRoot, "agentboot.config.json");
  if (!fs.existsSync(configPath)) return;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const cleaned = stripJsoncComments(raw);
    const config = JSON.parse(cleaned);
    const enabled: string[] = config.instructions?.enabled ?? [];

    const instrFiles = fs.readdirSync(instructionsDir)
      .filter(f => f.endsWith(".md"))
      .map(f => path.basename(f, ".md"));

    for (const instr of instrFiles) {
      if (!enabled.includes(instr)) {
        findings.push({
          type: "unused-instruction",
          severity: "info",
          message: `Instruction "${instr}" exists but is not in instructions.enabled`,
          file: path.join("core", "instructions", `${instr}.md`),
        });
      }
    }
  } catch {
    findings.push({
      type: "unused-instruction",
      severity: "warn",
      message: "Could not parse agentboot.config.json — unused instruction check skipped",
    });
  }
}

function checkManifestDrift(hubRoot: string, findings: AuditFinding[]): void {
  const distDir = path.join(hubRoot, "dist");
  if (!fs.existsSync(distDir)) {
    findings.push({
      type: "manifest-drift",
      severity: "warn",
      message: "dist/ directory does not exist — run agentboot build",
    });
    return;
  }

  // Find newest file in dist/ (recursive) for accurate comparison
  let newestDistMtime = 0;
  const walkForMtime = (dir: string): void => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkForMtime(fullPath);
        } else {
          try {
            const mt = fs.statSync(fullPath).mtime.getTime();
            if (mt > newestDistMtime) newestDistMtime = mt;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  };
  walkForMtime(distDir);

  if (newestDistMtime === 0) return;

  // Check source files recursively (including persona subdirectories)
  const sourceDirs = ["core/traits", "core/personas", "core/instructions", "core/gotchas"];
  const walkSource = (dir: string, relBase: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        walkSource(fullPath, relPath);
      } else {
        try {
          const fileStat = fs.statSync(fullPath);
          if (fileStat.mtime.getTime() > newestDistMtime) {
            findings.push({
              type: "manifest-drift",
              severity: "warn",
              message: `Source file "${relPath}" is newer than dist/ — rebuild needed`,
              file: relPath,
            });
          }
        } catch { /* ignore stat errors */ }
      }
    }
  };

  for (const dir of sourceDirs) {
    walkSource(path.join(hubRoot, dir), dir);
  }
}
