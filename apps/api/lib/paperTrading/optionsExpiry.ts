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
 */

import { computeIntrinsicValue, computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { openExpiringPositions, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";

import { fetchOptionChain, type OptionUnderlying } from "@/lib/marketMoves/optionChain";
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar date, expressed as a UTC-midnight Date — matches exactly how PaperOrder.expiryDate is stored (see optionContract.ts's parseNseExpiryDate), so it can be used as a direct equality filter in the DB query below. */
function todayIstDateAsUtcMidnight(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

const YAHOO_INDEX_TICKER: Record<OptionUnderlying, string> = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK" };
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
  const ticker = YAHOO_INDEX_TICKER[underlying];
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

export interface OptionExpirySettlementRunResult {
  accountsScanned: number;
  positionsSettled: number;
  skippedNoSpot: number;
  usedSpotFallback: number;
  errors: number;
}

/**
 * Settles every account's open INDEX_OPTION positions expiring today (IST
 * calendar date). Never throws — per-account/per-contract failures are caught
 * and counted, matching every other cron route's contract in this app.
 */
export async function runOptionsExpirySettlement(now: Date = new Date()): Promise<OptionExpirySettlementRunResult> {
  const result: OptionExpirySettlementRunResult = {
    accountsScanned: 0,
    positionsSettled: 0,
    skippedNoSpot: 0,
    usedSpotFallback: 0,
    errors: 0
  };

  const todayExpiry = todayIstDateAsUtcMidnight(now);

  const accountsWithExpiringOptionsToday = await prisma.paperOrder.findMany({
    where: { instrumentKind: "INDEX_OPTION", expiryDate: todayExpiry },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  // Spot value (and whether it came from the live chain or the fallback) is the
  // same for every position under the same underlying today — fetched once per
  // underlying per run, not once per account/position.
  const spotCache = new Map<OptionUnderlying, { spot: number; usedFallback: boolean } | null>();

  for (const { accountId } of accountsWithExpiringOptionsToday) {
    result.accountsScanned += 1;
    try {
      await settleAccount(accountId, now, todayExpiry, spotCache, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-options-expiry] account ${accountId} failed:`, err);
    }
  }

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
        squareOffReason: "OPTION_EXPIRY"
      }
    });

    result.positionsSettled += 1;
  }
}
