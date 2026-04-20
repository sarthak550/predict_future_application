import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { approveStoryForFeed } from "@/lib/news/approval";
import { prisma } from "@/lib/prisma";
import { adminStoryDecisionSchema } from "@/lib/validations/news";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const payload = adminStoryDecisionSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      await approveStoryForFeed(tx, {
        storyId: payload.storyId,
        actorId: session.user.id,
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
