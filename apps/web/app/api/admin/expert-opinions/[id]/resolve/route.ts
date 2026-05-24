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
  if (session.user.isSuspended) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
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

  const trimmedNote = (resolutionNote ?? "").trim();
  if (trimmedNote.length < 10) {
    return NextResponse.json(
      { error: "resolutionNote is required (min 10 characters) — explain why this call resolved HIT or MISS." },
      { status: 400 }
    );
  }

  // Atomic conditional update + audit log in a single transaction.
  // updateMany with resolutionStatus:"PENDING" in the where clause ensures
  // only one concurrent request can win — the second gets count:0 → 409.
  type OpinionSnapshot = {
    id: string;
    resolutionStatus: string;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    storyId: string | null;
    expert: { name: string | null; organization: string };
    story: { headline: string } | null;
  };

  let resolvedOpinion: OpinionSnapshot | null = null;
  let alreadyResolved = false;

  try {
    resolvedOpinion = await prisma.$transaction(async (tx) => {
      const result = await tx.expertOpinion.updateMany({
        where: { id: params.id, resolutionStatus: "PENDING" },
        data: {
          resolutionStatus: resolutionStatus as ValidResolutionStatus,
          resolvedAt: new Date(),
          resolutionNote: trimmedNote,
        },
      });

      if (result.count === 0) {
        throw Object.assign(new Error("Opinion is already resolved or not found."), { code: "ALREADY_RESOLVED" });
      }

      const opinion = await tx.expertOpinion.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          resolutionStatus: true,
          resolvedAt: true,
          resolutionNote: true,
          storyId: true,
          expert: { select: { name: true, organization: true } },
          story: { select: { headline: true } },
        },
      });

      await tx.adminAction.create({
        data: {
          actorId: session.user.id,
          type: "RESOLVE_OPINION",
          notes: trimmedNote,
          metadata: { opinionId: params.id, resolutionStatus },
        },
      });

      return opinion;
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { code?: string }).code === "ALREADY_RESOLVED") {
      alreadyResolved = true;
    } else {
      throw err;
    }
  }

  if (alreadyResolved) {
    return NextResponse.json({ error: "Opinion is already resolved or not found." }, { status: 409 });
  }

  // Notify only LOCKED Poll A voters — drafts didn't count toward accuracy.
  // This runs AFTER the transaction commits so double-notify is impossible.
  const pollAVoters = await prisma.expertOpinionVote.findMany({
    where: { opinionId: params.id, pollType: "IMPLICATION", lockedAt: { not: null } },
    select: { userId: true },
  });

  if (pollAVoters.length > 0) {
    const expertLabel = resolvedOpinion!.expert.name
      ? `${resolvedOpinion!.expert.name} (${resolvedOpinion!.expert.organization})`
      : resolvedOpinion!.expert.organization;

    const headline = resolvedOpinion!.story?.headline ?? "a story";
    const storyTitle = headline.slice(0, 50) + (headline.length > 50 ? "..." : "");

    const resolutionLabel = (resolutionStatus as ValidResolutionStatus) === "RESOLVED_HIT" ? "HIT" : "MISS";

    const notificationData = pollAVoters.map((voter) => ({
      userId: voter.userId,
      title: `${expertLabel} on "${storyTitle}"`,
      body: `The call resolved ${resolutionLabel}. See how your prediction compared.`,
      href: resolvedOpinion!.storyId ? `/story/${resolvedOpinion!.storyId}` : null,
      type: "OPINION_RESOLVED" as const,
    }));

    await prisma.notification.createMany({
      data: notificationData,
      skipDuplicates: true,
    });
  }

  // S42-T2: Stamp notifiedAt so the auto-resolve cron Phase-0 sweep does not
  // re-notify this opinion. Best-effort — notifications already sent; if this
  // update fails we log but do not roll back.
  try {
    await prisma.expertOpinion.update({
      where: { id: params.id },
      data: { notifiedAt: new Date() },
    });
  } catch (stampErr) {
    console.error("[web/admin/resolve] Failed to stamp notifiedAt — cron may re-notify", stampErr);
  }

  return NextResponse.json({
    ok: true,
    opinion: {
      id: resolvedOpinion!.id,
      resolutionStatus: resolvedOpinion!.resolutionStatus,
      resolvedAt: resolvedOpinion!.resolvedAt?.toISOString() ?? null,
      resolutionNote: resolvedOpinion!.resolutionNote,
    },
  });
}
