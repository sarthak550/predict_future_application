import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

// ---------------------------------------------------------------------------
// GET /api/portfolio/[username]
// Public endpoint — no auth required.
// Cache-Control: public, max-age=120
// ---------------------------------------------------------------------------

interface RouteParams {
  params: { username: string };
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const username = decodeURIComponent(params.username);

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayMode: true,
        isVerifiedAnalyst: true,
        // NOTE: NO email, phone, referralCode, walletBalance selected.
        stats: {
          select: {
            accuracyScore: true,
            totalPredictions: true,
            totalNetPoints: true,
            bestStreak: true,
          },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // ── Recent resolved markets (last 5 FINALIZED, ordered by resolveAt desc) ──
    const recentResolved = await prisma.market.findMany({
      where: {
        creatorId: user.id,
        resolutionStatus: "FINALIZED",
      },
      orderBy: { resolveAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        outcome: true,
        resolveAt: true,
        positions: {
          where: { userId: user.id },
          select: { side: true, amount: true },
          take: 1,
        },
      },
    });

    // ── Open markets (top 5 OPEN, ordered by createdAt desc) ──
    const openMarkets = await prisma.market.findMany({
      where: {
        creatorId: user.id,
        status: "OPEN",
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        closeAt: true,
        positions: {
          where: { userId: user.id },
          select: { side: true, amount: true },
          take: 1,
        },
      },
    });

    const portfolio = {
      username: user.username, // real username — used for URL routing (portfolio/[username])
      displayName: getDisplayName(user), // pseudonym when ANONYMOUS
      isVerifiedAnalyst: user.isVerifiedAnalyst,
      accuracyScore: user.stats?.accuracyScore ?? 0,
      totalPredictions: user.stats?.totalPredictions ?? 0,
      totalNetPoints: user.stats?.totalNetPoints ?? 0,
      bestStreak: user.stats?.bestStreak ?? 0,
      followerCount: user._count.followers,
      recentResolvedMarkets: recentResolved.map((m) => ({
        id: m.id,
        title: m.title,
        outcome: m.outcome,
        resolvedAt: m.resolveAt.toISOString(),
        userCall:
          m.positions[0] != null
            ? { side: m.positions[0].side ?? "?", amount: m.positions[0].amount }
            : null,
      })),
      openMarkets: openMarkets.map((m) => ({
        id: m.id,
        title: m.title,
        userCall:
          m.positions[0] != null
            ? { side: m.positions[0].side ?? "?", amount: m.positions[0].amount }
            : null,
      })),
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(portfolio, {
      headers: {
        "Cache-Control": "public, max-age=120, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error("[portfolio] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
