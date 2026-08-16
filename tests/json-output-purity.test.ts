/**
 * `--format json` means stdout is a PAYLOAD, not a transcript.
 *
 * `drift-check` writes two gate notices before it writes its report: the
 * ungated-dist announcement (NF4-4 — "I did NOT verify hub build freshness")
 * and the never-built-dist warning. Both went to stdout unconditionally, so
 * every `agentboot drift-check --format json` handed its caller a yellow
 * sentence and then the JSON, and every `JSON.parse` on the other end threw.
 *
 * The greenness was wrong as well as the behaviour, and in a way particular to
 * this product. The notices exist BECAUSE a silent skip reads as a pass — they
 * are the honest third answer between "verified" and "refused". Emitting them
 * where they break the parse guarantees the downstream repair is `| tail -n +2`
 * or a swallowed parse error, and both of those delete the notice. A gate that
 * correctly announces it checked nothing, into a stream nobody can read, has
 * announced nothing.
 *
 * The `--repo` path with no manifest was the sharper case: it printed a text
 * line and NO json at all, then exited 2. To a machine consumer an empty stdout
 * plus a non-zero exit is indistinguishable from a crash — the report's own
 * `manifestFound: false` is the vocabulary for "not checked" and it was being
 * withheld exactly when it mattered.
 *
 * Every assertion below parses real captured stdout. A test that greps stdout
 * for the absence of a known string would pass on any stdout that merely used
 * different wording; `JSON.parse` cannot be fooled that way.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

function run(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("drift-check --format json emits parseable JSON on stdout", () => {
  let base = "";
  let spoke = "";

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-jsonpurity-"));
    spoke = path.join(base, "spoke");
    // A bare directory with no hub config in reach and no manifest: this is the
    // exact shape that triggers BOTH notices.
    fs.mkdirSync(path.join(spoke, ".git"), { recursive: true });
  });

  afterAll(() => {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it("the fixture really does trigger the notice (else every case below is vacuous)", () => {
    const r = run(["drift-check", "--repo", spoke, "--format", "json"], spoke);
    expect(
      `${r.stdout}${r.stderr}`,
      "The ungated-dist notice did not fire at all, so this file would pass with " +
      "the defect fully present. Fix the fixture, not the assertion.",
    ).toContain("did NOT verify hub build freshness");
  });

  it("stdout parses as JSON, with the notices on stderr", () => {
    const r = run(["drift-check", "--repo", spoke, "--format", "json"], spoke);

    const parsed = JSON.parse(r.stdout);
    expect(parsed).toBeTypeOf("object");
    // The payload carries "not checked" in its own vocabulary — the reason the
    // text line existed is not lost by moving it off stdout.
    expect(parsed.manifestFound).toBe(false);

    expect(r.stderr).toContain("did NOT verify hub build freshness");
    expect(r.stderr).toContain("No AgentBoot manifest found");
  });

  it("text mode still prints its notices on stdout for a human", () => {
    // The fix must not be "silence the notice". A human running the command
    // without --format json must still see the gate say what it skipped.
    const r = run(["drift-check", "--repo", spoke], spoke);
    expect(r.stdout).toContain("did NOT verify hub build freshness");
  });

  it("exit status is unchanged — 2 for an unchecked repo", () => {
    // Making stdout parseable must not quietly turn "not checked" into success.
    expect(run(["drift-check", "--repo", spoke, "--format", "json"], spoke).status).toBe(2);
  });
});

describe("drift-check --format json over a hub with no registered repos", () => {
  let hub = "";

  beforeAll(() => {
    hub = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-jsonpurity-hub-"));
    fs.writeFileSync(
      path.join(hub, "agentboot.config.json"),
      JSON.stringify({ org: "test", personas: { enabled: [] }, traits: { enabled: [] } }, null, 2),
    );
    fs.writeFileSync(path.join(hub, "repos.json"), "[]");
  });

  afterAll(() => {
    if (hub) fs.rmSync(hub, { recursive: true, force: true });
  });

  it("stdout parses and reports zero repos checked", () => {
    const r = run(["drift-check", "--format", "json"], hub);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.totalRepos).toBe(0);
    expect(r.stderr).toContain("nothing was checked");
  });
});
