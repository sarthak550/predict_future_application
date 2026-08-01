import { NextResponse } from "next/server";

import { parseNseExpiryDate } from "@predict-future/business-rules/papertrading/optionContract";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/paper-trading/options/premium-history
 *   ?underlying=NIFTY&expiry=28-Aug-2026&strike=24700&type=CE
 *
 * Chart Trading + Stop-Loss/Take-Profit (Sprint A, 2026-07-31) — read-only
 * endpoint over `OptionPremiumSnapshot`, which the paper-trading-premium-
 * capture cron has been populating every 5 minutes (ATM ± 5 strikes of every
 * browsed chain, plus every held contract) since 2026-07-27. Sprint B's chart
 * UI is the consumer; this ticket ships the data contract only.
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

  const snapshots = await prisma.optionPremiumSnapshot.findMany({
    where: {
      underlyingSymbol: underlying,
      expiryDate,
      strikePrice: strike,
      optionType: typeRaw
    },
    orderBy: { capturedAt: "asc" },
    select: {
      capturedAt: true,
      lastPrice: true,
      bidPrice: true,
      askPrice: true,
      underlyingValue: true
    }
  });

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
      underlyingValue: s.underlyingValue
    }))
  });
}
