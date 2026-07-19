/**
 * Scope-layout SSOT — the single authority for "which directories make up the
 * hub's content surface" and "which scope names exist under a given node".
 *
 * Motivation (v0.16.0 hardening): several defects shared one root cause — each
 * subsystem hand-rolled its own partial view of the scope layout. sync's
 * group-level walk knew only the *registered* team and leaked sibling-team
 * subtrees into every spoke; validate's secret scan enumerated two content
 * dirs and silently skipped the rest of the compiler input surface. Both now
 * ask this module instead of guessing.
 */

import * as fs from "fs";
import * as path from "path";
import {
  AgentBootConfig,
  ScopeNode,
  flattenNodes,
  groupsToNodes,
} from "./config.js";

/**
 * Resolve config-referenced domain layers to their `traits/` and `personas/`
 * directories, mirroring the discovery + boundary check in compile.ts
 * (`compileDomains`). Only domains listed in `config.domains` are resolved —
 * matching exactly what the compiler builds, so an unreferenced draft domain on
 * disk (e.g. one not yet added to config) never affects validation or scans.
 * (Moved here from validate.ts — this is layout knowledge, and the secret scan
 * and validators must share one view of it.)
 */
export function resolveDomainDirs(
  config: AgentBootConfig,
  configDir: string
): { name: string; traitsDir: string | null; personasDir: string | null }[] {
  const out: { name: string; traitsDir: string | null; personasDir: string | null }[] = [];
  const boundary = path.resolve(configDir);
  for (const domainRef of config.domains ?? []) {
    const domainPath =
      typeof domainRef === "string"
        ? path.resolve(configDir, domainRef)
        : path.resolve(configDir, domainRef.path ?? `./domains/${domainRef.name}`);
    if (!fs.existsSync(domainPath)) continue;
    // Path-traversal protection: resolve symlinks then check the project boundary.
    let realDomainPath: string;
    try {
      realDomainPath = fs.realpathSync(domainPath);
    } catch {
      continue;
    }
    if (!realDomainPath.startsWith(boundary + path.sep) && realDomainPath !== boundary) continue;
    const name = typeof domainRef === "string" ? path.basename(realDomainPath) : domainRef.name;
    const traitsDir = path.join(realDomainPath, "traits");
    const personasDir = path.join(realDomainPath, "personas");
    out.push({
      name,
      traitsDir: fs.existsSync(traitsDir) ? traitsDir : null,
      personasDir: fs.existsSync(personasDir) ? personasDir : null,
    });
  }
  return out;
}

/** The effective nodes tree: `nodes` wins; legacy `groups`/`teams` converted. */
export function effectiveNodes(config: AgentBootConfig): Record<string, ScopeNode> {
  if (config.nodes && Object.keys(config.nodes).length > 0) return config.nodes;
  if (config.groups && Object.keys(config.groups).length > 0) return groupsToNodes(config.groups);
  return {};
}

/** Every scope path in the tree (e.g. "platform", "platform/api"). */
export function allScopePaths(config: AgentBootConfig): string[] {
  return flattenNodes(effectiveNodes(config)).map((n) => n.path);
}

/**
 * Names of the DIRECT child scopes of `scopePath` ("" = root level).
 * This is the authority sync must use to exclude child-scope subtrees from a
 * parent-scope walk — excluding only the one registered child is exactly the
 * sibling-leak bug.
 */
export function childScopeNames(config: AgentBootConfig, scopePath: string): string[] {
  let level: Record<string, ScopeNode> = effectiveNodes(config);
  if (scopePath !== "") {
    for (const seg of scopePath.split("/")) {
      const node = level[seg];
      if (!node) return [];
      level = node.children ?? {};
    }
  }
  return Object.keys(level);
}

/**
 * Every hub directory the compiler reads content from — the full input
 * surface. Anything that can end up in a compiled artifact must be scanned
 * (secrets), so a scanner enumerating less than this list is lying about its
 * coverage. Returns only directories that exist.
 */
export function hubContentRoots(config: AgentBootConfig, configDir: string): string[] {
  const roots: string[] = [
    // core/ covers traits, personas, instructions, gotchas, lexicon — the
    // whole subtree is compiler input.
    path.join(configDir, "core"),
    // Scope-layout content (all three layouts sync/compile can read).
    path.join(configDir, "groups"),
    path.join(configDir, "teams"),
    path.join(configDir, "nodes"),
  ];

  if (config.personas?.customDir) {
    roots.push(path.resolve(configDir, config.personas.customDir));
  }
  for (const d of resolveDomainDirs(config, configDir)) {
    if (d.traitsDir) roots.push(d.traitsDir);
    if (d.personasDir) roots.push(d.personasDir);
  }

  // De-dupe (a domain dir may sit inside core/) and drop non-existent roots.
  const seen = new Set<string>();
  return roots.filter((r) => {
    const key = path.resolve(r);
    if (seen.has(key) || !fs.existsSync(r)) return false;
    // Skip roots nested inside an already-accepted root.
    for (const s of seen) {
      if (key.startsWith(s + path.sep)) return false;
    }
    seen.add(key);
    return true;
  });
}
