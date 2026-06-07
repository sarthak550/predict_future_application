import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import {
  GroupModerationActionType,
  logModerationAction,
} from "@/lib/groups/group-moderation-audit";
import { GroupServiceError, transferOwnership } from "@/lib/groups/service";

const transferOwnershipSchema = z.object({
  newOwnerId: z.string().cuid({ message: "newOwnerId must be a valid CUID." })
});

/**
 * POST /api/groups/:id/transfer-ownership
 *
 * Atomically transfers group ownership from the calling OWNER to another member.
 * Uses prisma.$transaction to ensure both role updates plus Group.ownerId are
 * applied atomically — either all succeed or none do, preserving the sole-OWNER
 * invariant that all moderation routes depend on.
 *
 * Decision: outgoing owner is demoted to ADMIN, not MEMBER, so they retain the
 * ability to manage members and markets during any follow-up cleanup work.
 *
 * S57: new route. No notification in this sprint; S58 adds per-group preferences.
 *
 * Error codes:
 *   400 self_transfer     — newOwnerId === callerId
 *   400 ineligible_target — target not an active non-banned member
 *   403 forbidden         — caller is not the OWNER
 *   404 group_not_found   — group absent or archived
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = transferOwnershipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const { newOwnerId } = parsed.data;

  try {
    await transferOwnership({ groupId: params.id, callerId, newOwnerId });

    // S59-T1: audit log — fire-and-forget outside the transaction.
    // transferOwnership is already atomic; the audit row is advisory.
    void logModerationAction({
      groupId: params.id,
      actorId: callerId,
      targetUserId: newOwnerId,
      actionType: GroupModerationActionType.OWNERSHIP_TRANSFERRED,
      metadata: { previousOwnerId: callerId },
    }).catch(console.error);

    return NextResponse.json({ transferred: true, newOwnerId }, { status: 200 });
  } catch (err) {
    if (err instanceof GroupServiceError) {
      switch (err.code) {
        case "group_not_found":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
        case "forbidden":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
        case "self_transfer":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
        case "ineligible_target":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
      }
    }
    console.error("[POST /api/groups/transfer-ownership] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
