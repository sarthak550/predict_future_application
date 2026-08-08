/**
 * Paper Trading Phase 1 — read-side DB orchestration for
 * GET /api/paper-trading/account and GET /api/paper-trading/calls-traded.
 *
 * All derived math (cash, holdings, realized/unrealized/net P&L) comes from the
 * pure functions in packages/business-rules/src/papertrading/replay.ts.
 */

import {
  deriveAllDeliveryPositions,
  deriveAllFuturesPositions,
  deriveAllOptionPositions,
  deriveCash,
  deriveIntradayDailyPositions,
  netPnl,
  openIntradayPositions,
  replayPosition,
  unrealizedGrossPnl,
  type DayGroupedPosition,
  type FuturesContractPosition,
  type OptionContractPosition,
  type PaperEngineOrder,
  type SymbolPosition
} from "@predict-future/business-rules/papertrading/replay";
import { daysToExpiry, formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { computeFuturesMarginRequired, INDEX_FUTURES_MARGIN_RATE } from "@predict-future/business-rules/papertrading/futuresMargin";
import { derivePendingBlockedCash } from "@predict-future/business-rules/papertrading/pendingOrders";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";

import { getOrCreateActiveAccount, getResetEligibility, type PaperAccountRow } from "@/lib/paperTrading/account";
import { fetchDelayedLtp } from "@/lib/paperTrading/ltp";
import { fetchOptionChainSnapshot, findOptionQuote } from "@/lib/paperTrading/optionQuote";
import { fetchFuturesQuoteServer, findFuturesContractQuote, type FuturesQuoteSource } from "@/lib/paperTrading/futuresQuote";
import { fetchActivePendingOrders, listPendingOrdersForAccount, type PlacedPendingOrder } from "@/lib/paperTrading/pendingOrders";
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
  /** Phase 4 (T7/T8) — REQUIRED for deriveCash to correctly carve out a daily-MTM leg's cash effect (see replay.ts's doc comment). Without this, an isDailyMtm row would read as `undefined` (falsy) here and be mis-treated as a normal side-based trade, corrupting cash for any account holding a futures position. Additive-only: every pre-Phase-4 row still has isDailyMtm default false, so this selection change is a no-op for every existing account's math. */
  isDailyMtm: true
} as const;

const IMPLIED_FUTURES_LEVERAGE = 1 / INDEX_FUTURES_MARGIN_RATE;

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
  /** Null for an INDEX_OPTION row (Phase 2) — see instrumentKind below. */
  productType: "DELIVERY" | "INTRADAY" | null;
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
  /** Phase 2 added INDEX_OPTION, Phase 3 added STOCK_OPTION, Phase 4 (Sprint 2) added INDEX_FUTURE order writes for real. */
  instrumentKind: "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION" | "INDEX_FUTURE";
  underlyingSymbol: string | null;
  optionType: "CE" | "PE" | null;
  strikePrice: number | null;
  expiryDate: Date | null;
  lotSize: number | null;
  lots: number | null;
  /** Phase 4 (Sprint 2) — true only for a cash-only daily mark-to-market leg. False for every other row. */
  isDailyMtm: boolean;
  /** Expiry Settlement Backfill (2026-08-04) added OPTION_EXPIRY_BACKFILL and FUTURES_EXPIRY_BACKFILL — same "enum widened, literal union must follow" reasoning as instrumentKind above. */
  squareOffReason:
    | "INTRADAY_SESSION_CLOSE"
    | "OPTION_EXPIRY"
    | "STOCK_OPTION_EXPIRY_SQUAREOFF"
    | "FUTURES_EXPIRY_SETTLEMENT"
    | "FUTURES_MARGIN_CALL"
    | "OPTION_EXPIRY_BACKFILL"
    | "FUTURES_EXPIRY_BACKFILL"
    | null;
  /** Expiry Settlement Backfill (2026-08-04) — which price source produced fillPrice on an auto-settlement leg. Null for every manual trade leg and every settlement leg written before this field existed. See the schema doc on PaperOrder.settlementBasis. */
  settlementBasis: "LIVE_MARKET" | "HISTORICAL_EXCHANGE_CLOSE" | "LAST_KNOWN_MARK" | "ASSUMED_WORTHLESS" | null;
}

/** Phase 2/3 — one open (or, for the lifetime rollup, ever-traded) option contract position (index OR stock). */
export interface OptionPositionRow {
  underlyingSymbol: string;
  optionType: "CE" | "PE";
  strikePrice: number;
  expiryDate: Date;
  lotSize: number | null;
  lots: number;
  quantity: number;
  avgCost: number;
  latestPremium: number | null;
  realizedGrossPnl: number;
  unrealizedGrossPnl: number | null;
  totalCosts: number;
  netPnl: number | null;
  daysToExpiry: number;
  /** Phase 3 — which settlement mechanism this contract uses, for the positions-view badge (T8). */
  instrumentKind: "INDEX_OPTION" | "STOCK_OPTION";
}

/**
 * Phase 4 (T10) — one open INDEX_FUTURE contract position, priced against a
 * live/PCP futures quote fetched fresh for this read (never a stored/cached
 * price — margin and P&L must always reflect the CURRENT price, per the
 * margin engine's own "recomputed on demand" design).
 */
export interface FuturesPositionRow {
  underlyingSymbol: string;
  expiryDate: Date;
  side: "LONG" | "SHORT";
  lotSize: number | null;
  lots: number;
  /** Signed — positive long, negative short. */
  quantity: number;
  /** The position's current cost basis: entry price until the first daily-MTM leg posts, then that leg's settlement price. */
  referencePrice: number;
  latestPrice: number | null;
  quoteSource: FuturesQuoteSource | null;
  /** Null when no live/PCP price is available right now (margin can't be honestly recomputed without a current price). */
  marginRequired: number | null;
  impliedLeverage: number;
  /**
   * "Today's MTM (live estimate)" — (latestPrice - referencePrice) * quantity.
   * NOT unrealized-since-entry (referencePrice already reflects yesterday's
   * settlement mark, if any) — this is what tonight's daily-MTM cron leg
   * would realize if it ran right now. Must be rendered with that exact
   * framing per the Phase 4 brief ("a day P&L figure... labeled as such so a
   * user doesn't misread 'today's P&L' as 'P&L since I opened this'").
   */
  todayMtmPnl: number | null;
  /** Lifetime realized P&L (telescoping sum of every daily-MTM leg + the eventual close/settlement leg) — see FuturesContractPosition's doc. */
  realizedGrossPnl: number;
  totalCosts: number;
  daysToExpiry: number;
}

export interface PaperAccountDetail {
  account: { id: string; generation: number; startingCapital: number; createdAt: Date; status: "ACTIVE" | "ARCHIVED" };
  cash: number;
  /**
   * Limit Orders (Sprint, 2026-07-26) — cash currently reserved by this
   * account's own PENDING limit BUY orders (see derivePendingBlockedCash).
   * Surfaced separately from `cash` (never silently subtracted from it) so
   * the UI can show BOTH "your actual cash balance" and "how much of it is
   * spoken for" per the brief's "expose the blocked total visibly" mandate.
   */
  pendingBlockedCash: number;
  /** cash - pendingBlockedCash — the figure every order ticket's client-side insufficient-cash hint should use (the server independently re-derives and re-validates this at placement, this is UX-only). */
  availableCash: number;
  /** Limit Orders (Sprint, 2026-07-26) — this account's currently-PENDING limit orders (equity + options), newest first. Backs the "Pending orders" UI section. */
  pendingOrders: PlacedPendingOrder[];
  deliveryHoldings: PositionRow[];
  openIntradayPositions: PositionRow[];
  optionPositions: OptionPositionRow[];
  /** Phase 4 (T10). */
  futuresPositions: FuturesPositionRow[];
  /** Sum of every open futures position's marginRequired (nulls excluded) — the same figure the order-placement route's headroom check uses per-position, aggregated for display. */
  totalFuturesMarginRequired: number;
  lifetimeCostsPaid: number;
  lifetimeRealizedGrossPnl: number;
  lifetimeUnrealizedGrossPnl: number;
  lifetimeNetPnl: number;
  /**
   * Trading Terminal UI Overhaul (Sprint A, T4) — the P&L impact of every
   * order placed today (IST calendar day), read-side only, additive. See
   * `computeTodayNetPnl` below for the exact derivation and why this is
   * "today's TRADING P&L" rather than a full mark-to-market "day P&L".
   */
  todayNetPnl: number;
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

/** Chain-lookup key for a group of option positions that share one underlying+expiry — one live chain fetch covers every strike in the group. */
function optionChainKey(underlyingSymbol: string, expiryDate: Date): string {
  return `${underlyingSymbol}::${expiryDate.toISOString()}`;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar day's start, expressed as the equivalent UTC instant — the cutoff for "placed today" below. */
function istDayStartAsUtcInstant(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUtcMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(istMidnightUtcMs - IST_OFFSET_MS);
}

/**
 * "Today's trading P&L" — the P&L impact of every order placed today,
 * isolated by diffing two replays of the SAME order log against the SAME
 * live prices: one over every order, one with today's orders excluded. Both
 * marks use the prices already fetched for the main computation (ltpBySymbol
 * / quoteFor) — no extra I/O.
 *
 * Correct WITHOUT needing any price for a position that was fully closed
 * today: its realizedGrossPnl/totalCosts are pure order-log arithmetic (no
 * live price involved at all), so its full today-contribution is captured by
 * the realized+costs delta term alone. A live price is only needed for the
 * unrealized-delta term, and that's only ever computed for positions that are
 * STILL open right now — which are, by construction, exactly the positions
 * `ltpBySymbol`/`quoteFor` already have a price for.
 *
 * Deliberately NOT a full mark-to-market "day P&L" (which would need a
 * start-of-day position snapshot this engine has never captured — see
 * terminal-header.tsx's doc comment for the honest framing).
 */
function computeTodayNetPnl(
  engineOrders: PaperEngineOrder[],
  allDeliveryPositions: SymbolPosition[],
  allIntradayDaily: DayGroupedPosition[],
  allOptionPositions: OptionContractPosition[],
  ltpBySymbol: Map<string, { price: number; tickAt: Date } | null>,
  quoteFor: (p: OptionContractPosition) => { lastPrice: number | null } | null
): number {
  const todayStartUtc = istDayStartAsUtcInstant();
  const ordersExcludingToday = engineOrders.filter((o) => o.createdAt < todayStartUtc);

  const deliveryExclToday = deriveAllDeliveryPositions(ordersExcludingToday);
  const intradayExclToday = deriveIntradayDailyPositions(ordersExcludingToday);
  const optionExclToday = deriveAllOptionPositions(ordersExcludingToday);

  let todayNetPnl = 0;

  function accumulate<T extends { realizedGrossPnl: number; totalCosts: number; quantity: number; avgCost: number }>(
    current: T[],
    excluded: T[],
    keyFor: (g: T) => string,
    priceFor: (g: T) => number | null
  ) {
    const exclByKey = new Map(excluded.map((g) => [keyFor(g), g]));
    for (const g of current) {
      const excl = exclByKey.get(keyFor(g));
      const realizedDelta = g.realizedGrossPnl - (excl?.realizedGrossPnl ?? 0);
      const costsDelta = g.totalCosts - (excl?.totalCosts ?? 0);
      todayNetPnl += realizedDelta - costsDelta;
      if (g.quantity !== 0) {
        const price = priceFor(g);
        if (price != null) {
          const currentUnrealized = unrealizedGrossPnl(g.quantity, g.avgCost, price);
          const exclUnrealized = excl && excl.quantity !== 0 ? unrealizedGrossPnl(excl.quantity, excl.avgCost, price) : 0;
          todayNetPnl += currentUnrealized - exclUnrealized;
        }
      }
    }
  }

  accumulate(
    allDeliveryPositions,
    deliveryExclToday,
    (g) => g.symbol,
    (g) => ltpBySymbol.get(g.symbol)?.price ?? null
  );
  accumulate(
    allIntradayDaily,
    intradayExclToday,
    (g) => `${g.symbol}::${g.dayKey}`,
    (g) => ltpBySymbol.get(g.symbol)?.price ?? null
  );
  accumulate(
    allOptionPositions,
    optionExclToday,
    (g) => optionChainKey(g.underlyingSymbol, g.expiryDate) + `::${g.strikePrice}::${g.optionType}`,
    (g) => quoteFor(g)?.lastPrice ?? null
  );

  return todayNetPnl;
}

function toOptionPositionRow(
  position: OptionContractPosition,
  quote: { lastPrice: number | null } | null
): OptionPositionRow {
  const latestPremium = quote?.lastPrice ?? null;
  const unrealized =
    position.quantity !== 0 && latestPremium != null
      ? unrealizedGrossPnl(position.quantity, position.avgCost, latestPremium)
      : position.quantity === 0
        ? 0
        : null;
  return {
    underlyingSymbol: position.underlyingSymbol,
    optionType: position.optionType,
    strikePrice: position.strikePrice,
    expiryDate: position.expiryDate,
    lotSize: position.lotSize,
    lots: position.lots,
    quantity: position.quantity,
    avgCost: position.avgCost,
    latestPremium,
    realizedGrossPnl: position.realizedGrossPnl,
    unrealizedGrossPnl: unrealized,
    totalCosts: position.totalCosts,
    netPnl: unrealized !== null ? netPnl(position.realizedGrossPnl, unrealized, position.totalCosts) : null,
    daysToExpiry: daysToExpiry(position.expiryDate),
    instrumentKind: position.instrumentKind
  };
}

/** Chain-lookup key for one futures contract — same (underlying, expiry) grouping replay.ts's deriveAllFuturesPositions already uses. */
function toFuturesPositionRow(
  position: FuturesContractPosition,
  quoteByUnderlying: Map<string, Awaited<ReturnType<typeof fetchFuturesQuoteServer>>>
): FuturesPositionRow {
  const quote = quoteByUnderlying.get(position.underlyingSymbol) ?? null;
  const contract = quote ? findFuturesContractQuote(quote, formatNseExpiryDate(position.expiryDate)) : null;
  const latestPrice = contract?.price ?? null;
  const marginRequired = latestPrice != null ? computeFuturesMarginRequired(Math.abs(position.quantity) * latestPrice) : null;
  const todayMtmPnl = latestPrice != null ? (latestPrice - position.referencePrice) * position.quantity : null;
  return {
    underlyingSymbol: position.underlyingSymbol,
    expiryDate: position.expiryDate,
    side: position.quantity > 0 ? "LONG" : "SHORT",
    lotSize: position.lotSize,
    lots: position.lots,
    quantity: position.quantity,
    referencePrice: position.referencePrice,
    latestPrice,
    quoteSource: quote?.source ?? null,
    marginRequired,
    impliedLeverage: IMPLIED_FUTURES_LEVERAGE,
    todayMtmPnl,
    realizedGrossPnl: position.realizedGrossPnl,
    totalCosts: position.totalCosts,
    daysToExpiry: daysToExpiry(position.expiryDate)
  };
}

/**
 * Full account read: lazily creates the ACTIVE account if this is the caller's
 * first visit, then builds cash/holdings/lifetime rollups by replaying the order
 * log. Fetches a live delayed LTP for every symbol with an open EQUITY position
 * (held DELIVERY + today's still-open INTRADAY) — bounded and cheap at Phase 1
 * order volumes per the brief's own "do not over-engineer" guidance. Phase 2:
 * fetches ONE live option-chain snapshot per distinct (underlyingSymbol,
 * expiryDate) the account currently holds a position in — not one fetch per
 * strike, since a single chain response already carries every strike's premium.
 * `cash` is a single unified pool across both asset classes (deriveCash needed
 * no Phase 2 changes at all — see replay.ts's doc comment on PaperEngineOrder).
 */
export async function getAccountDetail(userId: string): Promise<PaperAccountDetail> {
  const account = await getOrCreateActiveAccount(userId);

  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const engineOrders = orderRows as unknown as PaperEngineOrder[];

  const cash = deriveCash(account.startingCapital, engineOrders);

  // Limit Orders (Sprint, 2026-07-26) — every currently-PENDING order for
  // this account, reused both to compute the blocked-cash total below and to
  // return the full list for the "Pending orders" UI section.
  const activePendingOrders = await fetchActivePendingOrders(account.id);
  const pendingBlockedCash = derivePendingBlockedCash(activePendingOrders);
  const availableCash = cash - pendingBlockedCash;
  const pendingOrders = await listPendingOrdersForAccount(account.id);

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

  // ── Phase 2/3: option positions (index OR stock) ────────────────────────────
  const allOptionPositions = deriveAllOptionPositions(engineOrders);
  const currentOptionPositions = allOptionPositions.filter((p) => p.quantity !== 0);

  const neededChains = new Map<string, { underlying: string; expiryStr: string }>();
  for (const p of currentOptionPositions) {
    const key = optionChainKey(p.underlyingSymbol, p.expiryDate);
    if (!neededChains.has(key)) {
      neededChains.set(key, { underlying: p.underlyingSymbol, expiryStr: formatNseExpiryDate(p.expiryDate) });
    }
  }
  const chainEntries = await Promise.all(
    [...neededChains.entries()].map(async ([key, { underlying, expiryStr }]) => [key, await fetchOptionChainSnapshot(underlying, expiryStr)] as const)
  );
  const chainByKey = new Map(chainEntries);

  const quoteFor = (p: OptionContractPosition) => {
    const chain = chainByKey.get(optionChainKey(p.underlyingSymbol, p.expiryDate));
    return chain ? findOptionQuote(chain, p.strikePrice, p.optionType) : null;
  };

  const optionPositionRows = currentOptionPositions.map((p) => toOptionPositionRow(p, quoteFor(p)));

  // ── Phase 4 (T10): open futures positions, priced fresh ─────────────────
  const allFuturesPositions = deriveAllFuturesPositions(engineOrders);
  const currentFuturesPositions = allFuturesPositions.filter((p) => p.quantity !== 0);
  const neededFuturesUnderlyings = [...new Set(currentFuturesPositions.map((p) => p.underlyingSymbol))];
  const futuresQuoteEntries = await Promise.all(
    neededFuturesUnderlyings.map(async (u) => [u, await fetchFuturesQuoteServer(u)] as const)
  );
  const futuresQuoteByUnderlying = new Map(futuresQuoteEntries);
  const futuresPositionRows: FuturesPositionRow[] = currentFuturesPositions.map((p) => toFuturesPositionRow(p, futuresQuoteByUnderlying));
  const totalFuturesMarginRequired = futuresPositionRows.reduce((sum, p) => sum + (p.marginRequired ?? 0), 0);

  // Lifetime rollup: every DELIVERY symbol + every (symbol, day) INTRADAY group +
  // every option contract ever traded, closed positions included — realized P&L
  // and totalCosts are always known for a closed group; unrealized only applies
  // to the (small) still-open subset. A single unified rollup across both asset
  // classes, per the Phase 2 brief's "one account, one ledger" decision.
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
  for (const p of allOptionPositions) {
    lifetimeCostsPaid += p.totalCosts;
    lifetimeRealizedGrossPnl += p.realizedGrossPnl;
    if (p.quantity !== 0) {
      const quote = quoteFor(p);
      if (quote?.lastPrice != null) lifetimeUnrealizedGrossPnl += unrealizedGrossPnl(p.quantity, p.avgCost, quote.lastPrice);
    }
  }
  // Phase 4 (T10): futures — realizedGrossPnl here is already the telescoping
  // sum of every daily-MTM leg's crystallized delta (see FuturesContractPosition's
  // doc), so it correctly folds every PRIOR day's mark into "realized" already;
  // only today's still-unmarked move (todayMtmPnl, already computed per-row
  // above) is "unrealized" in this rollup's sense.
  for (const p of allFuturesPositions) {
    lifetimeCostsPaid += p.totalCosts;
    lifetimeRealizedGrossPnl += p.realizedGrossPnl;
  }
  for (const row of futuresPositionRows) {
    if (row.todayMtmPnl != null) lifetimeUnrealizedGrossPnl += row.todayMtmPnl;
  }
  const lifetimeNetPnl = lifetimeRealizedGrossPnl + lifetimeUnrealizedGrossPnl - lifetimeCostsPaid;

  // Deliberately NOT folding futures into computeTodayNetPnl this sprint —
  // that function's "orders placed today" diff-replay shape doesn't have a
  // clean analogue for a position whose cost basis resets daily regardless
  // of whether an order was placed today (see futuresPositionRows.todayMtmPnl
  // for the correct per-position "today" figure instead, rendered directly
  // on the futures terminal/positions strip). Flagged as a Sprint 2 scope
  // decision, not an oversight — see the CTO report.
  const todayNetPnl = computeTodayNetPnl(engineOrders, allDeliveryPositions, allIntradayDaily, allOptionPositions, ltpBySymbol, quoteFor);

  const holdingsValue = deliveryHoldingRows.reduce((sum, h) => sum + h.quantity * (h.latestLtp ?? h.avgCost), 0);
  const optionsValue = optionPositionRows.reduce((sum, o) => sum + o.quantity * (o.latestPremium ?? o.avgCost), 0);
  // Futures never carry a "held value" the way equity/options do (margin is
  // never debited from cash — see futuresOrders.ts's module doc) — only the
  // still-unmarked today's-MTM delta contributes to total account value on
  // top of cash.
  const futuresUnmarkedValue = futuresPositionRows.reduce((sum, row) => sum + (row.todayMtmPnl ?? 0), 0);
  const totalValue = cash + holdingsValue + optionsValue + futuresUnmarkedValue;

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
    pendingBlockedCash,
    availableCash,
    pendingOrders,
    deliveryHoldings: deliveryHoldingRows,
    openIntradayPositions: openIntradayRows,
    optionPositions: optionPositionRows,
    futuresPositions: futuresPositionRows,
    totalFuturesMarginRequired,
    lifetimeCostsPaid,
    lifetimeRealizedGrossPnl,
    lifetimeUnrealizedGrossPnl,
    lifetimeNetPnl,
    todayNetPnl,
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
      createdAt: o.createdAt,
      instrumentKind: o.instrumentKind,
      underlyingSymbol: o.underlyingSymbol,
      optionType: o.optionType,
      strikePrice: o.strikePrice,
      expiryDate: o.expiryDate,
      lotSize: o.lotSize,
      lots: o.lots,
      squareOffReason: o.squareOffReason,
      settlementBasis: o.settlementBasis,
      isDailyMtm: o.isDailyMtm
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
    expert: { name: string; slug: string | null; organization: string };
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
      expert: { select: { name: true, slug: true, organization: true } }
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
        expert: { ...opinion.expert, organization: canonicalizeOrgDisplay(opinion.expert.organization) }
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
