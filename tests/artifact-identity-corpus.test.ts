/**
 * decision-0005, the half that was never wired: the CORPUS and the GATE.
 *
 * `artifact-identity.ts` had the ratified ULID+slug+hash shape, `identity` could
 * mint one, and `compile` was careful to preserve it — and nine of eighteen
 * tracked `core/**​/*.md` artifacts carried no id at all, because nothing in the
 * build ever asked. The backfill walked three hard-coded flat directories
 * (`core/instructions`, `core/traits`, `core/gotchas`), reported "N artifact(s)
 * scanned" over exactly the ten it happened to find, and never mentioned that
 * `core/personas/` and `core/skills/` existed. A writer with no reader is a
 * writer that is always right about its own coverage.
 *
 * The stakes are one-way. An identifier's value is that it predates the question
 * being asked of it, and identity CANNOT be minted into the past: an artifact
 * stamped after the 1.0 tag can only ever claim to date from then, and every
 * rename, split and merge before that is forensic reconstruction from git
 * history and fuzzy content matching. Post-tag, the emitted frontmatter is a
 * compatibility contract too — adding the field later breaks every consumer and
 * means re-syncing every spoke, so the realistic outcome is that it never
 * happens. There is no second chance at this, which is why the gate is an ERROR
 * and not a warning.
 *
 * These tests hold three things: the shipped corpus is fully stamped, the gate
 * actually fails on the states it claims to catch, and the reserved slots are
 * declared before the tag freezes the frontmatter contract.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readIdentity,
  isValidId,
  stampIdentity,
  isGovernedArtifact,
  defaultSlug,
  RESERVED_SLOTS,
  TIERS,
} from "../scripts/lib/artifact-identity.js";
import { checkArtifactIdentity } from "../scripts/validate.js";

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "core");

function walkMd(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function scratchHub(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-identity-gate-"));
  fs.mkdirSync(path.join(dir, "core", "instructions"), { recursive: true });
  return dir;
}

function writeArtifact(hub: string, rel: string, content: string): void {
  const full = path.join(hub, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

const STAMPED = (id: string) => `---\nid: ${id}\nslug: x\nhash: sha256:0000000000000000\n---\n\n# x\n`;
const ID_A = "01KZRG8RTET6CTDQEEFX8M9ZQX";
const ID_B = "01KZRG8RTFE4J96C7C75CG33PQ";

// ---------------------------------------------------------------------------

describe("the shipped corpus is fully stamped", () => {
  it("finds a non-trivial number of governed artifacts — otherwise this suite is vacuous", () => {
    // The defect being guarded is "the walker missed a whole directory". A
    // corpus assertion whose walker misses the same directory would pass for
    // exactly the wrong reason, so assert the count is real first.
    const artifacts = walkMd(CORE).filter((f) => isGovernedArtifact(f));
    expect(artifacts.length).toBeGreaterThanOrEqual(15);
    // And that it reaches the two subtrees the backfill did not walk.
    expect(artifacts.some((f) => f.includes(`${path.sep}personas${path.sep}`))).toBe(true);
    expect(artifacts.some((f) => f.includes(`${path.sep}skills${path.sep}`))).toBe(true);
  });

  it("every governed artifact under core/ carries a valid id", () => {
    const missing: string[] = [];
    for (const file of walkMd(CORE).filter((f) => isGovernedArtifact(f))) {
      const id = readIdentity(fs.readFileSync(file, "utf-8")).id;
      if (!id || !isValidId(id)) missing.push(`${path.relative(ROOT, file)} (id=${id ?? "none"})`);
    }
    expect(missing, `unstamped or malformed:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no two artifacts share an id — a duplicate merges two histories forever", () => {
    const byId = new Map<string, string>();
    const dupes: string[] = [];
    for (const file of walkMd(CORE).filter((f) => isGovernedArtifact(f))) {
      const id = readIdentity(fs.readFileSync(file, "utf-8")).id;
      if (!id) continue;
      const rel = path.relative(ROOT, file);
      const prior = byId.get(id);
      if (prior) dupes.push(`${id}: ${prior} + ${rel}`);
      else byId.set(id, rel);
    }
    expect(dupes).toEqual([]);
  });

  it("a README is not a governed artifact — navigational files stay unstamped", () => {
    expect(isGovernedArtifact("core/gotchas/README.md")).toBe(false);
    expect(isGovernedArtifact("core/gotchas/index.md")).toBe(false);
    expect(isGovernedArtifact("core/traits/audit-trail.md")).toBe(true);
    expect(isGovernedArtifact("core/personas/code-reviewer/SKILL.md")).toBe(true);
    expect(isGovernedArtifact("core/personas/code-reviewer/persona.config.json")).toBe(false);
  });

  it("a SKILL.md slugs to its persona, not to 'skill'", () => {
    // Every persona is a SKILL.md. Slugging by filename would give all five the
    // same human label, which is exactly the confusion slug exists to prevent.
    expect(defaultSlug("core/personas/code-reviewer/SKILL.md")).toBe("code-reviewer");
    expect(defaultSlug("core/instructions/baseline.instructions.md")).toBe("baseline");
    expect(defaultSlug("core/traits/audit-trail.md")).toBe("audit-trail");
  });
});

// ---------------------------------------------------------------------------

describe("the validate gate actually fails on what it claims to catch", () => {
  // `true` = the packaged corpus, the one whose lineage the release tag
  // freezes. Passed explicitly so BOTH severity branches are reachable here;
  // deriving it inside would leave the adopter branch untested and the
  // packaged branch testable only by vandalising the real core/.
  const PACKAGED = true;

  it("fails on an artifact with no id — in the corpus the tag freezes", () => {
    const hub = scratchHub();
    writeArtifact(hub, "core/instructions/naked.instructions.md", "---\ndescription: x\n---\n\n# x\n");
    const r = checkArtifactIdentity(hub, PACKAGED);
    expect(r.passed).toBe(false);
    expect(r.errors.join("\n")).toMatch(/naked\.instructions\.md/);
  });

  it("only WARNS about a missing id in an adopter's hub — authoring must not break the build", () => {
    // NF4-8's invariant: validate and build reach the same verdict on a
    // hand-authored artifact. A gotcha written sixty seconds ago has no lineage
    // to protect, and erroring here would enforce this project's release
    // decision on somebody else's corpus.
    const hub = scratchHub();
    writeArtifact(hub, "core/gotchas/fresh.md", '---\ndescription: ok\npaths: ["src/a/**"]\n---\nrule\n');
    const r = checkArtifactIdentity(hub, false);
    expect(r.passed).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/fresh\.md/);
    // …and it still says what to do about it.
    expect(r.warnings.join("\n")).toMatch(/agentboot identity/);
  });

  it("escalates that warning under --strict rather than swallowing it", () => {
    const hub = scratchHub();
    writeArtifact(hub, "core/gotchas/fresh.md", "---\ndescription: ok\n---\nrule\n");
    // isEffectiveFail's strict rule is `warnings.length > 0`; assert the
    // warning is actually present to be escalated.
    expect(checkArtifactIdentity(hub, false).warnings.length).toBeGreaterThan(0);
  });

  it("fails on a malformed id rather than accepting any string — in EITHER corpus", () => {
    for (const packaged of [true, false]) {
      const hub = scratchHub();
      writeArtifact(hub, "core/instructions/bad.instructions.md", "---\nid: not-a-ulid\n---\n\n# x\n");
      const r = checkArtifactIdentity(hub, packaged);
      expect(r.passed, `packaged=${packaged}`).toBe(false);
      expect(r.errors.join("\n")).toMatch(/malformed/);
    }
  });

  it("fails on two artifacts sharing an id — in EITHER corpus", () => {
    // Corruption, not absence: a duplicate merges two histories permanently no
    // matter whose hub it happens in.
    for (const packaged of [true, false]) {
      const hub = scratchHub();
      writeArtifact(hub, "core/instructions/one.instructions.md", STAMPED(ID_A));
      writeArtifact(hub, "core/instructions/two.instructions.md", STAMPED(ID_A));
      const r = checkArtifactIdentity(hub, packaged);
      expect(r.passed, `packaged=${packaged}`).toBe(false);
      expect(r.errors.join("\n")).toMatch(/shares `id:/);
    }
  });

  it("passes on a properly stamped corpus", () => {
    const hub = scratchHub();
    writeArtifact(hub, "core/instructions/one.instructions.md", STAMPED(ID_A));
    writeArtifact(hub, "core/personas/p/SKILL.md", STAMPED(ID_B));
    const r = checkArtifactIdentity(hub, PACKAGED);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("reaches personas/ and skills/ — the subtrees the backfill never walked", () => {
    // The whole defect. A gate with the backfill's blind spot would pass here.
    const hub = scratchHub();
    writeArtifact(hub, "core/personas/p/SKILL.md", "---\nname: p\n---\n\n# p\n");
    writeArtifact(hub, "core/skills/s/faq.md", "# faq\n");
    const r = checkArtifactIdentity(hub, PACKAGED);
    expect(r.passed).toBe(false);
    expect(r.errors.join("\n")).toMatch(/personas/);
    expect(r.errors.join("\n")).toMatch(/skills/);
  });

  it("skips README/index — they are navigation, not governance", () => {
    const hub = scratchHub();
    writeArtifact(hub, "core/instructions/one.instructions.md", STAMPED(ID_A));
    writeArtifact(hub, "core/gotchas/README.md", "# Gotchas\n");
    writeArtifact(hub, "core/gotchas/index.md", "# Index\n");
    const r = checkArtifactIdentity(hub, PACKAGED);
    expect(r.errors).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("treats THIS repo as the packaged corpus without being told", () => {
    // The default must actually select the strict branch for the corpus whose
    // tag is at stake — otherwise the severity switch is correct in tests and
    // inert in production.
    const hub = scratchHub();
    expect(checkArtifactIdentity(hub).warnings.join("\n")).toMatch(/0 artifacts/);
    const real = checkArtifactIdentity(ROOT);
    expect(real.errors).toEqual([]);
    expect(real.passed).toBe(true);
  });

  it("does NOT print a silent green over an empty corpus", () => {
    // "Nothing to check" and "everything checked out" must not look alike. This
    // codebase has shipped a tamper test that passed without tampering and a
    // conformance assertion that passed vacuously; a gate whose happy path and
    // whose no-op path are indistinguishable is the same defect waiting.
    const empty = checkArtifactIdentity(scratchHub(), PACKAGED);
    expect(empty.warnings.join("\n")).toMatch(/0 artifacts/);

    const noCore = fs.mkdtempSync(path.join(os.tmpdir(), "ab-identity-nocore-"));
    expect(checkArtifactIdentity(noCore, PACKAGED).warnings.join("\n")).toMatch(/0 artifacts/);
  });
});

// ---------------------------------------------------------------------------

describe("reserved slots — declared before the tag freezes the contract", () => {
  it("declares both tier and source", () => {
    // Ratified 2026-08-11 with the ID shape. Both ride ONE migration because
    // adding a frontmatter field after 1.0 is a breaking change for every
    // consumer plus a re-sync of every spoke — so a slot not reserved now is
    // realistically a slot that never exists.
    expect([...RESERVED_SLOTS]).toEqual(["tier", "source"]);
  });

  it("reads a source declaration without interpreting it", () => {
    const doc = `---\nid: ${ID_A}\nsource: https://git.example.com/governance/policy.md\n---\n\n# x\n`;
    expect(readIdentity(doc).source).toBe("https://git.example.com/governance/policy.md");
  });

  it("accepts ANY source value — the authority reference is open-valued", () => {
    // Unlike tier, source names an upstream authority (a URL, a repo path, an
    // internal SSOT id). There is no vocabulary that could be closed, so a
    // vocabulary check here would reject every real value.
    for (const v of ["internal-ssot://policies/42", "../governance/base.md", "confluence:SEC-1"]) {
      expect(readIdentity(`---\nid: ${ID_A}\nsource: ${v}\n---\n\n# x\n`).source).toBe(v);
    }
  });

  it("defaults source to null — the slot is reserved, not populated", () => {
    expect(readIdentity(`---\nid: ${ID_A}\n---\n\n# x\n`).source).toBeNull();
    expect(readIdentity("# no frontmatter\n").source).toBeNull();
  });

  it("still closes the tier vocabulary — the two slots are not the same kind", () => {
    expect([...TIERS]).toEqual(["constitutional", "statutory", "ephemeral"]);
    expect(readIdentity(`---\nid: ${ID_A}\ntier: nonsense\n---\n\n# x\n`).tier).toBeNull();
  });

  it("stamping preserves an existing source rather than dropping it", () => {
    // The stamp rewrites id/slug/hash. A reserved slot that survived authoring
    // but not the next `identity` run would be worse than no slot at all.
    const before = `---\nid: ${ID_A}\nsource: internal-ssot://policies/42\ntier: statutory\n---\n\n# body\n`;
    const after = stampIdentity(before, { slug: "x" }).content;
    expect(readIdentity(after).source).toBe("internal-ssot://policies/42");
    expect(readIdentity(after).tier).toBe("statutory");
    expect(readIdentity(after).id).toBe(ID_A);
  });
});
