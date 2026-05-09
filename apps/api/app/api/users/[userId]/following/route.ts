import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

const PAGE_SIZE = 20;

/**
 * GET /api/users/[userId]/following
 *
 * Returns the paginated list of users that [userId] follows. Auth: optional.
 *
 * Query params:
 *   cursor  — opaque cursor (Follow.id) for pagination
 *
 * Response: { items: ApiFollowerEntry[], nextCursor: string | null }
 */
export async function GET(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const { userId } = params;
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;

  // Verify target user exists.
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const follows = await prisma.follow.findMany({
    where: { followerId: userId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      followee: {
        select: {
          id: true,
          username: true,
          displayMode: true,
          avatarUrl: true,
          accuracyScore: true,
        },
      },
    },
  });

  const hasMore = follows.length > PAGE_SIZE;
  const page = hasMore ? follows.slice(0, PAGE_SIZE) : follows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const items = page.map((f) => ({
    userId: f.followee.id,
    username: getDisplayName(f.followee),
    avatarUrl: f.followee.avatarUrl,
    accuracyScore: f.followee.accuracyScore,
  }));

  return NextResponse.json({ items, nextCursor });
}
