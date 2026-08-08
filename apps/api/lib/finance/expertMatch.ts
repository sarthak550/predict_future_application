/**
 * Extraction-time duplicate-expert prevention.
 *
 * Root cause of the duplicate-analyst problem (founder priority, 2026-08): Expert has
 * `@@unique([name, organization])`, so exact repeats never duplicate — but the AI
 * extractor emits whatever org spelling appears in a given article ("Geojit
 * Investments" today, "Geojit Investments Limited" tomorrow), and each new spelling
 * passes the exact-match unique constraint and creates a brand-new Expert row for a
 * person who already has a profile.
 *
 * findOrCreateExpert() replaces the old direct `prisma.expert.upsert()` call in
 * lib/ai/extractExpertOpinions.ts. It looks up candidates by nameNormalized (indexed
 * — see the Expert.nameNormalized column) and applies the EXACT SAME org-variant
 * confidence test the offline merge script uses (lib/finance/expertDedup.ts) — see
 * that module's doc comment for why the two must never diverge.
 *
 * Stability rule: when an existing expert is reused via the fuzzy path, its
 * organization string is NEVER overwritten. A single article's org spelling is not
 * a reliable enough signal to keep rewriting a profile's canonical org back and
 * forth; scripts/merge-duplicate-experts.ts is the only place that intentionally
 * upgrades an Expert's organization field (to the most complete variant, once, as
 * part of an explicit merge).
 */

import type { Expert, PrismaClient } from "@prisma/client";

import { normalizeExpertName, orgVariantConfidence } from "@/lib/finance/expertDedup";
import { generateUniqueExpertSlug } from "@/lib/finance/expertSlug";

/** Narrow shape used for the candidate lookup — keep this in sync with the fields
 *  read below if the query's `select` changes. */
type ExpertCandidate = Pick<Expert, "id" | "name" | "organization" | "slug" | "verified">;

/**
 * Finds an existing Expert to reuse for (name, organization), or creates a new one.
 *
 * Lookup order:
 *  1. Exact (name, organization) match among same-normalized-name candidates — the
 *     common case, behaviourally identical to the old upsert's exact-match path.
 *  2. Fuzzy org-variant match (orgVariantConfidence) among the same candidates —
 *     reuse the existing expert; org string is left untouched (stability wins).
 *  3. No match — create a new Expert with a freshly generated slug and the
 *     normalized name pre-computed for future lookups.
 *
 * Never throws on the happy path; a slug-generation or create race is surfaced to
 * the caller like any other Prisma error (extraction's persistExpertOpinions
 * already wraps each opinion's persistence in its own try/catch).
 */
export async function findOrCreateExpert(
  prisma: PrismaClient,
  name: string,
  organization: string,
  verified: boolean
): Promise<ExpertCandidate> {
  const nameNormalized = normalizeExpertName(name);

  // A blank/unnormalizable name (should not happen — persistExpertOpinions always
  // passes a non-empty displayName — but guard defensively) can't be safely fuzzy-
  // matched: an empty nameNormalized would match every other blank-name row,
  // which are near-certainly unrelated source-attribution entities, not the same
  // person. Fall back to the plain exact upsert in that case.
  if (nameNormalized.length > 0) {
    const candidates = await prisma.expert.findMany({
      where: { nameNormalized },
      select: { id: true, name: true, organization: true, slug: true, verified: true },
    });

    const exact = candidates.find((c) => c.name === name && c.organization === organization);
    if (exact) return exact;

    const fuzzy = candidates.find((c) => orgVariantConfidence(c.organization, organization));
    if (fuzzy) {
      console.info(
        `[expertMatch] Reusing existing expert ${fuzzy.id} ("${fuzzy.name}" / "${fuzzy.organization}") ` +
          `for new org variant "${organization}" — org string left unchanged (stability wins)`
      );
      return fuzzy;
    }
  }

  // No confident match — this really is either a brand-new person or (rarely) the
  // very first sighting of an existing person under a genuinely new normalized
  // name (e.g. a typo-fixed byline). Create a new Expert, same as the old upsert's
  // create branch.
  const slug = await generateUniqueExpertSlug(prisma, name, organization);
  return prisma.expert.upsert({
    where: { name_organization: { name, organization } },
    update: {}, // Defensive: a concurrent request may have just created this exact pair.
    create: { name, organization, verified, slug, nameNormalized },
    select: { id: true, name: true, organization: true, slug: true, verified: true },
  });
}
