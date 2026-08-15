/**
 * Global test isolation.
 *
 * Points AGENTBOOT_HOME at a throwaway temp dir so the AgentBoot global hub
 * registry (~/.agentboot/config.json) is isolated per test file and never
 * touches the developer's real registry. Without this, install/scaffold/CLI
 * tests register temp hubs into the real registry and leave thousands of dead
 * entries behind (observed: 2000+ leftover hubs from repeated `npm test` runs).
 *
 * Runs in the worker before each test file (vitest `setupFiles`), so both
 * in-process code and spawned CLI subprocesses (which inherit process.env)
 * resolve the registry under the temp home.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkDistFreshness } from "../scripts/lib/dist-stamp.js";
import { loadConfig } from "../scripts/lib/config.js";

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-testhome-"));
process.env["AGENTBOOT_HOME"] = testHome;

// ---------------------------------------------------------------------------
// NF-1 — the shared ROOT/dist is why the suite is order-dependent
// ---------------------------------------------------------------------------

/**
 * Rebuild the repo's own `dist/` unless the stamp says it is already current.
 *
 * Fourteen test files read the shared, gitignored `ROOT/dist` while other files
 * REBUILD and PRUNE it. Measured on a frozen `git archive` snapshot with a
 * symlinked node_modules, so no concurrent edit was possible: the full suite was
 * `10 failed | 1679 passed`, all ten in tests/cli.test.ts; `npx vitest run
 * tests/cli.test.ts` alone in the same snapshot was `202 passed`, exit 0. A
 * green full-suite run was a scheduling outcome, not a property of the code —
 * which disqualifies it as the evidence a guard holds, and it is exactly the
 * evidence a sign-off rests on.
 *
 * The guards those files used were `if (!fs.existsSync(distPath))` — EXISTENCE
 * READ AS FRESHNESS, the same defect the N1 gate exists to close, in the test
 * harness. A file that pruned dist/ down to two platforms left a `dist/` that
 * exists, so the next file's guard did nothing and its assertions read a tree
 * built for someone else's config.
 *
 * This asks the stamp instead. It is cheap when the tree is current (one file
 * read) and correct when it is not, and it removes the shared-mutable-state
 * hazard for every consumer that adopts it.
 */
export function ensureRootDist(): void {
  const ROOT = path.resolve(__dirname, "..");
  const distPath = path.join(ROOT, "dist");
  const configPath = path.join(ROOT, "agentboot.config.json");

  let fresh = false;
  try {
    if (fs.existsSync(distPath) && fs.existsSync(configPath)) {
      fresh = checkDistFreshness(distPath, loadConfig(configPath), ROOT).fresh === true;
    }
  } catch {
    fresh = false; // unknown ⇒ rebuild. Never the other way round.
  }
  if (fresh) return;

  // Run tsx's OWN entry point under the current node, never the `.bin` shim.
  //
  // `node_modules/.bin/tsx` is an extensionless shell script; on Windows the
  // executable shim is `tsx.cmd`, and `spawnSync` without a shell cannot launch
  // either — it fails with ENOENT, `status` null, and EMPTY stdout/stderr.
  // That took the whole Windows leg down: this helper is the shared setup, so
  // one unrunnable build cascaded into 302 failures across the run, none of
  // which were real defects.
  //
  // `scripts/cli.ts` already knew this and resolves the shim through a shell.
  // The test harness never learned it — one call site taught, the other not,
  // which is the same reader/writer split this branch has spent itself closing,
  // one level out from the product.
  //
  // Spawning `process.execPath` with `tsx/dist/cli.mjs` sidesteps shims and
  // shell quoting on every platform, so there is no second rule to keep in sync.
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const r = spawnSync(process.execPath, [tsxCli, path.join(ROOT, "scripts", "compile.ts")], {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  if (r.status !== 0) {
    // Report WHY, not just that. The previous message interpolated stdout and
    // stderr only — both empty on a spawn failure — so the one run that could
    // have named the cause printed "build failed" and nothing else. A failure
    // that cannot say what happened costs a whole CI round trip to re-ask.
    const why = r.error
      ? `spawn error: ${r.error.message}`
      : `exit status ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}`;
    throw new Error(
      `ensureRootDist: build failed — ${why}\n` +
        `  command: ${process.execPath} ${tsxCli} scripts/compile.ts\n` +
        `${r.stdout ?? ""}${r.stderr ?? ""}`,
    );
  }
}
