import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  GroupModerationActionType,
  logModerationAction,
} from "@/lib/groups/group-moderation-audit";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/ban
 *
 * Bans a user from a group by setting bannedAt + banReason on their
 * GroupMembership tombstone row. If the user has no existing membership
 * (was never a member), a tombstone row is created so they cannot join later.
 *
 * NOTE: Using a tombstone on GroupMembership rather than a separate table is
 * intentional for S54 (lightweight, avoids a new join). A full
 * GroupModerationAction audit table is planned for S56.
 *
 * Body: { userId: string, reason?: string }
 * Returns 200 + { banned: true } on success.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: { userId?: string; reason?: string };
  try {
    body = await request.json() as { userId?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { userId, reason } = body;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Verify the caller has OWNER or ADMIN role.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true }
  });

  if (
    !callerMembership ||
    (callerMembership.role !== "OWNER" && callerMembership.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "You must be an owner or admin to ban members." },
      { status: 403 }
    );
  }

  // Cannot ban the group owner.
  if (userId === group.ownerId) {
    return NextResponse.json(
      { error: "Cannot ban the group owner." },
      { status: 400 }
    );
  }

  // Upsert the ban tombstone: update if exists, create if not.
  // A tombstone with no prior membership is valid — preemptive bans are allowed.
  // TODO S56: migrate to GroupBan table when activity feeds / audit log land.
  await prisma.groupMembership.upsert({
    where: { groupId_userId: { groupId: params.id, userId } },
    update: {
      bannedAt: new Date(),
      banReason: reason ?? null
    },
    create: {
      groupId: params.id,
      userId,
      role: "MEMBER",
      bannedAt: new Date(),
      banReason: reason ?? null
    }
  });

  // S59-T1: audit log — fire-and-forget.
  void logModerationAction({
    groupId: params.id,
    actorId: callerId,
    targetUserId: userId,
    actionType: GroupModerationActionType.MEMBER_BANNED,
    metadata: reason ? { banReason: reason } : undefined,
  }).catch(console.error);

  return NextResponse.json({ banned: true }, { status: 200 });
}
