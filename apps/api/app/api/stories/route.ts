import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { ingestStories } from "@/lib/news/ingestion";
import { getFeedStories } from "@/lib/stories/queries";
import { storyInputSchema, storyQuerySchema } from "@/lib/validations/story";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = await getSession();
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
    userId: session?.user?.id
  });

  return NextResponse.json({ stories });
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = storyInputSchema.parse(await request.json());
    const [result] = await ingestStories([payload], session.user.id);
    return NextResponse.json({ story: result }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to create story." }, { status: 400 });
  }
}
