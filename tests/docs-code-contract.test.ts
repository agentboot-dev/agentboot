import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { installUserLevel, stageForHandoff } from "../scripts/lib/user-scope.js";
import {
  DEFAULT_MAX_HOOK_INPUT_BYTES,
  MAX_ALLOWED_HOOK_INPUT_BYTES,
  hookInputCapPrelude,
} from "../scripts/lib/hook-prelude.js";

/**
 * Docs↔code contract.
 *
 * A reference page that describes a control is itself a control surface: an
 * operator who cannot learn a limit, a legal value or a wire format from the
 * published docs cannot configure it, and cannot audit it either. Every
 * assertion here therefore derives its expectation FROM THE CODE — a constant,
 * a validator, an emitted string — and then checks that the published page says
 * it. A doc test that hard-codes both sides proves only that someone typed the
 * same thing twice.
 *
 * Each extractor fails loudly when it cannot find its subject in the source. An
 * extractor that quietly yields an empty set turns the whole file green while
 * measuring nothing, which is the vacuous-pass class this repo keeps closing.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** Pull a `{ "key": "value" }` object literal out of a source file by name. */
function extractStringMap(src: string, declName: string): Record<string, string> {
  const m = src.match(new RegExp(`const ${declName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!m) throw new Error(`could not locate \`${declName}\` — re-derive this test against the current source`);
  const out: Record<string, string> = {};
  for (const pair of m[1]!.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out[pair[1]!] = pair[2]!;
  if (Object.keys(out).length === 0) throw new Error(`\`${declName}\` parsed to an empty map`);
  return out;
}

describe("L36 — ab.modelOverrides is documented with keys, defaults and legal values", () => {
  const compileSrc = read("scripts/compile.ts");
  const docs = read("docs/configuration.md");

  it("documents every /ab agent key and its default model", () => {
    const defaults = extractStringMap(compileSrc, "defaultModels");
    expect(Object.keys(defaults).length).toBeGreaterThanOrEqual(5);
    for (const [agent, model] of Object.entries(defaults)) {
      // The key must be named, and its default must appear on the same line —
      // a table row, not two unrelated mentions elsewhere on the page.
      const row = docs
        .split("\n")
        .find((l) => l.includes("modelOverrides") && l.includes(agent) && l.includes(`\`${model}\``));
      expect(row, `docs/configuration.md has no row giving ${agent}'s default model (${model})`).toBeTruthy();
    }
  });

  it("documents ab-query's haiku default as the cost rationale", () => {
    const defaults = extractStringMap(compileSrc, "defaultModels");
    expect(defaults["ab-query"], "ab-query is no longer the cheap agent — re-derive the doc").toBe("haiku");
    expect(docs).toMatch(/ab-query[^\n]*haiku|haiku[^\n]*ab-query/i);
  });

  it("documents every legal ab.modelOverrides value the validator accepts", () => {
    const aliasBlock = compileSrc.match(/const VALID_AB_MODEL_ALIASES = new Set\(\[([^\]]*)\]\)/);
    if (!aliasBlock) throw new Error("could not locate VALID_AB_MODEL_ALIASES");
    const aliases = [...aliasBlock[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      expect(docs, `docs/configuration.md never names the legal value "${alias}"`).toContain(`\`${alias}\``);
    }
    // …and the escape hatch for an explicit model id.
    expect(docs).toContain("^claude-[a-z0-9.-]+$");
  });

  it("documents ab-query's read-only deny list", () => {
    const m = compileSrc.match(/const defaultDisallowedTools[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
    if (!m) throw new Error("could not locate defaultDisallowedTools");
    const tools = [...m[1]!.matchAll(/"([^"]+)"/g)].map((t) => t[1]!).filter((t) => t !== "ab-query");
    expect(tools).toContain("Bash");
    for (const tool of tools) {
      expect(docs, `docs/configuration.md never names ab-query's denied tool "${tool}"`).toContain(tool);
    }
    expect(docs).toContain("disallowedTools");
  });

  it("states honestly that an invalid override warns rather than failing the build", () => {
    // The emitted warning is the operator's ONLY signal, so the page must not
    // imply the build rejects a typo. Pin the behaviour to the emitter.
    expect(compileSrc).toContain("Ignoring invalid ab.modelOverrides");
    expect(docs).toMatch(/Ignoring invalid ab\.modelOverrides/);
    expect(docs).toMatch(/does not fail the build/i);
  });
});

/**
 * L38 — the AB↔provider handoff manifest.
 *
 * This manifest is the only coupling between AgentBoot and an external
 * user-scope provider, so its wire format is a published interface. The
 * assertions below STAGE A REAL HANDOFF and check the published page against
 * the artifact that came out, rather than against a second copy of the prose.
 */
describe("L38 — the user-scope handoff contract is published", () => {
  const docs = read("docs/configuration.md");

  /** Stage a miniature dist/claude/core and return the real handoff manifest. */
  function stageFixture(): {
    manifest: Record<string, unknown>;
    files: Array<{ path: string; hash: string }>;
    staged: string[];
    stagingDir: string;
    tmp: string;
  } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-docs-handoff-"));
    const coreDir = path.join(tmp, "dist", "claude", "core");
    fs.mkdirSync(path.join(coreDir, "skills", "ab"), { recursive: true });
    fs.mkdirSync(path.join(coreDir, "rules"), { recursive: true });
    fs.writeFileSync(path.join(coreDir, "skills", "ab", "SKILL.md"), "# skill\n");
    fs.writeFileSync(path.join(coreDir, "rules", "baseline.md"), "# rule\n");
    // The two composed files that must never cross the membrane.
    fs.writeFileSync(path.join(coreDir, "CLAUDE.md"), "# claude\n");
    fs.writeFileSync(path.join(coreDir, "settings.json"), "{}\n");

    const stagingDir = path.join(tmp, "staged");
    const res = stageForHandoff(coreDir, stagingDir);
    expect(res.errors, res.errors.join("; ")).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(res.manifestPath, "utf-8")) as Record<string, unknown>;
    return {
      manifest,
      files: manifest["files"] as Array<{ path: string; hash: string }>,
      staged: res.staged,
      stagingDir,
      tmp,
    };
  }

  it("publishes both manifest filenames and the sentinel that selects the mode", () => {
    const f = stageFixture();
    expect(fs.readdirSync(f.stagingDir).find((n) => n.endsWith(".json"))).toBe(".agentboot-handoff.json");
    for (const name of [".agentboot-handoff.json", ".agentboot-user-manifest.json", ".managed"]) {
      expect(docs, `docs/configuration.md never names ${name}`).toContain(name);
    }
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });

  it("publishes the default staging path", () => {
    // No stagingDir supplied — this is the path an external provider must watch.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-docs-stagepath-"));
    const coreDir = path.join(tmp, "dist", "claude", "core");
    fs.mkdirSync(path.join(coreDir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(coreDir, "skills", "s.md"), "x\n");
    const res = installUserLevel(coreDir, { userLevel: { mode: "manifest" } } as never, {
      dryRun: true,
      claudeDir: path.join(tmp, "home", ".claude"),
    });
    expect(res.mode).toBe("manifest");
    const rel = path.relative(path.join(tmp, "dist"), res.staged!.stagingDir).replace(/\\/g, "/");
    expect(rel).toBe("claude-user");
    expect(docs, "docs/configuration.md never gives the default staging path").toContain("claude-user");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("publishes every field of the emitted manifest schema", () => {
    const f = stageFixture();
    // Top-level keys, and the per-file keys, exactly as an implementer sees them.
    for (const key of Object.keys(f.manifest)) {
      expect(docs, `docs/configuration.md never names manifest field "${key}"`).toContain(key);
    }
    for (const key of Object.keys(f.files[0]!)) {
      expect(docs, `docs/configuration.md never names files[].${key}`).toContain(key);
    }
    // The constants are part of the contract, not decoration.
    expect(f.manifest["managed_by"]).toBe("agentboot");
    expect(f.manifest["scope"]).toBe("user");
    expect(f.manifest["mode"]).toBe("manifest");
    expect(f.manifest["apply_target"]).toBe("~/.claude");
    expect(docs).toContain("apply_target");
    expect(docs).toContain("~/.claude");
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });

  it("publishes SHA-256-over-contents and POSIX-relative paths as the wire format", () => {
    const f = stageFixture();
    const skill = f.files.find((x) => x.path.endsWith("SKILL.md"))!;
    expect(skill.path, "manifest paths must be POSIX-relative to the staging root")
      .toBe("skills/ab/SKILL.md");
    expect(skill.path.startsWith("/")).toBe(false);
    expect(skill.path).not.toContain("\\");
    expect(skill.path).not.toContain("..");
    expect(skill.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(skill.hash).toBe(
      createHash("sha256").update(fs.readFileSync(path.join(f.stagingDir, "skills/ab/SKILL.md"))).digest("hex"),
    );
    expect(docs).toMatch(/SHA-256/i);
    expect(docs).toMatch(/POSIX-relative/i);
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });

  it("publishes the CLAUDE.md / settings.json exclusion that the stager actually applies", () => {
    const f = stageFixture();
    const stagedRel = f.staged.map((p) => path.relative(f.stagingDir, p).replace(/\\/g, "/"));
    expect(stagedRel.some((p) => p.endsWith("CLAUDE.md")), "CLAUDE.md must never be staged").toBe(false);
    expect(stagedRel.some((p) => p.endsWith("settings.json")), "settings.json must never be staged").toBe(false);
    expect(stagedRel.sort()).toEqual(["rules/baseline.md", "skills/ab/SKILL.md"]);
    // …and the page must say so, because a silent omission is indistinguishable
    // from a delivery failure to whoever is on the other side of the membrane.
    const exclusion = docs.match(/[^\n]*never written or staged[\s\S]{0,900}/)?.[0] ?? "";
    expect(exclusion, "docs/configuration.md never states the exclusion").not.toBe("");
    expect(exclusion).toContain("CLAUDE.md");
    expect(exclusion).toContain("settings.json");
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });

  it("names the manifest as the only AB↔provider coupling", () => {
    expect(docs).toMatch(/only coupling between AgentBoot and an external user-scope provider/i);
  });
});

/**
 * L42 — the 1 MiB hook stdin cap.
 *
 * The emitted hook tells the developer to raise
 * AGENTBOOT_MAX_HOOK_INPUT_BYTES, so the variable is already part of the
 * product's user-facing surface; it appeared on no published surface at all.
 * Both numbers below are IMPORTED from the module that emits the hooks, so a
 * change to the cap turns this red instead of leaving the docs quietly wrong.
 */
describe("L42 — the hook input cap, its override and its postures are documented", () => {
  const docs = read("docs/configuration.md");
  const guardrails = read("docs/guardrails.md");
  const compileSrc = read("scripts/compile.ts");

  it("documents the default cap and the accepted range, taken from the emitter", () => {
    expect(DEFAULT_MAX_HOOK_INPUT_BYTES).toBe(1048576); // 1 MiB, per the doc's prose
    expect(docs, "the default cap is not published").toContain(String(DEFAULT_MAX_HOOK_INPUT_BYTES));
    expect(docs, "the upper bound of the accepted range is not published")
      .toContain(String(MAX_ALLOWED_HOOK_INPUT_BYTES));
    expect(docs).toContain("AGENTBOOT_MAX_HOOK_INPUT_BYTES");
    expect(docs).toMatch(/1 MiB/);
  });

  it("documents the refuse-on-unusable-limit behaviour for both postures", () => {
    // A blocking hook refuses; a non-blocking one falls back to the default.
    const blocking = hookInputCapPrelude({
      overCapStderr: "x.",
      action: "block",
      blockReason: "y",
    });
    const degrading = hookInputCapPrelude({ overCapStderr: "x.", action: "continue" });
    expect(blocking).toContain("refusing to run an unbounded gate");
    expect(blocking).toContain("exit 2");
    expect(degrading).toContain(`falling back to ${DEFAULT_MAX_HOOK_INPUT_BYTES}`);

    expect(docs, "the page does not say a blocking gate refuses an unusable limit")
      .toMatch(/Refuses to run[\s\S]{0,400}unbounded/i);
    expect(docs, "the page does not say a non-blocking hook falls back to the default")
      .toMatch(/Falls back to the `?1048576`? default/i);
    // Range validation is only meaningful if the page says what "usable" means.
    expect(docs).toMatch(/no leading zero/i);
  });

  it("documents all four over-cap postures, one per emitted hook", () => {
    // Derive the postures from the four call sites rather than trusting the count.
    const actions = [...compileSrc.matchAll(/hookInputCapPrelude\(\{[\s\S]*?action:\s*"(\w+)"/g)]
      .map((m) => m[1]!);
    expect(actions, "expected four generated hooks with a declared posture").toHaveLength(4);
    expect(actions.filter((a) => a === "block")).toHaveLength(2);
    expect(actions.filter((a) => a === "exit0")).toHaveLength(1);
    expect(actions.filter((a) => a === "continue")).toHaveLength(1);

    // The page must name each hook's event AND its posture in the same row.
    const rows = docs.split("\n").filter((l) => l.trim().startsWith("|"));
    const expected: Array<[string, RegExp]> = [
      ["UserPromptSubmit", /\*\*block\*\*/],
      ["PreToolUse", /\*\*block\*\*/],
      ["Stop", /\*\*skip\*\*/],
      ["SessionEnd", /\*\*degrade\*\*/],
    ];
    for (const [event, posture] of expected) {
      const row = rows.find((r) => r.includes(`\`${event}\``) && posture.test(r));
      expect(row, `no row documents the over-cap posture for the ${event} hook`).toBeTruthy();
    }
  });

  it("quotes the block message the input-scan hook actually emits", () => {
    // The emitted message tells the operator to raise the variable; the docs are
    // where they find out what it is. Pin them to each other.
    expect(compileSrc).toContain("raise AGENTBOOT_MAX_HOOK_INPUT_BYTES deliberately");
    expect(docs).toContain("raise `AGENTBOOT_MAX_HOOK_INPUT_BYTES` deliberately");
  });

  it("does not conflate the cap with failMode or the platform hook timeout", () => {
    expect(docs).toMatch(/not `compliance\.inputScan\.failMode`/);
    expect(docs).toMatch(/time out|timeout/i);
  });

  it("is cross-linked from guardrails.md, and the anchor resolves", () => {
    expect(guardrails).toContain("AGENTBOOT_MAX_HOOK_INPUT_BYTES");
    const link = guardrails.match(/configuration\.md#([a-z0-9_-]+)/i);
    expect(link, "guardrails.md does not link to the hook input limit section").toBeTruthy();
    const anchor = link![1]!;
    // Resolve the anchor against the real headings — a cross-link that 404s is
    // the same silence as no cross-link at all.
    const slugs = docs
      .split("\n")
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) =>
        l
          .replace(/^#{1,6}\s+/, "")
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s/g, "-"),
      );
    expect(slugs, `guardrails.md links to #${anchor}, which is not a heading in configuration.md`)
      .toContain(anchor);
  });
});
