/**
 * Expert public-profile slug generation.
 *
 * Shared by:
 *  - apps/api/scripts/backfill-expert-slugs.ts (one-time backfill for existing rows)
 *  - apps/api/lib/ai/extractExpertOpinions.ts (generates a slug for newly-created Experts
 *    at upsert time, so every Expert has a slug from creation onward)
 *
 * Base format: kebab-case("<name> <organization>"), e.g.
 *   name="Rupak De", organization="LKP Securities" -> "rupak-de-lkp-securities"
 *
 * Collision handling: numeric suffix appended and re-checked against the DB
 * ("-2", "-3", ...) until a free slug is found. Deterministic (not random) so
 * repeated backfill runs are idempotent and produce the same result.
 */

import type { PrismaClient } from "@prisma/client";

const MAX_SLUG_LENGTH = 80;
const MAX_COLLISION_ATTEMPTS = 50;

/**
 * Pure kebab-case transform. Lowercases, strips diacritics, replaces anything that
 * isn't a-z0-9 with a hyphen, collapses runs of hyphens, trims leading/trailing
 * hyphens, and caps length so absurdly long names/orgs don't blow past reasonable
 * URL lengths (truncation happens on a hyphen boundary where possible).
 */
export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (combining marks left by NFKD)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (normalized.length <= MAX_SLUG_LENGTH) {
    return normalized;
  }

  const truncated = normalized.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = truncated.lastIndexOf("-");
  // Prefer trimming on a hyphen boundary if it doesn't throw away too much.
  return lastHyphen > MAX_SLUG_LENGTH * 0.6 ? truncated.slice(0, lastHyphen) : truncated;
}

/**
 * Builds the base (pre-collision-check) slug for an Expert from name + organization.
 */
export function baseExpertSlug(name: string, organization: string): string {
  const combined = slugify(`${name} ${organization}`);
  return combined.length > 0 ? combined : slugify(name) || "analyst";
}

/**
 * Resolves a collision-free, unique slug for an Expert, checking the DB for existing
 * matches and appending a numeric suffix as needed. `excludeExpertId` lets the backfill
 * script re-run idempotently against a row that (in a race) already grabbed its own
 * candidate slug.
 */
export async function generateUniqueExpertSlug(
  prisma: PrismaClient,
  name: string,
  organization: string,
  excludeExpertId?: string
): Promise<string> {
  const base = baseExpertSlug(name, organization);

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;

    const existing = await prisma.expert.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing || existing.id === excludeExpertId) {
      return candidate;
    }
  }

  // Extremely unlikely (50 experts with the identical name+org base slug) — fall back to
  // a short random suffix so we never hard-fail extraction/backfill over a slug collision.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
