import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const featureSchema = z.object({
  featured: z.boolean()
});

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id }
  });
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR") || actor.isSuspended) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const payload = featureSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: params.marketId }
      });
      if (!market) {
        throw new Error("Market not found.");
      }

      await tx.market.update({
        where: { id: market.id },
        data: {
          isFeatured: payload.featured
        }
      });

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          marketId: market.id,
          type: "FEATURE_MARKET",
          metadata: {
            featured: payload.featured
          }
        }
      });

      if (payload.featured) {
        await createNotification(tx, {
          userId: market.creatorId,
          marketId: market.id,
          type: "SYSTEM",
          title: "Market featured",
          body: `${market.title} is now featured in the discovery feed.`,
          href: `/markets/${market.id}`
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update featured status." },
      { status: 400 }
    );
  }
}
