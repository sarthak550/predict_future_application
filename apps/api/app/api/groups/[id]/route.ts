import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/groups/:id
 *
 * Returns full group detail for authenticated users who are members
 * (or platform admins/moderators).
 *
 * S56 additions:
 *   - callerJoinRequest: the calling user's most recent PENDING or recently-decided
 *     (last 7 days) join request — used by the mobile CTA state machine.
 *   - pendingRequestCount: count of PENDING requests visible to OWNER/ADMIN only.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  void searchParams; // may be used for future query params
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true
    }
  });

  if (!viewer) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    include: {
      owner: {
        select: {
          username: true
        }
      },
      memberships: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              reputationScore: true
            }
          }
        },
        orderBy: {
          joinedAt: "asc"
        }
      },
      markets: {
        where: {
          visibility: "PRIVATE"
        },
        include: {
          creator: {
            select: {
              username: true,
              reputationScore: true
            }
          }
        },
        orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }]
      }
    }
  });

  if (!group || group.isArchived) {
    // S57: archived groups return 404 to prevent deep-link access to closed groups.
    // This is consistent with discover + getUserGroups which already filter isArchived: false.
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const isPlatformAdmin =
    viewer.role === "ADMIN" || viewer.role === "MODERATOR";
  const isMember =
    isPlatformAdmin ||
    group.ownerId === viewer.id ||
    group.memberships.some(
      (membership) => membership.userId === viewer.id && membership.bannedAt == null
    );

  // For REQUEST_TO_JOIN groups, non-members may view the group detail
  // (so they can see the CTA). For other visibility types, block non-members.
  if (!isMember && group.visibility !== "REQUEST_TO_JOIN" && group.visibility !== "OPEN") {
    return NextResponse.json({ error: "Group access denied." }, { status: 403 });
  }

  // Determine the caller's role in this group.
  const callerMembership = group.memberships.find((m) => m.userId === viewer.id);
  const isAdminOrOwner =
    isPlatformAdmin ||
    callerMembership?.role === "OWNER" ||
    callerMembership?.role === "ADMIN";

  // S56: Fetch the caller's most recent join request (PENDING or decided within 7 days).
  // Used by the mobile CTA state machine to show "Request pending" / "Request declined" states.
  let callerJoinRequest: {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    decisionNote: string | null;
  } | null = null;

  if (!isMember && !isPlatformAdmin) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const joinReq = await prisma.groupJoinRequest.findFirst({
      where: {
        groupId: params.id,
        userId: viewer.id,
        OR: [
          { status: "PENDING" },
          {
            status: { in: ["APPROVED", "REJECTED"] },
            decidedAt: { gte: sevenDaysAgo }
          }
        ]
      },
      orderBy: { requestedAt: "desc" },
      select: { id: true, status: true, decisionNote: true }
    });

    if (joinReq) {
      callerJoinRequest = {
        id: joinReq.id,
        status: joinReq.status,
        decisionNote: joinReq.decisionNote ?? null
      };
    }
  }

  // S56: Pending request count — visible only to OWNER/ADMIN for the inbox badge.
  let pendingRequestCount: number | null = null;
  if (isAdminOrOwner) {
    pendingRequestCount = await prisma.groupJoinRequest.count({
      where: { groupId: params.id, status: "PENDING" }
    });
  }

  return NextResponse.json({
    group: {
      ...group,
      // Strip the member roster for non-members to prevent data leakage.
      // The memberships array is used internally above (isMember, callerMembership)
      // but must not be exposed to unauthenticated viewers of OPEN/REQUEST_TO_JOIN groups.
      memberships: isMember ? group.memberships : undefined,
      callerJoinRequest,
      pendingRequestCount: isAdminOrOwner ? pendingRequestCount : undefined,
    }
  });
}
