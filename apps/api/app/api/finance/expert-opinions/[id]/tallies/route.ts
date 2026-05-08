import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTalliesResponse } from "@/lib/finance/tallies";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Auth optional — userChoice is null when unauthenticated
  const userId = await getUserIdFromRequest(request);

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    select: { id: true },
  });

  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  const tallies = await buildTalliesResponse(params.id, userId ?? null);
  return NextResponse.json(tallies);
}
