/**
 * R2-6 — the pre-publish secret scan read `.md` files in ONE directory.
 *
 * `contentFiles` is `readdirSync(componentDir)` filtered to `.md`,
 * non-recursive, while `publish` ships the whole component directory. So the
 * two files most likely to carry a credential — a config, and anything one
 * directory down — were the two the scan could not see.
 *
 * Repro on a snapshot: `sk-…` in the SHIPPED persona.config.json and
 * `AKIAIOSFODNN7EXAMPLE` in nested/leak.md, then
 * `marketplace publish persona/code-reviewer --dry-run` -> "✓ No secrets
 * detected", EXIT=0.
 *
 * The round-3 report said this was left open for want of an end-to-end repro.
 * The repro is above and takes two file writes; what was actually missing was
 * the manifest `license` the check requires before it reaches the scan.
 *
 * Severity stays LOW — `publish` is `{hidden:true}` and submits nothing today —
 * which is a reason it has not bitten, not a reason to ship a scan whose green
 * tick means "the top-level markdown is clean".
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/**
 * The command reads `core/personas/<name>` relative to the CLI's own ROOT, so
 * the fixture is a COPY of the repo tree, never the repo itself.
 */
let snap = "";
let personaDir = "";

/**
 * Normalise the separator in a report before matching a nested path in it.
 *
 * The scanner names hits with `path.relative`, so a hit one directory down
 * prints as `nested/leak.md` on POSIX and `nested\leak.md` on Windows. Both
 * assertions below matched the POSIX spelling literally, so the Windows leg
 * read "expected '…✗ Secrets detected in 1 file(s): nested\leak.md…' to
 * contain 'nested/leak.md'" — the scan had walked into the subdirectory, found
 * the credential, exited 1 and NAMED the file. Only the separator differed.
 *
 * This keeps the invariant these two tests exist for — a secret one directory
 * DOWN is found, and the report says which file — and drops the separator,
 * which is the OS's business and not the scanner's. The non-recursive,
 * `.md`-only scanner they were written against fails them just as dead either
 * way: it never names the file at all, under any spelling.
 */
const slash = (s: string) => s.replace(/\\/g, "/");

const publish = () => {
  const r = spawnSync(
    process.execPath,
    [path.join(snap, "bin", "agentboot.js"), "marketplace", "publish", "persona/code-reviewer", "--dry-run"],
    { cwd: snap, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 120_000 },
  );
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

beforeEach(() => {
  if (snap) fs.rmSync(snap, { recursive: true, force: true });
  snap = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r26-"));
  for (const d of ["bin", "scripts", "core", "package.json", "node_modules"]) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) continue;
    // L40: a plain directory symlink needs SeCreateSymbolicLinkPrivilege on
    // Windows and throws EPERM without it. This is a module-level beforeEach,
    // so that EPERM failed EVERY test in the file — including the second
    // describe, which touches nothing platform-specific.
    //
    // Guarding the tests would have been the cheap fix and the wrong one: this
    // file is the pre-publish SECRET SCAN's only end-to-end coverage, and
    // skipping it on Windows to keep the Windows leg green is the same
    // green-over-nothing trade the product exists to refuse. A junction is the
    // portable equivalent for a directory link, needs no privilege, and keeps
    // the scan under test on every platform. The link is pure scaffolding —
    // it exists so the fixture does not copy node_modules — so nothing about
    // what is asserted depends on which link type carries it.
    if (d === "node_modules") {
      fs.symlinkSync(src, path.join(snap, d), process.platform === "win32" ? "junction" : "dir");
    }
    else fs.cpSync(src, path.join(snap, d), { recursive: true });
  }
  personaDir = path.join(snap, "core", "personas", "code-reviewer");
  // The license gate runs BEFORE the scan; without it the scan is never reached,
  // which is what made this look un-reproducible.
  fs.writeFileSync(
    path.join(personaDir, "manifest.json"),
    JSON.stringify({ name: "code-reviewer", license: "Apache-2.0" }, null, 2),
  );
});

afterAll(() => {
  if (snap) fs.rmSync(snap, { recursive: true, force: true });
});

describe("R2-6 — the pre-publish scan covers what publish SHIPS", () => {
  it("PRECONDITION: a clean component passes, and says how much it scanned", () => {
    const r = publish();
    expect(r.status, r.out).toBe(0);
    expect(r.out, "a green tick with no coverage stated is the shape of this whole finding")
      .toMatch(/file\(s\) scanned, recursively/);
  }, 120_000);

  it("R2-6: a secret in the SHIPPED persona.config.json is found", () => {
    const p = path.join(personaDir, "persona.config.json");
    const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
    cfg.note = "sk-abcdefghijklmnopqrstuvwxyz012345";
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    const r = publish();
    expect(r.status, `a credential shipped in a config the scan could not see:\n${r.out}`).toBe(1);
    expect(r.out).toContain("persona.config.json");
  }, 120_000);

  it("R2-6: a secret one directory DOWN is found", () => {
    fs.mkdirSync(path.join(personaDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(personaDir, "nested", "leak.md"), "AKIAIOSFODNN7EXAMPLE\n");
    const r = publish();
    expect(r.status, r.out).toBe(1);
    expect(slash(r.out), r.out).toContain("nested/leak.md");
  }, 120_000);

  it("R2-6: the widened pattern set catches a private key and a Slack token", () => {
    fs.writeFileSync(
      path.join(personaDir, "extra.txt"),
      "-----BEGIN RSA PRIVATE KEY-----\nxox" + "b-1234-abcd\n",
    );
    expect(publish().status).toBe(1);
  }, 120_000);

  it("R2-6: EVERY offending file is named, not just the first", () => {
    fs.writeFileSync(path.join(personaDir, "a.md"), "AKIAIOSFODNN7EXAMPLE\n");
    fs.mkdirSync(path.join(personaDir, "n"), { recursive: true });
    fs.writeFileSync(path.join(personaDir, "n", "b.md"), "ghp_" + "a".repeat(36) + "\n");
    const r = publish();
    expect(r.status).toBe(1);
    expect(r.out).toContain("a.md");
    // Same normalisation as above rather than a second idiom (`path.join`) for
    // the same question one screen away. Two spellings of one rule in one file
    // is how the next reader picks the one that is wrong on their platform.
    expect(slash(r.out), r.out).toContain("n/b.md");
  }, 120_000);

  it("NEGATIVE: prose about credentials does not trip it", () => {
    // A persona ABOUT credential handling legitimately contains the words. A
    // scan that cries wolf on documentation gets bypassed, and then finds
    // nothing at all.
    fs.writeFileSync(
      path.join(personaDir, "guide.md"),
      "# Handling credentials\nNever paste a password or api_key into a PR description.\n",
    );
    expect(publish().status).toBe(0);
  }, 120_000);
});

/**
 * R2-6 (sibling) — the SECOND copy of the same scanner, found by grepping the
 * pattern rather than the symptom.
 *
 * `validateContribution` (scripts/lib/contribution.ts) carried its own copy of the
 * pre-publish secret scan, and the two had already drifted: it had four of the
 * seven patterns (no PEM private key, no Stripe live key, no JWT) and the same
 * `.md`-only, non-recursive scope. Fixing the reported instance and leaving this
 * one is how this class keeps returning — so there is one scanner now, and these
 * assert that BOTH entry points get it.
 *
 * Both paths also did `try { JSON.parse(manifest) } catch {}` and then reported
 * "No license in manifest", which sends a contributor to add a field that is
 * already there instead of to the syntax error one line above it.
 */
describe("R2-6 sibling — validateContribution shares the one scanner", () => {
  let dir = "";
  beforeEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-r26b-"));
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: x\n---\n# x\nbody\n");
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ name: "x", license: "Apache-2.0" }, null, 2),
    );
  });

  const findings = async () => {
    const { validateContribution } = await import("../scripts/lib/contribution.js");
    return validateContribution(dir, { layer: "community" });
  };
  const check = async (name: string) =>
    (await findings()).checks.find((c: { name: string }) => c.name === name);

  it("PRECONDITION: a clean component passes and states its coverage", async () => {
    const c = await check("no-secrets");
    expect(c?.passed).toBe(true);
    expect(c?.message).toMatch(/file\(s\) scanned, recursively/);
  });

  it("R2-6 sibling: a secret one directory DOWN is found here too", async () => {
    fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(dir, "nested", "leak.md"), "AKIAIOSFODNN7EXAMPLE\n");
    const c = await check("no-secrets");
    expect(c?.passed, "the second copy of the scanner was still .md-only/non-recursive").toBe(false);
    expect(slash(c?.message ?? ""), c?.message).toContain("nested/leak.md");
  });

  it("R2-6 sibling: a secret in a NON-.md file is found here too", async () => {
    fs.writeFileSync(path.join(dir, "persona.config.json"), '{"note":"sk-abcdefghijklmnopqrstuvwxyz012345"}');
    expect((await check("no-secrets"))?.passed).toBe(false);
  });

  it("R2-6 sibling: the patterns the two copies disagreed about are covered", async () => {
    // This copy had four of seven. A PEM private key was invisible to it.
    fs.writeFileSync(path.join(dir, "key.txt"), "-----BEGIN OPENSSH PRIVATE KEY-----\n");
    expect((await check("no-secrets"))?.passed).toBe(false);
  });

  it("an UNREADABLE manifest is its own finding, not 'No license'", async () => {
    fs.writeFileSync(path.join(dir, "manifest.json"), "{ not json");
    const all = await findings();
    const readable = all.checks.find((c: { name: string }) => c.name === "manifest-readable");
    expect(readable?.passed, "a corrupt manifest reported as a missing field").toBe(false);
    expect(readable?.message).toMatch(/unreadable/i);
  });
});
