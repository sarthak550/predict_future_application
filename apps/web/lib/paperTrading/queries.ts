/**
 * Paper Trading Phase 1 — read-side DB orchestration for
 * GET /api/paper-trading/account and GET /api/paper-trading/calls-traded.
 *
 * All derived math (cash, holdings, realized/unrealized/net P&L) comes from the
 * pure functions in packages/business-rules/src/papertrading/replay.ts.
 */

import {
  deriveAllDeliveryPositions,
  deriveCash,
  deriveIntradayDailyPositions,
  netPnl,
  openIntradayPositions,
  replayPosition,
  unrealizedGrossPnl,
  type PaperEngineOrder,
  type SymbolPosition
} from "@predict-future/business-rules/papertrading/replay";

import { getOrCreateActiveAccount, getResetEligibility, type PaperAccountRow } from "@/lib/paperTrading/account";
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

const RECENT_ORDERS_LIMIT = 200;

export interface PositionRow {
  symbol: string;
  quantity: number;
  avgCost: number;
  latestLtp: number | null;
  ltpTickAt: Date | null;
  realizedGrossPnl: number;
  unrealizedGrossPnl: number | null;
  totalCosts: number;
  /** realized + unrealized - totalCosts. Null when no LTP is available to mark an open position (never null for a closed one). */
  netPnl: number | null;
}

export interface OrderHistoryRow {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  productType: "DELIVERY" | "INTRADAY";
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
  isSquareOff: boolean;
  autoSquaredOff: boolean;
  createdAt: Date;
}

export interface PaperAccountDetail {
  account: { id: string; generation: number; startingCapital: number; createdAt: Date; status: "ACTIVE" | "ARCHIVED" };
  cash: number;
  deliveryHoldings: PositionRow[];
  openIntradayPositions: PositionRow[];
  lifetimeCostsPaid: number;
  lifetimeRealizedGrossPnl: number;
  lifetimeUnrealizedGrossPnl: number;
  lifetimeNetPnl: number;
  totalValue: number;
  resetEligible: boolean;
  daysUntilReset: number;
  recentOrders: OrderHistoryRow[];
}

function toPositionRow(position: SymbolPosition, ltp: { price: number; tickAt: Date } | null): PositionRow {
  const unrealized = position.quantity !== 0 && ltp ? unrealizedGrossPnl(position.quantity, position.avgCost, ltp.price) : position.quantity === 0 ? 0 : null;
  return {
    symbol: position.symbol,
    quantity: position.quantity,
    avgCost: position.avgCost,
    latestLtp: ltp?.price ?? null,
    ltpTickAt: ltp?.tickAt ?? null,
    realizedGrossPnl: position.realizedGrossPnl,
    unrealizedGrossPnl: unrealized,
    totalCosts: position.totalCosts,
    netPnl: unrealized !== null ? netPnl(position.realizedGrossPnl, unrealized, position.totalCosts) : null
  };
}

/**
 * Full account read: lazily creates the ACTIVE account if this is the caller's
 * first visit, then builds cash/holdings/lifetime rollups by replaying the order
 * log. Fetches a live delayed LTP for every symbol with an open position (held
 * DELIVERY + today's still-open INTRADAY) — bounded and cheap at Phase 1 order
 * volumes per the brief's own "do not over-engineer" guidance.
 */
export async function getAccountDetail(userId: string): Promise<PaperAccountDetail> {
  const account = await getOrCreateActiveAccount(userId);

  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const engineOrders = orderRows as PaperEngineOrder[];

  const cash = deriveCash(account.startingCapital, engineOrders);

  const allDeliveryPositions = deriveAllDeliveryPositions(engineOrders);
  const currentDeliveryHoldings = allDeliveryPositions.filter((p) => p.quantity !== 0);

  const allIntradayDaily = deriveIntradayDailyPositions(engineOrders);
  const openIntraday = openIntradayPositions(engineOrders, new Date());

  const symbolsNeedingLtp = [...new Set([...currentDeliveryHoldings.map((p) => p.symbol), ...openIntraday.map((p) => p.symbol)])];
  const ltpEntries = await Promise.all(
    symbolsNeedingLtp.map(async (symbol) => [symbol, await fetchDelayedLtp(symbol)] as const)
  );
  const ltpBySymbol = new Map(ltpEntries);

  const deliveryHoldingRows = currentDeliveryHoldings.map((p) => toPositionRow(p, ltpBySymbol.get(p.symbol) ?? null));
  const openIntradayRows = openIntraday.map((p) => toPositionRow(p, ltpBySymbol.get(p.symbol) ?? null));

  // Lifetime rollup: every DELIVERY symbol + every (symbol, day) INTRADAY group ever
  // traded, closed positions included — realized P&L and totalCosts are always
  // known for a closed group; unrealized only applies to the (small) still-open subset.
  let lifetimeCostsPaid = 0;
  let lifetimeRealizedGrossPnl = 0;
  let lifetimeUnrealizedGrossPnl = 0;
  for (const p of allDeliveryPositions) {
    lifetimeCostsPaid += p.totalCosts;
    lifetimeRealizedGrossPnl += p.realizedGrossPnl;
    if (p.quantity !== 0) {
      const ltp = ltpBySymbol.get(p.symbol);
      if (ltp) lifetimeUnrealizedGrossPnl += unrealizedGrossPnl(p.quantity, p.avgCost, ltp.price);
    }
  }
  for (const p of allIntradayDaily) {
    lifetimeCostsPaid += p.totalCosts;
    lifetimeRealizedGrossPnl += p.realizedGrossPnl;
    if (p.quantity !== 0) {
      const ltp = ltpBySymbol.get(p.symbol);
      if (ltp) lifetimeUnrealizedGrossPnl += unrealizedGrossPnl(p.quantity, p.avgCost, ltp.price);
    }
  }
  const lifetimeNetPnl = lifetimeRealizedGrossPnl + lifetimeUnrealizedGrossPnl - lifetimeCostsPaid;

  const holdingsValue = deliveryHoldingRows.reduce((sum, h) => sum + h.quantity * (h.latestLtp ?? h.avgCost), 0);
  const totalValue = cash + holdingsValue;

  const resetEligibility = getResetEligibility(account);

  const recentOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    take: RECENT_ORDERS_LIMIT
  });

  return {
    account: {
      id: account.id,
      generation: account.generation,
      startingCapital: account.startingCapital,
      createdAt: account.createdAt,
      status: account.status
    },
    cash,
    deliveryHoldings: deliveryHoldingRows,
    openIntradayPositions: openIntradayRows,
    lifetimeCostsPaid,
    lifetimeRealizedGrossPnl,
    lifetimeUnrealizedGrossPnl,
    lifetimeNetPnl,
    totalValue,
    resetEligible: resetEligibility.eligible,
    daysUntilReset: resetEligibility.daysRemaining,
    recentOrders: recentOrderRows.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      productType: o.productType,
      quantity: o.quantity,
      fillPrice: o.fillPrice,
      fillTickAt: o.fillTickAt,
      grossAmount: o.grossAmount,
      brokerage: o.brokerage,
      sttAmount: o.sttAmount,
      exchangeCharge: o.exchangeCharge,
      sebiFee: o.sebiFee,
      stampDuty: o.stampDuty,
      gstAmount: o.gstAmount,
      dpCharge: o.dpCharge,
      totalCosts: o.totalCosts,
      netAmount: o.netAmount,
      linkedOpinionId: o.linkedOpinionId,
      isSquareOff: o.isSquareOff,
      autoSquaredOff: o.autoSquaredOff,
      createdAt: o.createdAt
    }))
  };
}

// ─── "Calls I've traded" (T8) ─────────────────────────────────────────────────

export type CallTradeState = "open-pending" | "open-graded" | "closed";

export interface CallTradeGroup {
  linkedOpinionId: string;
  opinion: {
    quote: string;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
    instrument: string | null;
    sourceUrl: string;
    expert: { name: string; slug: string | null };
  };
  symbol: string;
  quantity: number;
  avgCost: number;
  isOpen: boolean;
  realizedGrossPnl: number;
  unrealizedGrossPnl: number | null;
  totalCosts: number;
  netPnl: number | null;
  state: CallTradeState;
}

/**
 * Every linkedOpinionId group the caller has traded, each replayed independently
 * (join on linkedOpinionId, never inferred from symbol alone — see the "Paper
 * trade this call" end-to-end spec: unrelated later trades in the same stock must
 * not get misattributed to an earlier linked call).
 */
export async function getCallsTraded(userId: string): Promise<CallTradeGroup[]> {
  const account = await getOrCreateActiveAccount(userId);

  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id, linkedOpinionId: { not: null } },
    orderBy: { createdAt: "asc" }
  });
  if (orderRows.length === 0) return [];

  const groups = new Map<string, typeof orderRows>();
  for (const row of orderRows) {
    const key = row.linkedOpinionId as string;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const opinionIds = [...groups.keys()];
  const opinions = await prisma.expertOpinion.findMany({
    where: { id: { in: opinionIds } },
    select: {
      id: true,
      quote: true,
      direction: true,
      resolutionStatus: true,
      instrument: true,
      sourceUrl: true,
      expert: { select: { name: true, slug: true } }
    }
  });
  const opinionById = new Map(opinions.map((o) => [o.id, o]));

  const results: CallTradeGroup[] = [];
  for (const [linkedOpinionId, rows] of groups) {
    const opinion = opinionById.get(linkedOpinionId);
    if (!opinion) continue; // defensive — the opinion row was deleted after being traded (shouldn't happen in practice)

    const engineOrders = rows as unknown as PaperEngineOrder[];
    const position = replayPosition(engineOrders);
    const symbol = rows[0].symbol;

    let unrealized: number | null = null;
    if (position.quantity !== 0) {
      const ltp = await fetchDelayedLtp(symbol);
      unrealized = ltp ? unrealizedGrossPnl(position.quantity, position.avgCost, ltp.price) : null;
    } else {
      unrealized = 0;
    }

    const isGraded = opinion.resolutionStatus === "RESOLVED_HIT" || opinion.resolutionStatus === "RESOLVED_MISS";
    const state: CallTradeState = position.isOpen ? (isGraded ? "open-graded" : "open-pending") : "closed";

    results.push({
      linkedOpinionId,
      opinion: {
        quote: opinion.quote,
        direction: opinion.direction,
        resolutionStatus: opinion.resolutionStatus,
        instrument: opinion.instrument,
        sourceUrl: opinion.sourceUrl,
        expert: opinion.expert
      },
      symbol,
      quantity: position.quantity,
      avgCost: position.avgCost,
      isOpen: position.isOpen,
      realizedGrossPnl: position.realizedGrossPnl,
      unrealizedGrossPnl: unrealized,
      totalCosts: position.totalCosts,
      netPnl: unrealized !== null ? netPnl(position.realizedGrossPnl, unrealized, position.totalCosts) : null,
      state
    });
  }

  // Newest first — most recently touched linked call surfaces at the top.
  results.sort((a, b) => {
    const aLast = groups.get(a.linkedOpinionId)!.at(-1)!.createdAt.getTime();
    const bLast = groups.get(b.linkedOpinionId)!.at(-1)!.createdAt.getTime();
    return bLast - aLast;
  });

  return results;
}

export type { PaperAccountRow };
