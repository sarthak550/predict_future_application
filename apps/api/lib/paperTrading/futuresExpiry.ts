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
 */

import { computeFuturesOrderCosts } from "@predict-future/business-rules/papertrading/futuresCosts";
import { formatFuturesContractSymbol } from "@predict-future/business-rules/papertrading/futuresContract";
import {
  deriveOpenFuturesPositions,
  openExpiringFuturesPositions,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import type { TxSide } from "@prisma/client";

import { fetchIndexFuturesSettlementPrices, type IndexFuturesSettlementSession } from "@/lib/marketMoves/foBhavcopy";
import { getIstSessionDate } from "@/lib/marketMoves/marketHours";
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

/** Same sign-inversion helper as futuresOrders.ts (T7) / futuresDailyMtm.ts (T8) — deriveCash: `cash += side === "SELL" ? netAmount : -netAmount`. */
function signedNetAmountForCashEffect(side: TxSide, cashEffect: number): number {
  return side === "SELL" ? cashEffect : -cashEffect;
}

function isoExpiry(expiryDate: Date): string {
  return expiryDate.toISOString().slice(0, 10);
}

export interface FuturesExpirySettlementRunResult {
  settlementAvailable: boolean;
  accountsScanned: number;
  positionsSettled: number;
  skippedNoSettlement: number;
  errors: number;
}

/**
 * Settles every account's open INDEX_FUTURE positions expiring today (IST
 * calendar date) at the day's real bhavcopy settlement price. Never throws —
 * per-account/per-contract failures are caught and counted. Returns
 * `settlementAvailable: false` (not an error) when today's F&O bhavcopy
 * isn't published yet.
 */
export async function runFuturesExpirySettlement(now: Date = new Date()): Promise<FuturesExpirySettlementRunResult> {
  const result: FuturesExpirySettlementRunResult = {
    settlementAvailable: false,
    accountsScanned: 0,
    positionsSettled: 0,
    skippedNoSettlement: 0,
    errors: 0
  };

  const sessionDate = getIstSessionDate(now);
  const settlement = await fetchIndexFuturesSettlementPrices(sessionDate);
  if (!settlement) return result;
  result.settlementAvailable = true;

  const accountsWithExpiringFuturesToday = await prisma.paperOrder.findMany({
    where: { instrumentKind: "INDEX_FUTURE", expiryDate: sessionDate },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  for (const { accountId } of accountsWithExpiringFuturesToday) {
    result.accountsScanned += 1;
    try {
      await settleAccount(accountId, sessionDate, settlement, now, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-futures-expiry] account ${accountId} failed:`, err);
    }
  }

  return result;
}

async function settleAccount(
  accountId: string,
  sessionDate: Date,
  settlement: IndexFuturesSettlementSession,
  now: Date,
  result: FuturesExpirySettlementRunResult
): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];

  const expiringToday = openExpiringFuturesPositions(orders, sessionDate);
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
        isDailyMtm: false
      }
    });

    result.positionsSettled += 1;
  }
}
