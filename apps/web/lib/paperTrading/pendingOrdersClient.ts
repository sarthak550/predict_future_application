/**
 * Limit Orders (Sprint, 2026-07-26) — client-side submit/cancel calls for
 * POST/DELETE /api/paper-trading/pending-orders[/id], extracted the same way
 * optionOrdersClient.ts extracted the market-order submit call: one shared
 * implementation for every UI entry point (New Trade form, docked option
 * ticket) rather than each form hand-rolling its own fetch.
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, 2026-08-01) — widened to
 * match Sprint A's server-side shape (packages/validation/src/paperTrading.ts,
 * apps/web/lib/paperTrading/pendingOrders.ts): `variant`/`triggerPrice` on
 * every input member, a new FUTURE member, and the response payload now
 * carries `variant`/`triggerPrice`/`resolutionNote`/`repricedAt` and the
 * `REJECTED` status / `INDEX_FUTURE` instrumentKind the server has already
 * been returning since Sprint A — this file's types just hadn't caught up
 * yet (nothing server-side changes here).
 */

export interface PendingOrderPayload {
  id: string;
  instrumentKind: "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION" | "INDEX_FUTURE";
  symbol: string;
  side: "BUY" | "SELL";
  productType: "DELIVERY" | "INTRADAY" | null;
  quantity: number;
  limitPrice: number;
  /** LIMIT for every pre-Sprint-A row and every new take-profit-style order; STOP for a new stop-loss/breakout order. */
  variant: "LIMIT" | "STOP";
  /** STOP orders only — null for LIMIT (see the schema's own doc: a STOP row denormalizes `limitPrice = triggerPrice`, so these are equal on a STOP row). */
  triggerPrice: number | null;
  status: "PENDING" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";
  /** Set only on a REJECTED row — why a crossed STOP couldn't fill at the actual crossing price. */
  resolutionNote: string | null;
  /** Stamped by Sprint C's (not-yet-built) drag-to-reprice endpoint. Null for a never-repriced row. */
  repricedAt: string | null;
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
  /** Defaults to LIMIT server-side (zod default) when omitted — every pre-Sprint-B caller keeps working unchanged. */
  variant?: "LIMIT" | "STOP";
  /** Required when variant is LIMIT (or omitted). */
  limitPrice?: number;
  /** Required when variant is STOP. */
  triggerPrice?: number;
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
  variant?: "LIMIT" | "STOP";
  limitPrice?: number;
  triggerPrice?: number;
  linkedOpinionId?: string | null;
}

/** Chart Trading + SL/TP (Sprint B) — new: index-futures pending orders. `underlyingSymbol` is a plain string (not a literal union) matching the existing market-order `SubmitFuturesOrderInput`'s own convention — the server's zod `z.enum(...)` is the actual membership authority, same posture as that file. */
export interface SubmitPendingFuturesOrderInput {
  orderKind: "FUTURE";
  underlyingSymbol: string;
  expiryDate: string;
  side: "BUY" | "SELL";
  lots: number;
  variant?: "LIMIT" | "STOP";
  limitPrice?: number;
  triggerPrice?: number;
}

export type SubmitPendingOrderInput =
  | SubmitPendingEquityOrderInput
  | SubmitPendingOptionOrderInput
  | SubmitPendingFuturesOrderInput;

export type SubmitPendingOrderResult = { ok: true; order: PendingOrderPayload } | { ok: false; error: string };

export async function submitPendingOrder(input: SubmitPendingOrderInput): Promise<SubmitPendingOrderResult> {
  try {
    const body: Record<string, unknown> = { ...input };
    if (!("linkedOpinionId" in input) || !input.linkedOpinionId) delete body.linkedOpinionId;
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

export interface RepricePendingOrderInput {
  /** New price for a LIMIT row. */
  limitPrice?: number;
  /** New price for a STOP row. */
  triggerPrice?: number;
}

export type RepricePendingOrderResult = { ok: true; order: PendingOrderPayload } | { ok: false; error: string };

/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint C) — client-side call for the
 * drag-to-reprice PATCH endpoint (decision 1 of the Sprint C brief). Callers
 * (price-chart.tsx's/premium-chart.tsx's pointerup handler, via each
 * terminal's own wiring) are responsible for the optimistic-UI contract: show
 * the line at the new price immediately, and on `ok: false` revert it to the
 * pre-drag price with a visible toast — this function itself is a plain
 * fetch wrapper, it has no opinion about optimistic state.
 */
export async function repricePendingOrder(pendingOrderId: string, input: RepricePendingOrderInput): Promise<RepricePendingOrderResult> {
  try {
    const res = await fetch(`/api/paper-trading/pending-orders/${encodeURIComponent(pendingOrderId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      return { ok: false, error: payload.error ?? "Couldn't reprice that order." };
    }
    const data = await res.json();
    return { ok: true, order: data.order as PendingOrderPayload };
  } catch {
    return { ok: false, error: "Couldn't reprice that order — check your connection and try again." };
  }
}
