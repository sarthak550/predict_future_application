import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

/**
 * GET /api/groups/:id/join-requests
 *
 * Returns paginated join requests for a group. Caller must be OWNER or ADMIN.
 *
 * Query params:
 *   status?: "PENDING" | "APPROVED" | "REJECTED"  — default "PENDING"
 *   cursor?: string     — opaque cursor (base64url-encoded requestedAt + id)
 *   limit?: number      — default 20, max 50
 *
 * Response:
 *   { requests: [{ id, userId, username, avatarUrl, requestedAt, status }], nextCursor }
 *
 * Ordered by requestedAt ASC (oldest first — fair queue for PENDING).
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Role check.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true }
  });

  if (
    !callerMembership ||
    (callerMembership.role !== "OWNER" && callerMembership.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "You must be an owner or admin to view join requests." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);

  const rawStatus = searchParams.get("status") ?? "PENDING";
  const status = (["PENDING", "APPROVED", "REJECTED"].includes(rawStatus)
    ? rawStatus
    : "PENDING") as "PENDING" | "APPROVED" | "REJECTED";

  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(
    isNaN(limitParam) ? PAGE_SIZE_DEFAULT : Math.max(1, limitParam),
    PAGE_SIZE_MAX
  );

  const cursorParam = searchParams.get("cursor");
  let cursorWhere: Record<string, unknown> = {};
  if (cursorParam) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursorParam, "base64url").toString("utf8")
      ) as { requestedAt: string; id: string };

      const ra = new Date(decoded.requestedAt);
      const cid = decoded.id;

      // Cursor: requestedAt ASC, id ASC as tie-break.
      cursorWhere = {
        OR: [
          { requestedAt: { gt: ra } },
          { requestedAt: { equals: ra }, id: { gt: cid } }
        ]
      };
    } catch {
      // Malformed cursor — ignore, start from beginning.
    }
  }

  const rows = await prisma.groupJoinRequest.findMany({
    where: {
      groupId: params.id,
      status,
      ...cursorWhere
    },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      userId: true,
      status: true,
      requestedAt: true,
      user: {
        select: { username: true, avatarUrl: true }
      }
    }
  });

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasNextPage && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ requestedAt: last.requestedAt.toISOString(), id: last.id }),
      "utf8"
    ).toString("base64url");
  }

  const requests = pageRows.map((r) => ({
    id: r.id,
    userId: r.userId,
    username: r.user.username,
    avatarUrl: r.user.avatarUrl ?? null,
    requestedAt: r.requestedAt.toISOString(),
    status: r.status
  }));

  return NextResponse.json({ requests, nextCursor });
}
