/**
 * L48 — THE DOCS↔CLI PARITY GATE THAT WAS CLAIMED TO EXIST AND DID NOT.
 *
 * A v0.20.0 changelog entry says the CLI reference was brought up to shipped
 * reality and that a parity gate covers it. There was no gate:
 * `grep -rn -i parity scripts/ tests/ .github/` found only `secret-parity`
 * (an unrelated subject) and no test anywhere referenced `cli-reference.md`.
 * The "gate" was a one-time manual sweep wearing a mechanism's name.
 *
 * It had already started leaking by the time anyone checked. `agentboot
 * baseline` and `agentboot identity` are both non-hidden, both advertised by
 * `agentboot --help`, and neither had a line in `docs/cli-reference.md`. A user
 * who discovers a command from `--help` and then cannot find it in the
 * reference has to read our source to learn what its flags do.
 *
 * The same shape had eaten `docs/migration.md`, which stopped at v0.19 while
 * the release train had run through 0.20.2 and was heading for 1.0.
 *
 * WHY THIS IS A TEST AND NOT A CHECKLIST. Documentation drift is not caused by
 * people who do not care; it is caused by the fact that adding a command and
 * documenting it are two separate acts, and only one of them is enforced. A
 * sweep fixes the instances present on the day it runs and expires the moment
 * the next command lands. So the command list here is DERIVED from `cli.ts` —
 * a hand-maintained list of "commands this test knows about" would drift the
 * same way the docs did, and the command added next quarter would be exempt by
 * default.
 *
 * VACUITY GUARDS. A source-parsing test's characteristic failure is that the
 * regex stops matching and the assertion passes over an empty set — this branch
 * has already shipped one tamper test that passed without tampering and one
 * conformance assertion that passed over nothing. So the extractor is asserted
 * on before it is used: a plausible command count, known-visible commands,
 * a known-HIDDEN command (proving the hidden filter is live rather than
 * vacuously true), and a known SUBCOMMAND that must NOT be treated as
 * top-level (proving receiver attribution works).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CLI_SRC = path.join(ROOT, "scripts", "cli.ts");
const CLI_REFERENCE = path.join(ROOT, "docs", "cli-reference.md");
const MIGRATION = path.join(ROOT, "docs", "migration.md");

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

interface CommandDecl {
  /** The identifier `.command()` was called on — `program` for top level. */
  receiver: string;
  /** Command name with any `<arg>` / `[arg]` placeholders stripped. */
  name: string;
  hidden: boolean;
}

/**
 * Every `.command("name", { … })` declaration in cli.ts, attributed to the
 * identifier it was called on.
 *
 * Attribution matters: `marketplace` and `registry` are hidden parent commands
 * whose subcommands hang off `marketplaceCmd` / `registryCmd`. Those
 * subcommands are unreachable from top-level help, so requiring a
 * `cli-reference.md` section for them would be requiring documentation for a
 * surface the CLI does not advertise.
 */
function declaredCommands(): CommandDecl[] {
  const src = fs.readFileSync(CLI_SRC, "utf-8");
  // The receiver, then any run of whitespace and `//` comments (commands carry
  // explanatory comments between the receiver and the call), then the call.
  const re = /([A-Za-z_$][\w$]*)(?:\/\/[^\n]*|\s)*\.command\(\s*"([^"]+)"\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
  const out: CommandDecl[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({
      receiver: m[1]!,
      name: m[2]!.split(/\s+/)[0]!,
      hidden: /\bhidden\s*:\s*true\b/.test(m[3] ?? ""),
    });
  }
  return out;
}

/**
 * Commands `agentboot --help` advertises: declared on `program`, not hidden.
 * These are the ones a user can discover without reading our source, so these
 * are the ones the reference must cover.
 */
function visibleCommands(): string[] {
  return declaredCommands()
    .filter((c) => c.receiver === "program" && !c.hidden)
    .map((c) => c.name);
}

/** Command names carrying a section heading in `docs/cli-reference.md`. */
function documentedCommands(): string[] {
  const md = fs.readFileSync(CLI_REFERENCE, "utf-8");
  const re = /^#{2,4}\s+`agentboot\s+([a-z0-9-]+)/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1]!);
  return out;
}

/** `## vX.Y → vA.B …` headings in migration.md, as [from, to] pairs. */
function migrationSpans(): Array<{ from: string; to: string }> {
  const md = fs.readFileSync(MIGRATION, "utf-8");
  const re = /^##\s+v(\d+\.\d+)\s*(?:→|->)\s*v(\d+\.\d+)/gm;
  const out: Array<{ from: string; to: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push({ from: m[1]!, to: m[2]! });
  return out;
}

/** Compare `major.minor` strings numerically — "0.9" < "0.20" < "1.0". */
function cmpMinor(a: string, b: string): number {
  const [aMaj, aMin] = a.split(".").map(Number) as [number, number];
  const [bMaj, bMin] = b.split(".").map(Number) as [number, number];
  return aMaj !== bMaj ? aMaj - bMaj : aMin - bMin;
}

function packageMinor(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const parts = String(pkg.version).split(".");
  return `${parts[0]}.${parts[1]}`;
}

// ---------------------------------------------------------------------------
// 0 · The extractors are not measuring nothing
// ---------------------------------------------------------------------------

describe("docs↔CLI parity — extractor sanity (guards against a vacuous pass)", () => {
  it("finds a plausible number of top-level commands in cli.ts", () => {
    const decls = declaredCommands();
    const topLevel = decls.filter((c) => c.receiver === "program");
    // The CLI had 37 top-level declarations when this gate was written. A
    // regex that stops matching drops to single digits and must fail here
    // rather than pass over an empty set.
    expect(topLevel.length).toBeGreaterThanOrEqual(30);
    expect(visibleCommands().length).toBeGreaterThanOrEqual(25);
  });

  it("recognises known-visible commands", () => {
    const visible = visibleCommands();
    for (const known of ["build", "sync", "doctor", "validate", "status"]) {
      expect(visible).toContain(known);
    }
  });

  it("recognises a known-HIDDEN command as hidden", () => {
    // If the `{ hidden: true }` capture broke, every hidden command would be
    // treated as visible and the parity assertion would demand documentation
    // for surfaces we deliberately do not advertise — a loud failure. The
    // reverse (treating everything as hidden) fails silently, so pin it.
    const decls = declaredCommands();
    const devSync = decls.find((c) => c.name === "dev-sync");
    expect(devSync, "dev-sync should still be declared in cli.ts").toBeDefined();
    expect(devSync!.hidden).toBe(true);
    expect(visibleCommands()).not.toContain("dev-sync");
  });

  it("attributes subcommands to their parent, not to top level", () => {
    const decls = declaredCommands();
    // `marketplace search` hangs off marketplaceCmd. If receiver attribution
    // collapsed, `search` would appear top-level and demand a doc section.
    const search = decls.find((c) => c.name === "search");
    expect(search, "marketplace search should still be declared").toBeDefined();
    expect(search!.receiver).not.toBe("program");
    expect(visibleCommands()).not.toContain("search");
  });

  it("finds a plausible number of documented commands in cli-reference.md", () => {
    const documented = documentedCommands();
    expect(documented.length).toBeGreaterThanOrEqual(25);
    expect(documented).toContain("build");
    expect(documented).toContain("mcp-server");
  });
});

// ---------------------------------------------------------------------------
// 1 · The gate — every advertised command is documented
// ---------------------------------------------------------------------------

describe("docs↔CLI parity", () => {
  it("every non-hidden command has a section in docs/cli-reference.md", () => {
    const documented = new Set(documentedCommands());
    const missing = visibleCommands().filter((c) => !documented.has(c));
    expect(
      missing,
      `These commands are advertised by \`agentboot --help\` but have no section in ` +
        `docs/cli-reference.md: ${missing.join(", ")}. Add a \`## \`agentboot <name>\`\` ` +
        `section, or mark the command \`{ hidden: true }\` in cli.ts if it is not a ` +
        `supported surface.`,
    ).toEqual([]);
  });

  it("baseline and identity are documented (the two the missing gate let through)", () => {
    const documented = documentedCommands();
    expect(documented).toContain("baseline");
    expect(documented).toContain("identity");
  });

  it("cli-reference.md documents no command the CLI does not declare", () => {
    // The other direction of the same drift: a command removed from cli.ts
    // leaves a reference section describing a surface that no longer exists,
    // which is worse than an undocumented one — it is a false statement.
    const declared = new Set(declaredCommands().map((c) => c.name));
    const phantom = documentedCommands().filter((c) => !declared.has(c));
    expect(
      phantom,
      `docs/cli-reference.md documents commands cli.ts does not declare: ${phantom.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2 · migration.md keeps up with the release train
// ---------------------------------------------------------------------------

describe("migration guide coverage", () => {
  it("parses its own version spans (guards against a vacuous pass)", () => {
    const spans = migrationSpans();
    expect(spans.length).toBeGreaterThanOrEqual(4);
    // A span present since long before this gate — if the heading regex stops
    // matching, this goes red instead of the coverage assertion passing over [].
    expect(spans.some((s) => s.from === "0.10" && s.to === "0.11")).toBe(true);
  });

  it("covers v0.20 → v1.0", () => {
    const spans = migrationSpans();
    expect(
      spans.some((s) => s.from === "0.20" && s.to === "1.0"),
      "docs/migration.md must carry a `## v0.20 → v1.0` section",
    ).toBe(true);
  });

  it("has no hole in the upgrade chain", () => {
    // Sections are written newest-first, each one's `from` meeting the previous
    // one's `to`. A hole means an operator on the skipped version has no path
    // published at all — which is how the guide came to stop at v0.19 while the
    // train had run through 0.20.2.
    const spans = migrationSpans();
    const holes: string[] = [];
    for (let i = 0; i < spans.length - 1; i++) {
      const older = spans[i + 1]!;
      const newer = spans[i]!;
      if (older.to !== newer.from) holes.push(`v${older.to} → v${newer.from}`);
    }
    expect(holes, `docs/migration.md skips: ${holes.join(", ")}`).toEqual([]);
  });

  it("covers up to at least the version in package.json", () => {
    // The durable half: whatever the next release is, migration.md's newest
    // span must reach it. Bumping package.json past the guide goes red here
    // rather than shipping a guide that stops two releases back.
    const spans = migrationSpans();
    const newest = spans.map((s) => s.to).sort(cmpMinor).at(-1)!;
    const pkg = packageMinor();
    expect(
      cmpMinor(newest, pkg),
      `docs/migration.md stops at v${newest} but package.json is v${pkg} — ` +
        `add the missing upgrade section before releasing.`,
    ).toBeGreaterThanOrEqual(0);
  });
});
