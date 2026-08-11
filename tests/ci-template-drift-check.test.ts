/**
 * L44 — the shipped CI gate template could not run where its own header tells
 * you to install it.
 *
 * `templates/ci/drift-check.yml` is packed into the npm tarball (package.json
 * `files` includes `templates/`) and its header says "Copy this file to
 * .github/workflows/agentboot-compliance.yml in your repo" — i.e. into a
 * SPOKE. It ran `drift-check --format json` with no `--repo`, which takes the
 * command's HUB branch, looks for agentboot.config.json in the checkout, and
 * exits 1 with:
 *
 *     ✗ No agentboot.config.json found — `drift-check` needs a hub.
 *
 * before comparing a single file. Reproduced verbatim against a spoke fixture.
 * So the gate never checked drift anywhere it was installed, and the natural
 * operator response — mark the step `continue-on-error` to get past the red —
 * converts it into a permanently green gate measuring nothing. That is this
 * product's signature defect class, shipped in the artifact that is supposed to
 * enforce against it.
 *
 * WHY THIS TEST IS THE POINT OF THE ROW: the template shipped broken because
 * nothing ever ran it. Asserting the file merely CONTAINS "--repo ." would
 * reproduce that same mistake one level up — a string check that cannot tell a
 * working command from a plausible-looking one. So this test extracts the
 * template's `run:` block, substitutes only the `npx agentboot@<version>`
 * launcher for this checkout's CLI, and EXECUTES it — including its exit-code
 * `case` — against three real fixtures: synced-clean, drifted, and unsynced.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE = path.join(ROOT, "templates", "ci", "drift-check.yml");
const CLI = path.join(ROOT, "bin", "agentboot.js");

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/**
 * Pull the `run:` script out of the template's drift-check step.
 *
 * Deliberately structural rather than a hardcoded copy: if someone rewrites the
 * step, this test runs the REWRITE, not a stale duplicate of it. Two copies of
 * a command that must agree will drift — that is the standing norm this repo
 * already applies to its pinning invariant.
 */
function templateRunScript(): string {
  const yaml = fs.readFileSync(TEMPLATE, "utf-8");
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^\s*run:\s*\|\s*$/.test(l));
  expect(start, "templates/ci/drift-check.yml has no block `run: |` step").toBeGreaterThan(-1);
  const indent = (lines[start]!.match(/^\s*/) ?? [""])[0].length;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() !== "" && (line.match(/^\s*/) ?? [""])[0].length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  const script = body.join("\n");
  expect(script, "the template's run: block does not invoke drift-check").toContain("drift-check");
  return script;
}

/**
 * The template's own command line, with ONLY the launcher swapped.
 *
 * `npx agentboot@v0.20.2` fetches the last PUBLISHED tarball from the registry,
 * which would make this test assert the behaviour of an already-released
 * version rather than of this checkout — green here, broken on merge. Every
 * other token, including `--repo .`, `--format json` and the whole exit-code
 * `case`, is executed exactly as adopters receive it.
 */
function runnableScript(): string {
  const script = templateRunScript();
  const swapped = script.replace(
    /npx\s+agentboot@\S+/g,
    `"${process.execPath}" "${CLI}"`,
  );
  expect(swapped, "launcher substitution did not fire — the npx form would test the published tarball, not this checkout")
    .not.toContain("npx agentboot@");
  return swapped;
}

function runTemplate(cwd: string): { status: number; out: string } {
  const file = path.join(cwd, "__ab-template-step.sh");
  fs.writeFileSync(file, runnableScript(), "utf-8");
  const r = spawnSync("bash", [file], {
    cwd,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  fs.rmSync(file, { force: true });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A spoke with one managed file whose hash matches its manifest entry. */
function syncedSpoke(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l44-synced-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const managedRel = path.join(".claude", "CLAUDE.md");
  const body = "# Managed by AgentBoot\n\nDo not edit by hand.\n";
  fs.writeFileSync(path.join(dir, managedRel), body, "utf-8");
  fs.writeFileSync(
    path.join(dir, ".claude", ".agentboot-manifest.json"),
    JSON.stringify(
      {
        managed_by: "agentboot",
        version: "0.20.2",
        synced_at: new Date().toISOString(),
        // POSIX separators: the manifest is a cross-platform artifact and
        // checkDrift joins these onto the repo path.
        files: [{ path: managedRel.split(path.sep).join("/"), hash: sha256(body) }],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return dir;
}

describe("L44 — the shipped drift-check CI template actually runs in a spoke", () => {
  let synced = "";
  let drifted = "";
  let unsynced = "";

  beforeAll(() => {
    synced = syncedSpoke();
    drifted = syncedSpoke();
    fs.writeFileSync(
      path.join(drifted, ".claude", "CLAUDE.md"),
      "# Managed by AgentBoot\n\nsomeone edited this by hand\n",
      "utf-8",
    );
    unsynced = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l44-unsynced-"));
    fs.mkdirSync(path.join(unsynced, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(unsynced, ".claude", "CLAUDE.md"), "# not synced\n", "utf-8");
  });

  afterAll(() => {
    for (const d of [synced, drifted, unsynced]) {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("the template passes --repo, without which it cannot check anything in a spoke", () => {
    const script = templateRunScript();
    expect(
      /drift-check[^\n]*--repo\s+\./.test(script),
      "the template invokes drift-check without `--repo .`, which is the hub-only form: " +
        "in a spoke it exits 1 at the config loader having compared nothing",
    ).toBe(true);
  });

  it("EXECUTED against a synced spoke, the template's own step exits 0", () => {
    const r = runTemplate(synced);
    expect(
      r.status,
      `the shipped template failed on a correctly-synced spoke.\n${r.out}`,
    ).toBe(0);
    // The specific regression: the hub-config loader must never be reached.
    expect(r.out).not.toContain("needs a hub");
    expect(r.out).toContain("::notice::");
  });

  it("EXECUTED against a synced spoke, it still emits the JSON report it promises", () => {
    const r = runTemplate(synced);
    // `--format json` writes a report object to stdout. Locate it structurally
    // rather than JSON.parse-ing the whole stream, because drift-check also
    // prints a human freshness notice to stdout ahead of it (quarantined
    // separately — the template reads exit codes, so it is unaffected).
    const brace = r.out.indexOf("{");
    expect(brace, `no JSON report in the template's output:\n${r.out}`).toBeGreaterThan(-1);
    const report = JSON.parse(r.out.slice(brace, r.out.lastIndexOf("}") + 1)) as {
      manifestFound: boolean;
      clean: boolean;
      summary: { cleanCount: number };
    };
    expect(report.manifestFound, "the fixture's manifest was not even found").toBe(true);
    expect(report.clean).toBe(true);
    expect(
      report.summary.cleanCount,
      "the report is 'clean' because it compared ZERO files — a pass over an empty check",
    ).toBeGreaterThan(0);
  });

  it("EXECUTED against a DRIFTED spoke, the template fails the job", () => {
    const r = runTemplate(drifted);
    expect(r.status, `hand-edited managed file did not fail the gate.\n${r.out}`).toBe(1);
    expect(r.out).toContain("::error::");
    expect(r.out.toLowerCase()).toContain("drift");
  });

  /**
   * The stated posture for exit 2. "No manifest" means nothing was compared,
   * which is UNCHECKED — the state the whole report exists to distinguish from
   * clean — so it fails rather than passing quietly.
   */
  it("EXECUTED against an UNSYNCED spoke (exit 2), the template fails rather than passing quietly", () => {
    const r = runTemplate(unsynced);
    expect(
      r.status,
      `a repo with no manifest was let through — nothing was checked.\n${r.out}`,
    ).toBe(1);
    expect(r.out).toContain("::error::");
    expect(r.out).toMatch(/NOTHING was checked|no agentboot manifest/i);
  });

  it("the template maps an UNKNOWN exit code to failure, not to success", () => {
    const script = templateRunScript();
    expect(
      /\*\)[\s\S]*exit 1/.test(script),
      "the exit-code case has no catch-all, so an unrecognised exit falls through as a pass",
    ).toBe(true);
  });
});
