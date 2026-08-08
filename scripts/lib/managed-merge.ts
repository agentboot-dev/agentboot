/**
 * F-5: merging the managed-settings fragments that become the MDM deployable.
 *
 * `dist/managed/scopes/<scope>/managed-settings.json` is the file an MDM
 * operator deploys and a developer CANNOT override. Its inputs are the
 * guardrail base (`dist/managed/managed-settings.json`) and the generated
 * `managed-settings.d/` fragments (00-org / 10-group / 20-team).
 *
 * The merge was a shallow whole-value overwrite with one union path, for
 * `permissions`. That is right for a SCALAR — `cleanupPeriodDays` must have one
 * winning value — and wrong for an ADDITIVE control. `hooks` is additive in
 * exactly the sense `permissions.deny` is, and was not unioned, so the guardrail
 * base's `hooks` object replaced the org's wholesale.
 *
 * The result: an org's `PreToolUse` gate survived in
 * `dist/claude/core/settings.json` — the project-level, developer-OVERRIDABLE
 * file — and vanished from the non-overridable MDM channel. The control was
 * present exactly where it can be bypassed and absent where it cannot.
 *
 * Two things follow, and both are implemented here:
 *
 *  1. `hooks` is unioned PER EVENT, over the entry arrays. Not `{...a, ...b}`:
 *     `SubagentStart` is declared by BOTH sides (the org's audit hook and the
 *     generated telemetry hook), so an event-level spread still destroys one.
 *  2. The residual scalar-collision case becomes a build ERROR. Union fixes the
 *     one key where losing data was never intended; it does not fix the shallow
 *     overwrite as a CLASS. A discarded key on this channel is a control that
 *     was authored, validated and signed, and enforces nothing.
 *
 * NOTE: `mergeScopes` in scripts/sync.ts is an unrelated function of the same
 * name — it merges scoped FILES by composition manifest, not JSON keys. This
 * export is named differently on purpose.
 */

// ---------------------------------------------------------------------------

export interface MergeConflict {
  key: string;
  keptValue: unknown;
  keptSource: string;
  discarded: Array<{ value: unknown; source: string }>;
}

export interface MergeResult {
  merged: Record<string, unknown>;
  /** Keys present in ≥2 fragments with DIFFERENT values. Identical-value
   *  collisions are normal (claude.settings is copied into both the guardrail
   *  base and 00-org) and are never reported. */
  conflicts: MergeConflict[];
  /** Event names present in the merged `hooks`, when ≥2 fragments contributed
   *  hooks. Empty on the common single-source path, so the report stays quiet. */
  unionedHookEvents: string[];
  /** Union sizes, for the "what did the merge do" report. */
  permissionCounts: { deny: number; allow: number };
  /**
   * D1: hook events whose value was not an array, and therefore could not be
   * unioned. NON-EMPTY IS A BUILD ERROR — see the rationale on `mergeHooks`.
   */
  malformedHooks: MalformedHook[];
}

export interface MalformedHook {
  /** The event name, e.g. "PreToolUse". */
  event: string;
  /** Which fragment carried it, so the operator knows which file to open. */
  source: string;
  /** What was there instead of an array — `typeof`, or "null". */
  found: string;
}

/** Key-sorted canonical JSON — deep equality for JSON fragments by construction. */
function canonical(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = walk(o[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(walk(v));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Union `hooks` across fragments, per event, over the entry arrays.
 *
 * @param ordered fragments from HIGHEST precedence to lowest.
 *
 * Concatenation order is LOWEST-precedence-first, matching
 * `generateComplianceSettingsJson`, which appends AgentBoot's generated hooks
 * after the user's ("B1 fix: append compliance hooks instead of overwriting
 * user-defined hooks"). Deterministic order matters because this artifact is
 * hashed into the signed manifest — a non-deterministic union would show up as
 * phantom drift.
 *
 * Entries are deduplicated: an org may hand-declare the telemetry hook in
 * `claude.hooks` AND set `requireAuditLog`. Nothing prevents that, and without
 * dedupe the MDM file double-fires on every subagent start.
 */
export function mergeHooks(
  ordered: Array<Record<string, unknown>>,
  sourceLabels: string[] = [],
): { hooks: Record<string, unknown[]> | undefined; malformed: MalformedHook[] } {
  // Preserve the index so a malformed event can name the fragment it came from.
  const hookObjects = ordered
    .map((f, i) => ({ hooks: f["hooks"], source: sourceLabels[i] ?? `fragment[${i}]` }))
    .reverse() // lowest precedence first
    .filter((x): x is { hooks: Record<string, unknown>; source: string } => isPlainObject(x.hooks));
  if (hookObjects.length === 0) return { hooks: undefined, malformed: [] };

  const out: Record<string, unknown[]> = {};
  const malformed: MalformedHook[] = [];
  for (const { hooks: h, source } of hookObjects) {
    for (const [event, value] of Object.entries(h)) {
      // D1: a non-array event value used to become `[]` — the event was
      // DESTROYED and the merge said nothing. Worse, the build log then named
      // that event in "hooks unioned across N event(s)", because the empty
      // bucket still created the key. So the report positively asserted that a
      // control had been composed into the non-overridable MDM artifact while
      // the control had in fact been deleted.
      //
      // There is no correct silent recovery here. `[]` is not a conservative
      // default on this channel — it is the ABSENCE of a control, written into
      // the file a developer cannot override, at the request of an org that
      // asked for the opposite. Collect it and let the caller fail the build.
      if (!Array.isArray(value)) {
        malformed.push({ event, source, found: value === null ? "null" : typeof value });
        continue;
      }
      const bucket = (out[event] ??= []);
      for (const entry of value) {
        const sig = canonical(entry);
        if (!bucket.some((e) => canonical(e) === sig)) bucket.push(entry);
      }
    }
  }
  return { hooks: Object.keys(out).length > 0 ? out : undefined, malformed };
}

function mergePermissions(
  higher: Record<string, unknown> | undefined,
  lower: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!higher && !lower) return undefined;
  const merged: Record<string, unknown> = { ...(lower ?? {}), ...(higher ?? {}) };
  for (const key of ["deny", "allow"] as const) {
    const h = (higher?.[key] as string[] | undefined) ?? [];
    const l = (lower?.[key] as string[] | undefined) ?? [];
    const union = [...new Set([...h, ...l])];
    if (union.length > 0) merged[key] = union;
  }
  return merged;
}

/**
 * Merge managed-settings fragments ordered from HIGHEST precedence to lowest.
 *
 * @param sourceLabels human-readable label per fragment, same indexing as
 *   `ordered` — so a conflict can name WHICH scope won and which lost. An index
 *   is not actionable; "kept 30 (guardrails), discarded 7 (00-org)" is.
 */
export function mergeManagedFragments(
  ordered: Array<Record<string, unknown>>,
  sourceLabels: string[],
): MergeResult {
  const merged: Record<string, unknown> = {};

  // Apply lowest precedence first so higher scopes overwrite (scalars only —
  // `permissions` and `hooks` are unioned below).
  for (const frag of [...ordered].reverse()) {
    for (const [k, v] of Object.entries(frag)) {
      if (k.startsWith("//")) continue;
      if (k === "permissions" || k === "hooks") continue;
      merged[k] = v;
    }
  }

  const permissions = ordered
    .map((f) => f["permissions"] as Record<string, unknown> | undefined)
    .filter((p): p is Record<string, unknown> => p !== undefined)
    .reduce<Record<string, unknown> | undefined>((acc, p) => mergePermissions(acc, p), undefined);
  if (permissions) merged["permissions"] = permissions;

  const { hooks, malformed: malformedHooks } = mergeHooks(ordered, sourceLabels);
  if (hooks) merged["hooks"] = hooks;

  // Conflict detection over the shallow-overwrite class. Reported once per key,
  // with the winner and every loser, rather than once per pairwise overwrite —
  // with three fragments the intermediate "winner" would be a lie.
  const conflicts: MergeConflict[] = [];
  const scalarKeys = new Set<string>();
  for (const frag of ordered) {
    for (const k of Object.keys(frag)) {
      if (k.startsWith("//") || k === "permissions" || k === "hooks") continue;
      scalarKeys.add(k);
    }
  }
  for (const key of [...scalarKeys].sort()) {
    const present = ordered
      .map((f, i) => ({ value: f[key], source: sourceLabels[i] ?? `fragment[${i}]`, has: key in f }))
      .filter((x) => x.has);
    if (present.length < 2) continue;
    const winner = present[0]!; // ordered[0] is highest precedence
    const losers = present.slice(1).filter((p) => canonical(p.value) !== canonical(winner.value));
    if (losers.length === 0) continue; // identical values are not a loss
    conflicts.push({
      key,
      keptValue: winner.value,
      keptSource: winner.source,
      discarded: losers.map((l) => ({ value: l.value, source: l.source })),
    });
  }

  // Only report the union when ≥2 fragments actually contributed hooks —
  // otherwise it is noise on the common single-source path.
  const hookContributors = ordered.filter((f) => isPlainObject(f["hooks"])).length;
  const unionedHookEvents = hooks && hookContributors >= 2 ? Object.keys(hooks).sort() : [];

  return {
    merged,
    conflicts,
    unionedHookEvents,
    malformedHooks,
    permissionCounts: {
      deny: ((permissions?.["deny"] as string[] | undefined) ?? []).length,
      allow: ((permissions?.["allow"] as string[] | undefined) ?? []).length,
    },
  };
}
