/**
 * QA harness — sandbox construction, process running, and assertions.
 *
 * Everything the P0 suite touches happens inside a throwaway sandbox copy of
 * the working tree. Nothing here writes to the checkout under test: a release
 * gate that mutates the thing it is measuring cannot be trusted twice.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr, in that order — most CLI output here is on stdout. */
  out: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  /** milliseconds; the harness never blocks forever on an interactive prompt */
  timeout?: number;
  env?: Record<string, string>;
  /** what to feed the child's stdin — defaults to an immediate EOF */
  input?: string;
}

/**
 * Run a command and capture both streams.
 *
 * NO_COLOR/FORCE_COLOR are forced off: every assertion in this suite matches
 * on CLI text, and an ANSI escape sequence in the middle of a word turns a
 * real assertion into one that silently never matches.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): RunResult {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf-8",
    timeout: opts.timeout ?? 180_000,
    input: opts.input ?? "",
    env: {
      ...process.env,
      ...(opts.env ?? {}),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return {
    code: res.status ?? (res.signal ? 124 : 1),
    stdout,
    stderr,
    out: `${stdout}${stderr}`,
    timedOut: res.signal === "SIGTERM" && res.status === null,
  };
}

// ---------------------------------------------------------------------------
// Assertions
//
// Every failure raises; the runner turns a raised assertion into a red case.
// Messages carry the observed value, because "expected X" with no "got Y" is
// the difference between a five-minute triage and an hour of re-running.
// ---------------------------------------------------------------------------

export class AssertionError extends Error {}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError(message);
}

export function assertExit(res: RunResult, expected: number, what: string): void {
  if (res.timedOut) {
    throw new AssertionError(`${what}: timed out (no exit) — last output:\n${tail(res.out, 15)}`);
  }
  if (res.code !== expected) {
    throw new AssertionError(
      `${what}: expected exit ${expected}, got ${res.code}\n${tail(res.out, 20)}`
    );
  }
}

export function assertContains(haystack: string, needle: string, what: string): void {
  if (!haystack.includes(needle)) {
    throw new AssertionError(`${what}: expected to find ${JSON.stringify(needle)}\n${tail(haystack, 20)}`);
  }
}

export function assertNotContains(haystack: string, needle: string, what: string): void {
  if (haystack.includes(needle)) {
    throw new AssertionError(`${what}: expected NOT to find ${JSON.stringify(needle)}`);
  }
}

export function assertMatches(haystack: string, re: RegExp, what: string): void {
  if (!re.test(haystack)) {
    throw new AssertionError(`${what}: expected to match ${re}\n${tail(haystack, 20)}`);
  }
}

export function assertFile(p: string, what: string): void {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    throw new AssertionError(`${what}: expected file ${p}`);
  }
}

export function assertDir(p: string, what: string): void {
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
    throw new AssertionError(`${what}: expected directory ${p}`);
  }
}

export function assertAbsent(p: string, what: string): void {
  if (fs.existsSync(p)) throw new AssertionError(`${what}: expected ${p} NOT to exist`);
}

export function assertMinLines(p: string, min: number, what: string): void {
  assertFile(p, what);
  const n = fs.readFileSync(p, "utf-8").split("\n").length;
  if (n < min) throw new AssertionError(`${what}: ${p} has ${n} lines, expected >= ${min}`);
}

/**
 * A stack trace leaking out of a CLI error path is the failure this checks for:
 * the user-facing contract is a sentence, not a V8 frame dump.
 */
export function assertNoStackTrace(out: string, what: string): void {
  const frame = /^\s+at\s+[\w$.<>[\]]+\s*\(/m;
  if (frame.test(out)) {
    throw new AssertionError(`${what}: output contains a stack trace\n${tail(out, 20)}`);
  }
}

export function tail(s: string, lines: number): string {
  const parts = s.trimEnd().split("\n");
  return parts.slice(Math.max(0, parts.length - lines)).join("\n");
}

// ---------------------------------------------------------------------------
// JSONC — agentboot.config.json carries `//` comments
// ---------------------------------------------------------------------------

/**
 * Strip `//` and block comments while respecting string literals.
 *
 * A naive `replace(/\/\/.*$/gm, "")` eats the `//` in any URL in the config,
 * which produces a parse error that looks like a product bug. This walks the
 * text instead.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

export function readJsonc(p: string): Record<string, unknown> {
  const raw = fs.readFileSync(p, "utf-8");
  try {
    return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
  } catch (e) {
    throw new AssertionError(`${p} is not parseable JSON(C): ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/**
 * Content digest of a whole tree (paths + bytes), skipping `.git`.
 * Used for the sync idempotency case: "same files, same bytes, same layout".
 */
export function sha256Tree(root: string): string {
  const h = crypto.createHash("sha256");
  const walk = (dir: string, rel: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const e of entries) {
      if (e.name === ".git") continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) h.update(`${r} ${sha256File(abs)} `);
    }
  };
  walk(root, "");
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export interface Sandbox {
  root: string;
  /** the hub under test — a copy of the working tree */
  hub: string;
  /** empty git repo that `sync` distributes into */
  target: string;
  /** where TP-02 runs `install --hub` */
  installDir: string;
  /** set by TP-02-1 once the scaffolded hub path is known */
  newHub: string;
  reposFile: string;
  badReposFile: string;
  repoRoot: string;
}

/**
 * Entries copied into the sandbox hub. This is the compiler's whole input
 * surface plus the CLI itself. `docs/` comes along because two cases read it
 * as an SSOT — help-vs-CLI-reference parity, and the version-string guard —
 * and both must be able to see a mutation applied inside the sandbox.
 */
const SANDBOX_ENTRIES = [
  "bin",
  "scripts",
  "core",
  "templates",
  "domains",
  "docs",
  "package.json",
  "agentboot.config.json",
  "repos.json",
  "tsconfig.json",
];

export function makeSandbox(repoRoot: string): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-p0-"));
  const hub = path.join(root, "hub");
  const target = path.join(root, "target");
  const installDir = path.join(root, "install");
  fs.mkdirSync(hub, { recursive: true });

  for (const entry of SANDBOX_ENTRIES) {
    const src = path.join(repoRoot, entry);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(hub, entry), { recursive: true });
  }
  // The bin shim resolves tsx relative to itself, so the sandbox needs its own
  // node_modules entry. A symlink keeps the copy cheap and keeps the suite off
  // the network — a gate that needs a registry is a gate that fails on a plane.
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(hub, "node_modules"), "dir");

  fs.mkdirSync(target, { recursive: true });
  run("git", ["init", "-q", "."], { cwd: target });
  run("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: target,
    env: {
      GIT_AUTHOR_NAME: "qa",
      GIT_AUTHOR_EMAIL: "qa@example.invalid",
      GIT_COMMITTER_NAME: "qa",
      GIT_COMMITTER_EMAIL: "qa@example.invalid",
    },
  });

  fs.mkdirSync(installDir, { recursive: true });

  const reposFile = path.join(root, "repos.json");
  fs.writeFileSync(
    reposFile,
    JSON.stringify([{ path: target, label: "qa-test-target", group: null, team: null }], null, 2)
  );
  const badReposFile = path.join(root, "bad-repos.json");
  fs.writeFileSync(
    badReposFile,
    JSON.stringify([{ path: path.join(root, "no-such-target"), label: "qa-missing-target" }], null, 2)
  );

  return { root, hub, target, installDir, newHub: "", reposFile, badReposFile, repoRoot };
}

/** Invoke the CLI exactly as a user would: through the published bin shim. */
export function cli(sb: Sandbox, args: string[], opts: RunOptions = {}): RunResult {
  return run(process.execPath, [path.join(sb.hub, "bin", "agentboot.js"), ...args], {
    cwd: opts.cwd ?? sb.hub,
    ...opts,
  });
}

/** Save a file's bytes and hand back a restore function. */
export function snapshot(p: string): () => void {
  const before = fs.readFileSync(p);
  return () => fs.writeFileSync(p, before);
}
