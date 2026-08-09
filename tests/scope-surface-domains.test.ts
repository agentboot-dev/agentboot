/**
 * R4-2 — `domains/*&#47;instructions` was invisible to every scope surface except
 * the build's own F-6 gate.
 *
 * `countNarrowlyScopedInstructions` had three call sites — the build's
 * capability gate (compile.ts) and doctor's Coverage and Scoping blocks
 * (cli.ts) — and each hand-built the same two-element literal
 * `[packageInstructionsDir, coreInstructionsDir]`. `compileDomains()` pushes
 * domain instructions through the SAME emitters, so a hub whose only narrow rule
 * lives in a domain was reported as having no scoped instruction at all.
 *
 * Measured on a scratch hub (one narrow instruction in `domains/fin/
 * instructions`, `outputFormats: ["skill","claude"]`), exit codes unpiped:
 *
 *     agentboot build   EXIT 1
 *       "✗ Path scoping cannot be expressed on: skill, claude"
 *     agentboot doctor  EXIT 0 (with the rule acknowledged)
 *       "✓ Capability coverage — nothing to check: no capability in the
 *          support table is configured on this hub"
 *       "✓ Path scoping is expressible on every configured target"
 *
 * Two positive false claims, about a file the build had just refused. Move the
 * same bytes into `core/instructions` and doctor says
 * "⚠ instructions[].applyTo — configured, but needs one of: copilot, cursor,
 * jetbrains, windsurf". Same file, opposite verdict, decided only by which
 * directory it sits in — the NEW-1 sentence, one gate over.
 *
 * Two tests, deliberately of different kinds: the behavioural one proves the
 * derivation sees a domain, and the structural one proves no call site is
 * allowed to hand-build the list again. The structural one is the load-bearing
 * half, because the defect was never in the counting — it was in the argument.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { countNarrowlyScopedInstructions } from "../scripts/lib/guardrail-scan.js";
import { scopeBearingInstructionDirs } from "../scripts/lib/scope-layout.js";
import type { AgentBootConfig } from "../scripts/lib/config.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fm = (applyTo: string) => `---\ndescription: x\napplyTo: "${applyTo}"\n---\n\n# body\n`;

function mkHub(): { hub: string; pkgDir: string; coreDir: string } {
  // realpath the fixture root: the boundary check compares `path.resolve(configDir)`
  // against `fs.realpathSync(domainPath)`, exactly as compileDomains() does, and on
  // macOS mkdtemp hands back /var/... whose realpath is /private/var/....
  const hub = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r4-domains-")));
  const pkgDir = path.join(hub, "_pkg", "instructions");
  const coreDir = path.join(hub, "core", "instructions");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  return { hub, pkgDir, coreDir };
}

describe("R4-2 — the scope surfaces see domains/*/instructions", () => {
  it("a narrow rule in a configured domain is counted", () => {
    const { hub, pkgDir, coreDir } = mkHub();
    const domainDir = path.join(hub, "domains", "fin", "instructions");
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(path.join(domainDir, "ledger.instructions.md"), fm("src/ledger/**"));
    const config = { org: "acme", domains: ["./domains/fin"] } as AgentBootConfig;

    expect(
      countNarrowlyScopedInstructions(scopeBearingInstructionDirs(pkgDir, coreDir, config, hub)),
      "the domain rule is compiled by the same emitters and must be visible here",
    ).toBe(1);
  });

  it("the domain tier does NOT answer to instructions.enabled — compileDomains passes undefined", () => {
    // The exact repro: the hub set `instructions.enabled: ["baseline.instructions"]`,
    // so filtering the domain dir by that list dropped the only narrow rule and
    // produced "nothing to check".
    const { hub, pkgDir, coreDir } = mkHub();
    const domainDir = path.join(hub, "domains", "fin", "instructions");
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(path.join(domainDir, "ledger.instructions.md"), fm("src/ledger/**"));
    const config = {
      org: "acme",
      domains: ["./domains/fin"],
      instructions: { enabled: ["baseline.instructions"] },
    } as AgentBootConfig;

    expect(countNarrowlyScopedInstructions(scopeBearingInstructionDirs(pkgDir, coreDir, config, hub))).toBe(1);
  });

  it("a domain rule does not SHADOW a core rule of the same name — separate scopes", () => {
    const { hub, pkgDir, coreDir } = mkHub();
    fs.writeFileSync(path.join(coreDir, "a.md"), fm("**")); // universal
    const domainDir = path.join(hub, "domains", "fin", "instructions");
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(path.join(domainDir, "a.md"), fm("src/ledger/**")); // narrow
    const config = { org: "acme", domains: ["./domains/fin"] } as AgentBootConfig;

    // Both are compiled, to different scopePaths. Name-merging them would let a
    // universal core rule silence a narrow domain rule.
    expect(countNarrowlyScopedInstructions(scopeBearingInstructionDirs(pkgDir, coreDir, config, hub))).toBe(1);
  });

  it("NEGATIVE: a domain that is on disk but not in config.domains is not counted", () => {
    // compileDomains only builds configured domains; counting a draft would fire
    // the gate on a file that ships nowhere, and a gate that refuses on the wrong
    // evidence gets switched off.
    const { hub, pkgDir, coreDir } = mkHub();
    const domainDir = path.join(hub, "domains", "draft", "instructions");
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(path.join(domainDir, "x.instructions.md"), fm("src/x/**"));
    const config = { org: "acme" } as AgentBootConfig;

    expect(countNarrowlyScopedInstructions(scopeBearingInstructionDirs(pkgDir, coreDir, config, hub))).toBe(0);
  });

  it("NEGATIVE: a domain resolving outside the hub is not counted — same boundary as compileDomains", () => {
    const { hub, pkgDir, coreDir } = mkHub();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r4-outside-"));
    fs.mkdirSync(path.join(outside, "instructions"), { recursive: true });
    fs.writeFileSync(path.join(outside, "instructions", "x.instructions.md"), fm("src/x/**"));
    const config = { org: "acme", domains: [{ name: "esc", path: outside }] } as AgentBootConfig;

    expect(countNarrowlyScopedInstructions(scopeBearingInstructionDirs(pkgDir, coreDir, config, hub))).toBe(0);
  });
});

describe("R4-2 — no call site may hand-build the instruction-dir list", () => {
  /**
   * The invariant, not the symptom. Three sites drifted from one derivation
   * because each was free to pass its own array; the counting was never wrong.
   * Two lists that must agree will drift — so assert that there is one list.
   */
  const SITES = ["scripts/compile.ts", "scripts/cli.ts"];

  it("every countNarrowlyScopedInstructions call passes scopeBearingInstructionDirs(...)", () => {
    const offenders: string[] = [];
    for (const rel of SITES) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf-8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("countNarrowlyScopedInstructions(")) return;
        // The argument is on this line or the next non-blank one.
        const after = line.slice(line.indexOf("countNarrowlyScopedInstructions(") + "countNarrowlyScopedInstructions(".length);
        const arg = after.trim() || (lines[i + 1] ?? "").trim();
        if (!arg.startsWith("scopeBearingInstructionDirs(")) {
          offenders.push(`${rel}:${i + 1} → ${arg.slice(0, 60)}`);
        }
      });
    }
    expect(
      offenders,
      "a hand-built dir list here is how domains/*/instructions became invisible to " +
        "the capability gate and to doctor's Coverage and Scoping blocks",
    ).toEqual([]);
  });

  it("all three known call sites are still present — the check must not go vacuous", () => {
    // A rename or a deletion would make the assertion above pass over nothing.
    const total = SITES.reduce(
      (n, rel) =>
        n +
        (fs.readFileSync(path.join(REPO, rel), "utf-8").match(/countNarrowlyScopedInstructions\(/g) ?? []).length,
      0,
    );
    expect(total, "expected the build gate plus doctor's Coverage and Scoping blocks").toBe(3);
  });
});
