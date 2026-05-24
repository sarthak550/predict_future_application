import { randomUUID } from "crypto";
import { MarketStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { adminStoryUpdateSchema, approvedStoryStatuses } from "@/lib/validations/news";

export async function PATCH(
  request: Request,
  { params }: { params: { storyId: string } }
) {
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
    const payload = adminStoryUpdateSchema.parse(await request.json());

    const story = await prisma.$transaction(async (tx) => {
      const existing = await tx.story.findUnique({
        where: { id: params.storyId },
        include: {
          market: true
        }
      });

      if (!existing) {
        throw new Error("Story not found.");
      }

      const isApproved = approvedStoryStatuses.includes(existing.status);

      const updatedStory = await tx.story.update({
        where: { id: existing.id },
        data: {
          headline: payload.headline ?? existing.headline,
          summary: payload.summary,
          category: payload.category,
          isFeatured: payload.isFeatured ?? existing.isFeatured,
          isTrending: payload.isTrending ?? existing.isTrending
        }
      });

      if (payload.prediction) {
        const nextMarketStatus: MarketStatus = isApproved ? "OPEN" : "DRAFT";
        const marketData = {
          storyId: existing.id,
          title: payload.prediction.title,
          description: payload.prediction.description,
          category: payload.category,
          template: payload.prediction.template,
          creatorId: existing.market?.creatorId ?? actor.id,
          status: nextMarketStatus,
          closeAt: new Date(payload.prediction.closeAt),
          resolveAt: new Date(payload.prediction.resolveAt),
          resolutionSourceType: payload.prediction.resolutionSourceType,
          resolutionSourceName: payload.prediction.resolutionSourceName,
          resolutionSourceUrl: payload.prediction.resolutionSourceUrl || updatedStory.sourceUrl,
          resolutionRuleText: payload.prediction.resolutionRuleText,
          fallbackRuleText: payload.prediction.fallbackRuleText || null,
          structuredData: payload.prediction.structuredData as Prisma.InputJsonValue | undefined,
          approvedAt: isApproved ? existing.market?.approvedAt ?? new Date() : null,
          approvedById: isApproved ? existing.market?.approvedById ?? actor.id : null
        };

        if (existing.market) {
          await tx.market.update({
            where: { id: existing.market.id },
            data: marketData
          });
        } else {
          await tx.market.create({
            data: {
              slug: `${slugify(payload.prediction.title)}-${randomUUID().slice(0, 8)}`,
              ...marketData
            }
          });
        }
      }

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          storyId: existing.id,
          marketId: existing.market?.id ?? null,
          type: "CURATE_FEED",
          notes: "Updated story summary or attached prediction."
        }
      });

      return updatedStory;
    });

    return NextResponse.json({ story });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update story." },
      { status: 400 }
    );
  }
}
