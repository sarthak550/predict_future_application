import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/profile/me/positions
 *
 * Returns the authenticated user's full positions list, ordered so that
 * open markets appear first (most-recent within each group). Unlike the
 * /api/profile/me endpoint which caps positions at take:10, this endpoint
 * returns all positions so the "My Bets" screen is complete.
 *
 * Each row includes: id, side, amount, createdAt, and a market sub-object
 * (id, title, status, winningSide) matching the ApiPositionSummary shape.
 *
 * Pagination: the volume of positions per user is modest (hundreds, not
 * millions), so we return all rows without cursor pagination. If this
 * becomes a performance concern, add limit/cursor later.
 */
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Fetch all positions in two passes: open markets first, then the rest.
  // We rely on Prisma's orderBy array to sort by market status (OPEN first),
  // then by createdAt DESC within each group.
  const positions = await prisma.marketPosition.findMany({
    where: { userId },
    select: {
      id: true,
      side: true,
      amount: true,
      createdAt: true,
      market: {
        select: {
          id: true,
          title: true,
          status: true,
          outcome: true,
        },
      },
    },
    orderBy: [
      // Prisma does not support computed ORDER BY on related fields,
      // so we fetch all and sort in application code below.
      { createdAt: "desc" },
    ],
  });

  // Application-level sort: open markets first, then everything else;
  // within each group, most-recent position first (already from DB order).
  const STATUS_GROUP: Record<string, number> = {
    OPEN: 0,
    DRAFT: 1,
    PENDING_REVIEW: 1,
    CLOSED: 1,
    AWAITING_RESOLUTION: 1,
    RESOLVING: 1,
    RESOLVED: 2,
    CANCELLED: 2,
  };

  positions.sort((a, b) => {
    const ga = STATUS_GROUP[a.market.status] ?? 1;
    const gb = STATUS_GROUP[b.market.status] ?? 1;
    if (ga !== gb) return ga - gb;
    // Within same group: most-recent first (already from DB, preserve)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const rows = positions.map((p) => ({
    id: p.id,
    side: p.side,
    amount: p.amount,
    createdAt: p.createdAt.toISOString(),
    market: {
      id: p.market.id,
      title: p.market.title,
      status: p.market.status,
      winningSide:
        p.market.outcome === "YES"
          ? "YES"
          : p.market.outcome === "NO"
            ? "NO"
            : null,
    },
  }));

  return NextResponse.json({ positions: rows, total: rows.length });
}
