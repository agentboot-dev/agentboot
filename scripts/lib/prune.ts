/**
 * Pruning primitives — the pure functions behind "revocation actually works".
 *
 * Two independent halves, deliberately kept side effect free so both can be
 * unit tested without running a build or touching a spoke:
 *
 *   diffTrees()          — hub side. What did THIS build stop producing?
 *   planOrphanRemoval()  — spoke side. What did this sync stop delivering, and
 *                          which of those may we safely unlink?
 *
 * Why this file exists at all: before it, `compile` only ever wrote into
 * `dist/` and `sync` only ever wrote into a spoke. Revoking an artifact at the
 * hub removed it from the manifest without removing it from disk, which turned
 * a governed artifact into an untracked one and made `drift-check` report
 * "clean" precisely BECAUSE the withdrawn control had stopped being tracked.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Hub side — dist/ tree diffing
// ---------------------------------------------------------------------------

export interface TreeDiff {
  /** Individual files present before and absent after, excluding anything
   *  inside a wholly-removed top-level tree (those roll up to retiredTrees). */
  removed: string[];
  /** Top-level directories that existed before and do not exist at all after. */
  retiredTrees: string[];
}

function topLevelDirOf(relPath: string): string | null {
  const i = relPath.indexOf("/");
  return i === -1 ? null : relPath.slice(0, i);
}

/**
 * Diff two inventories of relative POSIX paths.
 *
 * The "retired platform tree" set is computed from the OBSERVED diff, never
 * from `validFormats \ outputFormats`. That distinction is load-bearing:
 * `dist/plugin/` is emitted whenever `claude` is in outputFormats (plugin is
 * derived from claude), and `dist/schema/`, `dist/managed/` and
 * `dist/persona-sizes.json` are not platforms at all. A rule phrased over the
 * format lists deletes live output; a rule phrased over the observed diff
 * cannot drift from the emitters.
 */
export function diffTrees(before: string[], after: string[]): TreeDiff {
  const afterSet = new Set(after);
  const afterTops = new Set(
    after.map(topLevelDirOf).filter((t): t is string => t !== null),
  );

  const beforeTops = new Set(
    before.map(topLevelDirOf).filter((t): t is string => t !== null),
  );

  const retiredTrees = [...beforeTops].filter((t) => !afterTops.has(t)).sort();
  const retiredSet = new Set(retiredTrees);

  const removed = before
    .filter((p) => !afterSet.has(p))
    .filter((p) => {
      const top = topLevelDirOf(p);
      return !(top !== null && retiredSet.has(top));
    })
    .sort();

  return { removed, retiredTrees };
}

/** Recursively inventory a directory as relative POSIX paths. Missing dir → []. */
export function inventoryTree(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out.sort();
}

// ---------------------------------------------------------------------------
// Spoke side — orphan removal planning
// ---------------------------------------------------------------------------

export type RemovalBlockReason = "modified-locally";

export interface OrphanPlan {
  /** Safe to unlink: AgentBoot wrote it, nobody has touched it, it is no
   *  longer produced. */
  remove: string[];
  /** The spoke edited this file since we delivered it. NEVER deleted. */
  blocked: Array<{ path: string; reason: RemovalBlockReason }>;
  /** Matched a `retain` pattern — never deleted, reported at warn level. */
  retained: string[];
}

/**
 * G1: thrown when `sync.prune.retain` contains a pattern that is not a valid
 * regular expression. Carries every bad pattern, not just the first — an
 * operator with three typos needs three, not a three-build loop.
 */
export class InvalidRetainPatternError extends Error {
  constructor(public readonly patterns: Array<{ pattern: string; reason: string }>) {
    super(
      `Invalid sync.prune.retain pattern(s):\n` +
      patterns.map((p) => `      ${JSON.stringify(p.pattern)} — ${p.reason}`).join("\n") +
      `\n      A retain pattern says "never delete this". An uncompilable one used to be` +
      `\n      dropped silently, which turns "keep this file" into "delete this file".`,
    );
    this.name = "InvalidRetainPatternError";
  }
}

/** Paths sync itself owns and must never treat as an orphan. */
function isSelfManaged(relPath: string): boolean {
  return (
    relPath.endsWith(".agentboot-manifest.json") ||
    relPath.endsWith(".agentboot-manifest.intoto.json") ||
    relPath.includes(".agentboot-archive/")
  );
}

/**
 * Decide what a sync may unlink from a spoke.
 *
 * INVARIANT — and this is the entire safety argument for deletion being
 * default-on with no flag: `prev` is the PREVIOUS MANIFEST, which lists only
 * files sync itself wrote. Removal is confined to that set, so sync can never
 * delete a file it did not create.
 *
 * @param prev   previous manifest: repo-relative POSIX path → sha256 hash
 * @param kept   paths this sync would (re)write — anything here is not an orphan
 * @param onDisk current sha256 of a path, or null when the file is already gone
 * @param retain regex sources; a match is never removed and reports at warn level
 */
export function planOrphanRemoval(
  prev: Map<string, string> | null,
  kept: Set<string>,
  onDisk: (relPath: string) => string | null,
  retain: string[] = [],
): OrphanPlan {
  const plan: OrphanPlan = { remove: [], blocked: [], retained: [] };
  if (!prev) return plan; // first sync — nothing was ever delivered

  // G1: an UNCOMPILABLE retain pattern is an ERROR, not a dropped filter.
  //
  // `try { new RegExp(r) } catch { return null }` followed by `.filter(...)`
  // meant a typo in a "keep this file" pattern silently became "delete this
  // file" — the exact inversion this module is written to prevent, inside the
  // code written to enforce Silence Is Not Success. The operator's intent was
  // PROTECTIVE; the failure mode was destructive; the diagnostic was nothing.
  //
  // Throwing is right rather than dropping-and-warning: the caller is about to
  // unlink files, and a warning printed above a completed deletion is not a
  // choice the operator got to make.
  const retainRes: RegExp[] = [];
  const badPatterns: Array<{ pattern: string; reason: string }> = [];
  for (const r of retain) {
    try {
      retainRes.push(new RegExp(r));
    } catch (err: unknown) {
      badPatterns.push({ pattern: r, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if (badPatterns.length > 0) {
    throw new InvalidRetainPatternError(badPatterns);
  }

  for (const [relPath, expectedHash] of prev) {
    if (kept.has(relPath)) continue;
    if (isSelfManaged(relPath)) continue;

    if (retainRes.some((re) => re.test(relPath))) {
      plan.retained.push(relPath);
      continue;
    }

    const actual = onDisk(relPath);
    if (actual === null) continue; // already gone — nothing to do, say nothing

    if (actual === expectedHash) {
      plan.remove.push(relPath);
    } else {
      plan.blocked.push({ path: relPath, reason: "modified-locally" });
    }
  }

  plan.remove.sort();
  plan.retained.sort();
  plan.blocked.sort((a, b) => a.path.localeCompare(b.path));
  return plan;
}

/**
 * Remove directories left empty by a deletion, bottom-up. Never removes `root`.
 */
export function pruneEmptyDirs(root: string, removedRelPaths: string[]): void {
  const rootResolved = path.resolve(root);
  const candidates = new Set<string>();
  for (const rel of removedRelPaths) {
    let dir = path.dirname(path.resolve(root, rel));
    while (dir.startsWith(rootResolved) && dir !== rootResolved) {
      candidates.add(dir);
      dir = path.dirname(dir);
    }
  }
  // Deepest first so a parent becomes empty only after its children are gone.
  for (const dir of [...candidates].sort((a, b) => b.length - a.length)) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch {
      /* best effort — a non-empty or locked dir is not an error */
    }
  }
}
