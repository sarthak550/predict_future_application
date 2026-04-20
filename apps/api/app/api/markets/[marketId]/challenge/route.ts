import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { submitMarketChallenge } from "@/lib/markets/resolution";
import { prisma } from "@/lib/prisma";
import { marketChallengeSchema } from "@/lib/validations/market";

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
      return NextResponse.json({ error: "Account cannot challenge markets." }, { status: 403 });
    }

    const payload = marketChallengeSchema.parse(await request.json());
    const challenge = await submitMarketChallenge({
      marketId: params.marketId,
      challengerUserId: actor.id,
      reasonText: payload.reasonText || undefined,
      evidenceText: payload.evidenceText || undefined,
      evidenceUrl: payload.evidenceUrl || undefined
    });

    return NextResponse.json({ challenge }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to file challenge." },
      { status: 400 }
    );
  }
}
