import { NextResponse } from "next/server";

import { recalculateAnalystTiersForRecentlyResolved } from "@/lib/analysts";

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return true;
  }
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Recompute tiers for all users with positions settled in the last 24 hours.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const updated = await recalculateAnalystTiersForRecentlyResolved(since);

  return NextResponse.json({ updated });
}

export async function GET(request: Request) {
  return POST(request);
}
