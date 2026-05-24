import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
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

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
  });

  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found." }, { status: 404 });
  }

  // Idempotent: if already suppressed, return 200 with no-op
  if (opinion.suppressedAt !== null) {
    return NextResponse.json({ ok: true, suppressed: true, alreadySuppressed: true });
  }

  // Suppress the opinion AND log the AdminAction in the same transaction —
  // so an audit query for SUPPRESS_OPINION rows can never miss a hidden
  // opinion or vice-versa.
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.expertOpinion.update({
      where: { id: params.id },
      data: { suppressedAt: new Date() },
      select: { id: true, suppressedAt: true },
    });

    await tx.adminAction.create({
      data: {
        actorId: session.user.id,
        type: "SUPPRESS_OPINION",
        notes: `Suppressed expert opinion ${params.id}.`,
        metadata: { opinionId: params.id },
      },
    });

    return next;
  });

  return NextResponse.json({
    ok: true,
    suppressed: true,
    opinion: {
      id: updated.id,
      suppressedAt: updated.suppressedAt?.toISOString() ?? null,
    },
  });
}
