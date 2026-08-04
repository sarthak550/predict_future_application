/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T9) — expiry
 * cash-settlement orchestration for POST /api/cron/paper-trading-futures-expiry.
 *
 * Index futures are cash-settled at the exchange-computed final settlement
 * price on expiry day — no broker order is ever placed for this, so it's
 * priced with ZERO brokerage (same "automatic exchange-driven event" posture
 * as Phase 2's index-option cash settlement) but full sell-side STT on the
 * settlement-value turnover (futuresCosts.ts's leg-type dispatch, path 2).
 *
 * MUST run AFTER the daily-MTM cron on expiry days (see the Phase 4 brief:
 * "by this point the MTM cron has already marked the position to today's
 * price, so this leg is mostly a zero-incremental-P&L position-closing/
 * margin-release event, not a large final payout — that's correct and
 * expected, not a bug"). See the route file for the exact crontab ordering.
 *
 * netAmount derivation mirrors futuresDailyMtm.ts's margin-call leg exactly
 * (realized P&L on the closed quantity vs. referencePrice, minus totalCosts,
 * sign-adjusted for deriveCash's side convention) — see that file's module
 * doc, and lib/paperTrading/futuresOrders.ts's (T7, apps/web) doc for the
 * full original derivation.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * EXPIRY SETTLEMENT BACKFILL (2026-08-04) — see optionsExpiry.ts's identical
 * addition (same module doc section header) for the full founder-bug/root-
 * cause writeup; the short version: this cron was written but never
 * installed on the production crontab, and even once installed, its original
 * same-day-only design (`expiryDate === today`) could never retroactively
 * catch a contract that expired on an earlier day it didn't run. Fixed the
 * same way as the options side: this cron now ALSO sweeps every OPEN
 * INDEX_FUTURE position whose expiry is STRICTLY IN THE PAST, every run,
 * runs it FIRST and independent of whether TODAY's own bhavcopy has
 * published yet (a backfilled position is priced from ITS OWN past expiry
 * date's bhavcopy, an entirely separate fetch/date from today's).
 *
 * Historical price resolution, 2 tiers (no ASSUMED_WORTHLESS tier here —
 * unlike an option, a future's referencePrice is always a real number, never
 * an "unknown/worthless" state, so tier 2 always succeeds):
 *   1. HISTORICAL_EXCHANGE_CLOSE — fetchIndexFuturesSettlementPrices for the
 *      CONTRACT'S OWN expiry date (this function was already fully date-
 *      parametrized, proven working for arbitrary past dates since Sprint 1 —
 *      no change needed to it, only to how this cron calls it).
 *   2. LAST_KNOWN_MARK — if that historical bhavcopy is unobtainable: settle
 *      at the position's own current `referencePrice` (its last daily-MTM
 *      mark, or entry price if never marked) — i.e. a flat close realizing no
 *      further P&L beyond what's already on record, rather than fabricating
 *      a number with no basis.
 *
 * Also cancels any still-PENDING order resting on an INDEX_FUTURE contract
 * whose expiry is today-or-earlier — see cancelExpiredFuturesPendingOrders.
 *
 * Idempotent by construction, same fresh-re-read-before-write guard as every
 * other cron in this family.
 *
 * dryRun: computes and returns everything a live run would settle/cancel
 * WITHOUT writing anything — see the route file.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * REAL BUG FOUND + FIXED 2026-08-04, INDEPENDENT OF THE CRONTAB GAP ABOVE
 * ══════════════════════════════════════════════════════════════════════════
 * See todayIstDateAsUtcMidnight's own doc comment below for the full numeric
 * proof: the same-day account-lookup query used to compare PaperOrder.expiryDate
 * against marketMoves/marketHours.ts's getIstSessionDate(now) — a UTC instant
 * 5.5 hours off from how expiryDate is actually stored (parseNseExpiryDate's
 * UTC-midnight-of-calendar-date). An exact Prisma equality filter on two
 * never-equal Date shapes meant this cron's same-day settlement path had
 * NEVER matched a single real position since it shipped (Sprint 2,
 * 2026-07-26) — completely independent of whether the crontab was installed.
 * Fixed by using the correct UTC-midnight shape for every expiryDate
 * comparison in this file.
 */

import { computeFuturesOrderCosts } from "@predict-future/business-rules/papertrading/futuresCosts";
import { formatFuturesContractSymbol } from "@predict-future/business-rules/papertrading/futuresContract";
import {
  deriveOpenFuturesPositions,
  openExpiringFuturesPositions,
  overdueExpiredFuturesPositions,
  type FuturesContractPosition,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import type { TxSide } from "@prisma/client";

import { fetchIndexFuturesSettlementPrices, type IndexFuturesSettlementSession } from "@/lib/marketMoves/foBhavcopy";
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

/**
 * Today's IST calendar date, expressed as a UTC-midnight Date — matches
 * exactly how PaperOrder.expiryDate is stored (see optionContract.ts's
 * parseNseExpiryDate, and optionsExpiry.ts's identical private helper).
 *
 * REAL PRE-EXISTING BUG, found and fixed 2026-08-04: this cron previously
 * used marketMoves/marketHours.ts's `getIstSessionDate` for its `expiryDate`
 * DB queries — that function returns a DIFFERENT UTC instant for "today"
 * (IST-midnight expressed as a UTC instant, i.e. 18:30 UTC the PRIOR day),
 * legitimately correct for its OWN designed purpose elsewhere in this
 * codebase (session-scoping real timestamps like `createdAt`) but NOT
 * bit-for-bit equal to how `expiryDate` is actually stored — confirmed by
 * direct comparison: `parseNseExpiryDate("28-Aug-2026")` and
 * `getIstSessionDate` on 28-Aug-2026 differ by 5.5 hours and are never
 * `.getTime()`-equal. Since `accountsWithExpiringFuturesToday` below used an
 * EXACT Prisma equality filter (`expiryDate: sessionDate`), this meant the
 * same-day settlement sweep had NEVER matched a single real position since
 * Sprint 2 shipped (2026-07-26) — `settlementAvailable` could be true and
 * `positionsSettled` would still always be 0. (The REPLAY-layer functions
 * openExpiringFuturesPositions/overdueExpiredFuturesPositions were NOT
 * affected — they compare IST CALENDAR DAY NUMBERS, which self-correct
 * regardless of which UTC-instant shape is passed in — so this bug was
 * invisible to any pure-function unit test and only showed up in the DB
 * query shape. Fixed by using this file-local helper, matching the sibling
 * option crons' own convention, for every `expiryDate` comparison in this
 * file; `fetchIndexFuturesSettlementPrices` still works identically either
 * way (foBhavcopy.ts's own IST-shift math round-trips correctly for both
 * date shapes — verified numerically before this fix shipped).
 */
function todayIstDateAsUtcMidnight(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Same sign-inversion helper as futuresOrders.ts (T7) / futuresDailyMtm.ts (T8) — deriveCash: `cash += side === "SELL" ? netAmount : -netAmount`. */
function signedNetAmountForCashEffect(side: TxSide, cashEffect: number): number {
  return side === "SELL" ? cashEffect : -cashEffect;
}

function isoExpiry(expiryDate: Date): string {
  return expiryDate.toISOString().slice(0, 10);
}

export interface BackfillFuturesSettlementDetail {
  accountId: string;
  underlyingSymbol: string;
  expiryDate: string;
  quantity: number;
  price: number;
  basis: "HISTORICAL_EXCHANGE_CLOSE" | "LAST_KNOWN_MARK";
  netAmount: number;
}

export interface FuturesExpirySettlementRunResult {
  dryRun: boolean;
  settlementAvailable: boolean;
  accountsScanned: number;
  positionsSettled: number;
  skippedNoSettlement: number;
  backfillAccountsScanned: number;
  backfillPositionsSettled: number;
  backfillBasisCounts: Record<"HISTORICAL_EXCHANGE_CLOSE" | "LAST_KNOWN_MARK", number>;
  backfillSettlements: BackfillFuturesSettlementDetail[];
  pendingOrdersCancelled: number;
  errors: number;
}

export interface RunFuturesExpirySettlementOptions {
  /** When true, computes and returns everything a live run would do WITHOUT writing any settlement leg or cancelling any pending order. See the module doc's "EXPIRY SETTLEMENT BACKFILL" section. */
  dryRun?: boolean;
}

/**
 * Settles every account's open INDEX_FUTURE positions expiring today (IST
 * calendar date) at the day's real bhavcopy settlement price, backfills any
 * position whose expiry has already passed, and cancels stale pending orders
 * on expired contracts. Never throws — per-account/per-contract failures are
 * caught and counted. `settlementAvailable` reflects ONLY today's own
 * bhavcopy (false when it isn't published yet — not an error); the backfill
 * sweep runs regardless, since it fetches its own distinct historical dates.
 */
export async function runFuturesExpirySettlement(
  now: Date = new Date(),
  options: RunFuturesExpirySettlementOptions = {}
): Promise<FuturesExpirySettlementRunResult> {
  const dryRun = options.dryRun ?? false;
  const result: FuturesExpirySettlementRunResult = {
    dryRun,
    settlementAvailable: false,
    accountsScanned: 0,
    positionsSettled: 0,
    skippedNoSettlement: 0,
    backfillAccountsScanned: 0,
    backfillPositionsSettled: 0,
    backfillBasisCounts: { HISTORICAL_EXCHANGE_CLOSE: 0, LAST_KNOWN_MARK: 0 },
    backfillSettlements: [],
    pendingOrdersCancelled: 0,
    errors: 0
  };

  const todayExpiry = todayIstDateAsUtcMidnight(now);

  // ── Backfill sweep FIRST — independent of whether TODAY's bhavcopy is
  // published (each overdue position fetches its OWN past expiry date). ──
  await runFuturesBackfillSweep(todayExpiry, now, dryRun, result);

  // ── Same-day sweep (Sprint 2's original mechanism — the account-lookup
  // query below was silently broken until this fix, see
  // todayIstDateAsUtcMidnight's doc comment). ──
  const settlement = await fetchIndexFuturesSettlementPrices(todayExpiry);
  if (settlement) {
    result.settlementAvailable = true;

    const accountsWithExpiringFuturesToday = await prisma.paperOrder.findMany({
      where: { instrumentKind: "INDEX_FUTURE", expiryDate: todayExpiry },
      select: { accountId: true },
      distinct: ["accountId"]
    });

    for (const { accountId } of accountsWithExpiringFuturesToday) {
      result.accountsScanned += 1;
      try {
        await settleAccount(accountId, todayExpiry, settlement, now, dryRun, result);
      } catch (err) {
        result.errors += 1;
        console.error(`[cron/paper-trading-futures-expiry] account ${accountId} failed:`, err);
      }
    }
  }

  // ── Cancel any pending order resting on a contract expiring today-or-earlier. ──
  result.pendingOrdersCancelled = await cancelExpiredFuturesPendingOrders(todayExpiry, dryRun);

  return result;
}

async function settleAccount(
  accountId: string,
  todayExpiry: Date,
  settlement: IndexFuturesSettlementSession,
  now: Date,
  dryRun: boolean,
  result: FuturesExpirySettlementRunResult
): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];

  const expiringToday = openExpiringFuturesPositions(orders, todayExpiry);
  if (expiringToday.length === 0) return; // already settled/closed (e.g. by a margin call) — no-op

  for (const position of expiringToday) {
    const settlementPrice = settlement.settlementPriceFor(position.underlyingSymbol, isoExpiry(position.expiryDate));
    if (settlementPrice == null) {
      result.skippedNoSettlement += 1;
      console.warn(
        `[cron/paper-trading-futures-expiry] no settlement price for ${position.underlyingSymbol} (expiry ${isoExpiry(position.expiryDate)}) — leaving account ${accountId}'s position open, will retry next run.`
      );
      continue;
    }

    const side: TxSide = position.quantity > 0 ? "SELL" : "BUY";
    const closingQty = Math.abs(position.quantity);

    // Path 2 (index expiry cash-settlement): brokerage = 0, sell-side STT on
    // settlement-value turnover — via isExpirySettlement, NOT the manual/
    // margin-call full-cost path. See futuresCosts.ts's leg-type dispatch.
    const costs = computeFuturesOrderCosts({
      side,
      quantity: closingQty,
      price: settlementPrice,
      isExpirySettlement: true,
      settlementPrice
    });

    // Re-verify the position is STILL open immediately before writing —
    // idempotency guard against a concurrent manual close or a re-run of
    // this same cron, exactly matching optionsExpiry.ts's / stockOptionSquareOff.ts's identical pattern.
    const freshOrderRows = await prisma.paperOrder.findMany({
      where: { accountId, instrumentKind: "INDEX_FUTURE", underlyingSymbol: position.underlyingSymbol, expiryDate: position.expiryDate },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const freshOrders = freshOrderRows as unknown as PaperEngineOrder[];
    const freshOpen = deriveOpenFuturesPositions(freshOrders).find(
      (p) => p.underlyingSymbol === position.underlyingSymbol && p.expiryDate.getTime() === position.expiryDate.getTime()
    );
    if (!freshOpen || freshOpen.quantity === 0) continue; // already settled/closed since the initial read

    const directionSign = Math.sign(freshOpen.quantity);
    const realizedPnlThisLeg = Math.abs(freshOpen.quantity) * (settlementPrice - freshOpen.referencePrice) * directionSign;
    const netAmount = signedNetAmountForCashEffect(side, realizedPnlThisLeg - costs.totalCosts);

    if (!dryRun) {
      await prisma.paperOrder.create({
        data: {
          accountId,
          symbol: formatFuturesContractSymbol(freshOpen.underlyingSymbol, freshOpen.expiryDate),
          side,
          productType: null,
          quantity: Math.abs(freshOpen.quantity),
          fillPrice: settlementPrice,
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
          netAmount,
          instrumentKind: "INDEX_FUTURE",
          underlyingSymbol: freshOpen.underlyingSymbol,
          optionType: null,
          strikePrice: null,
          expiryDate: freshOpen.expiryDate,
          lotSize: freshOpen.lotSize,
          lots: freshOpen.lots,
          isSquareOff: true,
          autoSquaredOff: true,
          squareOffReason: "FUTURES_EXPIRY_SETTLEMENT",
          settlementBasis: "LIVE_MARKET",
          isDailyMtm: false
        },
        select: { id: true }
      });
    }

    result.positionsSettled += 1;
  }
}

// ─── Expiry Settlement Backfill (2026-08-04) ──────────────────────────────

interface ResolvedFuturesBackfillPrice {
  price: number;
  basis: "HISTORICAL_EXCHANGE_CLOSE" | "LAST_KNOWN_MARK";
}

/**
 * 2-tier historical price resolution for one overdue-expired futures
 * position — see the module doc's "EXPIRY SETTLEMENT BACKFILL" section.
 * `bhavcopyCache` is keyed by the position's own expiry date (ISO string,
 * which for a futures contract IS its last trading day) so multiple
 * positions/accounts sharing an expiry only fetch that date's bhavcopy once.
 */
async function resolveFuturesBackfillPrice(
  position: FuturesContractPosition,
  bhavcopyCache: Map<string, IndexFuturesSettlementSession | null>
): Promise<ResolvedFuturesBackfillPrice> {
  const expiryIso = isoExpiry(position.expiryDate);

  let bhavcopy = bhavcopyCache.get(expiryIso);
  if (bhavcopy === undefined) {
    bhavcopy = await fetchIndexFuturesSettlementPrices(position.expiryDate);
    bhavcopyCache.set(expiryIso, bhavcopy);
  }
  const settlementPrice = bhavcopy?.settlementPriceFor(position.underlyingSymbol, expiryIso) ?? null;
  if (settlementPrice != null) {
    return { price: settlementPrice, basis: "HISTORICAL_EXCHANGE_CLOSE" };
  }

  return { price: position.referencePrice, basis: "LAST_KNOWN_MARK" };
}

async function runFuturesBackfillSweep(
  todayExpiry: Date,
  now: Date,
  dryRun: boolean,
  result: FuturesExpirySettlementRunResult
): Promise<void> {
  const accountsWithOverdueFutures = await prisma.paperOrder.findMany({
    where: { instrumentKind: "INDEX_FUTURE", expiryDate: { lt: todayExpiry } },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  const bhavcopyCache = new Map<string, IndexFuturesSettlementSession | null>();

  for (const { accountId } of accountsWithOverdueFutures) {
    result.backfillAccountsScanned += 1;
    try {
      await backfillSettleAccount(accountId, todayExpiry, now, bhavcopyCache, dryRun, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-futures-expiry] backfill for account ${accountId} failed:`, err);
    }
  }
}

async function backfillSettleAccount(
  accountId: string,
  todayExpiry: Date,
  now: Date,
  bhavcopyCache: Map<string, IndexFuturesSettlementSession | null>,
  dryRun: boolean,
  result: FuturesExpirySettlementRunResult
): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];

  const overdue = overdueExpiredFuturesPositions(orders, todayExpiry);
  if (overdue.length === 0) return;

  for (const position of overdue) {
    const { price, basis } = await resolveFuturesBackfillPrice(position, bhavcopyCache);

    const side: TxSide = position.quantity > 0 ? "SELL" : "BUY";
    const closingQty = Math.abs(position.quantity);

    const costs = computeFuturesOrderCosts({
      side,
      quantity: closingQty,
      price,
      isExpirySettlement: true,
      settlementPrice: price
    });

    // Same idempotency guard as the same-day path.
    const freshOrderRows = await prisma.paperOrder.findMany({
      where: { accountId, instrumentKind: "INDEX_FUTURE", underlyingSymbol: position.underlyingSymbol, expiryDate: position.expiryDate },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const freshOrders = freshOrderRows as unknown as PaperEngineOrder[];
    const freshOpen = overdueExpiredFuturesPositions(freshOrders, todayExpiry).find(
      (p) => p.underlyingSymbol === position.underlyingSymbol && p.expiryDate.getTime() === position.expiryDate.getTime()
    );
    if (!freshOpen || freshOpen.quantity === 0) continue; // already settled/closed since the initial read

    const directionSign = Math.sign(freshOpen.quantity);
    const realizedPnlThisLeg = Math.abs(freshOpen.quantity) * (price - freshOpen.referencePrice) * directionSign;
    const netAmount = signedNetAmountForCashEffect(side, realizedPnlThisLeg - costs.totalCosts);

    result.backfillBasisCounts[basis] += 1;
    result.backfillSettlements.push({
      accountId,
      underlyingSymbol: position.underlyingSymbol,
      expiryDate: isoExpiry(position.expiryDate),
      quantity: closingQty,
      price,
      basis,
      netAmount
    });

    if (basis !== "HISTORICAL_EXCHANGE_CLOSE") {
      console.warn(
        `[cron/paper-trading-futures-expiry] backfill ${position.underlyingSymbol} (expired ${isoExpiry(position.expiryDate)}) settled via ${basis} fallback (₹${price.toFixed(2)}) for account ${accountId} — no historical bhavcopy match.`
      );
    }

    if (!dryRun) {
      await prisma.paperOrder.create({
        data: {
          accountId,
          symbol: formatFuturesContractSymbol(freshOpen.underlyingSymbol, freshOpen.expiryDate),
          side,
          productType: null,
          quantity: closingQty,
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
          netAmount,
          instrumentKind: "INDEX_FUTURE",
          underlyingSymbol: freshOpen.underlyingSymbol,
          optionType: null,
          strikePrice: null,
          expiryDate: freshOpen.expiryDate,
          lotSize: freshOpen.lotSize,
          lots: freshOpen.lots,
          isSquareOff: true,
          autoSquaredOff: true,
          squareOffReason: "FUTURES_EXPIRY_BACKFILL",
          settlementBasis: basis,
          isDailyMtm: false
        },
        select: { id: true }
      });
    }

    result.backfillPositionsSettled += 1;
  }
}

/**
 * Cancels every still-PENDING order (INDEX_FUTURE) whose contract expiry is
 * today-or-earlier — mirrors optionsExpiry.ts's cancelExpiredOptionPendingOrders
 * exactly. Idempotent: a second run's WHERE only ever matches rows still
 * PENDING.
 */
async function cancelExpiredFuturesPendingOrders(cutoffExpiryInclusive: Date, dryRun: boolean): Promise<number> {
  if (dryRun) {
    return prisma.paperPendingOrder.count({
      where: { instrumentKind: "INDEX_FUTURE", status: "PENDING", expiryDate: { lte: cutoffExpiryInclusive } }
    });
  }
  const { count } = await prisma.paperPendingOrder.updateMany({
    where: { instrumentKind: "INDEX_FUTURE", status: "PENDING", expiryDate: { lte: cutoffExpiryInclusive } },
    data: { status: "CANCELLED", cancelledAt: new Date(), resolutionNote: "Contract expired — order auto-cancelled." }
  });
  return count;
}
