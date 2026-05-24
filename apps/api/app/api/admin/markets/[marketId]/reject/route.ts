import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const rejectSchema = z.object({
  reason: z.string().min(8).max(500)
});

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
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
    const payload = rejectSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: params.marketId }
      });
      if (!market) {
        throw new Error("Market not found.");
      }
      if (market.status !== "DRAFT" && market.status !== "PENDING_REVIEW") {
        throw new Error("Only pending markets can be rejected.");
      }

      await tx.market.update({
        where: { id: market.id },
        data: {
          status: "REJECTED",
          isFeatured: false,
          approvedAt: null,
          approvedById: null
        }
      });

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          marketId: market.id,
          type: "REJECT_MARKET",
          notes: payload.reason
        }
      });

      await createNotification(tx, {
        userId: market.creatorId,
        marketId: market.id,
        type: "SYSTEM",
        title: "Market rejected",
        body: payload.reason,
        href: `/markets/${market.id}`
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reject market." },
      { status: 400 }
    );
  }
}
