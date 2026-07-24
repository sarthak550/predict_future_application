import { NextResponse } from "next/server";

import { placePaperOptionOrderSchema } from "@predict-future/validation/paperTrading";

import { getSession } from "@/lib/auth";
import { placeOptionOrder } from "@/lib/paperTrading/optionOrders";

/**
 * POST /api/paper-trading/options/orders
 *
 * Places and immediately fills one BUY/SELL index-option leg against the
 * caller's ACTIVE Paper Trading account (see lib/paperTrading/optionOrders.ts
 * for the full validation + fill algorithm, including the long-only naked-write
 * guardrail on SELL). Same synchronous-fill contract as the equity orders
 * route — the response IS the fill confirmation, complete with every itemized
 * cost line.
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

  const parsed = placePaperOptionOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await placeOptionOrder(session.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ order: result.order }, { status: 201 });
}
