import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/experts/[id]/follow
 * Returns { following: boolean } for the authenticated user.
 * Returns { following: false } when unauthenticated.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ following: false });
  }

  const existing = await prisma.expertFollow.findUnique({
    where: { userId_expertId: { userId, expertId: params.id } },
    select: { id: true },
  });

  return NextResponse.json({ following: Boolean(existing) });
}

/**
 * POST /api/finance/experts/[id]/follow
 * Authenticated. Upserts an ExpertFollow row.
 * Idempotent — safe to call if already following.
 * Returns { following: true }
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expert = await prisma.expert.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!expert) {
    return NextResponse.json({ error: "Expert not found" }, { status: 404 });
  }

  await prisma.expertFollow.upsert({
    where: { userId_expertId: { userId, expertId: params.id } },
    update: {},
    create: { userId, expertId: params.id },
  });

  return NextResponse.json({ following: true });
}

/**
 * DELETE /api/finance/experts/[id]/follow
 * Authenticated. Removes the ExpertFollow row.
 * Idempotent — safe to call even if not currently following.
 * Returns { following: false }
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.expertFollow.delete({
      where: { userId_expertId: { userId, expertId: params.id } },
    });
  } catch {
    // Record didn't exist — idempotent, not an error
  }

  return NextResponse.json({ following: false });
}
