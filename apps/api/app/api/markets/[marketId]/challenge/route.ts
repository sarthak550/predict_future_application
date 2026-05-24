import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { submitMarketChallenge } from "@/lib/markets/resolution";
import { marketChallengeSchema } from "@/lib/validations/market";

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    // getUserIdFromRequest already enforces isSuspended === false on both
    // cookie and Bearer paths, so the prior duplicate prisma.user.findUnique
    // check is no longer needed.
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const payload = marketChallengeSchema.parse(await request.json());
    const challenge = await submitMarketChallenge({
      marketId: params.marketId,
      challengerUserId: userId,
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
