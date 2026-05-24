import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const result = await prisma.story.deleteMany({
      where: {
        sourceUrl: {
          contains: "businesstoday.in"
        }
      }
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
      message: `Deleted ${result.count} Business Today articles. They will be re-ingested on the next cron run.`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
