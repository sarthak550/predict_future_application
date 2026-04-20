import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getPublishedNewsPage } from "@/lib/news/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = await getSession();
  const rawLimit = Number(searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(20, Math.floor(rawLimit))) : 10;
  const rawCategory = searchParams.get("category");
  const cursor = searchParams.get("cursor");
  const category =
    rawCategory && Object.values(MarketCategory).includes(rawCategory as MarketCategory)
      ? (rawCategory as MarketCategory)
      : undefined;

  const page = await getPublishedNewsPage({
    limit,
    category,
    cursor,
    userId: session?.user?.id
  });

  return NextResponse.json({
    items: page.items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore
  });
}
