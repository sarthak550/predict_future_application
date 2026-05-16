import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * GET /api/groups/preview?inviteCode=XXX
 *
 * Public endpoint — no auth required. Returns minimal group info so the
 * join confirmation screen can display the group name, description, and
 * member count before the user has authenticated.
 *
 * Returns 404 if the invite code is not found or the group is archived.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inviteCode = searchParams.get("inviteCode");

  if (!inviteCode || inviteCode.trim() === "") {
    return NextResponse.json(
      { error: "inviteCode query param is required." },
      { status: 400 }
    );
  }

  const group = await prisma.group.findUnique({
    where: { inviteCode },
    select: {
      id: true,
      name: true,
      description: true,
      isArchived: true,
      _count: {
        select: { memberships: true },
      },
    },
  });

  if (!group || group.isArchived) {
    return NextResponse.json(
      { error: "Invite code not found or has expired." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    memberCount: group._count.memberships,
  });
}
