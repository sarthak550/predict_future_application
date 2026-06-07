import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/groups/join-requests/mine
 *
 * Returns the calling user's own join requests across all groups.
 * Includes PENDING requests and requests decided within the last 30 days.
 *
 * Response:
 *   {
 *     requests: [{
 *       id, groupId, groupName, groupSlug, status,
 *       requestedAt, decidedAt, decisionNote
 *     }]
 *   }
 *
 * No pagination — a user realistically has < 50 active requests at any time.
 */
export async function GET(request: Request) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const rows = await prisma.groupJoinRequest.findMany({
    where: {
      userId: callerId,
      OR: [
        { status: "PENDING" },
        // Decided within the last 30 days.
        {
          status: { in: ["APPROVED", "REJECTED"] },
          decidedAt: { gte: thirtyDaysAgo }
        }
      ]
    },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      decidedAt: true,
      decisionNote: true,
      group: {
        select: { id: true, name: true, slug: true }
      }
    }
  });

  const requests = rows.map((r) => ({
    id: r.id,
    groupId: r.group.id,
    groupName: r.group.name,
    groupSlug: r.group.slug,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote ?? null
  }));

  return NextResponse.json({ requests });
}
