import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/users/[userId]/follow
 *
 * Follow the given user. Auth required. Idempotent — safe to call if already
 * following (upsert semantics). Returns 400 on self-follow, 404 if target not found.
 *
 * Response: { following: true }
 */
export async function POST(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const requestingUserId = await getUserIdFromRequest(request);
  if (!requestingUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { userId: followeeId } = params;

  if (requestingUserId === followeeId) {
    return NextResponse.json({ error: "Cannot follow yourself." }, { status: 400 });
  }

  // Verify target user exists.
  const target = await prisma.user.findUnique({
    where: { id: followeeId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Upsert — idempotent. If already following, this is a no-op.
  await prisma.follow.upsert({
    where: {
      followerId_followeeId: {
        followerId: requestingUserId,
        followeeId,
      },
    },
    create: {
      followerId: requestingUserId,
      followeeId,
    },
    update: {}, // no-op if already exists
  });

  return NextResponse.json({ following: true });
}

/**
 * DELETE /api/users/[userId]/follow
 *
 * Unfollow the given user. Auth required. Idempotent — safe to call even if
 * not currently following.
 *
 * Response: { following: false }
 */
export async function DELETE(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const requestingUserId = await getUserIdFromRequest(request);
  if (!requestingUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { userId: followeeId } = params;

  // Delete if exists — ignore if it doesn't (idempotent).
  await prisma.follow.deleteMany({
    where: {
      followerId: requestingUserId,
      followeeId,
    },
  });

  return NextResponse.json({ following: false });
}
