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
 *
 * v2 magnitude legacy: STRONG_DROP/MILD_DROP/FLAT/MILD_GAIN/STRONG_GAIN
 * v1 direction legacy: BULLISH/BEARISH/NEUTRAL
 */
const LEGACY_IMPLICATION_MAP: Record<string, string> = {
  // v2 magnitude → v3 agreement
  STRONG_DROP: "STRONGLY_DISAGREE",
  MILD_DROP: "DISAGREE",
  FLAT: "NEUTRAL",
  MILD_GAIN: "AGREE",
  STRONG_GAIN: "STRONGLY_AGREE",
  // v1 direction → v3 agreement
  BULLISH: "STRONGLY_AGREE",
  BEARISH: "STRONGLY_DISAGREE",
  // NEUTRAL is already v3 canonical, no mapping needed
};

const VALID_RETROSPECTIVE_CHOICES = ["HIT", "MISS"] as const;

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

  if (pollType !== "IMPLICATION" && pollType !== "RETROSPECTIVE") {
    return NextResponse.json(
      { error: "pollType must be IMPLICATION or RETROSPECTIVE" },
      { status: 400 }
    );
  }

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
  });

  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  if (pollType === "IMPLICATION") {
    if (!choice) {
      return NextResponse.json(
        { error: "choice is required for IMPLICATION poll" },
        { status: 400 }
      );
    }
    // Accept both v2 buckets and legacy v1 values — reject anything else
    const isNewChoice = NEW_IMPLICATION_CHOICES.has(
      choice as (typeof IMPLICATION_BUCKETS)[number]
    );
    const isLegacyChoice = choice in LEGACY_IMPLICATION_MAP;
    if (!isNewChoice && !isLegacyChoice) {
      return NextResponse.json(
        {
          error:
            "For IMPLICATION poll, choice must be one of: STRONGLY_DISAGREE, DISAGREE, NEUTRAL, AGREE, STRONGLY_AGREE",
        },
        { status: 400 }
      );
    }
  }

  if (pollType === "RETROSPECTIVE") {
    if (opinion.resolutionStatus === "PENDING") {
      return NextResponse.json(
        { error: "Retrospective poll is locked until this opinion resolves" },
        { status: 400 }
      );
    }
    if (
      !choice ||
      !VALID_RETROSPECTIVE_CHOICES.includes(
        choice as (typeof VALID_RETROSPECTIVE_CHOICES)[number]
      )
    ) {
      return NextResponse.json(
        { error: "For RETROSPECTIVE poll, choice must be HIT or MISS" },
        { status: 400 }
      );
    }
  }

  // Resolve the canonical choice to persist — map legacy v1 values to v2 buckets
  const canonicalChoice =
    pollType === "IMPLICATION"
      ? (LEGACY_IMPLICATION_MAP[choice!] ?? choice!)
      : choice!;

  // Validate bucket index is in range (safety check)
  if (pollType === "IMPLICATION") {
    const idx = choiceToBucketIndex(canonicalChoice);
    if (idx < 0 || idx > 4) {
      return NextResponse.json(
        { error: "Internal: could not resolve choice to a valid bucket" },
        { status: 500 }
      );
    }
  }

  // Upsert vote — one per user per pollType per opinion
  await prisma.expertOpinionVote.upsert({
    where: {
      userId_opinionId_pollType: {
        userId,
        opinionId: params.id,
        pollType: pollType as "IMPLICATION" | "RETROSPECTIVE",
      },
    },
    update: { choice: canonicalChoice },
    create: {
      userId,
      opinionId: params.id,
      pollType: pollType as "IMPLICATION" | "RETROSPECTIVE",
      choice: canonicalChoice,
    },
  });

  // Return updated tallies
  const tallies = await buildTalliesResponse(params.id, userId);
  return NextResponse.json(tallies);
}
