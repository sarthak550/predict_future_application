import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getCallsTraded } from "@/lib/paperTrading/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/paper-trading/calls-traded
 *
 * "Calls I've traded" (T8) — every linkedOpinionId group the caller has traded,
 * each independently replayed and joined to its ExpertOpinion's own grading
 * status. See lib/paperTrading/queries.ts's getCallsTraded doc comment.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const calls = await getCallsTraded(session.user.id);
  return NextResponse.json({ calls });
}
