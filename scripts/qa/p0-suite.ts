/**
 * P0 release-gate suite — the scripted half of the manual QA plan.
 *
 *   npx tsx scripts/qa/p0-suite.ts              run every scripted case
 *   npx tsx scripts/qa/p0-suite.ts --only TP-04 run a prefix-matched subset
 *   npx tsx scripts/qa/p0-suite.ts --prove      run, then prove the cases can fail
 *   npx tsx scripts/qa/p0-suite.ts --keep       leave the sandbox on disk
 *   npx tsx scripts/qa/p0-suite.ts --json <p>   also write a machine-readable report
 *   npx tsx scripts/qa/p0-suite.ts --fail-on-known-defects
 *
 * Exit codes
 *   0  every case behaved as registered
 *   1  a case failed, or a known-defect case unexpectedly PASSED (XPASS —
 *      the register is stale and must be corrected before it misleads anyone)
 *   2  the harness itself could not run
 *
 * What this does NOT cover is in docs/manual-testing/p0-manual-residue.md.
 * The count printed at the end of every run is the honest split; read it
 * rather than assuming a green run means the P0 subset is fully measured.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AssertionError, makeSandbox, type Sandbox } from "./harness.js";
import { CASES, DIVERGENCES, KNOWN_DEFECTS, MUTATIONS, type Case } from "./p0-cases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

type Status = "PASS" | "FAIL" | "XFAIL" | "XPASS";

interface CaseResult {
  id: string;
  title: string;
  status: Status;
  evidence: string;
  ms: number;
}

interface Args {
  only: string[];
  prove: boolean;
  keep: boolean;
  json: string | null;
  failOnKnownDefects: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { only: [], prove: false, keep: false, json: null, failOnKnownDefects: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--only") args.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--prove") args.prove = true;
    else if (a === "--keep") args.keep = true;
    else if (a === "--json") args.json = argv[++i] ?? null;
    else if (a === "--fail-on-known-defects") args.failOnKnownDefects = true;
    else if (a === "-h" || a === "--help") {
      console.log(fs.readFileSync(path.join(__dirname, "README.md"), "utf-8"));
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function selected(args: Args): Case[] {
  if (args.only.length === 0) return CASES;
  // Prefix matching stops at a segment boundary: `--only TP-04-1` must select
  // TP-04-1 alone, not TP-04-10 through TP-04-15.
  return CASES.filter((c) => args.only.some((p) => c.id === p || c.id.startsWith(`${p}-`)));
}

function runCase(c: Case, sb: Sandbox): CaseResult {
  const started = Date.now();
  const isKnownDefect = c.id in KNOWN_DEFECTS;
  try {
    const evidence = c.fn(sb);
    return {
      id: c.id,
      title: c.title,
      status: isKnownDefect ? "XPASS" : "PASS",
      evidence: isKnownDefect
        ? `register says this should fail, but it passed — remove the KNOWN_DEFECTS entry. ${evidence}`
        : evidence,
      ms: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof AssertionError ? e.message : `${(e as Error).stack ?? String(e)}`;
    return {
      id: c.id,
      title: c.title,
      status: isKnownDefect ? "XFAIL" : "FAIL",
      evidence: msg,
      ms: Date.now() - started,
    };
  }
}

const ICON: Record<Status, string> = {
  PASS: "✓",
  FAIL: "✗",
  XFAIL: "!",
  XPASS: "?",
};

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const cases = selected(args);
  if (cases.length === 0) {
    console.error(`--only ${args.only.join(",")} matched no cases`);
    return 2;
  }

  console.log("AgentBoot — P0 QA suite");
  console.log(`  repo:  ${REPO_ROOT}`);

  let sb: Sandbox;
  try {
    sb = makeSandbox(REPO_ROOT);
  } catch (e) {
    console.error(`could not build the sandbox: ${(e as Error).message}`);
    return 2;
  }
  console.log(`  sandbox: ${sb.root}`);
  console.log(`  cases: ${cases.length} of ${CASES.length}\n`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = runCase(c, sb);
    results.push(r);
    const line = `  ${ICON[r.status]} ${r.id.padEnd(11)} ${c.title}`;
    console.log(`${line} (${r.ms}ms)`);
    if (r.status === "PASS") {
      console.log(`      ${r.evidence}`);
    } else {
      for (const l of r.evidence.split("\n")) console.log(`      ${l}`);
    }
  }

  // --- negative controls -------------------------------------------------
  interface ProofResult {
    caseId: string;
    describe: string;
    wentRed: boolean;
    detail: string;
  }
  const proofs: ProofResult[] = [];
  if (args.prove) {
    console.log("\nNegative controls — each mutation must turn its case RED");
    const byId = new Map(CASES.map((c) => [c.id, c]));
    for (const m of MUTATIONS) {
      if (!cases.some((c) => c.id === m.caseId)) continue;
      const target = byId.get(m.caseId);
      if (!target) {
        proofs.push({
          caseId: m.caseId,
          describe: m.describe,
          wentRed: false,
          detail: "mutation names a case that does not exist",
        });
        continue;
      }
      let restore: (() => void) | null = null;
      let wentRed = false;
      let detail = "";
      try {
        restore = m.apply(sb);
        const r = runCase(target, sb);
        wentRed = r.status === "FAIL" || r.status === "XFAIL";
        detail = wentRed ? r.evidence.split("\n")[0]! : "case still PASSED under mutation";
      } catch (e) {
        detail = `mutation could not be applied: ${(e as Error).message}`;
      } finally {
        if (restore) restore();
      }
      proofs.push({ caseId: m.caseId, describe: m.describe, wentRed, detail });
      console.log(
        `  ${wentRed ? "✓" : "✗"} ${m.caseId.padEnd(11)} ${m.describe}\n      ${detail.slice(0, 160)}`
      );
    }

    // Re-run the mutated cases to confirm the sandbox was restored — a
    // negative control that leaves damage behind poisons every later run.
    const touched = [...new Set(proofs.map((p) => p.caseId))];
    for (const id of touched) {
      const target = byId.get(id);
      if (!target) continue;
      const r = runCase(target, sb);
      if (r.status === "FAIL") {
        console.log(`  ✗ ${id.padEnd(11)} did NOT recover after its mutation was reverted`);
        proofs.push({
          caseId: id,
          describe: "restore after mutation",
          wentRed: false,
          detail: "case stayed red after restore",
        });
      }
    }
  }

  // --- summary -----------------------------------------------------------
  const failed = results.filter((r) => r.status === "FAIL");
  const xpass = results.filter((r) => r.status === "XPASS");
  const xfail = results.filter((r) => r.status === "XFAIL");
  const passed = results.filter((r) => r.status === "PASS");

  console.log("\n" + "-".repeat(72));
  console.log(
    `Cases: ${results.length}   passed ${passed.length}   failed ${failed.length}   ` +
      `known-defect ${xfail.length}   unexpected-pass ${xpass.length}`
  );

  const divergent = results.filter((r) => r.id in DIVERGENCES);
  if (divergent.length > 0) {
    console.log(
      `\nPLAN DIVERGENCES (${divergent.length}) — the written plan is stale; these cases assert current behaviour:`
    );
    for (const r of divergent) {
      const d = DIVERGENCES[r.id]!;
      console.log(`  ${r.id}  plan: ${d.plan}`);
      console.log(`            now:  ${d.current}`);
      console.log(`            why:  ${d.evidence}`);
    }
  }

  if (xfail.length > 0) {
    console.log(`\nKNOWN DEFECTS (${xfail.length}) — asserted against the product's own docs and still failing:`);
    for (const r of xfail) {
      const k = KNOWN_DEFECTS[r.id]!;
      console.log(`  ${r.id}  documented: ${k.documented}`);
      console.log(`            observed:   ${k.observed}`);
      console.log(`            cause:      ${k.why}`);
    }
    console.log("  These are NOT green. They are accepted-and-named, which is not the same thing.");
  }

  if (failed.length > 0) {
    console.log(`\nFAILURES (${failed.length}):`);
    for (const r of failed) console.log(`  ${r.id}  ${r.title}`);
  }
  if (xpass.length > 0) {
    console.log(`\nSTALE REGISTER (${xpass.length}) — a known defect now passes; delete its KNOWN_DEFECTS entry:`);
    for (const r of xpass) console.log(`  ${r.id}  ${r.title}`);
  }

  let proofFailures = 0;
  if (args.prove) {
    proofFailures = proofs.filter((p) => !p.wentRed).length;
    console.log(
      `\nNegative controls: ${proofs.length - proofFailures}/${proofs.length} mutations turned their case red.`
    );
    if (proofFailures > 0) {
      console.log("  A case that stays green under a deliberate break is not a check. Fix the assertion.");
      for (const p of proofs.filter((x) => !x.wentRed)) {
        console.log(`  ✗ ${p.caseId}  ${p.describe} — ${p.detail}`);
      }
    }
  }

  console.log(
    `\nCoverage: ${CASES.length} scripted cases stand in for the P0 subset. ` +
      `The residue a script cannot judge is in docs/manual-testing/p0-manual-residue.md — ` +
      `a green run here is not a completed P0 pass on its own.`
  );

  if (args.json) {
    fs.writeFileSync(
      args.json,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          repoRoot: REPO_ROOT,
          results,
          proofs,
          divergences: DIVERGENCES,
          knownDefects: KNOWN_DEFECTS,
        },
        null,
        2
      )
    );
    console.log(`\nJSON report: ${args.json}`);
  }

  if (args.keep) {
    console.log(`\nSandbox kept at ${sb.root}`);
  } else {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }

  const hardFailures =
    failed.length + xpass.length + proofFailures + (args.failOnKnownDefects ? xfail.length : 0);
  if (hardFailures > 0) {
    console.log(`\n✗ P0 suite FAILED (${hardFailures} blocking result(s))`);
    return 1;
  }
  console.log(`\n✓ P0 suite passed${xfail.length > 0 ? ` (${xfail.length} known defect(s) accepted)` : ""}`);
  return 0;
}

process.exit(main());
