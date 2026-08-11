/**
 * L?-5 — `agentboot lint` must scan with the CANONICAL secret set, not a third copy.
 *
 * L3 unified the build-time scanner and the pre-publish scanner on
 * `DEFAULT_SECRET_PATTERNS` (scripts/lib/frontmatter.ts) and pinned that set
 * against the generated runtime hooks in tests/secret-parity.test.ts. A third
 * list survived that unification inside `scripts/cli.ts`: the `lint` command's
 * `credential-in-prompt` rule carried its own five regexes — an OpenAI-style
 * key, one GitHub prefix, an AWS key id, a JWT and a quoted password.
 *
 * Thirteen canonical classes were invisible to it. A persona could ship a Slack
 * bot token, an Anthropic key, a `-----BEGIN … PRIVATE KEY-----` block, a
 * Postgres URL with inline credentials, an Azure `AccountKey=`, a Stripe live
 * key, an npm token or a GitLab PAT, and `agentboot lint` would print a clean
 * bill of health over it. That is the failure this product exists to catch:
 * a control reporting success while enforcing a fraction of what it claims.
 *
 * This file measures the LINT SURFACE end-to-end rather than reading the source,
 * so it stays true however `cli.ts` is refactored: it drives the real command
 * and asserts a finding for every canonical pattern class. Drop a pattern from
 * the canonical set and secret-parity.test.ts goes red; re-fork lint onto a
 * private list and this file goes red.
 *
 * The canaries are assembled by concatenation so no secret-SHAPED literal exists
 * in this file — GitHub push protection refuses pushes containing provider-token
 * formats, including invented ones. Same convention as secret-parity.test.ts.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SECRET_PATTERNS } from "../scripts/lib/frontmatter.js";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "scripts", "cli.ts");

const j = (...parts: string[]) => parts.join("");

/**
 * One canary per canonical pattern class, in the same order as
 * DEFAULT_SECRET_PATTERNS. The count assertion below fails loudly if the
 * canonical set grows without a canary being added here — an unpaired pattern
 * would otherwise go unmeasured on the lint surface, which is exactly how the
 * third list stayed invisible.
 */
const CANARIES: Array<[string, string]> = [
  ["quoted password label", `password: "hunter2placeholder"`],
  ["quoted api_key label", `api_key: "abcdefghijklmnop"`],
  ["quoted token label", `token: "abcdefghijklmnop"`],
  ["aws key NAME", "set aws_secret_key in the env"],
  ["AWS access key id", j("AKIA", "IOSFODNN7EXAMPLE")],
  ["JWT header.payload", j("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0")],
  ["private key header", j("-----BEGIN RSA ", "PRIVATE KEY-----")],
  ["GitHub token", j("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789")],
  ["Slack token", j("xoxb-", "123456789012-abcdefghijklmnop")],
  ["Anthropic key", j("sk-ant-api", "03-abcdefghijklmnopqrstuv")],
  ["OpenAI key", j("sk-", "abcdefghijklmnopqrstuvwx1234")],
  ["Google API key", j("AIza", "SyD-abcdefghijklmnopqrstuvwxyz01234")],
  ["DB URL with inline credentials", "postgres://user:swordfish@db.internal:5432/app"],
  ["Bearer token", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"],
  ["Azure connection string", j("DefaultEndpointsProtocol=https;AccountKey=", "abcdefghijklmnopqrstuvwx==")],
  ["Stripe live key", j("sk_live_", "abcdefghijklmnopqrstuvwx")],
  ["npm token", j("npm_", "abcdefghijklmnopqrstuvwxyz0123456789")],
  ["GitLab PAT", j("glpat-", "abcdefghijklmnopqrstuvwx")],
];

/** Lines that must NOT trip the rule — a scanner that flags everything is not a scanner. */
const CLEAN_LINES = [
  "Explain the deployment token rotation policy to the operator.",
  "Read the API key from the environment; never inline it.",
  "Prefer short-lived credentials over long-lived secrets.",
];

/**
 * Builds a throwaway repo whose one persona contains the supplied body lines,
 * runs the real `agentboot lint --format json`, and returns its findings.
 */
function lintLines(bodyLines: string[]): Array<{ rule: string; line?: number; message?: string }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-lint-parity-"));
  try {
    const personaDir = path.join(tempDir, "core", "personas", "canary");
    fs.mkdirSync(personaDir, { recursive: true });
    // Frontmatter is 4 lines, then a blank line: body line N is file line N + 5.
    fs.writeFileSync(
      path.join(personaDir, "SKILL.md"),
      `---\nname: canary\ndescription: parity probe\n---\n\n${bodyLines.join("\n")}\n`,
    );
    fs.writeFileSync(
      path.join(tempDir, "agentboot.config.json"),
      JSON.stringify({ org: "test", personas: { enabled: ["canary"] }, traits: { enabled: [] } }),
    );

    const configPath = path.join(tempDir, "agentboot.config.json");
    let stdout: string;
    try {
      stdout = execFileSync(
        TSX,
        [CLI, "lint", "--config", configPath, "--format", "json"],
        { cwd: tempDir, encoding: "utf-8", env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" }, timeout: 60_000 },
      );
    } catch (err: unknown) {
      // lint exits non-zero when it finds errors — that is the expected path here.
      const e = err as { stdout?: string };
      stdout = e.stdout ?? "";
    }
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const BODY_OFFSET = 5; // frontmatter (4 lines) + blank separator

describe("lint scans with the canonical secret set", () => {
  it("has one canary per canonical pattern — an unpaired pattern is unmeasured", () => {
    expect(
      CANARIES.length,
      "DEFAULT_SECRET_PATTERNS changed size without this file changing. Add (or remove) " +
      "a canary so every canonical pattern class is exercised against the lint surface.",
    ).toBe(DEFAULT_SECRET_PATTERNS.length);
  });

  // The whole canary set goes through lint in ONE process; per-canary assertions
  // read off the result. Spawning the CLI eighteen times costs a minute for no
  // extra signal.
  const findings = lintLines(CANARIES.map(([, canary]) => canary));
  const credLines = new Set(
    findings.filter((f) => f.rule === "credential-in-prompt").map((f) => f.line),
  );

  for (const [i, [label]] of CANARIES.entries()) {
    it(`flags ${label}`, () => {
      expect(
        credLines.has(i + 1 + BODY_OFFSET),
        `lint reported no credential-in-prompt for the ${label} canary. Its pattern is in ` +
        `DEFAULT_SECRET_PATTERNS, so lint is scanning with a private list again — the ` +
        `exact third-copy defect L3 was supposed to have ended. Bind lint to ` +
        `DEFAULT_SECRET_PATTERNS in scripts/cli.ts.`,
      ).toBe(true);
    });
  }

  it("does not flag prose that merely talks about credentials", () => {
    const clean = lintLines(CLEAN_LINES).filter((f) => f.rule === "credential-in-prompt");
    expect(
      clean,
      "A scanner that flags every mention of the word 'token' trains adopters to ignore it. " +
      "These lines contain no credential value and no quoted label.",
    ).toEqual([]);
  });
});
