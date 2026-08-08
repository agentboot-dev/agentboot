/**
 * N1: `dist/` freshness — a build-outcome sentinel.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The staging swap (F-1) made a failed build leave the previous `dist/`
 * **byte-identical**. That is the right blast-radius behaviour and the wrong
 * *trust* behaviour: nothing anywhere recorded that the tree on disk no longer
 * corresponds to the hub config. So an operator could revoke a control, watch
 * the build fail, run `agentboot sync`, and be told `skipped (no changes)` —
 * because there genuinely were none. The revoked control shipped, signed, with
 * a green exit code.
 *
 * The product's own thesis is *verify, don't trust*. This applies it to
 * AgentBoot's own pipeline: the build stamps its outcome and the digest of the
 * config it was produced from, and every consumer of `dist/` (sync,
 * drift-check, audit) verifies that stamp before it is willing to call the tree
 * authoritative.
 *
 * THREE WAYS A `dist/` IS UNTRUSTWORTHY, ALL FAIL CLOSED:
 *   1. `missing`      — no stamp at all (pre-N1 tree, hand-assembled tree, or a
 *                       build that died before it could stamp).
 *   2. `failed`       — the last build attempt against this tree failed. The
 *                       failure path *overwrites* the stamp in the real dist/,
 *                       which is the only thing a failed build is allowed to
 *                       write there.
 *   3. `config-stale` — the stamp's config digest does not match the config on
 *                       disk now. This is the revocation case: the operator
 *                       edited the config, the build did not succeed against
 *                       the edit, so `dist/` reflects the *previous* policy.
 *
 * "Unknown ⇒ trusted" is the exact mistake that let the HARD guardrail gate
 * fail open on `plugin`. There is no fourth, permissive branch here on purpose.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

/** Lives at the ROOT of dist/, never inside a per-platform tree, so `sync` (which copies `dist/<platform>/`) can never ship it to a spoke. */
export const DIST_STAMP_FILE = ".agentboot-build.json";

export type DistBuildStatus = "success" | "failed";

export interface DistStamp {
  status: DistBuildStatus;
  /** Digest of the resolved config the build ran against. */
  configDigest: string;
  /** outputFormats as built — kept human-readable for the diagnostic. */
  outputFormats: string[];
  /** ISO timestamp of the build attempt. */
  builtAt: string;
  agentbootVersion: string;
  /** Present only on `status: "failed"` — why the build stopped, if known. */
  failureReason?: string;
}

/**
 * Top-level config keys that CANNOT change what the build emits, and are
 * therefore excluded from the freshness digest.
 *
 * `sync.*` (repos, signing, pr, targetDir, dryRun) governs DELIVERY, not
 * compilation — `compile.ts` never reads it (verified: zero `config.sync`
 * references). Including it made turning on manifest signing mark a
 * byte-for-byte-correct dist/ as stale, which is a false positive, and a
 * staleness error that fires when nothing is stale is how operators are trained
 * to ignore the real one.
 *
 * Deliberately a DENY-list, not an allow-list: a config key added later is
 * included in the digest by default. Over-reporting staleness costs a rebuild;
 * under-reporting it ships the wrong policy.
 */
const NON_BUILD_CONFIG_KEYS = new Set(["sync"]);

/**
 * Stable digest of the build-affecting part of the resolved config.
 *
 * Key order is normalized so a cosmetic re-serialization of the config file
 * does not read as a policy change (that would train operators to ignore the
 * staleness error, which is worse than not having it).
 */
export function computeConfigDigest(config: unknown): string {
  let subject = config;
  if (config && typeof config === "object" && !Array.isArray(config)) {
    subject = Object.fromEntries(
      Object.entries(config as Record<string, unknown>)
        .filter(([k]) => !NON_BUILD_CONFIG_KEYS.has(k)),
    );
  }
  return crypto.createHash("sha256").update(canonicalize(subject)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export function stampPath(distDir: string): string {
  return path.join(distDir, DIST_STAMP_FILE);
}

export function writeDistStamp(distDir: string, stamp: DistStamp): void {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(stampPath(distDir), JSON.stringify(stamp, null, 2) + "\n", "utf-8");
}

/**
 * Record that a build attempt FAILED against an existing dist/.
 *
 * Deliberately best-effort and deliberately silent-on-error: this runs on the
 * failure path, and an exception here would mask the real failure. It is a
 * *tightening* — the absence of this write leaves the stamp saying `success`
 * with a now-mismatched digest, which still fails closed via `config-stale`
 * whenever the config moved.
 */
export function markDistBuildFailed(distDir: string, failureReason: string, configDigest: string, outputFormats: string[], version: string): void {
  try {
    if (!fs.existsSync(distDir)) return; // nothing to invalidate
    writeDistStamp(distDir, {
      status: "failed",
      configDigest,
      outputFormats,
      builtAt: new Date().toISOString(),
      agentbootVersion: version,
      failureReason,
    });
  } catch {
    /* never mask the real failure */
  }
}

export function readDistStamp(distDir: string): DistStamp | null {
  try {
    const raw = fs.readFileSync(stampPath(distDir), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const s = parsed as Partial<DistStamp>;
    // A malformed stamp is treated as NO stamp — i.e. untrusted. Never as a pass.
    if (s.status !== "success" && s.status !== "failed") return null;
    if (typeof s.configDigest !== "string") return null;
    return {
      status: s.status,
      configDigest: s.configDigest,
      outputFormats: Array.isArray(s.outputFormats) ? s.outputFormats : [],
      builtAt: typeof s.builtAt === "string" ? s.builtAt : "unknown",
      agentbootVersion: typeof s.agentbootVersion === "string" ? s.agentbootVersion : "unknown",
      ...(typeof s.failureReason === "string" ? { failureReason: s.failureReason } : {}),
    };
  } catch {
    return null;
  }
}

export type DistFreshnessReason = "missing" | "failed" | "config-stale";

export interface DistFreshness {
  fresh: boolean;
  reason?: DistFreshnessReason;
  /** Operator-facing explanation, already includes the remedy. */
  detail?: string;
  stamp?: DistStamp;
}

/**
 * The gate. FAILS CLOSED on every unknown: no stamp, unreadable stamp, failed
 * build, or a config that has moved since the last successful build.
 */
export function checkDistFreshness(distDir: string, config: unknown): DistFreshness {
  const stamp = readDistStamp(distDir);
  if (!stamp) {
    return {
      fresh: false,
      reason: "missing",
      detail:
        `dist/ carries no build stamp (${DIST_STAMP_FILE}), so nothing records whether the tree\n` +
        `      corresponds to the current hub config. A failed build leaves the previous dist/\n` +
        `      byte-identical, so "the files are there" is not evidence that they are current.\n` +
        `      Fix: run \`agentboot build\` and let it succeed.`,
    };
  }
  if (stamp.status === "failed") {
    return {
      fresh: false,
      reason: "failed",
      stamp,
      detail:
        `the last build against this dist/ FAILED (${stamp.builtAt}).\n` +
        (stamp.failureReason ? `      Cause: ${stamp.failureReason}\n` : "") +
        `      The tree on disk is the output of an EARLIER build, so it reflects the policy that\n` +
        `      was in force before your most recent edit.\n` +
        `      Fix: run \`agentboot build\` and let it succeed.`,
    };
  }
  const current = computeConfigDigest(config);
  if (current !== stamp.configDigest) {
    return {
      fresh: false,
      reason: "config-stale",
      stamp,
      detail:
        `dist/ was built from a DIFFERENT hub config (stamped ${stamp.builtAt}).\n` +
        `      stamped config digest: ${stamp.configDigest.slice(0, 16)}…\n` +
        `      current config digest: ${current.slice(0, 16)}…\n` +
        `      If you revoked or changed a control and the rebuild did not succeed, shipping this\n` +
        `      tree ships the OLD policy under a signed manifest.\n` +
        `      Fix: run \`agentboot build\` and let it succeed.`,
    };
  }
  return { fresh: true, stamp };
}

/**
 * One message shape for every consumer of `dist/`.
 *
 * `sync`, `drift-check` and `audit` all previously reported green against a
 * stale tree, each for its own reason. Giving them three separately-worded
 * refusals would be the same drift in a new costume — one formatter, three
 * call sites.
 */
export function staleDistMessage(check: DistFreshness, command: string): string {
  return (
    `✗ refusing to run \`${command}\` against a stale dist/ — ${check.reason}\n` +
    `      ${check.detail ?? ""}\n` +
    `      A build that fails leaves the previous dist/ byte-identical, so the presence of\n` +
    `      files is not evidence that they reflect current policy. Reporting on this tree\n` +
    `      would report on the policy it REPLACED.`
  );
}
