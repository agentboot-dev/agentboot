/**
 * G1a / AB-DEF-10 — a permission rule the platform never consults must not
 * validate, sign and ship as if it were a control.
 *
 * `claude.permissions` is a pass-through. Before this, the ONLY thing inspected
 * was shape (allow/deny are arrays); the rule VERBS were never looked at. So
 *
 *     "claude": { "permissions": { "deny": ["Write(**\/.env)"] } }
 *
 * compiled clean, passed `validate --strict`, was signed into the manifest, and
 * was distributed to the non-overridable managed-settings channel — a control
 * that enforces nothing, certified by the product whose thesis is
 * verify-don't-trust. One instance is live in a beta adopter's policy.
 *
 * Claude Code's file permission check consults exactly two rule verbs,
 * `Edit(path)` and `Read(path)`, each covering its whole tool family.
 * `Write(path)`, `MultiEdit(path)`, `NotebookEdit(path)` and `Glob(path)` are
 * matched by nothing. Ground truth and the citation are in
 * scripts/lib/permission-rules.ts.
 *
 * These tests drive the actual CLI on a scaffolded hub: the rule must be
 * rejected by `validate --strict` naming the effective verb, the corrected form
 * must pass, and `build` — which never calls validate — must say so too.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  INERT_PATH_RULE_VERBS,
  parsePermissionRule,
  inertPermissionRules,
  permissionRuleLists,
} from "../../scripts/lib/permission-rules.js";

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "bin", "agentboot.js");

/** Status read WITHOUT a pipe — a piped $? is the pipe's. */
function ab(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf-8",
    timeout: 300_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

let base: string;
let hub: string;
/**
 * The scaffolded hub carries unrelated strict-mode warnings of its own (an
 * unenabled sample persona, an empty governed-artifact set). Recording the
 * clean-config exit code makes the "corrected rule passes" assertion mean
 * "this check contributed nothing", instead of silently depending on an
 * otherwise-green fixture.
 */
let baselineStrictStatus: number;

function setPermissions(permissions: unknown | undefined, groups?: unknown): void {
  const p = path.join(hub, "agentboot.config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf-8"));
  c.personas = { ...(c.personas ?? {}), outputFormats: ["claude"] };
  c.claude = { ...(c.claude ?? {}) };
  if (permissions === undefined) delete c.claude.permissions;
  else c.claude.permissions = permissions;
  if (groups === undefined) delete c.groups;
  else c.groups = groups;
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

/** The one check's line plus its indented findings. */
function verbCheckBlock(out: string): string {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.includes("Permission rule verbs"));
  if (i === -1) return "";
  const block = [lines[i]!];
  for (let j = i + 1; j < lines.length && /^ {6}\S/.test(lines[j]!); j++) block.push(lines[j]!);
  return block.join("\n");
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "agentboot-permverb-"));
  hub = path.join(base, "hub");
  const r = spawnSync(
    process.execPath,
    [CLI, "install", "--hub", "--org", "acme", "--path", hub, "--non-interactive", "--skip-sync"],
    { cwd: base, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf-8", timeout: 300_000 },
  );
  if (r.status !== 0) throw new Error(`hub scaffold failed: ${r.stdout}${r.stderr}`);
  setPermissions(undefined);
  baselineStrictStatus = ab(["validate", "--strict"], hub).status;
}, 600_000);

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The acceptance: the live-at-an-adopter rule.
// ---------------------------------------------------------------------------
describe("G1a an inert deny rule does not pass validate", () => {
  it("NEGATIVE: `deny: [\"Write(**/.env)\"]` fails --strict, names the verb, recommends Edit", () => {
    setPermissions({ deny: ["Write(**/.env)"] });
    const r = ab(["validate", "--strict"], hub);
    expect(r.status, r.out).not.toBe(0);

    const block = verbCheckBlock(r.out);
    expect(block).toMatch(/^ {2}✗ Permission rule verbs/m);
    // An ERROR, not a strict-escalated warning: this must fail plain validate too.
    expect(block).toMatch(/ERROR: claude\.permissions\.deny/);
    expect(block).toMatch(/Write\(path\) rules/);
    expect(block).toMatch(/Edit\(\*\*\/\.env\)/);
    expect(block).toMatch(/inert/i);
  });

  it("NEGATIVE: it fails plain `validate` too — the deny form is an error, not a warning", () => {
    setPermissions({ deny: ["Write(**/.env)"] });
    const r = ab(["validate"], hub);
    expect(r.status, r.out).toBe(1);
    expect(verbCheckBlock(r.out)).toMatch(/ERROR: .*Write\(\*\*\/\.env\)/);
  });

  it("POSITIVE: `deny: [\"Edit(**/.env)\"]` passes — the check adds nothing", () => {
    setPermissions({ deny: ["Edit(**/.env)"], allow: ["Read(src/**)"] });
    const strict = ab(["validate", "--strict"], hub);
    expect(verbCheckBlock(strict.out)).toBe("  ✓ Permission rule verbs — no path-scoped rule the platform never consults (an inert control)");
    expect(strict.status, strict.out).toBe(baselineStrictStatus);
    expect(ab(["validate"], hub).status).toBe(0);
  });

  it("POSITIVE: a BARE `deny: [\"Write\"]` passes — blocking the tool outright works", () => {
    setPermissions({ deny: ["Write"] });
    const r = ab(["validate"], hub);
    expect(verbCheckBlock(r.out)).toMatch(/^ {2}✓ Permission rule verbs/m);
    expect(r.status, r.out).toBe(0);
  });

  it("an inert ALLOW is a warning, not an error — nothing is falsely believed enforced", () => {
    setPermissions({ allow: ["Glob(src/**)"] });
    const plain = ab(["validate"], hub);
    expect(plain.status, plain.out).toBe(0);
    expect(verbCheckBlock(plain.out)).toMatch(/WARN: claude\.permissions\.allow.*Read\(src\/\*\*\)/s);

    const strict = ab(["validate", "--strict"], hub);
    expect(strict.status, strict.out).not.toBe(0);
    expect(verbCheckBlock(strict.out)).toMatch(/^ {2}✗ Permission rule verbs/m);
  });

  it("group-scope permissions are inspected too — not just the org block", () => {
    setPermissions(undefined, { platform: { teams: ["core"], permissions: { deny: ["MultiEdit(**/*.pem)"] } } });
    const r = ab(["validate"], hub);
    expect(r.status, r.out).toBe(1);
    expect(verbCheckBlock(r.out)).toMatch(/ERROR: groups\.platform\.permissions\.deny.*Edit\(\*\*\/\*\.pem\)/s);
    setPermissions(undefined);
  });
});

// ---------------------------------------------------------------------------
// `build` and `sync` never call validate. The compiler has to say it as well.
// ---------------------------------------------------------------------------
describe("G1a build warns at emit, on the path validate does not sit on", () => {
  it("names the inert rule while writing it to the managed-settings channel", () => {
    setPermissions({ deny: ["Write(**/.env)"] });
    const r = ab(["build"], hub);
    expect(r.status, r.out).toBe(0); // build is not the gate; validate is
    expect(r.out).toMatch(/claude\.permissions\.deny: "Write\(\*\*\/\.env\)" is semantically inert/);
    expect(r.out).toMatch(/Use "Edit\(\*\*\/\.env\)" instead/);

    // And it really did ship it — which is why the warning has to exist.
    const fragment = path.join(hub, "dist", "claude", "core", "managed-settings.d", "00-org.json");
    expect(JSON.parse(fs.readFileSync(fragment, "utf-8")).permissions.deny).toEqual(["Write(**/.env)"]);
  });

  it("stays quiet on the corrected rule", () => {
    setPermissions({ deny: ["Edit(**/.env)"] });
    const r = ab(["build"], hub);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toMatch(/semantically inert/);
  });
});

// ---------------------------------------------------------------------------
// The verb table itself.
// ---------------------------------------------------------------------------
describe("permission-rule verb table", () => {
  it("covers every verb the platform's own validator redirects", () => {
    expect(INERT_PATH_RULE_VERBS).toEqual({
      Write: "Edit",
      MultiEdit: "Edit",
      NotebookEdit: "Edit",
      Glob: "Read",
    });
  });

  it("parses `Tool(spec)` and leaves a bare `Tool` unscoped", () => {
    expect(parsePermissionRule("Write(**/.env)")).toEqual({ toolName: "Write", ruleContent: "**/.env" });
    expect(parsePermissionRule("  Write  ")).toEqual({ toolName: "Write", ruleContent: undefined });
    expect(parsePermissionRule("Bash(npm run test:*)")).toEqual({ toolName: "Bash", ruleContent: "npm run test:*" });
    expect(parsePermissionRule("")).toBeNull();
    expect(parsePermissionRule("(orphan)")).toBeNull();
    expect(parsePermissionRule("Write(unterminated")).toBeNull();
  });

  it("flags each inert verb and no effective one", () => {
    const inert = inertPermissionRules(
      ["Write(a)", "MultiEdit(b)", "NotebookEdit(c)", "Glob(d)"],
      "claude.permissions.deny",
    );
    expect(inert.map((f) => f.suggestion)).toEqual(["Edit(a)", "Edit(b)", "Edit(c)", "Read(d)"]);

    expect(inertPermissionRules(
      ["Edit(a)", "Read(b)", "Bash(npm run build)", "Write", "mcp__x__y", "WebFetch(domain:example.com)"],
      "claude.permissions.deny",
    )).toEqual([]);
  });

  it("exempts the `:*` Bash-prefix form, exactly as the platform validator does", () => {
    expect(inertPermissionRules(["Write(npm run foo:*)"], "claude.permissions.deny")).toEqual([]);
  });

  it("refuses a non-array rather than walking a string character by character", () => {
    expect(inertPermissionRules(undefined, "claude.permissions.deny")).toEqual([]);
    expect(inertPermissionRules("Write(**/.env)" as unknown as string[], "claude.permissions.deny")).toEqual([]);
  });

  it("enumerates every permission-bearing config key so neither caller can miss one", () => {
    const lists = permissionRuleLists({
      claude: { permissions: { deny: ["Write(x)"], allow: [] } },
      groups: { platform: { permissions: { deny: ["Glob(y)"] } } },
    });
    expect(lists.map((l) => l.where).sort()).toEqual([
      "claude.permissions.allow",
      "claude.permissions.deny",
      "groups.platform.permissions.deny",
    ]);
    expect(permissionRuleLists({})).toEqual([]);
  });
});
