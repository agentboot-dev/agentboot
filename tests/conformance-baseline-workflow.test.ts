/**
 * L43 — the conformance baseline has never archived anything, and its only
 * sink would have deleted the v1.0 snapshot ~90 days after the tag.
 *
 * Two separate defects sat behind one green-looking workflow file:
 *
 *  1. It has never run. GitHub fires `schedule` only from a workflow present on
 *     the DEFAULT branch, and this file is not on main —
 *     `gh run list --workflow=conformance-baseline.yml` returns 404. NOT FIXED
 *     HERE and not fixable here: landing it on main is a push, which belongs to
 *     the cut PR. This file therefore does not assert the workflow has run.
 *
 *  2. Its only sink was an Actions artifact with `retention-days: 90`. The
 *     stated rationale for the whole job is "a clock you cannot restart" — yet
 *     the record would expire three months after the tag, so the one question
 *     it exists to answer ("how did the platforms behave at 1.0?") becomes
 *     unanswerable at exactly the point someone asks. That half IS fixed: every
 *     snapshot is committed to the `conformance-baseline` data branch.
 *
 * The data-branch step is not string-matched, it is EXECUTED — against a real
 * local bare repo standing in for origin — because a shell block that pushes to
 * an orphan branch has several ways to be subtly wrong that reading it will not
 * reveal, and because the surrounding workflow is precisely a thing nobody has
 * ever run.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");
const WF = path.join(ROOT, ".github", "workflows", "conformance-baseline.yml");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: Step[] }>;
}

const wf = yaml.load(fs.readFileSync(WF, "utf-8")) as Workflow;
const steps = (): Step[] => wf.jobs?.["baseline"]?.steps ?? [];

/** The step that pushes the snapshot somewhere that does not expire. */
function durableStep(): Step {
  const s = steps().find((x) => typeof x.run === "string" && /git\s+push/.test(x.run));
  expect(
    s,
    "no step pushes the snapshot anywhere — the artifact is the only sink, and it expires",
  ).toBeTruthy();
  return s!;
}

const git = (args: string[], cwd: string) =>
  spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 60_000 });

describe("L43 — the baseline workflow is valid and has a durable sink", () => {
  it("parses as valid YAML with the job it claims", () => {
    expect(wf.jobs?.["baseline"], "baseline job missing").toBeTruthy();
    expect(steps().length).toBeGreaterThan(0);
  });

  it("can be triggered by hand, since schedule cannot fire until it is on main", () => {
    expect(
      Object.keys(wf.on ?? {}),
      "without workflow_dispatch there is no way to bank a snapshot before the cut lands",
    ).toContain("workflow_dispatch");
  });

  it("grants contents: write, without which the snapshot cannot be committed", () => {
    expect(wf.permissions?.["contents"]).toBe("write");
  });

  it("does not rely on artifact retention as the record", () => {
    const upload = steps().find((s) => (s.uses ?? "").startsWith("actions/upload-artifact"));
    // Keeping the upload is fine — it is convenient short-term access. What is
    // not fine is it being the ONLY place the snapshot lands.
    expect(upload, "precondition: the artifact upload is still present").toBeTruthy();
    expect(
      String(upload!.with?.["retention-days"]),
      "precondition: the artifact still expires, which is why a durable sink is required",
    ).toBe("90");
    expect(durableStep().run).toMatch(/git\s+push/);
  });
});

describe("L43 — the data-branch step, EXECUTED against a real origin", () => {
  let origin = "";
  let work = "";
  let script = "";
  /**
   * The step's own `env:` block. Taken from the YAML rather than hardcoded —
   * the script runs under `set -u`, so a variable declared there and not
   * supplied here dies with "unbound variable" (which is how the first draft of
   * this test failed, and the reason it executes the step instead of reading
   * it).
   */
  let stepEnv: Record<string, string> = {};

  const runStep = (cwd: string, runId: string) => {
    const file = path.join(cwd, "__baseline-step.sh");
    fs.writeFileSync(file, script, "utf-8");
    const summary = path.join(cwd, "__summary.md");
    fs.writeFileSync(summary, "", "utf-8");
    const r = spawnSync("bash", [file], {
      cwd,
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env, ...stepEnv, GITHUB_RUN_ID: runId, GITHUB_STEP_SUMMARY: summary },
    });
    fs.rmSync(file, { force: true });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  /** Write a snapshot the way `agentboot baseline` does — timestamped filename. */
  const writeSnapshot = (cwd: string, stamp: string) => {
    const dir = path.join(cwd, ".agentboot", "baseline");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `conformance-${stamp}.json`),
      JSON.stringify({ schema: 1, capturedAt: stamp, observedProbes: 3, platforms: {} }, null, 2),
      "utf-8",
    );
  };

  beforeAll(() => {
    const step = durableStep();
    script = String(step.run);
    stepEnv = step.env ?? {};
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l43-"));
    origin = path.join(base, "origin.git");
    work = path.join(base, "work");
    fs.mkdirSync(origin, { recursive: true });
    git(["init", "--bare", "-b", "main"], origin);
    fs.mkdirSync(work, { recursive: true });
    git(["init", "-b", "main"], work);
    git(["config", "user.email", "t@example.invalid"], work);
    git(["config", "user.name", "t"], work);
    fs.writeFileSync(path.join(work, "README.md"), "# source\n", "utf-8");
    git(["add", "-A"], work);
    git(["commit", "-m", "source"], work);
    git(["remote", "add", "origin", origin], work);
    git(["push", "-u", "origin", "main"], work);
  });

  it("creates the orphan data branch on the first run and lands the snapshot", () => {
    writeSnapshot(work, "2026-08-11T00-00-00Z");
    const r = runStep(work, "1001");
    expect(r.status, `the data-branch step failed:\n${r.out}`).toBe(0);

    const files = git(["ls-tree", "-r", "--name-only", "conformance-baseline"], origin).stdout;
    expect(files).toContain("snapshots/conformance-2026-08-11T00-00-00Z.json");
    expect(files, "the archive should explain itself to whoever finds it").toContain("README.md");
    // Orphan: the data branch must not carry the source history.
    expect(files, "the data branch forked the source tree instead of standing alone")
      .not.toMatch(/^README\.md\n?$[\s\S]*source/);
    const log = git(["rev-list", "--count", "conformance-baseline"], origin).stdout.trim();
    expect(log, "an orphan branch starts at exactly one commit").toBe("1");
  });

  it("APPENDS on a later run instead of replacing the series", () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l43-run2-"));
    git(["clone", origin, second], path.dirname(second));
    const clone = path.join(path.dirname(second), path.basename(second));
    git(["config", "user.email", "t@example.invalid"], clone);
    git(["config", "user.name", "t"], clone);
    writeSnapshot(clone, "2026-08-18T00-00-00Z");
    const r = runStep(clone, "1002");
    expect(r.status, `the second run failed:\n${r.out}`).toBe(0);

    const files = git(["ls-tree", "-r", "--name-only", "conformance-baseline"], origin).stdout;
    expect(
      files,
      "the earlier snapshot was dropped — the series' value is its length, so losing history is the defect",
    ).toContain("snapshots/conformance-2026-08-11T00-00-00Z.json");
    expect(files).toContain("snapshots/conformance-2026-08-18T00-00-00Z.json");
  });

  /**
   * Silence Is Not Success. A run that banks nothing must not report success —
   * snapshot filenames are timestamped, so "nothing staged" means the archive
   * step produced no new file and the clock did not advance.
   */
  it("FAILS rather than reporting success when there is no new snapshot", () => {
    const third = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l43-run3-"));
    git(["clone", origin, third], path.dirname(third));
    const clone = path.join(path.dirname(third), path.basename(third));
    git(["config", "user.email", "t@example.invalid"], clone);
    git(["config", "user.name", "t"], clone);
    // Re-present a snapshot that is already on the branch: nothing new to stage.
    writeSnapshot(clone, "2026-08-18T00-00-00Z");
    const r = runStep(clone, "1003");
    expect(r.status, `a run that banked nothing exited 0:\n${r.out}`).not.toBe(0);
    expect(r.out).toContain("the clock did not advance");
  });
});
