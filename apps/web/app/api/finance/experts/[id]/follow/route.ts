import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Mirrors apps/api's GET/POST/DELETE /api/finance/experts/[id]/follow/route.ts —
 * same reason apps/web already duplicates the vote/tallies routes (see
 * app/api/finance/expert-opinions/[id]/{vote,tallies}/route.ts): apps/web and
 * apps/api are separate deployables on separate origins (predictfuture-web.duckdns.org
 * vs predictfuture-api.duckdns.org), so a browser's same-origin `fetch("/api/...")`
 * from a page served by apps/web can never reach apps/api's route handlers — it needs
 * its own copy against the same shared Prisma client / ExpertFollow model apps/api
 * already designed. Auth uses apps/web's own getSession() (NextAuth server session,
 * the established convention on this side — see the vote/tallies routes) rather than
 * apps/api's getUserIdFromRequest (Bearer-token-first, for the mobile app).
 */

export const dynamic = "force-dynamic";

/** GET — returns { following: boolean } for the authenticated user; { following: false } when signed out. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ following: false });
  }

  const existing = await prisma.expertFollow.findUnique({
    where: { userId_expertId: { userId, expertId: params.id } },
    select: { id: true },
  });

  return NextResponse.json({ following: Boolean(existing) });
}

/** POST — authenticated. Idempotent upsert. Returns { following: true }. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;
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

/** DELETE — authenticated. Idempotent. Returns { following: false }. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.expertFollow.delete({
      where: { userId_expertId: { userId, expertId: params.id } },
    });
  } catch {
    // Record didn't exist — idempotent, not an error.
  }

  return NextResponse.json({ following: false });
}
