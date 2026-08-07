import { NextResponse } from "next/server";

import { parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** See module doc's "MAX_POINTS cap" section for the numbers behind this value. */
const MAX_POINTS = 5000;

/**
 * GET /api/paper-trading/options/premium-history
 *   ?underlying=NIFTY&expiry=28-Aug-2026&strike=24700&type=CE
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint A, 2026-07-31) — read-only
 * endpoint over `OptionPremiumSnapshot`. Interval-parity cadence project
 * (2026-08-07) widened the capture window to ATM ± 10 and split cadence:
 * index underlyings capture every 1 minute, single-stock underlyings keep
 * the original 5-minute cadence (see apps/api's premiumCapture.ts for the
 * full two-track design). Sprint B's chart UI is the consumer; this ticket
 * ships the data contract only.
 *
 * DIRECT Prisma read, unlike the `options/chain`/`options/expiries` routes in
 * this same directory (which proxy to apps/api because only apps/api can
 * reach NSE) — OptionPremiumSnapshot is our own DB table, and apps/web/
 * apps/api share one hoisted Prisma client, so there's no NSE round trip
 * involved here at all.
 *
 * Routed through the standard app auth middleware for consistency with every
 * other paper-trading route in this app — NOT because the payload itself is
 * sensitive (it's market data, one shared table across every account, same
 * posture as StockEodQuote).
 *
 * Honest-data framing (design decision 7): a contract with zero snapshot
 * rows returns an explicitly EMPTY `points` array — never a 404 (the contract
 * itself may be perfectly valid, it just hasn't been captured yet) and never
 * an interpolated/zero-filled series. Sprint B's UI renders this as "history
 * accrues as this contract is viewed," not a blank/broken chart.
 *
 * `captureIntervalSec` (2026-08-07) is now returned on every point — the
 * client's own aggregation (`premium-candles.ts`) reads it per-bucket to
 * decide whether a bucket is native-granularity (1 row = 1 honest bar,
 * `minSamples: 1`) or a real aggregation still bound by the pre-existing
 * "≥3 samples" honesty floor. Never inferred client-side from the
 * underlying's name — read straight off each row's own recorded truth.
 *
 * `MAX_POINTS` cap (2026-08-07, new): retention now bounds any single
 * contract's row count to roughly 3,750 (1-minute cadence × ~375
 * market-hour runs/day × 10-day fine-grained retention — see the prune
 * cron's own doc) for an index contract, or ~3,375 (5-minute cadence × 75
 * runs/day × 45-day retention) for a stock contract. `MAX_POINTS` (5,000)
 * sits comfortably above both steady-state ceilings as a defensive cap
 * against a pathological case (a contract captured on literally every run
 * for its ENTIRE retention window) — not a routine truncation. When it does
 * bind, the MOST RECENT `MAX_POINTS` rows are kept (oldest tail dropped
 * first) and re-sorted back to chronological order, matching this domain's
 * general "older data is less relevant" retention posture.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const underlyingRaw = searchParams.get("underlying");
  const expiryRaw = searchParams.get("expiry");
  const strikeRaw = searchParams.get("strike");
  const typeRaw = searchParams.get("type");

  if (!underlyingRaw || !expiryRaw || !strikeRaw || (typeRaw !== "CE" && typeRaw !== "PE")) {
    return NextResponse.json(
      { error: "underlying, expiry, strike, and type (CE|PE) query params are all required." },
      { status: 400 }
    );
  }

  const underlying = underlyingRaw.trim().toUpperCase();
  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike) || strike <= 0) {
    return NextResponse.json({ error: "strike must be a positive number." }, { status: 400 });
  }

  const expiryDate = parseNseExpiryDate(expiryRaw);
  if (!expiryDate) {
    return NextResponse.json({ error: "Invalid expiry date — expected NSE's DD-MMM-YYYY format." }, { status: 400 });
  }

  // Defensive cap — see module doc. Queried MOST-RECENT-FIRST so a bound
  // contract keeps its freshest history, then reversed below to the
  // chronological order this endpoint's contract has always promised.
  const snapshotsDesc = await prisma.optionPremiumSnapshot.findMany({
    where: {
      underlyingSymbol: underlying,
      expiryDate,
      strikePrice: strike,
      optionType: typeRaw
    },
    orderBy: { capturedAt: "desc" },
    take: MAX_POINTS,
    select: {
      capturedAt: true,
      lastPrice: true,
      bidPrice: true,
      askPrice: true,
      underlyingValue: true,
      captureIntervalSec: true
    }
  });
  const snapshots = snapshotsDesc.reverse();

  return NextResponse.json({
    underlying,
    expiry: expiryRaw,
    strike,
    type: typeRaw,
    /** Chronological, never interpolated/back-filled — an empty array here is an honest "no snapshots captured yet," not an error. */
    points: snapshots.map((s) => ({
      capturedAt: s.capturedAt,
      lastPrice: s.lastPrice,
      bidPrice: s.bidPrice,
      askPrice: s.askPrice,
      underlyingValue: s.underlyingValue,
      captureIntervalSec: s.captureIntervalSec
    }))
  });
}
