import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getAccountDetail } from "@/lib/paperTrading/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/paper-trading/account
 *
 * Lazily creates the caller's ACTIVE Paper Trading account on first call, then
 * returns cash/holdings/lifetime P&L/lifetime costs-paid, all derived by replaying
 * the PaperOrder log (see lib/paperTrading/queries.ts). Signed-in only.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const detail = await getAccountDetail(session.user.id);
  return NextResponse.json({ account: detail });
}
