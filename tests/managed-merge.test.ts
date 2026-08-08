/**
 * Unit guards for F-5 — the managed scope merge.
 *
 * `dist/managed/scopes/<scope>/managed-settings.json` is the file an MDM
 * operator deploys and a developer cannot override. The merge discarded `hooks`
 * wholesale (a shallow `merged[k] = v`, with a union path for `permissions`
 * only), so an org's PreToolUse gate survived in the developer-overridable
 * project settings and vanished from the non-overridable channel.
 *
 * These are unit tests on purpose: they make the mutation proof a one-second
 * loop instead of a full build per mutation.
 */

import { describe, it, expect } from "vitest";
import { mergeHooks, mergeManagedFragments } from "../scripts/lib/managed-merge.js";

const orgHooks = {
  PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/opt/org/block.sh" }] }],
  SubagentStart: [{ matcher: "", hooks: [{ type: "command", command: "/opt/org/audit.sh" }] }],
};
const guardrailHooks = {
  SubagentStart: [{ matcher: "", hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh" }] }],
  SubagentStop: [{ matcher: "", hooks: [{ type: "command", command: ".claude/hooks/agentboot-telemetry.sh" }] }],
};

const cmds = (h: Record<string, unknown[]> | undefined, event: string): string[] =>
  ((h?.[event] ?? []) as any[]).flatMap((g) => (g.hooks ?? []).map((x: any) => x.command)).sort();

describe("mergeHooks — union per event, over the entry arrays", () => {
  it("keeps every event from both sides", () => {
    const h = mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]);
    expect(Object.keys(h!).sort()).toEqual(["PreToolUse", "SubagentStart", "SubagentStop"]);
  });

  it("keeps BOTH entries when the same event is declared on both sides", () => {
    // The escalation the original report missed. An event-level spread
    // (`{...a.hooks, ...b.hooks}`) passes the previous test and fails this one.
    const h = mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]);
    expect(h!.SubagentStart).toHaveLength(2);
    expect(cmds(h, "SubagentStart")).toEqual([
      ".claude/hooks/agentboot-telemetry.sh", "/opt/org/audit.sh",
    ]);
  });

  it("orders lowest-precedence first, matching generateComplianceSettingsJson", () => {
    // Deterministic order matters: the artifact is hashed into the signed manifest.
    const h = mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]);
    expect(cmds({ SubagentStart: [h!.SubagentStart![0]] } as any, "SubagentStart"))
      .toEqual(["/opt/org/audit.sh"]);
  });

  it("dedupes an identical entry declared on both sides", () => {
    const dup = { SubagentStart: [{ matcher: "", hooks: [{ type: "command", command: "/same.sh" }] }] };
    const h = mergeHooks([{ hooks: dup }, { hooks: structuredClone(dup) }]);
    expect(h!.SubagentStart).toHaveLength(1);
  });

  it("dedupes regardless of key ORDER inside the entry object", () => {
    const a = { X: [{ matcher: "", hooks: [{ type: "command", command: "/s.sh" }] }] };
    const b = { X: [{ hooks: [{ command: "/s.sh", type: "command" }], matcher: "" }] };
    expect(mergeHooks([{ hooks: a }, { hooks: b }])!.X).toHaveLength(1);
  });

  it("NEGATIVE: no fragment declares hooks → undefined, so the key is omitted", () => {
    expect(mergeHooks([{ cleanupPeriodDays: 7 }, {}])).toBeUndefined();
  });

  it("NEGATIVE: a non-object or non-array hooks value is ignored, not thrown on", () => {
    expect(mergeHooks([{ hooks: "nope" }, { hooks: null }])).toBeUndefined();
    expect(mergeHooks([{ hooks: { X: "nope" } }])).toEqual({ X: [] });
  });
});

describe("mergeManagedFragments — scalars, unions, and the residual collision", () => {
  it("unions hooks and permissions, and reports what it unioned", () => {
    const r = mergeManagedFragments(
      [{ hooks: guardrailHooks, permissions: { deny: ["curl*"] } },
       { hooks: orgHooks, permissions: { deny: ["WebFetch"], allow: ["Read"] } }],
      ["guardrails", "00-org"],
    );
    expect(Object.keys(r.merged.hooks as object).sort())
      .toEqual(["PreToolUse", "SubagentStart", "SubagentStop"]);
    expect((r.merged.permissions as any).deny.sort()).toEqual(["WebFetch", "curl*"]);
    expect(r.unionedHookEvents).toEqual(["PreToolUse", "SubagentStart", "SubagentStop"]);
    expect(r.permissionCounts).toEqual({ deny: 2, allow: 1 });
    expect(r.conflicts).toEqual([]);
  });

  it("NEGATIVE: one hooks contributor reports no union — the line would be noise", () => {
    const r = mergeManagedFragments([{ hooks: orgHooks }, {}], ["guardrails", "00-org"]);
    expect(r.unionedHookEvents).toEqual([]);
    expect(Object.keys(r.merged.hooks as object).sort()).toEqual(["PreToolUse", "SubagentStart"]);
  });

  it("NEGATIVE: an IDENTICAL scalar in two fragments is not a conflict", () => {
    // claude.settings is copied into BOTH the guardrail base and 00-org, so
    // identical-value collisions are the normal case. Reporting them would make
    // every hub with claude.settings fail.
    const r = mergeManagedFragments(
      [{ cleanupPeriodDays: 30 }, { cleanupPeriodDays: 30 }], ["guardrails", "00-org"],
    );
    expect(r.conflicts).toEqual([]);
    expect(r.merged.cleanupPeriodDays).toBe(30);
  });

  it("NEGATIVE: deep-equal objects that differ only in key order are not a conflict", () => {
    const r = mergeManagedFragments(
      [{ env: { A: "1", B: "2" } }, { env: { B: "2", A: "1" } }], ["guardrails", "00-org"],
    );
    expect(r.conflicts).toEqual([]);
  });

  it("reports a differing scalar once, naming winner, loser and both sources", () => {
    const r = mergeManagedFragments(
      [{ cleanupPeriodDays: 30 }, { cleanupPeriodDays: 7 }], ["guardrails", "00-org"],
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({
      key: "cleanupPeriodDays", keptValue: 30, keptSource: "guardrails",
      discarded: [{ value: 7, source: "00-org" }],
    });
    expect(r.merged.cleanupPeriodDays).toBe(30); // higher precedence still wins
  });

  it("with three fragments reports ONE conflict listing every loser", () => {
    // Pairwise reporting would name an intermediate "winner" that does not win.
    const r = mergeManagedFragments(
      [{ k: 1 }, { k: 2 }, { k: 3 }], ["guardrails", "00-org", "10-group(platform)"],
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.keptValue).toBe(1);
    expect(r.conflicts[0]!.discarded.map((d) => d.value)).toEqual([2, 3]);
    expect(r.merged.k).toBe(1);
  });

  it("NEGATIVE: permissions and hooks are never reported as conflicts — they are unioned", () => {
    const r = mergeManagedFragments(
      [{ hooks: guardrailHooks, permissions: { deny: ["a"] } },
       { hooks: orgHooks, permissions: { deny: ["b"] } }],
      ["guardrails", "00-org"],
    );
    expect(r.conflicts.map((c) => c.key)).toEqual([]);
  });

  it("`//` comment keys never reach the deployable", () => {
    const r = mergeManagedFragments([{ "// source": "x", k: 1 }, {}], ["a", "b"]);
    expect(Object.keys(r.merged)).toEqual(["k"]);
  });
});
