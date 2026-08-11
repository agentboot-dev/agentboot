/**
 * Secret-scan parity: build-time defaults ⊇ runtime hook value patterns.
 *
 * The generated runtime hooks (input-scan UserPromptSubmit, output-scan Stop —
 * see compile.ts) block bare credential VALUES. Defense-in-depth must be
 * strongest at the earliest gate, so `validate --strict`'s DEFAULT_SECRET_PATTERNS
 * must catch every value format the runtime hooks catch. Each canary below is an
 * invented, non-functional credential in one runtime pattern class; if a pattern
 * is added to a hook without a build-time counterpart, add a canary here and
 * watch it fail.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanForSecrets, DEFAULT_SECRET_PATTERNS } from "../scripts/lib/frontmatter.js";
import { scanComponentForSecrets } from "../scripts/lib/contribution.js";
import { agentbootNpxSpec } from "../scripts/lib/config.js";

describe("agentbootNpxSpec", () => {
  it("pins the exact package version", () => {
    expect(agentbootNpxSpec()).toMatch(/^agentboot@\d+\.\d+\.\d+/);
  });
});

// Canaries are assembled by concatenation so no secret-SHAPED literal exists in
// this file — GitHub push protection (correctly) refuses pushes containing
// provider-token-format strings, including invented ones.
const j = (...parts: string[]) => parts.join("");
const RUNTIME_VALUE_CANARIES: Array<[string, string]> = [
  // [pattern class, canary value — invented / AWS docs example, never real]
  ["AWS access key id (bare value)", j("aws username is AKIA", "IOSFODNN7EXAMPLE", " for smtp")],
  ["OpenAI-style key", j("sk-", "abcdefghijklmnopqrstuvwx1234")],
  ["Anthropic key", j("sk-ant-api", "03-abcdefghijklmnopqrstuv")],
  ["GitHub token", j("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789")],
  ["Slack token", j("xoxb-", "123456789012-abcdefghijklmnop")],
  ["Stripe live key", j("sk_live_", "abcdefghijklmnopqrstuvwx")],
  ["RSA private key header", j("-----BEGIN RSA ", "PRIVATE KEY-----")],
  ["DSA private key header", j("-----BEGIN DSA ", "PRIVATE KEY-----")],
  ["OpenSSH private key header", j("-----BEGIN OPENSSH ", "PRIVATE KEY-----")],
  ["JWT (header.payload)", j("token eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0 pasted")],
];

describe("build-time secret scan covers runtime hook value formats", () => {
  for (const [label, canary] of RUNTIME_VALUE_CANARIES) {
    it(`flags ${label}`, () => {
      expect(scanForSecrets(canary).length).toBeGreaterThan(0);
    });
  }
});

describe("build-time scan does not flag documentation placeholders", () => {
  const placeholders = [
    "Set apiKey: YOUR_KEY_HERE in the config",     // unquoted placeholder label
    "password: <your-password>",                    // unquoted angle-bracket placeholder
    "The token field accepts any string",           // prose mentioning 'token'
  ];
  for (const text of placeholders) {
    it(`passes: ${text.slice(0, 40)}`, () => {
      expect(scanForSecrets(text)).toEqual([]);
    });
  }
});

/**
 * L3 — the PRE-PUBLISH scan was the weakest gate on the credential path.
 *
 * `scanComponentForSecrets` (scripts/lib/contribution.ts) — the one scanner both
 * submission paths use, `marketplace publish` and `validateContribution` — kept
 * its own seven-pattern list while the build-time set grew to nineteen. Measured
 * gap: twelve pattern classes the publish path could not see, including the
 * label forms (password/api_key/secret/token), the AWS key NAMES, four of the
 * five GitHub token prefixes, three of the five Slack ones, Anthropic keys,
 * Google keys, DB URLs with inline credentials, `Bearer`, Azure `AccountKey=`,
 * npm tokens and GitLab PATs.
 *
 * That ordering is backwards. Build-time catches a credential inside the repo
 * that already holds it; PUBLISH is the last gate before the same credential
 * goes out to everyone. A prior fix unified the two publish COPIES with each
 * other and stopped there, so "one scanner" was true and "the strongest one" was
 * not — the same green-surface class the unification was meant to end.
 *
 * The list is gone: the publish path now scans with DEFAULT_SECRET_PATTERNS
 * directly, so identity is structural rather than maintained. These canaries
 * make a DRIFT on either side loud:
 *
 *   - drop a pattern from the canonical set  -> its exclusive canary goes dark
 *     on BOTH sides, and both suites go red;
 *   - re-fork a weaker list into the publish path -> the publish suite goes red
 *     while the build suite stays green, naming exactly which classes were lost;
 *   - add a canonical pattern with no canary -> the coverage test goes red,
 *     which is what keeps this table honest as the set grows.
 */
const PARITY_CANARIES: Array<[string, string]> = [
  ["password label (quoted value)", j("password: ", '"', "hunter2-not-a-real-value", '"')],
  ["api_key label (quoted value)", j("api_key: ", '"', "abcd1234notreal", '"')],
  ["token label (quoted value)", j("token: ", '"', "abcd1234notreal", '"')],
  ["AWS key NAME (aws_secret_key)", "export aws_secret_key from the vault"],
  ["AWS access key id", j("AKIA", "IOSFODNN7EXAMPLE")],
  ["JWT (header.payload)", j("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0")],
  ["PEM private key header", j("-----BEGIN EC ", "PRIVATE KEY-----")],
  ["GitHub PAT (ghp_)", j("ghp_", "a".repeat(36))],
  ["GitHub OAuth (gho_)", j("gho_", "b".repeat(36))],
  ["GitHub user-to-server (ghu_)", j("ghu_", "c".repeat(36))],
  ["GitHub server-to-server (ghs_)", j("ghs_", "d".repeat(36))],
  ["GitHub refresh (ghr_)", j("ghr_", "e".repeat(36))],
  ["Slack bot token (xoxb-)", j("xoxb-", "123456789012-abcdefghijklmnop")],
  ["Slack app token (xoxa-)", j("xoxa-", "123456789012-abcdefghijklmnop")],
  ["Slack refresh token (xoxr-)", j("xoxr-", "123456789012-abcdefghijklmnop")],
  ["Slack legacy token (xoxs-)", j("xoxs-", "123456789012-abcdefghijklmnop")],
  ["Anthropic key", j("sk-ant-api", "03-abcdefghijklmnopqrstuv")],
  ["OpenAI-style key", j("sk-", "abcdefghijklmnopqrstuvwx1234")],
  ["Google API key", j("AIza", "a".repeat(35))],
  ["DB URL with inline credentials", j("postgres://", "svc:hunter2@db.example.com:5432/app")],
  ["Bearer token", j("Authorization header uses Bearer ", "abcdefghijklmnop1234")],
  ["Azure storage AccountKey", j("DefaultEndpointsProtocol=https;AccountName=x;AccountKey=", "a".repeat(40), "==")],
  ["Stripe live key", j("sk_live_", "abcdefghijklmnopqrstuvwx")],
  ["npm token", j("npm_", "f".repeat(36))],
  ["GitLab PAT", j("glpat-", "abcdefghijklmnopqrstuv")],
];

describe("L3 — the canary table covers the canonical pattern set exactly", () => {
  const matchers = (text: string) => DEFAULT_SECRET_PATTERNS.filter((p) => p.test(text));

  it("every canonical pattern has at least one canary", () => {
    const uncovered = DEFAULT_SECRET_PATTERNS
      .filter((p) => !PARITY_CANARIES.some(([, v]) => p.test(v)))
      .map((p) => p.source);
    expect(
      uncovered,
      "a pattern with no canary can be dropped from either side without a test noticing",
    ).toEqual([]);
  });

  it("every canary isolates ONE pattern, so a drop makes it go dark", () => {
    // A canary matched by two patterns keeps passing when one of them is
    // deleted — a check that cannot fail for the case it was written for.
    for (const [label, value] of PARITY_CANARIES) {
      expect(matchers(value).map((p) => p.source), `${label} is not exclusive`).toHaveLength(1);
    }
  });
});

describe("L3 — pre-publish scan is not weaker than the build-time scan", () => {
  let dir = "";
  beforeEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-l3-parity-"));
  });
  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** What the publish gate sees for a component whose only file holds `text`. */
  const publishHits = (text: string): string[] => {
    fs.writeFileSync(path.join(dir, "leak.md"), `${text}\n`);
    const r = scanComponentForSecrets(dir);
    expect(r.scanned.length, "zero files scanned is a FAILURE, not a pass").toBeGreaterThan(0);
    return r.hits;
  };

  for (const [label, canary] of PARITY_CANARIES) {
    it(`pre-publish flags ${label}`, () => {
      // Stated as a parity claim, not two independent assertions: the build-time
      // side is the definition of the bar the publish side must meet.
      expect(scanForSecrets(canary).length, `${label} regressed at BUILD time`).toBeGreaterThan(0);
      expect(
        publishHits(canary),
        `${label} ships through publish — the LAST gate before it is public`,
      ).toContain("leak.md");
    });
  }

  it("NEGATIVE: prose about credentials still does not trip the publish gate", () => {
    // A scan that cries wolf on documentation gets bypassed, after which it
    // finds nothing at all. The canonical set's label patterns require a QUOTED
    // value for exactly this reason.
    expect(
      publishHits("# Handling credentials\nNever paste a password or api_key into a PR description."),
    ).toEqual([]);
  });

  it("NEGATIVE: a clean component produces no hits at all", () => {
    fs.writeFileSync(path.join(dir, "clean.md"), "nothing here\n");
    const r = scanComponentForSecrets(dir);
    expect(r.scanned.length).toBeGreaterThan(0);
    expect(r.hits).toEqual([]);
  });
});
