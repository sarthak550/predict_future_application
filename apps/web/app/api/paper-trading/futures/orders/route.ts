import { NextResponse } from "next/server";

import { placePaperFuturesOrderSchema } from "@predict-future/validation/paperTrading";

import { getSession } from "@/lib/auth";
import { placeFuturesOrder } from "@/lib/paperTrading/futuresOrders";

/**
 * POST /api/paper-trading/futures/orders
 *
 * Places and immediately fills one BUY/SELL index-futures leg (long OR short)
 * against the caller's ACTIVE Paper Trading account — see
 * lib/paperTrading/futuresOrders.ts for the full validation + margin-check +
 * fill algorithm. Same synchronous-fill contract as every other Paper Trading
 * order route — the response IS the fill confirmation, complete with every
 * itemized cost line plus the margin required and implied leverage.
 */
export async function POST(request: Request) {
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

  const parsed = placePaperFuturesOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await placeFuturesOrder(session.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ order: result.order }, { status: 201 });
}
