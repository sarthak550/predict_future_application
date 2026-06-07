import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { notifyOwnersAndAdminsOfNewRequest } from "@/lib/groups/group-request-push";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/join-request
 *
 * Submits a join request for a REQUEST_TO_JOIN group.
 *
 * Validations (in order):
 *   1. Group must exist and not be archived.
 *   2. Group visibility must be REQUEST_TO_JOIN (returns 400 otherwise).
 *   3. Caller must not be banned (returns 409).
 *   4. Caller must not already be a member (returns 200 idempotent).
 *   5. No existing PENDING request (returns 200 idempotent — duplicate prevention).
 *   6. No existing APPROVED request — treat as already-member (returns 200).
 *
 * On success: creates GroupJoinRequest row + fires push to group owners/admins.
 * Returns 200 { requestId, status: "PENDING" }.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const caller = await prisma.user.findUnique({
    where: { id: callerId },
    select: { id: true, username: true, isSuspended: true }
  });

  if (!caller || caller.isSuspended) {
    return NextResponse.json({ error: "Account cannot submit join requests." }, { status: 403 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, visibility: true, isArchived: true }
  });

  if (!group || group.isArchived) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Visibility gate — only REQUEST_TO_JOIN groups accept join requests.
  if (group.visibility !== "REQUEST_TO_JOIN") {
    return NextResponse.json(
      {
        error: "This group does not require a request.",
        code: "wrong_visibility"
      },
      { status: 400 }
    );
  }

  // Check existing membership (ban tombstones included).
  const existingMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } }
  });

  if (existingMembership?.bannedAt != null) {
    return NextResponse.json(
      { error: "You have been removed from this group.", code: "banned" },
      { status: 409 }
    );
  }

  if (existingMembership) {
    return NextResponse.json({ alreadyMember: true }, { status: 200 });
  }

  // Check for an existing PENDING request — idempotent.
  const existingPending = await prisma.groupJoinRequest.findFirst({
    where: { groupId: params.id, userId: callerId, status: "PENDING" },
    select: { id: true }
  });

  if (existingPending) {
    return NextResponse.json(
      { requestId: existingPending.id, status: "PENDING" },
      { status: 200 }
    );
  }

  // Check for an existing APPROVED request — inconsistent state (no membership row), treat as idempotent.
  const existingApproved = await prisma.groupJoinRequest.findFirst({
    where: { groupId: params.id, userId: callerId, status: "APPROVED" },
    select: { id: true }
  });

  if (existingApproved) {
    return NextResponse.json({ alreadyMember: true }, { status: 200 });
  }

  // Create the join request.
  const joinRequest = await prisma.groupJoinRequest.create({
    data: {
      groupId: params.id,
      userId: callerId,
      status: "PENDING"
    },
    select: { id: true }
  });

  // Fire push to group owners + admins — fire-and-forget, must not block response.
  void notifyOwnersAndAdminsOfNewRequest({
    groupId: params.id,
    requestId: joinRequest.id,
    requesterUsername: caller.username
  }).catch((err: unknown) => {
    console.error("[join-request] push notify error:", err);
  });

  return NextResponse.json({ requestId: joinRequest.id, status: "PENDING" }, { status: 200 });
}
