import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { overturnTrustedHostResolution } from "@/lib/markets/resolution";
import { prisma } from "@/lib/prisma";
import { adminOverturnResolutionSchema } from "@/lib/validations/market";

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

    if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR") || actor.isSuspended) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = adminOverturnResolutionSchema.parse(await request.json());
    await overturnTrustedHostResolution({
      marketId: params.marketId,
      actorId: actor.id,
      outcome: payload.outcome,
      actualValue: payload.actualValue,
      explanation: payload.explanation,
      sourceName: payload.sourceName,
      sourceUrl: payload.sourceUrl || undefined,
      overturnedReason: payload.overturnedReason
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to overturn resolution." },
      { status: 400 }
    );
  }
}
