import { NextResponse } from "next/server";

import { placeTransactionSchema } from "@predict-future/validation/portfolio";

import { getSession } from "@/lib/auth";
import { placeTransaction } from "@/lib/portfolios/transactions";

/**
 * POST /api/portfolios/:id/transactions
 *
 * Places a new BUY/SELL order, status PENDING. Filled or cancelled later by the
 * portfolios-settle cron (apps/api/lib/portfolios/settlement.ts) at the next
 * session's close — see that file for the full execution rule.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = placeTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await placeTransaction(params.id, session.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ transaction: result.transaction }, { status: 201 });
}
