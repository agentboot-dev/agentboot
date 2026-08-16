/**
 * The P0 manual-QA cases, mechanised.
 *
 * Scope: the P0 test plans (TP-01 install, TP-02 config/scaffold, TP-03
 * validate, TP-04 build, TP-05 personas, TP-09 sync). Each case here carries
 * the id of the manual case it replaces, so the two can be reconciled by
 * anyone reading either document.
 *
 * Three registers keep this honest, and all three print in the summary:
 *
 *   DIVERGENCES   the written plan is stale and the current behaviour is
 *                 intentional. The case asserts CURRENT behaviour and the
 *                 register records what the plan says, what the product does,
 *                 and the evidence that the change was deliberate.
 *
 *   KNOWN_DEFECTS the current behaviour contradicts the product's OWN docs.
 *                 The case asserts the DOCUMENTED contract and is expected to
 *                 fail (XFAIL). If it ever passes, that is an XPASS and the
 *                 run goes red — a stale register is a lying instrument.
 *
 *   RESIDUE       the part of a case a script cannot judge. Listed in
 *                 docs/manual-testing/p0-manual-residue.md, not here.
 */

import fs from "node:fs";
import path from "node:path";

import {
  assert,
  assertAbsent,
  assertContains,
  assertDir,
  assertExit,
  assertFile,
  assertMatches,
  assertMinLines,
  assertNoStackTrace,
  assertNotContains,
  cli,
  readJsonc,
  run,
  sha256File,
  sha256Tree,
  snapshot,
  tail,
  type Sandbox,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The four personas the P0 plans were written against. */
const CORE_PERSONAS = ["code-reviewer", "security-reviewer", "test-generator", "test-data-expert"];

/** The eight platforms the P0 plans were written against. */
const CORE_PLATFORMS = [
  "skill",
  "claude",
  "copilot",
  "cursor",
  "agents",
  "windsurf",
  "gemini",
  "jetbrains",
];

const INVOCATIONS: Record<string, string> = {
  "code-reviewer": "/review-code",
  "security-reviewer": "/review-security",
  "test-generator": "/gen-tests",
  "test-data-expert": "/gen-testdata",
};

const SKILL_DIRS: Record<string, string> = {
  "code-reviewer": "review-code",
  "security-reviewer": "review-security",
  "test-generator": "gen-tests",
  "test-data-expert": "gen-testdata",
};

const CORE_TRAITS = [
  "critical-thinking",
  "structured-output",
  "source-citation",
  "audit-trail",
  "confidence-signaling",
  "schema-awareness",
];

/**
 * Assembled at runtime, never written as one literal.
 *
 * The secret-scan case needs a string the detector recognises. A committed,
 * ready-to-copy credential shape is the exact thing this product exists to
 * keep out of repos, so the fixture is built from fragments at call time.
 */
function fakeCredential(): string {
  return ["sk", "ant", "api03", "A".repeat(24) + "B".repeat(24) + "C".repeat(24)].join("-");
}

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

export interface Divergence {
  plan: string;
  current: string;
  evidence: string;
}

export const DIVERGENCES: Record<string, Divergence> = {
  "TP-01-4": {
    plan: "help must list exactly 21 named subcommands, including search/pull/catalog/publish",
    current:
      "the marketplace commands (search, pull, catalog, publish) were removed in GA surface pruning; " +
      "the case asserts docs/cli-reference.md and `--help` describe the SAME command set, in both directions",
    evidence: "docs/cli-reference.md carries no heading for the four removed commands",
  },
  "TP-02-1": {
    plan: "`install --hub` scaffolds into the current directory",
    current: "it scaffolds into <cwd>/personas/ and reports the path it chose",
    evidence: "install output: 'Non-interactive mode: creating hub at <cwd>/personas'",
  },
  "TP-02-2": {
    plan: "the scaffolded config must contain a `validation` section",
    current:
      "the scaffold omits it and every key under it defaults; the case asserts the sections the " +
      "compiler actually reads, and that `validation` — if present — is an object",
    evidence: "scripts/lib/config.ts declares `validation?:`; validate.ts reads config.validation?.strictMode ?? false",
  },
  "TP-02-9": {
    plan: "`doctor --fix --dry-run` with dist/ absent exits 1 (issue found, not fixed)",
    current:
      "a missing dist/ is a WARNING, not an error, so doctor exits 0; the load-bearing half of the " +
      "case — that --dry-run does NOT rebuild dist/ — is asserted unchanged",
    evidence: "doctor prints '⚠ dist/ not found — run `agentboot build` (fixable with --fix)'",
  },
  "TP-03-0": {
    plan: "validate runs 7 checks",
    current: "validate runs 15; the case asserts every check passes rather than counting to 7",
    evidence: "validate output enumerates 15 named checks",
  },
  "TP-04-2": {
    plan: "8 platform directories, 4 personas",
    current:
      "9 platforms (codex added) and 5 personas (ai-security-reviewer added); the case asserts the " +
      "plan's 8 and 4 are present and does not fail on additions",
    evidence: "build output: 'Compiled 5 persona(s) × 9 platform(s)'",
  },
  "TP-04-10": {
    plan: "JetBrains output is .junie/guidelines.md",
    current: ".junie/AGENTS.md",
    evidence: "compile.ts: 'Append to concatenated .junie/AGENTS.md (Phase 11 A1f: upgraded from guidelines.md)'",
  },
  "TP-04-11": {
    plan: "compiled output must NOT contain <!-- traits:start --> / <!-- traits:end -->",
    current:
      "the markers are emitted deliberately as annotations delimiting the injected block on the " +
      "Claude agent path; the case asserts the block EXISTS and is full of real trait prose, and " +
      "that Cursor .mdc output (which must not carry HTML comments) has neither marker",
    evidence: "tests/pipeline.test.ts asserts the Claude agent contains the marker and the .mdc does not",
  },
  "TP-04-13": {
    plan: "grep the compiled agent for /react|agentic loop|think.*plan|observation/",
    current:
      "the pattern does not surface as prose — it materialises as frontmatter. The plan's grep matches " +
      "ordinary English and would pass on a wholly broken build, so the case asserts the frontmatter " +
      "contract instead: react is the default pattern, so it contributes maxTurns: 10 and NO agentProfile key",
    evidence: "compile.ts PATTERN_CONFIGS.react = { maxTurns: 10 }; agentProfile is omitted when pattern === 'react'",
  },
  "TP-04-14": {
    plan: "`failOnDirtyDist: true` must fail the build when dist/ exists",
    current:
      "the key is deprecated and ignored — dist/ is rebuilt from empty and pruned every build, so a " +
      "dirty dist/ is structurally impossible. The case asserts the build SUCCEEDS and says so out loud",
    evidence: "docs/configuration.md marks it 'Deprecated, ignored.'; compile.ts prints a deprecation warning",
  },
  "TP-05-1": {
    plan: "grep each compiled Claude skill file for its own invocation id (repeated for TP-05-2/3/4)",
    current:
      "gen-tests and gen-testdata contain no such string, and review-code/review-security only match an " +
      "unrelated example path in the prose — so the plan's grep passes by accident on half the personas " +
      "and fails on the other half. The case asserts the real binding instead: persona.config.json's " +
      "invocation names the skill directory, and that skill's frontmatter delegates to the persona's agent",
    evidence:
      "dist/claude/core/skills/gen-tests/SKILL.md has frontmatter description/context/agent and no id string; " +
      "the only 'review-code' hit in review-code/SKILL.md is a filename example in the body",
  },
  "TP-09-2": {
    plan: "CLAUDE.md lands inside the target's .claude/ directory",
    current: "CLAUDE.md lands at the target repo root, which is where Claude Code reads it",
    evidence: "sync writes CLAUDE.md, AGENTS.md and .mcp.json at the target root",
  },
};

export interface KnownDefect {
  documented: string;
  observed: string;
  why: string;
}

/**
 * Cases whose assertion encodes the product's documented contract and which
 * therefore fail today. They are reported XFAIL and do not redden the run —
 * but they are counted, named, and printed, so nobody can mistake the register
 * for an absence of defects. Fixing one makes its case XPASS, which DOES
 * redden the run until the entry is removed.
 */
export const KNOWN_DEFECTS: Record<string, KnownDefect> = {
  "TP-03-12": {
    documented: "`validate --strict` exits 2 when warnings are present (docs/cli-reference.md)",
    observed: "it exits 1 — strict-escalated warnings fall into the generic failure path",
    why: "validate.ts summary block exits 1 for any effective failure; nothing ever returns 2",
  },
  "TP-04-12": {
    documented:
      "with output.provenanceHeaders: true, at least 2 of {Claude agent, Copilot instructions, Cursor rule} " +
      "carry a 'compiled output — do not edit' header",
    observed:
      "only the Copilot instructions file does. Cursor is deliberate (its .mdc output strips HTML comments), " +
      "but the Claude agents/ path never calls withProvenance() at all, so the most-consumed artifact in the " +
      "tree ships with no provenance while the config claims the control is on",
    why: "compile.ts builds the agent file from its own frontmatter + body and skips withProvenance()",
  },
};

// ---------------------------------------------------------------------------
// Case type
// ---------------------------------------------------------------------------

export interface Case {
  id: string;
  title: string;
  /** returns a one-line evidence note for the report */
  fn: (sb: Sandbox) => string;
}

function distPath(sb: Sandbox, ...parts: string[]): string {
  return path.join(sb.hub, "dist", ...parts);
}

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

// ---------------------------------------------------------------------------
// TP-01 — installation and CLI surface
// ---------------------------------------------------------------------------

const TP01: Case[] = [
  {
    id: "TP-01-PKG",
    title: "the published tarball carries the CLI entry point and the compiler's inputs",
    fn: (sb) => {
      // Substitutes for the packaging half of TP-01-1/-2, which otherwise
      // cannot be checked until after a publish. `npm pack --dry-run` reports
      // the exact file list npm would ship, offline.
      const res = run("npm", ["pack", "--dry-run", "--json"], { cwd: sb.repoRoot });
      assertExit(res, 0, "npm pack --dry-run");
      const start = res.stdout.indexOf("[");
      assert(start >= 0, `npm pack produced no JSON:\n${tail(res.out, 10)}`);
      const parsed = JSON.parse(res.stdout.slice(start)) as Array<{ files: Array<{ path: string }> }>;
      const entry = parsed[0];
      assert(entry !== undefined, "npm pack --json returned an empty array");
      const files = entry!.files.map((f) => f.path);

      assert(files.includes("bin/agentboot.js"), "tarball is missing bin/agentboot.js");
      assert(files.includes("scripts/cli.ts"), "tarball is missing scripts/cli.ts");
      assert(files.includes("package.json"), "tarball is missing package.json");
      const coreFiles = files.filter((f) => f.startsWith("core/"));
      assert(coreFiles.length >= 20, `tarball ships only ${coreFiles.length} core/ files`);
      assert(
        files.some((f) => f.startsWith("templates/")),
        "tarball ships no templates/"
      );
      assert(
        !files.some((f) => f.startsWith("scripts/intelligence/")),
        "tarball leaks scripts/intelligence/ (excluded by package.json files)"
      );

      const pkg = JSON.parse(read(path.join(sb.repoRoot, "package.json"))) as {
        bin?: Record<string, string>;
      };
      const binEntry = pkg.bin?.["agentboot"];
      assert(binEntry !== undefined, "package.json declares no `agentboot` bin");
      const binPath = path.join(sb.repoRoot, binEntry!);
      assertFile(binPath, "declared bin target");
      assertMatches(read(binPath), /^#!\/usr\/bin\/env node/, "bin shim shebang");
      return `${files.length} files in tarball; bin=${binEntry!}`;
    },
  },
  {
    id: "TP-01-3",
    title: "`agentboot --version` agrees with the package AND with what the docs advertise",
    fn: (sb) => {
      const res = cli(sb, ["--version"]);
      assertExit(res, 0, "agentboot --version");
      const printed = res.stdout.trim();
      assertMatches(printed, /^\d+\.\d+\.\d+/, "version string shape");
      const pkg = JSON.parse(read(path.join(sb.hub, "package.json"))) as { version: string };
      assert(
        printed === pkg.version,
        `--version printed ${printed}, package.json says ${pkg.version}`
      );
      // Comparing the CLI against the file the CLI reads proves nothing on its
      // own — bump both and the check stays green. The repo already owns an
      // independent SSOT for the version strings the docs advertise; run it, so
      // the case is anchored to something the binary does not control.
      const guard = run(
        process.execPath,
        [
          path.join(sb.hub, "node_modules", "tsx", "dist", "cli.mjs"),
          path.join(sb.hub, "scripts", "check-version-strings.ts"),
        ],
        { cwd: sb.hub }
      );
      assertExit(guard, 0, `docs advertise a version other than ${printed}`);
      return `version ${printed}, docs version strings agree`;
    },
  },
  {
    id: "TP-01-4",
    title: "`--help` and the CLI reference describe the same command set",
    fn: (sb) => {
      const res = cli(sb, ["--help"]);
      assertExit(res, 0, "agentboot --help");

      const helpSection = res.stdout.split(/^Commands:$/m)[1] ?? "";
      const helpCommands = new Set<string>();
      for (const line of helpSection.split("\n")) {
        const m = /^\s{2}([a-z][a-z0-9-]*)(\s|$)/.exec(line);
        if (m?.[1] && m[1] !== "help") helpCommands.add(m[1]);
      }
      assert(helpCommands.size > 10, `parsed only ${helpCommands.size} commands out of --help`);

      const refText = read(path.join(sb.hub, "docs", "cli-reference.md"));
      const documented = new Set<string>();
      for (const m of refText.matchAll(/^#{2,3} `agentboot ([a-z][a-z0-9-]*)/gm)) {
        documented.add(m[1]!);
      }
      assert(documented.size > 10, `parsed only ${documented.size} commands out of the CLI reference`);

      const undocumented = [...helpCommands].filter((c) => !documented.has(c)).sort();
      const missing = [...documented].filter((c) => !helpCommands.has(c)).sort();
      assert(
        undocumented.length === 0,
        `commands in --help with no CLI-reference entry: ${undocumented.join(", ")}`
      );
      assert(
        missing.length === 0,
        `commands documented in the CLI reference but absent from --help: ${missing.join(", ")}`
      );

      for (const opt of ["--config", "--verbose", "--quiet", "--debug", "--version"]) {
        assertContains(res.stdout, opt, `global option ${opt}`);
      }
      return `${helpCommands.size} commands, help ⇔ docs parity`;
    },
  },
  {
    id: "TP-01-5",
    title: "per-command help lists each command's own flags",
    fn: (sb) => {
      const expected: Record<string, string[]> = {
        build: [],
        validate: ["--strict"],
        sync: ["--repos-file", "--dry-run", "--force"],
        doctor: ["--format", "--fix", "--dry-run"],
      };
      for (const [cmd, flags] of Object.entries(expected)) {
        const res = cli(sb, [cmd, "--help"]);
        assertExit(res, 0, `agentboot ${cmd} --help`);
        assertContains(res.stdout, `Usage: agentboot ${cmd}`, `${cmd} --help usage line`);
        assertContains(res.stdout, "Options:", `${cmd} --help options block`);
        for (const flag of flags) {
          assertContains(res.stdout, flag, `agentboot ${cmd} --help must document ${flag}`);
        }
      }
      return "build/validate/sync/doctor help verified";
    },
  },
  {
    id: "TP-01-6",
    title: "a source install resolves its toolchain and runs validate",
    fn: (sb) => {
      for (const dep of ["vitest", "typescript", "tsx"]) {
        assertDir(path.join(sb.repoRoot, "node_modules", dep), `node_modules/${dep}`);
      }
      const res = cli(sb, ["validate"]);
      assertExit(res, 0, "validate from a source checkout");
      return "vitest, typescript and tsx resolve; validate runs from source";
    },
  },
];

// ---------------------------------------------------------------------------
// TP-02 — config and scaffolding
// ---------------------------------------------------------------------------

const TP02: Case[] = [
  {
    id: "TP-02-1",
    title: "`install --hub --non-interactive` scaffolds a hub",
    fn: (sb) => {
      run("git", ["init", "-q", "."], { cwd: sb.installDir });
      const res = cli(sb, ["install", "--hub", "--non-interactive"], {
        cwd: sb.installDir,
        env: { AGENTBOOT_ORG: "qa-test-org" },
        timeout: 180_000,
      });
      assertExit(res, 0, "agentboot install --hub --non-interactive");

      // See DIVERGENCES["TP-02-1"] — the scaffold lands in <cwd>/personas.
      const hub = path.join(sb.installDir, "personas");
      assertDir(hub, "scaffolded hub");
      sb.newHub = hub;

      for (const d of ["core/personas", "core/traits", "core/instructions"]) {
        assertDir(path.join(hub, d), `scaffolded ${d}`);
      }
      for (const f of ["agentboot.config.json", "repos.json", "package.json"]) {
        assertFile(path.join(hub, f), `scaffolded ${f}`);
      }
      return `hub at ${path.relative(sb.root, hub)}`;
    },
  },
  {
    id: "TP-02-2",
    title: "the scaffolded config has every field the compiler reads",
    fn: (sb) => {
      assert(sb.newHub !== "", "TP-02-1 did not run — no scaffolded hub to inspect");
      const cfg = readJsonc(path.join(sb.newHub, "agentboot.config.json"));

      assert(cfg["org"] === "qa-test-org", `org is ${JSON.stringify(cfg["org"])}, expected qa-test-org`);
      assert(typeof cfg["groups"] === "object" && cfg["groups"] !== null, "groups must be an object");
      for (const key of ["personas", "traits", "instructions"]) {
        const section = cfg[key] as { enabled?: unknown } | undefined;
        assert(section !== undefined && typeof section === "object", `${key} section missing`);
        assert(Array.isArray(section!.enabled), `${key}.enabled must be an array`);
        assert((section!.enabled as unknown[]).length > 0, `${key}.enabled is empty`);
      }
      const sync = cfg["sync"] as { repos?: unknown } | undefined;
      assert(sync !== undefined, "sync section missing");
      assert("repos" in (sync as object), "sync.repos missing");
      const output = cfg["output"] as { distPath?: unknown } | undefined;
      assert(typeof output?.distPath === "string", "output.distPath must be a string");
      // See DIVERGENCES["TP-02-2"] — `validation` is optional; if the scaffold
      // emits it, it still has to be an object rather than a stray scalar.
      assert(
        cfg["validation"] === undefined ||
          (typeof cfg["validation"] === "object" && cfg["validation"] !== null),
        "validation, when present, must be an object"
      );
      return "org, groups, personas, traits, instructions, sync.repos, output.distPath";
    },
  },
  {
    id: "TP-02-3",
    title: "`add persona` scaffolds a usable persona",
    fn: (sb) => {
      const res = cli(sb, ["add", "persona", "qa-scaffold-persona"], { cwd: sb.newHub });
      assertExit(res, 0, "agentboot add persona");
      const dir = path.join(sb.newHub, "core", "personas", "qa-scaffold-persona");
      const skill = path.join(dir, "SKILL.md");
      const cfgPath = path.join(dir, "persona.config.json");
      assertFile(skill, "scaffolded SKILL.md");
      assertFile(cfgPath, "scaffolded persona.config.json");
      assertMatches(read(skill), /^---\r?\n[\s\S]*?\r?\n---/, "scaffolded SKILL.md frontmatter");
      const cfg = readJsonc(cfgPath);
      assert(typeof cfg["name"] === "string", "persona.config.json has no name");
      assert(cfg["traits"] !== undefined, "persona.config.json has no traits");
      fs.rmSync(dir, { recursive: true, force: true });
      return "SKILL.md with frontmatter + persona.config.json with name/traits";
    },
  },
  {
    id: "TP-02-4",
    title: "`add trait` scaffolds a template with authoring sections",
    fn: (sb) => {
      const res = cli(sb, ["add", "trait", "qa-scaffold-trait"], { cwd: sb.newHub });
      assertExit(res, 0, "agentboot add trait");
      const file = path.join(sb.newHub, "core", "traits", "qa-scaffold-trait.md");
      assertFile(file, "scaffolded trait");
      const body = read(file);
      assertMatches(body, /^#\s+\S/m, "scaffolded trait heading");
      assert(body.trim().length > 100, `scaffolded trait is only ${body.trim().length} chars`);
      assertMatches(body, /^##\s+\S/m, "scaffolded trait section headings");
      fs.rmSync(file, { force: true });
      return `${body.split("\n").length}-line template with sections`;
    },
  },
  {
    id: "TP-02-5",
    title: "`add gotcha` scaffolds path-scoped frontmatter",
    fn: (sb) => {
      const res = cli(sb, ["add", "gotcha", "qa-scaffold-gotcha"], { cwd: sb.newHub });
      assertExit(res, 0, "agentboot add gotcha");
      const file = path.join(sb.newHub, "core", "gotchas", "qa-scaffold-gotcha.md");
      assertFile(file, "scaffolded gotcha");
      const body = read(file);
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
      assert(fm !== null, "scaffolded gotcha has no frontmatter block");
      assertMatches(fm![1]!, /^paths:/m, "scaffolded gotcha frontmatter must declare paths:");
      fs.rmSync(file, { force: true });
      return "frontmatter carries paths:";
    },
  },
  {
    id: "TP-02-6",
    title: "invalid names are rejected, name the rule, and write nothing",
    fn: (sb) => {
      const attempts: Array<[string, string]> = [
        ["persona", "QA Persona"],
        ["trait", "UPPERCASE-TRAIT"],
        ["persona", "persona@name!"],
      ];
      const personasBefore = fs.readdirSync(path.join(sb.newHub, "core", "personas")).sort();
      const traitsBefore = fs.readdirSync(path.join(sb.newHub, "core", "traits")).sort();
      for (const [type, name] of attempts) {
        const res = cli(sb, ["add", type, name], { cwd: sb.newHub });
        assert(res.code !== 0, `agentboot add ${type} "${name}" exited 0 — invalid name accepted`);
        assertMatches(
          res.out,
          /1-64|lowercase/i,
          `error for "${name}" must state the naming rule, not just fail`
        );
        assertNoStackTrace(res.out, `agentboot add ${type} "${name}"`);
      }
      const personasAfter = fs.readdirSync(path.join(sb.newHub, "core", "personas")).sort();
      const traitsAfter = fs.readdirSync(path.join(sb.newHub, "core", "traits")).sort();
      assert(
        personasBefore.join("|") === personasAfter.join("|"),
        "a rejected persona name still created a directory"
      );
      assert(
        traitsBefore.join("|") === traitsAfter.join("|"),
        "a rejected trait name still created a file"
      );
      return `${attempts.length} invalid names rejected, nothing written`;
    },
  },
  {
    id: "TP-02-7",
    title: "`doctor` reports a healthy hub",
    fn: (sb) => {
      const res = cli(sb, ["doctor"]);
      assertExit(res, 0, "agentboot doctor");
      assertNotContains(res.stdout, "✗", "doctor must report no failed checks on a healthy hub");
      const passes = (res.stdout.match(/✓/g) ?? []).length;
      assert(passes >= 8, `doctor reported only ${passes} passing checks`);
      for (const expected of ["agentboot.config.json found", "dist/"]) {
        assertContains(res.stdout, expected, `doctor check list must mention ${expected}`);
      }
      return `${passes} checks passed, none failed`;
    },
  },
  {
    id: "TP-02-8",
    title: "`doctor --format json` emits a machine-readable check list",
    fn: (sb) => {
      const res = cli(sb, ["doctor", "--format", "json"]);
      assert(res.code === 0 || res.code === 1, `doctor --format json exited ${res.code}`);
      const parsed = JSON.parse(res.stdout) as { checks?: Array<{ name?: string; status?: string }> };
      assert(Array.isArray(parsed.checks), "doctor JSON has no `checks` array");
      assert(parsed.checks!.length > 0, "doctor JSON `checks` array is empty");
      for (const c of parsed.checks!) {
        assert(typeof c.name === "string" && c.name.length > 0, "a check has no name");
        assert(typeof c.status === "string" && c.status.length > 0, `check ${c.name} has no status`);
      }
      return `${parsed.checks!.length} checks in valid JSON`;
    },
  },
  {
    id: "TP-02-9",
    title: "`doctor --fix --dry-run` proposes the rebuild without doing it",
    fn: (sb) => {
      const dist = path.join(sb.newHub, "dist");
      fs.rmSync(dist, { recursive: true, force: true });
      assertAbsent(dist, "precondition: dist/ removed");

      const res = cli(sb, ["doctor", "--fix", "--dry-run"], { cwd: sb.newHub });
      assertAbsent(dist, "--dry-run must not rebuild dist/");
      assertMatches(res.out, /dist\//, "doctor must name dist/ as the thing it would fix");
      // See DIVERGENCES["TP-02-9"] — a missing dist/ is a warning, so exit is 0.
      assertExit(res, 0, "doctor --fix --dry-run");
      return "dist/ still absent after --dry-run";
    },
  },
  {
    id: "TP-02-10",
    title: "re-running `install` on an existing hub does not touch its config",
    fn: (sb) => {
      const cfgPath = path.join(sb.newHub, "agentboot.config.json");
      const before = sha256File(cfgPath);
      // stdin is closed: if the guard regressed and the wizard ran, this either
      // hangs (timeout → fail) or rewrites the config (hash → fail).
      const res = cli(sb, ["install"], { cwd: sb.newHub, timeout: 60_000, input: "" });
      assert(!res.timedOut, "install hung on an existing hub instead of detecting it");
      assertMatches(res.out, /Personas repo found/, "install must announce the existing hub");
      assert(
        sha256File(cfgPath) === before,
        "re-running install rewrote agentboot.config.json — the org's configuration was destroyed"
      );
      return "config byte-identical after re-running install";
    },
  },
];

// ---------------------------------------------------------------------------
// TP-03 — validation
//
// The passing cases read one check line out of a single validate run; the
// failing cases inject a defect into the sandbox, assert the check catches it
// by name, and restore.
// ---------------------------------------------------------------------------

function validateOutput(sb: Sandbox): string {
  const res = cli(sb, ["validate"]);
  assertExit(res, 0, "validate on the clean sandbox");
  return res.stdout;
}

function assertCheckPasses(out: string, fragment: string, id: string): string {
  const line = out
    .split("\n")
    .find((l) => l.includes(fragment) && (l.includes("✓") || l.includes("✗")));
  assert(line !== undefined, `${id}: no check line matching ${JSON.stringify(fragment)}`);
  assert(line!.includes("✓"), `${id}: check failed — ${line!.trim()}`);
  return line!.trim().slice(0, 80);
}

const TP03: Case[] = [
  {
    id: "TP-03-0",
    title: "validate passes on the clean tree",
    fn: (sb) => {
      const out = validateOutput(sb);
      assertNotContains(out, "✗", "no check may fail on a clean tree");
      assertMatches(out, /All \d+ checks passed/, "validate summary line");
      const checks = (out.match(/✓/g) ?? []).length;
      assert(checks >= 7, `validate ran only ${checks} checks`);
      return `${checks} checks passed`;
    },
  },
  {
    id: "TP-03-1",
    title: "check: persona existence passes",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "Persona existence", "TP-03-1"),
  },
  {
    id: "TP-03-2",
    title: "check: an enabled persona with no directory is caught by name",
    fn: (sb) => {
      const cfgPath = path.join(sb.hub, "agentboot.config.json");
      const restore = snapshot(cfgPath);
      try {
        const cfg = readJsonc(cfgPath) as { personas: { enabled: string[] } };
        cfg.personas.enabled.push("qa-nonexistent-persona");
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        const res = cli(sb, ["validate"]);
        assertExit(res, 1, "validate with a missing persona");
        assertContains(res.out, "qa-nonexistent-persona", "error must name the missing persona");
        assertMatches(res.out, /Persona existence/, "the persona-existence check must be the one that failed");
        return "exit 1, error names qa-nonexistent-persona";
      } finally {
        restore();
      }
    },
  },
  {
    id: "TP-03-3",
    title: "check: trait references pass",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "Trait references", "TP-03-3"),
  },
  {
    id: "TP-03-4",
    title: "check: a persona referencing a missing trait is caught by name",
    fn: (sb) => {
      const p = path.join(sb.hub, "core", "personas", "code-reviewer", "persona.config.json");
      const restore = snapshot(p);
      try {
        const cfg = readJsonc(p) as { traits: Record<string, string> };
        cfg.traits["qa-nonexistent-trait"] = "HIGH";
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
        const res = cli(sb, ["validate"]);
        assertExit(res, 1, "validate with a dangling trait reference");
        assertContains(res.out, "qa-nonexistent-trait", "error must name the missing trait");
        assertContains(res.out, "code-reviewer", "error must name the persona that references it");
        return "exit 1, error names both persona and trait";
      } finally {
        restore();
      }
    },
  },
  {
    id: "TP-03-5",
    title: "check: SKILL.md frontmatter passes",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "SKILL.md frontmatter", "TP-03-5"),
  },
  {
    id: "TP-03-6",
    title: "check: a SKILL.md with its frontmatter removed is caught by path",
    fn: (sb) => {
      const p = path.join(sb.hub, "core", "personas", "code-reviewer", "SKILL.md");
      const restore = snapshot(p);
      try {
        const body = read(p);
        const stripped = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
        assert(stripped !== body, "fixture error: code-reviewer/SKILL.md had no frontmatter to strip");
        fs.writeFileSync(p, stripped);
        const res = cli(sb, ["validate"]);
        assertExit(res, 1, "validate with a frontmatter-less SKILL.md");
        assertContains(res.out, "code-reviewer", "error must name the persona");
        assertMatches(res.out, /frontmatter/i, "error must say what is missing");
        return "exit 1, error names code-reviewer and frontmatter";
      } finally {
        restore();
      }
    },
  },
  {
    id: "TP-03-7",
    title: "check: secret scan passes",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "Secret scan", "TP-03-7"),
  },
  {
    id: "TP-03-8",
    title: "check: a credential planted in a trait file is caught by path and line",
    fn: (sb) => {
      const p = path.join(sb.hub, "core", "traits", "critical-thinking.md");
      const restore = snapshot(p);
      try {
        fs.appendFileSync(p, `\n<!-- QA fixture: ${fakeCredential()} -->\n`);
        const res = cli(sb, ["validate"]);
        assertExit(res, 1, "validate with a planted credential");
        assertMatches(res.out, /Potential secret/i, "error must say a secret was found");
        assertContains(res.out, "core/traits/critical-thinking.md", "error must name the file");
        return "exit 1, secret located at core/traits/critical-thinking.md";
      } finally {
        restore();
      }
    },
  },
  {
    id: "TP-03-9",
    title: "check: composition consistency passes",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "Composition consistency", "TP-03-9"),
  },
  {
    id: "TP-03-10",
    title: "check: rule overrides pass",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "Rule overrides", "TP-03-10"),
  },
  {
    id: "TP-03-11",
    title: "check: MCP governance passes",
    fn: (sb) => assertCheckPasses(validateOutput(sb), "MCP governance", "TP-03-11"),
  },
  {
    id: "TP-03-12",
    title: "`validate --strict` promotes warnings to exit 2",
    fn: (sb) => {
      const accepted = cli(sb, ["validate", "--strict"]);
      assertNotContains(accepted.out, "unknown option", "--strict must be a recognised flag");
      assertExit(accepted, 0, "validate --strict on a warning-free tree");

      // Manufacture a warning: a persona present in core/ but not enabled.
      const cfgPath = path.join(sb.hub, "agentboot.config.json");
      const restore = snapshot(cfgPath);
      try {
        const cfg = readJsonc(cfgPath) as { personas: { enabled: string[] } };
        const dropped = cfg.personas.enabled.pop();
        assert(dropped !== undefined, "fixture error: no persona to disable");
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

        const plain = cli(sb, ["validate"]);
        assertExit(plain, 0, "validate with only warnings");
        assertMatches(plain.out, /WARN/, "fixture error: no warning was produced");

        const strict = cli(sb, ["validate", "--strict"]);
        // Documented contract — see KNOWN_DEFECTS["TP-03-12"].
        assertExit(strict, 2, "validate --strict with warnings present");
        return "warnings promote to exit 2";
      } finally {
        restore();
      }
    },
  },
  {
    id: "TP-03-13",
    title: "exit codes: 0 clean, 1 on errors",
    fn: (sb) => {
      const clean = cli(sb, ["validate"]);
      assertExit(clean, 0, "validate on a clean tree");

      const p = path.join(sb.hub, "core", "personas", "code-reviewer", "persona.config.json");
      const restore = snapshot(p);
      try {
        const cfg = readJsonc(p) as { traits: Record<string, string> };
        cfg.traits["qa-broken-trait"] = "HIGH";
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
        const broken = cli(sb, ["validate"]);
        assertExit(broken, 1, "validate on a broken tree");
        return "0 clean / 1 errors";
      } finally {
        restore();
      }
    },
  },
];

// ---------------------------------------------------------------------------
// TP-04 — build
// ---------------------------------------------------------------------------

const TP04: Case[] = [
  {
    id: "TP-04-1",
    title: "`build` succeeds and names every platform it emitted",
    fn: (sb) => {
      fs.rmSync(path.join(sb.hub, "dist"), { recursive: true, force: true });
      const res = cli(sb, ["build"]);
      assertExit(res, 0, "agentboot build");
      assertNotContains(res.out, "ERROR", "build output must carry no ERROR lines");
      assertMatches(res.stdout, /Compiled \d+ persona\(s\) × \d+ platform\(s\)/, "build summary line");
      for (const p of CORE_PLATFORMS) {
        assertContains(res.stdout, `dist/${p}/`, `build must report emitting dist/${p}/`);
      }
      assertDir(distPath(sb), "dist/");
      return "build exit 0; all 8 plan platforms named in output";
    },
  },
  {
    id: "TP-04-2",
    title: "dist/ carries every platform directory",
    fn: (sb) => {
      for (const p of CORE_PLATFORMS) assertDir(distPath(sb, p), `dist/${p}`);
      const extra = fs
        .readdirSync(distPath(sb), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !CORE_PLATFORMS.includes(e.name))
        .map((e) => e.name);
      return `8 plan platforms present (also emitted: ${extra.join(", ") || "none"})`;
    },
  },
  {
    id: "TP-04-3",
    title: "dist/skill/ carries each persona's SKILL.md and config",
    fn: (sb) => {
      for (const p of CORE_PERSONAS) {
        assertDir(distPath(sb, "skill", "core", p), `dist/skill/core/${p}`);
        assertMinLines(distPath(sb, "skill", "core", p, "SKILL.md"), 20, `${p} SKILL.md`);
        assertFile(distPath(sb, "skill", "core", p, "persona.config.json"), `${p} persona.config.json`);
      }
      assertFile(distPath(sb, "skill", "core", "PERSONAS.md"), "skill PERSONAS.md");
      assertFile(distPath(sb, "skill", "core", "composition-manifest.json"), "skill composition manifest");
      return "4 personas, each with a >20-line SKILL.md";
    },
  },
  {
    id: "TP-04-4",
    title: "dist/claude/ carries agents, skills, rules, traits and hooks",
    fn: (sb) => {
      for (const d of ["agents", "skills", "rules", "traits", "hooks"]) {
        assertDir(distPath(sb, "claude", "core", d), `dist/claude/core/${d}`);
      }
      for (const f of ["CLAUDE.md", "settings.json", "PERSONAS.md", "composition-manifest.json"]) {
        assertFile(distPath(sb, "claude", "core", f), `dist/claude/core/${f}`);
      }
      for (const p of CORE_PERSONAS) {
        assertFile(distPath(sb, "claude", "core", "agents", `${p}.md`), `claude agent ${p}`);
        assertFile(
          distPath(sb, "claude", "core", "skills", SKILL_DIRS[p]!, "SKILL.md"),
          `claude skill ${SKILL_DIRS[p]!}`
        );
      }
      for (const t of CORE_TRAITS) {
        assertFile(distPath(sb, "claude", "core", "traits", `${t}.md`), `claude trait ${t}`);
      }
      for (const r of ["baseline.instructions.md", "security.instructions.md"]) {
        assertFile(distPath(sb, "claude", "core", "rules", r), `claude rule ${r}`);
      }
      return "5 dirs, 4 agents, 4 skills, 6 traits, 2 rules";
    },
  },
  {
    id: "TP-04-5",
    title: "dist/copilot/ carries per-persona instructions and .agent.md files",
    fn: (sb) => {
      for (const p of CORE_PERSONAS) {
        assertFile(
          distPath(sb, "copilot", "core", p, "copilot-instructions.md"),
          `copilot instructions for ${p}`
        );
        assertFile(
          distPath(sb, "copilot", "core", p, "persona.config.json"),
          `copilot persona.config.json for ${p}`
        );
        assertFile(distPath(sb, "copilot", "core", "agents", `${p}.agent.md`), `copilot agent ${p}`);
      }
      assertFile(distPath(sb, "copilot", "core", "PERSONAS.md"), "copilot PERSONAS.md");
      return "4 persona dirs + 4 .agent.md files";
    },
  },
  {
    id: "TP-04-6",
    title: "dist/cursor/ rules are .mdc files with valid scoping frontmatter",
    fn: (sb) => {
      for (const p of CORE_PERSONAS) {
        const f = distPath(sb, "cursor", "core", "rules", `${p}.mdc`);
        assertFile(f, `cursor rule ${p}`);
        const body = read(f);
        assertMatches(body, /^---\r?\n/, `${p}.mdc must open with frontmatter`);
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
        const always = /^alwaysApply:\s*true/m.test(fm);
        const globs = /^globs:/m.test(fm);
        assert(always || globs, `${p}.mdc frontmatter has neither alwaysApply nor globs`);
        assert(!(always && globs), `${p}.mdc sets alwaysApply AND globs — Cursor treats these as exclusive`);
      }
      for (const r of ["baseline.instructions", "security.instructions"]) {
        assertFile(distPath(sb, "cursor", "core", "rules", `${r}.mdc`), `cursor rule ${r}`);
      }
      return "4 persona .mdc + 2 instruction .mdc, scoping mutually exclusive";
    },
  },
  {
    id: "TP-04-7",
    title: "dist/agents/AGENTS.md is emitted at the tree root with real content",
    fn: (sb) => {
      assertMinLines(distPath(sb, "agents", "AGENTS.md"), 50, "dist/agents/AGENTS.md");
      assertFile(distPath(sb, "agents", "core", "PERSONAS.md"), "dist/agents/core/PERSONAS.md");
      return `${read(distPath(sb, "agents", "AGENTS.md")).split("\n").length} lines`;
    },
  },
  {
    id: "TP-04-8",
    title: "dist/windsurf/.windsurfrules concatenates the personas",
    fn: (sb) => {
      const f = distPath(sb, "windsurf", "core", ".windsurfrules");
      assertMinLines(f, 50, ".windsurfrules");
      assertFile(distPath(sb, "windsurf", "core", "PERSONAS.md"), "windsurf PERSONAS.md");
      return `${read(f).split("\n").length} lines`;
    },
  },
  {
    id: "TP-04-9",
    title: "dist/gemini/ carries GEMINI.md and a directory per persona",
    fn: (sb) => {
      const g = distPath(sb, "gemini", "core", "GEMINI.md");
      assertMinLines(g, 20, "GEMINI.md");
      // Gemini does not resolve Claude-style `@` imports; a line starting with
      // one is a silently dead reference in the shipped file.
      assert(!/^@/m.test(read(g)), "GEMINI.md contains a line starting with '@'");
      for (const p of CORE_PERSONAS) {
        assertFile(distPath(sb, "gemini", "core", p, "persona.md"), `gemini persona.md for ${p}`);
      }
      return "GEMINI.md + 4 persona dirs, no @-imports";
    },
  },
  {
    id: "TP-04-10",
    title: "dist/jetbrains/ carries Junie guidelines and AI Assistant rules",
    fn: (sb) => {
      // See DIVERGENCES["TP-04-10"] — .junie/AGENTS.md replaced guidelines.md.
      assertMinLines(distPath(sb, "jetbrains", "core", ".junie", "AGENTS.md"), 20, "junie AGENTS.md");
      for (const r of ["baseline.instructions.md", "security.instructions.md"]) {
        const f = distPath(sb, "jetbrains", "core", ".aiassistant", "rules", r);
        assertMinLines(f, 5, `aiassistant rule ${r}`);
      }
      assertFile(distPath(sb, "jetbrains", "core", "PERSONAS.md"), "jetbrains PERSONAS.md");
      return ".junie/AGENTS.md + 2 .aiassistant rules";
    },
  },
  {
    id: "TP-04-11",
    title: "trait injection produces a populated trait block, not an empty marker pair",
    fn: (sb) => {
      const agent = distPath(sb, "claude", "core", "agents", "code-reviewer.md");
      const body = read(agent);
      // See DIVERGENCES["TP-04-11"] — the markers are deliberate annotations.
      const start = body.indexOf("<!-- traits:start -->");
      const end = body.indexOf("<!-- traits:end -->");
      assert(start >= 0, "compiled agent has no <!-- traits:start --> marker");
      assert(end > start, "compiled agent has no <!-- traits:end --> after the start marker");
      const block = body.slice(start, end);
      assert(block.split("\n").length > 50, `injected trait block is only ${block.split("\n").length} lines`);

      const personaCfg = readJsonc(
        path.join(sb.hub, "core", "personas", "code-reviewer", "persona.config.json")
      ) as { traits: Record<string, string> };
      // OFF means "deliberately not injected"; everything else must show up.
      // The annotation carries a weight suffix at any non-default weight, so
      // match the opening of the marker rather than the whole literal.
      const expected = Object.entries(personaCfg.traits)
        .filter(([, weight]) => weight.toUpperCase() !== "OFF")
        .map(([name]) => name);
      const injected = expected.filter(
        (t) => block.includes(`<!-- trait: ${t} -->`) || block.includes(`<!-- trait: ${t} (`)
      );
      assert(
        injected.length === expected.length,
        `traits declared but not injected: ${expected.filter((t) => !injected.includes(t)).join(", ")}`
      );
      assertMinLines(agent, 50, "compiled agent");

      const mdc = read(distPath(sb, "cursor", "core", "rules", "code-reviewer.mdc"));
      assertNotContains(mdc, "<!-- traits:start -->", "Cursor .mdc must not carry HTML comment markers");
      assertNotContains(mdc, "<!-- trait:", "Cursor .mdc must not carry per-trait HTML comments");
      return `${injected.length}/${expected.length} declared traits present in the injected block`;
    },
  },
  {
    id: "TP-04-12",
    title: "provenance headers are present when output.provenanceHeaders is true",
    fn: (sb) => {
      const cfg = readJsonc(path.join(sb.hub, "agentboot.config.json")) as {
        output?: { provenanceHeaders?: boolean };
      };
      assert(
        cfg.output?.provenanceHeaders !== false,
        "precondition: output.provenanceHeaders is disabled in this config"
      );
      const sample: Array<[string, string]> = [
        ["claude agent", distPath(sb, "claude", "core", "agents", "code-reviewer.md")],
        ["copilot instructions", distPath(sb, "copilot", "core", "code-reviewer", "copilot-instructions.md")],
        ["cursor rule", distPath(sb, "cursor", "core", "rules", "code-reviewer.mdc")],
      ];
      const withHeader = sample.filter(([, f]) =>
        read(f).split("\n").slice(0, 14).join("\n").includes("AgentBoot compiled output")
      );
      // Documented contract — see KNOWN_DEFECTS["TP-04-12"].
      assert(
        withHeader.length >= 2,
        `only ${withHeader.length} of 3 sampled artifacts carry a provenance header ` +
          `(${withHeader.map(([n]) => n).join(", ") || "none"})`
      );
      return `${withHeader.length}/3 sampled artifacts carry a provenance header`;
    },
  },
  {
    id: "TP-04-13",
    title: "the persona's agentic pattern reaches the compiled agent",
    fn: (sb) => {
      // See DIVERGENCES["TP-04-13"] — the pattern surfaces as frontmatter.
      const src = readJsonc(
        path.join(sb.hub, "core", "personas", "code-reviewer", "persona.config.json")
      ) as { pattern?: string; maxTurns?: number };
      assert(src.pattern === "react", `fixture error: code-reviewer pattern is ${String(src.pattern)}`);
      assert(src.maxTurns === undefined, "fixture error: persona overrides maxTurns, so the default is untested");

      const body = read(distPath(sb, "claude", "core", "agents", "code-reviewer.md"));
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1];
      assert(fm !== undefined, "compiled agent has no frontmatter");
      assertMatches(fm!, /^maxTurns:\s*10\s*$/m, "react pattern must contribute its default maxTurns: 10");
      assert(
        !/^agentProfile:/m.test(fm!),
        "agentProfile must be omitted for the default 'react' pattern"
      );
      return "maxTurns: 10 from PATTERN_CONFIGS.react, no agentProfile key";
    },
  },
  {
    id: "TP-04-14",
    title: "the deprecated failOnDirtyDist flag is ignored, out loud",
    fn: (sb) => {
      const cfgPath = path.join(sb.hub, "agentboot.config.json");
      const restore = snapshot(cfgPath);
      try {
        const raw = read(cfgPath);
        const patched = raw.replace(/"failOnDirtyDist":\s*false/, '"failOnDirtyDist": true');
        assert(patched !== raw, "fixture error: failOnDirtyDist: false not found in the config");
        fs.writeFileSync(cfgPath, patched);
        assertDir(distPath(sb), "precondition: dist/ exists so the old flag would have tripped");
        const res = cli(sb, ["build"]);
        // See DIVERGENCES["TP-04-14"].
        assertExit(res, 0, "build with failOnDirtyDist: true");
        assertMatches(
          res.out,
          /failOnDirtyDist is deprecated and ignored/,
          "a deprecated key that changes nothing must say so"
        );
        return "build succeeds; deprecation notice printed";
      } finally {
        restore();
        cli(sb, ["build"]);
      }
    },
  },
  {
    id: "TP-04-15",
    title: "an exceeded token budget warns without blocking the build",
    fn: (sb) => {
      const cfgPath = path.join(sb.hub, "agentboot.config.json");
      const restore = snapshot(cfgPath);
      try {
        const raw = read(cfgPath);
        const patched = raw.replace(
          /"failOnDirtyDist":\s*(true|false)/,
          '"failOnDirtyDist": false,\n    "tokenBudget": { "warnAt": 10 }'
        );
        assert(patched !== raw, "fixture error: could not anchor the tokenBudget injection");
        fs.writeFileSync(cfgPath, patched);
        const res = cli(sb, ["build"]);
        assertExit(res, 0, "build with a tiny token budget");
        const warnings = res.stdout
          .split("\n")
          .filter((l) => /estimated \d+ tokens \(budget: 10\)/.test(l));
        assert(
          warnings.length >= CORE_PERSONAS.length,
          `expected a budget warning per persona, saw ${warnings.length}`
        );
        return `${warnings.length} budget warnings, build still exit 0`;
      } finally {
        restore();
        cli(sb, ["build"]);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// TP-05 — persona output correctness
// ---------------------------------------------------------------------------

const PERSONA_KEYWORDS: Record<string, RegExp> = {
  "code-reviewer": /code review|senior|bugs/i,
  "security-reviewer": /security|vulnerabilit|adversarial/i,
  "test-generator": /test|qa|coverage/i,
  "test-data-expert": /test data|synthetic|data engineer/i,
};

function personaCase(persona: string, n: number): Case {
  return {
    id: `TP-05-${n}`,
    title: `${persona} — Claude output carries its role and its invocation`,
    fn: (sb) => {
      const agent = distPath(sb, "claude", "core", "agents", `${persona}.md`);
      assertMinLines(agent, 50, `${persona} agent`);
      assertMatches(read(agent), PERSONA_KEYWORDS[persona]!, `${persona} role description`);
      // See DIVERGENCES["TP-05-1"]. The plan greps the skill file for its own
      // directory name; two of the four personas never contain it, and the two
      // that "pass" match an unrelated example path in the prose. What actually
      // has to hold is the binding: the persona's declared invocation names the
      // skill directory, and that skill delegates to the persona's agent.
      const src = readJsonc(
        path.join(sb.hub, "core", "personas", persona, "persona.config.json")
      ) as { invocation?: string };
      assert(
        src.invocation === INVOCATIONS[persona],
        `${persona} declares invocation ${String(src.invocation)}, plan expects ${INVOCATIONS[persona]!}`
      );
      const skillDir = src.invocation!.replace(/^\//, "");
      const skill = distPath(sb, "claude", "core", "skills", skillDir, "SKILL.md");
      assertFile(skill, `${persona} skill file at the directory its invocation names`);
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(skill))?.[1];
      assert(fm !== undefined, `${persona} skill file has no frontmatter`);
      assertMatches(
        fm!,
        new RegExp(`^agent:\\s*"?${persona}"?\\s*$`, "m"),
        `${persona} skill must delegate to its own agent`
      );
      return `${read(agent).split("\n").length}-line agent, skill ${skillDir} → agent ${persona}`;
    },
  };
}

const TP05: Case[] = [
  personaCase("code-reviewer", 1),
  personaCase("security-reviewer", 2),
  personaCase("test-generator", 3),
  personaCase("test-data-expert", 4),
  {
    id: "TP-05-5",
    title: "trait prose reaches all four personas",
    fn: (sb) => {
      const missing: string[] = [];
      for (const p of CORE_PERSONAS) {
        const body = read(distPath(sb, "claude", "core", "agents", `${p}.md`));
        if (!/skeptic|assumption|challenge|adversarial/i.test(body)) missing.push(p);
      }
      assert(missing.length === 0, `no trait prose in: ${missing.join(", ")}`);
      return "4/4 personas carry trait prose";
    },
  },
  {
    id: "TP-05-6",
    title: "each persona compiles to distinct content",
    fn: (sb) => {
      const digests = new Map<string, string>();
      for (const p of CORE_PERSONAS) {
        const h = sha256File(distPath(sb, "claude", "core", "agents", `${p}.md`));
        const clash = [...digests.entries()].find(([, d]) => d === h);
        assert(clash === undefined, `${p} and ${clash?.[0]} compiled to byte-identical files`);
        digests.set(p, h);
      }
      return `${digests.size} distinct digests`;
    },
  },
  {
    id: "TP-05-7",
    title: "PERSONAS.md is generated and lists every invocation",
    fn: (sb) => {
      for (const platform of ["claude", "skill"]) {
        const f = distPath(sb, platform, "core", "PERSONAS.md");
        assertFile(f, `${platform} PERSONAS.md`);
        const body = read(f);
        for (const p of CORE_PERSONAS) {
          assertContains(body, INVOCATIONS[p]!, `${platform} PERSONAS.md must list ${INVOCATIONS[p]!}`);
        }
      }
      return "claude + skill indexes list all 4 invocations";
    },
  },
  {
    id: "TP-05-8",
    title: "all four personas reach all eight platform outputs",
    fn: (sb) => {
      const present = (haystack: string, p: string): boolean => haystack.includes(p);
      const checks: Array<[string, (p: string) => boolean]> = [
        ["skill", (p) => fs.existsSync(distPath(sb, "skill", "core", p))],
        ["claude", (p) => fs.existsSync(distPath(sb, "claude", "core", "agents", `${p}.md`))],
        ["copilot", (p) => fs.existsSync(distPath(sb, "copilot", "core", p))],
        ["cursor", (p) => fs.existsSync(distPath(sb, "cursor", "core", "rules", `${p}.mdc`))],
        ["gemini", (p) => fs.existsSync(distPath(sb, "gemini", "core", p))],
        [
          "windsurf",
          (p) => present(read(distPath(sb, "windsurf", "core", ".windsurfrules")), p),
        ],
        ["agents", (p) => present(read(distPath(sb, "agents", "AGENTS.md")), p)],
        [
          "jetbrains",
          (p) => present(read(distPath(sb, "jetbrains", "core", ".junie", "AGENTS.md")), p),
        ],
      ];
      const gaps: string[] = [];
      for (const [platform, test] of checks) {
        for (const p of CORE_PERSONAS) if (!test(p)) gaps.push(`${platform}:${p}`);
      }
      assert(gaps.length === 0, `personas missing from platform output: ${gaps.join(", ")}`);
      return `${checks.length} platforms × ${CORE_PERSONAS.length} personas verified`;
    },
  },
  {
    id: "TP-05-9",
    title: "compiled invocations match the source persona.config.json",
    fn: (sb) => {
      const index = read(distPath(sb, "claude", "core", "PERSONAS.md"));
      for (const p of CORE_PERSONAS) {
        const cfg = readJsonc(path.join(sb.hub, "core", "personas", p, "persona.config.json")) as {
          invocation?: string;
        };
        assert(typeof cfg.invocation === "string", `${p} declares no invocation`);
        assert(
          cfg.invocation === INVOCATIONS[p],
          `${p} invocation drifted from the plan: ${cfg.invocation!}`
        );
        assertContains(index, cfg.invocation!, `PERSONAS.md must carry ${p}'s declared invocation`);
      }
      return "4 source invocations round-trip into the index";
    },
  },
];

// ---------------------------------------------------------------------------
// TP-09 — sync
// ---------------------------------------------------------------------------

const TP09: Case[] = [
  {
    id: "TP-09-1",
    title: "`sync --dry-run` reports the plan and writes nothing",
    fn: (sb) => {
      const before = sha256Tree(sb.target);
      const res = cli(sb, ["sync", "--repos-file", sb.reposFile, "--dry-run"]);
      assertExit(res, 0, "sync --dry-run");
      assertMatches(res.stdout, /DRY RUN/i, "dry-run must announce itself");
      assertMatches(res.stdout, /\+ \.claude\//, "dry-run must name the files it would write");
      assert(sha256Tree(sb.target) === before, "--dry-run wrote to the target repo");
      return "target unchanged; planned writes listed";
    },
  },
  {
    id: "TP-09-2",
    title: "`sync` writes the platform-native layout into the target repo",
    fn: (sb) => {
      const res = cli(sb, ["sync", "--repos-file", sb.reposFile]);
      assertExit(res, 0, "sync");
      const dot = path.join(sb.target, ".claude");
      assertDir(dot, "target .claude/");
      for (const d of ["agents", "skills", "rules", "traits"]) {
        assertDir(path.join(dot, d), `target .claude/${d}`);
      }
      assertFile(path.join(dot, "settings.json"), "target .claude/settings.json");
      // See DIVERGENCES["TP-09-2"] — CLAUDE.md belongs at the repo root.
      assertFile(path.join(sb.target, "CLAUDE.md"), "target CLAUDE.md");
      for (const p of CORE_PERSONAS) {
        assertMinLines(path.join(dot, "agents", `${p}.md`), 50, `synced agent ${p}`);
      }
      return "4 agents + skills/rules/traits + settings.json + CLAUDE.md";
    },
  },
  {
    id: "TP-09-3",
    title: "sync records a manifest of every file it manages",
    fn: (sb) => {
      const candidates = [
        path.join(sb.target, ".agentboot-manifest.json"),
        path.join(sb.target, ".claude", ".agentboot-manifest.json"),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      assert(found !== undefined, `no manifest at ${candidates.join(" or ")}`);
      const manifest = JSON.parse(read(found!)) as {
        files?: Array<{ path?: string; hash?: string }>;
      };
      assert(Array.isArray(manifest.files), "manifest has no `files` array");
      const entries = manifest.files!;
      assert(entries.length > 0, "manifest tracks zero files after a sync that wrote many");

      // A manifest is a claim about what is managed and what its bytes are.
      // Checking only that it parses would pass on a manifest full of paths
      // that were never written — verify every entry against the disk.
      const problems: string[] = [];
      for (const e of entries) {
        assert(typeof e.path === "string" && e.path.length > 0, "a manifest entry has no path");
        assertMatches(e.hash ?? "", /^[0-9a-f]{64}$/, `manifest hash for ${e.path!}`);
        const abs = path.join(sb.target, e.path!);
        if (!fs.existsSync(abs)) {
          problems.push(`${e.path!} (absent)`);
          continue;
        }
        if (sha256File(abs) !== e.hash) problems.push(`${e.path!} (hash mismatch)`);
      }
      assert(problems.length === 0, `manifest disagrees with the target repo: ${problems.join(", ")}`);
      return `${entries.length} tracked entries, every path and hash verified on disk`;
    },
  },
  {
    id: "TP-09-4",
    title: "sync is idempotent — a second run changes no bytes",
    fn: (sb) => {
      const before = sha256Tree(sb.target);
      const res = cli(sb, ["sync", "--repos-file", sb.reposFile]);
      assertExit(res, 0, "second sync");
      assert(sha256Tree(sb.target) === before, "a repeat sync changed the target's contents");
      return "target tree digest unchanged across a repeat sync";
    },
  },
  {
    id: "TP-09-5",
    title: "a missing repos file fails with a sentence, not a stack trace",
    fn: (sb) => {
      const missing = path.join(sb.root, "no-such-repos.json");
      const res = cli(sb, ["sync", "--repos-file", missing]);
      assertExit(res, 1, "sync with a missing repos file");
      assertContains(res.out, missing, "error must name the path it could not read");
      assertMatches(res.out, /not found/i, "error must say the file was not found");
      assertNoStackTrace(res.out, "sync with a missing repos file");
      return "exit 1, path named, no stack trace";
    },
  },
  {
    id: "TP-09-6",
    title: "a target repo that does not exist fails with a sentence, not a stack trace",
    fn: (sb) => {
      const res = cli(sb, ["sync", "--repos-file", sb.badReposFile]);
      assertExit(res, 1, "sync to a nonexistent target");
      assertContains(res.out, path.join(sb.root, "no-such-target"), "error must name the bad path");
      assertNoStackTrace(res.out, "sync to a nonexistent target");
      return "exit 1, bad path named, no stack trace";
    },
  },
  {
    id: "TP-09-7",
    title: "PERSONAS.md reaches the target repo intact",
    fn: (sb) => {
      const candidates = [
        path.join(sb.target, ".claude", "PERSONAS.md"),
        path.join(sb.target, "PERSONAS.md"),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      assert(found !== undefined, "PERSONAS.md was not synced to the target repo");
      const body = read(found!);
      for (const p of CORE_PERSONAS) {
        assertContains(body, INVOCATIONS[p]!, `synced PERSONAS.md must list ${INVOCATIONS[p]!}`);
      }
      return `${path.relative(sb.target, found!)} lists all 4 invocations`;
    },
  },
];

export const CASES: Case[] = [...TP01, ...TP02, ...TP03, ...TP04, ...TP05, ...TP09];

// ---------------------------------------------------------------------------
// Negative controls
//
// "Prove your scripted cases can fail before you count them." Each mutation
// breaks one thing and the runner asserts the named case goes red. A case with
// no mutation behind it is an assertion nobody has ever seen fail.
// ---------------------------------------------------------------------------

export interface Mutation {
  caseId: string;
  describe: string;
  apply: (sb: Sandbox) => () => void;
}

export const MUTATIONS: Mutation[] = [
  {
    caseId: "TP-01-3",
    describe: "bump package.json version so it no longer matches --version",
    apply: (sb) => {
      const p = path.join(sb.hub, "package.json");
      const restore = snapshot(p);
      const pkg = JSON.parse(read(p)) as { version: string };
      pkg.version = "999.999.999";
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
      return restore;
    },
  },
  {
    caseId: "TP-01-4",
    describe: "delete a command's heading from the CLI reference",
    apply: (sb) => {
      const p = path.join(sb.hub, "docs", "cli-reference.md");
      const restore = snapshot(p);
      fs.writeFileSync(p, read(p).replace("## `agentboot doctor`", "## doctor (undocumented)"));
      return restore;
    },
  },
  {
    caseId: "TP-02-2",
    describe: "remove output.distPath from the scaffolded config",
    apply: (sb) => {
      const p = path.join(sb.newHub, "agentboot.config.json");
      const restore = snapshot(p);
      const cfg = readJsonc(p) as { output?: Record<string, unknown> };
      delete cfg.output?.["distPath"];
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
      return restore;
    },
  },
  {
    caseId: "TP-03-0",
    describe: "enable a persona that does not exist",
    apply: (sb) => {
      const p = path.join(sb.hub, "agentboot.config.json");
      const restore = snapshot(p);
      const cfg = readJsonc(p) as { personas: { enabled: string[] } };
      cfg.personas.enabled.push("qa-mutation-persona");
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
      return restore;
    },
  },
  {
    caseId: "TP-04-4",
    describe: "delete a compiled trait file from dist/claude/",
    apply: (sb) => {
      const p = distPath(sb, "claude", "core", "traits", "critical-thinking.md");
      const body = fs.readFileSync(p);
      fs.rmSync(p);
      return () => fs.writeFileSync(p, body);
    },
  },
  {
    caseId: "TP-04-11",
    describe: "empty the injected trait block, leaving the marker pair in place",
    apply: (sb) => {
      const p = distPath(sb, "claude", "core", "agents", "code-reviewer.md");
      const restore = snapshot(p);
      const body = read(p);
      const start = body.indexOf("<!-- traits:start -->");
      const end = body.indexOf("<!-- traits:end -->");
      fs.writeFileSync(
        p,
        body.slice(0, start) + "<!-- traits:start -->\n\n" + body.slice(end)
      );
      return restore;
    },
  },
  {
    caseId: "TP-04-13",
    describe: "drop maxTurns from the compiled agent frontmatter",
    apply: (sb) => {
      const p = distPath(sb, "claude", "core", "agents", "code-reviewer.md");
      const restore = snapshot(p);
      fs.writeFileSync(p, read(p).replace(/^maxTurns: 10$/m, "maxTurns: 4"));
      return restore;
    },
  },
  {
    caseId: "TP-04-6",
    describe: "give a Cursor rule both alwaysApply and globs",
    apply: (sb) => {
      const p = distPath(sb, "cursor", "core", "rules", "code-reviewer.mdc");
      const restore = snapshot(p);
      fs.writeFileSync(p, read(p).replace(/^alwaysApply: true$/m, 'alwaysApply: true\nglobs: "**/*.ts"'));
      return restore;
    },
  },
  {
    caseId: "TP-05-8",
    describe: "delete a persona's Gemini output directory",
    apply: (sb) => {
      const p = distPath(sb, "gemini", "core", "test-generator");
      const stash = `${p}.stashed`;
      fs.renameSync(p, stash);
      return () => fs.renameSync(stash, p);
    },
  },
  {
    caseId: "TP-09-3",
    describe: "add a file to the sync manifest that is not on disk",
    apply: (sb) => {
      const p = path.join(sb.target, ".claude", ".agentboot-manifest.json");
      const restore = snapshot(p);
      const m = JSON.parse(read(p)) as { files: Array<{ path: string; hash: string }> };
      m.files.push({ path: ".claude/agents/never-written.md", hash: "0".repeat(64) });
      fs.writeFileSync(p, JSON.stringify(m, null, 2));
      return restore;
    },
  },
  {
    caseId: "TP-05-6",
    describe: "copy one persona's compiled agent over another's",
    apply: (sb) => {
      const victim = distPath(sb, "claude", "core", "agents", "test-generator.md");
      const restore = snapshot(victim);
      fs.copyFileSync(distPath(sb, "claude", "core", "agents", "code-reviewer.md"), victim);
      return restore;
    },
  },
  {
    caseId: "TP-05-7",
    describe: "strip an invocation from the generated PERSONAS.md",
    apply: (sb) => {
      const p = distPath(sb, "claude", "core", "PERSONAS.md");
      const restore = snapshot(p);
      fs.writeFileSync(p, read(p).replaceAll("/gen-testdata", "/removed-by-mutation"));
      return restore;
    },
  },
  {
    caseId: "TP-09-2",
    describe: "delete a synced agent file from the target repo",
    apply: (sb) => {
      const p = path.join(sb.target, ".claude", "agents", "code-reviewer.md");
      const body = fs.readFileSync(p);
      fs.rmSync(p);
      return () => fs.writeFileSync(p, body);
    },
  },
  {
    caseId: "TP-09-4",
    describe: "corrupt a synced file so a repeat sync has to rewrite it",
    apply: (sb) => {
      const p = path.join(sb.target, ".claude", "agents", "security-reviewer.md");
      const restore = snapshot(p);
      fs.writeFileSync(p, "corrupted by the negative-control mutation\n");
      return restore;
    },
  },
];
