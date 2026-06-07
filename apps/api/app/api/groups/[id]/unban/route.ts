import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/unban
 *
 * Lifts a ban by setting bannedAt = null and banReason = null on the
 * target user's GroupMembership row.
 *
 * Body: { userId: string }
 * Returns 200 + { banned: false } on success.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const callerId = await getUserIdFromRequest(request);
  if (!callerId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: { userId?: string };
  try {
    body = await request.json() as { userId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { userId } = body;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true }
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Verify caller has OWNER or ADMIN role.
  const callerMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: callerId } },
    select: { role: true }
  });

  if (
    !callerMembership ||
    (callerMembership.role !== "OWNER" && callerMembership.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "You must be an owner or admin to unban users." },
      { status: 403 }
    );
  }

  const targetMembership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId: params.id, userId } }
  });

  if (!targetMembership) {
    return NextResponse.json({ error: "No membership record found for this user." }, { status: 404 });
  }

  await prisma.groupMembership.update({
    where: { groupId_userId: { groupId: params.id, userId } },
    data: { bannedAt: null, banReason: null }
  });

  return NextResponse.json({ banned: false }, { status: 200 });
}
