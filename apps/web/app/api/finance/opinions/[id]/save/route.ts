import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Mirrors app/api/finance/experts/[id]/follow/route.ts's shape — same
 * "apps/web and apps/api are separate deployables on separate origins"
 * reasoning documented at that file's top, and the same single-row
 * per-user-per-target toggle pattern (SavedOpinion here, ExpertFollow
 * there). Auth uses apps/web's own getSession() (NextAuth server session),
 * not apps/api's getUserIdFromRequest — mobile is out of scope for this
 * feature (see the Saved Opinions brief).
 *
 * One deliberate divergence from follow/route.ts's own GET: that route
 * never validates the target expert exists (an unfollowed/bad id just
 * reads as { following: false }). This route's GET DOES validate the
 * opinion exists first and 404s if not — required by this ticket's own
 * acceptance criteria, and cheap since the icon components that consume
 * this route never call it (they use the batch /saved-ids GET or a
 * server-known initial value instead — see save-opinion-button.tsx).
 */

export const dynamic = "force-dynamic";

/** GET — returns { saved: boolean } for the authenticated user; { saved: false } when signed out. 404s if the opinion itself doesn't exist. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ saved: false });
  }

  const existing = await prisma.savedOpinion.findUnique({
    where: { userId_opinionId: { userId, opinionId: params.id } },
    select: { id: true },
  });

  return NextResponse.json({ saved: Boolean(existing) });
}

/** POST — authenticated. Idempotent upsert. 404s if the opinion doesn't exist. Returns { saved: true }. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  // No suppression check at write time by design (brief, Ticket 2): a user
  // can save a call and have it get suppressed later — /calls/[id]'s own
  // redirect already handles that gracefully at click-through time.
  await prisma.savedOpinion.upsert({
    where: { userId_opinionId: { userId, opinionId: params.id } },
    update: {},
    create: { userId, opinionId: params.id },
  });

  return NextResponse.json({ saved: true });
}

/** DELETE — authenticated. Idempotent. Returns { saved: false }. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.savedOpinion.delete({
      where: { userId_opinionId: { userId, opinionId: params.id } },
    });
  } catch {
    // Record didn't exist — idempotent, not an error.
  }

  return NextResponse.json({ saved: false });
}
