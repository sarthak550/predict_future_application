import { MarketCategory, MarketStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { notifyGroupMembersOfNewMarket } from "@/lib/groups/group-request-push";
import { createPredictionMarket } from "@/lib/markets/create";
import { PUBLIC_MARKET_SCALAR_SELECT, sanitizeMarketSourceFields } from "@/lib/markets/publicSelect";
import { computeMarketRankScore, rankMarkets } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";
import { createMarketSchema } from "@/lib/validations/market";

/** Statuses hidden from public market lists by default — unmoderated or removed. */
const UNAPPROVED_STATUSES: MarketStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED", "HOST_TIMEOUT"];

const DEFAULT_PAGE_SIZE = 20;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const includeUnapproved = searchParams.get("includeUnapproved") === "true";
  const category = searchParams.get("category");
  const q = searchParams.get("q");
  const featured = searchParams.get("featured");
  const sort = searchParams.get("sort");
  const limitParam = searchParams.get("limit");
  const cursorParam = searchParams.get("cursor");
  // Guard against NaN: parseInt("abc") is NaN, which would propagate to take:NaN and
  // make Prisma throw an uncaught 500 (this is a public route).
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : DEFAULT_PAGE_SIZE;

  // Resolve viewer for both admin check and iSaved population.
  const viewerId = await getUserIdFromRequest(request).catch(() => null);

  // Resolve viewer role to decide whether to honor includeUnapproved=true (admin/mod only).
  let viewerIsModerator = false;
  if (includeUnapproved && viewerId) {
    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { role: true },
    });
    viewerIsModerator = viewer?.role === "ADMIN" || viewer?.role === "MODERATOR";
  }

  // Status filter logic:
  //   - If client passed an explicit ?status=, respect it (their explicit choice).
  //   - Else if includeUnapproved=true AND viewer is admin/moderator, no status filter (return all).
  //   - Otherwise default to hiding DRAFT / PENDING_REVIEW / REJECTED / HOST_TIMEOUT.
  const explicitStatusFilter =
    status && Object.values(MarketStatus).includes(status as MarketStatus)
      ? { status: status as MarketStatus }
      : null;
  const defaultUnapprovedFilter =
    !explicitStatusFilter && !(includeUnapproved && viewerIsModerator)
      ? { status: { notIn: UNAPPROVED_STATUSES } }
      : null;

  const markets = await prisma.market.findMany({
    where: {
      visibility: "PUBLIC",
      storyId: null,
      // Flagship Finance polls live exclusively in the Finance tab carousel,
      // not in the general Markets list.
      flagshipEventAt: null,
      ...(explicitStatusFilter ?? {}),
      ...(defaultUnapprovedFilter ?? {}),
      ...(category && Object.values(MarketCategory).includes(category as MarketCategory)
        ? { category: category as MarketCategory }
        : {}),
      ...(featured === "true" ? { isFeatured: true } : {}),
      ...(q
        ? {
            OR: [
              {
                title: {
                  contains: q,
                  mode: "insensitive"
                }
              },
              {
                description: {
                  contains: q,
                  mode: "insensitive"
                }
              },
              {
                creator: {
                  username: {
                    contains: q,
                    mode: "insensitive"
                  }
                }
              }
            ]
          }
        : {})
    },
    // Cursor pagination: when a cursor is provided, skip past it.
    ...(cursorParam ? { cursor: { id: cursorParam }, skip: 1 } : {}),
    // Always fetch one extra to determine hasMore.
    take: limit + 1,
    select: {
      ...PUBLIC_MARKET_SCALAR_SELECT,
      creator: {
        select: {
          id: true,
          username: true,
          displayMode: true,
          reputationScore: true,
          stats: {
            select: {
              hostTrustScore: true,
              cleanStreakCount: true,
              recentHostTimeoutCount: true,
              overturnedHostedMarketsCount: true,
              publicHostingEligibility: true
            }
          }
        }
      },
      _count: {
        select: {
          comments: true
        }
      },
      // S55-T5: include hosting group for the "Hosted by [Group]" chip on market cards.
      group: {
        select: {
          id: true,
          name: true,
          slug: true,
        }
      }
    }
  });

  // Detect if there is another page by checking if we got limit+1 results.
  const hasMore = markets.length > limit;
  const pageMarkets = hasMore ? markets.slice(0, limit) : markets;

  const sortedMarkets =
    sort === "new"
      ? [...pageMarkets].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      : sort === "closing" || sort === "close_at"
        ? [...pageMarkets].sort((left, right) => left.closeAt.getTime() - right.closeAt.getTime())
        : sort === "featured"
          ? [...pageMarkets].sort((left, right) => {
              if (left.isFeatured !== right.isFeatured) {
                return Number(right.isFeatured) - Number(left.isFeatured);
              }

              return computeMarketRankScore(right) - computeMarketRankScore(left);
            })
          : sort === "volume"
            ? [...pageMarkets].sort((left, right) => (right.totalVolume ?? 0) - (left.totalVolume ?? 0))
            : rankMarkets(pageMarkets);

  const nextCursor = hasMore ? (sortedMarkets[sortedMarkets.length - 1]?.id ?? null) : null;

  // Populate iSaved for authenticated viewers — batch-fetch their saved market ids.
  let savedSet = new Set<string>();
  if (viewerId && sortedMarkets.length > 0) {
    const marketIds = sortedMarkets.map((m) => m.id);
    const saved = await prisma.savedMarket.findMany({
      where: { userId: viewerId, marketId: { in: marketIds } },
      select: { marketId: true },
    });
    savedSet = new Set(saved.map((s) => s.marketId));
  }

  return NextResponse.json({
    markets: sortedMarkets.map((market) => {
      const sanitized = sanitizeMarketSourceFields(market);
      return {
        ...sanitized,
        creator: sanitized.creator
          ? { ...sanitized.creator, username: getDisplayName(sanitized.creator) }
          : sanitized.creator,
        marketRankScore: computeMarketRankScore(sanitized),
        ...(viewerId ? { iSaved: savedSet.has(sanitized.id) } : {}),
      };
    }),
    nextCursor,
    hasMore,
  });
}

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account is not allowed to create markets." }, { status: 403 });
    }

    const rawBody = await request.json() as Record<string, unknown>;
    const payload = createMarketSchema.parse(rawBody);

    // S32-T3: Extract optional flagship event fields outside the core schema.
    // Both must be provided together; date must be in the future.
    let flagshipEventAt: Date | null = null;
    let flagshipEventType: string | null = null;

    if (rawBody.flagshipEventAt != null || rawBody.flagshipEventType != null) {
      if (actor.role !== "ADMIN") {
        return NextResponse.json(
          { error: "Flagship event polls can only be created by admins. Create a regular poll instead." },
          { status: 403 }
        );
      }

      const fatRaw = rawBody.flagshipEventAt;
      const fetRaw = rawBody.flagshipEventType;

      if (!fatRaw || !fetRaw || typeof fatRaw !== "string" || typeof fetRaw !== "string") {
        return NextResponse.json(
          { error: "flagshipEventAt and flagshipEventType must both be provided together." },
          { status: 400 }
        );
      }

      const parsed = new Date(fatRaw);
      if (isNaN(parsed.getTime()) || parsed <= new Date()) {
        return NextResponse.json(
          { error: "flagshipEventAt must be a valid future ISO date." },
          { status: 400 }
        );
      }

      flagshipEventAt = parsed;
      flagshipEventType = fetRaw.trim();
    }

    const market = await createPredictionMarket({
      actorId: actor.id,
      actorRole: actor.role,
      actorUsername: actor.username,
      actorReputationScore: actor.reputationScore,
      payload,
      flagshipEventAt,
      flagshipEventType,
    });

    // S59-T3: Fan-out push to group members when market is created inside a non-INVITE_ONLY group.
    // The INVITE_ONLY guard lives inside the helper — this call site only checks groupId is set.
    if (market.groupId) {
      void notifyGroupMembersOfNewMarket({
        groupId: market.groupId,
        marketId: market.id,
        marketTitle: market.title,
        creatorId: market.creatorId,
      }).catch((err: unknown) => console.error("[market-create] group push error:", err));
    }

    return NextResponse.json({ market: { id: market.id, status: market.status } }, { status: 201 });
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create market." }, { status: 400 });
  }
}
