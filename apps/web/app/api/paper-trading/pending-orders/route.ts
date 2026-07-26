import { NextResponse } from "next/server";

import { placePendingOrderSchema } from "@predict-future/validation/paperTrading";

import { getSession } from "@/lib/auth";
import { listPendingOrders, placePendingOrder } from "@/lib/paperTrading/pendingOrders";

/**
 * GET /api/paper-trading/pending-orders — lists the caller's currently-PENDING
 * limit orders (T3's "Pending orders" section backing endpoint).
 *
 * POST /api/paper-trading/pending-orders — places (never fills) one resting
 * limit order. See lib/paperTrading/pendingOrders.ts for the full validation
 * + blocking algorithm. Rejects `INDEX_FUTURE`/`orderKind: "FUTURE"` with a
 * clear, dedicated error BEFORE the zod schema is even reached — futures
 * order placement itself doesn't exist yet this sprint (see the Limit Orders
 * brief's scope section), so there's no market-order lifecycle for a futures
 * limit order to sit on top of.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const orders = await listPendingOrders(session.user.id);
  return NextResponse.json({ orders });
}

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

  const rawOrderKind = (body as { orderKind?: unknown; instrumentKind?: unknown })?.orderKind ?? (body as { instrumentKind?: unknown })?.instrumentKind;
  if (rawOrderKind === "FUTURE" || rawOrderKind === "INDEX_FUTURE") {
    return NextResponse.json(
      { error: "Limit orders for index futures aren't supported yet — futures order placement itself hasn't shipped." },
      { status: 400 }
    );
  }

  const parsed = placePendingOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await placePendingOrder(session.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ order: result.order }, { status: 201 });
}
