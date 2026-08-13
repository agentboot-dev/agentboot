/**
 * D17 (ruled 2026-08-11) — `sync.signing.enabled` defaults ON at 1.0.
 *
 * Same irreversible-at-tag shape as the capability gate: tightening a security
 * default AFTER 1.0 breaks hubs that used to sync clean, so it is now or never.
 * Until this it defaulted `false`, which landed every adopter on the caveated
 * side of both headline tamper-evidence claims in docs/assurance-claims.md
 * (claims 3 and 14 each read "ONLY with `sync.signing` enabled").
 *
 * THE SECOND HALF IS THE IMPORTANT HALF. Flipping a security default ON while
 * the unconfigured path silently no-ops does not make anything safer — it makes
 * the operator believe they are covered while nothing signs. That is this
 * product's signature failure class (a green surface over a control that is not
 * running), and shipping the flip without a named diagnostic would have
 * manufactured a fresh instance of it at 1.0. So the no-key state is NAMED, and
 * is distinguishable from the deliberately-off state by construction.
 *
 * Both directions on every assertion: a hub that turned signing off must still
 * get silence (an opt-out that nags is an outage), and a fully-configured hub
 * must produce a key path and no error.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadConfig,
  resolveSyncSigning,
  applySyncSigningDefault,
  SYNC_SIGNING_DEFAULT_ENABLED,
  type AgentBootConfig,
} from "../scripts/lib/config.js";

let dir: string;

/** Write a hub config and load it through the real loader. */
function load(cfg: Record<string, unknown>): AgentBootConfig {
  const p = path.join(dir, `cfg-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify({ org: "acme", ...cfg }, null, 2));
  return loadConfig(p);
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-signing-default-"));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("D17 — the default", () => {
  it("is ON", () => {
    expect(SYNC_SIGNING_DEFAULT_ENABLED).toBe(true);
  });

  it("a hub with NO sync block at all gets signing enabled", () => {
    expect(load({}).sync?.signing?.enabled).toBe(true);
  });

  it("a hub with a sync block but no signing block gets signing enabled", () => {
    expect(load({ sync: { repos: "./repos.json" } }).sync?.signing?.enabled).toBe(true);
  });

  it("an EXPLICIT false is honoured — the flip is a default, not a mandate", () => {
    // Without this the "default" would be a forced setting, and the opt-out
    // documented in the diagnostic below would be a lie.
    expect(load({ sync: { signing: { enabled: false } } }).sync?.signing?.enabled).toBe(false);
  });

  it("applySyncSigningDefault never overwrites an explicit value", () => {
    for (const explicit of [true, false]) {
      const c = { org: "acme", sync: { signing: { enabled: explicit } } } as AgentBootConfig;
      applySyncSigningDefault(c);
      expect(c.sync!.signing!.enabled).toBe(explicit);
    }
  });

  it("an explicit `enabled: true` with no key is still a hard config error", () => {
    // Pre-existing validation, and it must survive the flip: an operator who
    // TYPED `enabled: true` made a claim they cannot honour, which is different
    // from inheriting a default.
    expect(() => load({ sync: { signing: { enabled: true } } }))
      .toThrow(/requires "sync\.signing\.sshKeyPath"/);
  });
});

describe("D17 — the no-key path degrades with a NAMED error, not silence", () => {
  it("names the reason nothing will be signed", () => {
    const r = resolveSyncSigning(load({}), dir);
    expect(r.enabled).toBe(true);
    expect(r.keyPath).toBeNull();
    expect(r.error).toBeTruthy();
    // The diagnostic has to carry the key, the consequence and BOTH remedies —
    // a message that only says "not signed" leaves the operator with no move.
    expect(r.error).toContain("sync.signing.sshKeyPath");
    expect(r.error).toMatch(/not tamper-evident/i);
    expect(r.error).toMatch(/enabled to false/);
  });

  it("SILENCE is reserved for the hub that deliberately turned signing off", () => {
    const r = resolveSyncSigning(load({ sync: { signing: { enabled: false } } }), dir);
    expect(r.enabled).toBe(false);
    expect(r.keyPath).toBeNull();
    // Same keyPath as the case above, different meaning — which is exactly the
    // conflation that made the old `enabled && sshKeyPath ? … : null` expression
    // unable to report anything.
    expect(r.error).toBeNull();
  });

  it("a fully configured hub resolves an ABSOLUTE key path and no error", () => {
    const r = resolveSyncSigning(
      load({ sync: { signing: { enabled: true, sshKeyPath: "keys/id_ed25519" } } }),
      dir,
    );
    expect(r.enabled).toBe(true);
    expect(r.keyPath).toBe(path.resolve(dir, "keys/id_ed25519"));
    expect(r.error).toBeNull();
  });

  it("a key given without `enabled` now signs — that IS the flip, observable", () => {
    // Before D17 this hub configured a key and signed nothing.
    const r = resolveSyncSigning(load({ sync: { signing: { sshKeyPath: "k" } } }), dir);
    expect(r.enabled).toBe(true);
    expect(r.keyPath).toBe(path.resolve(dir, "k"));
    expect(r.error).toBeNull();
  });
});
