import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { prisma } from "@/lib/prisma";
import { voteSchema } from "@/lib/validations/market";

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const session = await getSession();
    const userId = session?.user?.id ?? searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isSuspended: true, role: true }
    });
    if (!user || user.isSuspended) {
      return NextResponse.json({ error: "Account cannot vote." }, { status: 403 });
    }

    const payload = voteSchema.parse(await request.json());

    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      include: {
        group: {
          select: {
            ownerId: true,
            memberships: {
              where: { userId: user.id },
              select: { userId: true }
            }
          }
        }
      }
    });

    if (!market) {
      return NextResponse.json({ error: "Poll not found." }, { status: 404 });
    }

    if (!canViewMarket(market, user)) {
      return NextResponse.json({ error: "Poll not found." }, { status: 404 });
    }

    if (market.status !== "OPEN") {
      return NextResponse.json({ error: "This poll is not open for voting." }, { status: 409 });
    }

    if (market.closeAt && market.closeAt <= new Date()) {
      return NextResponse.json({ error: "This poll has closed." }, { status: 409 });
    }

    // Check for existing vote
    const existingVote = await prisma.vote.findUnique({
      where: { userId_marketId: { userId: user.id, marketId: market.id } }
    });

    if (existingVote) {
      return NextResponse.json({ error: "You have already voted on this poll." }, { status: 409 });
    }

    // Validate based on market type
    if (market.marketType === "BINARY") {
      if (!payload.side) {
        return NextResponse.json({ error: "Binary polls require YES or NO." }, { status: 400 });
      }
    } else {
      if (payload.numericValue === undefined) {
        return NextResponse.json({ error: "Numeric polls require a value." }, { status: 400 });
      }
      if (market.minValue !== null && payload.numericValue < market.minValue) {
        return NextResponse.json({ error: `Value must be at least ${market.minValue}.` }, { status: 400 });
      }
      if (market.maxValue !== null && payload.numericValue > market.maxValue) {
        return NextResponse.json({ error: `Value must be at most ${market.maxValue}.` }, { status: 400 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.vote.create({
        data: {
          userId: user.id,
          marketId: market.id,
          side: payload.side ?? null,
          numericValue: payload.numericValue ?? null,
        }
      });

      // Update denormalized counts
      if (market.marketType === "BINARY") {
        await tx.market.update({
          where: { id: market.id },
          data: {
            yesCount: payload.side === "YES" ? { increment: 1 } : undefined,
            noCount: payload.side === "NO" ? { increment: 1 } : undefined,
            totalVotes: { increment: 1 },
          }
        });
      } else {
        // For numeric polls, recalculate average
        const allVotes = await tx.vote.findMany({
          where: { marketId: market.id, numericValue: { not: null } },
          select: { numericValue: true }
        });
        const sum = allVotes.reduce((acc, v) => acc + (v.numericValue ?? 0), 0);
        const avg = allVotes.length > 0 ? sum / allVotes.length : null;

        await tx.market.update({
          where: { id: market.id },
          data: {
            totalVotes: { increment: 1 },
            averageNumericValue: avg,
          }
        });
      }
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to cast vote." },
      { status: 400 }
    );
  }
}
