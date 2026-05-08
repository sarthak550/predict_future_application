import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_RESOLUTION_STATUSES = ["RESOLVED_HIT", "RESOLVED_MISS"] as const;
type ValidResolutionStatus = (typeof VALID_RESOLUTION_STATUSES)[number];

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

  const updatedOpinion = await prisma.expertOpinion.update({
    where: { id: params.id },
    data: {
      resolutionStatus: resolvedStatus,
      resolvedAt,
      resolutionNote: resolutionNote ?? null,
    },
  });

  // Notify all users who voted on Poll A (IMPLICATION) for this opinion
  const pollAVoters = await prisma.expertOpinionVote.findMany({
    where: { opinionId: params.id, pollType: "IMPLICATION" },
    select: { userId: true },
  });

  if (pollAVoters.length > 0) {
    const expertLabel = opinion.expert.name
      ? `${opinion.expert.name} (${opinion.expert.organization})`
      : opinion.expert.organization;

    const storyTitle = opinion.story?.headline
      ? opinion.story.headline.slice(0, 50) + (opinion.story.headline.length > 50 ? "..." : "")
      : "a story";

    const resolutionLabel = resolvedStatus === "RESOLVED_HIT" ? "HIT" : "MISS";

    const notificationData = pollAVoters.map((voter) => ({
      userId: voter.userId,
      title: `${expertLabel} on "${storyTitle}"`,
      body: `The call resolved ${resolutionLabel}. Did the take age well? Cast your retrospective vote.`,
      href: opinion.storyId ? `/story/${opinion.storyId}` : null,
      type: "SYSTEM" as const,
    }));

    await prisma.notification.createMany({
      data: notificationData,
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    ok: true,
    opinion: {
      id: updatedOpinion.id,
      resolutionStatus: updatedOpinion.resolutionStatus,
      resolvedAt: updatedOpinion.resolvedAt?.toISOString() ?? null,
      resolutionNote: updatedOpinion.resolutionNote,
    },
  });
}
