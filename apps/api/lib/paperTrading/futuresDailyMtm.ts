/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T8) — daily mark-to-market
 * + margin-call square-off orchestration for
 * POST /api/cron/paper-trading-futures-daily-mtm.
 *
 * Runs once per trading day, after the F&O bhavcopy publishes. For every
 * account with an open INDEX_FUTURE position:
 *   1. Writes one `isDailyMtm: true` cash-only leg per open contract, marking
 *      it to today's real bhavcopy settlement price (see foBhavcopy.ts).
 *   2. Using the SAME settlement prices already fetched (no second data call —
 *      per the Phase 4 brief), recomputes the account's margin headroom and,
 *      if negative, force-closes EVERY open futures position on that account
 *      (whole-account square-off — see the brief's margin-decision section
 *      (c) for why this is deliberately not a selective/partial liquidation).
 *
 * All pure position/cost/margin math lives in packages/business-rules — this
 * file is DB + upstream-bhavcopy orchestration only, mirroring
 * lib/paperTrading/optionsExpiry.ts's and stockOptionSquareOff.ts's shape.
 *
 * ═══ MTM leg netAmount ═══════════════════════════════════════════════════
 * Signed variation margin: `(settlementPrice - referencePriceBeforeThisMark)
 * * signedQuantity` — stored DIRECTLY as netAmount (isDailyMtm legs are
 * exempted from deriveCash's side-based sign convention, see replay.ts's
 * doc comment on deriveCash). This is exactly what the Phase 4 brief
 * specifies and needs no further reasoning.
 *
 * ═══ Margin-call forced-close leg netAmount ═════════════════════════════
 * A DIFFERENT leg type from the MTM mark above — a real RMS-placed market
 * order, full cost path (computeFuturesOrderCosts, NOT zeroDailyMtmCosts —
 * see futuresCosts.ts's leg-type-dispatch doc, "do not copy path 2's cost
 * treatment here"). Its netAmount is NOT computeFuturesOrderCosts's own
 * `.netAmount` field (which assumes the equity/option full-notional-flow
 * model) — it's (realized P&L on the closed quantity vs. referencePrice,
 * which by this point already equals today's settlement price since the MTM
 * leg above just marked it there) minus totalCosts, sign-adjusted for
 * deriveCash's side convention. See lib/paperTrading/futuresOrders.ts's
 * (T7) module doc for the full derivation — this is the exact same formula,
 * duplicated here because apps/api and apps/web don't share an I/O-layer
 * module (only packages/business-rules is shared), matching this codebase's
 * established per-app-duplication convention for cron orchestration (see
 * optionsExpiry.ts vs. optionOrders.ts's parallel-not-shared structure).
 * Because the MTM leg has just marked referencePrice to today's settlement
 * price, this realized-P&L term is ~0 in practice — the margin-call leg's
 * cash effect is ~-totalCosts, exactly the "mostly a zero-incremental-P&L
 * event" behavior the brief's expiry-settlement section describes for the
 * analogous same-day-close case.
 */

import { computeFuturesOrderCosts } from "@predict-future/business-rules/papertrading/futuresCosts";
import { computeFuturesMarginRequired } from "@predict-future/business-rules/papertrading/futuresMargin";
import { formatFuturesContractSymbol } from "@predict-future/business-rules/papertrading/futuresContract";
import { deriveCash, deriveOpenFuturesPositions, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";
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

/** Same sign-inversion helper as futuresOrders.ts (T7) — deriveCash: `cash += side === "SELL" ? netAmount : -netAmount`. Duplicated per this codebase's established per-app orchestration-file convention (see the module doc above). */
function signedNetAmountForCashEffect(side: TxSide, cashEffect: number): number {
  return side === "SELL" ? cashEffect : -cashEffect;
}

function isoExpiry(expiryDate: Date): string {
  return expiryDate.toISOString().slice(0, 10);
}

export interface FuturesDailyMtmRunResult {
  settlementAvailable: boolean;
  accountsScanned: number;
  positionsMarked: number;
  skippedNoSettlement: number;
  accountsMarginCalled: number;
  positionsForceClosed: number;
  errors: number;
}

/**
 * Runs the daily MTM + margin-call pass. Never throws — per-account/per-
 * contract failures are caught and counted, matching every other cron
 * route's contract in this app. Returns `settlementAvailable: false` (not an
 * error) when the F&O bhavcopy for today's IST session isn't published yet —
 * the caller (the cron route) treats that as a clean, retryable no-op.
 */
export async function runFuturesDailyMtm(now: Date = new Date()): Promise<FuturesDailyMtmRunResult> {
  const result: FuturesDailyMtmRunResult = {
    settlementAvailable: false,
    accountsScanned: 0,
    positionsMarked: 0,
    skippedNoSettlement: 0,
    accountsMarginCalled: 0,
    positionsForceClosed: 0,
    errors: 0
  };

  const sessionDate = getIstSessionDate(now);
  const settlement = await fetchIndexFuturesSettlementPrices(sessionDate);
  if (!settlement) return result;
  result.settlementAvailable = true;

  const accountsWithOpenFutures = await prisma.paperOrder.findMany({
    where: { instrumentKind: "INDEX_FUTURE" },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  for (const { accountId } of accountsWithOpenFutures) {
    result.accountsScanned += 1;
    try {
      await processAccount(accountId, settlement, sessionDate, now, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-futures-daily-mtm] account ${accountId} failed:`, err);
    }
  }

  return result;
}

async function processAccount(
  accountId: string,
  settlement: IndexFuturesSettlementSession,
  sessionDate: Date,
  now: Date,
  result: FuturesDailyMtmRunResult
): Promise<void> {
  const account = await prisma.paperTradingAccount.findUnique({ where: { id: accountId } });
  if (!account) return; // defensive — shouldn't happen (FK integrity)

  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];
  const openPositions = deriveOpenFuturesPositions(orders);
  if (openPositions.length === 0) return; // already flat — nothing to mark

  // ── 1. Write today's MTM leg per open contract (idempotent: skip a contract already marked today) ──
  for (const position of openPositions) {
    const alreadyMarkedToday = orders.some(
      (o) =>
        o.instrumentKind === "INDEX_FUTURE" &&
        o.isDailyMtm &&
        o.underlyingSymbol === position.underlyingSymbol &&
        o.expiryDate?.getTime() === position.expiryDate.getTime() &&
        getIstSessionDate(o.createdAt).getTime() === sessionDate.getTime()
    );
    if (alreadyMarkedToday) continue;

    const settlementPrice = settlement.settlementPriceFor(position.underlyingSymbol, isoExpiry(position.expiryDate));
    if (settlementPrice == null) {
      result.skippedNoSettlement += 1;
      console.warn(
        `[cron/paper-trading-futures-daily-mtm] no settlement price for ${position.underlyingSymbol} (expiry ${isoExpiry(position.expiryDate)}) — leaving account ${accountId}'s position unmarked today, will retry next run.`
      );
      continue;
    }

    const netAmount = (settlementPrice - position.referencePrice) * position.quantity;

    await prisma.paperOrder.create({
      data: {
        accountId,
        symbol: formatFuturesContractSymbol(position.underlyingSymbol, position.expiryDate),
        side: "SELL", // convention for isDailyMtm legs — see the schema doc on PaperOrder.isDailyMtm
        productType: null,
        quantity: 0,
        fillPrice: settlementPrice,
        fillTickAt: now,
        grossAmount: 0,
        brokerage: 0,
        sttAmount: 0,
        exchangeCharge: 0,
        sebiFee: 0,
        stampDuty: 0,
        gstAmount: 0,
        dpCharge: 0,
        totalCosts: 0,
        netAmount,
        instrumentKind: "INDEX_FUTURE",
        underlyingSymbol: position.underlyingSymbol,
        optionType: null,
        strikePrice: null,
        expiryDate: position.expiryDate,
        lotSize: position.lotSize,
        lots: position.lots,
        isSquareOff: false,
        autoSquaredOff: false,
        isDailyMtm: true
      }
    });
    result.positionsMarked += 1;
  }

  // ── 2. Recompute margin headroom with the freshly-written MTM legs included ──
  const freshOrderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const freshOrders = freshOrderRows as unknown as PaperEngineOrder[];
  const freshOpenPositions = deriveOpenFuturesPositions(freshOrders);
  if (freshOpenPositions.length === 0) return; // shouldn't happen (nothing closes itself here), defensive

  const cash = deriveCash(account.startingCapital, freshOrders);
  let marginUsed = 0;
  for (const p of freshOpenPositions) {
    const priceForMargin = settlement.settlementPriceFor(p.underlyingSymbol, isoExpiry(p.expiryDate)) ?? p.referencePrice;
    marginUsed += computeFuturesMarginRequired(Math.abs(p.quantity) * priceForMargin);
  }
  const headroom = cash - marginUsed;
  if (headroom >= 0) return; // healthy — no margin call

  // ── 3. Margin breach — force-close EVERY open futures position on this account ──
  console.warn(
    `[cron/paper-trading-futures-daily-mtm] account ${accountId} margin call: headroom ₹${headroom.toFixed(2)} (cash ₹${cash.toFixed(2)} - margin used ₹${marginUsed.toFixed(2)}) — force-closing ${freshOpenPositions.length} open position(s).`
  );
  result.accountsMarginCalled += 1;

  for (const position of freshOpenPositions) {
    const settlementPrice = settlement.settlementPriceFor(position.underlyingSymbol, isoExpiry(position.expiryDate)) ?? position.referencePrice;
    const side: TxSide = position.quantity > 0 ? "SELL" : "BUY";
    const closingQty = Math.abs(position.quantity);

    // THE COST TRAP: full cost path (real RMS-placed market order), NOT the
    // zero-brokerage settlement path — see futuresCosts.ts's leg-type
    // dispatch, path 3.
    const costs = computeFuturesOrderCosts({ side, quantity: closingQty, price: settlementPrice });
    const directionSign = Math.sign(position.quantity);
    const realizedPnlThisLeg = closingQty * (settlementPrice - position.referencePrice) * directionSign;
    const netAmount = signedNetAmountForCashEffect(side, realizedPnlThisLeg - costs.totalCosts);

    await prisma.paperOrder.create({
      data: {
        accountId,
        symbol: formatFuturesContractSymbol(position.underlyingSymbol, position.expiryDate),
        side,
        productType: null,
        quantity: closingQty,
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
        underlyingSymbol: position.underlyingSymbol,
        optionType: null,
        strikePrice: null,
        expiryDate: position.expiryDate,
        lotSize: position.lotSize,
        lots: position.lots,
        isSquareOff: true,
        autoSquaredOff: true,
        squareOffReason: "FUTURES_MARGIN_CALL",
        isDailyMtm: false
      }
    });
    result.positionsForceClosed += 1;
  }
}
