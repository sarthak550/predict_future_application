import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { listMyPortfolios } from "@/lib/portfolios/queries";

/**
 * GET /api/portfolios/mine
 *
 * Lists the caller's own portfolios, each with its latest nightly-cron cached value
 * (may be null for a brand-new portfolio) and a live-computed snapshot.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const portfolios = await listMyPortfolios(session.user.id);
  return NextResponse.json({ portfolios });
}
