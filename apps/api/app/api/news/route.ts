import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  InvalidCursorError,
  getPublishedNewsPage,
  getPersonalizedNewsPage,
} from "@/lib/news/queries";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Returns the raw param value if it matches one of `allowed`. If the param is
 * absent (null/empty) returns `undefined`. If present but not in `allowed`,
 * throws — caller catches and maps to 400. Strict validation surfaces client
 * bugs (e.g. enum drift between mobile + server) instead of silently dropping
 * the filter and serving wrong data.
 */
function parseEnumParam<T extends string>(
  name: string,
  raw: string | null,
  allowed: readonly T[]
): T | undefined {
  if (raw === null || raw === "") return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new BadRequestError(
      `Invalid ${name}: "${raw}". Allowed values: ${allowed.join(", ")}`
    );
  }
  return raw as T;
}

/**
 * Strict boolean param: only "true" or "false" accepted. Absent → undefined.
 * Anything else throws so a typo (e.g. "1") doesn't silently degrade behavior.
 */
function parseBoolParam(name: string, raw: string | null): boolean | undefined {
  if (raw === null || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new BadRequestError(`Invalid ${name}: "${raw}". Expected "true" or "false".`);
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

const ALL_DIRECTIONS = ["BULLISH", "BEARISH", "NEUTRAL"] as const;
const ALL_SOURCE_TYPES = ["ANALYST", "PUBLICATION"] as const;
const ALL_CATEGORIES = Object.values(MarketCategory) as readonly MarketCategory[];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = (await getUserIdFromRequest(request)) ?? undefined;
  const rawLimit = Number(searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(30, Math.floor(rawLimit))) : 10;
  const cursor = searchParams.get("cursor");

  try {
    const category = parseEnumParam("category", searchParams.get("category"), ALL_CATEGORIES);
    const excludeCategory = parseEnumParam(
      "excludeCategory",
      searchParams.get("excludeCategory"),
      ALL_CATEGORIES
    );

    const requireExpertOpinions = parseBoolParam(
      "requireExpertOpinions",
      searchParams.get("requireExpertOpinions")
    ) ?? false;
    const personalized = parseBoolParam("personalized", searchParams.get("personalized")) ?? false;

    const expertOpinionClusterId = searchParams.get("expertOpinionClusterId") || undefined;
    const expertOpinionDirection = parseEnumParam(
      "expertOpinionDirection",
      searchParams.get("expertOpinionDirection"),
      ALL_DIRECTIONS
    );
    const expertOpinionVerified = parseBoolParam(
      "expertOpinionVerified",
      searchParams.get("expertOpinionVerified")
    );
    const expertOpinionResolved = parseBoolParam(
      "expertOpinionResolved",
      searchParams.get("expertOpinionResolved")
    );
    const expertOpinionInstrument = searchParams.get("expertOpinionInstrument") || undefined;
    const expertOpinionAnalyst = searchParams.get("expertOpinionAnalyst") || undefined;
    const expertOpinionSourceType = parseEnumParam(
      "expertOpinionSourceType",
      searchParams.get("expertOpinionSourceType"),
      ALL_SOURCE_TYPES
    );

    const opinionFilters = {
      expertOpinionClusterId,
      expertOpinionDirection,
      expertOpinionVerified: expertOpinionVerified === true ? true : undefined,
      expertOpinionResolved: expertOpinionResolved === true ? true : undefined,
      expertOpinionInstrument,
      expertOpinionAnalyst,
      expertOpinionSourceType,
    };

    // Personalized mode: boost stories linked to markets where followed analysts
    // have placed positions in the last 14 days.
    let page;
    if (personalized && userId) {
      page = await getPersonalizedNewsPage({
        limit,
        category,
        excludeCategory,
        cursor,
        userId,
        requireExpertOpinions,
        ...opinionFilters,
      });
    } else {
      page = await getPublishedNewsPage({
        limit,
        category,
        excludeCategory,
        cursor,
        userId,
        requireExpertOpinions,
        ...opinionFilters,
      });
    }

    // Batch-fetch user votes for all markets in this page
    const marketIds = page.items
      .map((item) => item.market?.id)
      .filter((id): id is string => Boolean(id));

    const userVotes =
      userId && marketIds.length > 0
        ? await prisma.vote.findMany({
            where: { userId, marketId: { in: marketIds } },
            select: { marketId: true, side: true, numericValue: true },
          })
        : [];

    const votesByMarket = new Map(
      userVotes.map((v) => [v.marketId, { side: v.side, numericValue: v.numericValue }])
    );

    return NextResponse.json({
      items: page.items.map((item) => ({
        ...item,
        poll: item.market
          ? {
              id: item.market.id,
              title: item.market.title,
              status: item.market.status,
              marketType: item.market.marketType,
              yesCount: item.market.yesCount,
              noCount: item.market.noCount,
              totalVotes: item.market.totalVotes,
              averageNumericValue: item.market.averageNumericValue,
              closeAt: item.market.closeAt?.toISOString() ?? null,
              unit: item.market.unit,
              minValue: item.market.minValue,
              maxValue: item.market.maxValue,
              userVote: votesByMarket.get(item.market.id) ?? null,
            }
          : null,
        expertOpinions: item.expertOpinions.length > 0 ? item.expertOpinions : undefined,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    });
  } catch (err) {
    if (err instanceof BadRequestError || err instanceof InvalidCursorError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
