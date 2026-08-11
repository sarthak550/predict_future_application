/**
 * Paper Trading Phase 4 (Index Futures), Sprint 2 (T7) — futures order
 * placement orchestration for POST /api/paper-trading/futures/orders.
 *
 * Same synchronous-fill contract as every other Paper Trading order path: no
 * PENDING state, the response IS the fill confirmation. All pure cost/margin/
 * position math lives in packages/business-rules/src/papertrading/
 * {futuresCosts,futuresMargin,futuresContract,replay}.ts (Sprint 1, locked);
 * this file is DB + upstream-quote orchestration only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE netAmount DESIGN DECISION — read before touching this file
 * ═══════════════════════════════════════════════════════════════════════════
 * Every prior asset class (equity, options) treats PaperOrder.netAmount as the
 * FULL cash flow of the trade: a BUY debits grossAmount+costs, a SELL credits
 * grossAmount-costs — because in those asset classes the account actually pays
 * (or receives) the full traded value. `computeFuturesOrderCosts`'s own
 * `.netAmount` field is defined with that SAME generic formula (shared
 * `OrderCostBreakdown` interface, "reused not forked" per its module doc).
 *
 * That formula is WRONG for a margin-backed futures leg and must NOT be
 * written to PaperOrder.netAmount directly. Reasoning: the Phase 4 brief
 * locks "no marginBlocked column, no separate margin table... Available
 * headroom = deriveCash(...) − Σ computeFuturesMarginRequired(currentNotional)".
 * That formula only holds if deriveCash's running total is NEVER reduced by a
 * position's full notional — a futures account puts up ~15% margin, not 100%
 * of contract value (that's the entire point of "implied leverage", which the
 * UI is required to show honestly). A quick sanity check confirms this is not
 * optional: at real 2026 NSE index levels, ONE lot of any index future has a
 * notional in the ~₹15-20 lakh band (SEBI's contract-value rule sizes lot
 * sizes to land there for every index), so even 15% margin alone
 * (~₹2.25-3 lakh) already exceeds this product's ₹1,00,000 starting capital —
 * if netAmount ALSO debited the full ~₹18 lakh notional, no order could ever
 * be evaluated sensibly and "leverage" would be meaningless (you'd have paid
 * for the whole contract).
 *
 * So: `computeFuturesOrderCosts`'s cost-line fields (brokerage, stt,
 * exchangeCharge, sebiFee, stampDuty, gst, totalCosts, grossAmount) ARE
 * reused verbatim — the cost STACK math is correct and audit-grade. Its
 * `.netAmount` field is DISCARDED. This file computes PaperOrder.netAmount
 * itself, exactly mirroring the precedent futuresCosts.ts's `zeroDailyMtmCosts`
 * already set for the MTM leg type (whose doc comment explicitly says the
 * caller assigns netAmount directly, not via the cost function):
 *
 *   - OPENING or ADDING to a position: cash moves by -totalCosts ONLY (the
 *     margin itself is never debited — it's a computed, on-demand constraint,
 *     never a ledger entry).
 *   - CLOSING (or a margin-call/expiry-settlement leg, in the crons): cash
 *     moves by (realized P&L on the closed quantity, vs. the position's
 *     current referencePrice — the exact same sign algebra replay.ts's
 *     replayFuturesContract already uses internally) MINUS totalCosts. This
 *     is why the brief's own MTM/expiry-settlement sections describe a
 *     same-day close as "mostly a zero-incremental-P&L event" — by the time a
 *     close happens right after that day's MTM mark, referencePrice already
 *     equals (or nearly equals) the close price, so realized P&L on the close
 *     leg itself is ~0 and the cash effect is ~-totalCosts. That is the
 *     intended behavior, not a bug — see futuresDailyMtm.ts / futuresExpiry.ts
 *     for the cron-side mirror of this exact same formula.
 *
 * Both cases are converted to the stored `netAmount` value via
 * `signedNetAmountForCashEffect`, which accounts for deriveCash's
 * existing side-based sign convention (`cash += side === "SELL" ? netAmount :
 * -netAmount`, unchanged since Phase 1) so this NEVER requires touching
 * deriveCash itself — the existing formula already produces the right result
 * once netAmount is stored with the correct sign for the desired cash effect.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Chart Trading + SL/TP (Sprint A, 2026-07-31) — REFACTORED to consume
 * `planFuturesOrderFill` (packages/business-rules/src/papertrading/
 * futuresOrderPlan.ts) for everything from open/close classification through
 * netAmount, instead of the inline logic this file used to carry directly.
 * See that module's doc for the full rationale — in short: futures pending
 * orders (new this sprint) need the IDENTICAL classification/margin/netAmount
 * algebra this market-order path already had, and "don't fork the logic"
 * means both consume one shared pure function.
 *
 * This refactor is a BEHAVIORAL NO-OP for every pre-existing scenario except
 * one addition: the margin-headroom check now ALSO subtracts
 * `pendingBlockedMargin` (cash/margin already reserved by this account's own
 * resting pending futures orders — decision 6, the same T3-regression
 * requirement the equity/options market paths have honored since the Limit
 * Orders sprint via `derivePendingBlockedCash`). Proven algebraically
 * identical to the pre-refactor inline formula in
 * apps/api/scripts/verify-papertrading-engine.ts, section 40.
 */

import { formatFuturesContractSymbol } from "@predict-future/business-rules/papertrading/futuresContract";
import { planFuturesOrderFill } from "@predict-future/business-rules/papertrading/futuresOrderPlan";
import { INDEX_FUTURES_MARGIN_RATE } from "@predict-future/business-rules/papertrading/futuresMargin";
import { derivePendingBlockedCash } from "@predict-future/business-rules/papertrading/pendingOrders";
import { parseNseExpiryDate, isIndexOptionUnderlying, type IndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { deriveCash, deriveOpenFuturesPositions, type PaperEngineOrder } from "@predict-future/business-rules/papertrading/replay";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import type { TxSide } from "@prisma/client";

import { getOrCreateActiveAccount } from "@/lib/paperTrading/account";
import { fetchActivePendingOrders } from "@/lib/paperTrading/pendingOrders";
import { fetchFuturesQuoteServer, findFuturesContractQuote, type FuturesQuoteSource } from "@/lib/paperTrading/futuresQuote";
import { isFuturesTradingEnabled } from "@/lib/paperTrading/featureFlags";
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

export interface PlaceFuturesOrderInput {
  underlyingSymbol: string;
  /** NSE's own "DD-MMM-YYYY" expiry string, as returned by GET /api/paper-trading/futures/quote's allContracts. */
  expiryDate: string;
  side: TxSide;
  lots: number;
}

export interface PlacedFuturesOrder {
  id: string;
  symbol: string;
  side: TxSide;
  underlyingSymbol: string;
  expiryDate: Date;
  lotSize: number;
  lots: number;
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
  createdAt: Date;
  instrumentKind: "INDEX_FUTURE";
  /** Whether the fill used a real live NSE quote or the put-call-parity fallback — must be rendered honestly, per the Phase 4 brief. */
  quoteSource: FuturesQuoteSource;
  /** This order's own notional at 15% margin — NOT the account's total margin usage (see the futures positions endpoint for that). */
  marginRequired: number;
  /** 1 / INDEX_FUTURES_MARGIN_RATE, a constant (flat rate ⇒ flat leverage) — shown alongside marginRequired per the brief's "implied leverage" requirement. */
  impliedLeverage: number;
  isClose: boolean;
}

export type PlaceFuturesOrderResult =
  | { ok: true; order: PlacedFuturesOrder }
  | { ok: false; status: 400 | 403 | 422 | 502; reason: string };

const IMPLIED_LEVERAGE = 1 / INDEX_FUTURES_MARGIN_RATE;

export async function placeFuturesOrder(userId: string, input: PlaceFuturesOrderInput): Promise<PlaceFuturesOrderResult> {
  if (!isIndexOptionUnderlying(input.underlyingSymbol)) {
    return {
      ok: false,
      status: 400,
      reason: `${input.underlyingSymbol} isn't a tradable index future — futures are offered on NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, and NIFTYNXT50 only this phase.`
    };
  }
  const underlying = input.underlyingSymbol as IndexOptionUnderlying;

  const expiryDate = parseNseExpiryDate(input.expiryDate);
  if (!expiryDate) {
    return { ok: false, status: 400, reason: "Invalid expiry date." };
  }

  // Product-level derivatives gate (2026-08-11) — a CHEAP pre-check, before
  // the market-hours gate below, so a gated caller with no position in this
  // exact contract gets the correct "coming soon" message instead of the
  // misleading "come back during market hours" one (which wouldn't help —
  // it'd still be gated then too). Uses only DB-read data already needed
  // later (no extra network quote fetch): if this account holds NO open
  // position in this exact (underlying, expiry) at all, it is categorically
  // impossible for this order to be a close, so it's safe to reject here
  // without knowing the order's side/direction yet. If a matching position
  // DOES exist, this pre-check defers to the precise `isOpeningOrAdding`
  // gate further down (after `planFuturesOrderFill` — the only place that
  // correctly knows open-vs-add-vs-reduce-vs-flip for THIS side/lots against
  // that position), rather than duplicating that direction logic here.
  if (!isFuturesTradingEnabled()) {
    const preCheckAccount = await getOrCreateActiveAccount(userId);
    const preCheckOrderRows = await prisma.paperOrder.findMany({
      where: { accountId: preCheckAccount.id },
      orderBy: { createdAt: "asc" },
      select: ENGINE_ORDER_SELECT
    });
    const preCheckOrders = preCheckOrderRows as unknown as PaperEngineOrder[];
    const hasMatchingPosition = deriveOpenFuturesPositions(preCheckOrders).some(
      (p) => p.underlyingSymbol === underlying && p.expiryDate.getTime() === expiryDate.getTime() && p.side !== "FLAT"
    );
    if (!hasMatchingPosition) {
      return {
        ok: false,
        status: 403,
        reason: "Futures trading is coming soon — new positions can't be opened right now. Existing positions can still be closed."
      };
    }
  }

  if (!isNseWeekdayMarketHours()) {
    return {
      ok: false,
      status: 422,
      reason: "Orders can only be placed during NSE market hours (Mon-Fri, 09:15-15:30 IST)."
    };
  }

  const quote = await fetchFuturesQuoteServer(underlying);
  if (!quote) {
    return {
      ok: false,
      status: 502,
      reason: `No live or derived futures price available for ${underlying} right now — try again shortly.`
    };
  }

  const contract = findFuturesContractQuote(quote, input.expiryDate);
  if (!contract || !contract.lotSize || contract.lotSize <= 0) {
    return {
      ok: false,
      status: 502,
      reason:
        quote.source === "PCP_DERIVED"
          ? `Only the near-month contract (${quote.expiry}) has a derived price right now — the option-chain fallback can't price other months. Try the near-month contract, or again shortly.`
          : `No live price or lot size available for that contract right now — try again shortly.`
    };
  }

  const lotSize = contract.lotSize;
  const contractPrice = contract.price;
  const quantity = input.lots * lotSize;

  const account = await getOrCreateActiveAccount(userId);

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as unknown as PaperEngineOrder[];

  // Sprint A (decision 6) — a resting pending futures LIMIT/STOP order on
  // this account must be respected by THIS market-order path too, exactly
  // like the equity/options market paths already subtract
  // derivePendingBlockedCash since the Limit Orders sprint (T3's regression
  // requirement, now extended to futures).
  const existingPending = await fetchActivePendingOrders(account.id);

  const cash = deriveCash(account.startingCapital, existingOrders);
  const openFuturesPositions = deriveOpenFuturesPositions(existingOrders);
  const pendingBlockedMargin = derivePendingBlockedCash(existingPending);

  const planResult = planFuturesOrderFill({
    underlyingSymbol: underlying,
    expiryDate,
    side: input.side,
    lots: input.lots,
    lotSize,
    contractPrice,
    cash,
    openFuturesPositions,
    pendingBlockedMargin
  });

  if (!planResult.ok) {
    return { ok: false, status: planResult.status, reason: planResult.reason };
  }
  const { plan } = planResult;
  const { costs, netAmount, isOpeningOrAdding } = plan;

  // Product-level derivatives gate (2026-08-11) — the PRECISE backstop,
  // catching what the cheap pre-check above deliberately couldn't: that
  // pre-check only ruled out "no position in this contract at all"; a
  // caller WITH a matching position still reaches this point, and unlike
  // options, futures can go long OR short, so a SELL is NOT categorically a
  // close even for a held contract. `isOpeningOrAdding` (computed by the
  // shared `planFuturesOrderFill`, the same function pending futures orders
  // use) is the precise, already-correct signal: true for opening a fresh
  // position or adding to an existing one in the SAME direction, false for
  // reducing/flattening/flipping down toward flat. Only the true case is
  // gated — a close/reduce always goes through, matching "closing must
  // still work; new orders are gated" exactly.
  if (!isFuturesTradingEnabled() && isOpeningOrAdding) {
    return {
      ok: false,
      status: 403,
      reason: "Futures trading is coming soon — new positions can't be opened right now. Existing positions can still be closed."
    };
  }

  const symbol = formatFuturesContractSymbol(underlying, expiryDate);
  const fillTickAt = quote.asOf ?? new Date();

  const created = await prisma.paperOrder.create({
    data: {
      accountId: account.id,
      symbol,
      side: input.side,
      productType: null,
      quantity,
      fillPrice: contractPrice,
      fillTickAt,
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
      underlyingSymbol: underlying,
      optionType: null,
      strikePrice: null,
      expiryDate,
      lotSize,
      lots: input.lots,
      isSquareOff: !isOpeningOrAdding,
      autoSquaredOff: false,
      isDailyMtm: false
    },
    select: {
      id: true,
      symbol: true,
      side: true,
      underlyingSymbol: true,
      expiryDate: true,
      lotSize: true,
      lots: true,
      quantity: true,
      fillPrice: true,
      fillTickAt: true,
      grossAmount: true,
      brokerage: true,
      sttAmount: true,
      exchangeCharge: true,
      sebiFee: true,
      stampDuty: true,
      gstAmount: true,
      dpCharge: true,
      totalCosts: true,
      netAmount: true,
      createdAt: true,
      instrumentKind: true
    }
  });

  return {
    ok: true,
    order: {
      ...(created as unknown as Omit<PlacedFuturesOrder, "quoteSource" | "marginRequired" | "impliedLeverage" | "isClose">),
      underlyingSymbol: underlying,
      lotSize: lotSize as number,
      quoteSource: quote.source,
      marginRequired: plan.marginRequired,
      impliedLeverage: IMPLIED_LEVERAGE,
      isClose: !isOpeningOrAdding
    }
  };
}
