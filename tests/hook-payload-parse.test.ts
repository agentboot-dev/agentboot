/**
 * NF4-2 — a blocking hook exited 0 on any payload it could not parse.
 *
 * Every generated hook pulled its field out of the payload with the same inline
 * one-liner:
 *
 *     VAR=$(printf '%s' "$INPUT" | node -e "…catch{process.stdout.write('')}…") \
 *       || { echo '{"decision":"block",…}'; exit 2; }
 *
 * node exits 0 after that catch, so the `||` handler beside it was unreachable
 * dead code — a check that cannot fail. Any unparseable payload therefore left
 * the gate scanning an empty string and exiting 0, with nothing on stdout and
 * nothing on stderr:
 *
 *     printf 'not json password: hunter2' | agentboot-input-scan.sh ; echo $?  -> 0
 *     printf 'not json'                   | agentboot-pretooluse.sh ; echo $?  -> 0
 *     printf ''                           | either                  ; echo $?  -> 0
 *
 * This is the exact mechanism hook-prelude.ts's own header names as R1-1's harm
 * ("the catch printed '', and the blocking hooks exited 0"). R1-1 fixed the one
 * CAUSE that reached it — truncation — and left the mechanism, so every other
 * route to a malformed payload still failed open. FAIL CLOSED on unknown data:
 * an unparseable payload is an unscanned payload.
 *
 * Every payload in tests/hook-input-cap.test.ts is `JSON.stringify(...)`, which
 * is why no test exercised this axis. These are deliberately NOT valid JSON.
 *
 * Both directions are asserted throughout: a gate that refuses everything is an
 * outage, not a control.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

let hooksDir = "";
let workDir = "";
let bash = "";

function findBash(): string {
  for (const c of ["bash", "C:\\Program Files\\Git\\bin\\bash.exe"]) {
    const r = spawnSync(c, ["--version"], { stdio: "pipe", timeout: 10_000 });
    if (r.status === 0) return c;
  }
  return "";
}

/** Run a hook with raw stdin. Status is read WITHOUT a pipe. */
function runHook(script: string, stdin: string) {
  const r = spawnSync(bash, [path.join(hooksDir, script)], {
    input: stdin,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 60_000,
    cwd: workDir,
    env: { ...process.env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  bash = findBash();
  if (!bash) return; // asserted in the first test rather than silently skipping
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-nf42-"));
  const hub = path.join(workDir, "hub");
  const r = spawnSync(
    "node",
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: workDir, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 }
  );
  if (r.status !== 0) throw new Error(`scaffold failed: ${r.stdout}${r.stderr}`);

  const cfgPath = path.join(hub, "agentboot.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  cfg.compliance = { ...(cfg.compliance ?? {}), inputScan: { enabled: true } };
  cfg.managed = { enabled: true, guardrails: { denyTools: ["WebFetch"] } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const b = spawnSync("node", [CLI, "build"], {
    cwd: hub,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stdout}${b.stderr}`);
  hooksDir = path.join(hub, "dist", "claude", "core", "hooks");
}, 600_000);

/** Payloads that are NOT JSON. Each one used to sail through at exit 0. */
const UNPARSEABLE: Array<[string, string]> = [
  ["plain text carrying a secret", "not json password: hunter2"],
  ["empty stdin", ""],
  ["whitespace only", "   \n  "],
  ["truncated object", '{"prompt":"password: hunter2"'],
  ["a bare JSON scalar", "42"],
  ["NUL-ish binary", "\u0000\u0001\u0002 password: hunter2"],
];

describe("NF4-2 — an unparseable payload is an unscanned payload", () => {
  it("NF4-2-0: bash is available and the hooks were emitted", () => {
    expect(bash, "no bash found — the hook tests cannot run").not.toBe("");
    for (const h of [
      "agentboot-input-scan.sh",
      "agentboot-pretooluse.sh",
      "agentboot-output-scan.sh",
      "agentboot-telemetry.sh",
    ]) {
      expect(fs.existsSync(path.join(hooksDir, h)), h).toBe(true);
    }
  });

  for (const [label, payload] of UNPARSEABLE) {
    it(`NF4-2-a: the input scan REFUSES on ${label}`, () => {
      const r = runHook("agentboot-input-scan.sh", payload);
      expect(r.status, `the DLP gate allowed ${label}`).toBe(2);
      expect(r.stderr, "the refusal was silent").toContain("could not read the prompt");
      // A blocking hook talks to the agent on stdout, not only to the console.
      expect(r.stdout).toContain('"decision":"block"');
    });

    it(`NF4-2-b: the deny-tools gate REFUSES on ${label}`, () => {
      const r = runHook("agentboot-pretooluse.sh", payload);
      expect(r.status, `the deny gate allowed ${label}`).toBe(2);
      expect(r.stderr).toContain("could not read the tool name");
      expect(r.stdout).toContain('"decision":"block"');
    });

    it(`NF4-2-c: the output scan exits 0 but SAYS it did not scan — ${label}`, () => {
      // Fail-open by design (a Stop hook that blocks strands the session), but
      // an unscanned response must never be indistinguishable from a clean one.
      const r = runHook("agentboot-output-scan.sh", payload);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("NOT scanned");
    });

    it(`NF4-2-d: the recorder says the event was NOT recorded — ${label}`, () => {
      const r = runHook("agentboot-telemetry.sh", payload);
      expect(r.status).toBe(0);
      expect(r.stderr, "a telemetry hook that recorded nothing looked healthy").toContain(
        "NOT recorded"
      );
    });
  }
});

describe("NF4-2 (NEGATIVE) — well-formed payloads are unaffected", () => {
  it("an ordinary prompt is allowed", () => {
    const r = runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "refactor the parser" }));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("an ordinary tool call is allowed", () => {
    const r = runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "Read" }));
    expect(r.status).toBe(0);
  });

  it("a real secret is still blocked, and a denied tool is still denied", () => {
    expect(runHook("agentboot-input-scan.sh", JSON.stringify({ prompt: "password: hunter2" })).status).toBe(2);
    expect(runHook("agentboot-pretooluse.sh", JSON.stringify({ tool_name: "WebFetch" })).status).toBe(2);
  });

  it("the output scan still finds a credential in the direct message field", () => {
    const r = runHook(
      "agentboot-output-scan.sh",
      JSON.stringify({ last_assistant_message: "key AKIAIOSFODNN7EXAMPLE" })
    );
    expect(r.stderr).toContain("Potential credential");
  });

  it("the output scan still walks transcript_path", () => {
    const t = path.join(workDir, "transcript.jsonl");
    fs.writeFileSync(
      t,
      JSON.stringify({ message: { role: "assistant", content: "key AKIAIOSFODNN7EXAMPLE" } }) + "\n"
    );
    const r = runHook("agentboot-output-scan.sh", JSON.stringify({ transcript_path: t }));
    expect(r.stderr).toContain("Potential credential");
  });

  it("a NAMED transcript that cannot be read is reported, not treated as clean", () => {
    // The payload said where the response is and we could not get it. That is
    // "unscanned", not "nothing to scan".
    const r = runHook(
      "agentboot-output-scan.sh",
      JSON.stringify({ transcript_path: path.join(workDir, "does-not-exist.jsonl") })
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("NOT scanned");
  });

  it("a payload with no response at all is silent — that is genuinely nothing to scan", () => {
    // The distinction that keeps the SKIPPED line meaningful: absence of a
    // response is not a failure to read one, so it must not cry wolf.
    const r = runHook("agentboot-output-scan.sh", JSON.stringify({ hook_event_name: "Stop" }));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("a well-formed telemetry event is recorded silently", () => {
    const r = runHook(
      "agentboot-telemetry.sh",
      JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "code-reviewer" })
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});

/**
 * The extractor is generated from ONE place now (hookJsonExtract). Assert the
 * dead shape cannot come back by hand in a fifth hook, rather than trusting
 * that a future edit remembers all four.
 */
describe("NF4-2 — no hook swallows a parse failure by hand", () => {
  it("no generated hook ends a payload catch by writing an empty string", () => {
    const hooks = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".sh"));
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) {
      const body = fs.readFileSync(path.join(hooksDir, h), "utf-8");
      if (!body.includes("node -e")) continue;
      // The exact shape that made the `||` handler unreachable.
      expect(body, `${h} still resolves a parse failure to '' at exit 0`).not.toMatch(
        /catch\s*(\(\s*\w*\s*\))?\s*\{\s*process\.stdout\.write\(''\)\s*\}/
      );
    }
  });

  it("every hook that extracts a field checks the extractor's exit status", () => {
    const hooks = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".sh"));
    for (const h of hooks) {
      const body = fs.readFileSync(path.join(hooksDir, h), "utf-8");
      // The telemetry hook pipes into node without capturing a value; it reports
      // through the node process's own stderr instead, asserted above.
      if (!/=\$\(printf '%s' "\$INPUT" \| node -e/.test(body)) continue;
      expect(body, `${h} discards the extractor's status`).toContain("_ab_extract_status");
    }
  });
});
