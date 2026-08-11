/**
 * L39 — the CI AgentBoot ships to adopters had no Windows leg, and no way to
 * ask for one.
 *
 * Two files are adopter-facing CI surfaces:
 *
 *   .github/workflows/agentboot-ci.yml  — the reusable workflow adopters
 *                                         `uses:` from their own repos
 *   templates/ci/drift-check.yml        — packed into the npm tarball
 *                                         (package.json `files` has templates/)
 *                                         and copied into adopter repos
 *
 * Both hardcoded `runs-on: ubuntu-latest` with no `os` input. A team whose
 * developers work on Windows therefore validated their governance artifacts
 * exclusively on a platform none of them run — and could not change that
 * without forking the workflow we ship them.
 *
 * The shell default is part of the same defect and is why a naive fix does not
 * work: both files contain `run:` blocks written in bash (`$( )`, `||`,
 * `2>/dev/null`, `case`, `$?`). GitHub defaults `run:` to PowerShell on Windows
 * runners, so simply adding `windows-latest` produces a red leg for syntax
 * reasons that say nothing about the repo under test — an adopter would
 * reasonably conclude Windows is unsupported and remove the leg. Asserting the
 * `os` input without asserting the shell would ship exactly that trap.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..");
const REUSABLE = path.join(ROOT, ".github", "workflows", "agentboot-ci.yml");
const TEMPLATE = path.join(ROOT, "templates", "ci", "drift-check.yml");

interface Job {
  "runs-on"?: unknown;
  strategy?: { matrix?: Record<string, unknown>; "fail-fast"?: boolean };
  defaults?: { run?: { shell?: string } };
  steps?: Array<Record<string, unknown>>;
}
interface Workflow {
  on?: { workflow_call?: { inputs?: Record<string, { default?: unknown; type?: string }> } };
  jobs?: Record<string, Job>;
}

const load = (p: string): Workflow => yaml.load(fs.readFileSync(p, "utf-8")) as Workflow;

/** Every `run:` script in a job, so the shell claim can be checked against real syntax. */
function runScripts(job: Job): string[] {
  return (job.steps ?? [])
    .map((s) => s["run"])
    .filter((r): r is string => typeof r === "string");
}

const BASH_ONLY = /\$\(|\|\||2>\/dev\/null|\bcase\b|\$\?/;

describe("L39 — the reusable workflow accepts an os matrix", () => {
  const wf = load(REUSABLE);
  const job = wf.jobs?.["validate-and-build"];

  it("parses as valid YAML and still has its job", () => {
    expect(job, "validate-and-build job missing from the reusable workflow").toBeTruthy();
  });

  it("declares an `os` workflow_call input defaulting to ubuntu-latest", () => {
    const input = wf.on?.workflow_call?.inputs?.["os"];
    expect(input, "no `os` input — adopters cannot ask for any runner but Linux").toBeTruthy();
    // workflow_call inputs cannot be arrays, so the array arrives as a JSON string.
    expect(input!.type).toBe("string");
    const parsed = JSON.parse(String(input!.default)) as string[];
    expect(parsed, "the default must stay Linux-only so existing adopters see no change")
      .toEqual(["ubuntu-latest"]);
  });

  it("expands that input into the matrix and runs on it", () => {
    expect(job!.strategy?.matrix?.["os"]).toBe("${{ fromJSON(inputs.os) }}");
    expect(
      job!["runs-on"],
      "runs-on is not driven by the matrix, so the os input would be inert",
    ).toBe("${{ matrix.os }}");
  });

  it("does not fail-fast, so one platform's result cannot hide another's", () => {
    expect(job!.strategy?.["fail-fast"]).toBe(false);
  });

  it("pins bash, because its run: blocks are bash and Windows defaults to PowerShell", () => {
    const bashy = runScripts(job!).filter((s) => BASH_ONLY.test(s));
    expect(
      bashy.length,
      "no bash-only syntax found — if that is now true, this assertion needs re-deriving, not deleting",
    ).toBeGreaterThan(0);
    expect(
      job!.defaults?.run?.shell,
      "a Windows leg would run these bash scripts under PowerShell and fail for the wrong reason",
    ).toBe("bash");
  });
});

describe("L39 — the shipped drift-check template accepts an os matrix", () => {
  const wf = load(TEMPLATE);
  const job = wf.jobs?.["compliance"];

  it("parses as valid YAML and still has its job", () => {
    expect(job, "compliance job missing from the shipped template").toBeTruthy();
  });

  it("runs on a matrix defaulting to ubuntu-latest, not a hardcoded runner", () => {
    const os = job!.strategy?.matrix?.["os"];
    expect(os, "no os matrix — a Windows adopter cannot get a Windows leg").toBeTruthy();
    expect(os).toEqual(["ubuntu-latest"]);
    expect(job!["runs-on"]).toBe("${{ matrix.os }}");
    expect(job!.strategy?.["fail-fast"]).toBe(false);
  });

  it("pins bash, because the drift-check step is a bash script", () => {
    const bashy = runScripts(job!).filter((s) => BASH_ONLY.test(s));
    expect(bashy.length, "the drift-check step is no longer a shell script — re-derive this").toBeGreaterThan(0);
    expect(
      job!.defaults?.run?.shell,
      "adding windows-latest would run the exit-code `case` under PowerShell",
    ).toBe("bash");
  });
});

describe("L39 — neither adopter-facing CI surface hardcodes its runner", () => {
  for (const [label, file] of [["reusable workflow", REUSABLE], ["shipped template", TEMPLATE]] as const) {
    it(`${label} has no literal 'runs-on: ubuntu-latest'`, () => {
      const text = fs.readFileSync(file, "utf-8");
      const literal = text
        .split("\n")
        .filter((l) => /^\s*runs-on:\s*ubuntu-latest\s*$/.test(l));
      expect(
        literal,
        "a hardcoded runner here is the L39 defect returning: the adopter has no way to add a platform",
      ).toEqual([]);
    });
  }
});
