/**
 * Paper Trading Phase 2 (index options) + Phase 3 (stock options) — option
 * order placement orchestration for POST /api/paper-trading/options/orders
 * (T5).
 *
 * Same synchronous-fill contract as Phase 1's equity orders.ts: no PENDING
 * state, the response IS the fill confirmation. All pure cost/validation math
 * lives in packages/business-rules/src/papertrading/{optionsCosts,replay}.ts;
 * this file is DB + upstream-chain orchestration only.
 *
 * Long-only enforcement point (per the Phase 2 brief's scope decision — no
 * writing/selling options, unchanged posture for Phase 3 stock options): a
 * SELL is accepted ONLY when it closes part or all of an EXISTING long
 * holding of the exact same contract key (underlyingSymbol + strikePrice +
 * expiryDate + optionType). There is no code path anywhere in this file that
 * can open a new short position.
 *
 * Phase 3 widening: `underlyingSymbol` is no longer restricted to NIFTY/
 * BANKNIFTY — any live member of the F&O stock universe is accepted, checked
 * via isTradableOptionUnderlying (never a hardcoded stock allowlist).
 * `instrumentKind` is set conditionally: INDEX_OPTION for NIFTY/BANKNIFTY,
 * STOCK_OPTION for a validated stock symbol. Cost computation
 * (computeOptionOrderCosts) and every other validation step below are
 * UNCHANGED — they were never underlying-specific.
 */

import { computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatOptionContractSymbol, parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import {
  deriveCash,
  deriveOptionPositions,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import { derivePendingBlockedCash, derivePendingBlockedQuantity } from "@predict-future/business-rules/papertrading/pendingOrders";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import type { TxSide } from "@prisma/client";

import { getOrCreateActiveAccount } from "@/lib/paperTrading/account";
import { fetchOptionChainSnapshot, findOptionQuote } from "@/lib/paperTrading/optionQuote";
import { isIndexUnderlyingServer, isTradableOptionUnderlyingServer } from "@/lib/paperTrading/fnoUniverseServer";
import { fetchActivePendingOrders } from "@/lib/paperTrading/pendingOrders";
import { prisma } from "@/lib/prisma";

const ENGINE_ORDER_SELECT = {
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  fillPrice: true,
  totalCosts: true,
  netAmount: true,
  createdAt: true,
  instrumentKind: true,
  underlyingSymbol: true,
  optionType: true,
  strikePrice: true,
  expiryDate: true,
  lotSize: true
} as const;

export interface PlaceOptionOrderInput {
  /** Phase 3: widened from "NIFTY" | "BANKNIFTY" to any validated string — see isTradableOptionUnderlyingServer below. */
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  /** NSE's own "DD-MMM-YYYY" expiry string, as returned by GET /api/paper-trading/options/expiries. */
  expiryDate: string;
  side: TxSide;
  lots: number;
  linkedOpinionId?: string;
}

export interface PlacedOptionOrder {
  id: string;
  symbol: string;
  side: TxSide;
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: Date;
  lotSize: number;
  lots: number;
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
  /** Phase 3 — discriminates settlement mechanism downstream (UI badges, which cron will eventually close this). */
  instrumentKind: "INDEX_OPTION" | "STOCK_OPTION";
}

export type PlaceOptionOrderResult =
  | { ok: true; order: PlacedOptionOrder }
  | { ok: false; status: 400 | 422 | 502; reason: string };

/**
 * Places and immediately fills one BUY/SELL option leg (index OR stock, Phase
 * 2/3) for `userId`'s ACTIVE account. See the module doc above for the
 * long-only enforcement point and the Phase 3 underlying-widening notes.
 *
 * Same known-limitation caveat as Phase 1's placeOrder: validation reads
 * cash/holdings, THEN writes the order — an acceptable, explicitly-flagged gap
 * at Phase 1/2/3's single-retail-user trade volumes, not a reason to add
 * row-level order-book locking (see orders.ts's identical note).
 */
export async function placeOptionOrder(userId: string, input: PlaceOptionOrderInput): Promise<PlaceOptionOrderResult> {
  if (!isNseWeekdayMarketHours()) {
    return {
      ok: false,
      status: 422,
      reason: "Orders can only be placed during NSE market hours (Mon-Fri, 09:15-15:30 IST)."
    };
  }

  // Phase 3: reject anything that isn't NIFTY/BANKNIFTY or a live F&O-eligible
  // stock BEFORE any chain fetch is attempted — the T5 acceptance criteria's
  // "rejected with a clear error before any chain fetch" requirement.
  if (!(await isTradableOptionUnderlyingServer(input.underlyingSymbol))) {
    return {
      ok: false,
      status: 400,
      reason: `${input.underlyingSymbol} isn't NIFTY, BANKNIFTY, or a currently F&O-eligible stock — options aren't tradable on this symbol.`
    };
  }
  const instrumentKind: "INDEX_OPTION" | "STOCK_OPTION" = isIndexUnderlyingServer(input.underlyingSymbol)
    ? "INDEX_OPTION"
    : "STOCK_OPTION";

  const expiryDate = parseNseExpiryDate(input.expiryDate);
  if (!expiryDate) {
    return { ok: false, status: 400, reason: "Invalid expiry date." };
  }

  if (input.linkedOpinionId) {
    const opinion = await prisma.expertOpinion.findUnique({ where: { id: input.linkedOpinionId }, select: { id: true } });
    if (!opinion) {
      return { ok: false, status: 422, reason: "The linked call could not be found." };
    }
  }

  const snapshot = await fetchOptionChainSnapshot(input.underlyingSymbol, input.expiryDate);
  if (!snapshot) {
    return {
      ok: false,
      status: 502,
      reason: `No live option chain available for ${input.underlyingSymbol} right now — try again shortly.`
    };
  }
  if (!snapshot.lotSize || snapshot.lotSize <= 0) {
    return {
      ok: false,
      status: 502,
      reason: `Lot size unavailable for this contract right now — try again shortly.`
    };
  }

  const quote = findOptionQuote(snapshot, input.strikePrice, input.optionType);
  const premium = quote?.lastPrice;
  if (premium == null || premium <= 0) {
    return {
      ok: false,
      status: 502,
      reason: `No live premium available for this contract right now — try again shortly.`
    };
  }

  const lotSize = snapshot.lotSize;
  const quantity = input.lots * lotSize;
  const symbol = formatOptionContractSymbol(input.underlyingSymbol, input.strikePrice, input.optionType, expiryDate);

  const account = await getOrCreateActiveAccount(userId);

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as unknown as PaperEngineOrder[];

  // Limit Orders (Sprint, 2026-07-26) — T3 regression requirement: see
  // orders.ts's identical comment. A pending limit order on this exact
  // contract must be respected by this market-order path too.
  const existingPending = await fetchActivePendingOrders(account.id);

  if (input.side === "SELL") {
    // Long-only enforcement: a SELL is only ever a closing leg against an
    // existing long of this EXACT contract — never a naked write.
    const matching = deriveOptionPositions(existingOrders).find(
      (p) =>
        p.underlyingSymbol === input.underlyingSymbol &&
        p.strikePrice === input.strikePrice &&
        p.optionType === input.optionType &&
        p.expiryDate.getTime() === expiryDate.getTime()
    );
    const heldLots = matching?.lots ?? 0;
    const blockedQuantity = derivePendingBlockedQuantity(existingPending, symbol);
    const availableQuantity = (matching?.quantity ?? 0) - blockedQuantity;
    if (!matching || quantity > availableQuantity) {
      return {
        ok: false,
        status: 422,
        reason:
          heldLots > 0
            ? blockedQuantity > 0
              ? `You hold ${heldLots} lot(s) of this contract, ${(blockedQuantity / lotSize).toFixed(2)} already reserved by pending limit sell orders — can't sell ${input.lots}.`
              : `You hold ${heldLots} lot(s) of this contract — can't sell ${input.lots}. Writing/selling options beyond an existing long isn't offered.`
            : `You don't hold this contract — writing/selling options isn't offered here. SELL can only close an existing long position.`
      };
    }
  }

  const costs = computeOptionOrderCosts({ side: input.side, quantity, price: premium });

  if (input.side === "BUY") {
    const cash = deriveCash(account.startingCapital, existingOrders);
    const blockedCash = derivePendingBlockedCash(existingPending);
    const availableCash = cash - blockedCash;
    if (costs.netAmount > availableCash) {
      return {
        ok: false,
        status: 422,
        reason:
          blockedCash > 0
            ? `Insufficient cash: this order needs ₹${costs.netAmount.toFixed(2)} including costs, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} blocked by pending limit orders).`
            : `Insufficient cash: this order needs ₹${costs.netAmount.toFixed(2)} including costs, but only ₹${cash.toFixed(2)} is available.`
      };
    }
  }

  const fillTickAt = snapshot.asOf ?? new Date();

  const created = await prisma.paperOrder.create({
    data: {
      accountId: account.id,
      symbol,
      side: input.side,
      productType: null,
      quantity,
      fillPrice: premium,
      fillTickAt,
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
      linkedOpinionId: input.linkedOpinionId ?? null,
      instrumentKind,
      underlyingSymbol: input.underlyingSymbol,
      optionType: input.optionType,
      strikePrice: input.strikePrice,
      expiryDate,
      lotSize,
      lots: input.lots
    },
    select: {
      id: true,
      symbol: true,
      side: true,
      underlyingSymbol: true,
      optionType: true,
      strikePrice: true,
      expiryDate: true,
      lotSize: true,
      lots: true,
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
      createdAt: true,
      instrumentKind: true
    }
  });

  return { ok: true, order: created as unknown as PlacedOptionOrder };
}
