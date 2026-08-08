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
    const { hooks: h } = mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]);
    expect(Object.keys(h!).sort()).toEqual(["PreToolUse", "SubagentStart", "SubagentStop"]);
  });

  it("keeps BOTH entries when the same event is declared on both sides", () => {
    // The escalation the original report missed. An event-level spread
    // (`{...a.hooks, ...b.hooks}`) passes the previous test and fails this one.
    const { hooks: h } = mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]);
    expect(h!.SubagentStart).toHaveLength(2);
    expect(cmds(h, "SubagentStart")).toEqual([
      ".claude/hooks/agentboot-telemetry.sh", "/opt/org/audit.sh",
    ]);
  });

  it("orders lowest-precedence first, matching generateComplianceSettingsJson", () => {
    // Deterministic order matters: the artifact is hashed into the signed manifest.
    const { hooks: h } = mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]);
    expect(cmds({ SubagentStart: [h!.SubagentStart![0]] } as any, "SubagentStart"))
      .toEqual(["/opt/org/audit.sh"]);
  });

  it("dedupes an identical entry declared on both sides", () => {
    const dup = { SubagentStart: [{ matcher: "", hooks: [{ type: "command", command: "/same.sh" }] }] };
    const { hooks: h } = mergeHooks([{ hooks: dup }, { hooks: structuredClone(dup) }]);
    expect(h!.SubagentStart).toHaveLength(1);
  });

  it("dedupes regardless of key ORDER inside the entry object", () => {
    const a = { X: [{ matcher: "", hooks: [{ type: "command", command: "/s.sh" }] }] };
    const b = { X: [{ hooks: [{ command: "/s.sh", type: "command" }], matcher: "" }] };
    expect(mergeHooks([{ hooks: a }, { hooks: b }]).hooks!.X).toHaveLength(1);
  });

  it("NEGATIVE: no fragment declares hooks → undefined, so the key is omitted", () => {
    expect(mergeHooks([{ cleanupPeriodDays: 7 }, {}]).hooks).toBeUndefined();
  });

  it("a whole-`hooks` value that is not an object contributes nothing", () => {
    // `hooks: "nope"` is not a hook declaration in any reading — there is no
    // event named, so there is no control to lose. Skipping it is correct.
    const r = mergeHooks([{ hooks: "nope" }, { hooks: null }]);
    expect(r.hooks).toBeUndefined();
    expect(r.malformed).toEqual([]);
  });

  it("D1: a non-array EVENT value is reported as malformed, not silently emptied", () => {
    // This test previously asserted `toEqual({ X: [] })` — it PINNED the
    // fail-open as intended behaviour, under the title "…is ignored, not thrown
    // on". That is the most durable form of the defect: it survives review,
    // because challenging it means challenging a green test.
    //
    // `{ X: [] }` is not a conservative default on this channel. It is the
    // ABSENCE of a control, written into the file a developer cannot override,
    // for an org that asked for the opposite — and the build log then named `X`
    // in "hooks unioned across 1 event(s)", because the empty bucket created the
    // key. A false-positive Silence-Is-Not-Success report.
    const r = mergeHooks([{ hooks: { X: "nope" } }], ["00-org"]);
    expect(r.hooks).toBeUndefined();
    expect(r.malformed).toEqual([{ event: "X", source: "00-org", found: "string" }]);
  });

  it("D1: null and object event values are reported too, and named by type", () => {
    const r = mergeHooks([{ hooks: { A: null, B: { matcher: "" } } }], ["10-group"]);
    expect(r.malformed.map((m) => `${m.event}:${m.found}`).sort()).toEqual(["A:null", "B:object"]);
  });

  it("D1: a malformed event does NOT suppress the well-formed ones alongside it", () => {
    // Fail-closed must not also be fail-everything: the operator needs to see
    // that the rest merged, or the diagnostic looks like a total outage.
    const r = mergeHooks([{ hooks: { Good: [{ matcher: "", hooks: [] }], Bad: 7 } }], ["00-org"]);
    expect(Object.keys(r.hooks ?? {})).toEqual(["Good"]);
    expect(r.malformed.map((m) => m.event)).toEqual(["Bad"]);
  });

  it("D1 NEGATIVE: a well-formed merge reports NO malformed events", () => {
    expect(mergeHooks([{ hooks: guardrailHooks }, { hooks: orgHooks }]).malformed).toEqual([]);
    expect(mergeManagedFragments([{ hooks: orgHooks }], ["00-org"]).malformedHooks).toEqual([]);
  });

  it("D1: mergeManagedFragments surfaces it, with the fragment named", () => {
    const r = mergeManagedFragments(
      [{ hooks: { PreToolUse: "nope" } }, { hooks: orgHooks }],
      ["guardrails", "00-org"],
    );
    expect(r.malformedHooks).toEqual([{ event: "PreToolUse", source: "guardrails", found: "string" }]);
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

// ---------------------------------------------------------------------------
// D1 integration — the build must refuse to write the artifact
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const D1_ROOT = path.resolve(__dirname, "..");
const D1_CLI = path.join(D1_ROOT, "bin", "agentboot.js");

function d1Ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [D1_CLI, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 180_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("D1 integration — a malformed hook event fails the build", () => {
  it("D1-I1: exits non-zero, names the scope/event/fragment, writes no merged artifact", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-d1-"));
    const hub = path.join(base, "hub");
    const install = spawnSync("node",
      [D1_CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
      { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 });
    if (install.status !== 0) throw new Error(`scaffold failed: ${install.stdout}${install.stderr}`);

    const cfgPath = path.join(hub, "agentboot.config.json");
    const edit = (fn: (c: any) => void) => {
      const c = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      fn(c);
      fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2));
    };

    // Well-formed first: the same config shape must BUILD, or the assertion
    // below cannot distinguish the guard from an unrelated breakage.
    edit((c) => {
      c.managed = { ...(c.managed ?? {}), enabled: true };
      c.claude = { ...(c.claude ?? {}), hooks: { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "/opt/org/gate.sh" }] }] } };
    });
    expect(d1Ab(["build"], hub).status).toBe(0);

    edit((c) => { c.claude.hooks = { PreToolUse: "nope" }; });
    const bad = d1Ab(["build"], hub);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("hooks.PreToolUse is string, expected an array");
    expect(bad.out).toContain("scopes/core");
    // ...and it must NOT have claimed a union it did not perform.
    expect(bad.out).not.toMatch(/hooks unioned across \d+ event\(s\): .*PreToolUse/);
  }, 300_000);
});
