import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTalliesResponse, choiceToBucketIndex, IMPLICATION_BUCKETS } from "@/lib/finance/tallies";

/**
 * Current v3 IMPLICATION choices (5-bucket agreement axis).
 */
const NEW_IMPLICATION_CHOICES = new Set(IMPLICATION_BUCKETS);

/**
 * Legacy IMPLICATION choices kept for backwards compatibility with stale clients.
 * Maps to the canonical v3 bucket value before persistence.
 */
const LEGACY_IMPLICATION_MAP: Record<string, string> = {
  STRONG_DROP: "STRONGLY_DISAGREE",
  MILD_DROP: "DISAGREE",
  FLAT: "NEUTRAL",
  MILD_GAIN: "AGREE",
  STRONG_GAIN: "STRONGLY_AGREE",
  BULLISH: "STRONGLY_AGREE",
  BEARISH: "STRONGLY_DISAGREE",
};

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { pollType?: string; choice?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { pollType, choice } = body;

  // Retrospective poll was removed — admin resolution is the source of truth.
  // Reject stale clients with 410 Gone so they can stop sending it.
  if (pollType === "RETROSPECTIVE") {
    return NextResponse.json(
      { error: "Retrospective poll has been removed." },
      { status: 410 }
    );
  }

  if (pollType !== "IMPLICATION") {
    return NextResponse.json(
      { error: "pollType must be IMPLICATION" },
      { status: 400 }
    );
  }

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    select: { id: true, resolutionStatus: true },
  });
  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  // Reject all changes once the opinion resolves — no late voting on known outcomes.
  if (opinion.resolutionStatus !== "PENDING") {
    return NextResponse.json(
      { error: "This opinion has resolved — voting is closed." },
      { status: 409 }
    );
  }

  // Reject changes to a vote that's already locked — locking is one-way.
  const existing = await prisma.expertOpinionVote.findUnique({
    where: {
      userId_opinionId_pollType: {
        userId,
        opinionId: params.id,
        pollType: "IMPLICATION",
      },
    },
    select: { lockedAt: true },
  });
  if (existing?.lockedAt) {
    return NextResponse.json(
      { error: "Your vote is locked and cannot be changed." },
      { status: 409 }
    );
  }

  if (!choice) {
    return NextResponse.json(
      { error: "choice is required" },
      { status: 400 }
    );
  }

  const isNewChoice = NEW_IMPLICATION_CHOICES.has(
    choice as (typeof IMPLICATION_BUCKETS)[number]
  );
  const isLegacyChoice = choice in LEGACY_IMPLICATION_MAP;
  if (!isNewChoice && !isLegacyChoice) {
    return NextResponse.json(
      {
        error:
          "choice must be one of: STRONGLY_DISAGREE, DISAGREE, NEUTRAL, AGREE, STRONGLY_AGREE",
      },
      { status: 400 }
    );
  }

  const canonicalChoice = LEGACY_IMPLICATION_MAP[choice] ?? choice;
  const idx = choiceToBucketIndex(canonicalChoice);
  if (idx < 0 || idx > 4) {
    return NextResponse.json(
      { error: "Internal: could not resolve choice to a valid bucket" },
      { status: 500 }
    );
  }

  // Wrap reads + upsert in a transaction so a concurrent admin resolve cannot
  // slip in between the guard check and the write.
  try {
    await prisma.$transaction(async (tx) => {
      const latestOpinion = await tx.expertOpinion.findUnique({
        where: { id: params.id },
        select: { id: true, resolutionStatus: true },
      });
      if (!latestOpinion) throw new Error("NOT_FOUND");
      if (latestOpinion.resolutionStatus !== "PENDING") throw new Error("RESOLVED");

      const latestExisting = await tx.expertOpinionVote.findUnique({
        where: {
          userId_opinionId_pollType: {
            userId,
            opinionId: params.id,
            pollType: "IMPLICATION",
          },
        },
        select: { lockedAt: true },
      });
      if (latestExisting?.lockedAt) throw new Error("LOCKED");

      await tx.expertOpinionVote.upsert({
        where: {
          userId_opinionId_pollType: {
            userId,
            opinionId: params.id,
            pollType: "IMPLICATION",
          },
        },
        update: { choice: canonicalChoice },
        create: {
          userId,
          opinionId: params.id,
          pollType: "IMPLICATION",
          choice: canonicalChoice,
        },
      });
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
      }
      if (err.message === "RESOLVED") {
        return NextResponse.json(
          { error: "This opinion has resolved — voting is closed." },
          { status: 409 }
        );
      }
      if (err.message === "LOCKED") {
        return NextResponse.json(
          { error: "Your vote is locked and cannot be changed." },
          { status: 409 }
        );
      }
    }
    console.error("[vote] transaction error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const tallies = await buildTalliesResponse(params.id, userId);
  return NextResponse.json(tallies);
}
