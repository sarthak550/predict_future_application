import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  GroupModerationActionType,
  logModerationAction,
} from "@/lib/groups/group-moderation-audit";
import { GroupServiceError, leaveGroup } from "@/lib/groups/service";

/**
 * POST /api/groups/:id/leave
 *
 * Allows an authenticated ADMIN or MEMBER to voluntarily leave a group.
 * Banned users (tombstones) and OWNERs are rejected with typed error codes.
 *
 * S57: new self-service leave route. Hard-deletes the caller's GroupMembership row
 * (same mechanism as OWNER/ADMIN removes-member DELETE route from S54).
 *
 * Error codes:
 *   400 not_member                    — caller has no membership row
 *   403 banned                        — caller is tombstoned (bannedAt != null)
 *   404 group_not_found               — group absent or archived
 *   409 owner_must_transfer_or_archive — caller is the OWNER
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    await leaveGroup({ groupId: params.id, userId: callerId });

    // S59-T1: audit log — actor === target (self-action). Fire-and-forget.
    void logModerationAction({
      groupId: params.id,
      actorId: callerId,
      targetUserId: callerId,
      actionType: GroupModerationActionType.MEMBER_LEFT,
    }).catch(console.error);

    return NextResponse.json({ left: true }, { status: 200 });
  } catch (err) {
    if (err instanceof GroupServiceError) {
      switch (err.code) {
        case "group_not_found":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
        case "not_member":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
        case "banned":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
        case "owner_must_transfer_or_archive":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
      }
    }
    console.error("[POST /api/groups/leave] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
