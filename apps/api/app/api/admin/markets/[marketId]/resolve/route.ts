import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { finalizeMarketResolution } from "@/lib/markets/resolution";
import { normalizeResolutionMode } from "@/lib/markets/policies";
import { prisma } from "@/lib/prisma";
import { adminResolutionSchema } from "@/lib/validations/market";

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

    const market = await prisma.market.findUnique({
      where: { id: params.marketId }
    });
    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }
    if (normalizeResolutionMode(market.resolutionMode) !== "VERIFIED") {
      return NextResponse.json(
        { error: "Admin direct resolution is only for verified markets. Trusted-host reviews use uphold, overturn, or cancel." },
        { status: 409 }
      );
    }

    const payload = adminResolutionSchema.parse(await request.json());

    await finalizeMarketResolution({
      marketId: market.id,
      outcome: payload.outcome,
      sourceName: payload.sourceName,
      sourceUrl: payload.sourceUrl || undefined,
      explanation: payload.explanation,
      resolvedById: actor.id,
      finalizationActorId: actor.id,
      resolutionStatus: payload.outcome === "CANCELLED" ? "CANCELLED" : "FINALIZED",
      releaseHostBond: true
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to resolve market." }, { status: 400 });
  }
}
