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
import type { InstructionDirSpec } from "./guardrail-scan.js";

/**
 * The content subdirectories `compileDomains()` reads out of a domain layer.
 * This list is the SSOT for "what does a domain contribute to the compile
 * input surface", and every consumer derives from it rather than restating it.
 *
 * It exists because restating it is what broke: `hubContentRoots` enumerated
 * `traits` + `personas` and omitted `instructions`, so a credential in
 * `domains/<d>/instructions/*.md` — which `compileDomains()` pushes through
 * the same emitters as every other instruction, and which ships to every spoke
 * — passed the scan that prints "no credentials or keys anywhere in the hub
 * content surface". The scan was not merely incomplete; it asserted a coverage
 * it did not have, which is the failure mode the SSOT was introduced to end.
 *
 * Keep in step with `compileDomains()` in compile.ts. (Its fourth read, the
 * `agentboot.domain.json` manifest at the domain root, is a file rather than a
 * directory and so is not expressible here.)
 */
export const DOMAIN_CONTENT_SUBDIRS = ["traits", "personas", "instructions"] as const;

/**
 * Resolve config-referenced domain layers to the content directories
 * `compileDomains()` reads, mirroring its discovery + boundary check. Only
 * domains listed in `config.domains` are resolved — matching exactly what the
 * compiler builds, so an unreferenced draft domain on disk (e.g. one not yet
 * added to config) never affects validation or scans.
 * (Moved here from validate.ts — this is layout knowledge, and the secret scan
 * and validators must share one view of it.)
 */
export function resolveDomainDirs(
  config: AgentBootConfig,
  configDir: string
): {
  name: string;
  traitsDir: string | null;
  personasDir: string | null;
  instructionsDir: string | null;
  /** Every existing content dir of this domain, keyed by DOMAIN_CONTENT_SUBDIRS. */
  contentDirs: string[];
}[] {
  const out: {
    name: string;
    traitsDir: string | null;
    personasDir: string | null;
    instructionsDir: string | null;
    contentDirs: string[];
  }[] = [];
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
    // Derived from the SSOT list, never restated — see DOMAIN_CONTENT_SUBDIRS.
    const resolved = Object.fromEntries(
      DOMAIN_CONTENT_SUBDIRS.map((sub) => {
        const dir = path.join(realDomainPath, sub);
        return [sub, fs.existsSync(dir) ? dir : null];
      })
    ) as Record<(typeof DOMAIN_CONTENT_SUBDIRS)[number], string | null>;
    out.push({
      name,
      traitsDir: resolved.traits,
      personasDir: resolved.personas,
      instructionsDir: resolved.instructions,
      contentDirs: DOMAIN_CONTENT_SUBDIRS.map((s) => resolved[s]).filter(
        (d): d is string => d !== null
      ),
    });
  }
  return out;
}

/**
 * R4-2: THE instruction directories whose `applyTo` any scope surface must see.
 *
 * `countNarrowlyScopedInstructions` was called at three sites — the build's
 * capability gate and doctor's Coverage and Scoping blocks — each with a
 * hand-built `[packageInstructionsDir, coreInstructionsDir]`. `domains/<d>/
 * instructions` was in none of them, and `compileDomains()` pushes those files
 * through the SAME emitters, so the whole domain tier was invisible to every
 * surface that answers "did the target receive the scope you wrote".
 *
 * Measured on a scratch hub (one narrow instruction in `domains/fin/
 * instructions`, `outputFormats: ["skill","claude"]` — neither can express a
 * path scope), unpiped:
 *
 *     build   EXIT 1  "Path scoping cannot be expressed on: skill, claude"
 *     doctor  Coverage  "OK Capability coverage - nothing to check: no capability
 *                        in the support table is configured on this hub"
 *             Scoping   "OK Path scoping is expressible on every configured target"
 *
 * The build refuses and doctor says everything is fine, about the same file. Move
 * the same bytes to `core/instructions` and doctor says
 * "instructions[].applyTo - configured, but needs one of: copilot, cursor,
 * jetbrains, windsurf". Same file, opposite verdict, decided only by which
 * directory it sits in — which is verbatim the sentence NEW-1 wrote about
 * `assertScopeKeysParse`. NEW-1 fixed the enumeration for the malformed-scope
 * gate and left the capability/doctor surfaces on the old two-element literal.
 *
 * So: one derivation, three consumers, and no call site permitted to build the
 * list itself. Boundary-checked identically to `resolveDomainDirs` — a domain
 * that escapes the project root is not compiled, so counting it would fire the
 * gate on a file that ships nowhere.
 */
export function scopeBearingInstructionDirs(
  packageInstructionsDir: string,
  coreInstructionsDir: string,
  config: AgentBootConfig,
  configDir: string,
): InstructionDirSpec[] {
  const enabled = config.instructions?.enabled;
  const dirs: InstructionDirSpec[] = [
    { dir: packageInstructionsDir, enabled },
    { dir: coreInstructionsDir, enabled },
  ];
  const boundary = path.resolve(configDir);
  for (const domainRef of config.domains ?? []) {
    const domainPath =
      typeof domainRef === "string"
        ? path.resolve(configDir, domainRef)
        : path.resolve(configDir, domainRef.path ?? `./domains/${domainRef.name}`);
    if (!fs.existsSync(domainPath)) continue;
    let realDomainPath: string;
    try {
      realDomainPath = fs.realpathSync(domainPath);
    } catch {
      continue;
    }
    if (!realDomainPath.startsWith(boundary + path.sep) && realDomainPath !== boundary) continue;
    // `enabled: undefined` + `separate` mirror compileDomains(): every
    // instruction in a configured domain is compiled, into its own scopePath.
    dirs.push({ dir: path.join(realDomainPath, "instructions"), enabled: undefined, separate: true });
  }
  return dirs;
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
  // EVERY content dir of a referenced domain — traits, personas AND
  // instructions. Naming two of the three here is the defect this function
  // exists to prevent: the omitted one still compiles and still syncs, so a
  // credential in it rode a "✓ Secret scan" all the way to every spoke.
  for (const d of resolveDomainDirs(config, configDir)) {
    roots.push(...d.contentDirs);
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
