/**
 * Path containment — the one place that answers "may this string become a path
 * segment under this root?"
 *
 * WHY THIS EXISTS
 *
 * `agentboot build` derives write paths from CONTENT, not just from config.
 * A gotcha's `paths:` frontmatter is turned into a directory name so Gemini's
 * subdirectory-GEMINI.md convention can be honoured. Content is the lowest-trust
 * input AgentBoot has: it arrives through `agentboot import`, through a
 * contributed gotcha in a hub repo, through the marketplace — i.e. through
 * exactly the governed-content path the product's threat model is about.
 *
 * Before this module, `path.join(distPath, "gemini", scopePath, targetDir)` with
 * `targetDir` taken verbatim out of a glob wrote an attacker-chosen GEMINI.md to
 * an arbitrary directory outside dist/ and outside the hub — and GEMINI.md is an
 * instruction file the Gemini CLI auto-loads, so that is an unsigned,
 * unmanifested, unprunable instruction planted anywhere on the filesystem, at
 * build exit 0 with no diagnostic on any surface.
 *
 * DESIGN NOTES
 *
 * - FAIL CLOSED. `resolveWithin` throws; it never "sanitises and continues".
 *   A segment that tries to escape is a finding, not a formatting problem, and
 *   silently rewriting it would leave the operator with an artifact whose scope
 *   is not the one the author wrote.
 * - The check is on the RESOLVED path, not on the segment text. Blocklisting
 *   ".." is the version of this check that gets bypassed; comparing
 *   `path.relative(root, resolved)` is the version that does not. It also
 *   catches absolute segments for free (`path.resolve` discards the root, and
 *   the relative path then climbs out).
 * - Symlinks are deliberately NOT resolved here. This module answers a question
 *   about the path AgentBoot is about to construct. Resolving would make the
 *   answer depend on filesystem state that can change between check and write.
 */

import path from "node:path";

/**
 * Thrown when a derived path segment would place a write outside its root.
 * Carries the pieces a diagnostic needs so call sites can name the offending
 * source file and pattern rather than printing a stack trace.
 */
export class PathEscapeError extends Error {
  constructor(
    readonly root: string,
    readonly attempted: string,
    readonly context: string
  ) {
    super(
      `${context}: resolved path escapes its root — ` +
        `root=${root} attempted=${attempted}`
    );
    this.name = "PathEscapeError";
  }
}

/**
 * True when `candidate` is `root` itself or lives underneath it.
 *
 * Uses `path.relative`, so it is correct for `..` segments, absolute segments,
 * and (on Windows) a different drive letter, all of which produce a relative
 * path that either starts with ".." or is itself absolute.
 */
export function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/**
 * `path.resolve(root, ...segments)` with the containment invariant asserted.
 *
 * @throws PathEscapeError when the result is not under `root`.
 */
export function resolveWithin(
  root: string,
  segments: string[],
  context: string
): string {
  const resolved = path.resolve(root, ...segments);
  if (!isWithin(root, resolved)) {
    throw new PathEscapeError(path.resolve(root), resolved, context);
  }
  return resolved;
}

/**
 * Guard for a single path SEGMENT that came from content or from a config key,
 * used where the caller wants to reject before building a path at all.
 *
 * Rejects: empty, absolute, any `..` component, and (defensively) NUL, which
 * truncates paths in some syscalls.
 *
 * Note this is a stricter, cheaper pre-filter — `resolveWithin` remains the
 * authoritative check and callers should use it even after this passes.
 */
export function isSafeRelativeSegment(segment: string): boolean {
  if (segment === "" || segment.includes("\0")) return false;
  if (path.isAbsolute(segment)) return false;
  // Treat both separators as separators regardless of platform: a hub authored
  // on Windows can carry backslashes that POSIX path.* would read as literal
  // characters in a filename.
  const parts = segment.split(/[\\/]+/);
  return !parts.includes("..") && !parts.includes(".") && parts.every((p) => p !== "");
}
