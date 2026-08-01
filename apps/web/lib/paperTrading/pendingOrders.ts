/**
 * Limit Orders (Sprint, 2026-07-26) — pending-order placement/cancel/list
 * orchestration for POST/GET /api/paper-trading/pending-orders and DELETE
 * /api/paper-trading/pending-orders/[id] (T3).
 *
 * A pending order NEVER fills here — placement only validates + blocks +
 * writes a PENDING PaperPendingOrder row. The fill itself happens in
 * apps/api's paper-trading-limit-fill cron (T4), which is the ONLY writer of
 * a PaperOrder row sourced from a limit order — see that cron's module doc
 * for why this is architecturally the right split (apps/web owns
 * session-authenticated placement/cancel; apps/api's crons already own every
 * other unattended PaperOrder write in this domain — square-off, expiry
 * settlement, daily MTM — this is the same convention, not a new one).
 *
 * All pure blocking/validation math lives in
 * packages/business-rules/src/papertrading/{pendingOrders,futuresOrderPlan}.ts;
 * this file is DB orchestration only, mirroring orders.ts's and
 * optionOrders.ts's shape.
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint A, 2026-07-31) extended this
 * file with:
 *   - STOP variant support for EQUITY and OPTION orders (direction-validated
 *     at placement against a fresh live quote — decision 1 of the Sprint A
 *     brief: a wrong-side STOP is always user error and 422s before a row is
 *     ever written).
 *   - A brand-new FUTURE branch — index-futures pending orders (LIMIT and
 *     STOP, either side) didn't exist before this sprint. Margin-headroom
 *     classification/validation is delegated to the shared pure
 *     `planFuturesOrderFill` (packages/business-rules/src/papertrading/
 *     futuresOrderPlan.ts) — the SAME function the market-order path
 *     (futuresOrders.ts) and the fill-check cron (apps/api's
 *     limitOrderFill.ts) both consume, so the classification/margin logic is
 *     never forked across the three call sites.
 */

import {
  computePendingBlockAmount,
  derivePendingBlockedCash,
  derivePendingBlockedQuantity,
  type PendingEngineOrder
} from "@predict-future/business-rules/papertrading/pendingOrders";
import { computePendingFuturesBlockAmount, planFuturesOrderFill } from "@predict-future/business-rules/papertrading/futuresOrderPlan";
import { formatNseExpiryDate, formatOptionContractSymbol, parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { formatFuturesContractSymbol } from "@predict-future/business-rules/papertrading/futuresContract";
import {
  deriveCash,
  deriveDeliveryHoldings,
  deriveOpenFuturesPositions,
  deriveOptionPositions,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import type {
  PaperInstrumentKind,
  PaperOptionType,
  PaperProductType,
  PendingOrderStatus,
  PendingOrderVariant,
  TxSide
} from "@prisma/client";

import { getOrCreateActiveAccount } from "@/lib/paperTrading/account";
import { isIndexUnderlyingServer, isTradableOptionUnderlyingServer } from "@/lib/paperTrading/fnoUniverseServer";
import { fetchDelayedLtp } from "@/lib/paperTrading/ltp";
import { fetchOptionChainSnapshot, findOptionQuote } from "@/lib/paperTrading/optionQuote";
import { fetchFuturesQuoteServer, findFuturesContractQuote } from "@/lib/paperTrading/futuresQuote";
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
  lotSize: true,
  isDailyMtm: true
} as const;

/** Selection shape mapping directly onto packages/business-rules' PendingEngineOrder — used everywhere a caller needs live block totals (this file, orders.ts, optionOrders.ts, futuresOrders.ts, queries.ts). */
const PENDING_ENGINE_SELECT = {
  instrumentKind: true,
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  status: true,
  blockedAmount: true
} as const;

/**
 * Fetches every currently-PENDING order for an account, in the shape the
 * pure derivePendingBlockedCash/derivePendingBlockedQuantity functions need.
 * Exported so EVERY order-placement path in this app (equity market orders,
 * option market orders, futures market orders, and this file's own
 * pending-order placement) can subtract live blocks with one shared query
 * shape — the T3 regression requirement that a market order must see a
 * pending limit/stop order's block, extended by Sprint A to futures.
 */
export async function fetchActivePendingOrders(accountId: string): Promise<PendingEngineOrder[]> {
  const rows = await prisma.paperPendingOrder.findMany({
    where: { accountId, status: "PENDING" },
    select: PENDING_ENGINE_SELECT
  });
  return rows as unknown as PendingEngineOrder[];
}

/**
 * Chart Trading + SL/TP (Sprint C) — the same live-block query as
 * `fetchActivePendingOrders` above, with one row excluded at the WHERE-clause
 * level. This is `repricePendingOrder`'s implementation of decision 2's
 * invariant (Sprint A's engine section 42): a row being repriced must never
 * appear to block against itself. Excluding it in the SQL query (rather than
 * fetching everything and filtering in memory) gives the exact same result
 * the proven pure-math invariant describes, with one fewer round trip.
 */
async function fetchActivePendingOrdersExcluding(accountId: string, excludeId: string): Promise<PendingEngineOrder[]> {
  const rows = await prisma.paperPendingOrder.findMany({
    where: { accountId, status: "PENDING", id: { not: excludeId } },
    select: PENDING_ENGINE_SELECT
  });
  return rows as unknown as PendingEngineOrder[];
}

/**
 * Chart Trading + SL/TP (Sprint A) — validates a STOP order's direction
 * against a freshly-fetched current quote (decision 1: a wrong-side stop is
 * always user error, never a silently-accepted no-op order). A STOP SELL
 * (stop-loss on a long, or a breakdown-entry short) must trigger BELOW the
 * current price; a STOP BUY (breakout entry, or a short's stop-loss) must
 * trigger ABOVE it. Both boundaries are strict (equal-to-current is rejected
 * too — an order that would trigger immediately isn't meaningfully a
 * "stop").
 */
function validateStopDirection(
  side: TxSide,
  triggerPrice: number,
  currentQuote: number
): { ok: true } | { ok: false; reason: string } {
  if (side === "SELL" && triggerPrice >= currentQuote) {
    return {
      ok: false,
      reason: `A STOP SELL's trigger (₹${triggerPrice.toFixed(2)}) must be below the current quote (₹${currentQuote.toFixed(2)}) — a stop-loss protects against the price falling, so the trigger has to sit below where the price is right now.`
    };
  }
  if (side === "BUY" && triggerPrice <= currentQuote) {
    return {
      ok: false,
      reason: `A STOP BUY's trigger (₹${triggerPrice.toFixed(2)}) must be above the current quote (₹${currentQuote.toFixed(2)}) — a breakout/stop-buy only makes sense above where the price is right now.`
    };
  }
  return { ok: true };
}

/**
 * Chart Trading + SL/TP (Sprint C) — fetches the SAME live quote placement's
 * own STOP-direction check would fetch for this row's instrumentKind
 * (fetchDelayedLtp for EQUITY, the option-chain snapshot's lastPrice for
 * INDEX_OPTION/STOCK_OPTION, the futures quote for INDEX_FUTURE) — used only
 * by `repricePendingOrder`'s STOP-direction re-validation (decision 2: a
 * reprice re-runs the FULL placement validation, and a STOP's direction check
 * is part of that). Returns `null` on any missing-data case (never throws) so
 * the caller can surface an honest 502, matching placement's own posture.
 */
async function resolveCurrentQuoteForReprice(row: {
  instrumentKind: PaperInstrumentKind;
  symbol: string;
  underlyingSymbol: string | null;
  optionType: PaperOptionType | null;
  strikePrice: number | null;
  expiryDate: Date | null;
}): Promise<number | null> {
  if (row.instrumentKind === "EQUITY") {
    const ltp = await fetchDelayedLtp(row.symbol);
    return ltp?.price ?? null;
  }
  if (!row.underlyingSymbol || !row.expiryDate) return null;
  const expiryNse = formatNseExpiryDate(row.expiryDate);
  if (row.instrumentKind === "INDEX_OPTION" || row.instrumentKind === "STOCK_OPTION") {
    if (row.strikePrice == null || !row.optionType) return null;
    const snapshot = await fetchOptionChainSnapshot(row.underlyingSymbol, expiryNse);
    if (!snapshot) return null;
    const quote = findOptionQuote(snapshot, row.strikePrice, row.optionType);
    return quote?.lastPrice != null && quote.lastPrice > 0 ? quote.lastPrice : null;
  }
  // INDEX_FUTURE
  const quote = await fetchFuturesQuoteServer(row.underlyingSymbol);
  if (!quote) return null;
  const contract = findFuturesContractQuote(quote, expiryNse);
  return contract?.price ?? null;
}

export interface PlacePendingEquityOrderInput {
  orderKind: "EQUITY";
  symbol: string;
  side: TxSide;
  productType: PaperProductType;
  quantity: number;
  /** Chart Trading + SL/TP (Sprint A). Defaults to LIMIT at the zod layer — always present by the time this function runs. */
  variant: PendingOrderVariant;
  /** Required when variant is LIMIT (zod-enforced via the shared discriminated-union superRefine). */
  limitPrice?: number;
  /** Required when variant is STOP. */
  triggerPrice?: number;
  linkedOpinionId?: string;
}

export interface PlacePendingOptionOrderInput {
  orderKind: "OPTION";
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: string;
  side: TxSide;
  lots: number;
  variant: PendingOrderVariant;
  limitPrice?: number;
  triggerPrice?: number;
  linkedOpinionId?: string;
}

/** Chart Trading + SL/TP (Sprint A) — new: futures pending orders (LIMIT and STOP), index-only, mirroring placePaperFuturesOrderSchema's underlying set. No linkedOpinionId — the market-order futures path never had one either. */
export interface PlacePendingFuturesOrderInput {
  orderKind: "FUTURE";
  underlyingSymbol: "NIFTY" | "BANKNIFTY" | "FINNIFTY" | "MIDCPNIFTY" | "NIFTYNXT50";
  expiryDate: string;
  side: TxSide;
  lots: number;
  variant: PendingOrderVariant;
  limitPrice?: number;
  triggerPrice?: number;
}

export type PlacePendingOrderInput = PlacePendingEquityOrderInput | PlacePendingOptionOrderInput | PlacePendingFuturesOrderInput;

export interface PlacedPendingOrder {
  id: string;
  instrumentKind: PaperInstrumentKind;
  symbol: string;
  side: TxSide;
  productType: PaperProductType | null;
  quantity: number;
  limitPrice: number;
  variant: PendingOrderVariant;
  triggerPrice: number | null;
  status: PendingOrderStatus;
  resolutionNote: string | null;
  repricedAt: Date | null;
  blockedAmount: number | null;
  linkedOpinionId: string | null;
  underlyingSymbol: string | null;
  optionType: PaperOptionType | null;
  strikePrice: number | null;
  expiryDate: Date | null;
  lotSize: number | null;
  lots: number | null;
  createdAt: Date;
}

export type PlacePendingOrderResult =
  | { ok: true; order: PlacedPendingOrder }
  | { ok: false; status: 400 | 422 | 502; reason: string };

const PLACED_PENDING_SELECT = {
  id: true,
  instrumentKind: true,
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  limitPrice: true,
  variant: true,
  triggerPrice: true,
  status: true,
  resolutionNote: true,
  repricedAt: true,
  blockedAmount: true,
  linkedOpinionId: true,
  underlyingSymbol: true,
  optionType: true,
  strikePrice: true,
  expiryDate: true,
  lotSize: true,
  lots: true,
  createdAt: true
} as const;

/**
 * Places (never fills) one resting LIMIT or STOP order against `userId`'s
 * ACTIVE account. No market-hours gate for equity/options — a resting order
 * can be queued before/after hours, it simply won't be evaluated by the
 * fill-check cron until the next time it runs during market hours (see
 * limit-fill cron's module doc). Futures orders similarly have no
 * market-hours gate at PLACEMENT (only the market-order path gates on
 * hours, matching the pre-existing precedent that a pending order is queued,
 * not executed, at request time).
 *
 * Cash/quantity/margin blocking happens HERE, at placement (design decision
 * 3 in the Limit Orders schema doc, extended to futures margin by Sprint A's
 * decision 5) — by the time this function returns `ok: true`, the blocked
 * amount/quantity is already visible to every other order-placement path via
 * fetchActivePendingOrders, so a subsequent market or pending order cannot
 * double-spend the same funds/shares/margin.
 */
export async function placePendingOrder(userId: string, input: PlacePendingOrderInput): Promise<PlacePendingOrderResult> {
  if (input.orderKind !== "FUTURE" && input.linkedOpinionId) {
    const opinion = await prisma.expertOpinion.findUnique({ where: { id: input.linkedOpinionId }, select: { id: true } });
    if (!opinion) {
      return { ok: false, status: 422, reason: "The linked call could not be found." };
    }
  }

  const account = await getOrCreateActiveAccount(userId);

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as unknown as PaperEngineOrder[];
  const existingPending = await fetchActivePendingOrders(account.id);

  if (input.orderKind === "EQUITY") {
    const effectivePrice = input.variant === "STOP" ? input.triggerPrice! : input.limitPrice!;

    if (input.variant === "STOP") {
      const ltp = await fetchDelayedLtp(input.symbol);
      if (!ltp) {
        return { ok: false, status: 502, reason: `No live price available for ${input.symbol} right now — try again shortly.` };
      }
      const direction = validateStopDirection(input.side, effectivePrice, ltp.price);
      if (!direction.ok) return { ok: false, status: 422, reason: direction.reason };
    }

    if (input.productType === "DELIVERY" && input.side === "SELL") {
      const heldQty = deriveDeliveryHoldings(existingOrders).find((h) => h.symbol === input.symbol)?.quantity ?? 0;
      const blockedQty = derivePendingBlockedQuantity(existingPending, input.symbol);
      const availableQty = heldQty - blockedQty;
      if (input.quantity > availableQty) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient DELIVERY holdings: you hold ${heldQty} share(s) of ${input.symbol}, ${blockedQty} already reserved by other pending sell orders, ${availableQty} available — requested to sell ${input.quantity}.`
        };
      }
    }

    let blockedAmount: number | null = null;
    if (input.side === "BUY") {
      blockedAmount = computePendingBlockAmount({
        instrumentKind: "EQUITY",
        side: "BUY",
        quantity: input.quantity,
        limitPrice: effectivePrice,
        productType: input.productType
      });
      const cash = deriveCash(account.startingCapital, existingOrders);
      const blockedCash = derivePendingBlockedCash(existingPending);
      const availableCash = cash - blockedCash;
      if ((blockedAmount ?? 0) > availableCash) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient cash: this order would need ₹${(blockedAmount ?? 0).toFixed(2)} to be blocked, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} already blocked by other pending orders).`
        };
      }
    }

    const created = await prisma.paperPendingOrder.create({
      data: {
        accountId: account.id,
        instrumentKind: "EQUITY",
        symbol: input.symbol,
        side: input.side,
        productType: input.productType,
        quantity: input.quantity,
        limitPrice: effectivePrice,
        variant: input.variant,
        triggerPrice: input.variant === "STOP" ? effectivePrice : null,
        blockedAmount,
        linkedOpinionId: input.linkedOpinionId ?? null
      },
      select: PLACED_PENDING_SELECT
    });
    return { ok: true, order: created as PlacedPendingOrder };
  }

  if (input.orderKind === "OPTION") {
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

    // A live chain fetch is needed here to snapshot lotSize (never to price a
    // LIMIT order — the limit price is user-specified) AND, for a STOP order,
    // to read the current premium for direction validation — same fetch
    // covers both needs, no extra round trip.
    const snapshot = await fetchOptionChainSnapshot(input.underlyingSymbol, input.expiryDate);
    if (!snapshot || !snapshot.lotSize || snapshot.lotSize <= 0) {
      return {
        ok: false,
        status: 502,
        reason: `Lot size unavailable for this contract right now — try again shortly.`
      };
    }
    const lotSize = snapshot.lotSize;
    const quantity = input.lots * lotSize;
    const symbol = formatOptionContractSymbol(input.underlyingSymbol, input.strikePrice, input.optionType, expiryDate);

    const effectivePrice = input.variant === "STOP" ? input.triggerPrice! : input.limitPrice!;

    if (input.variant === "STOP") {
      const quote = findOptionQuote(snapshot, input.strikePrice, input.optionType);
      const currentPremium = quote?.lastPrice;
      if (currentPremium == null || currentPremium <= 0) {
        return {
          ok: false,
          status: 502,
          reason: `No live premium available for this contract right now — try again shortly.`
        };
      }
      const direction = validateStopDirection(input.side, effectivePrice, currentPremium);
      if (!direction.ok) return { ok: false, status: 422, reason: direction.reason };
    }

    if (input.side === "SELL") {
      const matching = deriveOptionPositions(existingOrders).find(
        (p) =>
          p.underlyingSymbol === input.underlyingSymbol &&
          p.strikePrice === input.strikePrice &&
          p.optionType === input.optionType &&
          p.expiryDate.getTime() === expiryDate.getTime()
      );
      const heldQuantity = matching?.quantity ?? 0;
      const blockedQuantity = derivePendingBlockedQuantity(existingPending, symbol);
      const availableQuantity = heldQuantity - blockedQuantity;
      if (quantity > availableQuantity) {
        const heldLots = matching?.lots ?? 0;
        return {
          ok: false,
          status: 422,
          reason:
            heldLots > 0
              ? `You hold ${heldLots} lot(s) of this contract, ${(blockedQuantity / lotSize).toFixed(2)} already reserved by other pending sell orders — can't queue a sell for ${input.lots}.`
              : `You don't hold this contract — writing/selling options isn't offered here. SELL can only close an existing long position.`
        };
      }
    }

    let blockedAmount: number | null = null;
    if (input.side === "BUY") {
      blockedAmount = computePendingBlockAmount({
        instrumentKind,
        side: "BUY",
        quantity,
        limitPrice: effectivePrice
      });
      const cash = deriveCash(account.startingCapital, existingOrders);
      const blockedCash = derivePendingBlockedCash(existingPending);
      const availableCash = cash - blockedCash;
      if ((blockedAmount ?? 0) > availableCash) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient cash: this order would need ₹${(blockedAmount ?? 0).toFixed(2)} to be blocked, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} already blocked by other pending orders).`
        };
      }
    }

    const created = await prisma.paperPendingOrder.create({
      data: {
        accountId: account.id,
        instrumentKind,
        symbol,
        side: input.side,
        productType: null,
        quantity,
        limitPrice: effectivePrice,
        variant: input.variant,
        triggerPrice: input.variant === "STOP" ? effectivePrice : null,
        blockedAmount,
        linkedOpinionId: input.linkedOpinionId ?? null,
        underlyingSymbol: input.underlyingSymbol,
        optionType: input.optionType,
        strikePrice: input.strikePrice,
        expiryDate,
        lotSize,
        lots: input.lots
      },
      select: PLACED_PENDING_SELECT
    });
    return { ok: true, order: created as PlacedPendingOrder };
  }

  // ── FUTURE (INDEX_FUTURE) — Chart Trading + SL/TP (Sprint A) ────────────
  const expiryDate = parseNseExpiryDate(input.expiryDate);
  if (!expiryDate) {
    return { ok: false, status: 400, reason: "Invalid expiry date." };
  }

  const quote = await fetchFuturesQuoteServer(input.underlyingSymbol);
  if (!quote) {
    return {
      ok: false,
      status: 502,
      reason: `No live or derived futures price available for ${input.underlyingSymbol} right now — try again shortly.`
    };
  }

  const contract = findFuturesContractQuote(quote, input.expiryDate);
  if (!contract || !contract.lotSize || contract.lotSize <= 0) {
    return {
      ok: false,
      status: 502,
      reason:
        quote.source === "PCP_DERIVED"
          ? `Only the near-month contract (${quote.expiry}) has a derived price right now — the option-chain fallback can't price other months. Try the near-month contract, or again shortly.`
          : `No live price or lot size available for that contract right now — try again shortly.`
    };
  }
  const lotSize = contract.lotSize;
  const effectivePrice = input.variant === "STOP" ? input.triggerPrice! : input.limitPrice!;

  if (input.variant === "STOP") {
    const direction = validateStopDirection(input.side, effectivePrice, contract.price);
    if (!direction.ok) return { ok: false, status: 422, reason: direction.reason };
  }

  const cash = deriveCash(account.startingCapital, existingOrders);
  const openFuturesPositions = deriveOpenFuturesPositions(existingOrders);
  const pendingBlockedMargin = derivePendingBlockedCash(existingPending);

  const plan = planFuturesOrderFill({
    underlyingSymbol: input.underlyingSymbol,
    expiryDate,
    side: input.side,
    lots: input.lots,
    lotSize,
    contractPrice: effectivePrice,
    cash,
    openFuturesPositions,
    pendingBlockedMargin
  });

  if (!plan.ok) {
    return { ok: false, status: plan.status, reason: plan.reason };
  }

  const symbol = formatFuturesContractSymbol(input.underlyingSymbol, expiryDate);
  let blockedAmount: number | null = null;

  if (plan.plan.isOpeningOrAdding) {
    blockedAmount = computePendingFuturesBlockAmount({ side: input.side, quantity: plan.plan.quantity, price: effectivePrice });
  } else {
    // Sprint A decision 6 regression: planFuturesOrderFill's own close-cap
    // check only sees the STATIC held position (matching the market-order
    // path exactly, by design — see that function's module doc). A pending
    // order additionally needs to respect LOTS already reserved by OTHER
    // resting pending close orders on this exact contract/side, or two
    // pending close orders placed back-to-back could jointly over-close a
    // position neither alone would exceed.
    const blockedClosingQty = derivePendingBlockedQuantity(existingPending, symbol, input.side);
    const blockedClosingLots = blockedClosingQty / lotSize;
    const availableLots = plan.plan.heldLots - blockedClosingLots;
    if (input.lots > availableLots) {
      return {
        ok: false,
        status: 422,
        reason: `You hold ${plan.plan.heldLots} lot(s) of this contract, ${blockedClosingLots.toFixed(2)} already reserved by other pending close orders, ${availableLots.toFixed(2)} available — can't queue a close for ${input.lots}.`
      };
    }
  }

  const created = await prisma.paperPendingOrder.create({
    data: {
      accountId: account.id,
      instrumentKind: "INDEX_FUTURE",
      symbol,
      side: input.side,
      productType: null,
      quantity: plan.plan.quantity,
      limitPrice: effectivePrice,
      variant: input.variant,
      triggerPrice: input.variant === "STOP" ? effectivePrice : null,
      blockedAmount,
      linkedOpinionId: null,
      underlyingSymbol: input.underlyingSymbol,
      optionType: null,
      strikePrice: null,
      expiryDate,
      lotSize,
      lots: input.lots
    },
    select: PLACED_PENDING_SELECT
  });
  return { ok: true, order: created as PlacedPendingOrder };
}

export type CancelPendingOrderResult =
  | { ok: true; order: PlacedPendingOrder }
  | { ok: false; status: 404 | 409; reason: string };

/**
 * Cancels a PENDING order — an UPDATE, not a compensating transaction,
 * because the block was always DERIVED (a live query over PENDING rows, see
 * fetchActivePendingOrders), never a separately-written ledger entry. The
 * instant this row's status flips away from PENDING, every other
 * order-placement path stops counting it.
 */
export async function cancelPendingOrder(userId: string, pendingOrderId: string): Promise<CancelPendingOrderResult> {
  const account = await getOrCreateActiveAccount(userId);
  const row = await prisma.paperPendingOrder.findUnique({ where: { id: pendingOrderId } });
  if (!row || row.accountId !== account.id) {
    return { ok: false, status: 404, reason: "Pending order not found." };
  }
  if (row.status !== "PENDING") {
    return { ok: false, status: 409, reason: `This order is already ${row.status.toLowerCase()} — it can't be cancelled.` };
  }

  const updated = await prisma.paperPendingOrder.update({
    where: { id: pendingOrderId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    select: PLACED_PENDING_SELECT
  });
  return { ok: true, order: updated as PlacedPendingOrder };
}

export interface RepricePendingOrderInput {
  /** New price for a LIMIT row. Ignored (must be omitted) for a STOP row — see the row's own `variant` field, which is the sole authority on which one is required. */
  limitPrice?: number;
  /** New price for a STOP row. */
  triggerPrice?: number;
}

export type RepricePendingOrderResult =
  | { ok: true; order: PlacedPendingOrder }
  | { ok: false; status: 400 | 404 | 409 | 422 | 502; reason: string };

/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint C) — drag-to-reprice's server
 * half (decisions 1/2 of the Sprint C brief; this endpoint did NOT exist
 * before this sprint, see project_chart_trading_sl_tp_sprint_a.md's
 * "explicitly NOT built this sprint" note). ATOMIC in-place update, never
 * cancel-then-recreate — a cancel+recreate window is a real gap where this
 * row's block briefly vanishes from the account's totals, during which a
 * concurrently-placed market order could see artificially-inflated
 * availability and overspend; an atomic PATCH has no such window, and
 * preserves the row's identity across the reprice (the chart's optimistic UI
 * keeps the same line `id` through a drag rather than flickering).
 *
 * Re-runs the FULL placement validation for this row's `instrumentKind` —
 * STOP direction check, then cash/margin/holdings sufficiency — with the row
 * EXCLUDED from its own blocked-totals sum (fetchActivePendingOrdersExcluding
 * above), which is exactly the invariant Sprint A's engine section 42 proves:
 * a repriced row's excluded-self blocked total is arithmetically identical to
 * what a fresh placement would see as its own "already blocked by others"
 * baseline. This function is a thin I/O wrapper around that proven pure
 * math — no new engine logic is introduced here, per the Sprint C brief's
 * explicit scope boundary.
 *
 * Side/quantity/lots/underlying/contract identity are NEVER mutated here —
 * only `limitPrice`/`triggerPrice` (whichever the row's own `variant`
 * requires) and the derived `blockedAmount`. On success, stamps
 * `repricedAt = now()`. On failure, returns the same 422 vocabulary as
 * placement (or 400/404/409 for request-shape/ownership/status problems) —
 * the caller (the chart's optimistic drag) is expected to revert the line to
 * its pre-drag price on any non-2xx response with a visible toast, never
 * leave the line showing a price the server rejected.
 */
export async function repricePendingOrder(
  userId: string,
  pendingOrderId: string,
  input: RepricePendingOrderInput
): Promise<RepricePendingOrderResult> {
  const account = await getOrCreateActiveAccount(userId);
  const row = await prisma.paperPendingOrder.findUnique({ where: { id: pendingOrderId } });
  if (!row || row.accountId !== account.id) {
    return { ok: false, status: 404, reason: "Pending order not found." };
  }
  if (row.status !== "PENDING") {
    return { ok: false, status: 409, reason: `This order is already ${row.status.toLowerCase()} — it can't be repriced.` };
  }

  const newPrice = row.variant === "STOP" ? input.triggerPrice : input.limitPrice;
  if (newPrice == null) {
    return {
      ok: false,
      status: 400,
      reason:
        row.variant === "STOP"
          ? "triggerPrice is required to reprice a STOP order."
          : "limitPrice is required to reprice a LIMIT order."
    };
  }

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as unknown as PaperEngineOrder[];
  const existingPendingExcludingSelf = await fetchActivePendingOrdersExcluding(account.id, row.id);

  if (row.variant === "STOP") {
    const currentQuote = await resolveCurrentQuoteForReprice(row);
    if (currentQuote == null) {
      return { ok: false, status: 502, reason: "No live price available for this instrument right now — try again shortly." };
    }
    const direction = validateStopDirection(row.side, newPrice, currentQuote);
    if (!direction.ok) return { ok: false, status: 422, reason: direction.reason };
  }

  let blockedAmount: number | null = null;

  if (row.instrumentKind === "EQUITY") {
    if (row.side === "BUY") {
      blockedAmount = computePendingBlockAmount({
        instrumentKind: "EQUITY",
        side: "BUY",
        quantity: row.quantity,
        limitPrice: newPrice,
        productType: row.productType
      });
      const cash = deriveCash(account.startingCapital, existingOrders);
      const blockedCash = derivePendingBlockedCash(existingPendingExcludingSelf);
      const availableCash = cash - blockedCash;
      if ((blockedAmount ?? 0) > availableCash) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient cash: repricing this order would need ₹${(blockedAmount ?? 0).toFixed(2)} to be blocked, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} already blocked by other pending orders).`
        };
      }
    } else if (row.productType === "DELIVERY") {
      const heldQty = deriveDeliveryHoldings(existingOrders).find((h) => h.symbol === row.symbol)?.quantity ?? 0;
      const blockedQty = derivePendingBlockedQuantity(existingPendingExcludingSelf, row.symbol);
      const availableQty = heldQty - blockedQty;
      if (row.quantity > availableQty) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient DELIVERY holdings to keep this order resting: you hold ${heldQty} share(s) of ${row.symbol}, ${blockedQty} already reserved by other pending sell orders, ${availableQty} available — this order needs ${row.quantity}.`
        };
      }
    }
  } else if (row.instrumentKind === "INDEX_OPTION" || row.instrumentKind === "STOCK_OPTION") {
    if (row.side === "BUY") {
      blockedAmount = computePendingBlockAmount({
        instrumentKind: row.instrumentKind,
        side: "BUY",
        quantity: row.quantity,
        limitPrice: newPrice
      });
      const cash = deriveCash(account.startingCapital, existingOrders);
      const blockedCash = derivePendingBlockedCash(existingPendingExcludingSelf);
      const availableCash = cash - blockedCash;
      if ((blockedAmount ?? 0) > availableCash) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient cash: repricing this order would need ₹${(blockedAmount ?? 0).toFixed(2)} to be blocked, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} already blocked by other pending orders).`
        };
      }
    } else {
      const matching = deriveOptionPositions(existingOrders).find(
        (p) =>
          p.underlyingSymbol === row.underlyingSymbol &&
          p.strikePrice === row.strikePrice &&
          p.optionType === row.optionType &&
          row.expiryDate != null &&
          p.expiryDate.getTime() === row.expiryDate.getTime()
      );
      const heldQuantity = matching?.quantity ?? 0;
      const blockedQuantity = derivePendingBlockedQuantity(existingPendingExcludingSelf, row.symbol);
      const availableQuantity = heldQuantity - blockedQuantity;
      if (row.quantity > availableQuantity) {
        const heldLots = matching?.lots ?? 0;
        return {
          ok: false,
          status: 422,
          reason: `You hold ${heldLots} lot(s) of this contract, ${(blockedQuantity / (row.lotSize ?? 1)).toFixed(2)} already reserved by other pending sell orders — this order needs ${row.lots ?? 0}.`
        };
      }
    }
  } else {
    // INDEX_FUTURE
    if (!row.underlyingSymbol || !row.expiryDate || !row.lotSize || !row.lots) {
      return { ok: false, status: 400, reason: "This futures order is missing contract details required to reprice it." };
    }
    const cash = deriveCash(account.startingCapital, existingOrders);
    const openFuturesPositions = deriveOpenFuturesPositions(existingOrders);
    const pendingBlockedMargin = derivePendingBlockedCash(existingPendingExcludingSelf);

    const plan = planFuturesOrderFill({
      underlyingSymbol: row.underlyingSymbol,
      expiryDate: row.expiryDate,
      side: row.side,
      lots: row.lots,
      lotSize: row.lotSize,
      contractPrice: newPrice,
      cash,
      openFuturesPositions,
      pendingBlockedMargin
    });
    if (!plan.ok) {
      return { ok: false, status: plan.status, reason: plan.reason };
    }

    if (plan.plan.isOpeningOrAdding) {
      blockedAmount = computePendingFuturesBlockAmount({ side: row.side, quantity: plan.plan.quantity, price: newPrice });
    } else {
      // Sprint A decision 6's regression, re-applied at reprice time: a
      // closing futures reprice must respect LOTS already reserved by OTHER
      // resting pending close orders on this exact contract/side, excluding
      // itself — mirrors placement's identical check.
      const blockedClosingQty = derivePendingBlockedQuantity(existingPendingExcludingSelf, row.symbol, row.side);
      const blockedClosingLots = blockedClosingQty / row.lotSize;
      const availableLots = plan.plan.heldLots - blockedClosingLots;
      if (row.lots > availableLots) {
        return {
          ok: false,
          status: 422,
          reason: `You hold ${plan.plan.heldLots} lot(s) of this contract, ${blockedClosingLots.toFixed(2)} already reserved by other pending close orders, ${availableLots.toFixed(2)} available — this order needs ${row.lots}.`
        };
      }
    }
  }

  const updated = await prisma.paperPendingOrder.update({
    where: { id: pendingOrderId },
    data: {
      limitPrice: newPrice,
      triggerPrice: row.variant === "STOP" ? newPrice : null,
      blockedAmount,
      repricedAt: new Date()
    },
    select: PLACED_PENDING_SELECT
  });
  return { ok: true, order: updated as PlacedPendingOrder };
}

/**
 * Lists an already-resolved account's currently-PENDING orders PLUS any
 * REJECTED ones, newest first — the shared query behind both
 * listPendingOrders (below) and getAccountDetail (queries.ts), which already
 * has the account row and shouldn't re-resolve it.
 *
 * Chart Trading + SL/TP (Sprint B, B5) — widened from `status: "PENDING"`
 * alone to also include REJECTED: a rejected STOP is a trust-critical event
 * (the user placed a real risk-management order and it silently didn't do
 * what they expected — see the Sprint B brief's decision 7) and MUST surface
 * with its `resolutionNote` in the same "Pending orders" panel, not require
 * digging through order history. REJECTED rows have no dismiss/prune path
 * yet (the schema has no `resolvedAt`/`rejectedAt` timestamp to bound a
 * window on) — flagged as a follow-up for whichever sprint adds a "dismiss"
 * action, not a correctness bug: REJECTED is expected to stay rare (it only
 * fires on fill-time cash/margin/holdings infeasibility).
 */
export async function listPendingOrdersForAccount(accountId: string): Promise<PlacedPendingOrder[]> {
  const rows = await prisma.paperPendingOrder.findMany({
    where: { accountId, status: { in: ["PENDING", "REJECTED"] } },
    orderBy: { createdAt: "desc" },
    select: PLACED_PENDING_SELECT
  });
  return rows as PlacedPendingOrder[];
}

/** Lists the caller's currently-PENDING (+ REJECTED, see above) orders, newest first — backs the "Pending orders" UI section (T6/T7). */
export async function listPendingOrders(userId: string): Promise<PlacedPendingOrder[]> {
  const account = await getOrCreateActiveAccount(userId);
  return listPendingOrdersForAccount(account.id);
}
