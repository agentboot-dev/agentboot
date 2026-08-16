/**
 * L51 — no emitted artifact ships raw YAML frontmatter as instruction body text.
 *
 * THE DEFECT. `agentboot build` exited 0 and `agentboot validate` reported every
 * check passed while, across the real corpus, TEN emitted artifacts on TWO
 * platforms carried a second frontmatter block in the middle of the prose:
 *
 *   dist/cursor/core/rules/<persona>.mdc            (all five personas)
 *     ---                       ← the generated Cursor frontmatter
 *     description: "…"
 *     alwaysApply: true
 *     ---
 *     ---                       ← the persona SKILL.md's OWN frontmatter,
 *     name: code-reviewer         which Cursor never parses, so the agent
 *     description: …              reads `name:`/`id:`/`hash:` as instructions
 *     id: 01KZ…
 *     ---
 *   dist/copilot/core/<persona>/copilot-instructions.md   (all five personas)
 *
 * `buildCursorRule` and `buildCopilotOutput` stripped HTML comments from the
 * composed body and nothing else. Two of buildCursorRule's three callers happened
 * to strip frontmatter before calling; the persona caller did not, and Copilot's
 * emitter had no strip on any path.
 *
 * WHY THIS IS AN INVARIANT AND NOT AN ASSERTION. The guard already written for
 * exactly this class — "V3-1: a CRLF-authored instruction does not ship its raw
 * frontmatter as body text" (tests/scope-projection.test.ts) — was GREEN the
 * whole time, because it asserts over one synthetic instruction fixture in a
 * scaffolded hub. Personas, traits and gotchas in the real corpus were outside
 * its reach. A per-artifact assertion can only ever cover the artifacts someone
 * remembered to name; this file derives its expectation from whatever the build
 * actually emitted, so an emitter added tomorrow is covered on the day it ships
 * rather than on the day someone notices.
 *
 * THERE IS DELIBERATELY NO ALLOWLIST. An exemption list of the ten offenders
 * would have blessed the defect instead of closing it. The only exemption is
 * STRUCTURAL and applies corpus-wide: a frontmatter-shaped block inside a fenced
 * code block is a documented EXAMPLE, not instruction text — `agentboot-authoring
 * .instructions.md` teaches the trait/gotcha frontmatter format by showing it in
 * a ```yaml fence, and stripping that would delete the documentation. Because
 * that exemption is the one way the check could be blinded, two things defend it:
 * fences must balance in every emitted file (an unclosed fence would hide the
 * rest of the file from the scan), and the fenced-example branch must actually
 * fire somewhere in the corpus (a dead branch that exempts nothing today could
 * exempt everything tomorrow without anyone noticing).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let base = "";
let hub = "";
let dist = "";

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

export interface FoundBlock {
  /** 0-based line index where the `---` opener sits. */
  line: number;
  /** True when the block sits inside a fenced code block (a documented example). */
  fenced: boolean;
  /** The block text, for the failure message. */
  text: string;
}

/** A YAML mapping key line — `name:`, `applyTo:`, `scope-unsupported:`. */
const KEY_LINE = /^[A-Za-z_][A-Za-z0-9_.-]*\s*:(\s|$)/;
/** A line that may appear inside a mapping block without being a key. */
const CONTINUATION = /^(\s+\S|- |#)/;

/**
 * Mark the lines of a document that sit inside a CLOSED fenced code block.
 *
 * An UNCLOSED fence marks nothing. That is deliberate and it is the whole
 * blind-spot defence: the fenced exemption is the one way this scan could be
 * blinded, and an emitter that truncates a document mid-fence would otherwise
 * hide every leak after the cut behind a fence that never ends. Refusing to
 * extend an unterminated fence means the worst an unclosed fence can do is make
 * the scan stricter, never blinder. The trait-tier truncation in AGENTS.md used
 * to do exactly this (Q66, fixed in `closeTruncatedFence`); the detector still
 * must not depend on that staying fixed, which is why the rule stands.
 */
function fencedLines(lines: string[]): boolean[] {
  const inFence = new Array<boolean>(lines.length).fill(false);
  let openIdx = -1;
  let fenceChar = "";
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const fence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (!fence) continue;
    const ch = fence[1]![0]!;
    const len = fence[1]!.length;
    if (openIdx === -1) {
      openIdx = i;
      fenceChar = ch;
      fenceLen = len;
    } else if (ch === fenceChar && len >= fenceLen && trimmed === ch.repeat(len)) {
      for (let k = openIdx; k <= i; k++) inFence[k] = true;
      openIdx = -1;
    }
  }
  return inFence;
}

/** True when the document ends with a fence that was never closed. */
export function unbalancedFences(content: string): boolean {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const inFence = fencedLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (/^(`{3,}|~{3,})/.test(lines[i]!.trim()) && !inFence[i]) return true;
  }
  return false;
}

/**
 * Find every frontmatter-SHAPED block in a markdown document, noting whether
 * each sits inside a fenced code block.
 *
 * "Frontmatter-shaped" is `---`, at least one `key:` line, more mapping-ish
 * lines, `---`. A bare `---` horizontal rule is not a block (no key line), which
 * matters because several emitters use one as a separator.
 */
export function findFrontmatterBlocks(content: string): FoundBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const inFence = fencedLines(lines);
  const out: FoundBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== "---") continue;

    // Walk forward looking for the closing `---` of a mapping-shaped block.
    let j = i + 1;
    let keys = 0;
    let ok = true;
    for (; j < lines.length && j - i <= 80; j++) {
      const l = lines[j]!;
      if (l.trim() === "---") break;
      if (l.trim() === "") continue;
      if (KEY_LINE.test(l)) {
        keys++;
        continue;
      }
      if (CONTINUATION.test(l)) continue;
      ok = false;
      break;
    }
    if (!ok || keys === 0 || j >= lines.length || lines[j]!.trim() !== "---") continue;

    out.push({ line: i, fenced: inFence[i]!, text: lines.slice(i, j + 1).join("\n") });
    i = j; // do not re-enter the block we just consumed
  }
  return out;
}

function walkEmitted(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(md|mdc)$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The real build
// ---------------------------------------------------------------------------

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l51-"));
  hub = path.join(base, "hub");
  fs.mkdirSync(hub, { recursive: true });

  // A faithful replica of THIS hub — the shipped config, the shipped core/ and
  // domains/ corpus — built into a temp dist so the check runs over the real
  // artifact set without touching the repo's own dist/. A scaffolded hub is not
  // a substitute: the defect lived in the personas and gotchas that only the
  // real corpus contains, which is precisely why V3-1's scaffolded fixture could
  // not see it.
  fs.copyFileSync(path.join(ROOT, "agentboot.config.json"), path.join(hub, "agentboot.config.json"));
  for (const d of ["core", "domains"]) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(hub, d), { recursive: true });
  }

  const b = spawnSync(process.execPath, [CLI, "build", "--config", path.join(hub, "agentboot.config.json")], {
    cwd: hub,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
  dist = path.join(hub, "dist");
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe("L51 — the detector can fail (it is an instrument, so it gets tested)", () => {
  it("flags a leaked block, and only a leaked block", () => {
    const leaked = "# Title\n\nsome prose\n\n---\nname: code-reviewer\nid: 01K\n---\n\nmore\n";
    const found = findFrontmatterBlocks(leaked).filter((b) => b.line !== 0 && !b.fenced);
    expect(found.map((b) => b.line)).toEqual([4]);
  });

  it("does NOT flag legitimate frontmatter at offset 0", () => {
    const ok = "---\ndescription: x\nalwaysApply: true\n---\n\n# Title\nbody\n";
    expect(findFrontmatterBlocks(ok).filter((b) => b.line !== 0 && !b.fenced)).toEqual([]);
  });

  it("does NOT flag a documented example inside a fence", () => {
    const doc = "# Authoring\n\n```yaml\n---\ntype: trait\nweight: HIGH\n---\n```\n\ndone\n";
    const all = findFrontmatterBlocks(doc);
    expect(all.length, "the fenced example was not seen at all").toBe(1);
    expect(all[0]!.fenced, "a fenced example was misread as body text").toBe(true);
    expect(all.filter((b) => b.line !== 0 && !b.fenced)).toEqual([]);
  });

  it("does NOT mistake a `---` horizontal rule for frontmatter", () => {
    const hr = "# Title\n\nintro\n\n---\n\n## Section\ntext\n";
    expect(findFrontmatterBlocks(hr)).toEqual([]);
  });

  it("an unclosed fence does not hide a leak behind it", () => {
    // The blind spot, closed in the detector rather than by an assertion about
    // someone else's emitter: an unterminated fence exempts nothing.
    const doc = "# T\n\n```json\n{ \"a\": 1 }\n\n*(truncated)*\n\n---\nname: leaked\nid: 01K\n---\n\ntail\n";
    expect(unbalancedFences(doc), "the unclosed fence went unnoticed").toBe(true);
    const leaks = findFrontmatterBlocks(doc).filter((b) => b.line !== 0 && !b.fenced);
    expect(leaks.length, "an unclosed fence swallowed a leak").toBe(1);
    // …while a properly closed fence still exempts its example.
    expect(unbalancedFences("a\n```yaml\nx\n```\nb\n")).toBe(false);
  });
});

describe("L51 — the corpus invariant, derived from the emitted tree", () => {
  it("the build really emitted a corpus — otherwise everything below is vacuous", () => {
    const files = walkEmitted(dist);
    expect(files.length, "suspiciously few emitted artifacts").toBeGreaterThan(80);
    // The two platforms the defect shipped on, named so a build that silently
    // stops emitting them cannot turn this file green by emitting nothing.
    const rel = files.map((f) => path.relative(dist, f).split(path.sep).join("/"));
    expect(rel).toContain("cursor/core/rules/code-reviewer.mdc");
    expect(rel).toContain("copilot/core/code-reviewer/copilot-instructions.md");
    // And frontmatter is being emitted at all.
    const withFm = files.filter((f) =>
      findFrontmatterBlocks(fs.readFileSync(f, "utf-8")).some((b) => b.line === 0),
    );
    expect(withFm.length, "no emitted artifact carries frontmatter at offset 0").toBeGreaterThan(20);
  });

  it("the fenced-example exemption is live, not a dead branch", () => {
    // If nothing in the corpus is exempted, the exemption is untested here and
    // could silently widen. Today the authoring instruction's ```yaml examples
    // are what land in this bucket.
    const fenced = walkEmitted(dist).filter((f) =>
      findFrontmatterBlocks(fs.readFileSync(f, "utf-8")).some((b) => b.fenced),
    );
    expect(fenced.length, "no fenced frontmatter example found — the exemption is untested").toBeGreaterThan(0);
  });

  it("Q66 — every emitted .md/.mdc closes the code fences it opens", () => {
    // This was the file's ONE documented defence and the one thing it never
    // actually asserted: the docblock above says "fences must balance in every
    // emitted file", and meanwhile BOTH emitted AGENTS.md files shipped an
    // unterminated ```json — the trait tier is capped at 50 lines and the cut
    // landed inside a fence, so ~280 lines (six traits, the path-scoped rules,
    // every agent definition) rendered as one code block. AGENTS.md is the
    // universal surface every platform reads, so it was the most-read artifact
    // the compiler produces and it was visibly broken to anyone who opened it.
    //
    // Naming the AGENTS.md files explicitly matters: this assertion is over a
    // derived set, and a build that stopped emitting them would otherwise pass
    // it by emitting nothing.
    const files = walkEmitted(dist);
    const rel = files.map((f) => path.relative(dist, f).split(path.sep).join("/"));
    expect(rel, "the universal AGENTS.md surface was not emitted at all").toContain("agents/AGENTS.md");
    expect(rel, "the codex AGENTS.md copy was not emitted at all").toContain("codex/core/AGENTS.md");

    const unbalanced = files
      .filter((f) => unbalancedFences(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(dist, f).split(path.sep).join("/"));
    expect(
      unbalanced,
      `an unterminated code fence renders the rest of these files as one code block:\n${unbalanced.join("\n")}`,
    ).toEqual([]);
  });

  it("MUTATION: removing one closing fence turns the balance invariant red", () => {
    // A check that cannot fail is not a check, and this codebase has shipped
    // one that could not. So the balance scan is run against a real emitted
    // artifact with exactly the regression Q66 was — one closer deleted.
    const victim = path.join(dist, "agents", "AGENTS.md");
    const original = fs.readFileSync(victim, "utf-8");
    try {
      const lines = original.split("\n");
      // Delete the LAST closer, not the first: an earlier closer's removal is
      // absorbed by the next opener (```yaml carries an info string, so it can
      // never itself close a block) and the document stays balanced — which is
      // exactly how a mutation test passes while proving nothing.
      const closers: number[] = [];
      let openChar = "";
      let openLen = 0;
      let isOpen = false;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        const fence = /^(`{3,}|~{3,})/.exec(trimmed);
        if (!fence) continue;
        const ch = fence[1]![0]!;
        const len = fence[1]!.length;
        if (!isOpen) {
          isOpen = true;
          openChar = ch;
          openLen = len;
        } else if (ch === openChar && len >= openLen && trimmed === ch.repeat(len)) {
          closers.push(i);
          isOpen = false;
        }
      }
      expect(closers.length, "no closing fence to remove — the mutation would be vacuous").toBeGreaterThan(0);
      lines.splice(closers[closers.length - 1]!, 1);
      fs.writeFileSync(victim, lines.join("\n"), "utf-8");

      const unbalanced = walkEmitted(dist)
        .filter((f) => unbalancedFences(fs.readFileSync(f, "utf-8")))
        .map((f) => path.relative(dist, f).split(path.sep).join("/"));
      expect(unbalanced, "the corpus scan did not see a deleted closing fence").toEqual(["agents/AGENTS.md"]);
    } finally {
      fs.writeFileSync(victim, original, "utf-8");
    }
  });

  it("NO emitted .md/.mdc ships a frontmatter block as body text", () => {
    const offenders: string[] = [];
    for (const f of walkEmitted(dist)) {
      const content = fs.readFileSync(f, "utf-8");
      for (const b of findFrontmatterBlocks(content)) {
        if (b.line === 0 || b.fenced) continue;
        offenders.push(
          `${path.relative(dist, f)} (line ${b.line + 1})\n${b.text.split("\n").slice(0, 6).join("\n")}`,
        );
      }
    }
    expect(
      offenders,
      `raw YAML frontmatter is shipping as instruction body text:\n\n${offenders.join("\n\n")}`,
    ).toEqual([]);
  });

  it("MUTATION: reintroducing one stray block turns the invariant red", () => {
    // The assertion above has already proven untrustworthy once in this
    // codebase's history — V3-1 was green while ten artifacts leaked. So the
    // scan is exercised against a real emitted artifact with a leak put back
    // into it, in the exact shape the personas shipped.
    const victim = path.join(dist, "cursor", "core", "rules", "code-reviewer.mdc");
    const original = fs.readFileSync(victim, "utf-8");
    try {
      const stray = "---\nname: code-reviewer\nid: 01KZRG8RTET6CTDQEEFX8M9ZQX\nhash: sha256:deadbeef\n---\n";
      const idx = original.indexOf("\n# ");
      fs.writeFileSync(victim, `${original.slice(0, idx + 1)}${stray}${original.slice(idx + 1)}`, "utf-8");

      const offenders: string[] = [];
      for (const f of walkEmitted(dist)) {
        for (const b of findFrontmatterBlocks(fs.readFileSync(f, "utf-8"))) {
          if (b.line === 0 || b.fenced) continue;
          offenders.push(path.relative(dist, f));
        }
      }
      expect(offenders, "the corpus scan did not see an injected leak").toEqual([
        path.join("cursor", "core", "rules", "code-reviewer.mdc"),
      ]);
    } finally {
      fs.writeFileSync(victim, original, "utf-8");
    }
  });
});
