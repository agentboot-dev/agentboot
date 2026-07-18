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
import { describe, it, expect } from "vitest";
import { scanForSecrets } from "../scripts/lib/frontmatter.js";
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
