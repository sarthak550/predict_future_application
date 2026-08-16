import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Backs ExpandableCallsTable's single batch fetch of the signed-in user's
 * saved-opinion-id set (Saved Opinions brief, Ticket 2/3). A user's saved
 * set is comparable in scale to their ExpertFollow set — dozens at most,
 * not thousands — so no pagination, same as follow/route.ts's own sibling
 * routes never paginate a single user's follow list.
 *
 * Deliberately NOT one GET per row: /opinions and other host pages for
 * ExpandableCallsTable can render dozens of rows, and an N-instance
 * mount-fetch-per-row would reintroduce the N+1 network pattern this
 * codebase got burned by once (see reference_prisma_distinct_emulation.md).
 * The table fetches this once and does a client-side Set.has() per row.
 */

export const dynamic = "force-dynamic";

/** GET — returns { ids: string[] } of every opinionId the signed-in user has saved. [] when signed out. */
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ids: [] });
  }

  const saved = await prisma.savedOpinion.findMany({
    where: { userId },
    select: { opinionId: true },
  });

  return NextResponse.json({ ids: saved.map((row) => row.opinionId) });
}
