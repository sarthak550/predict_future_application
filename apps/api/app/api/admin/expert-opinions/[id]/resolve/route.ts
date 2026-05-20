import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_RESOLUTION_STATUSES = ["RESOLVED_HIT", "RESOLVED_MISS"] as const;
type ValidResolutionStatus = (typeof VALID_RESOLUTION_STATUSES)[number];

/**
 * Maps any stored IMPLICATION choice (v1/v2/v3) to a binary agree/disagree bucket.
 * Strongly-agree and agree → "AGREED". Strongly-disagree and disagree → "DISAGREED".
 * Neutral → null (excluded from agree/disagree framing in the notification copy).
 */
function implicationChoiceToAgreement(choice: string): "AGREED" | "DISAGREED" | "NEUTRAL" {
  switch (choice) {
    case "STRONGLY_AGREE":
    case "AGREE":
    case "STRONG_GAIN":
    case "MILD_GAIN":
    case "BULLISH":
      return "AGREED";
    case "STRONGLY_DISAGREE":
    case "DISAGREE":
    case "STRONG_DROP":
    case "MILD_DROP":
    case "BEARISH":
      return "DISAGREED";
    default:
      // NEUTRAL / FLAT / unknown
      return "NEUTRAL";
  }
}

/**
 * Computes a user's accuracy percentage across all their resolved expert-opinion Poll A votes.
 * "Accurate" means: AGREED on a HIT, or DISAGREED on a MISS. Neutral votes are excluded.
 *
 * Returns a value in the range 0–100 rounded to the nearest integer.
 * Returns null when the user has no scoreable votes.
 */
async function computeUserOpinionAccuracy(userId: string): Promise<number | null> {
  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      userId,
      pollType: "IMPLICATION",
      opinion: {
        resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
      },
    },
    select: {
      choice: true,
      opinion: { select: { resolutionStatus: true } },
    },
  });

  const scoreable = votes.filter((v) => {
    const agreement = implicationChoiceToAgreement(v.choice);
    return agreement !== "NEUTRAL";
  });

  if (scoreable.length === 0) return null;

  const correct = scoreable.filter((v) => {
    const agreement = implicationChoiceToAgreement(v.choice);
    const isHit = v.opinion.resolutionStatus === "RESOLVED_HIT";
    return (agreement === "AGREED" && isHit) || (agreement === "DISAGREED" && !isHit);
  });

  return Math.round((correct.length / scoreable.length) * 100);
}

/**
 * Sends Expo push notifications to a batch of voters.
 * Batches into chunks of 100 per Expo API limit.
 * Best-effort — failures are swallowed; push delivery is advisory.
 */
async function sendOpinionResolutionPushBatch(
  messages: Array<{
    to: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }>
): Promise<void> {
  if (messages.length === 0) return;

  const CHUNK_SIZE = 100;
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE).map((m) => ({
      ...m,
      sound: "default" as const,
    }));

    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.error("[opinion-resolve] push chunk error:", err);
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin or Moderator access required." }, { status: 403 });
  }

  let body: { resolutionStatus?: string; resolutionNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { resolutionStatus, resolutionNote } = body;

  if (!resolutionStatus || !VALID_RESOLUTION_STATUSES.includes(resolutionStatus as ValidResolutionStatus)) {
    return NextResponse.json(
      { error: "resolutionStatus must be RESOLVED_HIT or RESOLVED_MISS." },
      { status: 400 }
    );
  }

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    include: {
      expert: { select: { name: true, organization: true } },
      story: { select: { headline: true } },
    },
  });

  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found." }, { status: 404 });
  }

  if (opinion.resolutionStatus !== "PENDING") {
    return NextResponse.json({ error: "Opinion is already resolved." }, { status: 400 });
  }

  const resolvedAt = new Date();
  const resolvedStatus = resolutionStatus as ValidResolutionStatus;
  const isHit = resolvedStatus === "RESOLVED_HIT";
  const resolutionLabel = isHit ? "HIT" : "MISS";

  // Resolve the opinion
  const updatedOpinion = await prisma.expertOpinion.update({
    where: { id: params.id },
    data: {
      resolutionStatus: resolvedStatus,
      resolvedAt,
      resolutionNote: resolutionNote ?? null,
    },
  });

  // ── Build notification copy components ────────────────────────────────────
  const expertLabel = opinion.expert.name
    ? `${opinion.expert.name} (${opinion.expert.organization})`
    : opinion.expert.organization;

  // Prefer instrument name (e.g. "Nifty 50"); fall back to truncated quote
  const instrumentLabel = opinion.instrument
    ? opinion.instrument
    : opinion.story?.headline
      ? opinion.story.headline.slice(0, 40) + (opinion.story.headline.length > 40 ? "…" : "")
      : "a call";

  const directionLabel =
    opinion.direction === "BULLISH" ? "BULLISH" :
    opinion.direction === "BEARISH" ? "BEARISH" : "NEUTRAL";

  // ── Fetch all Poll A (IMPLICATION) voters with their choices + push tokens ─
  const pollAVoters = await prisma.expertOpinionVote.findMany({
    where: { opinionId: params.id, pollType: "IMPLICATION" },
    select: {
      userId: true,
      choice: true,
      user: { select: { expoPushToken: true } },
    },
  });

  if (pollAVoters.length === 0) {
    return NextResponse.json({
      ok: true,
      opinion: {
        id: updatedOpinion.id,
        resolutionStatus: updatedOpinion.resolutionStatus,
        resolvedAt: updatedOpinion.resolvedAt?.toISOString() ?? null,
        resolutionNote: updatedOpinion.resolutionNote,
      },
      notified: 0,
      pushQueued: 0,
    });
  }

  // ── Compute accuracy for each voter and build per-voter notification ───────
  const pushMessages: Array<{
    to: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }> = [];

  const inAppNotifications: Array<{
    userId: string;
    type: "OPINION_RESOLVED";
    title: string;
    body: string;
    href: string | null;
  }> = [];

  // Compute accuracy for all voters in parallel (cap at 200 concurrent DB reads)
  const CONCURRENCY = 20;
  for (let i = 0; i < pollAVoters.length; i += CONCURRENCY) {
    const slice = pollAVoters.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (voter) => {
        const agreement = implicationChoiceToAgreement(voter.choice);

        // Build agreement phrase — neutral voters get a simpler message
        let agreedPhrase: string;
        if (agreement === "AGREED") {
          agreedPhrase = "You agreed";
        } else if (agreement === "DISAGREED") {
          agreedPhrase = "You disagreed";
        } else {
          agreedPhrase = "You were neutral";
        }

        const accuracyPct = await computeUserOpinionAccuracy(voter.userId);
        const accuracySuffix =
          accuracyPct !== null ? ` Your accuracy is now ${accuracyPct}%.` : "";

        const notifTitle = `${expertLabel} — ${directionLabel} on ${instrumentLabel}`;
        const notifBody = `Resolved ${resolutionLabel}. ${agreedPhrase}.${accuracySuffix}`;
        const href = opinion.storyId ? `/story/${opinion.storyId}` : null;

        inAppNotifications.push({
          userId: voter.userId,
          type: "OPINION_RESOLVED",
          title: notifTitle,
          body: notifBody,
          href,
        });

        if (voter.user.expoPushToken) {
          pushMessages.push({
            to: voter.user.expoPushToken,
            title: notifTitle,
            body: notifBody,
            data: href ? { href } : {},
          });
        }
      })
    );
  }

  // ── Persist in-app notifications ─────────────────────────────────────────
  await prisma.notification.createMany({
    data: inAppNotifications.map((n) => ({
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      storyId: opinion.storyId ?? undefined,
    })),
    skipDuplicates: true,
  });

  // ── Fire push notifications (fire-and-forget) ────────────────────────────
  void sendOpinionResolutionPushBatch(pushMessages).catch((err) => {
    console.error("[opinion-resolve] push batch error:", err);
  });

  return NextResponse.json({
    ok: true,
    opinion: {
      id: updatedOpinion.id,
      resolutionStatus: updatedOpinion.resolutionStatus,
      resolvedAt: updatedOpinion.resolvedAt?.toISOString() ?? null,
      resolutionNote: updatedOpinion.resolutionNote,
    },
    notified: inAppNotifications.length,
    pushQueued: pushMessages.length,
  });
}
