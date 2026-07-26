import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { resetAccount } from "@/lib/paperTrading/account";

/**
 * POST /api/paper-trading/account/reset
 *
 * Archives the caller's current ACTIVE account and creates a new one at
 * generation + 1, same starting capital — gated to once per 30 days since the
 * current account's createdAt (see lib/paperTrading/account.ts). Prior
 * generations' order history is never deleted.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Optional {"startingCapital": <int rupees>} — the reset is where users set
  // their own capital (founder 2026-07-26); omitted = the ₹1Cr default.
  const body = (await request.json().catch(() => null)) as { startingCapital?: number } | null;
  const result = await resetAccount(session.user.id, body?.startingCapital);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ account: result.account });
}
