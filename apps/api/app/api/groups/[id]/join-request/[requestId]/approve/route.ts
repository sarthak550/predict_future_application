import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { notifyRequesterOfDecision } from "@/lib/groups/group-request-push";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/join-request/:requestId/approve
 *
 * Approves a pending join request. Caller must be OWNER or ADMIN of the group.
 *
 * Behaviour:
 *   - Idempotent: if already APPROVED, returns 200 { approved: true }.
 *   - If REJECTED: returns 409 already_rejected — admin must not be able to flip a rejection.
 *   - Member cap check before creating membership. Returns 409 member_cap_reached if full;
 *     request stays PENDING so the admin can bump the cap and retry.
 *   - Atomic $transaction: updates request status + creates GroupMembership row together.
 *   - Race-condition safe: if two admins approve simultaneously, the unique constraint
 *     on GroupMembership(groupId, userId) causes one to throw P2002 — caught and returned
 *     as 200 (idempotent success — membership was created by the other request).
 *   - Fires push notification to requester (fire-and-forget).
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; requestId: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Role check — caller must be OWNER or ADMIN of this group.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true }
  });

  if (
    !callerMembership ||
    (callerMembership.role !== "OWNER" && callerMembership.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "You must be an owner or admin to approve requests." },
      { status: 403 }
    );
  }

  // Fetch the join request.
  const joinRequest = await prisma.groupJoinRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, groupId: true, userId: true, status: true }
  });

  if (!joinRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  // Verify request belongs to this group.
  if (joinRequest.groupId !== params.id) {
    return NextResponse.json({ error: "Request does not belong to this group." }, { status: 400 });
  }

  // Idempotent: already approved — no-op.
  if (joinRequest.status === "APPROVED") {
    return NextResponse.json({ approved: true }, { status: 200 });
  }

  // Cannot approve a rejected request.
  if (joinRequest.status === "REJECTED") {
    return NextResponse.json(
      { error: "Request was already rejected.", code: "already_rejected" },
      { status: 409 }
    );
  }

  // Member cap check: count active (non-banned) memberships.
  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: {
      name: true,
      memberCap: true,
      _count: {
        select: { memberships: { where: { bannedAt: null } } }
      }
    }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  if (group._count.memberships >= group.memberCap) {
    return NextResponse.json(
      { error: "This group is full.", code: "member_cap_reached" },
      { status: 409 }
    );
  }

  const now = new Date();

  try {
    // Atomic transaction: update request status + create membership.
    await prisma.$transaction([
      prisma.groupJoinRequest.update({
        where: { id: params.requestId },
        data: {
          status: "APPROVED",
          decidedAt: now,
          decidedById: callerId
        }
      }),
      prisma.groupMembership.create({
        data: {
          groupId: params.id,
          userId: joinRequest.userId,
          role: "MEMBER"
        }
      })
    ]);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Race condition: two admins approved simultaneously.
      // The unique constraint on GroupMembership(groupId, userId) was violated —
      // membership was already created by the concurrent request.
      // Return 200 idempotent; no duplicate row was created.
      return NextResponse.json({ approved: true }, { status: 200 });
    }
    throw err;
  }

  // Fire push notification to the requester — fire-and-forget.
  void notifyRequesterOfDecision({
    userId: joinRequest.userId,
    approved: true,
    groupName: group.name,
    groupId: params.id
  }).catch((err: unknown) => {
    console.error("[approve] push notify error:", err);
  });

  return NextResponse.json({ approved: true }, { status: 200 });
}
