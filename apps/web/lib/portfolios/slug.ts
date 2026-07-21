/**
 * Portfolio slug generation (P3.1). Mirrors apps/api/lib/finance/expertSlug.ts's
 * generateUniqueExpertSlug — deterministic numeric-suffix collision handling (not a
 * random suffix) so a re-run of the same input is reproducible and the slug stays
 * readable for the future public /portfolios/[slug] page (P3.2).
 */

import type { PrismaClient } from "@prisma/client";

import { slugify } from "@predict-future/utils";

const MAX_SLUG_LENGTH = 60;
const MAX_COLLISION_ATTEMPTS = 50;

export function basePortfolioSlug(name: string): string {
  const base = slugify(name).slice(0, MAX_SLUG_LENGTH);
  return base || "portfolio";
}

export async function generateUniquePortfolioSlug(prisma: PrismaClient, name: string): Promise<string> {
  const base = basePortfolioSlug(name);

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.portfolio.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }

  // Astronomically unlikely (50 portfolios with the identical name-derived base slug)
  // — fall back to a short random suffix so slug collisions never hard-fail creation.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
