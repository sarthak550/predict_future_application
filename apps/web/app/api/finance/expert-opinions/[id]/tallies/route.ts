import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { buildTalliesResponse } from "@/lib/finance/tallies";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/finance/expert-opinions/[id]/tallies
 *
 * Auth optional — userChoice/userLockedAt are null when signed out. Mirrors
 * apps/api's tallies route so the response shape is identical across platforms.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id ?? null;

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    select: { id: true },
  });

  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  const tallies = await buildTalliesResponse(params.id, userId);
  return NextResponse.json(tallies);
}
