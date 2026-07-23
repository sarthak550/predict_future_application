import { NextResponse } from "next/server";

import { placePaperOrderSchema } from "@predict-future/validation/paperTrading";

import { getSession } from "@/lib/auth";
import { placeOrder } from "@/lib/paperTrading/orders";

/**
 * POST /api/paper-trading/orders
 *
 * Places and immediately fills one BUY/SELL leg against the caller's ACTIVE
 * Paper Trading account (see lib/paperTrading/orders.ts for the full validation +
 * fill algorithm). Unlike Portfolios, there is no PENDING state — the response IS
 * the fill confirmation, complete with every itemized cost line.
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

  const parsed = placePaperOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await placeOrder(session.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ order: result.order }, { status: 201 });
}
