# scripts/qa — the scripted half of the P0 manual test plan

`p0-suite.ts` executes every P0 manual-QA case whose pass criteria a machine can
judge. It exists because a release gate that says "someone ran the plan" is not
evidence, and because re-running 61 terminal cases by hand before every tag is
how a gate quietly stops being run at all.

## Run it

```bash
npx tsx scripts/qa/p0-suite.ts                    # the gate
npx tsx scripts/qa/p0-suite.ts --prove            # the gate + its negative controls
npx tsx scripts/qa/p0-suite.ts --only TP-04       # one plan
npx tsx scripts/qa/p0-suite.ts --only TP-09-3     # one case
npx tsx scripts/qa/p0-suite.ts --keep             # leave the sandbox for inspection
npx tsx scripts/qa/p0-suite.ts --json report.json # machine-readable results
```

Runtime is roughly a minute. It needs no network and no registry: every case runs
against a throwaway copy of the working tree, driven through `bin/agentboot.js` —
the same entry point the published package installs.

> **Packaging note.** `package.json`'s `files` list ships all of `scripts/`, with a
> single carve-out for `scripts/intelligence/`. This directory therefore lands in the
> published tarball (four files, ~60 KB) even though nothing outside the repo needs it.
> Adding `"!scripts/qa/"` beside the existing exclusion removes it; that edit belongs to
> whoever owns `package.json`.

## Exit codes

| code | meaning |
|---|---|
| `0` | every case behaved as registered |
| `1` | a case failed, a known-defect case unexpectedly passed, or a negative control did not turn its case red |
| `2` | the harness could not run |

`--fail-on-known-defects` promotes the accepted-and-named defects to blocking.

## What a green run does and does not mean

It means the scripted cases hold. It does **not** mean the P0 subset passed: the
cases a script cannot judge are listed in
[`docs/manual-testing/p0-manual-residue.md`](../../docs/manual-testing/p0-manual-residue.md)
and a human still has to work through them. Every run prints that reminder, on
purpose.

## The three registers

Both registers live at the top of `p0-cases.ts` and both print in the summary.

**`DIVERGENCES`** — the written plan is stale and the current behaviour is
deliberate (a renamed output file, a pruned command, a deprecated flag). The case
asserts *current* behaviour, and the register records what the plan claims, what
the product does, and the evidence the change was intentional. Silently rewriting
the assertion without the register entry is how a plan and a product drift apart
with nobody noticing.

**`KNOWN_DEFECTS`** — the current behaviour contradicts the product's *own*
documentation. The case asserts the **documented** contract and is therefore
expected to fail; it reports `XFAIL` and is printed under a heading that says out
loud that this is not green. If the defect gets fixed, the case passes, the run
reports `XPASS`, and the suite goes **red** until the register entry is deleted —
an instrument whose register no longer matches reality is worse than no
instrument.

**`MUTATIONS`** — the negative controls. `--prove` breaks one thing per mutation
and requires the named case to go red, then reverts and requires it to go green
again. A check that has never been observed failing is not a check; this repo has
already shipped a tamper test that passed without tampering with anything.

## Adding a case

1. Add it to the right `TP0x` array in `p0-cases.ts` with the manual case's id.
2. Add a mutation to `MUTATIONS` that breaks exactly what it asserts.
3. Run `npx tsx scripts/qa/p0-suite.ts --prove --only <id>` and watch it go red,
   then green.

If you cannot write a mutation that reddens the case, the case is not asserting
anything — delete it and put the item on the manual residue list instead. An
honest manual line beats a scripted case that cannot fail.
