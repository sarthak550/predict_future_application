/**
 * S59-T2: User-level default group notification level.
 *
 * GET  /api/users/me/notification-defaults — return current server value.
 * PATCH /api/users/me/notification-defaults — update the value.
 *
 * This field replaces the AsyncStorage "@groups_notif_default" key used in S58.
 * The mobile profile screen migrates the stored value to the server on first load,
 * then treats this endpoint as the authoritative source.
 */

import { GroupNotifLevel } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_LEVELS = Object.values(GroupNotifLevel) as string[];

export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultGroupNotificationLevel: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ defaultGroupNotificationLevel: user.defaultGroupNotificationLevel });
}

export async function PATCH(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawLevel = (body as Record<string, unknown>)?.defaultGroupNotificationLevel;
  if (!rawLevel || typeof rawLevel !== "string" || !VALID_LEVELS.includes(rawLevel)) {
    return NextResponse.json(
      {
        error: `defaultGroupNotificationLevel must be one of: ${VALID_LEVELS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { defaultGroupNotificationLevel: rawLevel as GroupNotifLevel },
    select: { defaultGroupNotificationLevel: true },
  });

  return NextResponse.json({ defaultGroupNotificationLevel: updated.defaultGroupNotificationLevel });
}
