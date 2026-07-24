/**
 * Paper Trading Phase 1 — order placement orchestration for
 * POST /api/paper-trading/orders (T3).
 *
 * Every PaperOrder fills SYNCHRONOUSLY at request time — no PENDING state, unlike
 * Portfolios (see the schema doc on model PaperOrder). All pure cost/validation
 * math lives in packages/business-rules/src/papertrading/{costs,replay}.ts; this
 * file is DB + upstream-LTP orchestration only: validate, price, compute costs,
 * persist.
 */

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";
import {
  deriveCash,
  deriveDeliveryHoldings,
  isFirstDeliverySellOfScripToday,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import type { TxSide, PaperProductType } from "@prisma/client";

import { getOrCreateActiveAccount } from "@/lib/paperTrading/account";
import { fetchDelayedLtp } from "@/lib/paperTrading/ltp";
import { prisma } from "@/lib/prisma";

const ENGINE_ORDER_SELECT = {
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  fillPrice: true,
  totalCosts: true,
  netAmount: true,
  createdAt: true
} as const;

export interface PlaceOrderInput {
  symbol: string;
  side: TxSide;
  productType: PaperProductType;
  quantity: number;
  linkedOpinionId?: string;
}

export interface PlacedOrder {
  id: string;
  symbol: string;
  side: TxSide;
  productType: PaperProductType;
  quantity: number;
  fillPrice: number;
  fillTickAt: Date;
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
  linkedOpinionId: string | null;
  createdAt: Date;
}

export type PlaceOrderResult =
  | { ok: true; order: PlacedOrder }
  | { ok: false; status: 400 | 422 | 502; reason: string };

/**
 * Places and immediately fills one BUY/SELL leg for `userId`'s ACTIVE account.
 *
 * Known limitation (documented, not silently ignored): validation reads the
 * account's cash/holdings, THEN writes the order — two truly concurrent requests
 * for the same account (e.g. a double-click racing itself) could both pass
 * validation against the same pre-write snapshot and together overspend. Real
 * discount-broker OMSes solve this with row-level order-book locking; Phase 1
 * paper-trading volumes (a single retail user, single-digit trades/day) make this
 * an acceptable, explicitly-flagged gap rather than a reason to add locking
 * infrastructure — see packages/business-rules/src/papertrading/replay.ts's own
 * "don't over-engineer" note for the same judgment call applied to holdings replay.
 */
export async function placeOrder(userId: string, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  if (!isNseWeekdayMarketHours()) {
    return {
      ok: false,
      status: 422,
      reason: "Orders can only be placed during NSE market hours (Mon-Fri, 09:15-15:30 IST)."
    };
  }

  if (input.linkedOpinionId) {
    const opinion = await prisma.expertOpinion.findUnique({ where: { id: input.linkedOpinionId }, select: { id: true } });
    if (!opinion) {
      return { ok: false, status: 422, reason: "The linked call could not be found." };
    }
  }

  const ltp = await fetchDelayedLtp(input.symbol);
  if (!ltp) {
    return { ok: false, status: 502, reason: `No live price available for ${input.symbol} right now — try again shortly.` };
  }

  const account = await getOrCreateActiveAccount(userId);

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as PaperEngineOrder[];

  if (input.productType === "DELIVERY" && input.side === "SELL") {
    const heldQty = deriveDeliveryHoldings(existingOrders).find((h) => h.symbol === input.symbol)?.quantity ?? 0;
    if (input.quantity > heldQty) {
      return {
        ok: false,
        status: 422,
        reason: `Insufficient DELIVERY holdings: you hold ${heldQty} share(s) of ${input.symbol}, requested to sell ${input.quantity}. Delivery short-selling isn't allowed — for a bearish view, use an INTRADAY sell instead.`
      };
    }
  }

  const isFirstSell =
    input.productType === "DELIVERY" && input.side === "SELL"
      ? isFirstDeliverySellOfScripToday(existingOrders, input.symbol, new Date())
      : false;

  const costs = computeOrderCosts({
    side: input.side,
    productType: input.productType,
    quantity: input.quantity,
    price: ltp.price,
    isFirstDeliverySellOfScripToday: isFirstSell
  });

  if (input.side === "BUY") {
    const cash = deriveCash(account.startingCapital, existingOrders);
    if (costs.netAmount > cash) {
      return {
        ok: false,
        status: 422,
        reason: `Insufficient cash: this order needs ₹${costs.netAmount.toFixed(2)} including costs, but only ₹${cash.toFixed(2)} is available.`
      };
    }
  }

  const created = await prisma.paperOrder.create({
    data: {
      accountId: account.id,
      symbol: input.symbol,
      side: input.side,
      productType: input.productType,
      quantity: input.quantity,
      fillPrice: ltp.price,
      fillTickAt: ltp.tickAt,
      grossAmount: costs.grossAmount,
      brokerage: costs.brokerage,
      sttAmount: costs.stt,
      exchangeCharge: costs.exchangeCharge,
      sebiFee: costs.sebiFee,
      stampDuty: costs.stampDuty,
      gstAmount: costs.gst,
      dpCharge: costs.dpCharge,
      totalCosts: costs.totalCosts,
      netAmount: costs.netAmount,
      linkedOpinionId: input.linkedOpinionId ?? null
    },
    select: {
      id: true,
      symbol: true,
      side: true,
      productType: true,
      quantity: true,
      fillPrice: true,
      fillTickAt: true,
      grossAmount: true,
      brokerage: true,
      sttAmount: true,
      exchangeCharge: true,
      sebiFee: true,
      stampDuty: true,
      gstAmount: true,
      dpCharge: true,
      totalCosts: true,
      netAmount: true,
      linkedOpinionId: true,
      createdAt: true
    }
  });

  // `productType` is nullable in the DB (Phase 2 relaxed it for INDEX_OPTION
  // rows), but THIS route only ever writes EQUITY orders with a real value
  // (input.productType, validated non-null by placePaperOrderSchema above) —
  // the cast reflects that write-path guarantee, not a runtime assumption.
  return { ok: true, order: created as PlacedOrder };
}
