import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { ingestStories } from "@/lib/news/ingestion";
import { prisma } from "@/lib/prisma";
import { getFeedStories } from "@/lib/stories/queries";
import { storyInputSchema, storyQuerySchema } from "@/lib/validations/story";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Optional auth — accepts NextAuth cookie or mobile Bearer JWT. userId is
  // only used downstream for personalisation; anonymous callers see the
  // public feed.
  const userId = await getUserIdFromRequest(request);
  const parsedQuery = storyQuerySchema.safeParse({
    view: searchParams.get("view") ?? "latest",
    category: searchParams.get("category") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    page: searchParams.get("page") ?? undefined
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid story query." }, { status: 400 });
  }

  const { view = "latest", category, limit, page } = parsedQuery.data;

  const stories = await getFeedStories({
    view,
    category:
      category && Object.values(MarketCategory).includes(category as MarketCategory) ? category : undefined,
    limit,
    page,
    userId: userId ?? undefined
  });

  return NextResponse.json({ stories });
}

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isSuspended: true },
    });
    if (!actor || actor.isSuspended || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = storyInputSchema.parse(await request.json());
    const [result] = await ingestStories([payload], userId);
    return NextResponse.json({ story: result }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to create story." }, { status: 400 });
  }
}
