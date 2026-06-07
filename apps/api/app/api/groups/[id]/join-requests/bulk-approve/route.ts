/**
 * S59-T4: POST /api/groups/:id/join-requests/bulk-approve
 *
 * Batch-approve up to 50 pending join requests in a single call.
 *
 * Design decisions:
 *   - Per-row try/catch: a single bad requestId (not found, wrong group, already
 *     rejected, member cap hit) does not abort the rest of the batch.
 *   - Member cap is re-checked per row. If the cap is hit mid-batch, subsequent
 *     rows return { success: false, error: "member_cap_reached" }. The requests
 *     stay PENDING so the moderator can bump the cap and retry.
 *   - Race condition (two concurrent bulk-approves): P2002 on GroupMembership
 *     unique constraint is treated as idempotent success (same as single approve).
 *   - Audit log (S59-T1) is written per successful row — fire-and-forget.
 *   - Push notification is fired per successful row — fire-and-forget.
 *
 * Body: { requestIds: string[] }  — max 50
 * Response: { results: Array<{ requestId, success, error? }> }
 */

import { Prisma } from "@prisma/client";
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
      { error: "You must be an owner or admin to approve requests." },
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

  // Process each row independently — per-row error isolation.
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

      // Idempotent: already approved.
      if (joinRequest.status === "APPROVED") {
        results.push({ requestId, success: true });
        continue;
      }

      if (joinRequest.status === "REJECTED") {
        results.push({ requestId, success: false, error: "already_rejected" });
        continue;
      }

      // Re-check member cap on each row — cap can be reached mid-batch.
      const group = await prisma.group.findUnique({
        where: { id: params.id },
        select: {
          name: true,
          memberCap: true,
          _count: { select: { memberships: { where: { bannedAt: null } } } },
        },
      });

      if (!group) {
        results.push({ requestId, success: false, error: "group_not_found" });
        continue;
      }

      if (group._count.memberships >= group.memberCap) {
        results.push({ requestId, success: false, error: "member_cap_reached" });
        continue;
      }

      const now = new Date();

      try {
        await prisma.$transaction([
          prisma.groupJoinRequest.update({
            where: { id: requestId },
            data: { status: "APPROVED", decidedAt: now, decidedById: callerId },
          }),
          prisma.groupMembership.create({
            data: { groupId: params.id, userId: joinRequest.userId, role: "MEMBER" },
          }),
        ]);
      } catch (txErr) {
        if (
          txErr instanceof Prisma.PrismaClientKnownRequestError &&
          txErr.code === "P2002"
        ) {
          // Race: membership already created by concurrent request — treat as success.
          results.push({ requestId, success: true });
          continue;
        }
        throw txErr;
      }

      // Audit + push — fire-and-forget.
      void logModerationAction({
        groupId: params.id,
        actorId: callerId,
        targetUserId: joinRequest.userId,
        actionType: GroupModerationActionType.JOIN_REQUEST_APPROVED,
      }).catch(console.error);

      void notifyRequesterOfDecision({
        userId: joinRequest.userId,
        approved: true,
        groupName: group.name,
        groupId: params.id,
      }).catch((err: unknown) => console.error("[bulk-approve] push error:", err));

      results.push({ requestId, success: true });
    } catch (err) {
      console.error(`[bulk-approve] unexpected error for requestId ${requestId}:`, err);
      results.push({ requestId, success: false, error: "internal_error" });
    }
  }

  return NextResponse.json({ results }, { status: 200 });
}
