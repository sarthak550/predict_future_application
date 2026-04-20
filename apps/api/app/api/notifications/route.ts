import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ notifications });
}

export async function PATCH() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  await prisma.notification.updateMany({
    where: {
      userId: session.user.id,
      isRead: false
    },
    data: {
      isRead: true
    }
  });

  return NextResponse.json({ ok: true });
}
