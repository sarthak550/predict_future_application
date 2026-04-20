import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: { userId: string } }
) {
  const user = await prisma.user.findUnique({
    where: {
      id: params.userId
    },
    select: {
      id: true,
      username: true,
      stats: {
        select: {
          hostTrustScore: true,
          validFinalizedHostedMarketsCount: true,
          hostedMarketsCount: true,
          finalizedHostedMarketsCount: true,
          cleanFinalizationCount: true,
          upheldAfterChallengeCount: true,
          hostTimeoutCount: true,
          overturnedHostedMarketsCount: true,
          moderationViolationCount: true,
          avgParticipantsPerHostedMarket: true,
          avgPoolPerHostedMarket: true,
          repeatJoinRate: true,
          avgHostCommissionBps: true,
          cleanStreakCount: true,
          publicHostingEligibility: true,
          hostingLimit: true
        }
      }
    }
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    userId: user.id,
    username: user.username,
    hostStats: user.stats
  });
}
