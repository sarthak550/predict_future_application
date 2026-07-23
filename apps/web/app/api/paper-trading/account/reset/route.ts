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
export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const result = await resetAccount(session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ account: result.account });
}
