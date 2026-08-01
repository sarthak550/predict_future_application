import { NextResponse } from "next/server";

import { repricePendingOrderSchema } from "@predict-future/validation/paperTrading";

import { getSession } from "@/lib/auth";
import { cancelPendingOrder, repricePendingOrder } from "@/lib/paperTrading/pendingOrders";

/**
 * DELETE /api/paper-trading/pending-orders/[id] — cancels a PENDING limit
 * order. 404 if it doesn't belong to the caller's account, 409 if it's
 * already FILLED/CANCELLED/EXPIRED (see lib/paperTrading/pendingOrders.ts).
 * The block it was holding is released the instant this returns — cancelling
 * is a plain status UPDATE, no compensating write needed (see the schema doc
 * on model PaperPendingOrder for why the block is always derived, never a
 * separately-persisted ledger entry).
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const result = await cancelPendingOrder(session.user.id, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ order: result.order });
}

/**
 * PATCH /api/paper-trading/pending-orders/[id] — Chart Trading + SL/TP
 * (Sprint C) — the drag-to-reprice endpoint (decision 1 of the Sprint C
 * brief). Body: `{limitPrice?, triggerPrice?}`, atomic in-place update, never
 * cancel-then-recreate. 404 if the order doesn't belong to the caller's
 * account, 409 if it's no longer PENDING, 422 for the same placement-grade
 * validation failures a fresh order would hit (wrong-side STOP, insufficient
 * cash/margin/holdings at the new price) — see
 * lib/paperTrading/pendingOrders.ts's repricePendingOrder for the full
 * validation flow. The client (the chart's optimistic drag) is expected to
 * revert the line on any non-2xx response.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

  const parsed = repricePendingOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = await repricePendingOrder(session.user.id, params.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ order: result.order });
}
