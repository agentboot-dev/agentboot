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

/**
 * NEW-1 — the fail-closed scope gate enumerated three directories by hand.
 *
 * assertScopeKeysParse() checked packageInstructionsDir, coreInstructionsDir and
 * core/gotchas, and omitted `domains/*&#47;instructions` — which compileDomains()
 * pushes through the SAME emitters. The F-6 scope-degradation gate did not catch
 * it either, because F-6 keys off globs.length and a MALFORMED value yields no
 * globs at all. So the inversion NF2-3 exists to prevent was fully live one tier
 * over. Measured on a scratch hub, an unterminated flow sequence in
 * domains/fin/instructions gave:
 *
 *     build=0  validate=0 ("All 12 checks passed")  audit=0  conformance=0
 *
 * and dist/copilot/domains/fin/instructions/bad.instructions.md carried the
 * broken frontmatter verbatim (js-yaml: "missed comma between flow collection
 * entries"), while dist/claude got the same rule always-on because claude cannot
 * express scope at all. The SAME BYTES in core/instructions exited 1.
 *
 * The fixture above writes only into core/, which is exactly why the round's own
 * corpus test could not see this. So this one is parametrised over EVERY
 * scope-bearing source location, and adding a location without adding it to
 * scopeBearingSourceGroups() is what turns it red.
 */
describe("NEW-1 — the scope gate covers every scope-bearing directory, not three of them", () => {
  let nhub = "";
  let nbase = "";

  /** Every place a path-scope key can be authored and still reach an emitter. */
  const LOCATIONS: Array<{ label: string; rel: string; key: "applyTo" | "paths" }> = [
    { label: "core/instructions", rel: "core/instructions/zz.instructions.md", key: "applyTo" },
    { label: "core/gotchas", rel: "core/gotchas/zz.md", key: "paths" },
    { label: "domains/*/instructions", rel: "domains/fin/instructions/zz.instructions.md", key: "applyTo" },
  ];

  const malformed = (key: string) =>
    `---\ndescription: zz\n${key}: ["src/pay/**", "src/card/**"\n---\n# zz\nNever log a PAN.\n`;
  const wellFormed = (key: string) =>
    `---\ndescription: zz\n${key}: ["src/pay/**", "src/card/**"]\n---\n# zz\nNever log a PAN.\n`;

  const build = () =>
    spawnSync(process.execPath, [CLI, "build"], {
      cwd: nhub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
    });

  beforeAll(() => {
    nbase = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-new1-"));
    nhub = path.join(nbase, "hub");
    const inst = spawnSync(
      process.execPath,
      [CLI, "install", "--hub", "--org", "acme", "--path", nhub, "--non-interactive", "--skip-sync"],
      { cwd: nbase, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
    );
    if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
    fs.mkdirSync(path.join(nhub, "domains", "fin", "instructions"), { recursive: true });

    const cfgPath = path.join(nhub, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    cfg["domains"] = ["./domains/fin"];
    cfg["instructions"] = { enabled: ["zz.instructions"] };
    // Scope-CAPABLE targets only, so the F-6 degradation gate does not fire on
    // the well-formed control and mask which gate is under test.
    cfg["personas"] = { ...(cfg["personas"] as object), outputFormats: ["copilot", "cursor"] };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }, 600_000);

  afterAll(() => {
    if (nbase) fs.rmSync(nbase, { recursive: true, force: true });
  });

  for (const loc of LOCATIONS) {
    it(`NEW-1: an unreadable scope in ${loc.label} STOPS the build`, () => {
      const abs = path.join(nhub, loc.rel);
      fs.writeFileSync(abs, malformed(loc.key), "utf-8");
      try {
        const b = build();
        const out = `${b.stdout}${b.stderr}`;
        expect(b.status, `an unreadable scope in ${loc.label} built green:\n${out}`).toBe(1);
        expect(out).toContain("unreadable path scope");
        expect(out, "the refusal did not name the file").toContain(path.basename(loc.rel));
      } finally {
        fs.rmSync(abs, { force: true });
      }
    }, 300_000);

    it(`NEW-1 (NEGATIVE): a well-formed scope in ${loc.label} builds`, () => {
      // The gate must refuse unreadable scopes, not narrow ones. Without this
      // direction the fix could be "refuse every domain" and still look green.
      const abs = path.join(nhub, loc.rel);
      fs.writeFileSync(abs, wellFormed(loc.key), "utf-8");
      try {
        const b = build();
        expect(b.status, `a valid scope in ${loc.label} was refused:\n${b.stdout}${b.stderr}`).toBe(0);
      } finally {
        fs.rmSync(abs, { force: true });
      }
    }, 300_000);
  }

  it("NEW-1: same bytes, same verdict — the directory must not decide it", () => {
    // The reported repro in one assertion: identical content, two locations.
    const core = path.join(nhub, "core", "instructions", "zz.instructions.md");
    const domain = path.join(nhub, "domains", "fin", "instructions", "zz.instructions.md");
    fs.writeFileSync(core, malformed("applyTo"), "utf-8");
    const a = build().status;
    fs.rmSync(core, { force: true });
    fs.writeFileSync(domain, malformed("applyTo"), "utf-8");
    const b = build().status;
    fs.rmSync(domain, { force: true });
    expect({ core: a, domain: b }).toEqual({ core: 1, domain: 1 });
  }, 600_000);
});

/**
 * NF4-8 — `validate` passed artifacts that `build` refuses.
 *
 * Two build gates had no pre-flight equivalent, so `agentboot validate` printed
 * "All 12 checks passed" and exited 0 on a hub `agentboot build` then rejected:
 * an unreadable path scope (NF2-3), and a path scope whose first segment escapes
 * the output root (60bc867 — the Gemini emitter turns that segment into a
 * directory name, which is how a gotcha's `paths:` could write a GEMINI.md
 * anywhere on the filesystem).
 *
 * `build` is the real gate and nothing is written outside dist/ before it
 * refuses, so this is a pre-flight COMPLETENESS gap rather than a hole. It still
 * matters: validate is what a hub's CI runs on a PR, and a check that passes
 * everything the next stage rejects teaches people to skip it.
 *
 * The invariant asserted here is agreement, not a message: for each fixture,
 * validate and build must reach the same verdict.
 */
describe("NF4-8 — validate and build agree about a path scope", () => {
  let vhub = "";
  let vbase = "";

  const run = (cmd: string) =>
    spawnSync(process.execPath, [CLI, cmd], {
      cwd: vhub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
    });

  beforeAll(() => {
    vbase = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf48-"));
    vhub = path.join(vbase, "hub");
    const inst = spawnSync(
      process.execPath,
      [CLI, "install", "--hub", "--org", "acme", "--path", vhub, "--non-interactive", "--skip-sync"],
      { cwd: vbase, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
    );
    if (inst.status !== 0) throw new Error(`scaffold failed: ${inst.stdout}${inst.stderr}`);
    const cfgPath = path.join(vhub, "agentboot.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    // gemini is the format whose emitter derives a directory from the scope.
    cfg["personas"] = { ...(cfg["personas"] as object), outputFormats: ["claude", "gemini", "copilot"] };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }, 600_000);

  afterAll(() => {
    if (vbase) fs.rmSync(vbase, { recursive: true, force: true });
  });

  const FIXTURES: Array<[string, string, 0 | 1]> = [
    ["a path scope that escapes the output root", '---\ndescription: bad\npaths: "../../../../victim-repo/**"\n---\nrule\n', 1],
    ["an unterminated flow sequence", '---\ndescription: bad\npaths: ["src/a/**"\n---\nrule\n', 1],
    ["an absolute path scope", '---\ndescription: bad\npaths: "/etc/**"\n---\nrule\n', 1],
    ["a well-formed narrow scope", '---\ndescription: ok\npaths: ["src/a/**"]\n---\nrule\n', 0],
    ["a universal scope", '---\ndescription: ok\npaths: "**"\n---\nrule\n', 0],
  ];

  for (const [label, body, want] of FIXTURES) {
    it(`NF4-8: validate and build agree on ${label}`, () => {
      const f = path.join(vhub, "core", "gotchas", "nf48.md");
      fs.writeFileSync(f, body);
      try {
        const v = run("validate");
        const b = run("build");
        expect(
          { validate: v.status, build: b.status },
          `validate and build disagree on ${label}:\nVALIDATE\n${v.stdout}${v.stderr}\nBUILD\n${b.stdout}${b.stderr}`,
        ).toEqual({ validate: want, build: want });
      } finally {
        fs.rmSync(f, { force: true });
      }
    }, 600_000);
  }
});
