import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  GroupModerationActionType,
  logModerationAction,
} from "@/lib/groups/group-moderation-audit";
import { notifyRequesterOfDecision } from "@/lib/groups/group-request-push";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/join-request/:requestId/reject
 *
 * Rejects a pending join request. Caller must be OWNER or ADMIN of the group.
 *
 * Body: { note?: string }  — optional rejection reason (max 280 chars).
 *
 * Behaviour:
 *   - Idempotent: if already REJECTED, returns 200 { rejected: true }.
 *   - If APPROVED: returns 409 already_approved.
 *   - Updates request status to REJECTED with decidedAt, decidedById, and optional decisionNote.
 *   - Fires push notification to requester with optional note appended to the body.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; requestId: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Role check — caller must be OWNER or ADMIN.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true }
  });

  if (
    !callerMembership ||
    (callerMembership.role !== "OWNER" && callerMembership.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "You must be an owner or admin to reject requests." },
      { status: 403 }
    );
  }

  // Parse optional rejection note from body.
  let note: string | undefined;
  try {
    const body = await request.json() as { note?: unknown };
    if (typeof body.note === "string") {
      note = body.note.trim().slice(0, 280) || undefined;
    }
  } catch {
    // Empty or non-JSON body is allowed — note is optional.
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

  // Idempotent: already rejected.
  if (joinRequest.status === "REJECTED") {
    return NextResponse.json({ rejected: true }, { status: 200 });
  }

  // Cannot reject an already-approved request.
  if (joinRequest.status === "APPROVED") {
    return NextResponse.json(
      { error: "Request was already approved.", code: "already_approved" },
      { status: 409 }
    );
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { name: true }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  await prisma.groupJoinRequest.update({
    where: { id: params.requestId },
    data: {
      status: "REJECTED",
      decidedAt: new Date(),
      decidedById: callerId,
      decisionNote: note ?? null
    }
  });

  // S59-T1: audit log — fire-and-forget.
  void logModerationAction({
    groupId: params.id,
    actorId: callerId,
    targetUserId: joinRequest.userId,
    actionType: GroupModerationActionType.JOIN_REQUEST_REJECTED,
    metadata: note ? { note } : undefined,
  }).catch(console.error);

  // Fire push to requester — fire-and-forget.
  void notifyRequesterOfDecision({
    userId: joinRequest.userId,
    approved: false,
    groupName: group.name,
    groupId: params.id,
    note
  }).catch((err: unknown) => {
    console.error("[reject] push notify error:", err);
  });

  return NextResponse.json({ rejected: true }, { status: 200 });
}
