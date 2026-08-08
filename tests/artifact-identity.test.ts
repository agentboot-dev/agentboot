/**
 * The VIN — artifact identity (decision-0005, ratified pre-GA 2026-08-07).
 *
 * The property these tests exist to protect is STABILITY. An identifier that is
 * regenerated, derived from content, or lost on rename is not an identifier —
 * it is a version stamp, and it destroys the lineage the field exists to carry.
 * Every test below is really asking one question: does the id survive?
 */

import { describe, it, expect } from "vitest";
import {
  mintId, isValidId, contentHash, readIdentity, stampIdentity, TIERS,
} from "../scripts/lib/artifact-identity.js";

const doc = (fm: string, body = "# body\n") => `---\n${fm}\n---\n\n${body}`;

describe("mintId", () => {
  it("produces a valid 26-char ULID", () => {
    const id = mintId();
    expect(id).toHaveLength(26);
    expect(isValidId(id)).toBe(true);
  });

  it("is unique across rapid successive calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => mintId()));
    expect(ids.size).toBe(500);
  });

  it("sorts lexicographically by creation time", () => {
    // This is why ULID rather than UUIDv4 — a corpus is browsable without a
    // lookup table.
    const early = mintId(1000000);
    const late = mintId(9000000);
    expect(early < late).toBe(true);
  });

  it("excludes ambiguous characters (I, L, O, U)", () => {
    const joined = Array.from({ length: 200 }, () => mintId()).join("");
    expect(joined).not.toMatch(/[ILOU]/);
  });

  it("rejects malformed ids", () => {
    expect(isValidId("nope")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("I".repeat(26))).toBe(false); // excluded char
  });
});

describe("contentHash", () => {
  it("ignores frontmatter — it describes the BODY", () => {
    // Identity and tier live in frontmatter; if they fed the hash, stamping an
    // id would change the hash, which would change on every stamp forever.
    expect(contentHash(doc("a: 1"))).toBe(contentHash(doc("b: 2")));
  });

  it("changes when the body changes", () => {
    expect(contentHash(doc("a: 1", "one\n"))).not.toBe(contentHash(doc("a: 1", "two\n")));
  });
});

describe("stampIdentity", () => {
  it("mints an id when absent", () => {
    const r = stampIdentity(doc("description: x"), { slug: "my-artifact" });
    expect(r.minted).toBe(true);
    expect(isValidId(readIdentity(r.content).id!)).toBe(true);
    expect(readIdentity(r.content).slug).toBe("my-artifact");
  });

  it("NEVER regenerates an existing id — the load-bearing property", () => {
    const first = stampIdentity(doc("description: x"), { slug: "a" });
    const id = readIdentity(first.content).id;
    const second = stampIdentity(first.content, { slug: "a" });
    expect(second.minted).toBe(false);
    expect(readIdentity(second.content).id).toBe(id);
  });

  it("survives a rename — id stable, slug free to change", () => {
    const orig = stampIdentity(doc("description: x"), { slug: "old-name" });
    const id = readIdentity(orig.content).id;
    const renamed = orig.content.replace("slug: old-name", "slug: new-name");
    const after = stampIdentity(renamed, { slug: "ignored" });
    expect(readIdentity(after.content).id).toBe(id);
    expect(readIdentity(after.content).slug).toBe("new-name");
  });

  it("survives a body edit — id stable, hash moves", () => {
    const orig = stampIdentity(doc("description: x", "before\n"), { slug: "a" });
    const id = readIdentity(orig.content).id;
    const h1 = readIdentity(orig.content).hash;
    const edited = stampIdentity(orig.content.replace("before", "after"), { slug: "a" });
    expect(readIdentity(edited.content).id).toBe(id);
    expect(readIdentity(edited.content).hash).not.toBe(h1);
  });

  it("is idempotent on unchanged content", () => {
    const once = stampIdentity(doc("description: x"), { slug: "a" });
    const twice = stampIdentity(once.content, { slug: "a" });
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once.content);
  });

  it("replaces an invalid id rather than preserving garbage", () => {
    const r = stampIdentity(doc("description: x\nid: not-a-ulid"), { slug: "a" });
    expect(r.minted).toBe(true);
    expect(isValidId(readIdentity(r.content).id!)).toBe(true);
  });

  it("leaves a file with no frontmatter untouched", () => {
    const raw = "# just a heading\n";
    expect(stampIdentity(raw, { slug: "a" }).content).toBe(raw);
  });

  it("preserves unrelated frontmatter keys", () => {
    const r = stampIdentity(doc('description: x\napplyTo: "**/*"\nguardrail: hard'), { slug: "a" });
    expect(r.content).toContain("guardrail: hard");
    expect(r.content).toContain('applyTo: "**/*"');
  });
});

describe("tier — RESERVED SLOT ONLY (XP3)", () => {
  it("reads a valid tier", () => {
    expect(readIdentity(doc("tier: constitutional")).tier).toBe("constitutional");
  });

  it("ignores an unknown tier rather than accepting it", () => {
    expect(readIdentity(doc("tier: nonsense")).tier).toBeNull();
  });

  it("defaults to null — untagged artifacts are NOT assigned a tier", () => {
    // Deliberate: assigning a default retroactively tiers every artifact
    // authored before the field existed. The slot is reserved, not populated.
    expect(readIdentity(doc("description: x")).tier).toBeNull();
  });

  it("carries the ratified vocabulary", () => {
    expect([...TIERS]).toEqual(["constitutional", "statutory", "ephemeral"]);
  });
});
