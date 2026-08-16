/**
 * R4N-6 — the tracked hub registry leaked a machine-local path into git.
 *
 * `repos.json` is the hub's spoke registry: MACHINE-LOCAL STATE that happens to
 * be tracked so a fresh clone starts from a known-empty list. A `git add -A`
 * swept one developer's throwaway test entry into the tracked blob:
 *
 *   [{"path":"/var/folders/mk/…/T/agentboot-chmod-rerun-sVTj6c",
 *     "label":"chmod-rerun-test","platform":"claude"}]
 *
 * It never shipped in the npm tarball, so every packaging check stayed green —
 * and it would still have gone public the instant the branch was pushed. That is
 * the disclosure class the project's own gate exists to catch: a local absolute
 * path names a username, a machine, and a directory layout.
 *
 * WHY THIS READS THE TRACKED BLOB AND NOT THE WORKING TREE. Every real hub
 * operator's working-tree `repos.json` legitimately lists their own repos by
 * absolute path — asserting on the file on disk would fail for all of them and
 * be deleted within a week. The invariant is about what git carries, so the
 * check reads what git carries: the index blob (what the next commit will
 * contain) and the HEAD blob (what the branch already carries). A local edit is
 * nobody's business; a committed one is everybody's.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" });
}

/**
 * The registry as git carries it, from two refs that matter for disclosure.
 *
 * Deliberately NOT tolerant of a missing git or a missing file: a guard that
 * silently returns "nothing to check" when its input is unavailable is the
 * fail-open shape this codebase keeps rediscovering. If this cannot read the
 * tracked blob it must go red, not quiet.
 */
function trackedRegistries(): Array<{ ref: string; raw: string }> {
  const out: Array<{ ref: string; raw: string }> = [];
  // The index — what `git commit` would write. Catches the leak BEFORE it is
  // in history, which is the only cheap moment to catch it.
  const indexEntry = git(["ls-files", "-s", "--", "repos.json"]).trim();
  expect(indexEntry, "repos.json must be tracked").not.toBe("");
  const blobSha = indexEntry.split(/\s+/)[1]!;
  out.push({ ref: "index", raw: git(["cat-file", "blob", blobSha]) });
  // HEAD — what the branch already carries and would publish on push.
  out.push({ ref: "HEAD", raw: git(["show", "HEAD:repos.json"]) });
  return out;
}

/** Absolute on either platform: POSIX `/…` or Windows `C:\…` / UNC `\\…`. */
function isAbsolutePathish(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

function collectPaths(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) return [];
  const paths: string[] = [];
  for (const entry of parsed) {
    if (entry && typeof entry === "object") {
      for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
        // `path`, `hubPath`, `worktree` … any string field can carry a location.
        if (typeof value === "string" && isAbsolutePathish(value)) {
          paths.push(`${key}=${value}`);
        }
      }
    }
  }
  return paths;
}

describe("tracked repos.json — no machine-local state in git", () => {
  it("parses as a JSON array in every tracked ref", () => {
    for (const { ref, raw } of trackedRegistries()) {
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(raw);
      }, `repos.json at ${ref} must be valid JSON`).not.toThrow();
      expect(Array.isArray(parsed), `repos.json at ${ref} must be a JSON array`).toBe(true);
    }
  });

  it("carries no absolute path outside the hub — the R4N-6 guard", () => {
    for (const { ref, raw } of trackedRegistries()) {
      const offenders = collectPaths(JSON.parse(raw)).filter((p) => {
        const value = p.slice(p.indexOf("=") + 1);
        const rel = path.relative(ROOT, value);
        // Inside the hub is fine (a checked-in fixture could legitimately sit
        // there). Anything that escapes the hub root names a foreign machine.
        return rel.startsWith("..") || path.isAbsolute(rel);
      });
      expect(
        offenders,
        `repos.json at ${ref} carries machine-local absolute path(s) outside the hub: ` +
          `${offenders.join(", ")}. repos.json is local registry state — keep it out of git.`
      ).toEqual([]);
    }
  });

  it("is empty at HEAD — a fresh clone starts with no spokes", () => {
    const head = trackedRegistries().find((r) => r.ref === "HEAD")!;
    expect(
      JSON.parse(head.raw),
      "the tracked registry ships empty; operator entries stay on the operator's machine"
    ).toEqual([]);
  });
});
