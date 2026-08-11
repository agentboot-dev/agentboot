/**
 * `audit` must tell ABSENT and BROKEN apart.
 *
 * `findDeadGotchas` read the hub config and the repo registry inside one `try`
 * with an empty `catch` commented "no repos.json — handled below". Every
 * failure mode therefore collapsed onto the same `repos = []`, and "handled
 * below" emitted the *info*-severity line
 *
 *     N gotcha(s) present but no locally-available registered repos … skipped
 *
 * byte-identically for a hub with no repos.json, a hub whose repos.json had a
 * trailing comma, and a hub whose agentboot.config.json would not parse. A
 * corrupt registry read exactly like an unconfigured one, at `info`, exit 0 —
 * the standing "silence is not success" class: the check could not run, and
 * reported that nothing needed doing.
 *
 * These tests pin the DISTINCTION, not merely the presence of a message: for
 * each broken input they assert an `error`-severity `unparseable-input`
 * finding AND assert the absent-state wording is not what came back, because
 * the defect was two states producing one string. The absent case is asserted
 * too — an "always report unparseable" regression would pass otherwise.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAudit, type AuditFinding } from "../scripts/lib/audit.js";

/** The exact wording of the legitimate ABSENT state, which must stay quiet. */
const ABSENT_STATE_PHRASE = "no locally-available registered repos";

/**
 * A hub with one path-scoped gotcha — enough for findDeadGotchas to need the
 * repo registry, which is the code path under test.
 */
function mkGotchaHub(opts: {
  config?: string | null;
  repos?: string | null;
}): string {
  const hub = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-audit-inputs-")));
  fs.mkdirSync(path.join(hub, "core", "gotchas"), { recursive: true });
  fs.writeFileSync(
    path.join(hub, "core", "gotchas", "no-raw-sql.md"),
    '---\npaths: ["src/**"]\n---\n\nDo not hand-roll SQL in the service layer.\n'
  );
  const config = opts.config === undefined ? JSON.stringify({ org: "test-org" }) : opts.config;
  if (config !== null) fs.writeFileSync(path.join(hub, "agentboot.config.json"), config);
  if (opts.repos != null) fs.writeFileSync(path.join(hub, "repos.json"), opts.repos);
  return hub;
}

function auditWith(opts: { config?: string | null; repos?: string | null }): AuditFinding[] {
  const hub = mkGotchaHub(opts);
  try {
    return runAudit(hub).findings;
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
  }
}

describe("audit — unreadable inputs are reported, not swallowed", () => {
  it("a hub with no repos.json stays the quiet ABSENT state (info, no error)", () => {
    const findings = auditWith({ repos: null });
    expect(findings.some((f) => f.type === "unparseable-input")).toBe(false);
    const skipped = findings.find((f) => f.message.includes(ABSENT_STATE_PHRASE));
    expect(skipped, "the absent state should still be reported at info").toBeDefined();
    expect(skipped!.severity).toBe("info");
  });

  // The three broken inputs. Each must be an ERROR, must name the file it
  // could not read, and must NOT be dressed as the absent state.
  const brokenInputs: [label: string, opts: { config?: string | null; repos?: string | null }, file: string][] = [
    ["repos.json is not valid JSON", { repos: '[{"path": "/tmp/x",}]' }, "repos.json"],
    [
      "repos.json parses but is not an array",
      { repos: '{"repos": [{"path": "/tmp/x"}]}' },
      "repos.json",
    ],
    ["agentboot.config.json is not valid JSON", { config: '{"org": "acme",}' }, "agentboot.config.json"],
  ];

  for (const [label, opts, file] of brokenInputs) {
    it(`${label} → an error-severity finding naming the file, distinct from ABSENT`, () => {
      const findings = auditWith(opts);

      const broken = findings.filter((f) => f.type === "unparseable-input");
      expect(broken, `${label} produced no unparseable-input finding`).toHaveLength(1);
      expect(broken[0]!.severity, "an input the audit cannot read is a failure, not a note").toBe(
        "error"
      );
      expect(broken[0]!.file).toContain(file);

      // The whole defect: this state used to be indistinguishable from having
      // no registered repos. It must no longer borrow that wording.
      expect(
        findings.some((f) => f.message.includes(ABSENT_STATE_PHRASE)),
        "a broken input must not be reported as the absent state"
      ).toBe(false);

      // `audit` exits non-zero on errors, so this is also the exit-code pin.
      const errors = findings.filter((f) => f.severity === "error").length;
      expect(errors, "audit must exit non-zero on an input it could not read").toBeGreaterThan(0);
    });
  }

  it("a repos.json that parses to an array is consumed without throwing", () => {
    // Regression pin for the crash half: the `.map` over the registry sat
    // outside the old try, so a non-array escaped as an uncaught
    // "repos.map is not a function" while a parse error was swallowed —
    // the same statement failing loudly or silently depending only on how it
    // was malformed. Both are handled now; this is the still-works control.
    const findings = auditWith({ repos: JSON.stringify([{ path: "./no-such-repo" }]) });
    expect(findings.some((f) => f.type === "unparseable-input")).toBe(false);
    expect(findings.some((f) => f.message.includes(ABSENT_STATE_PHRASE))).toBe(true);
  });
});

describe("audit — stale-ADR is accepted in writing, not silently absent", () => {
  // E9 permits acceptance; what it does not permit is silence. The acceptance
  // must therefore be discoverable at the union a reader consults to answer
  // "what does audit check?", and it must name a revisit trigger — an
  // acceptance with no expiry condition is a permanent quiet drop.
  const auditSrc = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "lib", "audit.ts"),
    "utf-8"
  );

  it("still ships no stale-adr finding type (the acceptance is honest about the gap)", () => {
    expect(auditSrc).not.toContain('"stale-adr"');
  });

  it("carries a dated accept-with-reason naming a revisit trigger", () => {
    expect(auditSrc).toMatch(/stale-ADR detection \(\d{4}-\d{2}-\d{2}\)/);
    expect(auditSrc).toContain("REVISIT TRIGGER:");
  });

  it("the docs it leans on still say ADRs are unshipped, so the reason holds", () => {
    // If ADR governance ever ships, this fails and the acceptance expires —
    // which is the revisit trigger firing mechanically rather than by memory.
    const glossary = fs.readFileSync(
      path.join(__dirname, "..", "docs", "glossary.md"),
      "utf-8"
    );
    expect(glossary).toMatch(/ADR \(Architecture Decision Record\)[\s\S]{0,200}not yet shipped/);
  });
});
