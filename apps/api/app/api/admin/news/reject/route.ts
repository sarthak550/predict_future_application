import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { adminStoryRejectSchema, pendingStoryStatuses } from "@/lib/validations/news";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const payload = adminStoryRejectSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      const story = await tx.story.findUnique({
        where: { id: payload.storyId },
        include: {
          market: true
        }
      });

      if (!story) {
        throw new Error("Story not found.");
      }

      if (!pendingStoryStatuses.includes(story.status)) {
        throw new Error("Only draft stories can be rejected.");
      }

      await tx.story.update({
        where: { id: story.id },
        data: {
          status: "REJECTED",
          isFeatured: false,
          isTrending: false,
          approvedById: null
        }
      });

      if (story.market && story.market.status !== "CANCELLED") {
        await tx.market.update({
          where: { id: story.market.id },
          data: {
            status: "CANCELLED",
            isFeatured: false,
            approvedAt: null,
            approvedById: null
          }
        });
      }

      await tx.adminAction.create({
        data: {
          actorId: session.user.id,
          storyId: story.id,
          marketId: story.market?.id ?? null,
          type: "REJECT_STORY",
          notes: payload.reason
        }
      });

      if (story.createdById && story.createdById !== session.user.id) {
        await createNotification(tx, {
          userId: story.createdById,
          storyId: story.id,
          marketId: story.market?.id,
          type: "SYSTEM",
          title: "Story rejected",
          body: payload.reason,
          href: "/admin/moderation"
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reject story." },
      { status: 400 }
    );
  }
}
