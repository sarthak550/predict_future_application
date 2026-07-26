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
 * packages/business-rules/src/papertrading/pendingOrders.ts; this file is DB
 * orchestration only, mirroring orders.ts's and optionOrders.ts's shape.
 */

import {
  computePendingBlockAmount,
  derivePendingBlockedCash,
  derivePendingBlockedQuantity,
  type PendingEngineOrder
} from "@predict-future/business-rules/papertrading/pendingOrders";
import { formatOptionContractSymbol, parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import {
  deriveCash,
  deriveDeliveryHoldings,
  deriveOptionPositions,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import type { PaperInstrumentKind, PaperOptionType, PaperProductType, PendingOrderStatus, TxSide } from "@prisma/client";

import { getOrCreateActiveAccount } from "@/lib/paperTrading/account";
import { isIndexUnderlyingServer, isTradableOptionUnderlyingServer } from "@/lib/paperTrading/fnoUniverseServer";
import { fetchOptionChainSnapshot } from "@/lib/paperTrading/optionQuote";
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

/** Selection shape mapping directly onto packages/business-rules' PendingEngineOrder — used everywhere a caller needs live block totals (this file, orders.ts, optionOrders.ts, queries.ts). */
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
 * option market orders, and this file's own pending-order placement) can
 * subtract live blocks with one shared query shape — the T3 regression
 * requirement that a market order must see a pending limit order's block.
 */
export async function fetchActivePendingOrders(accountId: string): Promise<PendingEngineOrder[]> {
  const rows = await prisma.paperPendingOrder.findMany({
    where: { accountId, status: "PENDING" },
    select: PENDING_ENGINE_SELECT
  });
  return rows as unknown as PendingEngineOrder[];
}

export interface PlacePendingEquityOrderInput {
  orderKind: "EQUITY";
  symbol: string;
  side: TxSide;
  productType: PaperProductType;
  quantity: number;
  limitPrice: number;
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
  limitPrice: number;
  linkedOpinionId?: string;
}

export type PlacePendingOrderInput = PlacePendingEquityOrderInput | PlacePendingOptionOrderInput;

export interface PlacedPendingOrder {
  id: string;
  instrumentKind: PaperInstrumentKind;
  symbol: string;
  side: TxSide;
  productType: PaperProductType | null;
  quantity: number;
  limitPrice: number;
  status: PendingOrderStatus;
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
  status: true,
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
 * Places (never fills) one resting limit order against `userId`'s ACTIVE
 * account. No market-hours gate — a limit order can be queued before/after
 * hours, it simply won't be evaluated by the fill-check cron until the next
 * time it runs during market hours (see limit-fill cron's module doc).
 *
 * Cash/quantity blocking happens HERE, at placement (design decision 3 in
 * the schema doc) — by the time this function returns `ok: true`, the
 * blocked amount/quantity is already visible to every other order-placement
 * path via fetchActivePendingOrders, so a subsequent market or limit order
 * cannot double-spend the same funds/shares.
 */
export async function placePendingOrder(userId: string, input: PlacePendingOrderInput): Promise<PlacePendingOrderResult> {
  if (input.linkedOpinionId) {
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
        limitPrice: input.limitPrice,
        productType: input.productType
      });
      const cash = deriveCash(account.startingCapital, existingOrders);
      const blockedCash = derivePendingBlockedCash(existingPending);
      const availableCash = cash - blockedCash;
      if ((blockedAmount ?? 0) > availableCash) {
        return {
          ok: false,
          status: 422,
          reason: `Insufficient cash: this limit order would need ₹${(blockedAmount ?? 0).toFixed(2)} to be blocked, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} already blocked by other pending orders).`
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
        limitPrice: input.limitPrice,
        blockedAmount,
        linkedOpinionId: input.linkedOpinionId ?? null
      },
      select: PLACED_PENDING_SELECT
    });
    return { ok: true, order: created as PlacedPendingOrder };
  }

  // ── OPTION (INDEX_OPTION | STOCK_OPTION) ────────────────────────────────
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

  // A live chain fetch is needed here ONLY to snapshot lotSize (never to
  // price the order — the limit price is user-specified) — same "snapshot at
  // write time, never hardcode" discipline as the market-order path's
  // premium fetch, just without needing the premium itself.
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
      limitPrice: input.limitPrice
    });
    const cash = deriveCash(account.startingCapital, existingOrders);
    const blockedCash = derivePendingBlockedCash(existingPending);
    const availableCash = cash - blockedCash;
    if ((blockedAmount ?? 0) > availableCash) {
      return {
        ok: false,
        status: 422,
        reason: `Insufficient cash: this limit order would need ₹${(blockedAmount ?? 0).toFixed(2)} to be blocked, but only ₹${availableCash.toFixed(2)} is available (₹${blockedCash.toFixed(2)} already blocked by other pending orders).`
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
      limitPrice: input.limitPrice,
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

/** Lists an already-resolved account's currently-PENDING orders, newest first — the shared query behind both listPendingOrders (below) and getAccountDetail (queries.ts), which already has the account row and shouldn't re-resolve it. */
export async function listPendingOrdersForAccount(accountId: string): Promise<PlacedPendingOrder[]> {
  const rows = await prisma.paperPendingOrder.findMany({
    where: { accountId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: PLACED_PENDING_SELECT
  });
  return rows as PlacedPendingOrder[];
}

/** Lists the caller's currently-PENDING orders, newest first — backs the "Pending orders" UI section (T6/T7). */
export async function listPendingOrders(userId: string): Promise<PlacedPendingOrder[]> {
  const account = await getOrCreateActiveAccount(userId);
  return listPendingOrdersForAccount(account.id);
}
