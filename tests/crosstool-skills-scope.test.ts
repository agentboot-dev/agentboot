/**
 * L45 — `.agents/skills/` was emitted at core scope only, behind a green tick
 * that printed either way.
 *
 * Two defects, one shape.
 *
 * 1. SCOPE. Both `generateCrossToolSkills` call sites passed the literal
 *    "core", while `generateAgentsMd` runs per scope node and
 *    `dist/skill/<scopePath>/` is populated per scope. So a group or team got
 *    its own AGENTS.md and its own compiled SKILL.md — and no
 *    `.agents/skills/` beside them. Every persona an org scoped to a group or
 *    team was simply absent from the cross-tool surface, at every scope below
 *    the root.
 *
 * 2. THE TICK. `log(green("  .agents/skills/ generated (cross-tool)"))` ran
 *    unconditionally, including on the early return where the function writes
 *    nothing at all. The operator was told the artifact existed by a line that
 *    had never looked. That is the "Exported 0 skill(s)" shape already fixed
 *    once on this branch, and the reason the scope bug survived: the build
 *    reported success for the whole emission on the strength of core alone.
 *
 * These tests assert on the emitted tree and on what the operator is TOLD,
 * because the second is what made the first invisible.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
/** A real compiled persona shipped with the package — used as node-scope content. */
const PERSONA_SRC = path.join(ROOT, "core", "personas", "code-reviewer");

let base = "";
beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l45-"));
});
afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

const BASE_TRAITS = ["critical-thinking", "structured-output", "source-citation", "confidence-signaling"];

/**
 * Build a hub whose scope nodes each carry a `code-reviewer` persona.
 * `nodePaths` are slash-separated, e.g. "platform" or "platform/web".
 */
function buildHub(
  name: string,
  nodes: Record<string, unknown>,
  nodePaths: string[],
  outputFormats: string[],
): { dir: string; out: string } {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });

  for (const nodePath of nodePaths) {
    const dest = path.join(dir, "nodes", ...nodePath.split("/"), "personas", "code-reviewer");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["persona.config.json", "SKILL.md"]) {
      fs.copyFileSync(path.join(PERSONA_SRC, f), path.join(dest, f));
    }
  }

  const cfgPath = path.join(dir, "agentboot.config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({
    org: "test",
    personas: { enabled: ["code-reviewer"], outputFormats },
    traits: { enabled: BASE_TRAITS },
    instructions: { enabled: [] },
    nodes,
  }));

  const out = execFileSync(TSX, [path.join(ROOT, "scripts", "compile.ts"), "--config", cfgPath], {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    timeout: 120_000,
  }).toString();
  return { dir, out };
}

const skillPath = (dir: string, scope: string) =>
  path.join(dir, "dist", "agents", ...scope.split("/"), ".agents", "skills", "code-reviewer", "SKILL.md");

describe("L45 — .agents/skills/ is emitted at every scope, not just core", () => {
  it("a GROUP scope node emits .agents/skills/", () => {
    const { dir } = buildHub("group", { platform: {} }, ["platform"], ["skill", "agents"]);

    // The precondition that made the omission a real gap rather than a
    // non-event: the compiled skill for this scope genuinely exists.
    expect(
      fs.existsSync(path.join(dir, "dist", "skill", "nodes", "platform", "code-reviewer", "SKILL.md")),
      "dist/skill/ should be populated for the group scope",
    ).toBe(true);
    // ...and the per-scope AGENTS.md it was supposed to sit beside.
    expect(
      fs.existsSync(path.join(dir, "dist", "agents", "nodes", "platform", "AGENTS.md")),
      "per-scope AGENTS.md should exist",
    ).toBe(true);

    expect(
      fs.existsSync(skillPath(dir, "nodes/platform")),
      "group scope should emit .agents/skills/code-reviewer/SKILL.md",
    ).toBe(true);
    // Core must keep working — the fix adds a scope, it does not move one.
    expect(fs.existsSync(skillPath(dir, "core"))).toBe(true);
  });

  it("a TEAM (depth-2) scope node emits .agents/skills/", () => {
    const { dir } = buildHub(
      "team",
      { platform: { children: { web: {} } } },
      ["platform/web"],
      ["skill", "agents"],
    );
    expect(
      fs.existsSync(skillPath(dir, "nodes/platform/web")),
      "team scope should emit .agents/skills/code-reviewer/SKILL.md",
    ).toBe(true);
  });

  it("the emitted scope skill is real content, not an empty file", () => {
    const { dir } = buildHub("content", { platform: {} }, ["platform"], ["skill", "agents"]);
    const body = fs.readFileSync(skillPath(dir, "nodes/platform"), "utf-8");
    expect(body.length).toBeGreaterThan(0);
    // Byte-identical to the compiled source it mirrors.
    const src = fs.readFileSync(
      path.join(dir, "dist", "skill", "nodes", "platform", "code-reviewer", "SKILL.md"), "utf-8");
    expect(body).toBe(src);
  });
});

describe("L45 — the success tick is conditional on files actually written", () => {
  it("reports a count when skills were written, at core AND at scope", () => {
    const { out } = buildHub("tick-ok", { platform: {} }, ["platform"], ["skill", "agents"]);
    expect(out).toMatch(/\.agents\/skills\/ generated \(cross-tool\) — \d+ skill\(s\)/);
    expect(out).toMatch(/\.agents\/skills\/ generated \(cross-tool\) \[nodes\/platform\] — \d+ skill\(s\)/);
  });

  it("does NOT claim success when nothing was written, and says why", () => {
    // Without "skill" in outputFormats there is no dist/skill/ to mirror, so
    // generateCrossToolSkills early-returns having written nothing. The old
    // code printed the green line here anyway.
    const { dir, out } = buildHub("tick-empty", { platform: {} }, ["platform"], ["agents"]);

    expect(fs.existsSync(skillPath(dir, "core"))).toBe(false);
    expect(fs.existsSync(skillPath(dir, "nodes/platform"))).toBe(false);

    expect(out, "must not claim an emission that did not happen")
      .not.toContain(".agents/skills/ generated (cross-tool)");
    // Silence is not success either — the operator is told, and told the cause.
    expect(out).toContain('.agents/skills/: nothing emitted — add "skill" to personas.outputFormats');
    expect(out).toContain('.agents/skills/ [nodes/platform]: nothing emitted');
  });
});
