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
  /**
   * A1/A2-residual: digest of the ARTIFACT SOURCES the build ran against.
   *
   * The config digest alone reproduced N1 verbatim for the surface where policy
   * is actually declared. `guardrail: hard`, `applyTo:` and the control TEXT
   * are artifact frontmatter and body under `core/` — none of it is in
   * agentboot.config.json. Measured on a scratch hub: tighten a shipped
   * instruction from soft ("Avoid logging patient data where practical") to
   * `guardrail: hard` + "NEVER log, trace, or print patient-identifying data.
   * Non-overridable.", do not rebuild, then —
   *     sync        EXIT 0  "– spokeV (claude) — skipped (no changes)" / "✓ Synced 0 of 1 repo"
   *     drift-check EXIT 0  "1/1 clean"
   *     audit       EXIT 0
   *     stamp       "success"
   * — and the spoke still carried the soft text. The operator edited policy and
   * simply did not rebuild, which is the third case N1 named and the config
   * digest could not see.
   *
   * Optional on read so a stamp written before this field is treated as
   * `missing` for the source dimension rather than as a pass.
   */
  sourceDigest?: string;
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
      ...(typeof s.sourceDigest === "string" ? { sourceDigest: s.sourceDigest } : {}),
      ...(typeof s.failureReason === "string" ? { failureReason: s.failureReason } : {}),
    };
  } catch {
    return null;
  }
}

export type DistFreshnessReason = "missing" | "failed" | "config-stale" | "sources-stale";

/**
 * Hub directories whose CONTENT the compiler reads as artifact source.
 *
 * Derived from scripts/compile.ts (`path.join(HUB_ROOT, …)` / `path.join(hubRoot, …)`)
 * and pinned there by tests/dist-source-digest.test.ts — if the compiler learns
 * to read a new hub directory and it is not listed here, that test fails. This
 * is the same invariant shape as DIST_CONSUMERS: the set that must not drift is
 * asserted in code, not remembered.
 *
 * `domains/` is not listed because domain paths are configurable; the caller
 * passes the resolved paths in as `extraRoots`.
 */
export const HUB_SOURCE_ROOTS = ["core", "nodes", "groups", "teams"] as const;

/** Files at the hub root that are build INPUT (not delivery config). */
export const HUB_SOURCE_FILES = [".agentboot-exceptions.json"] as const;

function hashFileInto(hash: crypto.Hash, rel: string, abs: string): void {
  hash.update(rel.replace(/\\/g, "/"));
  hash.update("\0");
  try {
    hash.update(fs.readFileSync(abs));
  } catch {
    // Unreadable input is a CHANGE, not a nothing: fold the error in so the
    // digest moves rather than silently matching the last good build.
    hash.update("<unreadable>");
  }
  hash.update("\0");
}

function walkInto(hash: crypto.Hash, root: string, rel: string, seen: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  // Sorted so the digest is a property of the tree, not of readdir order.
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(root, childRel);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (e.isDirectory()) walkInto(hash, root, childRel, seen);
    else if (e.isFile()) hashFileInto(hash, childRel, abs);
  }
}

/**
 * Digest of every artifact source the build compiles from.
 *
 * Covers file NAMES as well as contents, so deleting an artifact moves the
 * digest exactly as editing one does — a revocation that never rebuilt is the
 * same lie as an edit that never rebuilt.
 */
export function computeSourceDigest(hubRoot: string, extraRoots: string[] = []): string {
  const hash = crypto.createHash("sha256");
  const seen = new Set<string>();
  for (const root of HUB_SOURCE_ROOTS) {
    hash.update(`::${root}::`);
    walkInto(hash, path.join(hubRoot, root), "", seen);
  }
  for (const f of HUB_SOURCE_FILES) {
    const abs = path.join(hubRoot, f);
    hash.update(`::${f}::`);
    if (fs.existsSync(abs)) hashFileInto(hash, f, abs);
  }
  // Domain roots are configurable, so they arrive resolved. Sorted for the same
  // reason the walk is: the digest must not depend on config array order.
  for (const d of [...extraRoots].sort()) {
    hash.update(`::domain:${path.basename(d)}::`);
    walkInto(hash, d, "", seen);
  }
  return hash.digest("hex");
}

/**
 * Resolve the domain roots a build would read, from the config.
 *
 * Mirrors compileDomains' own resolution (string ref → path, object ref →
 * `.path` or `./domains/<name>`) so the digest covers exactly what compiles.
 */
export function resolveDomainRoots(hubRoot: string, config: unknown): string[] {
  const domains = (config as { domains?: Array<string | { name?: string; path?: string }> })?.domains;
  if (!Array.isArray(domains)) return [];
  return domains.map((d) =>
    typeof d === "string"
      ? path.resolve(hubRoot, d)
      : path.resolve(hubRoot, d.path ?? `./domains/${d.name}`),
  );
}

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
/**
 * The CONFIG-INDEPENDENT half of the gate: is this tree the output of a build
 * that SUCCEEDED?
 *
 * NF2-1: `install-user` and `publish` gated on `if (config)` /
 * `if (fs.existsSync(publishConfigPath))`, so pointed at a `dist/` with no hub
 * config beside it they installed org policy into ~/.claude and published a
 * plugin from a tree whose own stamp said `status: "failed"` — at exit 0.
 * Measured: same bytes, same stamp, exit 1 inside the hub and exit 0 one
 * directory over. install-user even PRUNED from that tree ("Would withdraw 1
 * revoked artifact(s)"), i.e. it acted on the stale tree's idea of what is
 * revoked.
 *
 * "Missing stamp" and "status: failed" need NO config to read. Putting them
 * behind a config-presence check is "existence read as freshness" relocated one
 * level up — in the very command the A2-residual commit named as "a SECOND
 * delivery channel". They are separated here so a caller without a hub still
 * gets the dimensions that do not require one, instead of getting nothing.
 */
export function checkDistStamp(distDir: string): DistFreshness {
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
  return { fresh: true, stamp };
}

export function checkDistFreshness(
  distDir: string,
  config: unknown,
  /**
   * Hub root, for the artifact-source dimension.
   *
   * REQUIRED, not optional. It used to be optional with a comment saying
   * "omitted only by callers that genuinely have no hub (there are none in the
   * CLI)" — a comment is not a guard. Dropping the argument at sync.ts kept tsc
   * clean and restored the defect verbatim; dropping it at the doctor call site
   * kept tsc clean AND the whole dist-freshness suite green while doctor
   * reported a tightened-but-unrebuilt hub as healthy. C4 made exactly this
   * argument required for the scope gate and this one was left optional.
   *
   * A caller with no hub config wants `checkDistStamp` — which gives it the
   * dimensions that do not need one, rather than a silent skip of the ones that
   * do.
   */
  hubRoot: string,
): DistFreshness {
  const base = checkDistStamp(distDir);
  if (!base.fresh) return base;
  const stamp = base.stamp!;
  {
    const currentSources = computeSourceDigest(hubRoot, resolveDomainRoots(hubRoot, config));
    if (!stamp.sourceDigest) {
      return {
        fresh: false,
        reason: "sources-stale",
        stamp,
        detail:
          `dist/ was stamped by a build that did not record an artifact-source digest\n` +
          `      (stamped ${stamp.builtAt}). Nothing records whether core/ has been edited since,\n` +
          `      and that is where guardrail: hard, applyTo: and the control text live.\n` +
          `      Fix: run \`agentboot build\` and let it succeed.`,
      };
    }
    if (currentSources !== stamp.sourceDigest) {
      return {
        fresh: false,
        reason: "sources-stale",
        stamp,
        detail:
          `the hub's ARTIFACTS have changed since dist/ was built (stamped ${stamp.builtAt}).\n` +
          `      stamped source digest: ${stamp.sourceDigest.slice(0, 16)}…\n` +
          `      current source digest: ${currentSources.slice(0, 16)}…\n` +
          `      Most policy is not in agentboot.config.json: \`guardrail: hard\`, \`applyTo:\` and\n` +
          `      the control text itself are artifact frontmatter and body under core/. Tightening\n` +
          `      a control and not rebuilding leaves the SOFT version on every spoke, and every\n` +
          `      command reporting green.\n` +
          `      Fix: run \`agentboot build\` and let it succeed.`,
      };
    }
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
export function staleDistMessage(
  check: DistFreshness,
  command: string,
  /**
   * `refuse` — the command stops (the `gated` posture).
   * `report` — the command continues and folds this into its own result (the
   *            `reports` posture: doctor, status, lint). Same finding, same
   *            wording, honest verb. Printing "refusing to run `status`" from a
   *            command that then runs is a small lie that trains operators to
   *            stop reading the message.
   */
  mode: "refuse" | "report" = "refuse",
): string {
  const lead =
    mode === "refuse"
      ? `✗ refusing to run \`${command}\` against a stale dist/`
      : `✗ \`${command}\` is reporting on a stale dist/`;
  return (
    `${lead} — ${check.reason}\n` +
    `      ${check.detail ?? ""}\n` +
    `      A build that fails leaves the previous dist/ byte-identical, so the presence of\n` +
    `      files is not evidence that they reflect current policy. Reporting on this tree\n` +
    `      would report on the policy it REPLACED.`
  );
}
