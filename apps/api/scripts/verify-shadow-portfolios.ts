/**
 * P3.3 acceptance script for shadow portfolios (packages/business-rules/src/portfolios/shadow.ts
 * + apps/api/lib/portfolios/shadowGenerator.ts).
 *
 * Two parts:
 *   1. Pure-function checks (no DB, no network) — symbol mapping, IST session-date
 *      mapping (cross-checked against the golden example in bhavcopy.ts's own doc
 *      comment), static eligibility filtering, and planShadowTransactions'
 *      chronological cash simulation (happy path, cash-cap skip, sub-1-share skip,
 *      missing-quote skip).
 *   2. A REAL local-database integration run against a single throwaway test Expert
 *      (slug prefixed "zztest-shadow-verify-", scoped via runShadowGeneration's
 *      `expertSlug` option so it never touches real experts or fetches over the
 *      network — the test pre-seeds the exact StockEodQuote rows its call needs)
 *      proving: portfolio creation, correct BUY/SELL fills, PortfolioDailyValue
 *      backfill, and idempotent re-runs (second run writes zero new transactions,
 *      fetches zero new sessions).
 *
 * All test rows are deleted in a `finally` block regardless of pass/fail.
 *
 * Run: npx tsx scripts/verify-shadow-portfolios.ts   (from apps/api)
 */

import {
  filterShadowEligibleCalls,
  istCalendarDateOfInstant,
  istCalendarDateToSessionDate,
  mapTickerToNseSymbol,
  planShadowTransactions,
  type ShadowEligibleCall,
  type ShadowOpinionInput,
  type ShadowPriceLookup
} from "@predict-future/business-rules/portfolios/shadow";

import { runShadowGeneration } from "../lib/portfolios/shadowGenerator";
import { prisma } from "../lib/prisma";

const TEST_SLUG_PREFIX = "zztest-shadow-verify-";
const TEST_SYMBOL = "ZZTESTSHADOW";

let passCount = 0;
let failCount = 0;

function assertEqual<T>(actual: T, expected: T, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passCount += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

function assertTrue(actual: boolean, message: string) {
  assertEqual(actual, true, message);
}

async function cleanup() {
  await prisma.portfolio.deleteMany({ where: { ownerExpert: { slug: { startsWith: TEST_SLUG_PREFIX } } } });
  await prisma.expertOpinion.deleteMany({ where: { expert: { slug: { startsWith: TEST_SLUG_PREFIX } } } });
  await prisma.expert.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await prisma.stockEodQuote.deleteMany({ where: { symbol: TEST_SYMBOL } });
}

// ─── Part 1: pure-function checks ──────────────────────────────────────────

function runPureChecks() {
  console.log("1. mapTickerToNseSymbol");
  assertEqual(mapTickerToNseSymbol("RELIANCE.NS"), "RELIANCE", "NSE ticker maps to bare symbol");
  assertEqual(mapTickerToNseSymbol("TCS.BO"), "TCS", "BSE ticker maps to bare symbol");
  assertEqual(mapTickerToNseSymbol("^NSEI"), null, "index ticker is unmappable");
  assertEqual(mapTickerToNseSymbol("^NSEBANK"), null, "index ticker (bank) is unmappable");
  assertEqual(mapTickerToNseSymbol("GC=F"), null, "non-NSE/-BO ticker (gold futures) is unmappable");
  assertEqual(mapTickerToNseSymbol(null), null, "null ticker is unmappable");

  console.log("\n2. IST calendar-date <-> StockEodQuote.sessionDate mapping");
  // Golden example straight from the doc comment in apps/api/lib/marketMoves/bhavcopy.ts:
  // "the Monday 20 Jul IST session is stored as 2026-07-19T18:30Z".
  const golden = istCalendarDateToSessionDate({ year: 2026, month: 7, day: 20 });
  assertEqual(golden.toISOString(), "2026-07-19T18:30:00.000Z", "IST calendar date 2026-07-20 maps to the documented sessionDate");
  const backToCalendar = istCalendarDateOfInstant(golden);
  assertEqual(backToCalendar, { year: 2026, month: 7, day: 20 }, "round-trips back to the same IST calendar date");
  // An instant late in the UTC day (e.g. 20:00 UTC) is already the NEXT IST calendar day.
  const lateUtc = new Date("2026-07-20T20:00:00.000Z"); // 2026-07-21 01:30 IST
  assertEqual(istCalendarDateOfInstant(lateUtc), { year: 2026, month: 7, day: 21 }, "a late-UTC instant falls on the next IST calendar date");

  console.log("\n3. filterShadowEligibleCalls (static eligibility)");
  const baseOpinion: ShadowOpinionInput = {
    id: "op-1",
    expertId: "expert-1",
    direction: "BULLISH",
    resolutionStatus: "RESOLVED_HIT",
    instrumentTicker: "RELIANCE.NS",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: new Date("2026-02-01T00:00:00Z"),
    suppressedAt: null
  };
  const opinions: ShadowOpinionInput[] = [
    baseOpinion,
    { ...baseOpinion, id: "op-2", direction: "BEARISH" }, // wrong direction
    { ...baseOpinion, id: "op-3", resolutionStatus: "PENDING" }, // not resolved
    { ...baseOpinion, id: "op-4", suppressedAt: new Date() }, // suppressed
    { ...baseOpinion, id: "op-5", instrumentTicker: "^NSEI" }, // unmappable
    { ...baseOpinion, id: "op-6", instrumentTicker: null } // unmappable
  ];
  const eligible = filterShadowEligibleCalls(opinions);
  assertEqual(eligible.length, 1, "only the single fully-eligible opinion survives the static filter");
  assertEqual(eligible[0]?.opinionId, "op-1", "the surviving call is the expected one");
  assertEqual(eligible[0]?.symbol, "RELIANCE", "the surviving call's symbol is mapped correctly");

  console.log("\n4. planShadowTransactions — happy path, cash cap, sub-1-share, missing quote");
  function stubLookup(prices: Record<string, number>): ShadowPriceLookup {
    return {
      resolve(symbol: string, instant: Date) {
        const key = `${symbol}|${instant.toISOString()}`;
        const close = prices[key];
        return close != null ? { sessionDate: instant, close } : null;
      }
    };
  }

  const callA: ShadowEligibleCall = {
    opinionId: "a",
    expertId: "e",
    symbol: "AAA",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: new Date("2026-01-05T00:00:00Z")
  };
  const callB: ShadowEligibleCall = {
    opinionId: "b",
    expertId: "e",
    symbol: "BBB",
    publishedAt: new Date("2026-01-02T00:00:00Z"),
    resolvedAt: new Date("2026-01-06T00:00:00Z")
  };

  // Happy path: two affordable calls, ample starting capital.
  const happyPrices: Record<string, number> = {
    "AAA|2026-01-01T00:00:00.000Z": 100, // qty = floor(50000/100) = 500, cost = 50,000
    "AAA|2026-01-05T00:00:00.000Z": 120, // proceeds = 500*120 = 60,000
    "BBB|2026-01-02T00:00:00.000Z": 250, // qty = floor(50000/250) = 200, cost = 50,000
    "BBB|2026-01-06T00:00:00.000Z": 200 // proceeds = 200*200 = 40,000
  };
  const happyPlan = planShadowTransactions([callA, callB], 1_000_000, stubLookup(happyPrices));
  assertEqual(happyPlan.transactions.length, 4, "happy path produces 2 BUY+SELL pairs (4 rows)");
  assertEqual(happyPlan.skipped.length, 0, "happy path skips nothing");
  const buyA = happyPlan.transactions.find((t) => t.opinionId === "a" && t.side === "BUY");
  assertEqual(buyA?.quantity, 500, "BUY quantity is floor(50000/close)");
  assertEqual(buyA?.priceAtTx, 100, "BUY fills at the resolved entry close");
  const sellA = happyPlan.transactions.find((t) => t.opinionId === "a" && t.side === "SELL");
  assertEqual(sellA?.quantity, 500, "SELL quantity matches the BUY quantity");
  assertEqual(sellA?.priceAtTx, 120, "SELL fills at the resolved exit close");

  // Cash cap: same two calls, but starting capital only covers the first BUY.
  const tightPlan = planShadowTransactions([callA, callB], 60_000, stubLookup(happyPrices));
  assertEqual(tightPlan.transactions.length, 2, "cash-capped run only completes the affordable first call");
  assertEqual(tightPlan.skipped.length, 1, "the unaffordable second call is skipped");
  assertEqual(tightPlan.skipped[0]?.opinionId, "b", "the skipped call is the one that would have exceeded cash");
  assertTrue(tightPlan.skipped[0]?.reason.includes("Cash-capped") ?? false, "the skip reason explains the cash cap");

  // Sub-1-share: an extremely expensive stock floors to 0 shares.
  const expensivePrices: Record<string, number> = {
    "AAA|2026-01-01T00:00:00.000Z": 100_000,
    "AAA|2026-01-05T00:00:00.000Z": 110_000
  };
  const subShrPlan = planShadowTransactions([callA], 1_000_000, stubLookup(expensivePrices));
  assertEqual(subShrPlan.transactions.length, 0, "a call whose position size floors to 0 shares produces no transactions");
  assertTrue(subShrPlan.skipped[0]?.reason.includes("too small") ?? false, "the skip reason explains the sub-1-share position");

  // Missing quote: no price at all for the symbol.
  const noPriceLookup = stubLookup({});
  const missingPlan = planShadowTransactions([callA], 1_000_000, noPriceLookup);
  assertEqual(missingPlan.transactions.length, 0, "a call with no resolvable quote produces no transactions");
  assertTrue(missingPlan.skipped[0]?.reason.includes("entry-session quote") ?? false, "the skip reason explains the missing entry quote");
}

// ─── Part 2: DB integration — one throwaway expert, idempotent re-run ──────

async function runDbIntegrationCheck() {
  console.log("\n5. DB integration — single expert, real local database");
  await cleanup(); // in case a previous failed run left rows behind

  const suffix = Math.random().toString(36).slice(2, 8);
  const expertSlug = `${TEST_SLUG_PREFIX}${suffix}`;
  const expert = await prisma.expert.create({
    data: {
      name: `ZZTest Shadow Expert ${suffix}`,
      organization: "ZZTest Securities",
      slug: expertSlug,
      verified: true
    }
  });

  const publishedAt = new Date("2021-03-01T05:00:00Z");
  const resolvedAt = new Date("2021-03-10T05:00:00Z");
  const buySessionDate = istCalendarDateToSessionDate(istCalendarDateOfInstant(publishedAt));
  const sellSessionDate = istCalendarDateToSessionDate(istCalendarDateOfInstant(resolvedAt));

  await prisma.expertOpinion.create({
    data: {
      expertId: expert.id,
      quote: "This name looks poised for a breakout.",
      direction: "BULLISH",
      sourceUrl: "https://example.test/zztest-shadow-article",
      publishedAt,
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt,
      instrumentTicker: `${TEST_SYMBOL}.NS`,
      instrument: "ZZTest Shadow Co"
    }
  });

  // Pre-seed BOTH sessions the call needs so the run makes ZERO network calls —
  // deterministic and offline-safe regardless of NSE archive availability.
  await prisma.stockEodQuote.create({
    data: {
      sessionDate: buySessionDate,
      symbol: TEST_SYMBOL,
      companyName: "ZZTest Shadow Co",
      prevClose: 95,
      close: 100, // qty = floor(50000/100) = 500
      changePercent: 5.3,
      volume: 10_000
    }
  });
  await prisma.stockEodQuote.create({
    data: {
      sessionDate: sellSessionDate,
      symbol: TEST_SYMBOL,
      companyName: "ZZTest Shadow Co",
      prevClose: 110,
      close: 120,
      changePercent: 9.1,
      volume: 12_000
    }
  });

  try {
    const run1 = await runShadowGeneration({ dryRun: false, expertSlug });
    assertEqual(run1.errors.length, 0, "first run has no errors");
    assertEqual(run1.sessionsFetched, 0, "first run fetches zero sessions (both pre-seeded in DB)");
    assertEqual(run1.portfoliosCreated, 1, "first run creates exactly one portfolio");
    assertEqual(run1.transactionsWritten, 2, "first run writes exactly one BUY + one SELL");
    assertEqual(run1.transactionsAlreadyPresent, 0, "first run has nothing already present");

    const portfolio = await prisma.portfolio.findFirst({ where: { ownerExpertId: expert.id, kind: "SHADOW" } });
    assertTrue(portfolio !== null, "a SHADOW portfolio row now exists for the test expert");
    assertEqual(portfolio?.visibility, "PUBLIC", "shadow portfolio is created PUBLIC");
    assertTrue(portfolio?.publicSince != null, "shadow portfolio has publicSince set at creation");
    assertEqual(portfolio?.slug, `shadow-${expertSlug}`, "shadow portfolio slug follows the shadow-<expert-slug> convention");

    if (portfolio) {
      const txns = await prisma.portfolioTransaction.findMany({ where: { portfolioId: portfolio.id }, orderBy: { side: "asc" } });
      assertEqual(txns.length, 2, "exactly two transactions were written");
      const buy = txns.find((t) => t.side === "BUY");
      const sell = txns.find((t) => t.side === "SELL");
      assertEqual(buy?.status, "EXECUTED", "BUY is written directly as EXECUTED");
      assertEqual(buy?.quantity, 500, "BUY quantity is floor(50000/100)");
      assertEqual(buy?.priceAtTx, 100, "BUY priceAtTx matches the entry session close");
      assertEqual(buy?.requestedAt.toISOString(), publishedAt.toISOString(), "BUY requestedAt is the historical publishedAt");
      assertEqual(sell?.quantity, 500, "SELL quantity matches the BUY quantity");
      assertEqual(sell?.priceAtTx, 120, "SELL priceAtTx matches the exit session close");
      assertEqual(sell?.requestedAt.toISOString(), resolvedAt.toISOString(), "SELL requestedAt is the historical resolvedAt");

      const dailyValues = await prisma.portfolioDailyValue.findMany({ where: { portfolioId: portfolio.id } });
      assertTrue(dailyValues.length > 0, "PortfolioDailyValue was backfilled for the new shadow portfolio");
    }

    // ── Idempotent re-run ──────────────────────────────────────────────────
    const run2 = await runShadowGeneration({ dryRun: false, expertSlug });
    assertEqual(run2.errors.length, 0, "second run has no errors");
    assertEqual(run2.sessionsFetched, 0, "second run fetches zero sessions (still fully covered)");
    assertEqual(run2.portfoliosCreated, 0, "second run creates no new portfolio (already exists)");
    assertEqual(run2.transactionsWritten, 0, "second run writes zero new transactions");
    assertEqual(run2.transactionsAlreadyPresent, 2, "second run recognizes both prior transactions as already present");

    if (portfolio) {
      const txnsAfter = await prisma.portfolioTransaction.findMany({ where: { portfolioId: portfolio.id } });
      assertEqual(txnsAfter.length, 2, "re-running did not duplicate any transaction");
    }
  } finally {
    await cleanup();
  }
}

async function main() {
  console.log("Shadow Portfolios P3.3 — pure-function + DB integration acceptance run\n");
  runPureChecks();
  await runDbIntegrationCheck();

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(async (err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
