/**
 * S58: Per-group notification preference endpoints.
 *
 * GET  /api/groups/:id/notification-preference — returns caller's pref (ALL if no row).
 * PATCH /api/groups/:id/notification-preference — upserts caller's pref.
 *
 * Auth required. Caller must be an active member (non-banned GroupMembership row).
 * Non-members and non-existent groups return 404.
 */

import { GroupNotifLevel } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGroupNotifPref, setGroupNotifPref } from "@/lib/groups/service";

const VALID_LEVELS: readonly GroupNotifLevel[] = [
  GroupNotifLevel.ALL,
  GroupNotifLevel.MENTIONS_ONLY,
  GroupNotifLevel.NONE,
] as const;

/**
 * Verify caller is an active (non-banned) member of the group.
 * Returns null if group/member check fails (caller should return 404).
 */
async function requireActiveMember(
  groupId: string,
  userId: string
): Promise<{ groupId: string } | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, isArchived: true }
  });

  if (!group || group.isArchived) return null;

  const membership = await prisma.groupMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { bannedAt: true }
  });

  if (!membership || membership.bannedAt != null) return null;

  return { groupId };
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const ctx = await requireActiveMember(params.id, userId);
  if (!ctx) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const level = await getGroupNotifPref(params.id, userId);
  return NextResponse.json({ level });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const ctx = await requireActiveMember(params.id, userId);
  if (!ctx) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const level = (body as { level?: unknown }).level;

  if (!level || !VALID_LEVELS.includes(level as GroupNotifLevel)) {
    return NextResponse.json(
      {
        error: `Invalid level. Must be one of: ${VALID_LEVELS.join(", ")}.`
      },
      { status: 400 }
    );
  }

  const saved = await setGroupNotifPref(params.id, userId, level as GroupNotifLevel);
  return NextResponse.json({ level: saved });
}
