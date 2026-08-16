/**
 * Artifact identity — the VIN.
 *
 * Ratified in decision-0005 (2026-08-07): every governance artifact carries a
 * stable, permanent identifier, stamped BEFORE v1.0.0 GA.
 *
 * WHY PRE-GA, since this will be questioned later: an identifier's entire value
 * is stability across time, and identity cannot be minted into the past. Stamped
 * now, an ID eventually supports "this artifact, continuously, since 2026."
 * Stamped later it can only say "since <later>", and everything before is
 * unattributable — renames, splits, merges and scope moves become forensic
 * reconstruction from git history and fuzzy content matching. After the 1.0 tag
 * the emitted surface is a compatibility contract, every already-distributed
 * spoke lacks the field, and retrofitting means re-syncing the fleet.
 *
 * SCOPE IS DELIBERATELY MINIMAL. This module mints and reads identity. It does
 * NOT implement the region map, any telemetry change, or any measurement.
 * Reserving an option is not exercising it.
 *
 * SHAPE (ratified 2026-08-08): ULID + slug + content hash, as three separate
 * fields with three separate jobs.
 *   id    — opaque, permanent, survives rename/split/merge/scope-move
 *   slug  — human-readable, may change freely, never an identity key
 *   hash  — content integrity for THIS revision, changes on every edit
 *
 * Conflating identity with integrity is the classic error: a content hash
 * identifies a *version*, not an artifact, so lineage dies at the first edit.
 */
import crypto from "crypto";
import { frontmatterBlock, normalizeForFrontmatter } from "./frontmatter.js";

/** Crockford base32 — excludes I, L, O, U to avoid transcription ambiguity. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number, len: number): string {
  let out = "";
  for (let i = len - 1; i >= 0; i--) {
    out = CROCKFORD[ms % 32]! + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CROCKFORD[bytes[i]! % 32]!;
  return out;
}

/**
 * A ULID: 26 chars, 10 of timestamp + 16 of randomness.
 *
 * Chosen over a UUIDv4 because ULIDs sort lexicographically by creation time,
 * which makes an artifact corpus browsable and diffable without a lookup table —
 * and over a content hash because a hash is not stable across edits.
 * Implemented inline rather than taking a dependency: a governance tool adding a
 * transitive dependency to generate 26 characters is a poor trade.
 */
export function mintId(now: number = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}

export function isValidId(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}

/**
 * Navigational files are not governed artifacts. A README describes a directory;
 * it carries no control text, so it has no lineage worth identifying.
 */
const NAVIGATIONAL = /^(README|index)\.md$/i;

/**
 * Is this file a governed artifact — one that MUST carry identity?
 *
 * This predicate is the single definition, exported so the gate that ENFORCES
 * the stamp and the backfill that WRITES it cannot drift apart. The two
 * disagreeing is how nine of eighteen artifacts ended up unstamped while the
 * backfill reported success over the ten it happened to walk: the writer's
 * notion of "artifact" was a hard-coded list of three flat directories, and
 * there was no reader to contradict it.
 */
export function isGovernedArtifact(filePath: string): boolean {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base.toLowerCase().endsWith(".md")) return false;
  return !NAVIGATIONAL.test(base);
}

/**
 * The slug an artifact gets when it has none — derived from the filename, with
 * the compound extensions (`.instructions.md`, `.gotcha.md`) folded away.
 *
 * A bare `SKILL.md` would slug to "skill" for every persona, so a SKILL.md
 * takes its PARENT DIRECTORY's name instead — `code-reviewer`, not `skill`.
 * The slug is a human label and may change freely; only `id` is identity.
 */
export function defaultSlug(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const base = parts.pop() ?? "";
  if (/^SKILL\.md$/i.test(base)) return parts.pop() ?? "skill";
  return base.replace(/\.(instructions|gotchas?)?\.?md$/, "").replace(/\.md$/, "");
}

/**
 * Content hash of the artifact BODY, excluding frontmatter.
 *
 * V3: normalize first. Against CRLF content the strip matched nothing, so the
 * hash covered the FRONTMATTER as well — an id/description edit then read as a
 * body change, and the same artifact hashed differently on Windows and macOS.
 */
export function contentHash(content: string): string {
  const body = normalizeForFrontmatter(content).replace(/^---\n[\s\S]*?\n---\n?/, "");
  return "sha256:" + crypto.createHash("sha256").update(body, "utf-8").digest("hex").slice(0, 16);
}

/** Tier vocabulary — RESERVED SLOT ONLY. Nothing consumes this yet (XP3). */
export const TIERS = ["constitutional", "statutory", "ephemeral"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * The reserved frontmatter slots — declared now, consumed by nothing.
 *
 * Ratified 2026-08-11 alongside the ID shape. The reason both ride ONE
 * migration rather than two: after the 1.0 tag the emitted frontmatter is a
 * compatibility contract, so adding a field means a breaking change for every
 * consumer plus a re-sync of every synced spoke. The realistic post-tag outcome
 * is that the field is never added at all. Reserving an option is not
 * exercising it, and it costs nothing to carry an unread key.
 *
 *   tier   — closed vocabulary (TIERS). Governance weight of the artifact.
 *   source — OPEN-VALUED, deliberately. It declares the upstream authority an
 *            artifact is derived from, for orgs whose governance SSOT lives
 *            outside the hub. An authority is a reference (a URL, a repo path,
 *            an internal SSOT id) — enumerating those centrally is not
 *            possible, so there is no vocabulary to close. The detect half
 *            (reporting divergence from the declared authority) is post-1.0
 *            and reuses the drift machinery; nothing reads this field today.
 */
export const RESERVED_SLOTS = ["tier", "source"] as const;
export type ReservedSlot = (typeof RESERVED_SLOTS)[number];

export interface Identity {
  id: string | null;
  slug: string | null;
  hash: string | null;
  tier: Tier | null;
  /** RESERVED (X18 upstream authority). Read, never acted on. */
  source: string | null;
}

// C1: the tolerant extractor. A BOM/CRLF artifact previously reported "no
// frontmatter" here, so identity stamping silently minted a fresh id for an
// artifact that already carried one.
const fmBlock = frontmatterBlock;

function scalar(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "im"));
  return m ? m[1]!.trim() : null;
}

export function readIdentity(content: string): Identity {
  const fm = fmBlock(content);
  if (!fm) return { id: null, slug: null, hash: null, tier: null, source: null };
  const tier = scalar(fm, "tier");
  return {
    id: scalar(fm, "id"),
    slug: scalar(fm, "slug"),
    hash: scalar(fm, "hash"),
    tier: (TIERS as readonly string[]).includes(tier ?? "") ? (tier as Tier) : null,
    // No vocabulary check: `source` is an open-valued authority reference. A
    // closed check here would reject every real value the field exists to hold.
    source: scalar(fm, "source"),
  };
}

/**
 * Stamp identity onto an artifact, idempotently.
 *
 * An EXISTING id is never regenerated — that is the whole point of the field, and
 * a backfill that re-mints on every run would destroy the lineage it exists to
 * preserve. The hash IS refreshed, because it describes the current revision.
 */
export function stampIdentity(
  content: string,
  opts: { slug: string; now?: number; createFrontmatter?: boolean }
): { content: string; changed: boolean; minted: boolean } {
  let fm = fmBlock(content);

  // Traits and gotchas historically carry no frontmatter at all. Identity is
  // most valuable on exactly those — they are the reusable primitives — so the
  // caller may opt in to creating the block. Off by default: silently growing
  // frontmatter on arbitrary Markdown (a README, an index) is not a thing a
  // backfill should do on its own initiative.
  if (fm === null) {
    if (!opts.createFrontmatter) return { content, changed: false, minted: false };
    const id = mintId(opts.now);
    const body = content.replace(/^\n+/, "");
    // Hash the STAMPED document, never the pre-stamp one.
    //
    // The reader/writer split this closes: `contentHash` on a file with no
    // frontmatter has nothing to strip, so it hashed the bare body — but the
    // document this function returns puts that body AFTER a `---\n…\n---\n\n`
    // header, and the reader's strip leaves the blank separator line attached.
    // Writer hashed "# Trait…", reader hashed "\n# Trait…", and the two never
    // agreed. Seven of the eight wrong hashes in the shipped corpus were minted
    // by exactly this, at stamp time, on artifacts nobody had edited since.
    //
    // Hashing the final document instead of reasoning about the difference is
    // deliberate: it keeps ONE hashing path, and the value it computes is by
    // construction the value the reader will recompute. The placeholder header
    // is byte-identical to the real one apart from the hash value itself, which
    // lives inside the frontmatter `contentHash` excludes.
    const header = (h: string): string => `---\nid: ${id}\nslug: ${opts.slug}\nhash: ${h}\n---\n\n`;
    return { content: header(contentHash(header("") + body)) + body, changed: true, minted: true };
  }

  const existing = readIdentity(content);
  const id = existing.id && isValidId(existing.id) ? existing.id : mintId(opts.now);
  const minted = id !== existing.id;
  // Safe on this branch — `set` only ever rewrites frontmatter, and
  // `contentHash` excludes frontmatter, so the pre-stamp and post-stamp
  // documents have byte-identical bodies. That is NOT true of the branch above,
  // which prepends a header and changes what the body starts with.
  const hash = contentHash(content);

  let next = fm;
  const set = (key: string, value: string): void => {
    const re = new RegExp(`^\\s*${key}:.*$`, "im");
    if (re.test(next)) next = next.replace(re, `${key}: ${value}`);
    else next += `\n${key}: ${value}`;
  };
  set("id", id);
  set("slug", existing.slug ?? opts.slug);
  set("hash", hash);

  if (next === fm) return { content, changed: false, minted: false };
  return { content: content.replace(fm, next), changed: true, minted };
}
