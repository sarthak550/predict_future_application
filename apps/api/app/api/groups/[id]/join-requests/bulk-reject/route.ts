/**
 * S59-T4: POST /api/groups/:id/join-requests/bulk-reject
 *
 * Batch-reject up to 50 pending join requests in a single call.
 *
 * Design decisions:
 *   - Per-row try/catch: a single bad requestId does not abort the rest.
 *   - Optional rejection note is applied uniformly to all rows in the batch.
 *   - Already-rejected rows are treated as idempotent success.
 *   - Audit log (S59-T1) is written per successful row — fire-and-forget.
 *   - Push notification is fired per successful row — fire-and-forget.
 *
 * Body: { requestIds: string[], note?: string }  — max 50
 * Response: { results: Array<{ requestId, success, error? }> }
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  GroupModerationActionType,
  logModerationAction,
} from "@/lib/groups/group-moderation-audit";
import { notifyRequesterOfDecision } from "@/lib/groups/group-request-push";
import { prisma } from "@/lib/prisma";

const MAX_BATCH = 50;

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Role check — caller must be OWNER or ADMIN.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true },
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawIds = (body as Record<string, unknown>)?.requestIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json(
      { error: "requestIds must be a non-empty array." },
      { status: 400 }
    );
  }

  if (rawIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Cannot process more than ${MAX_BATCH} requests at once.` },
      { status: 400 }
    );
  }

  const requestIds: string[] = rawIds.filter((id): id is string => typeof id === "string");

  // Optional batch-wide rejection note (max 280 chars).
  const rawNote = (body as Record<string, unknown>)?.note;
  const note: string | undefined =
    typeof rawNote === "string" && rawNote.trim().length > 0
      ? rawNote.trim().slice(0, 280)
      : undefined;

  const results: Array<{ requestId: string; success: boolean; error?: string }> = [];

  for (const requestId of requestIds) {
    try {
      const joinRequest = await prisma.groupJoinRequest.findUnique({
        where: { id: requestId },
        select: { id: true, groupId: true, userId: true, status: true },
      });

      if (!joinRequest) {
        results.push({ requestId, success: false, error: "not_found" });
        continue;
      }

      if (joinRequest.groupId !== params.id) {
        results.push({ requestId, success: false, error: "wrong_group" });
        continue;
      }

      // Idempotent: already rejected.
      if (joinRequest.status === "REJECTED") {
        results.push({ requestId, success: true });
        continue;
      }

      if (joinRequest.status === "APPROVED") {
        results.push({ requestId, success: false, error: "already_approved" });
        continue;
      }

      const group = await prisma.group.findUnique({
        where: { id: params.id },
        select: { name: true },
      });

      if (!group) {
        results.push({ requestId, success: false, error: "group_not_found" });
        continue;
      }

      await prisma.groupJoinRequest.update({
        where: { id: requestId },
        data: {
          status: "REJECTED",
          decidedAt: new Date(),
          decidedById: callerId,
          decisionNote: note ?? null,
        },
      });

      // Audit + push — fire-and-forget.
      void logModerationAction({
        groupId: params.id,
        actorId: callerId,
        targetUserId: joinRequest.userId,
        actionType: GroupModerationActionType.JOIN_REQUEST_REJECTED,
        metadata: note ? { note } : undefined,
      }).catch(console.error);

      void notifyRequesterOfDecision({
        userId: joinRequest.userId,
        approved: false,
        groupName: group.name,
        groupId: params.id,
        note,
      }).catch((err: unknown) => console.error("[bulk-reject] push error:", err));

      results.push({ requestId, success: true });
    } catch (err) {
      console.error(`[bulk-reject] unexpected error for requestId ${requestId}:`, err);
      results.push({ requestId, success: false, error: "internal_error" });
    }
  }

  return NextResponse.json({ results }, { status: 200 });
}
