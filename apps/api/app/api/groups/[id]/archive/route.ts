import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { GroupServiceError, archiveGroup } from "@/lib/groups/service";

/**
 * POST /api/groups/:id/archive
 *
 * Sets Group.isArchived = true. Preserves all GroupMembership rows; hard-deleting
 * memberships would break foreign key relations from markets to group members.
 * Frontend filters via isArchived — membership rows are inert after archive.
 *
 * Archive is NOT reversible in v1.
 * // S58: add unarchive route if needed. isArchived is a simple boolean flip.
 *
 * Idempotent: calling archive on an already-archived group returns 200 immediately.
 *
 * Error codes:
 *   403 forbidden       — caller is not the OWNER
 *   404 group_not_found — group does not exist (archived groups return 200 idempotent,
 *                         so only truly absent groups return 404)
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
    await archiveGroup({ groupId: params.id, callerId });
    return NextResponse.json({ archived: true }, { status: 200 });
  } catch (err) {
    if (err instanceof GroupServiceError) {
      switch (err.code) {
        case "group_not_found":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
        case "forbidden":
          return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
      }
    }
    console.error("[POST /api/groups/archive] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
