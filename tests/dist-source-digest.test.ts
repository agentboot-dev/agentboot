/**
 * A1/A2-residual — the freshness digest covered the config JSON and nothing else.
 *
 * N1's third case is "the operator edited policy and simply did not rebuild".
 * The commit that claimed to close it hashed `computeConfigDigest(config)` — the
 * resolved agentboot.config.json. MOST POLICY IS NOT THERE. `guardrail: hard`,
 * `applyTo:` and the control text itself are artifact frontmatter and body under
 * `core/`. So the exact scenario N1 was written for still reported green:
 *
 *   build + sync a soft `core/instructions/phi.instructions.md`
 *     ("Avoid logging patient data where practical")
 *   tighten the ARTIFACT to `guardrail: hard` +
 *     "NEVER log, trace, or print patient-identifying data. Non-overridable."
 *   do not rebuild
 *     sync        EXIT 0   "– spokeV (claude) — skipped (no changes)"
 *                          "✓ Synced 0 of 1 repo"
 *     drift-check EXIT 0   "1/1 clean"
 *     audit       EXIT 0
 *     stamp                "success"
 *   and the spoke still carried the SOFT text.
 *
 * The stamp now also carries a digest of the artifact sources. Two properties
 * are asserted here: the digest MOVES for every kind of source change (edit,
 * add, delete, rename), and the root set it covers cannot drift away from what
 * the compiler actually reads.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  computeSourceDigest,
  resolveDomainRoots,
  checkDistFreshness,
  writeDistStamp,
  computeConfigDigest,
  HUB_SOURCE_ROOTS,
} from "../scripts/lib/dist-stamp.js";

const ROOT = path.resolve(__dirname, "..");

function scratchHub(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-srcdigest-"));
  fs.mkdirSync(path.join(dir, "core", "instructions"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "core", "instructions", "phi.instructions.md"),
    "---\ndescription: PHI\nguardrail: soft\n---\n# PHI\nAvoid logging patient data where practical.\n"
  );
  return dir;
}

describe("A1/A2-residual — the source digest sees artifact edits", () => {
  it("S-1: tightening guardrail: soft → hard moves the digest", () => {
    // The reported repro, as a unit. A config-only digest is IDENTICAL across
    // this edit — that is the whole defect.
    const hub = scratchHub();
    const file = path.join(hub, "core", "instructions", "phi.instructions.md");
    const before = computeSourceDigest(hub);
    fs.writeFileSync(
      file,
      "---\ndescription: PHI\nguardrail: hard\n---\n# PHI\nNEVER log, trace, or print patient-identifying data. Non-overridable.\n"
    );
    expect(computeSourceDigest(hub)).not.toBe(before);
  });

  it("S-2: a body-only edit moves it too — the control TEXT is the control", () => {
    const hub = scratchHub();
    const file = path.join(hub, "core", "instructions", "phi.instructions.md");
    const before = computeSourceDigest(hub);
    const body = fs.readFileSync(file, "utf-8").replace("where practical", "under any circumstances");
    fs.writeFileSync(file, body);
    expect(computeSourceDigest(hub)).not.toBe(before);
  });

  it("S-3: DELETING an artifact moves it — a revocation that never rebuilt is the same lie", () => {
    const hub = scratchHub();
    const before = computeSourceDigest(hub);
    fs.rmSync(path.join(hub, "core", "instructions", "phi.instructions.md"));
    expect(computeSourceDigest(hub)).not.toBe(before);
  });

  it("S-4: RENAMING an artifact moves it — names are hashed, not just contents", () => {
    const hub = scratchHub();
    const dir = path.join(hub, "core", "instructions");
    const before = computeSourceDigest(hub);
    fs.renameSync(path.join(dir, "phi.instructions.md"), path.join(dir, "phi2.instructions.md"));
    expect(computeSourceDigest(hub)).not.toBe(before);
  });

  it("S-5: adding an artifact moves it", () => {
    const hub = scratchHub();
    const before = computeSourceDigest(hub);
    fs.mkdirSync(path.join(hub, "core", "gotchas"), { recursive: true });
    fs.writeFileSync(path.join(hub, "core", "gotchas", "g.md"), "---\ndescription: g\n---\nx\n");
    expect(computeSourceDigest(hub)).not.toBe(before);
  });

  it("S-6 (NEGATIVE): the digest is STABLE when nothing changed", () => {
    // A digest that moves on its own is a staleness error that fires when
    // nothing is stale, which trains operators to ignore the real one — the
    // exact reasoning dist-stamp.ts already gives for excluding `sync.*`.
    const hub = scratchHub();
    expect(computeSourceDigest(hub)).toBe(computeSourceDigest(hub));
  });

  it("S-7 (NEGATIVE): touching a NON-source file leaves it alone", () => {
    const hub = scratchHub();
    const before = computeSourceDigest(hub);
    fs.writeFileSync(path.join(hub, "README.md"), "# notes\n");
    fs.writeFileSync(path.join(hub, "repos.json"), '[{"name":"a","path":"../a"}]');
    fs.mkdirSync(path.join(hub, "dist"), { recursive: true });
    fs.writeFileSync(path.join(hub, "dist", "whatever.json"), "{}");
    expect(computeSourceDigest(hub)).toBe(before);
  });

  it("S-8: domain roots are covered, and their order in config does not matter", () => {
    const hub = scratchHub();
    for (const d of ["alpha", "beta"]) {
      fs.mkdirSync(path.join(hub, "domains", d, "traits"), { recursive: true });
      fs.writeFileSync(path.join(hub, "domains", d, "traits", "t.md"), `---\ndescription: ${d}\n---\n${d}\n`);
    }
    const cfgA = { domains: ["./domains/alpha", "./domains/beta"] };
    const cfgB = { domains: [{ name: "beta" }, { name: "alpha" }] };
    const a = computeSourceDigest(hub, resolveDomainRoots(hub, cfgA));
    const b = computeSourceDigest(hub, resolveDomainRoots(hub, cfgB));
    expect(a).toBe(b);

    const bare = computeSourceDigest(hub);
    expect(a, "domain content is not in the digest at all").not.toBe(bare);

    fs.writeFileSync(path.join(hub, "domains", "alpha", "traits", "t.md"), "---\ndescription: alpha\n---\nCHANGED\n");
    expect(computeSourceDigest(hub, resolveDomainRoots(hub, cfgA))).not.toBe(a);
  });
});

describe("A1/A2-residual — the gate acts on the source digest", () => {
  const cfg = { org: "acme" };

  it("S-9: a stamp with a matching source digest is fresh", () => {
    const hub = scratchHub();
    const dist = path.join(hub, "dist");
    writeDistStamp(dist, {
      status: "success",
      configDigest: computeConfigDigest(cfg),
      sourceDigest: computeSourceDigest(hub),
      outputFormats: ["claude"],
      builtAt: new Date().toISOString(),
      agentbootVersion: "0.0.0",
    });
    expect(checkDistFreshness(dist, cfg, hub).fresh).toBe(true);
  });

  it("S-10: editing the artifact afterwards makes it `sources-stale`", () => {
    const hub = scratchHub();
    const dist = path.join(hub, "dist");
    writeDistStamp(dist, {
      status: "success",
      configDigest: computeConfigDigest(cfg),
      sourceDigest: computeSourceDigest(hub),
      outputFormats: ["claude"],
      builtAt: new Date().toISOString(),
      agentbootVersion: "0.0.0",
    });
    fs.writeFileSync(
      path.join(hub, "core", "instructions", "phi.instructions.md"),
      "---\ndescription: PHI\nguardrail: hard\n---\nNEVER.\n"
    );
    const r = checkDistFreshness(dist, cfg, hub);
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe("sources-stale");
    expect(r.detail).toContain("guardrail");
  });

  it("S-11: a stamp with NO source digest fails closed, it does not pass by absence", () => {
    // "Unknown ⇒ trusted" is the mistake this whole file exists to prevent. A
    // pre-upgrade stamp records nothing about core/, so it cannot vouch for it.
    const hub = scratchHub();
    const dist = path.join(hub, "dist");
    writeDistStamp(dist, {
      status: "success",
      configDigest: computeConfigDigest(cfg),
      outputFormats: ["claude"],
      builtAt: new Date().toISOString(),
      agentbootVersion: "0.0.0",
    });
    const r = checkDistFreshness(dist, cfg, hub);
    expect(r.fresh).toBe(false);
    expect(r.reason).toBe("sources-stale");
  });
});

/**
 * The root set and what the compiler reads are two lists that must agree.
 * Assert it, rather than remembering it.
 */
describe("A1/A2-residual — HUB_SOURCE_ROOTS covers what the compiler reads", () => {
  it("S-12: every hub directory compile.ts reads is in HUB_SOURCE_ROOTS", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "compile.ts"), "utf-8");
    const found = new Set<string>();
    for (const m of src.matchAll(/path\.join\((?:HUB_ROOT|hubRoot),\s*"([a-zA-Z0-9._-]+)"/g)) {
      found.add(m[1]!);
    }
    expect(found.size, "the scan found no hub reads at all — the regex has drifted").toBeGreaterThan(0);
    const missing = [...found].filter((d) => !(HUB_SOURCE_ROOTS as readonly string[]).includes(d));
    expect(
      missing,
      `compile.ts reads these hub directories, but the freshness digest does not cover them — ` +
        `an edit under them would ship silently: ${missing.join(", ")}`
    ).toEqual([]);
  });
});
