import { NextResponse } from "next/server";

import { placePendingOrderSchema } from "@predict-future/validation/paperTrading";

import { getSession } from "@/lib/auth";
import { listPendingOrders, placePendingOrder } from "@/lib/paperTrading/pendingOrders";

/**
 * GET /api/paper-trading/pending-orders — lists the caller's currently-PENDING
 * limit/stop orders (T3's "Pending orders" section backing endpoint).
 *
 * POST /api/paper-trading/pending-orders — places (never fills) one resting
 * LIMIT or STOP order (equity, options, or — Chart Trading + SL/TP Sprint A,
 * 2026-07-31 — index futures). See lib/paperTrading/pendingOrders.ts for the
 * full validation + blocking algorithm. The dedicated pre-zod rejection for
 * `orderKind: "FUTURE"` that existed during the Limit Orders sprint has been
 * removed — futures order placement shipped in Phase 4 Sprint 2, and this
 * sprint adds the pending-order lifecycle on top of it (see design decision
 * 5/6 in the Sprint A brief).
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
