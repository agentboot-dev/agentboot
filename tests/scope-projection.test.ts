/**
 * Regression guards for F-6 — `applyTo` scope silently INVERTED to always-on.
 *
 * `compileInstructions` never parsed the source frontmatter. It stripped it, then
 * hardcoded `alwaysApply: true` for Cursor and the string literal
 * `trigger: always_on` for Windsurf. A rule authored as `applyTo: "src/api/**"`
 * was therefore delivered as *always on, every file* — not dropped, INVERTED —
 * with exit 0 and zero diagnostics. It happened by default to AgentBoot's own
 * shipped `security.instructions.md`, and was visible in this repo's committed
 * `dist/`.
 *
 * Inversion is strictly worse than omission: a warning is the right response to
 * "we dropped something" and the wrong response to "we shipped the opposite of
 * what you wrote."
 *
 * Structured like tests/capability-gate.test.ts: every rule asserts BOTH the
 * firing case and the silent case. The silent cases here are the load-bearing
 * ones — the translated tier must produce NO diagnostic at all, because a guard
 * that also fires on the fixed path is how a channel gets tuned out.
 *
 * See docs/research/capability-platform-matrix-2026-08-08.md §4, F-6.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  inspectScope, degradedFormats, scopeViolations, APPLY_TO_PROJECTION,
  type ScopedArtifact,
} from "../scripts/lib/scope-projection.js";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

const fm = (body: string) => `---\ndescription: x\n${body}---\n\n# body\n`;

// ---------------------------------------------------------------------------
// Unit — inspectScope
// ---------------------------------------------------------------------------

describe("inspectScope", () => {
  it("1: parses a narrowing glob", () => {
    expect(inspectScope(fm(`applyTo: "src/api/**"\n`)))
      .toMatchObject({ globs: ["src/api/**"], alwaysOn: false });
  });

  it("2: splits a comma-separated list", () => {
    expect(inspectScope(fm(`applyTo: "src/api/**, src/db/**"\n`)).globs)
      .toEqual(["src/api/**", "src/db/**"]);
  });

  it('3/4: "**" and "**/*" are the documented always-on sentinels', () => {
    // cli.ts `add instruction` scaffold: `"**" = always on, every file`.
    for (const g of ["**", "**/*", "*"]) {
      expect(inspectScope(fm(`applyTo: "${g}"\n`)), g)
        .toMatchObject({ globs: [], alwaysOn: true });
    }
  });

  it("5/6: a missing applyTo, and no frontmatter at all, are always-on", () => {
    expect(inspectScope(fm(""))).toMatchObject({ globs: [], alwaysOn: true });
    expect(inspectScope("# just a heading\n")).toMatchObject({ globs: [], alwaysOn: true });
  });

  it("7: trailing-empty entries are dropped", () => {
    expect(inspectScope(fm(`applyTo: "src/api/**, , "\n`)).globs).toEqual(["src/api/**"]);
  });

  it("8: single quotes are stripped like double quotes", () => {
    expect(inspectScope(fm(`applyTo: 'src/api/**'\n`)).globs).toEqual(["src/api/**"]);
  });

  it("9: reads the acknowledgement", () => {
    expect(inspectScope(fm(`applyTo: "src/**"\nscope-unsupported: acknowledged\n`))
      .acknowledgedUnscoped).toBe(true);
    expect(inspectScope(fm(`applyTo: "src/**"\n`)).acknowledgedUnscoped).toBe(false);
  });

  it("10 (NEGATIVE): the acknowledgement in the BODY is not a declaration", () => {
    const content = `---\ndescription: x\napplyTo: "src/**"\n---\n\nscope-unsupported: acknowledged\n`;
    expect(inspectScope(content).acknowledgedUnscoped).toBe(false);
  });

  it("a mixed universal+narrow list is still narrowing", () => {
    expect(inspectScope(fm(`applyTo: "**, src/api/**"\n`)).alwaysOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit — degradedFormats (fail-closed)
// ---------------------------------------------------------------------------

describe("degradedFormats", () => {
  it("11 (NEGATIVE): the translated + native tier degrades nothing", () => {
    // The guard must be SILENT here. This is the whole point of the fix.
    expect(degradedFormats(["cursor", "windsurf", "jetbrains", "copilot"])).toEqual([]);
  });

  it("12: the unsupported tier is reported in full", () => {
    expect(degradedFormats(["claude", "skill", "agents"])).toEqual(["claude", "skill", "agents"]);
  });

  it("13: FAILS CLOSED on an unknown platform", () => {
    // A classifier may ignore what it has no data for; a safety gate may not.
    // The opposite default is exactly how the HARD gate failed open on `plugin`.
    expect(degradedFormats(["not-a-platform"])).toEqual(["not-a-platform"]);
  });

  it("14: one unsupported target is enough", () => {
    expect(degradedFormats(["cursor", "claude"])).toEqual(["claude"]);
  });

  it("every projection row names a real mechanism", () => {
    for (const [fmt, row] of Object.entries(APPLY_TO_PROJECTION)) {
      expect(["native", "translated", "unsupported"], fmt).toContain(row.support);
      expect(row.detail.length, fmt).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit — scopeViolations
// ---------------------------------------------------------------------------

const art = (over: Partial<ScopedArtifact> = {}): ScopedArtifact => ({
  name: "a", file: "/x/a.md", scopePath: "src/api/**",
  globs: ["src/api/**"], acknowledgedUnscoped: false, ...over,
});

describe("scopeViolations", () => {
  it("15: a scoped artifact against an unsupported target fires", () => {
    const v = scopeViolations([art()], ["claude"]);
    expect(v).toHaveLength(1);
    expect(v[0]!.formats).toEqual(["claude"]);
  });

  it("16 (NEGATIVE): the translated tier is silent", () => {
    expect(scopeViolations([art()], ["cursor", "copilot"])).toEqual([]);
  });

  it("17 (NEGATIVE): an always-on artifact never fires — every default hub is this shape", () => {
    // The highest-value negative. If this fires the gate is unusable.
    expect(scopeViolations([art({ globs: [], scopePath: "**" })], ["claude", "agents"])).toEqual([]);
  });

  it("18 (NEGATIVE): an acknowledged artifact does not fire", () => {
    expect(scopeViolations([art({ acknowledgedUnscoped: true })], ["claude"])).toEqual([]);
  });

  it("19 (NEGATIVE): no artifacts at all", () => {
    expect(scopeViolations([], ["claude", "agents"])).toEqual([]);
  });

  it("20: every offending artifact is named — the operator with twenty needs twenty", () => {
    const v = scopeViolations(
      [art({ name: "a" }), art({ name: "b" }), art({ name: "c", acknowledgedUnscoped: true })],
      ["claude"],
    );
    expect(v.map((x) => x.artifact.name)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Emission — the actual defect
// ---------------------------------------------------------------------------

function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scaffoldHub(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-scope-"));
  const hub = path.join(base, "hub");
  const r = spawnSync("node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 180_000 });
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);
  return hub;
}

/** Hub with one narrow instruction and one universal one. */
function hubWithScopedInstruction(formats: string[], acknowledged = false): string {
  const hub = scaffoldHub();
  const dir = path.join(hub, "core", "instructions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scoped.instructions.md"),
    `---\ndescription: API layer rules\napplyTo: "src/api/**"\n` +
    (acknowledged ? "scope-unsupported: acknowledged\n" : "") +
    `---\n\n# API only\nNever widen a public API without an ADR.\n`);
  fs.writeFileSync(path.join(dir, "global.instructions.md"),
    `---\ndescription: Everywhere\napplyTo: "**"\n---\n\n# Global\nAlways true.\n`);
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  c.personas.outputFormats = formats;
  c.instructions = { enabled: ["scoped.instructions", "global.instructions"] };
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
  return hub;
}

const read = (hub: string, ...seg: string[]) =>
  fs.readFileSync(path.join(hub, "dist", ...seg), "utf-8");

describe("emission — the translated tier receives the operator's exact scope", () => {
  const TRANSLATED = ["cursor", "windsurf", "jetbrains", "copilot"];

  it("21-27: cursor/windsurf/jetbrains/copilot all carry src/api/**, and always-on stays always-on", () => {
    const hub = hubWithScopedInstruction(TRANSLATED);
    expect(ab(["build"], hub).status).toBe(0);

    // 21 — Cursor. `alwaysApply: true` was hardcoded here.
    const cScoped = read(hub, "cursor", "core", "rules", "scoped.instructions.mdc");
    expect(cScoped).toContain("src/api/**");
    expect(cScoped).toContain("alwaysApply: false");
    expect(cScoped).not.toMatch(/^alwaysApply:\s*true/m);
    // 22 — the mutual-exclusivity invariant: globs XOR alwaysApply.
    const cGlobal = read(hub, "cursor", "core", "rules", "global.instructions.mdc");
    expect(cGlobal).toMatch(/^alwaysApply:\s*true/m);
    expect(cGlobal).not.toContain("globs:");

    // 23/24 — Windsurf. `trigger: always_on` was a string literal.
    const wScoped = read(hub, "windsurf", "core", ".windsurf", "rules", "scoped.instructions.md");
    expect(wScoped).toContain("trigger: glob");
    expect(wScoped).toContain(`- "src/api/**"`);
    expect(wScoped).not.toContain("trigger: always_on");
    expect(read(hub, "windsurf", "core", ".windsurf", "rules", "global.instructions.md"))
      .toContain("trigger: always_on");

    // 25 — JetBrains reads `globs:`, not `applyTo:`; the identity stamp survives.
    const jScoped = read(hub, "jetbrains", "core", ".aiassistant", "rules", "scoped.instructions.md");
    expect(jScoped).toContain(`globs: ["src/api/**"]`);
    expect(jScoped).not.toContain("applyTo:");
    expect(jScoped).toContain("description: API layer rules");
    // The always-on one loses the inert applyTo line entirely (no globs ⇒ always-on).
    expect(read(hub, "jetbrains", "core", ".aiassistant", "rules", "global.instructions.md"))
      .not.toContain("applyTo:");

    // 26 — Copilot: native passthrough, unchanged.
    expect(read(hub, "copilot", "core", "instructions", "scoped.instructions.md"))
      .toContain(`applyTo: "src/api/**"`);
  }, 300_000);

  it("27: one scoping projection, not two — instruction and gotcha agree for the same globs", () => {
    const hub = scaffoldHub();
    fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
    fs.mkdirSync(path.join(hub, "core", "gotchas"), { recursive: true });
    fs.writeFileSync(path.join(hub, "core", "instructions", "x.instructions.md"),
      `---\ndescription: "x"\napplyTo: "src/api/**"\n---\n\nbody\n`);
    fs.writeFileSync(path.join(hub, "core", "gotchas", "x.md"),
      `---\ndescription: "x"\npaths: "src/api/**"\n---\n\nbody\n`);
    const p = path.join(hub, "agentboot.config.json");
    const c = JSON.parse(fs.readFileSync(p, "utf-8"));
    c.personas.outputFormats = ["cursor"];
    c.instructions = { enabled: ["x.instructions"] };
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
    expect(ab(["build"], hub).status).toBe(0);

    const fmOf = (t: string) => t.match(/^---\n[\s\S]*?\n---/)![0]
      .split("\n").filter((l) => l.startsWith("globs") || l.startsWith("alwaysApply")).join("\n");
    expect(fmOf(read(hub, "cursor", "core", "rules", "x.instructions.mdc")))
      .toBe(fmOf(read(hub, "cursor", "core", "rules", "x.mdc")));
  }, 300_000);

  it("35 (NEGATIVE): the translated tier produces NO diagnostic at the CLI boundary", () => {
    // A guard that also fires on the fixed path is how a channel gets tuned out.
    const hub = hubWithScopedInstruction(TRANSLATED);
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(build.out).not.toContain("Path scoping cannot be expressed");
    expect(build.out).not.toContain("delivered always-on");
  }, 300_000);
});

describe("emission — the unsupported tier degrades honestly", () => {
  it("28-32: an acknowledged artifact builds, carries the Scope preamble, and always-on gets none", () => {
    const hub = hubWithScopedInstruction(["claude", "agents", "gemini"], true);
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);                              // 28
    expect(build.out).toContain("delivered always-on");        // still reported, never silent

    const claudeScoped = read(hub, "claude", "core", "rules", "scoped.instructions.md");
    expect(claudeScoped).toContain("**Scope — `src/api/**`");  // 29
    // Frontmatter-first contract preserved: the file still opens with ---.
    expect(claudeScoped.startsWith("---\n")).toBe(true);

    expect(read(hub, "agents", "AGENTS.md")).toContain("**Scope — `src/api/**`");   // 30
    expect(read(hub, "gemini", "core", "GEMINI.md")).toContain("**Scope — `src/api/**`"); // 31

    // 32 — the always-on artifact gets NO preamble anywhere.
    expect(read(hub, "claude", "core", "rules", "global.instructions.md"))
      .not.toContain("**Scope —");
  }, 300_000);

  it("33: an UNacknowledged scoped artifact fails the build and names both sides", () => {
    const hub = hubWithScopedInstruction(["claude"], false);
    const build = ab(["build"], hub);
    expect(build.status).toBe(1);
    expect(build.out).toContain("scoped.instructions");
    expect(build.out).toContain("claude");
    expect(build.out).toContain("scope-unsupported: acknowledged");
  }, 300_000);

  it("34: acknowledging it turns the failure into a single warning line", () => {
    const hub = hubWithScopedInstruction(["claude"], true);
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(build.out).toContain("⚠");
    expect(build.out).toContain("delivered always-on");
    expect(build.out).not.toContain("Build failed");
  }, 300_000);

  it("36 (NEGATIVE): a stock install builds clean — the default path is not broken", () => {
    // Guards §2.6: the shipped narrow instructions carry the acknowledgement, so
    // an operator meets the error only on THEIR OWN narrow rule.
    const hub = scaffoldHub();
    const build = ab(["build"], hub);
    expect(build.status).toBe(0);
    expect(build.out).not.toContain("Build failed");
  }, 300_000);

  it("the shipped narrow instructions are pre-acknowledged", () => {
    // If this fails, every default install and this repo's own build break.
    for (const f of ["security.instructions.md", "agentboot-authoring.instructions.md"]) {
      const src = fs.readFileSync(path.join(ROOT, "core", "instructions", f), "utf-8");
      const s = inspectScope(src);
      expect(s.globs.length, f).toBeGreaterThan(0);
      expect(s.acknowledgedUnscoped, f).toBe(true);
    }
    // baseline is applyTo: "**" — universal, so no acknowledgement is needed.
    const baseline = inspectScope(
      fs.readFileSync(path.join(ROOT, "core", "instructions", "baseline.instructions.md"), "utf-8"));
    expect(baseline.alwaysOn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C1 — the same defect, reachable through a LINE ENDING
// ---------------------------------------------------------------------------

/**
 * `frontmatterBlock` was re-implemented, strictly, in TWO places
 * (scope-projection.ts and guardrail-scan.ts), neither normalizing CRLF or a
 * BOM — while the tolerant parser sat unused ten lines away in frontmatter.ts.
 *
 * A file checked out on Windows (git autocrlf) therefore matched nothing,
 * `inspectScope` returned `{globs: [], alwaysOn: true}`, and this gate — the
 * gate that exists BECAUSE `applyTo` was being inverted — concluded there was no
 * scope to lose and let it through. F-6 verbatim, on every Windows checkout,
 * behind a green build.
 */

import { frontmatterBlock, scopePreamble } from "../scripts/lib/scope-projection.js";
import { inspectArtifact } from "../scripts/lib/guardrail-scan.js";

const C1_LF = `---\ndescription: x\napplyTo: "src/api/**"\n---\n\n# body\n`;
const C1_CRLF = C1_LF.replace(/\n/g, "\r\n");
const C1_BOM = `﻿${C1_LF}`;
const C1_BOM_CRLF = `﻿${C1_CRLF}`;
const C1_CR = C1_LF.replace(/\n/g, "\r");

describe("C1 — frontmatter detection must survive a line ending", () => {
  it("C1-1: LF is the control case", () => {
    expect(frontmatterBlock(C1_LF)).toContain("applyTo");
    expect(inspectScope(C1_LF)).toMatchObject({ globs: ["src/api/**"], alwaysOn: false });
  });

  it.each([
    ["CRLF", C1_CRLF],
    ["BOM", C1_BOM],
    ["BOM+CRLF", C1_BOM_CRLF],
    ["lone CR", C1_CR],
  ])("C1-2 (%s): the scope is READ, not silently discarded", (_label, content) => {
    // The pre-C1 result was exactly `{globs: [], alwaysOn: true}` — which the
    // gate reads as "nothing to lose".
    expect(inspectScope(content).alwaysOn).toBe(false);
    expect(inspectScope(content).globs).toEqual(["src/api/**"]);
  });

  it("C1-3: the gate FIRES on a CRLF artifact against an unsupported target", () => {
    const globs = inspectScope(C1_CRLF).globs;
    expect(globs.length).toBeGreaterThan(0); // precondition, not decoration
    const v = scopeViolations([art({ globs })], ["claude"]);
    expect(v).toHaveLength(1);
    expect(v[0]!.formats).toEqual(["claude"]);
  });

  it("C1-4 (NEGATIVE): a genuinely unscoped CRLF artifact still does not fire", () => {
    expect(inspectScope(`---\r\ndescription: x\r\n---\r\n\r\n# body\r\n`))
      .toMatchObject({ globs: [], alwaysOn: true });
    expect(inspectScope(`---\r\napplyTo: "**"\r\n---\r\n`).alwaysOn).toBe(true);
  });

  it("C1-5: the acknowledgement escape hatch survives CRLF too", () => {
    // If the hatch were unreadable on Windows the gate would be unresolvable
    // there, and an error the operator cannot silence is a gate that gets removed.
    expect(inspectScope(`---\r\napplyTo: "src/**"\r\nscope-unsupported: acknowledged\r\n---\r\n`)
      .acknowledgedUnscoped).toBe(true);
  });

  it("C1-6: the HARD-guardrail twin had the identical defect and is fixed with it", () => {
    const hardLF = `---\ndescription: x\nguardrail: hard\n---\n\n# body\n`;
    const hardCRLF = hardLF.replace(/\n/g, "\r\n");
    expect(inspectArtifact(hardLF).hard).toBe(true);
    expect(inspectArtifact(hardCRLF).hard).toBe(true);
    expect(inspectArtifact(`﻿${hardCRLF}`).hard).toBe(true);
    // NEGATIVE: still not fooled by prose in the body.
    expect(inspectArtifact(`---\r\ndescription: x\r\n---\r\n\r\nguardrail: hard\r\n`).hard).toBe(false);
  });

  it("C1-7 (NEGATIVE): no frontmatter at all is still no frontmatter", () => {
    expect(frontmatterBlock("# just a heading\n")).toBeNull();
    expect(frontmatterBlock("﻿# just a heading\r\n")).toBeNull();
  });

  it("C1-8: scopePreamble names the globs it stands in for", () => {
    expect(scopePreamble(["src/api/**", "lib/**"])).toContain("src/api/**, lib/**");
  });
});

// ---------------------------------------------------------------------------
// C2 — a trailing YAML comment was parsed as part of the glob
// ---------------------------------------------------------------------------

describe("C2 — inline YAML comments in applyTo", () => {
  it("C2-1: AgentBoot's OWN documented scaffold parses as universal", () => {
    // core/instructions/agentboot-authoring.instructions.md and the
    // `agentboot add instruction` template both write exactly this line. Before
    // the fix it parsed to the single glob
    // `** # glob pattern for activation scope` — not universal, so the gate
    // fired on the default install of our own documented example.
    const s = inspectScope(fm(`applyTo: "**"  # glob pattern for activation scope\n`));
    expect(s.alwaysOn).toBe(true);
    expect(s.globs).toEqual([]);
  });

  it("C2-2: a comment after an UNQUOTED narrowing glob is stripped", () => {
    expect(inspectScope(fm(`applyTo: src/api/**  # only the API\n`)).globs)
      .toEqual(["src/api/**"]);
  });

  it("C2-3: a comment after a quoted list is stripped, the list survives", () => {
    expect(inspectScope(fm(`applyTo: "src/api/**, src/db/**"  # two trees\n`)).globs)
      .toEqual(["src/api/**", "src/db/**"]);
  });

  it("C2-4 (NEGATIVE): a `#` with no leading space is a legal glob character", () => {
    // YAML only starts an inline comment at whitespace-then-hash. Stripping
    // every `#` would corrupt a legitimate path.
    expect(inspectScope(fm(`applyTo: "src/#tag/**"\n`)).globs).toEqual(["src/#tag/**"]);
  });

  it("C2-5 (NEGATIVE): a line with no comment is untouched", () => {
    expect(inspectScope(fm(`applyTo: "src/api/**"\n`)).globs).toEqual(["src/api/**"]);
  });

  it("C2-6: an EMPTY frontmatter block is a block, not a missing one", () => {
    // `!fm` treated "" as absent. Same observable result here, but the
    // conflation is the kind that becomes a defect the moment a second field is
    // read from the block.
    expect(inspectScope(`---\n---\n\n# body\n`)).toMatchObject({ globs: [], alwaysOn: true });
  });
});

// ---------------------------------------------------------------------------
// C3 — `.split(",")` split INSIDE brace groups
// ---------------------------------------------------------------------------

describe("C3 — brace and bracket groups in an applyTo list", () => {
  it("C3-1: a brace group survives as ONE glob", () => {
    // `.split(",")` produced ["src/**/*.{ts", "tsx}"] — two globs that match no
    // file, so the rule reached nothing. Exit 0, no diagnostic.
    expect(inspectScope(fm(`applyTo: "src/**/*.{ts,tsx}"\n`)).globs)
      .toEqual(["src/**/*.{ts,tsx}"]);
  });

  it("C3-2: commas BETWEEN entries still split", () => {
    expect(inspectScope(fm(`applyTo: "src/**/*.{ts,tsx}, docs/**/*.md"\n`)).globs)
      .toEqual(["src/**/*.{ts,tsx}", "docs/**/*.md"]);
  });

  it("C3-3: nested braces are tracked, not merely detected", () => {
    expect(inspectScope(fm(`applyTo: "src/{a,{b,c}}/**"\n`)).globs)
      .toEqual(["src/{a,{b,c}}/**"]);
  });

  it("C3-4: a bracket character class is not split either", () => {
    expect(inspectScope(fm(`applyTo: "src/*.[ch]"\n`)).globs).toEqual(["src/*.[ch]"]);
  });

  it("C3-5 (NEGATIVE): the plain multi-glob case is unchanged", () => {
    // The regression risk of a hand-rolled splitter is that it stops splitting.
    expect(inspectScope(fm(`applyTo: "src/api/**, src/db/**, lib/**"\n`)).globs)
      .toEqual(["src/api/**", "src/db/**", "lib/**"]);
  });

  it("C3-6 (NEGATIVE): an unbalanced brace does not swallow the rest of the list", () => {
    // Malformed input should degrade to something, not to one giant glob that
    // silently matches nothing.
    expect(inspectScope(fm(`applyTo: "src/{a/**, docs/**"\n`)).globs.length).toBeGreaterThan(0);
  });

  it("C3-7: a brace glob combined with a trailing comment (C2 + C3 together)", () => {
    expect(inspectScope(fm(`applyTo: "src/**/*.{ts,tsx}"  # code only\n`)).globs)
      .toEqual(["src/**/*.{ts,tsx}"]);
  });
});
