/**
 * I1 — the generated hooks read stdin with an unbounded `INPUT=$(cat)`.
 *
 * These hooks run on a developer's machine on every prompt and every tool call,
 * so an oversized payload is a memory/latency problem on the critical path.
 * The cap is generous (1 MiB); what matters is the ACTION at the boundary, and
 * that it is never silent.
 *
 * Per the standing norm each case asserts both directions — a cap that blocks
 * ordinary prompts is an outage, not a control.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let hooksDir = "";
let bash = "";

function findBash(): string {
  for (const c of ["bash", "C:\\Program Files\\Git\\bin\\bash.exe"]) {
    const r = spawnSync(c, ["--version"], { stdio: "pipe", timeout: 10_000 });
    if (r.status === 0) return c;
  }
  return "";
}

/** Run a hook with the given stdin. Status is read WITHOUT a pipe. */
function runHook(script: string, stdin: string, env: Record<string, string> = {}) {
  const r = spawnSync(bash, [path.join(hooksDir, script)], {
    input: stdin,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  bash = findBash();
  if (!bash) return; // asserted in the first test rather than silently skipping
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-i1-"));
  const hub = path.join(base, "hub");
  const r = spawnSync("node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.compliance = { ...(cfg.compliance ?? {}), inputScan: { enabled: true } };
  cfg.managed = { enabled: true, guardrails: { denyTools: ["WebFetch"] } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const b = spawnSync("node", [CLI, "build"], {
    cwd: hub, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
  hooksDir = path.join(hub, "dist", "claude", "core", "hooks");
}, 600_000);

const OVERSIZED = JSON.stringify({ prompt: "a".repeat(1_200_000), tool_name: "Read" });

describe("I1 — hook stdin size cap", () => {
  it("I1-0: bash is available and the hooks were emitted", () => {
    // A suite that skips itself when the interpreter is missing reports the same
    // green as one that ran. Assert the precondition instead.
    expect(bash, "no bash found — the hook tests cannot run").not.toBe("");
    for (const h of ["agentboot-input-scan.sh", "agentboot-pretooluse.sh", "agentboot-output-scan.sh"]) {
      expect(fs.existsSync(path.join(hooksDir, h)), h).toBe(true);
    }
  });

  it("I1-1 (NEGATIVE): an ordinary prompt is allowed — the cap is not an outage", () => {
    expect(runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "hello world" })).status).toBe(0);
  });

  it("I1-2 (NEGATIVE): the scanner still blocks a real secret", () => {
    // If the cap change had broken parsing, everything would pass and the DLP
    // gate would be gone. This is the assertion that catches that.
    const r = runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "api_key = AKIAABCDEFGHIJKLMNOP" }));
    expect(r.status).toBe(2);
  });

  it("I1-3: an oversized prompt FAILS CLOSED and says why", () => {
    const r = runHook("agentboot-input-scan.sh", OVERSIZED);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("exceeds the hook input limit");
    expect(r.stderr).toContain("cannot scan it in full");
  });

  it("I1-4: the PreToolUse deny hook also fails closed on an oversized payload", () => {
    const r = runHook("agentboot-pretooluse.sh", OVERSIZED);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("could not be inspected");
  });

  it("I1-5 (NEGATIVE): the PreToolUse hook still allows an ordinary non-denied tool", () => {
    expect(runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "Read" })).status).toBe(0);
  });

  it("I1-6: the Stop hook fails OPEN — but LOUDLY, never silently", () => {
    // A Stop hook that blocks on its own failure strands the session, so the
    // declared posture is fail-open. The requirement is that an unscanned
    // response cannot look like a clean one.
    const r = runHook("agentboot-output-scan.sh", OVERSIZED);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("output scan SKIPPED");
  });

  it("I1-7: the cap is an env-tunable decision, not a hard wall", () => {
    const r = runHook("agentboot-input-scan.sh", OVERSIZED, {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "5000000",
    });
    expect(r.status).toBe(0);
  });
});

/**
 * R1-1 — the cap compared a CHARACTER count against a BYTE limit.
 *
 * Every case above uses `"a".repeat(...)`, where bytes and characters are the
 * same number, so the whole file passed while the gate failed open on any
 * multibyte payload. That is the shape of a check that cannot fail: the test
 * data was drawn from the one axis on which the two units coincide.
 *
 * 500_000 CJK characters is 1_500_000 bytes — over the 1 MiB cap in bytes and
 * comfortably under it in characters. Pre-fix: `head -c` truncated it mid
 * sequence, the comparison saw no truncation, JSON.parse threw inside the node
 * one-liner, the catch printed '', and the blocking hooks exited 0 with no
 * stdout and no stderr.
 */
const MULTIBYTE_OVER_CAP_PROMPT = JSON.stringify({
  prompt: "密".repeat(500_000) + " password: hunter2",
});
const MULTIBYTE_OVER_CAP_TOOL = JSON.stringify({
  padding: "密".repeat(500_000),
  tool_name: "WebFetch",
});

describe("R1-1 — the cap is measured in bytes, not characters", () => {
  it("R1-1-0: the fixture really is over the cap in bytes and under it in characters", () => {
    // If this ever stops holding, every assertion below becomes vacuous.
    expect(Buffer.byteLength(MULTIBYTE_OVER_CAP_PROMPT, "utf-8")).toBeGreaterThan(1_048_576);
    expect(MULTIBYTE_OVER_CAP_PROMPT.length).toBeLessThan(1_048_576);
  });

  it("R1-1-1: a multibyte over-cap prompt FAILS CLOSED — it does not slip past as under-cap", () => {
    const r = runHook("agentboot-input-scan.sh", MULTIBYTE_OVER_CAP_PROMPT);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("exceeds the hook input limit");
    expect(r.stderr).toContain("cannot scan it in full");
  });

  it("R1-1-2: the PreToolUse deny gate also fails closed on a multibyte over-cap payload", () => {
    const r = runHook("agentboot-pretooluse.sh", MULTIBYTE_OVER_CAP_TOOL);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("could not be inspected");
  });

  it("R1-1-3: the Stop hook says it SKIPPED — the multibyte path was quieter than the ASCII one", () => {
    // Pre-fix this hook did not even emit its promised stderr line for a
    // multibyte payload: it fell through the truncation branch, failed to
    // parse, and exited 0 saying nothing at all.
    const r = runHook("agentboot-output-scan.sh", MULTIBYTE_OVER_CAP_PROMPT);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("output scan SKIPPED");
  });

  it("R1-1-4 (NEGATIVE): multibyte UNDER the cap is scanned normally, not blocked wholesale", () => {
    // The opposite outage. A fix that just blocks everything multibyte is not a fix.
    const clean = JSON.stringify({ prompt: "密".repeat(200_000) });
    expect(Buffer.byteLength(clean, "utf-8")).toBeLessThan(1_048_576);
    expect(runHook("agentboot-input-scan.sh", clean).status).toBe(0);
  });

  it("R1-1-5 (NEGATIVE): raising the cap makes the multibyte payload SCANNABLE, and it is scanned", () => {
    // Proves the block above was the cap and not a parse failure: with room to
    // read it, the same payload is blocked for the reason that actually matters.
    const r = runHook("agentboot-input-scan.sh", MULTIBYTE_OVER_CAP_PROMPT, {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "5000000",
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Potential credential detected");
  });
});

/**
 * R1-2 — `AGENTBOOT_MAX_HOOK_INPUT_BYTES` was an unvalidated env var used inside
 * `$(( ))` and `[ -gt ]`. A non-numeric value made both error under `set -u`,
 * leaving INPUT one byte long and INPUT_TRUNCATED=0 — so a single environment
 * variable disabled the DLP scan and the denyTools gate that the product sells
 * as non-overridable org policy.
 */
describe("R1-2 — an unusable limit must not disable the gate", () => {
  const SECRET = JSON.stringify({ prompt: "api_key = AKIAABCDEFGHIJKLMNOP" });

  for (const bad of ["abc", "0", "-1", "1e6", "1048576 ", "0100"]) {
    it(`R1-2-1[${bad}]: the input scan refuses rather than running unbounded`, () => {
      const r = runHook("agentboot-input-scan.sh", SECRET, {
        AGENTBOOT_MAX_HOOK_INPUT_BYTES: bad,
      });
      // Either the limit is honoured and the secret is caught, or the limit is
      // rejected and the gate refuses — both are exit 2. What must never happen
      // is exit 0, which is what the unvalidated version did.
      expect(r.status, `AGENTBOOT_MAX_HOOK_INPUT_BYTES=${bad} allowed a secret through`).toBe(2);
    });
  }

  it("R1-2-2: the refusal names the variable so the operator can fix it", () => {
    const r = runHook("agentboot-input-scan.sh", SECRET, {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "abc",
    });
    expect(r.stderr).toContain("AGENTBOOT_MAX_HOOK_INPUT_BYTES");
    expect(r.stdout).toContain("not a usable byte count");
  });

  it("R1-2-3: the deny-tools gate refuses too — same class, same posture", () => {
    const r = runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "WebFetch" }), {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "abc",
    });
    expect(r.status).toBe(2);
  });

  it("R1-2-4: an advisory hook degrades to the default and SAYS SO — it does not refuse", () => {
    // The posture split is deliberate: a Stop hook that refuses on a typo'd env
    // var strands the session. It falls back, and it is loud about it.
    const r = runHook("agentboot-output-scan.sh", JSON.stringify({ last_assistant_message: "fine" }), {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "abc",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("falling back to 1048576");
  });

  it("R1-2-5 (NEGATIVE): a well-formed value is still honoured on every hook", () => {
    expect(
      runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "hello" }), {
        AGENTBOOT_MAX_HOOK_INPUT_BYTES: "2097152",
      }).status
    ).toBe(0);
    expect(
      runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "Read" }), {
        AGENTBOOT_MAX_HOOK_INPUT_BYTES: "2097152",
      }).status
    ).toBe(0);
  });
});

/**
 * R3 — R1-2's guard was LEXICAL (`case ''|*[!0-9]*|0*`) while the failure axis
 * it had to cover is ARITHMETIC RANGE.
 *
 * `AGENTBOOT_MAX_HOOK_INPUT_BYTES=9223372036854775807` is all digits with no
 * leading zero, so it PASSED the R1-2 guard, then overflowed `$((MAX + 1))` to a
 * negative number. `head -c -9223372036854775808` errors, INPUT is empty,
 * INPUT_BYTES=0, INPUT_TRUNCATED=0, the node one-liner's catch prints '', and the
 * gate exits 0 — R1-2's own stated failure mode ("one environment variable
 * disabled the scan and the deny gate the product sells as non-overridable org
 * policy") restored verbatim through the code written to close it.
 *
 * Measured unpiped on a scratch hub, before the fix:
 *   input-scan  2 → 0   (allowed `password: hunter2`)
 *   pretooluse  2 → 0   (allowed the denied WebFetch)
 *   output-scan 0        with NO "output scan SKIPPED" line
 *
 * The R1-2 test list was [abc, 0, -1, 1e6, "1048576 ", 0100] — six LEXICAL cases
 * and zero RANGE cases: test data drawn from the one axis where the units
 * coincide, which is the same mistake the R1-1 commit message diagnoses. These
 * cases exist so that axis can never go unexercised again.
 */
describe("R3 — the limit is validated on RANGE, not just on FORM", () => {
  const SECRET = JSON.stringify({ prompt: "api_key = AKIAABCDEFGHIJKLMNOP" });

  // All-digits, no leading zero — every one of these passes the R1-2 guard.
  const OVERFLOWING = [
    "9223372036854775807", // INT64_MAX: $((MAX+1)) wraps negative
    "9223372036854775808", // INT64_MAX+1
    "18446744073709551615", // UINT64_MAX: head reports "illegal byte count -- 0"
    "999999999999999999999999", // past 19 digits: [ -gt ] itself errors
    "2147483648", // just past the declared ceiling — the boundary, not a monster
    "10000000000", // 11 digits, the digit-count rejection path
  ];

  for (const bad of OVERFLOWING) {
    it(`R3-1[${bad}]: the input scan refuses rather than failing open`, () => {
      const r = runHook("agentboot-input-scan.sh", SECRET, {
        AGENTBOOT_MAX_HOOK_INPUT_BYTES: bad,
      });
      expect(
        r.status,
        `AGENTBOOT_MAX_HOOK_INPUT_BYTES=${bad} allowed a secret through`
      ).toBe(2);
    });

    it(`R3-2[${bad}]: the deny-tools gate refuses too`, () => {
      const r = runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "WebFetch" }), {
        AGENTBOOT_MAX_HOOK_INPUT_BYTES: bad,
      });
      expect(r.status, `AGENTBOOT_MAX_HOOK_INPUT_BYTES=${bad} allowed a denied tool`).toBe(2);
    });

    it(`R3-3[${bad}]: the output scan falls back LOUDLY — a skip is never silent`, () => {
      const r = runHook("agentboot-output-scan.sh", JSON.stringify({ last_assistant_message: "fine" }), {
        AGENTBOOT_MAX_HOOK_INPUT_BYTES: bad,
      });
      expect(r.status).toBe(0);
      expect(
        r.stderr,
        `AGENTBOOT_MAX_HOOK_INPUT_BYTES=${bad} skipped the output scan silently`
      ).toContain("AGENTBOOT_MAX_HOOK_INPUT_BYTES");
    });
  }

  it("R3-4 (NEGATIVE): the ceiling itself is ACCEPTED — the bound is a bound, not a ban", () => {
    // 2147483647 is legal; a guard that rejected it would be over-tight and the
    // "refuses" assertions above would pass for the wrong reason.
    const r = runHook("agentboot-input-scan.sh", SECRET, {
      AGENTBOOT_MAX_HOOK_INPUT_BYTES: "2147483647",
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Potential credential detected");
    expect(r.stderr).not.toContain("not a usable byte count");
  });
});

/**
 * R3 / NF2-6 — head's exit status was structurally discarded.
 *
 * `INPUT=$(head -c "$N"; printf X)` takes the command substitution's status from
 * printf — always 0 — and `set -o pipefail` does not apply because this is a
 * command LIST, not a pipeline. So ANY head failure (not only the overflow
 * above: head unavailable, EINTR, a read error on the fd) left INPUT empty,
 * INPUT_TRUNCATED=0, and a blocking gate at exit 0, with nothing on stderr.
 *
 * A component that failed must exit non-zero AND say so. Simulated here with a
 * `head` stub earlier on PATH that exits 1, which is the only way to exercise
 * the branch without an unreliable fd trick.
 */
/*
 * L40 — PLATFORM GUARD. The mechanism here is a POSIX one end to end: an
 * extensionless `head` script made executable with `chmod 0o755` and placed
 * earlier on PATH so the hook's own `head` resolves to it. Windows has no
 * execute bit for Node's chmod to set (it maps only the read-only attribute)
 * and resolves commands through PATHEXT, so the stub would not reliably shadow
 * anything — the test would not fail honestly, it would stop exercising the
 * branch while still reporting green. A check that cannot fail is not a check,
 * so it is skipped rather than left to pass vacuously.
 */
describe.skipIf(process.platform === "win32")("R3/NF2-6 — a failed read is not an empty payload", () => {
  let stubDir = "";
  beforeAll(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-headstub-"));
    const stub = path.join(stubDir, "head");
    fs.writeFileSync(stub, "#!/bin/sh\nexit 1\n", "utf-8");
    fs.chmodSync(stub, 0o755);
  });
  afterAll(() => {
    if (stubDir) fs.rmSync(stubDir, { recursive: true, force: true });
  });

  const withStub = () => ({ PATH: `${stubDir}${path.delimiter}${process.env["PATH"] ?? ""}` });

  it("R3-5: a blocking gate REFUSES when head fails, and names why", () => {
    const r = runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "x" }), withStub());
    expect(r.status, "the input scan ran on an unread payload").toBe(2);
    expect(r.stderr).toContain("could not read the hook payload");
  });

  it("R3-6: the deny-tools gate refuses too — same class, same posture", () => {
    const r = runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "WebFetch" }), withStub());
    expect(r.status).toBe(2);
  });

  it("R3-7: the output scan exits 0 but SAYS the response was not scanned", () => {
    const r = runHook("agentboot-output-scan.sh", JSON.stringify({ last_assistant_message: "x" }), withStub());
    expect(r.status).toBe(0);
    expect(r.stderr, "a skipped output scan was indistinguishable from a clean one").toContain(
      "NOT scanned"
    );
  });
});

/**
 * The prelude is generated from ONE place now (scripts/lib/hook-prelude.ts).
 * Before, the same six lines were pasted into four hook templates and both
 * defects above lived in all four copies. Assert the invariant rather than
 * trusting that a future edit remembers all four.
 */
describe("R1-1/R1-2 — one prelude, not four copies", () => {
  it("every generated hook that reads stdin uses the shared byte-measured prelude", () => {
    const hooks = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".sh"));
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) {
      const body = fs.readFileSync(path.join(hooksDir, h), "utf-8");
      if (!body.includes("MAX_HOOK_INPUT_BYTES")) continue;
      // The comparison, not the mention — the prelude's own comment explains
      // ${#INPUT} in order to say why it is wrong.
      expect(body, `${h} still compares a character count`).not.toMatch(
        /\[\s*"\$\{#INPUT\}"\s*-gt/
      );
      expect(body, `${h} does not count bytes`).toContain("INPUT_BYTES=");
      expect(body, `${h} does not validate the operator's limit`).toContain(
        `''|*[!0-9]*|0*)`
      );
    }
  });
});

/**
 * NF4-1 — the measurement's exit status was structurally discarded too.
 *
 * R3/NF2-6 above fixed `INPUT=$(head …)`. One line later the prelude had the
 * identical shape: `INPUT_BYTES=$(printf '%s' "$INPUT" | wc -c | tr -d …)`
 * throws the pipeline's status away. A wc or tr that fails — unavailable, a
 * busybox build without the flag, a shadowing stub on PATH, ENOMEM on a large
 * payload — yields an empty INPUT_BYTES; `[ "" -gt N ]` then errors with bash's
 * own `[: : integer expected`, INPUT_TRUNCATED stays 0, and the blocking gates
 * fall through to exit 0. Measured before the fix on a scratch hub with an
 * `exit 3` wc stub and a 1.2 MB payload: input scan 2 → 0 (allowed
 * `password: hunter2`), PreToolUse 2 → 0 (allowed a denied WebFetch), and the
 * Stop hook's honest "output scan SKIPPED" line REPLACED by the bash error.
 *
 * The size is what decides whether the payload is complete, so failing to
 * measure it disqualifies the gate exactly as failing to read it does.
 * Exercised with both pipeline stages, because fixing only the one that was
 * reported is how this class keeps coming back.
 */
/*
 * L40 — PLATFORM GUARD, same PATH-shadowing mechanism and same reasoning as
 * R3/NF2-6 above: `chmod 0o755` on an extensionless `wc`/`tr` stub is a no-op
 * on Windows, so the stub would not shadow the real tool and these tests would
 * pass without ever exercising the failure branch they exist to pin.
 */
describe.skipIf(process.platform === "win32")("NF4-1 — a payload of unknown size is not a payload of size zero", () => {
  let stubDir = "";
  afterAll(() => {
    if (stubDir) fs.rmSync(stubDir, { recursive: true, force: true });
  });

  /**
   * A stub for `tool` earlier on PATH that fails.
   *
   * Two flavours, because the guard has two independent halves and a stub that
   * trips both proves neither:
   *   `silent` — fails and prints nothing, so INPUT_BYTES is empty. Only the
   *              digit backstop sees this.
   *   `noisy`  — fails but prints a plausible count, so INPUT_BYTES parses as a
   *              number. ONLY the exit status sees this, and it is the realistic
   *              shape: a wc that wrote a partial count before erroring.
   */
  const withStub = (tool: "wc" | "tr", flavour: "silent" | "noisy" = "silent") => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), `agentboot-${tool}stub-`));
    const stub = path.join(stubDir, tool);
    const body = flavour === "noisy" ? "#!/bin/sh\necho 12\nexit 3\n" : "#!/bin/sh\nexit 3\n";
    fs.writeFileSync(stub, body, "utf-8");
    fs.chmodSync(stub, 0o755);
    return { PATH: `${stubDir}${path.delimiter}${process.env["PATH"] ?? ""}` };
  };

  const SECRET = JSON.stringify({
    prompt: `password: hunter2 ${"a".repeat(1_200_000)}`,
    tool_name: "WebFetch",
  });

  for (const tool of ["wc", "tr"] as const) {
    it(`NF4-1-a/${tool}: the input scan REFUSES rather than allowing an unmeasured secret`, () => {
      const r = runHook("agentboot-input-scan.sh", SECRET, withStub(tool));
      expect(r.status, `a failing ${tool} turned the DLP gate back into a fail-open`).toBe(2);
      expect(r.stderr).toContain("could not measure the hook payload");
    });

    it(`NF4-1-b/${tool}: the deny-tools gate refuses too — same class, same posture`, () => {
      const r = runHook("agentboot-pretooluse.sh", SECRET, withStub(tool));
      expect(r.status, `a failing ${tool} let a denied tool through`).toBe(2);
      expect(r.stderr).toContain("could not measure the hook payload");
    });
  }

  it("NF4-1-f: a measurement that FAILS while printing a plausible count still refuses", () => {
    // The half the digit backstop cannot see. Without the pipeline's status the
    // gate reads `12`, decides a 1.2 MB payload is 12 bytes, and allows it.
    const r = runHook("agentboot-input-scan.sh", SECRET, withStub("wc", "noisy"));
    expect(r.status, "a wrong-but-numeric byte count was taken at face value").toBe(2);
    expect(r.stderr).toContain("could not measure the hook payload");
  });

  it("NF4-1-g: the deny-tools gate refuses a plausible-but-failed measurement too", () => {
    const r = runHook("agentboot-pretooluse.sh", SECRET, withStub("wc", "noisy"));
    expect(r.status).toBe(2);
  });

  it("NF4-1-c: the output scan exits 0 but SAYS the response was not scanned", () => {
    const r = runHook("agentboot-output-scan.sh", SECRET, withStub("wc"));
    expect(r.status).toBe(0);
    // The bug replaced this honest line with bash's `[: : integer expected`.
    expect(r.stderr, "an unmeasured response looked exactly like a clean one").toContain(
      "NOT scanned"
    );
    expect(r.stderr).not.toContain("integer expected");
  });

  it("NF4-1-d: the recorder carries on but never claims the record is complete", () => {
    const r = runHook("agentboot-telemetry.sh", SECRET, withStub("wc"));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("record is incomplete");
    expect(r.stderr).not.toContain("integer expected");
  });

  it("NF4-1-e (NEGATIVE): with wc and tr working, an ordinary prompt is still allowed", () => {
    // A measurement guard that refuses everything is an outage, not a control.
    const ok = JSON.stringify({ prompt: "refactor the parser", tool_name: "Read" });
    expect(runHook("agentboot-input-scan.sh", ok).status).toBe(0);
    expect(runHook("agentboot-pretooluse.sh", ok).status).toBe(0);
  });
});
