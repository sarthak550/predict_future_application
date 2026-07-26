/**
 * Limit Orders (Sprint, 2026-07-26) — client-side submit/cancel calls for
 * POST/DELETE /api/paper-trading/pending-orders[/id], extracted the same way
 * optionOrdersClient.ts extracted the market-order submit call: one shared
 * implementation for every UI entry point (New Trade form, docked option
 * ticket) rather than each form hand-rolling its own fetch.
 */

export interface PendingOrderPayload {
  id: string;
  instrumentKind: "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION";
  symbol: string;
  side: "BUY" | "SELL";
  productType: "DELIVERY" | "INTRADAY" | null;
  quantity: number;
  limitPrice: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "EXPIRED";
  blockedAmount: number | null;
  linkedOpinionId: string | null;
  underlyingSymbol: string | null;
  optionType: "CE" | "PE" | null;
  strikePrice: number | null;
  expiryDate: string | null;
  lotSize: number | null;
  lots: number | null;
  createdAt: string;
}

export interface SubmitPendingEquityOrderInput {
  orderKind: "EQUITY";
  symbol: string;
  side: "BUY" | "SELL";
  productType: "DELIVERY" | "INTRADAY";
  quantity: number;
  limitPrice: number;
  linkedOpinionId?: string | null;
}

export interface SubmitPendingOptionOrderInput {
  orderKind: "OPTION";
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  side: "BUY" | "SELL";
  lots: number;
  limitPrice: number;
  linkedOpinionId?: string | null;
}

export type SubmitPendingOrderInput = SubmitPendingEquityOrderInput | SubmitPendingOptionOrderInput;

export type SubmitPendingOrderResult = { ok: true; order: PendingOrderPayload } | { ok: false; error: string };

export async function submitPendingOrder(input: SubmitPendingOrderInput): Promise<SubmitPendingOrderResult> {
  try {
    const body: Record<string, unknown> = { ...input };
    if (!input.linkedOpinionId) delete body.linkedOpinionId;
    const res = await fetch("/api/paper-trading/pending-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      return { ok: false, error: payload.error ?? "Couldn't place that limit order." };
    }
    const data = await res.json();
    return { ok: true, order: data.order as PendingOrderPayload };
  } catch {
    return { ok: false, error: "Couldn't place that limit order — check your connection and try again." };
  }
}

export type CancelPendingOrderResult = { ok: true } | { ok: false; error: string };

export async function cancelPendingOrder(pendingOrderId: string): Promise<CancelPendingOrderResult> {
  try {
    const res = await fetch(`/api/paper-trading/pending-orders/${encodeURIComponent(pendingOrderId)}`, { method: "DELETE" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      return { ok: false, error: payload.error ?? "Couldn't cancel that order." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't cancel that order — check your connection and try again." };
  }
}
