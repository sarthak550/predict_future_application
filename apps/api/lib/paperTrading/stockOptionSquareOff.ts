/**
 * Paper Trading Phase 3 — stock-option forced square-off orchestration for
 * POST /api/cron/paper-trading-stock-options-squareoff (T6).
 *
 * Stock options are physically settled since Oct 2019 (unlike NIFTY/BANKNIFTY,
 * which are perpetually cash-settled). This app doesn't model physical
 * delivery or the delivery-margin SEBI requires around expiry — see the Phase
 * 3 brief's settlement-decision section — so instead, exactly like every real
 * discount broker's own risk-management behavior, any STOCK_OPTION position
 * still open on expiry day gets force-closed by this cron BEFORE the 15:30 IST
 * close (unlike Phase 2's index cash-settlement cron, which deliberately runs
 * AFTER close — this one must run pre-close, because a post-close square-off
 * would misrepresent that the position was closeable at a real, live,
 * tradeable price).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE COST TRAP (do not "fix" this by copying optionsExpiry.ts's shape):
 * ══════════════════════════════════════════════════════════════════════════
 * A stock-option square-off is a REAL market SELL order the broker's risk
 * system places on the exchange on the user's behalf — full normal brokerage
 * and full normal STT apply, exactly like a manual close. This is the OPPOSITE
 * of Phase 2's index cash-settlement leg (no broker order is ever placed for
 * an automatic exchange cash-settlement, so that leg correctly charges ₹0
 * brokerage and STT-on-intrinsic-value under the "exercise" tax basis).
 *
 * computeOptionOrderCosts is called below with `side: "SELL"` and
 * `isExpirySettlement` OMITTED — i.e. literally the same call shape as a
 * manual close. See test 20 in verify-papertrading-engine.ts for the
 * quantified contrast (at identical notional, this leg costs ₹23.60 MORE than
 * an equivalent Phase 2 settlement leg: ₹20 brokerage + the GST that cascades
 * off it).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 3-TIER PRICING FALLBACK (single-stock strikes frequently go quote-dark,
 * unlike NIFTY/BANKNIFTY which always have a live lastPrice near spot):
 * ══════════════════════════════════════════════════════════════════════════
 * See packages/business-rules/src/papertrading/optionsCosts.ts's
 * resolveSquareOffPrice for the pure tier-selection logic (1. live lastPrice,
 * 2. bid/ask midpoint, 3. intrinsic-value estimate). Which tier resolved each
 * fill is counted in this run's result (pricingSourceCounts) and logged per
 * position — NOT persisted to the PaperOrder row or surfaced per-order in the
 * UI, since there is no new schema column for it (same "cron-log-only"
 * transparency bar as Phase 2's usedSpotFallback, which is likewise never
 * persisted or shown per-order — confirmed by reading queries.ts/the
 * dashboard, it's cron-log/monitoring-only there too). If a large share of
 * square-offs land in the INTRINSIC_ESTIMATE tier, that's a liquidity-data-
 * quality signal worth a follow-up per the brief's 30-day success framing.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * TWO-PASS CADENCE (see the route file for the exact crontab lines):
 * ══════════════════════════════════════════════════════════════════════════
 * 15:25 IST primary pass (real work while the chain is still live) + 15:29
 * IST safety pass (idempotent re-derive, catches anything the first pass
 * missed — a transient chain-fetch failure, a specific strike's fallback
 * chain also failing). A position surviving both passes rolls into "retry
 * next run" (this cron is safe to run repeatedly) — logged loudly as
 * `skippedNoPrice` since a genuinely physically-settled contract left open
 * past close is the one true edge case this design doesn't fully close
 * (total NSE outage). Acceptable residual risk for a paper-trading simulator.
 *
 * All pure position/cost math lives in packages/business-rules — this file is
 * DB + upstream-chain orchestration only, mirroring
 * lib/paperTrading/optionsExpiry.ts's (Phase 2) and squareoff.ts's (Phase 1)
 * shape. Deliberately a SEPARATE cron file from optionsExpiry.ts rather than a
 * branch inside it — settlement logic, cost path, and pricing-fallback logic
 * are different enough that forking that file would make its single
 * responsibility (cash settlement) harder to reason about.
 */

import {
  computeOptionOrderCosts,
  resolveSquareOffPrice,
  type SquareOffPricingSource
} from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";
import { openExpiringPositions, type OptionContractPosition, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";

import { fetchOptionChain, type OptionChainSnapshot, type OptionQuote } from "@/lib/marketMoves/optionChain";
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

/** Today's IST calendar date, expressed as a UTC-midnight Date — matches exactly how PaperOrder.expiryDate is stored (see optionContract.ts's parseNseExpiryDate), so it can be used as a direct equality filter in the DB query below. Duplicated from optionsExpiry.ts's identical private helper (small, pure, one-file-per-cron convention — see the module doc above). */
function todayIstDateAsUtcMidnight(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Finds one strike row's CE or PE quote in a chain snapshot. Null if the strike or leg doesn't exist in the response — apps/api-local equivalent of apps/web's optionQuote.ts's findOptionQuote (not cross-imported; that module is apps/web-only). */
function findQuote(chain: OptionChainSnapshot, strikePrice: number, optionType: "CE" | "PE"): OptionQuote | null {
  const row = chain.strikes.find((s) => s.strikePrice === strikePrice);
  if (!row) return null;
  return optionType === "CE" ? row.CE : row.PE;
}

export interface StockOptionSquareOffRunResult {
  accountsScanned: number;
  positionsSquaredOff: number;
  /** No chain available at all for this position's underlying+expiry (upstream failure) — left open, retried next pass/run. */
  skippedNoPrice: number;
  /** Per-tier count of which pricing source resolved each squared-off fill — cron-log-only signal, see the module doc's pricing-fallback section for why this isn't persisted per-order. */
  pricingSourceCounts: Record<SquareOffPricingSource, number>;
  errors: number;
}

/**
 * Force-closes every account's open STOCK_OPTION positions expiring today
 * (IST calendar date). Never throws — per-account/per-contract failures are
 * caught and counted, matching every other cron route's contract in this app.
 */
export async function runStockOptionSquareOff(now: Date = new Date()): Promise<StockOptionSquareOffRunResult> {
  const result: StockOptionSquareOffRunResult = {
    accountsScanned: 0,
    positionsSquaredOff: 0,
    skippedNoPrice: 0,
    pricingSourceCounts: { LAST_PRICE: 0, BID_ASK_MID: 0, INTRINSIC_ESTIMATE: 0 },
    errors: 0
  };

  const todayExpiry = todayIstDateAsUtcMidnight(now);

  const accountsWithExpiringStockOptionsToday = await prisma.paperOrder.findMany({
    where: { instrumentKind: "STOCK_OPTION", expiryDate: todayExpiry },
    select: { accountId: true },
    distinct: ["accountId"]
  });

  // One live chain fetch per (underlying, expiry) pair covers every strike in
  // that chain — shared across every account/position that needs it this run,
  // same "fetch once, reuse" pattern as optionsExpiry.ts's spotCache.
  const chainCache = new Map<string, OptionChainSnapshot | null>();

  for (const { accountId } of accountsWithExpiringStockOptionsToday) {
    result.accountsScanned += 1;
    try {
      await squareOffAccount(accountId, now, chainCache, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-stock-options-squareoff] account ${accountId} failed:`, err);
    }
  }

  return result;
}

async function resolveChain(underlying: string, expiry: Date, chainCache: Map<string, OptionChainSnapshot | null>): Promise<OptionChainSnapshot | null> {
  const expiryStr = formatNseExpiryDate(expiry);
  const key = `${underlying}::${expiryStr}`;
  if (chainCache.has(key)) return chainCache.get(key) ?? null;

  const chain = await fetchOptionChain(underlying, expiryStr);
  chainCache.set(key, chain);
  return chain;
}

async function squareOffAccount(
  accountId: string,
  now: Date,
  chainCache: Map<string, OptionChainSnapshot | null>,
  result: StockOptionSquareOffRunResult
): Promise<void> {
  const orderRows = await prisma.paperOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const orders = orderRows as unknown as PaperEngineOrder[];

  // openExpiringPositions returns every expiring-today option (index AND
  // stock, mixed) — filter to this cron's own instrumentKind, exactly per
  // replay.ts's doc comment on how each cron is meant to consume the mixed
  // result set.
  const expiringToday = openExpiringPositions(orders, now).filter((p) => p.instrumentKind === "STOCK_OPTION");
  if (expiringToday.length === 0) return; // already squared off/closed — no-op

  for (const position of expiringToday) {
    await squareOffPosition(accountId, position, now, chainCache, result);
  }
}

async function squareOffPosition(
  accountId: string,
  position: OptionContractPosition,
  now: Date,
  chainCache: Map<string, OptionChainSnapshot | null>,
  result: StockOptionSquareOffRunResult
): Promise<void> {
  const chain = await resolveChain(position.underlyingSymbol, position.expiryDate, chainCache);
  if (!chain) {
    result.skippedNoPrice += 1;
    console.warn(
      `[cron/paper-trading-stock-options-squareoff] no chain available for ${position.underlyingSymbol} (expiry ${position.expiryDate.toISOString()}) — leaving account ${accountId}'s position open, will retry next pass/run.`
    );
    return;
  }

  const quote = findQuote(chain, position.strikePrice, position.optionType);
  const pricing = resolveSquareOffPrice({
    lastPrice: quote?.lastPrice ?? null,
    bidPrice: quote?.bidPrice ?? null,
    askPrice: quote?.askPrice ?? null,
    optionType: position.optionType,
    spot: chain.underlyingValue,
    strikePrice: position.strikePrice
  });
  result.pricingSourceCounts[pricing.source] += 1;
  if (pricing.source !== "LAST_PRICE") {
    console.warn(
      `[cron/paper-trading-stock-options-squareoff] ${position.underlyingSymbol} ${position.strikePrice}${position.optionType} priced via ${pricing.source} fallback (₹${pricing.price.toFixed(2)}) — thin liquidity for account ${accountId}.`
    );
  }

  // THE COST TRAP: side "SELL", isExpirySettlement OMITTED — a real
  // broker-forced market SELL, full brokerage + STT-on-premium. See the
  // module doc's cost-trap section. Do NOT add `isExpirySettlement: true`
  // here — that's Phase 2's index cash-settlement path, a different leg type.
  const costs = computeOptionOrderCosts({
    side: "SELL",
    quantity: Math.abs(position.quantity),
    price: pricing.price
  });

  // Re-verify the position is STILL open immediately before writing — a
  // concurrent manual close (or the other pass of this same two-pass cron)
  // between the read above and here would otherwise produce a double
  // square-off. Idempotency guard: re-derive from a fresh read.
  const freshOrderRows = await prisma.paperOrder.findMany({
    where: {
      accountId,
      instrumentKind: "STOCK_OPTION",
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
    (p) => p.instrumentKind === "STOCK_OPTION" && p.strikePrice === position.strikePrice && p.optionType === position.optionType
  );
  if (!freshOpen || freshOpen.quantity === 0) return; // already squared off/closed by the user (or the other pass) since the initial read

  await prisma.paperOrder.create({
    data: {
      accountId,
      symbol: freshOrderRows[0].symbol,
      side: "SELL",
      productType: null,
      quantity: Math.abs(position.quantity),
      fillPrice: pricing.price,
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
      instrumentKind: "STOCK_OPTION",
      underlyingSymbol: position.underlyingSymbol,
      optionType: position.optionType,
      strikePrice: position.strikePrice,
      expiryDate: position.expiryDate,
      lotSize: position.lotSize,
      lots: position.lots,
      squareOffReason: "STOCK_OPTION_EXPIRY_SQUAREOFF"
    }
  });

  result.positionsSquaredOff += 1;
}
