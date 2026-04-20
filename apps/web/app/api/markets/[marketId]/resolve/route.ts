import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { submitHostMarketResolution } from "@/lib/markets/resolution";
import { prisma } from "@/lib/prisma";
import { hostResolutionSchema } from "@/lib/validations/market";

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
      where: { id: session.user.id },
      select: {
        id: true,
        isSuspended: true
      }
    });

    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account cannot resolve markets." }, { status: 403 });
    }

    const payload = hostResolutionSchema.parse(await request.json());

    await submitHostMarketResolution({
      marketId: params.marketId,
      hostUserId: actor.id,
      outcome: payload.outcome,
      actualValue: payload.actualValue,
      resolutionNote: payload.resolutionNote,
      evidenceText: payload.evidenceText || undefined,
      evidenceUrl: payload.evidenceUrl || undefined
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit resolution." },
      { status: 400 }
    );
  }
}
