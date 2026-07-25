/**
 * Trading Terminal UI Overhaul (Sprint A, T6/T7) — the option-order submit
 * call, EXTRACTED from option-trade-panel.tsx's inline handleSubmit into a
 * standalone function so it has exactly ONE implementation shared by:
 *   - the docked ticket's manual "Confirm" click (the only order path),
 * Same endpoint, same request body shape, same response handling as before —
 * this is a pure extraction, not a new order-placement code path. The server
 * route (POST /api/paper-trading/options/orders -> lib/paperTrading/optionOrders.ts)
 * is completely unaware of which UI path called it.
 */
import type { PlacedOptionOrderPayload } from "@/components/paper-trading/option-trade-panel";

export interface SubmitOptionOrderInput {
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  side: "BUY" | "SELL";
  lots: number;
  linkedOpinionId?: string | null;
}

export type SubmitOptionOrderResult =
  | { ok: true; order: PlacedOptionOrderPayload }
  | { ok: false; error: string };

export async function submitOptionOrder(input: SubmitOptionOrderInput): Promise<SubmitOptionOrderResult> {
  try {
    const res = await fetch("/api/paper-trading/options/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        underlyingSymbol: input.underlyingSymbol,
        optionType: input.optionType,
        strikePrice: input.strikePrice,
        expiryDate: input.expiryDate,
        side: input.side,
        lots: input.lots,
        ...(input.linkedOpinionId ? { linkedOpinionId: input.linkedOpinionId } : {})
      })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      return { ok: false, error: payload.error ?? "Couldn't place that order." };
    }
    const data = await res.json();
    return { ok: true, order: data.order as PlacedOptionOrderPayload };
  } catch {
    return { ok: false, error: "Couldn't place that order — check your connection and try again." };
  }
}
