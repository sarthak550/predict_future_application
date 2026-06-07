import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  GroupModerationActionType,
  logModerationAction,
} from "@/lib/groups/group-moderation-audit";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/groups/:id/members/:userId
 *
 * Removes a member from a group. The caller must be OWNER or ADMIN.
 * The group OWNER cannot be removed.
 *
 * Returns 204 on success.
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Verify the caller has OWNER or ADMIN role in this group.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true }
  });

  if (
    !callerMembership ||
    (callerMembership.role !== "OWNER" && callerMembership.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "You must be an owner or admin to remove members." },
      { status: 403 }
    );
  }

  // Prevent removing the group owner.
  if (params.userId === group.ownerId) {
    return NextResponse.json(
      { error: "Cannot remove the group owner." },
      { status: 400 }
    );
  }

  // Verify the target membership exists.
  const targetMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: params.userId } }
  });

  if (!targetMembership) {
    return NextResponse.json({ error: "Member not found in this group." }, { status: 404 });
  }

  await prisma.groupMembership.delete({
    where: { groupId_userId: { groupId: params.id, userId: params.userId } }
  });

  // S59-T1: audit log — fire-and-forget.
  void logModerationAction({
    groupId: params.id,
    actorId: callerId,
    targetUserId: params.userId,
    actionType: GroupModerationActionType.MEMBER_REMOVED,
  }).catch(console.error);

  return new NextResponse(null, { status: 204 });
}
