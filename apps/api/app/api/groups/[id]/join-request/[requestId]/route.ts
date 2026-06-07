import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/groups/:id/join-request/:requestId
 *
 * Cancels a PENDING join request. The caller must be the original requester
 * OR an OWNER/ADMIN of the target group (cancelling on the user's behalf).
 *
 * Returns 204 on success (hard delete — request was PENDING, not yet decided).
 * Returns 409 if the request has already been decided (APPROVED or REJECTED).
 * Returns 403 if the caller is neither the requester nor an OWNER/ADMIN.
 * Returns 404 if the request does not exist.
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; requestId: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const joinRequest = await prisma.groupJoinRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, groupId: true, userId: true, status: true }
  });

  if (!joinRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  // Verify group matches the URL parameter.
  if (joinRequest.groupId !== params.id) {
    return NextResponse.json({ error: "Request does not belong to this group." }, { status: 400 });
  }

  // Caller must be the requester OR an OWNER/ADMIN of the group.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true },
  });
  const isRequester = joinRequest.userId === callerId;
  const isOwnerOrAdmin =
    callerMembership?.role === "OWNER" || callerMembership?.role === "ADMIN";
  if (!isRequester && !isOwnerOrAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // Cannot cancel a request that has already been decided.
  if (joinRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: "Request already decided.", code: "already_decided" },
      { status: 409 }
    );
  }

  await prisma.groupJoinRequest.delete({
    where: { id: params.requestId }
  });

  return new NextResponse(null, { status: 204 });
}
