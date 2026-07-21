import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { cancelTransaction } from "@/lib/portfolios/transactions";

/**
 * DELETE /api/portfolios/:id/transactions/:txnId
 *
 * Cancels a PENDING order. EXECUTED/CANCELLED rows are immutable — no path mutates
 * them, so this is a no-op (409) once settlement has already touched the row.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string; txnId: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const result = await cancelTransaction(params.id, params.txnId, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
