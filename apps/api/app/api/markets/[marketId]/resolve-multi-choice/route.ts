import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { settleMultiChoiceMarket } from "@/lib/markets/payouts";
import { prisma } from "@/lib/prisma";
import { resolveMultiChoiceSchema } from "@/lib/validations/market";

/**
 * POST /api/markets/[marketId]/resolve-multi-choice
 *
 * Admin-only endpoint to resolve a MULTIPLE_CHOICE market by selecting the
 * winning option. Only ADMIN or MODERATOR roles may resolve — creator
 * self-resolution is intentionally blocked to prevent exit-scam abuse
 * (creator stakes on option A, instantly resolves A as winner).
 *
 * TODO (follow-up): add the same challenge-window / bond flow that the binary
 * host-resolve route uses, then re-enable trusted-host resolution here.
 *
 * Body: { winningOptionId: string }
 */
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
      select: { id: true, role: true, isSuspended: true }
    });

    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account cannot resolve markets." }, { status: 403 });
    }

    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: {
        id: true,
        title: true,
        status: true,
        marketType: true,
        creatorId: true,
        winningOptionId: true
      }
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    if (market.marketType !== "MULTIPLE_CHOICE") {
      return NextResponse.json(
        { error: "This endpoint is only for multiple-choice markets." },
        { status: 400 }
      );
    }

    const isAdmin = actor.role === "ADMIN" || actor.role === "MODERATOR";

    // Creator self-resolution is blocked — admin/moderator only.
    // Reason: no challenge window or bond exists for multi-choice markets yet; allowing
    // creator resolution enables exit-scam (stake on option A → resolve A instantly).
    if (!isAdmin) {
      return NextResponse.json({ error: "Only admins can resolve multi-choice markets." }, { status: 403 });
    }

    if (market.winningOptionId) {
      return NextResponse.json(
        { error: "Market has already been resolved." },
        { status: 409 }
      );
    }

    if (!["CLOSED", "AWAITING_RESOLUTION", "OPEN"].includes(market.status)) {
      return NextResponse.json(
        { error: "Market cannot be resolved in its current state." },
        { status: 409 }
      );
    }

    const payload = resolveMultiChoiceSchema.parse(await request.json());

    // Verify the winning option belongs to this market.
    const option = await prisma.marketOption.findUnique({
      where: { id: payload.winningOptionId },
      select: { id: true, marketId: true, isWinner: true }
    });

    if (!option || option.marketId !== market.id) {
      return NextResponse.json(
        { error: "Winning option not found in this market." },
        { status: 404 }
      );
    }

    // Run resolution in a transaction.
    await prisma.$transaction(async (tx) => {
      // Mark market as resolved and set winning option.
      await tx.market.update({
        where: { id: market.id },
        data: {
          status: "RESOLVED",
          outcome: "YES", // sentinel — actual outcome tracked via winningOptionId
          winningOptionId: payload.winningOptionId,
          resolutionStatus: "FINALIZED",
          finalizationAt: new Date(),
          resolutionFinalizedById: actor.id
        }
      });

      // Mark the winning option.
      await tx.marketOption.update({
        where: { id: payload.winningOptionId },
        data: { isWinner: true }
      });

      // Create resolution record.
      await tx.marketResolution.upsert({
        where: { marketId: market.id },
        update: {
          outcome: "YES",
          sourceName: "Admin resolution",
          explanation: `Multi-choice market resolved with winning option by ${actor.role.toLowerCase()}.`,
          resolvedAt: new Date(),
          resolvedById: actor.id
        },
        create: {
          marketId: market.id,
          outcome: "YES",
          sourceName: "Admin resolution",
          explanation: `Multi-choice market resolved with winning option by ${actor.role.toLowerCase()}.`,
          resolvedAt: new Date(),
          resolvedById: actor.id
        }
      });

      // Settle all positions.
      await settleMultiChoiceMarket(tx, market.id);
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to resolve market.";
    console.error("[resolve-multi-choice]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
