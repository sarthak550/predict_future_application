/**
 * Paper Trading Phase 2 — index-option expiry settlement orchestration for
 * POST /api/cron/paper-trading-options-expiry (T6).
 *
 * NIFTY/BANKNIFTY options are European, cash-settled, index options: they can
 * only be exercised at expiry (never early), and settlement is a cash
 * cash-difference, never physical delivery. This cron runs once daily, AFTER
 * Phase 1's existing equity square-off cron and after the final EOD chain
 * quotes settle (recommended ~15:40 IST — see the crontab line on the route),
 * finds every OPEN option position across every account whose contract expires
 * today, and writes a closing PaperOrder at intrinsic value.
 *
 * Spot-price source, in priority order:
 *   1. The final end-of-day option-chain fetch's own `underlyingValue` (the
 *      SAME NSE payload the strike ladder comes from — no separate call).
 *   2. If the chain is entirely unavailable at settlement time: a direct Yahoo
 *      Finance index-quote fallback (^NSEI / ^NSEBANK — NOT the equity
 *      `.NS`-suffixed fetcher in marketMoves/intraday.ts, which is for single
 *      stocks). The resulting order's fillTickAt / a dedicated flag makes this
 *      fallback visible rather than silently blending two data qualities.
 *
 * All pure position/cost math lives in packages/business-rules — this file is
 * DB + upstream orchestration only, mirroring lib/paperTrading/squareoff.ts's
 * shape (Phase 1's equity cron) and apps/api/lib/portfolios/settlement.ts's
 * shape before that.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * EXPIRY SETTLEMENT BACKFILL (2026-08-04) — see also futuresExpiry.ts's
 * identical addition on the futures side.
 * ══════════════════════════════════════════════════════════════════════════
 * Founder-reported bug: expired option positions were lingering open in
 * portfolios indefinitely. Root cause, confirmed by code + git history, not
 * guesswork: this cron (and its stock-option/futures siblings) was written
 * but NEVER installed on the production crontab (every prior sprint's memory
 * says so explicitly, and no scheduler config anywhere in this repo — cron,
 * GitHub Actions, pm2 — references these routes). Worse, even once installed,
 * the SAME-DAY-ONLY design above (`expiryDate === today`, via
 * openExpiringPositions) can never retroactively catch a contract that
 * expired on some earlier day the cron didn't run — there is no future date
 * on which that filter would ever match it again. Two independent problems,
 * one fix: this cron now ALSO sweeps every OPEN option position (index OR
 * stock) whose expiry is STRICTLY IN THE PAST, every time it runs — so
 * installing the crontab today immediately cleans up the entire historical
 * backlog, not just future expiries.
 *
 * A backfilled contract cannot be settled the same way a same-day one is:
 * there is no live, tradeable quote for a contract that already expired
 * (NSE's live chain drops it — see optionChain.ts). It also means a
 * STOCK_OPTION backfill can never be genuinely "force-sold" (stockOptionSquareOff.ts's
 * mechanism, which requires a real listed, quotable contract) — so backfill
 * cash-settles STOCK_OPTION positions at intrinsic value exactly like an
 * INDEX_OPTION, which is the documented "cash-settle stock options too"
 * simplification for this one unavoidable case (reality is physical delivery;
 * see stockOptionSquareOff.ts's module doc for the same-day mechanism this
 * does NOT touch). Historical price is resolved through a 3-tier fallback,
 * cheapest/most-authoritative first, and the resolved tier is PERSISTED on
 * the settlement leg (PaperOrder.settlementBasis) — never silent:
 *   1. HISTORICAL_EXCHANGE_CLOSE — NSE's own F&O bhavcopy for the CONTRACT'S
 *      OWN expiry date (marketMoves/foBhavcopy.ts's fetchOptionUnderlyingSettlementPrices,
 *      UndrlygPric column) — the authoritative exchange record of the
 *      underlying's price that date, feeding the exact same computeIntrinsicValue
 *      the same-day path uses.
 *   2. LAST_KNOWN_MARK — if that historical bhavcopy is unobtainable (NSE
 *      archive gap / edge case): this account's own most recently captured
 *      OptionPremiumSnapshot for the contract (Trading Terminal Sprint A's
 *      premium-capture cron, live since 2026-07-27) — settle at that last
 *      observed real premium directly.
 *   3. ASSUMED_WORTHLESS — if neither source has anything at all: settle at
 *      ₹0, explicitly disclosed as a data-absence assumption (via
 *      settlementBasis), never silently indistinguishable from a verified
 *      "expired worthless" ₹0 intrinsic result.
 *
 * Also cancels any still-PENDING limit/stop order resting on a contract whose
 * expiry is today-or-earlier (see cancelExpiredOptionPendingOrders) — such an
 * order can never legitimately fill once its contract no longer trades.
 *
 * Idempotent by construction, same guard shape as the pre-existing same-day
 * path: every settlement re-verifies the position is still open from a FRESH
 * read immediately before writing. Running this cron twice back-to-back
 * (or the backfill sweep re-finding a position a later run already settled)
 * is always a safe no-op the second time.
 *
 * dryRun: computes and returns everything (would-be settlements, prices,
 * bases, pending-cancellation count) WITHOUT writing anything — see the route
 * file for how to invoke it. Lets ops verify exactly what a live run would do
 * before the crontab is (re-)installed, and is how this file's own test
 * evidence was gathered against fabricated dev-DB positions.
 */

import {
  computeIntrinsicValue,
  computeOptionOrderCosts
} from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import {
  openExpiringPositions,
  overdueExpiredOptionPositions,
  type OptionContractPosition,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";

import { fetchOptionChain, type OptionUnderlying } from "@/lib/marketMoves/optionChain";
import { fetchOptionUnderlyingSettlementPrices, type OptionUnderlyingSettlementSession } from "@/lib/marketMoves/foBhavcopy";
import { prisma } from "@/lib/prisma";
import type { PaperOptionType, PaperSettlementBasis } from "@prisma/client";

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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar date, expressed as a UTC-midnight Date — matches exactly how PaperOrder.expiryDate is stored (see optionContract.ts's parseNseExpiryDate), so it can be used as a direct equality filter in the DB query below. */
function todayIstDateAsUtcMidnight(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** "YYYY-MM-DD", matching UDiFF's own XpryDt/TradDt string convention (see foBhavcopy.ts) — used to key the backfill's per-date bhavcopy cache and its underlyingPriceFor() lookups. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Re-exported for lib/marketMoves/indexIntraday.ts — canonical map now lives in the shared business-rules registry (all 5 F&O indices, Yahoo tickers verified against NSE spot to the paisa 2026-07-25). */
export { YAHOO_INDEX_SPOT_TICKER as YAHOO_INDEX_TICKER } from "@predict-future/business-rules/papertrading/optionContract";
import { YAHOO_INDEX_SPOT_TICKER, isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMEOUT_MS = 8000;

/**
 * Fallback spot fetch used ONLY when the same-session option-chain fetch
 * (which already carries `underlyingValue`) is entirely unavailable. Direct
 * Yahoo index-quote fetch — deliberately NOT marketMoves/intraday.ts's
 * fetchIntradaySeries, which always appends ".NS" for single-stock equities
 * and would request a nonexistent "NIFTY.NS" ticker. Returns null on any
 * failure, never throws.
 */
async function fetchIndexSpotFallback(underlying: OptionUnderlying): Promise<number | null> {
  const ticker = isIndexOptionUnderlying(underlying) ? YAHOO_INDEX_SPOT_TICKER[underlying] : undefined;
  if (!ticker) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  try {
    const res = await fetch(`${YAHOO_CHART_BASE}/${encodeURIComponent(ticker)}?interval=1m&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    return typeof price === "number" && price > 0 ? price : null;
  } catch (err) {
    console.warn(`[paperTrading/optionsExpiry] Yahoo index fallback failed for ${underlying}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface BackfillSettlementDetail {
  accountId: string;
  underlyingSymbol: string;
  instrumentKind: "INDEX_OPTION" | "STOCK_OPTION";
  optionType: PaperOptionType;
  strikePrice: number;
  expiryDate: string;
  quantity: number;
  price: number;
  basis: Exclude<PaperSettlementBasis, "LIVE_MARKET">;
  netAmount: number;
}

export interface OptionExpirySettlementRunResult {
  dryRun: boolean;
  accountsScanned: number;
  positionsSettled: number;
  skippedNoSpot: number;
  usedSpotFallback: number;
  backfillAccountsScanned: number;
  backfillPositionsSettled: number;
  backfillBasisCounts: Record<Exclude<PaperSettlementBasis, "LIVE_MARKET">, number>;
  backfillSettlements: BackfillSettlementDetail[];
  pendingOrdersCancelled: number;
  errors: number;
}

export interface RunOptionsExpirySettlementOptions {
  /** When true, computes and returns everything a live run would do WITHOUT writing any settlement leg or cancelling any pending order. See the module doc's "EXPIRY SETTLEMENT BACKFILL" section. */
  dryRun?: boolean;
}

/**
 * Settles every account's open INDEX_OPTION positions expiring today (IST
 * calendar date), backfills any INDEX_OPTION/STOCK_OPTION position whose
 * expiry has already passed, and cancels stale pending orders on expired
 * contracts. Never throws — per-account/per-contract failures are caught and
 * counted, matching every other cron route's contract in this app.
 */
export async function runOptionsExpirySettlement(
  now: Date = new Date(),
  options: RunOptionsExpirySettlementOptions = {}
): Promise<OptionExpirySettlementRunResult> {
  const dryRun = options.dryRun ?? false;
  const result: OptionExpirySettlementRunResult = {
    dryRun,
    accountsScanned: 0,
    positionsSettled: 0,
    skippedNoSpot: 0,
    usedSpotFallback: 0,
    backfillAccountsScanned: 0,
    backfillPositionsSettled: 0,
    backfillBasisCounts: { HISTORICAL_EXCHANGE_CLOSE: 0, LAST_KNOWN_MARK: 0, ASSUMED_WORTHLESS: 0 },
    backfillSettlements: [],
    pendingOrdersCancelled: 0,
    errors: 0
  };

  const todayExpiry = todayIstDateAsUtcMidnight(now);

  // ── Backfill sweep: any INDEX_OPTION/STOCK_OPTION position whose expiry is
  // strictly in the past — runs FIRST and independent of same-day chain
  // availability below (a historical position's price comes from its OWN
  // past date's bhavcopy, never from today's live chain). ──
  await runBackfillSweep(todayExpiry, now, dryRun, result);

  // ── Same-day sweep (Phase 2's original, unmodified mechanism): INDEX_OPTION
  // positions expiring exactly today, priced off a live/near-live quote. ──
  const accountsWithExpiringOptionsToday = await prisma.paperOrder.findMany({
    where: { instrumentKind: "INDEX_OPTION", expiryDate: todayExpiry },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  const spotCache = new Map<OptionUnderlying, { spot: number; usedFallback: boolean } | null>();

  for (const { accountId } of accountsWithExpiringOptionsToday) {
    result.accountsScanned += 1;
    try {
      await settleAccount(accountId, now, todayExpiry, spotCache, dryRun, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-options-expiry] account ${accountId} failed:`, err);
    }
  }

  // ── Cancel any pending order resting on a contract expiring today-or-earlier
  // — see the module doc. Runs LAST, after both sweeps above have had their
  // chance to fill/settle, so a same-day contract's pending orders are only
  // swept up once the day's own settlement pass is done. ──
  result.pendingOrdersCancelled = await cancelExpiredOptionPendingOrders(todayExpiry, dryRun);

  return result;
}

async function resolveSpot(
  underlying: OptionUnderlying,
  expiry: Date,
  spotCache: Map<OptionUnderlying, { spot: number; usedFallback: boolean } | null>
): Promise<{ spot: number; usedFallback: boolean } | null> {
  if (spotCache.has(underlying)) return spotCache.get(underlying) ?? null;

  const expiryStr = formatNseExpiryDate(expiry);
  const chain = await fetchOptionChain(underlying, expiryStr);
  if (chain) {
    const resolved = { spot: chain.underlyingValue, usedFallback: false };
    spotCache.set(underlying, resolved);
    return resolved;
  }

  const fallbackSpot = await fetchIndexSpotFallback(underlying);
  const resolved = fallbackSpot != null ? { spot: fallbackSpot, usedFallback: true } : null;
  spotCache.set(underlying, resolved);
  return resolved;
}

async function settleAccount(
  accountId: string,
  now: Date,
  todayExpiry: Date,
  spotCache: Map<OptionUnderlying, { spot: number; usedFallback: boolean } | null>,
  dryRun: boolean,
  result: OptionExpirySettlementRunResult
): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];

  const expiringToday = openExpiringPositions(orders, now);
  if (expiringToday.length === 0) return; // already settled/closed — no-op

  for (const position of expiringToday) {
    const underlying = position.underlyingSymbol as OptionUnderlying;
    const spotInfo = await resolveSpot(underlying, todayExpiry, spotCache);
    if (!spotInfo) {
      result.skippedNoSpot += 1;
      console.warn(
        `[cron/paper-trading-options-expiry] no spot value available for ${underlying} — leaving account ${accountId}'s position open, will retry next run.`
      );
      continue;
    }
    if (spotInfo.usedFallback) result.usedSpotFallback += 1;

    const intrinsicValue = computeIntrinsicValue(position.optionType, spotInfo.spot, position.strikePrice);

    const costs = computeOptionOrderCosts({
      side: "SELL", // closing an existing long — always a SELL, whether ITM or OTM
      quantity: Math.abs(position.quantity),
      price: intrinsicValue,
      isExpirySettlement: true,
      intrinsicValue
    });

    // Re-verify the position is STILL open immediately before writing — a
    // concurrent manual close between the read above and here would otherwise
    // produce a double-settlement. Idempotency guard: re-derive from a fresh read.
    const freshOrderRows = await prisma.paperOrder.findMany({
      where: {
        accountId,
        instrumentKind: "INDEX_OPTION",
        underlyingSymbol: position.underlyingSymbol,
        strikePrice: position.strikePrice,
        expiryDate: position.expiryDate,
        optionType: position.optionType
      },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const freshOrders = freshOrderRows as unknown as PaperEngineOrder[];
    const freshOpen = openExpiringPositions(freshOrders, now).find(
      (p) => p.strikePrice === position.strikePrice && p.optionType === position.optionType
    );
    if (!freshOpen || freshOpen.quantity === 0) continue; // already settled/closed by the user (or a prior overlapping run) since the initial read

    if (!dryRun) {
      await prisma.paperOrder.create({
        data: {
          accountId,
          symbol: freshOrderRows[0].symbol,
          side: "SELL",
          productType: null,
          quantity: Math.abs(position.quantity),
          fillPrice: intrinsicValue,
          fillTickAt: now,
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
          isSquareOff: true,
          autoSquaredOff: true,
          instrumentKind: "INDEX_OPTION",
          underlyingSymbol: position.underlyingSymbol,
          optionType: position.optionType,
          strikePrice: position.strikePrice,
          expiryDate: position.expiryDate,
          lotSize: position.lotSize,
          lots: position.lots,
          squareOffReason: "OPTION_EXPIRY",
          settlementBasis: "LIVE_MARKET"
        },
        select: { id: true }
      });
    }

    result.positionsSettled += 1;
  }
}

// ─── Expiry Settlement Backfill (2026-08-04) ──────────────────────────────

/** capturedAt <= this cutoff never sees a snapshot captured after the contract's own expiry — defensive only, see the module doc's tier-2 rationale for why this should never actually trim anything in practice. */
function endOfIstDay(day: Date): Date {
  return new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Prefers a real traded lastPrice, falls back to a two-sided mid, then either single side — the loosest tier-2 acceptance in this cron family (tier 3 is a hard ₹0 floor, so any real number here is strictly more informative than falling through to it). */
function resolveSnapshotPrice(snapshot: { lastPrice: number | null; bidPrice: number | null; askPrice: number | null }): number | null {
  if (snapshot.lastPrice != null && snapshot.lastPrice > 0) return snapshot.lastPrice;
  if (snapshot.bidPrice != null && snapshot.askPrice != null) return (snapshot.bidPrice + snapshot.askPrice) / 2;
  if (snapshot.bidPrice != null && snapshot.bidPrice > 0) return snapshot.bidPrice;
  if (snapshot.askPrice != null && snapshot.askPrice > 0) return snapshot.askPrice;
  return null;
}

interface ResolvedBackfillPrice {
  price: number;
  basis: Exclude<PaperSettlementBasis, "LIVE_MARKET">;
}

/**
 * 3-tier historical price resolution for one overdue-expired option position
 * — see the module doc's "EXPIRY SETTLEMENT BACKFILL" section for the full
 * rationale of each tier. `bhavcopyCache` is keyed by the position's own
 * expiry date (ISO string) so multiple positions sharing an expiry (or
 * multiple accounts holding the same contract) only fetch that date's
 * bhavcopy once.
 */
async function resolveBackfillPrice(
  position: OptionContractPosition,
  bhavcopyCache: Map<string, OptionUnderlyingSettlementSession | null>
): Promise<ResolvedBackfillPrice> {
  const expiryIso = isoDate(position.expiryDate);

  let bhavcopy = bhavcopyCache.get(expiryIso);
  if (bhavcopy === undefined) {
    bhavcopy = await fetchOptionUnderlyingSettlementPrices(position.expiryDate);
    bhavcopyCache.set(expiryIso, bhavcopy);
  }
  const underlyingPrice = bhavcopy?.underlyingPriceFor(position.underlyingSymbol, expiryIso) ?? null;
  if (underlyingPrice != null) {
    return { price: computeIntrinsicValue(position.optionType, underlyingPrice, position.strikePrice), basis: "HISTORICAL_EXCHANGE_CLOSE" };
  }

  const snapshot = await prisma.optionPremiumSnapshot.findFirst({
    where: {
      underlyingSymbol: position.underlyingSymbol,
      instrumentKind: position.instrumentKind,
      expiryDate: position.expiryDate,
      strikePrice: position.strikePrice,
      optionType: position.optionType,
      capturedAt: { lte: endOfIstDay(position.expiryDate) }
    },
    orderBy: { capturedAt: "desc" },
    select: { lastPrice: true, bidPrice: true, askPrice: true }
  });
  const snapshotPrice = snapshot ? resolveSnapshotPrice(snapshot) : null;
  if (snapshotPrice != null) {
    return { price: snapshotPrice, basis: "LAST_KNOWN_MARK" };
  }

  return { price: 0, basis: "ASSUMED_WORTHLESS" };
}

async function runBackfillSweep(
  todayExpiry: Date,
  now: Date,
  dryRun: boolean,
  result: OptionExpirySettlementRunResult
): Promise<void> {
  const accountsWithOverdueOptions = await prisma.paperOrder.findMany({
    where: { instrumentKind: { in: ["INDEX_OPTION", "STOCK_OPTION"] }, expiryDate: { lt: todayExpiry } },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  const bhavcopyCache = new Map<string, OptionUnderlyingSettlementSession | null>();

  for (const { accountId } of accountsWithOverdueOptions) {
    result.backfillAccountsScanned += 1;
    try {
      await backfillSettleAccount(accountId, todayExpiry, now, bhavcopyCache, dryRun, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-options-expiry] backfill for account ${accountId} failed:`, err);
    }
  }
}

async function backfillSettleAccount(
  accountId: string,
  todayExpiry: Date,
  now: Date,
  bhavcopyCache: Map<string, OptionUnderlyingSettlementSession | null>,
  dryRun: boolean,
  result: OptionExpirySettlementRunResult
): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];

  const overdue = overdueExpiredOptionPositions(orders, todayExpiry);
  if (overdue.length === 0) return;

  for (const position of overdue) {
    const { price, basis } = await resolveBackfillPrice(position, bhavcopyCache);

    const costs = computeOptionOrderCosts({
      side: "SELL",
      quantity: Math.abs(position.quantity),
      price,
      isExpirySettlement: true,
      intrinsicValue: price
    });

    // Same idempotency guard as the same-day path: re-verify from a fresh
    // read immediately before writing.
    const freshOrderRows = await prisma.paperOrder.findMany({
      where: {
        accountId,
        instrumentKind: position.instrumentKind,
        underlyingSymbol: position.underlyingSymbol,
        strikePrice: position.strikePrice,
        expiryDate: position.expiryDate,
        optionType: position.optionType
      },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const freshOrders = freshOrderRows as unknown as PaperEngineOrder[];
    const freshOpen = overdueExpiredOptionPositions(freshOrders, todayExpiry).find(
      (p) => p.strikePrice === position.strikePrice && p.optionType === position.optionType && p.instrumentKind === position.instrumentKind
    );
    if (!freshOpen || freshOpen.quantity === 0) continue; // already settled/closed since the initial read

    result.backfillBasisCounts[basis] += 1;
    result.backfillSettlements.push({
      accountId,
      underlyingSymbol: position.underlyingSymbol,
      instrumentKind: position.instrumentKind,
      optionType: position.optionType,
      strikePrice: position.strikePrice,
      expiryDate: isoDate(position.expiryDate),
      quantity: Math.abs(position.quantity),
      price,
      basis,
      netAmount: costs.netAmount
    });

    if (basis !== "HISTORICAL_EXCHANGE_CLOSE") {
      console.warn(
        `[cron/paper-trading-options-expiry] backfill ${position.underlyingSymbol} ${position.strikePrice}${position.optionType} (expired ${isoDate(position.expiryDate)}) settled via ${basis} fallback (₹${price.toFixed(2)}) for account ${accountId} — no historical bhavcopy match.`
      );
    }

    if (!dryRun) {
      await prisma.paperOrder.create({
        data: {
          accountId,
          symbol: freshOrderRows[0].symbol,
          side: "SELL",
          productType: null,
          quantity: Math.abs(position.quantity),
          fillPrice: price,
          fillTickAt: now,
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
          isSquareOff: true,
          autoSquaredOff: true,
          instrumentKind: position.instrumentKind,
          underlyingSymbol: position.underlyingSymbol,
          optionType: position.optionType,
          strikePrice: position.strikePrice,
          expiryDate: position.expiryDate,
          lotSize: position.lotSize,
          lots: position.lots,
          squareOffReason: "OPTION_EXPIRY_BACKFILL",
          settlementBasis: basis
        },
        select: { id: true }
      });
    }

    result.backfillPositionsSettled += 1;
  }
}

/**
 * Cancels every still-PENDING limit/stop order (INDEX_OPTION or STOCK_OPTION)
 * whose contract expiry is today-or-earlier — such an order can never
 * legitimately fill once the contract stops trading, and leaving it PENDING
 * forever would misrepresent it as still live. `resolutionNote` documents why
 * (see the schema doc's broadened scope for this field). Idempotent by
 * construction: a second run's WHERE clause only ever matches rows still in
 * PENDING status, so an already-cancelled row is never touched twice.
 */
async function cancelExpiredOptionPendingOrders(cutoffExpiryInclusive: Date, dryRun: boolean): Promise<number> {
  if (dryRun) {
    return prisma.paperPendingOrder.count({
      where: { instrumentKind: { in: ["INDEX_OPTION", "STOCK_OPTION"] }, status: "PENDING", expiryDate: { lte: cutoffExpiryInclusive } }
    });
  }
  const { count } = await prisma.paperPendingOrder.updateMany({
    where: { instrumentKind: { in: ["INDEX_OPTION", "STOCK_OPTION"] }, status: "PENDING", expiryDate: { lte: cutoffExpiryInclusive } },
    data: { status: "CANCELLED", cancelledAt: new Date(), resolutionNote: "Contract expired — order auto-cancelled." }
  });
  return count;
}
