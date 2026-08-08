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
import { frontmatterBlock } from "./frontmatter.js";

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

/** Content hash of the artifact BODY, excluding frontmatter. */
export function contentHash(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return "sha256:" + crypto.createHash("sha256").update(body, "utf-8").digest("hex").slice(0, 16);
}

/** Tier vocabulary — RESERVED SLOT ONLY. Nothing consumes this yet (XP3). */
export const TIERS = ["constitutional", "statutory", "ephemeral"] as const;
export type Tier = (typeof TIERS)[number];

export interface Identity {
  id: string | null;
  slug: string | null;
  hash: string | null;
  tier: Tier | null;
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
  if (!fm) return { id: null, slug: null, hash: null, tier: null };
  const tier = scalar(fm, "tier");
  return {
    id: scalar(fm, "id"),
    slug: scalar(fm, "slug"),
    hash: scalar(fm, "hash"),
    tier: (TIERS as readonly string[]).includes(tier ?? "") ? (tier as Tier) : null,
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
    const header = `---\nid: ${id}\nslug: ${opts.slug}\nhash: ${contentHash(content)}\n---\n\n`;
    return { content: header + content.replace(/^\n+/, ""), changed: true, minted: true };
  }

  const existing = readIdentity(content);
  const id = existing.id && isValidId(existing.id) ? existing.id : mintId(opts.now);
  const minted = id !== existing.id;
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
