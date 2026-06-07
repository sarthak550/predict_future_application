import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/join
 *
 * Joins an OPEN group directly (no invite code required).
 * Returns 403 with "invite_only" if the group requires an invite code.
 * Returns 409 if the user is banned from this group.
 * Returns 409 if the group is at or over its member cap.
 * Returns 200 (idempotent) if the user is already a member.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isSuspended: true }
  });

  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot join groups." }, { status: 403 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    include: {
      owner: { select: { username: true } },
      _count: {
        select: {
          memberships: { where: { bannedAt: null } }
        }
      }
    }
  });

  if (!group || group.isArchived) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Enforce visibility — invite-code path handles INVITE_ONLY, join-request handles REQUEST_TO_JOIN.
  if (group.visibility === "INVITE_ONLY") {
    return NextResponse.json(
      { error: "This group requires an invite code.", code: "invite_only" },
      { status: 403 }
    );
  }

  if (group.visibility === "REQUEST_TO_JOIN") {
    return NextResponse.json(
      {
        error: "This group requires a request to join.",
        code: "request_to_join",
        hint: "POST /api/groups/:id/join-request to submit a request."
      },
      { status: 400 }
    );
  }

  // Check for existing membership (includes ban tombstones).
  const existingMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: actor.id } }
  });

  if (existingMembership?.bannedAt != null) {
    return NextResponse.json(
      { error: "You have been removed from this group.", code: "banned" },
      { status: 409 }
    );
  }

  // Idempotent: user already a member.
  if (existingMembership) {
    return NextResponse.json(
      { group: { id: group.id, name: group.name, slug: group.slug } },
      { status: 200 }
    );
  }

  // Enforce member cap.
  if (group._count.memberships >= group.memberCap) {
    return NextResponse.json(
      { error: "This group is full.", code: "member_cap_reached" },
      { status: 409 }
    );
  }

  await prisma.groupMembership.create({
    data: {
      groupId: params.id,
      userId: actor.id,
      role: "MEMBER"
    }
  });

  return NextResponse.json(
    { group: { id: group.id, name: group.name, slug: group.slug } },
    { status: 200 }
  );
}
