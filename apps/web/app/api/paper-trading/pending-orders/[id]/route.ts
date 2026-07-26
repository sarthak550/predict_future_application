import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { cancelPendingOrder } from "@/lib/paperTrading/pendingOrders";

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
