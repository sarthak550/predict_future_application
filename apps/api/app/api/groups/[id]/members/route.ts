import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

/**
 * GET /api/groups/:id/members
 *
 * Returns paginated group members. Requires auth — the caller must be a member
 * of the group (or a platform admin). Ban tombstone rows are included so
 * admins can see and manage banned users.
 *
 * Query params:
 *   cursor?: string (opaque; last member id for keyset pagination)
 *   limit?: number (default 20)
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Verify caller has membership (any role, even banned tombstone viewer — must be non-banned member).
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId } },
    select: { role: true, bannedAt: true }
  });

  if (!callerMembership || callerMembership.bannedAt != null) {
    return NextResponse.json({ error: "Group access denied." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const cursorId = searchParams.get("cursor") ?? undefined;
  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(isNaN(limitParam) ? PAGE_SIZE : Math.max(1, limitParam), 50);

  const members = await prisma.groupMembership.findMany({
    where: {
      groupId: params.id,
      ...(cursorId ? { id: { gt: cursorId } } : {})
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      userId: true,
      role: true,
      joinedAt: true,
      bannedAt: true,
      banReason: true,
      user: {
        select: {
          id: true,
          username: true,
          avatarUrl: true
        }
      }
    }
  });

  const hasNext = members.length > limit;
  const page = hasNext ? members.slice(0, limit) : members;
  const nextCursor = hasNext ? page[page.length - 1].id : null;

  return NextResponse.json({
    members: page.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      bannedAt: m.bannedAt?.toISOString() ?? null,
      banReason: m.banReason ?? null,
      user: {
        id: m.user.id,
        username: m.user.username,
        avatarUrl: m.user.avatarUrl ?? null
      }
    })),
    nextCursor
  });
}
