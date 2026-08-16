/**
 * The assurance-claim register (docs/assurance-claims.md) is the structural
 * control against "assurance artifact claims more than mechanism delivers":
 * every public assurance claim must point at an executable probe. This test
 * mechanizes the register — a row referencing a probe file that does not
 * exist fails the build, so rows cannot silently rot.
 *
 * E12 — THE REGISTER WAS A ONE-DIRECTIONAL CONTRACT.
 *
 * Everything above checks rows → probes: given a row, does its probe exist,
 * does it state its limits. Nothing checked claims → rows. So the failure the
 * register exists to prevent — a claim made publicly with nothing behind it —
 * was the one failure it could not see, because an unregistered claim has no
 * row to start the check from.
 *
 * That is not hypothetical. PR mode (`sync.pr.enabled`) is described as
 * functioning behaviour at `docs/cli-reference.md` and `docs/configuration.md`,
 * had no row among the fourteen, and has never been run against a real remote.
 * It survived three deferrals with a green register. The same shape as the
 * reader/writer defect one level up: a two-directional contract verified in one
 * direction reads exactly like a working control.
 *
 * The second direction is DECLARED, not inferred, for the reason
 * `claim-hygiene.test.ts` gives about its own banned list: a heuristic that
 * decides what counts as an "assurance claim" from prose would fire on correct
 * pages and get tuned out. Each detector below names a claim, how to find it on
 * a public surface, and the register row that must exist while it is public.
 * Delete the claim from every doc site and the detector stops firing — that is
 * the sanctioned way out, and it forces deleting the detector too, so removing
 * a claim stays a decision rather than a drift.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const REGISTER = path.join(ROOT, "docs", "assurance-claims.md");

describe("assurance-claim register", () => {
  const content = fs.readFileSync(REGISTER, "utf-8");
  const rows = content
    .split("\n")
    .filter((l) => /^\|\s*\d+\s*\|/.test(l));

  it("has at least the eleven v0.16.0 claims", () => {
    expect(rows.length).toBeGreaterThanOrEqual(11);
  });

  it("every referenced repo path in the probe column exists", () => {
    const missing: string[] = [];
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const probeCell = cells[3] ?? "";
      const refs = [...probeCell.matchAll(/`([^`]+)`/g)]
        .map((m) => m[1])
        // Keep only path-shaped refs (contain a slash and an extension or known dir).
        .filter((r) => /[/\\]/.test(r) && !r.startsWith("--") && !r.includes("<"));
      for (const ref of refs) {
        if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${cells[1]}: ${ref}`);
      }
      expect(refs.length, `row ${cells[1]} names no probe file`).toBeGreaterThan(0);
    }
    expect(missing).toEqual([]);
  });

  it("every row states its honest limits", () => {
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect((cells[4] ?? "").length, `row ${cells[1]} has no limits statement`).toBeGreaterThan(10);
    }
  });

  // -------------------------------------------------------------------------
  // E12 — the missing direction: claims → rows
  // -------------------------------------------------------------------------

  it("an unexercised claim SAYS so, and carries a dated revisit trigger", () => {
    // A claim asserted from code but never run end to end is allowed to ship —
    // labelled. Unlabelled is the failure; labelled-with-no-expiry is how a
    // deferral becomes permanent, so the date is required, not decorative.
    const unexercised = rows.filter((r) => /never exercised|not exercised|asserted from code/i.test(r));
    expect(
      unexercised.length,
      "no row is marked asserted-from-code — either every claim is now probed (delete this " +
        "assertion deliberately) or the marking convention has drifted",
    ).toBeGreaterThan(0);
    for (const row of unexercised) {
      const cells = row.split("|").map((c) => c.trim());
      expect(
        /revisit trigger:\s*\d{4}-\d{2}-\d{2}/i.test(row),
        `row ${cells[1]} defers a claim with no dated revisit trigger`,
      ).toBe(true);
    }
  });

  describe("no public claim outruns its register row", () => {
    interface ClaimDetector {
      /** The public claim, named as a human would refer to it. */
      claim: string;
      /** How to find it on a public surface. */
      find: RegExp;
      /** The register row that must exist while the claim is public. */
      row: RegExp;
      /** Why an unregistered instance is a defect. */
      reason: string;
    }

    const DETECTORS: ClaimDetector[] = [
      {
        claim: "PR mode",
        find: /sync\.pr\.enabled/,
        row: /\bPR mode\b/i,
        reason:
          "E12/L30 — `sync.pr.enabled` is documented as functioning behaviour (cli-reference.md, " +
          "configuration.md) and has never been exercised against a real remote. Its third silent " +
          "deferral is what made this direction necessary.",
      },
    ];

    /** The surfaces a claim can be made on. Docs are read raw on GitHub too, so `docs/` is in full. */
    function claimSurface(): { path: string; text: string }[] {
      const out: { path: string; text: string }[] = [];
      const push = (abs: string) => {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          out.push({ path: path.relative(ROOT, abs), text: fs.readFileSync(abs, "utf-8") });
        }
      };
      const walk = (dir: string, re: RegExp) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === "_archive" || e.name === "node_modules") continue;
            walk(abs, re);
          } else if (re.test(e.name)) push(abs);
        }
      };
      walk(path.join(ROOT, "docs"), /\.mdx?$/);
      walk(path.join(ROOT, "website", "src", "pages"), /\.(mdx?|tsx)$/);
      push(path.join(ROOT, "README.md"));
      // The register itself describes the claims it registers; a row must not be
      // its own evidence that the claim is public.
      return out.filter((f) => path.resolve(ROOT, f.path) !== REGISTER);
    }

    /**
     * Pure, so the mechanism can be proven against injected inputs rather than
     * against whatever the corpus happens to say today. A resolver that can only
     * be run on the real tree is a resolver whose failure path is never executed.
     */
    function unregistered(
      corpus: { path: string; text: string }[],
      registerRows: string[],
      detectors: ClaimDetector[],
    ): { claim: string; sites: string[]; reason: string }[] {
      const out: { claim: string; sites: string[]; reason: string }[] = [];
      for (const d of detectors) {
        const sites: string[] = [];
        for (const f of corpus) {
          f.text.split("\n").forEach((line, i) => {
            if (d.find.test(line)) sites.push(`${f.path}:${i + 1}`);
          });
        }
        if (sites.length === 0) continue;
        if (registerRows.some((r) => d.row.test(r))) continue;
        out.push({ claim: d.claim, sites, reason: d.reason });
      }
      return out;
    }

    const SURFACE = claimSurface();

    it("the scan reaches the published surface — an empty corpus is a vacuous check", () => {
      expect(SURFACE.length).toBeGreaterThan(15);
      for (const anchor of [
        path.join("docs", "cli-reference.md"),
        path.join("docs", "configuration.md"),
        "README.md",
      ]) {
        expect(SURFACE.some((f) => f.path === anchor), `${anchor} dropped out of the scan`).toBe(true);
      }
    });

    it("every detector still finds the claim it was written for", () => {
      // A detector matching nothing is indistinguishable from a broken pattern.
      // If a claim is genuinely retired from every doc site, its detector is
      // deleted in the same change — deliberately, and visibly in review.
      for (const d of DETECTORS) {
        const found = SURFACE.some((f) => d.find.test(f.text));
        expect(found, `detector "${d.claim}" matches nothing — pattern drifted, or claim removed`).toBe(true);
      }
    });

    it("every claim found on a public surface has a row", () => {
      const missing = unregistered(SURFACE, rows, DETECTORS);
      expect(
        missing,
        missing.map((m) => `${m.claim} @ ${m.sites.join(", ")}\n  ${m.reason}`).join("\n"),
      ).toEqual([]);
    });

    it("the resolver can actually fail — proven on injected inputs, not on the tree", () => {
      const detector: ClaimDetector[] = [
        { claim: "X", find: /widget\.enabled/, row: /\bWidget\b/i, reason: "fixture" },
      ];
      const claimed = [{ path: "docs/fake.md", text: "set `widget.enabled` to turn it on" }];
      const silent = [{ path: "docs/fake.md", text: "nothing to see here" }];
      const withRow = ["| 1 | Widget does the thing | `tests/x.test.ts` | limits |"];
      const withoutRow = ["| 1 | Something else | `tests/x.test.ts` | limits |"];

      // claim public + no row → the finding, with its site named
      const found = unregistered(claimed, withoutRow, detector);
      expect(found.length).toBe(1);
      expect(found[0]!.sites).toEqual(["docs/fake.md:1"]);
      // claim public + row present → clean
      expect(unregistered(claimed, withRow, detector)).toEqual([]);
      // claim absent → clean regardless of the register
      expect(unregistered(silent, withoutRow, detector)).toEqual([]);
    });
  });
});
