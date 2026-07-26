/**
 * Limit Orders (Sprint, 2026-07-26) — fill-check + day-expiry orchestration
 * for POST /api/cron/paper-trading-limit-fill (T4/T5).
 *
 * Two independently self-gated jobs live in this one file/cron/CRON_SECRET
 * entry (per the brief's own suggestion — "the former avoids a second
 * CRON_SECRET entry"):
 *
 *   - runLimitOrderFillCheck: evaluates every PENDING PaperPendingOrder
 *     against the latest available quote and fills the ones whose limit has
 *     crossed. Self-gates on isNseWeekdayMarketHours() — a no-op outside
 *     market hours regardless of when the crontab actually fires.
 *   - runPendingOrderExpirySweep: marks every still-PENDING row EXPIRED once
 *     the session is at/past close (15:20 IST, matching
 *     paper-trading-squareoff's cadence per the brief's "fold into the
 *     existing 15:20 IST family" guidance). Self-gates on IST clock time, so
 *     an early-day call (or a delayed/failed prior run) can never wipe out a
 *     still-live pending order.
 *
 * Cross-app note (read before "fixing" this to call apps/web's placeOrder/
 * placeOptionOrder): apps/web cannot be called from apps/api except over
 * HTTP, and apps/web's order routes are session-cookie-authenticated (no
 * service-to-service auth exists for them) — there is no way for an
 * unattended cron to invoke them on a user's behalf. This is NOT a new
 * constraint this feature introduces: EVERY existing apps/api cron in this
 * domain (paper-trading-squareoff, paper-trading-options-expiry,
 * paper-trading-stock-options-squareoff, the futures MTM/expiry crons)
 * already writes PaperOrder rows directly via Prisma, using the shared PURE
 * cost-engine functions from packages/business-rules — never by calling
 * apps/web's routes. "The exact same cost/fill orchestration a market order
 * uses" (the brief's T4 wording) is satisfied at the level that actually
 * matters and is architecturally possible: the IDENTICAL shared
 * computeOrderCosts/computeOptionOrderCosts call with fillPrice = limitPrice,
 * writing a PaperOrder row of the identical shape a market order writes —
 * exactly the precedent every prior cron in this file's sibling files
 * already established, not a new pattern invented for this sprint.
 */

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";
import { computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { isLimitCrossed } from "@predict-future/business-rules/papertrading/pendingOrders";
import { isFirstDeliverySellOfScripToday, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import type { PaperPendingOrder } from "@prisma/client";

import { fetchIntradaySeries } from "@/lib/marketMoves/intraday";
import { fetchOptionChain, type OptionChainSnapshot } from "@/lib/marketMoves/optionChain";
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST minutes-since-midnight for an instant — reused by the expiry cutoff below. Duplicated (not imported) from marketHours.ts's identical private helper, per this domain's established "small pure math, duplicated per file" convention (see marketHours.ts's own module doc). */
function istMinutesSinceMidnight(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** 15:20 IST — the same forced-close slot paper-trading-squareoff uses. A PENDING order is only ever expired once the session has reached this point, never earlier (see the module doc). */
const PENDING_ORDER_EXPIRY_CUTOFF_MINUTES = 15 * 60 + 20;

function isPastPendingOrderExpiryCutoff(now: Date): boolean {
  return istMinutesSinceMidnight(now) >= PENDING_ORDER_EXPIRY_CUTOFF_MINUTES;
}

/** IST midnight of "today" (server clock), expressed as a UTC instant — duplicated from squareoff.ts's identical private helper (same file-local convention this domain already established). Used to scope BOTH the fill-check (never fill a stale prior-day row) and the expiry sweep (always self-heal a stale prior-day row, regardless of the 15:20 cutoff). */
function todayIstMidnightUtc(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

export interface LimitFillRunResult {
  ranFillCheck: boolean;
  pendingScanned: number;
  filled: number;
  skippedNoQuote: number;
  skippedNotCrossed: number;
  skippedAlreadyResolved: number;
  errors: number;
}

/**
 * Evaluates every PENDING PaperPendingOrder against the latest available
 * quote and fills the ones whose limit has crossed. No-ops (returns
 * `ranFillCheck: false`) outside NSE weekday market hours.
 */
export async function runLimitOrderFillCheck(now: Date = new Date()): Promise<LimitFillRunResult> {
  const result: LimitFillRunResult = {
    ranFillCheck: false,
    pendingScanned: 0,
    filled: 0,
    skippedNoQuote: 0,
    skippedNotCrossed: 0,
    skippedAlreadyResolved: 0,
    errors: 0
  };

  if (!isNseWeekdayMarketHours(now)) return result;
  result.ranFillCheck = true;

  // DAY validity means a PENDING row is only ever eligible to fill on the
  // SAME IST calendar day it was placed — a stale row that somehow survived
  // past its own day's expiry sweep (an ops outage, a missed cron run) must
  // never fill against a LATER day's price. It's left for
  // runPendingOrderExpirySweep's self-healing branch below to clean up.
  const pendingRows = await prisma.paperPendingOrder.findMany({
    where: { status: "PENDING", createdAt: { gte: todayIstMidnightUtc(now) } }
  });
  result.pendingScanned = pendingRows.length;
  if (pendingRows.length === 0) return result;

  // Bounded, deduped quote fetching — one fetch per distinct symbol (equity)
  // or (underlying, expiry) pair (options), shared across every pending row
  // that needs it this run, per the brief's "bounded work per run" mandate.
  const ltpCache = new Map<string, number | null>();
  const chainCache = new Map<string, OptionChainSnapshot | null>();

  for (const row of pendingRows) {
    try {
      const quote = await resolveLatestQuote(row, ltpCache, chainCache);
      if (quote == null) {
        result.skippedNoQuote += 1;
        continue;
      }
      if (!isLimitCrossed(row.side, row.limitPrice, quote)) {
        result.skippedNotCrossed += 1;
        continue;
      }

      const filled = await fillPendingOrder(row, now);
      if (filled) result.filled += 1;
      else result.skippedAlreadyResolved += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-limit-fill] pending order ${row.id} failed:`, err);
    }
  }

  return result;
}

async function resolveLatestQuote(
  row: PaperPendingOrder,
  ltpCache: Map<string, number | null>,
  chainCache: Map<string, OptionChainSnapshot | null>
): Promise<number | null> {
  if (row.instrumentKind === "EQUITY") {
    if (!ltpCache.has(row.symbol)) {
      const series = await fetchIntradaySeries(row.symbol);
      const lastTick = series?.points.at(-1);
      ltpCache.set(row.symbol, lastTick ? lastTick.price : null);
    }
    return ltpCache.get(row.symbol) ?? null;
  }

  // INDEX_OPTION | STOCK_OPTION
  if (!row.underlyingSymbol || !row.expiryDate || row.strikePrice == null || !row.optionType) return null;
  const expiryStr = formatNseExpiryDate(row.expiryDate);
  const chainKey = `${row.underlyingSymbol}::${expiryStr}`;
  if (!chainCache.has(chainKey)) {
    const chain = await fetchOptionChain(row.underlyingSymbol, expiryStr);
    chainCache.set(chainKey, chain);
  }
  const chain = chainCache.get(chainKey);
  if (!chain) return null;

  const strikeRow = chain.strikes.find((s) => s.strikePrice === row.strikePrice);
  const quote = row.optionType === "CE" ? strikeRow?.CE : strikeRow?.PE;
  return quote?.lastPrice ?? null;
}

/**
 * Converts one crossed pending order into a real PaperOrder fill, at
 * fillPrice = limitPrice, through the SAME cost-engine call a market order
 * uses (see the module doc's cross-app note). Returns false (a clean no-op,
 * not an error) if the row was already resolved by a concurrent
 * cancellation/fill between the initial read and here — the standard
 * "re-verify immediately before writing" idempotency guard every other cron
 * in this domain already uses.
 */
async function fillPendingOrder(row: PaperPendingOrder, now: Date): Promise<boolean> {
  const fresh = await prisma.paperPendingOrder.findUnique({ where: { id: row.id } });
  if (!fresh || fresh.status !== "PENDING") return false;

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: row.accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as unknown as PaperEngineOrder[];

  const costs =
    row.instrumentKind === "EQUITY"
      ? computeOrderCosts({
          side: row.side,
          productType: row.productType ?? "DELIVERY",
          quantity: row.quantity,
          price: row.limitPrice,
          isFirstDeliverySellOfScripToday:
            row.productType === "DELIVERY" && row.side === "SELL"
              ? isFirstDeliverySellOfScripToday(existingOrders, row.symbol, now)
              : false
        })
      : computeOptionOrderCosts({ side: row.side, quantity: row.quantity, price: row.limitPrice });

  // Interactive transaction (not the array form) — the pending row's update
  // needs the newly-created PaperOrder's id, which only exists after the
  // create resolves.
  await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.paperOrder.create({
      data: {
        accountId: row.accountId,
        symbol: row.symbol,
        side: row.side,
        productType: row.instrumentKind === "EQUITY" ? row.productType : null,
        quantity: row.quantity,
        fillPrice: row.limitPrice,
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
        linkedOpinionId: row.linkedOpinionId,
        instrumentKind: row.instrumentKind,
        underlyingSymbol: row.underlyingSymbol,
        optionType: row.optionType,
        strikePrice: row.strikePrice,
        expiryDate: row.expiryDate,
        lotSize: row.lotSize,
        lots: row.lots
      },
      select: { id: true }
    });

    await tx.paperPendingOrder.update({
      where: { id: row.id },
      data: { status: "FILLED", filledAt: now, filledOrderId: createdOrder.id }
    });
  });

  return true;
}

export interface PendingOrderExpiryRunResult {
  ranExpirySweep: boolean;
  expiredToday: number;
  /** A PENDING row created on an EARLIER IST day than `now` — should never exist under normal operation (every prior day's sweep should have caught it), but is always swept regardless of the 15:20 cutoff as a self-healing catch-up (e.g. after a cron outage) — see the module doc. */
  expiredStale: number;
}

/**
 * Marks every still-PENDING order EXPIRED. Two independent clauses:
 *  - Rows from TODAY (IST) only expire once the session is at/past the 15:20
 *    IST cutoff — DAY validity's honest definition of "session close".
 *  - Rows from an EARLIER day are ALWAYS expired immediately, any time this
 *    runs, regardless of clock time — a stale leftover is a self-healing
 *    catch-up, not something to wait for another 15:20 slot to clean up.
 * Idempotent — an empty PENDING set after the first run of the day is a
 * cheap no-op on every subsequent call — safe to invoke on every fill-check
 * cron tick rather than needing a dedicated crontab entry.
 */
export async function runPendingOrderExpirySweep(now: Date = new Date()): Promise<PendingOrderExpiryRunResult> {
  const todayStart = todayIstMidnightUtc(now);

  const stale = await prisma.paperPendingOrder.updateMany({
    where: { status: "PENDING", createdAt: { lt: todayStart } },
    data: { status: "EXPIRED", expiredAt: now }
  });

  if (!isPastPendingOrderExpiryCutoff(now)) {
    return { ranExpirySweep: stale.count > 0, expiredToday: 0, expiredStale: stale.count };
  }

  const today = await prisma.paperPendingOrder.updateMany({
    where: { status: "PENDING", createdAt: { gte: todayStart } },
    data: { status: "EXPIRED", expiredAt: now }
  });

  return { ranExpirySweep: true, expiredToday: today.count, expiredStale: stale.count };
}
