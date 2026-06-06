import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildInstrumentCatalog } from "@/lib/finance/instrumentCatalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/instruments
 *
 * Returns the full instrument catalog sorted by opinion count descending.
 * The catalog is built from all non-suppressed ExpertOpinion rows, with
 * label variants collapsed through NORMALIZATION_MAP before counting.
 *
 * Top 10 items by count are tagged isPopular: true — used by the mobile
 * instrument picker to show a curated "Popular" section before the user
 * types a search query.
 *
 * No auth required — the catalog is public aggregate data.
 * Cache-Control: public, max-age=300 (5 minutes) so mobile clients and CDN
 * edge nodes can serve stale results without hammering the DB on every open.
 */
export async function GET() {
  const items = await buildInstrumentCatalog(prisma);

  const response = NextResponse.json({ items });
  response.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  return response;
}
