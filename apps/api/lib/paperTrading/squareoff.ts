/**
 * Paper Trading Phase 1 — intraday auto square-off orchestration for
 * POST /api/cron/paper-trading-squareoff (T4).
 *
 * Real discount brokers force-close open intraday positions before market close
 * (commonly ~15:15-15:20 IST) rather than letting them convert to delivery. This
 * cron finds every account with a non-zero net INTRADAY position for today (via
 * packages/business-rules/src/papertrading/replay.ts's openIntradayPositions) and
 * writes a closing PaperOrder at the last available delayed LTP tick, flagged
 * autoSquaredOff: true. Costs on the forced leg are computed by the exact same
 * computeOrderCosts() function a manual close would use — there is no separate
 * "cron pricing" path.
 *
 * All pure position/cost math lives in packages/business-rules — this file is DB +
 * upstream-LTP orchestration only, mirroring apps/api/lib/portfolios/settlement.ts's
 * shape.
 */

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";
import { openIntradayPositions, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";

import { fetchIntradaySeries } from "@/lib/marketMoves/intraday";
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST midnight of "today" (server clock), expressed as a UTC instant — a cheap lower bound for "which accounts touched INTRADAY today", so the scan doesn't walk an account's entire lifetime order history. */
function todayIstMidnightUtc(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

export interface SquareOffRunResult {
  accountsScanned: number;
  positionsClosed: number;
  skippedNoLtp: number;
  errors: number;
}

/**
 * Force-closes every account's open INTRADAY positions for today. Never throws —
 * per-account/per-symbol failures are caught and counted, matching every other
 * cron route's contract in this app.
 */
export async function runIntradaySquareOff(now: Date = new Date()): Promise<SquareOffRunResult> {
  const result: SquareOffRunResult = { accountsScanned: 0, positionsClosed: 0, skippedNoLtp: 0, errors: 0 };

  const accountsWithIntradayToday = await prisma.paperOrder.findMany({
    where: { productType: "INTRADAY", createdAt: { gte: todayIstMidnightUtc(now) } },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  for (const { accountId } of accountsWithIntradayToday) {
    result.accountsScanned += 1;
    try {
      await squareOffAccount(accountId, now, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-squareoff] account ${accountId} failed:`, err);
    }
  }

  return result;
}

async function squareOffAccount(accountId: string, now: Date, result: SquareOffRunResult): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as PaperEngineOrder[];

  const openPositions = openIntradayPositions(orders, now);
  if (openPositions.length === 0) return; // already flat — no-op

  for (const position of openPositions) {
    const series = await fetchIntradaySeries(position.symbol);
    const lastTick = series?.points.at(-1);
    if (!lastTick) {
      result.skippedNoLtp += 1;
      console.warn(`[cron/paper-trading-squareoff] no delayed LTP for ${position.symbol} — leaving account ${accountId} open, will retry next run.`);
      continue;
    }

    // Closing side is the OPPOSITE of the open direction: a long (quantity > 0)
    // is closed by a SELL; a short (quantity < 0) is closed by a BUY.
    const closingSide = position.quantity > 0 ? "SELL" : "BUY";
    const closingQuantity = Math.abs(position.quantity);

    const costs = computeOrderCosts({
      side: closingSide,
      productType: "INTRADAY",
      quantity: closingQuantity,
      price: lastTick.price
      // isFirstDeliverySellOfScripToday intentionally omitted — INTRADAY never
      // attracts a DP charge regardless, per costs.ts.
    });

    // Re-verify the position is STILL open immediately before writing — a
    // concurrent manual close between the read above and here would otherwise
    // produce a double-close. Idempotency guard: re-derive from a fresh read.
    const freshOrders = (await prisma.paperOrder.findMany({
      where: { accountId, symbol: position.symbol, productType: "INTRADAY" },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    })) as PaperEngineOrder[];
    const freshOpen = openIntradayPositions(freshOrders, now).find((p) => p.symbol === position.symbol);
    if (!freshOpen || freshOpen.quantity === 0) continue; // already closed by the user (or a prior overlapping run) since the initial read

    await prisma.paperOrder.create({
      data: {
        accountId,
        symbol: position.symbol,
        side: closingSide,
        productType: "INTRADAY",
        quantity: closingQuantity,
        fillPrice: lastTick.price,
        fillTickAt: new Date(lastTick.t),
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
        autoSquaredOff: true
      }
    });

    result.positionsClosed += 1;
  }
}
