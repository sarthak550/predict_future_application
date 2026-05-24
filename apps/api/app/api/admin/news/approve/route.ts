import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { approveStoryForFeed } from "@/lib/news/approval";
import { prisma } from "@/lib/prisma";
import { adminStoryDecisionSchema } from "@/lib/validations/news";

export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const payload = adminStoryDecisionSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      await approveStoryForFeed(tx, {
        storyId: payload.storyId,
        actorId: actor.id,
        note: payload.note
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve story." },
      { status: 400 }
    );
  }
}
