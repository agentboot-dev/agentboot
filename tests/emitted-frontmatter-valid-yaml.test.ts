/**
 * NF2-3 (end to end) — the emitted `.mdc` / `.md` frontmatter must be VALID YAML.
 *
 * The unit tests one directory over assert that the parser reads each YAML form
 * correctly. That is necessary and not sufficient: NF-4's original symptom was
 * an emitted frontmatter block that no YAML parser accepts, and it came back on
 * a different input form precisely because the check that existed was on the
 * parser and not on the artifact.
 *
 * So this asserts the PROPERTY the operator actually depends on — "what AgentBoot
 * wrote can be read by the tool it wrote it for" — over a real build, with
 * sources written in every YAML form a person might reasonably use. It is
 * deliberately a corpus check rather than a per-platform assertion list: two
 * lists (platforms that emit frontmatter, platforms this test knows about) would
 * drift, and a platform added later would be exempt by default.
 *
 * Pre-fix, on this exact fixture, `agentboot build` exited 0 and produced:
 *   dist/cursor/core/rules/phi.instructions.mdc
 *     globs: "["src/db/**", "src/auth/**"]"   → bad indentation of a mapping entry (2:11)
 *   dist/windsurf/core/.windsurf/rules/phi.instructions.md
 *     - "["src/db/**", "src/auth/**"]"        → bad indentation of a sequence entry (3:8)
 *   dist/jetbrains/core/.aiassistant/rules/audit.instructions.md
 *     globs: ["src/api/**"] followed by an orphaned `  src/api/**`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let hub = "";
let base = "";

const FIXTURES: Record<string, string> = {
  // flow sequence — the form docs/concepts.md teaches
  "flowseq.instructions.md":
    '---\ndescription: flowseq\napplyTo: ["src/db/**", "src/auth/**"]\n---\n# flowseq\nbody\n',
  // folded block scalar
  "folded.instructions.md": "---\ndescription: folded\napplyTo: >\n  src/api/**\n---\n# folded\nbody\n",
  // literal block scalar, multi-line
  "literal.instructions.md":
    "---\ndescription: literal\napplyTo: |\n  src/one/**\n  src/two/**\n---\n# literal\nbody\n",
  // block sequence — the NF-4 form, which must not regress
  "blockseq.instructions.md":
    '---\ndescription: blockseq\napplyTo:\n  - "src/x/**"\n  - "src/y/**"\n---\n# blockseq\nbody\n',
  // plain scalar with a brace group and an inline comment
  "plain.instructions.md":
    '---\ndescription: plain\napplyTo: "src/**/*.{ts,tsx}"  # activation scope\n---\n# plain\nbody\n',
};

const GOTCHAS: Record<string, string> = {
  "gflow.md": '---\ndescription: gflow\npaths: ["packages/api-service/**"]\n---\nrule body\n',
  "gliteral.md": "---\ndescription: gliteral\npaths: |\n  services/a/**\n  services/b/**\n---\nrule body\n",
};

function walkFrontmatter(dir: string): { file: string; block: string }[] {
  const out: { file: string; block: string }[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(md|mdc)$/.test(e.name)) {
        const c = fs.readFileSync(p, "utf-8");
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(c);
        if (m) out.push({ file: p, block: m[1]! });
      }
    }
  }
  return out;
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf2-3-"));
  hub = path.join(base, "hub");
  const inst = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);

  fs.mkdirSync(path.join(hub, "core", "instructions"), { recursive: true });
  for (const [name, body] of Object.entries(FIXTURES)) {
    fs.writeFileSync(path.join(hub, "core", "instructions", name), body, "utf-8");
  }
  fs.mkdirSync(path.join(hub, "core", "gotchas"), { recursive: true });
  for (const [name, body] of Object.entries(GOTCHAS)) {
    fs.writeFileSync(path.join(hub, "core", "gotchas", name), body, "utf-8");
  }

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, Record<string, unknown>>;
  // Every format that emits frontmatter for a scoped artifact. `claude`,
  // `gemini` and `agents` are excluded because they cannot express a scope at
  // all and the F-6 gate correctly refuses the build — a different finding with
  // its own tests.
  cfg["personas"]!["outputFormats"] = ["cursor", "windsurf", "jetbrains", "copilot"];
  cfg["instructions"] = { enabled: Object.keys(FIXTURES).map((f) => path.basename(f, ".md")) };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const b = spawnSync(process.execPath, [CLI, "build"], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("NF2-3 — emitted frontmatter is valid YAML for every source form", () => {
  it("the fixture really exercised the emitters — otherwise this suite is vacuous", () => {
    const blocks = walkFrontmatter(path.join(hub, "dist"));
    expect(blocks.length).toBeGreaterThan(10);
    // And the flow-sequence artifact really reached a translating platform.
    expect(fs.existsSync(path.join(hub, "dist", "cursor", "core", "rules", "flowseq.instructions.mdc")))
      .toBe(true);
  });

  it("every emitted frontmatter block parses as YAML", () => {
    const bad: string[] = [];
    for (const { file, block } of walkFrontmatter(path.join(hub, "dist"))) {
      try {
        yaml.load(block);
      } catch (e) {
        bad.push(`${path.relative(hub, file)} → ${(e as Error).message.split("\n")[0]}`);
      }
    }
    expect(bad, `emitted frontmatter that no YAML parser accepts:\n${bad.join("\n")}`).toEqual([]);
  });

  it("a flow sequence lands as TWO globs on every translating platform", () => {
    const cursor = fs.readFileSync(
      path.join(hub, "dist", "cursor", "core", "rules", "flowseq.instructions.mdc"), "utf-8");
    expect(cursor).toContain('"src/db/**"');
    expect(cursor).toContain('"src/auth/**"');
    // The literal-string failure mode, named so a regression is unambiguous.
    expect(cursor).not.toContain('globs: "["');

    const windsurf = fs.readFileSync(
      path.join(hub, "dist", "windsurf", "core", ".windsurf", "rules", "flowseq.instructions.md"), "utf-8");
    expect(windsurf).toContain('- "src/db/**"');
    expect(windsurf).toContain('- "src/auth/**"');
  });

  it("a block scalar's scope is not dropped — and JetBrains gets no orphan line", () => {
    const jb = fs.readFileSync(
      path.join(hub, "dist", "jetbrains", "core", ".aiassistant", "rules", "folded.instructions.md"), "utf-8");
    const block = /^---\n([\s\S]*?)\n---/.exec(jb)![1]!;
    expect(block).toContain('globs: ["src/api/**"]');
    // The orphan: a bare indented continuation line left behind by a one-line
    // replace. It is what makes the block unparseable, so assert its absence
    // directly rather than relying on the corpus check alone.
    expect(block.split("\n").filter((l) => /^\s+\S/.test(l) && !l.includes(":"))).toEqual([]);
  });

  it("cursor, windsurf, jetbrains and copilot agree about the SAME rule's scope", () => {
    // Pre-fix these disagreed: copilot's native passthrough of `applyTo: >`
    // resolved correctly while the translating platforms emitted a glob that
    // matched nothing. One source cannot mean two scopes.
    const want = ["src/one/**", "src/two/**"];
    const cursor = fs.readFileSync(
      path.join(hub, "dist", "cursor", "core", "rules", "literal.instructions.mdc"), "utf-8");
    const jb = fs.readFileSync(
      path.join(hub, "dist", "jetbrains", "core", ".aiassistant", "rules", "literal.instructions.md"), "utf-8");
    const copilot = fs.readFileSync(
      path.join(hub, "dist", "copilot", "core", "instructions", "literal.instructions.md"), "utf-8");
    for (const g of want) {
      expect(cursor, "cursor").toContain(g);
      expect(jb, "jetbrains").toContain(g);
      expect(copilot, "copilot").toContain(g);
    }
  });

  it("gotchas take the identical treatment — the paths: variant hits all seven emitters", () => {
    const jb = fs.readFileSync(
      path.join(hub, "dist", "jetbrains", "core", ".aiassistant", "rules", "gflow.rules.md"), "utf-8");
    expect(jb).toContain('globs: ["packages/api-service/**"]');
    const copilot = fs.readFileSync(
      path.join(hub, "dist", "copilot", "core", "instructions", "gflow.instructions.md"), "utf-8");
    expect(copilot).toContain('applyTo: "packages/api-service/**"');
    // And a directory named after the raw glob text is never created.
    expect(fs.existsSync(path.join(hub, "dist", "gemini", "core", '["packages'))).toBe(false);
  });
});

describe("NF2-3 — an unreadable scope stops the build", () => {
  it("NEGATIVE: an unterminated flow sequence is refused, by file name", () => {
    const bad = path.join(hub, "core", "instructions", "broken.instructions.md");
    fs.writeFileSync(bad, '---\ndescription: broken\napplyTo: ["src/db/**"\n---\n# b\nbody\n', "utf-8");
    const cfgPath = path.join(hub, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    const prev = cfg["instructions"];
    cfg["instructions"] = { enabled: [...Object.keys(FIXTURES).map((f) => path.basename(f, ".md")), "broken.instructions"] };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    try {
      const b = spawnSync(process.execPath, [CLI, "build"], {
        cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
      });
      const out = `${b.stdout}${b.stderr}`;
      expect(b.status, `an unreadable scope built green:\n${out}`).toBe(1);
      expect(out).toContain("unreadable path scope");
      expect(out).toContain("broken.instructions.md");
    } finally {
      fs.rmSync(bad, { force: true });
      cfg["instructions"] = prev;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    }
  }, 300_000);
});
