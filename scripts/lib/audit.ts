/**
 * Hub audit — scans for health issues in the AgentBoot hub.
 *
 * Phase 11 C1.6: agentboot audit
 * Detection only — no --fix flag (deferred to 1.x).
 */

import fs from "node:fs";
import path from "node:path";
import { stripJsoncComments } from "./config.js";
import { parseFrontmatter, resolveCompositionType } from "./frontmatter.js";
import { computeSourceDigest, readDistStamp, resolveDomainRoots } from "./dist-stamp.js";

export interface AuditFinding {
  type: "orphaned-trait" | "unused-instruction" | "scope-shadow" | "manifest-drift" | "dead-gotcha";
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

  // 4. B10 (customer ask): scope shadows — lower-scope artifacts with the same
  //    name as a core artifact. With many scopes and repos, silent shadowing is
  //    how org rules erode.
  findScopeShadows(hubRoot, findings);

  // 5. B10: dead gotchas — path-scoped gotchas whose globs match nothing in any
  //    locally-registered repo (the gotcha never activates anywhere).
  findDeadGotchas(hubRoot, findings);

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

/**
 * R2-7 — "has anything changed since the build" is a DIGEST question.
 *
 * This compared source mtimes against the newest mtime under dist/, which
 * answers a different and weaker question. Two ways it was wrong in the same
 * direction — quiet:
 *
 *   * mtime is not evidence of content. Appending to
 *     core/personas/locked-reviewer/SKILL.md and then
 *     `touch -t 202001010000` on it rewinds the mtime below dist/ and the walk
 *     reports nothing. (The audit still refused, because it is gated on
 *     assertDistFreshOrExit — which is digest-based. That gate is the reason
 *     this was LOW, not the reason it was fine.)
 *   * walkSource covered only core/{traits,personas,instructions,gotchas}. A
 *     scaffolded hub has all four EMPTY, so the comparison examined ZERO source
 *     files and said nothing at all. NF4-2's `newestDistMtime === 0` guard
 *     covered the dist side of that vacuity and not the source side.
 *
 * The digest is the same one dist-stamp records at build time and
 * checkDistFreshness compares against, so the audit's second staleness signal
 * now agrees with the authoritative one by construction instead of
 * approximating it. It also covers nodes/, groups/, teams/ and configured
 * domains, which the four hardcoded directories did not — the same
 * enumerate-the-surface gap as elsewhere on this branch.
 *
 * The mtime walk is KEPT, demoted from verdict to localisation: when the digest
 * says stale it names the files it can, which is genuinely useful and was the
 * only thing the old check did well. It can no longer decide that nothing
 * changed.
 */
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

  const stamp = readDistStamp(distDir);
  if (!stamp || !stamp.sourceDigest) {
    // Silence is not success: a check that could not run must say so. dist/
    // exists and carries no source digest, so nothing here can speak to whether
    // the sources have moved since it was produced.
    findings.push({
      type: "manifest-drift",
      severity: "warn",
      message:
        "dist/ carries no artifact-source digest, so the source-vs-dist staleness comparison " +
        "did NOT run. This is not evidence that dist/ is current — rebuild with `agentboot build`.",
    });
    return;
  }

  let config: unknown = null;
  try {
    const cfgPath = path.join(hubRoot, "agentboot.config.json");
    if (fs.existsSync(cfgPath)) config = JSON.parse(stripJsoncComments(fs.readFileSync(cfgPath, "utf-8")));
  } catch {
    // An unreadable config means the DOMAIN roots cannot be resolved, so the
    // digest would be computed over a smaller tree than the build used and would
    // mismatch for the wrong reason. Say that, rather than reporting a drift the
    // operator cannot act on.
    findings.push({
      type: "manifest-drift",
      severity: "warn",
      message:
        "agentboot.config.json is unreadable, so configured domain roots could not be included " +
        "in the source digest — the staleness comparison did NOT run.",
    });
    return;
  }

  const current = computeSourceDigest(hubRoot, resolveDomainRoots(hubRoot, config));
  if (current === stamp.sourceDigest) return;

  findings.push({
    type: "manifest-drift",
    severity: "warn",
    message:
      `Hub artifact sources have changed since dist/ was built (stamped ${stamp.builtAt}) — ` +
      `rebuild needed. stamped ${stamp.sourceDigest.slice(0, 12)}… vs current ${current.slice(0, 12)}…`,
  });

  // Best-effort localisation only. mtime cannot be trusted for the VERDICT
  // (see above), but when it does point at something it saves the operator a
  // diff, and naming nothing here no longer means "nothing changed".
  let newestDistMtime = 0;
  const walkForMtime = (dir: string): void => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walkForMtime(fullPath);
        else {
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

  const walkSource = (dir: string, relBase: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        walkSource(fullPath, relPath);
      } else {
        try {
          if (fs.statSync(fullPath).mtime.getTime() > newestDistMtime) {
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
  for (const dir of ["core", "nodes", "groups", "teams"]) {
    walkSource(path.join(hubRoot, dir), dir);
  }
}

// ---------------------------------------------------------------------------
// B10: scope shadows — the advertised finding type, now implemented
// ---------------------------------------------------------------------------

const SHADOW_CATEGORIES = ["traits", "instructions", "gotchas"] as const;

/** Collect <category>/<filename> pairs under a scope directory. */
function collectScopeArtifacts(scopeDir: string): Array<{ category: string; name: string; absPath: string }> {
  const out: Array<{ category: string; name: string; absPath: string }> = [];
  for (const category of SHADOW_CATEGORIES) {
    const dir = path.join(scopeDir, category);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".md") && f !== "README.md") {
        out.push({ category, name: f, absPath: path.join(dir, f) });
      }
    }
  }
  return out;
}

/** Enumerate lower-scope directories: groups/<g>, teams/<g>/<t>, nodes/<...>. */
function lowerScopeDirs(hubRoot: string): Array<{ scope: string; dir: string }> {
  const out: Array<{ scope: string; dir: string }> = [];
  const groupsDir = path.join(hubRoot, "groups");
  if (fs.existsSync(groupsDir)) {
    for (const g of fs.readdirSync(groupsDir)) {
      const gDir = path.join(groupsDir, g);
      if (!fs.statSync(gDir).isDirectory()) continue;
      out.push({ scope: `groups/${g}`, dir: gDir });
      // UI-7: nested team layout groups/<g>/teams/<t>/ is also a scope dir
      const nestedTeams = path.join(gDir, "teams");
      if (fs.existsSync(nestedTeams)) {
        for (const t of fs.readdirSync(nestedTeams)) {
          const tDir = path.join(nestedTeams, t);
          if (fs.statSync(tDir).isDirectory()) out.push({ scope: `groups/${g}/teams/${t}`, dir: tDir });
        }
      }
    }
  }
  const teamsDir = path.join(hubRoot, "teams");
  if (fs.existsSync(teamsDir)) {
    for (const g of fs.readdirSync(teamsDir)) {
      const gDir = path.join(teamsDir, g);
      if (!fs.statSync(gDir).isDirectory()) continue;
      for (const t of fs.readdirSync(gDir)) {
        const tDir = path.join(gDir, t);
        if (fs.statSync(tDir).isDirectory()) out.push({ scope: `teams/${g}/${t}`, dir: tDir });
      }
    }
  }
  const nodesDir = path.join(hubRoot, "nodes");
  if (fs.existsSync(nodesDir)) {
    const walk = (dir: string, rel: string): void => {
      out.push({ scope: `nodes/${rel}`, dir });
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !(SHADOW_CATEGORIES as readonly string[]).includes(entry.name) && entry.name !== "personas") {
          walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        }
      }
    };
    for (const entry of fs.readdirSync(nodesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(nodesDir, entry.name), entry.name);
    }
  }
  return out;
}

function findScopeShadows(hubRoot: string, findings: AuditFinding[]): void {
  const coreArtifacts = collectScopeArtifacts(path.join(hubRoot, "core"));
  if (coreArtifacts.length === 0) return;
  const coreByKey = new Map(coreArtifacts.map((a) => [`${a.category}/${a.name}`, a]));

  for (const { scope, dir } of lowerScopeDirs(hubRoot)) {
    for (const artifact of collectScopeArtifacts(dir)) {
      const core = coreByKey.get(`${artifact.category}/${artifact.name}`);
      if (!core) continue;
      // Rule-type core artifacts must never be shadowed (validate blocks the
      // build); preference shadows are by-design but worth surfacing — the
      // question "did you MEAN to override the org's file?" has no other home.
      let isRule = false;
      try {
        const fm = parseFrontmatter(fs.readFileSync(core.absPath, "utf-8"));
        isRule = resolveCompositionType(`${artifact.category}/${artifact.name}`, fm) === "rule";
      } catch { /* frontmatter unreadable — treat as preference */ }
      findings.push({
        type: "scope-shadow",
        severity: isRule ? "error" : "warn",
        message: isRule
          ? `${scope}/${artifact.category}/${artifact.name} shadows an org RULE artifact — org rules cannot be overridden at lower scopes`
          : `${scope}/${artifact.category}/${artifact.name} shadows core/${artifact.category}/${artifact.name} — verify the override is intentional`,
        file: `${scope}/${artifact.category}/${artifact.name}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// B10: dead gotchas — path globs that match nothing in any registered repo
// ---------------------------------------------------------------------------

function gotchaGlobToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** Walk a repo collecting relative file paths (bounded; skips vendored dirs). */
function listRepoFiles(repoPath: string, cap = 20_000): string[] {
  const files: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "vendor"]);
  const walk = (dir: string, rel: string): void => {
    if (files.length >= cap) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= cap) return;
      if (skip.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath);
      else files.push(relPath);
    }
  };
  walk(repoPath, "");
  return files;
}

function findDeadGotchas(hubRoot: string, findings: AuditFinding[]): void {
  const gotchasDir = path.join(hubRoot, "core", "gotchas");
  if (!fs.existsSync(gotchasDir)) return;
  const gotchaFiles = fs.readdirSync(gotchasDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  if (gotchaFiles.length === 0) return;

  // Registered repos that exist locally are the ground truth for "does this
  // gotcha ever activate". No local repos → not checkable, say so once.
  let repos: Array<{ path?: string }> = [];
  try {
    const configRaw = stripJsoncComments(fs.readFileSync(path.join(hubRoot, "agentboot.config.json"), "utf-8"));
    const reposRel = (JSON.parse(configRaw).sync?.repos as string | undefined) ?? "./repos.json";
    repos = JSON.parse(fs.readFileSync(path.resolve(hubRoot, reposRel), "utf-8"));
  } catch { /* no repos.json — handled below */ }
  const localRepos = repos
    .map((r) => (r.path ? path.resolve(hubRoot, r.path) : null))
    .filter((p): p is string => p !== null && fs.existsSync(p));

  if (localRepos.length === 0) {
    findings.push({
      type: "dead-gotcha",
      severity: "info",
      message: `${gotchaFiles.length} gotcha(s) present but no locally-available registered repos to check their path scopes against — dead-gotcha detection skipped`,
    });
    return;
  }

  const repoFileLists = localRepos.map((p) => listRepoFiles(p));

  for (const f of gotchaFiles) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(gotchasDir, f), "utf-8"));
    const pathsRaw = fm?.get("paths");
    if (!pathsRaw) continue; // unscoped gotcha applies everywhere — never dead
    const globs = pathsRaw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    if (globs.length === 0) continue;
    const regexes = globs.map(gotchaGlobToRegex);
    const matchesSomewhere = repoFileLists.some((files) =>
      files.some((file) => regexes.some((re) => re.test(file)))
    );
    if (!matchesSomewhere) {
      findings.push({
        type: "dead-gotcha",
        severity: "warn",
        message: `Gotcha "${f}" path scope [${globs.join(", ")}] matches no file in any of the ${localRepos.length} locally-registered repo(s) — it never activates`,
        file: path.join("core", "gotchas", f),
      });
    }
  }
}
