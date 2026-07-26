"use client";

/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T7) — the futures-order
 * submit call, mirroring lib/paperTrading/optionOrdersClient.ts's extraction
 * pattern: one implementation shared by the docked ticket's "Confirm" click,
 * calling POST /api/paper-trading/futures/orders (-> lib/paperTrading/futuresOrders.ts).
 */

export interface PlacedFuturesOrderPayload {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  underlyingSymbol: string;
  expiryDate: string;
  lotSize: number;
  lots: number;
  quantity: number;
  fillPrice: number;
  fillTickAt: string;
  grossAmount: number;
  brokerage: number;
  sttAmount: number;
  exchangeCharge: number;
  sebiFee: number;
  stampDuty: number;
  gstAmount: number;
  dpCharge: number;
  totalCosts: number;
  netAmount: number;
  createdAt: string;
  instrumentKind: "INDEX_FUTURE";
  quoteSource: "LIVE" | "PCP_DERIVED";
  marginRequired: number;
  impliedLeverage: number;
  isClose: boolean;
}

export interface SubmitFuturesOrderInput {
  underlyingSymbol: string;
  expiryDate: string;
  side: "BUY" | "SELL";
  lots: number;
}

export type SubmitFuturesOrderResult =
  | { ok: true; order: PlacedFuturesOrderPayload }
  | { ok: false; error: string };

export async function submitFuturesOrder(input: SubmitFuturesOrderInput): Promise<SubmitFuturesOrderResult> {
  try {
    const res = await fetch("/api/paper-trading/futures/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      return { ok: false, error: payload.error ?? "Couldn't place that order." };
    }
    const data = await res.json();
    return { ok: true, order: data.order as PlacedFuturesOrderPayload };
  } catch {
    return { ok: false, error: "Couldn't place that order — check your connection and try again." };
  }
}
