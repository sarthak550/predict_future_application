import { NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id } = params;

  // Only allow marking own notifications as read
  const notification = await prisma.notification.findFirst({
    where: { id, userId },
  });

  if (!notification) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true });
}
