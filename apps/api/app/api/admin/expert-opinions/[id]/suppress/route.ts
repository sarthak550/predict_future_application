import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(_request);
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

  const updated = await prisma.expertOpinion.update({
    where: { id: params.id },
    data: { suppressedAt: new Date() },
    select: { id: true, suppressedAt: true },
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
