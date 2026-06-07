import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Valid sort options for the discover feed.
type DiscoverSort = "members" | "recent" | "new";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

/**
 * GET /api/groups/discover
 *
 * Public endpoint — no auth required to browse. If the caller is authenticated,
 * groups they are already a member of are excluded.
 *
 * Query params:
 *   category?: MarketCategory value — filter by category
 *   sort?: "members" | "recent" | "new" (default: "members")
 *   cursor?: opaque pagination cursor (base64 encoded JSON)
 *   limit?: number (default 20, max 50)
 *
 * Only returns groups where visibility = OPEN or REQUEST_TO_JOIN and isArchived = false.
 *
 * S59-T5: Featured groups appear first within the "members" sort.
 * Cursor format for "members" sort has been updated to include `isFeatured` as a
 * leading key: { v: 2, isFeatured: boolean, memberCount: number, id: string }.
 * Old v1 cursors (no `v` field) are gracefully treated as fresh-start (ignored).
 *
 * Response:
 *   { groups: [...], nextCursor: string | null }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Optional auth — exclude groups the user is already in.
  const userId = await getUserIdFromRequest(request).catch(() => null);

  const category = searchParams.get("category") ?? undefined;
  const sortParam = (searchParams.get("sort") ?? "members") as DiscoverSort;
  const sort: DiscoverSort = ["members", "recent", "new"].includes(sortParam)
    ? sortParam
    : "members";

  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(
    isNaN(limitParam) ? PAGE_SIZE_DEFAULT : Math.max(1, limitParam),
    PAGE_SIZE_MAX
  );

  const cursorParam = searchParams.get("cursor");
  let cursor: Record<string, unknown> | undefined;
  if (cursorParam) {
    try {
      cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
      // Malformed cursor — ignore and start from beginning.
      cursor = undefined;
    }
  }

  // Thirty days ago for recentMarketCount
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Base filter: OPEN and REQUEST_TO_JOIN groups, not archived.
  const baseWhere = {
    visibility: { in: ["OPEN", "REQUEST_TO_JOIN"] as ["OPEN", "REQUEST_TO_JOIN"] },
    isArchived: false,
    ...(category ? { category: category as never } : {}),
    ...(userId
      ? {
          memberships: {
            none: { userId, bannedAt: null }
          }
        }
      : {})
  };

  // Build ORDER BY and cursor filter based on sort mode.
  let orderBy: Record<string, unknown>[];
  let cursorWhere: Record<string, unknown> = {};

  if (sort === "members") {
    // S59-T5: Featured groups sort first (isFeatured DESC), then by member count DESC.
    // Cursor v2: { v: 2, isFeatured: boolean, memberCount: number, id: string }
    // Old cursors without `v` field are silently dropped (treated as fresh-start).
    orderBy = [
      { isFeatured: "desc" as const },
      { memberships: { _count: "desc" as const } },
      { id: "asc" as const },
    ];

    const cursorVersion = cursor?.v as number | undefined;
    if (cursorVersion === 2 && cursor?.memberCount !== undefined && cursor?.id !== undefined) {
      const mc = cursor.memberCount as number;
      const cid = cursor.id as string;
      const cf = cursor.isFeatured as boolean;

      cursorWhere = {
        OR: [
          // 1. Drop out of the featured tier: isFeatured false, previous was true.
          { isFeatured: false, ...(cf === true ? {} : { id: { gt: "" } }) }, // always include non-featured after featured
          // Simplified: use explicit tier-break logic
        ]
      };

      // Correct multi-key cursor: (isFeatured DESC, memberCount DESC, id ASC)
      // Page starts AFTER (cf, mc, cid):
      cursorWhere = {
        OR: [
          // Tier 1: featured=false rows always come after featured=true.
          ...(cf ? [{ isFeatured: false }] : []),
          // Tier 2: same isFeatured value, lower memberCount.
          {
            isFeatured: cf,
            memberships: { _count: { lt: mc } }
          },
          // Tier 3: same isFeatured, same memberCount, higher id (tie-break).
          {
            isFeatured: cf,
            memberships: { _count: { equals: mc } },
            id: { gt: cid }
          }
        ]
      };
    }
    // If cursor is absent or is v1 (no `v` field), start from page 1.
  } else if (sort === "recent") {
    // Cursor: { updatedAt: string, id: string }
    orderBy = [{ updatedAt: "desc" as const }, { id: "asc" as const }];
    if (cursor?.updatedAt !== undefined && cursor?.id !== undefined) {
      const ua = new Date(cursor.updatedAt as string);
      const cid = cursor.id as string;
      cursorWhere = {
        OR: [
          { updatedAt: { lt: ua } },
          { updatedAt: { equals: ua }, id: { gt: cid } }
        ]
      };
    }
  } else {
    // sort === "new": Cursor: { createdAt: string, id: string }
    orderBy = [{ createdAt: "desc" as const }, { id: "asc" as const }];
    if (cursor?.createdAt !== undefined && cursor?.id !== undefined) {
      const ca = new Date(cursor.createdAt as string);
      const cid = cursor.id as string;
      cursorWhere = {
        OR: [
          { createdAt: { lt: ca } },
          { createdAt: { equals: ca }, id: { gt: cid } }
        ]
      };
    }
  }

  const groups = await prisma.group.findMany({
    where: { ...baseWhere, ...cursorWhere },
    orderBy,
    take: limit + 1,
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      category: true,
      coverImageUrl: true,
      visibility: true,
      isFeatured: true,
      updatedAt: true,
      createdAt: true,
      owner: {
        select: { username: true }
      },
      _count: {
        select: {
          memberships: {
            where: { bannedAt: null }
          }
        }
      },
      markets: {
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { id: true }
      }
    }
  });

  const hasNextPage = groups.length > limit;
  const pageGroups = hasNextPage ? groups.slice(0, limit) : groups;

  // Build next cursor from the last item in the page.
  let nextCursor: string | null = null;
  if (hasNextPage && pageGroups.length > 0) {
    const last = pageGroups[pageGroups.length - 1];
    let rawCursor: Record<string, unknown>;
    if (sort === "members") {
      // v2 cursor includes isFeatured as the leading key.
      rawCursor = {
        v: 2,
        isFeatured: last.isFeatured,
        memberCount: last._count.memberships,
        id: last.id,
      };
    } else if (sort === "recent") {
      rawCursor = { updatedAt: last.updatedAt.toISOString(), id: last.id };
    } else {
      rawCursor = { createdAt: last.createdAt.toISOString(), id: last.id };
    }
    nextCursor = Buffer.from(JSON.stringify(rawCursor), "utf8").toString("base64url");
  }

  const responseGroups = pageGroups.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description ?? null,
    category: g.category ?? null,
    memberCount: g._count.memberships,
    coverImageUrl: g.coverImageUrl ?? null,
    ownerUsername: g.owner.username,
    recentMarketCount: g.markets.length,
    visibility: g.visibility,
    // S59-T5: editorial curation flag for mobile star badge.
    isFeatured: g.isFeatured,
  }));

  return NextResponse.json({ groups: responseGroups, nextCursor });
}
