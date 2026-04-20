import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { cancelMarketAfterReview } from "@/lib/markets/resolution";
import { prisma } from "@/lib/prisma";
import { adminCancelMarketSchema } from "@/lib/validations/market";

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: session.user.id }
    });

    if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = adminCancelMarketSchema.parse(await request.json());
    await cancelMarketAfterReview({
      marketId: params.marketId,
      actorId: actor.id,
      explanation: payload.explanation
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to cancel market." },
      { status: 400 }
    );
  }
}
