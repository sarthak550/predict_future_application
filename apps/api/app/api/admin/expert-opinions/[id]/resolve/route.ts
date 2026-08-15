import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { notifyOpinionResolution } from "@/lib/notifyOpinionResolution";
import { notifyExpertFollowersOnOpinionResolution } from "@/lib/notifyExpertFollowersOnOpinionResolution";
import { prisma } from "@/lib/prisma";

const VALID_RESOLUTION_STATUSES = ["RESOLVED_HIT", "RESOLVED_MISS"] as const;
type ValidResolutionStatus = (typeof VALID_RESOLUTION_STATUSES)[number];

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
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
  type OpinionSnapshot = { id: string; resolutionStatus: string; resolvedAt: Date | null; resolutionNote: string | null };

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
        select: { id: true, resolutionStatus: true, resolvedAt: true, resolutionNote: true },
      });

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
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

  const { notified, pushQueued } = await notifyOpinionResolution(params.id);
  // Growth Loop Sprint G5 — fan out to the expert's FOLLOWERS too (a
  // sibling call, not a merge into notifyOpinionResolution — see that
  // function's own doc comment for why). Best-effort: a failure here must
  // never roll back the resolution itself or block the voter notification
  // that already succeeded above.
  await notifyExpertFollowersOnOpinionResolution(params.id).catch((err) => {
    console.error("[admin/resolve] follower notification failed:", err);
  });

  // S42-T2: Stamp notifiedAt so the auto-resolve cron Phase-0 sweep does not
  // re-notify this opinion. Best-effort — notification already happened; if
  // this update fails we log but do not roll back.
  try {
    await prisma.expertOpinion.update({
      where: { id: params.id },
      data: { notifiedAt: new Date() },
    });
  } catch (stampErr) {
    console.error("[admin/resolve] Failed to stamp notifiedAt — cron may re-notify", stampErr);
  }

  return NextResponse.json({
    ok: true,
    opinion: {
      id: resolvedOpinion!.id,
      resolutionStatus: resolvedOpinion!.resolutionStatus,
      resolvedAt: resolvedOpinion!.resolvedAt?.toISOString() ?? null,
      resolutionNote: resolvedOpinion!.resolutionNote,
    },
    notified,
    pushQueued,
  });
}
