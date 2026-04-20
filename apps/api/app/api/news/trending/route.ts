import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getFeedStories } from "@/lib/stories/queries";
import { newsFeedQuerySchema } from "@/lib/validations/news";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = await getSession();
  const parsed = newsFeedQuerySchema.safeParse({
    category: searchParams.get("category") ?? undefined,
    page: searchParams.get("page") ?? 1,
    pageSize: searchParams.get("pageSize") ?? 12
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trending query." }, { status: 400 });
  }

  const { category, page = 1, pageSize = 12 } = parsed.data;
  const stories = await getFeedStories({
    view: "trending",
    category:
      category && Object.values(MarketCategory).includes(category as MarketCategory)
        ? (category as MarketCategory)
        : undefined,
    userId: session?.user?.id,
    page,
    limit: pageSize + 1
  });

  return NextResponse.json({
    stories: stories.slice(0, pageSize),
    pagination: {
      page,
      pageSize,
      hasMore: stories.length > pageSize
    }
  });
}
