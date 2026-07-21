/**
 * P3.1 acceptance script for the Portfolios engine + settlement/valuation crons.
 *
 * Exercises, against a REAL local database (creates its own throwaway test
 * User/Portfolio/StockEodQuote rows, all under symbols prefixed "ZZTEST" and an
 * email under @portfolios-verify.test, and deletes everything it created in a
 * `finally` block regardless of pass/fail):
 *
 *   1. Placement-time validation (validateNewTransaction) — pure, no DB.
 *   2. Happy path: BUY placed PENDING -> settlePendingTransactions() fills it at
 *      the correct next-session close -> backfillDailyValues() caches the correct
 *      NAV for two sessions.
 *   3. Settlement-time over-cash rejection: an order that was affordable at an
 *      earlier estimate gets CANCELLED (with a note) when the real fill price
 *      makes it unaffordable.
 *   4. Settlement-time oversell rejection: a SELL for more than is actually held
 *      gets CANCELLED (with a note).
 *   5. Cancel: a PENDING order flips to CANCELLED and is never picked up again by
 *      settlement (immutability of a non-PENDING row).
 *   6. Idempotent re-runs: re-running both crons after everything has settled
 *      produces zero further mutations.
 *
 * Run: npx tsx scripts/verify-portfolios-engine.ts   (from apps/api)
 */

import { validateNewTransaction } from "@predict-future/business-rules/portfolios/engine";

import { prisma } from "../lib/prisma";
import { settlePendingTransactions } from "../lib/portfolios/settlement";
import { backfillDailyValues } from "../lib/portfolios/valuation";

const TEST_EMAIL_DOMAIN = "@portfolios-verify.test";
const SYMBOL_PREFIX = "ZZTEST";

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

function day(offset: number): Date {
  // Fixed, far-past base date so this never collides with real ingested sessions.
  return new Date(Date.UTC(2020, 0, 6 + offset, 0, 0, 0)); // 2020-01-06 = a Monday
}

async function cleanup() {
  await prisma.portfolio.deleteMany({ where: { ownerUser: { email: { endsWith: TEST_EMAIL_DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await prisma.stockEodQuote.deleteMany({ where: { symbol: { startsWith: SYMBOL_PREFIX } } });
}

async function main() {
  console.log("Portfolios P3.1 — engine + cron acceptance run\n");
  await cleanup(); // in case a previous failed run left rows behind

  const suffix = Math.random().toString(36).slice(2, 8);
  const user = await prisma.user.create({
    data: {
      username: `portfolios_verify_${suffix}`,
      email: `portfolios_verify_${suffix}${TEST_EMAIL_DOMAIN}`
    }
  });

  try {
    // ── 1. Placement-time validation (pure) ────────────────────────────────
    console.log("1. validateNewTransaction (pure, no DB)");
    assertTrue(
      validateNewTransaction({
        side: "BUY",
        quantity: 10,
        symbol: "ZZTEST1",
        availableCash: 1000,
        estimatedPrice: 100,
        heldQuantity: 0,
        pendingSellQuantity: 0
      }).ok,
      "BUY within available cash is accepted"
    );
    assertEqual(
      validateNewTransaction({
        side: "BUY",
        quantity: 100,
        symbol: "ZZTEST1",
        availableCash: 1000,
        estimatedPrice: 100,
        heldQuantity: 0,
        pendingSellQuantity: 0
      }).ok,
      false,
      "BUY exceeding available cash is rejected"
    );
    assertEqual(
      validateNewTransaction({
        side: "SELL",
        quantity: 50,
        symbol: "ZZTEST1",
        availableCash: 1000,
        estimatedPrice: 100,
        heldQuantity: 10,
        pendingSellQuantity: 0
      }).ok,
      false,
      "SELL exceeding held quantity is rejected (long-only, no shorting)"
    );
    assertEqual(
      validateNewTransaction({
        side: "BUY",
        quantity: 0,
        symbol: "ZZTEST1",
        availableCash: 1000,
        estimatedPrice: 100,
        heldQuantity: 0,
        pendingSellQuantity: 0
      }).ok,
      false,
      "Zero quantity is rejected"
    );

    // ── 2. Happy path: BUY -> settle -> value (two sessions) ───────────────
    console.log("\n2. Happy path: BUY -> settle -> value");
    const portfolioA = await prisma.portfolio.create({
      data: { ownerUserId: user.id, kind: "USER", name: "Verify A", slug: `verify-a-${suffix}`, startingCapital: 1_000_000 }
    });

    const session1 = day(0);
    const session1IngestedAt = new Date(session1.getTime() + 19 * 60 * 60 * 1000); // ~19:00 same day
    await prisma.stockEodQuote.create({
      data: {
        sessionDate: session1,
        symbol: "ZZTEST1",
        companyName: "Test Co 1",
        prevClose: 99,
        close: 100,
        changePercent: 1.01,
        volume: 10_000,
        createdAt: session1IngestedAt
      }
    });

    const orderRequestedAt = new Date(session1.getTime() + 10 * 60 * 60 * 1000); // 10:00, before that day's ingest
    const buyOrder = await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolioA.id,
        symbol: "ZZTEST1",
        side: "BUY",
        quantity: 100,
        requestedAt: orderRequestedAt,
        status: "PENDING"
      }
    });

    const settleRun1 = await settlePendingTransactions();
    assertTrue(settleRun1.executed >= 1, "settlement run executed at least the happy-path BUY");

    const filledBuy = await prisma.portfolioTransaction.findUniqueOrThrow({ where: { id: buyOrder.id } });
    assertEqual(filledBuy.status, "EXECUTED", "happy-path BUY filled (EXECUTED)");
    assertEqual(filledBuy.priceAtTx, 100, "happy-path BUY filled at the session close (100)");
    assertEqual(
      filledBuy.executionSessionDate?.toISOString(),
      session1.toISOString(),
      "happy-path BUY filled at session1 (the first session ingested after the order was placed)"
    );

    const session2 = day(1);
    const session2IngestedAt = new Date(session2.getTime() + 19 * 60 * 60 * 1000);
    await prisma.stockEodQuote.create({
      data: {
        sessionDate: session2,
        symbol: "ZZTEST1",
        companyName: "Test Co 1",
        prevClose: 100,
        close: 110,
        changePercent: 10,
        volume: 12_000,
        createdAt: session2IngestedAt
      }
    });

    const valueRun1 = await backfillDailyValues();
    assertTrue(valueRun1.sessionsWritten >= 2, "valuation run wrote both sessions for portfolio A");

    // NOTE: this local DB may already contain OTHER real StockEodQuote sessions
    // (e.g. from the Market Pulse EOD cron, unrelated to this test) dated after
    // session1. The valuation cron correctly extends a portfolio's cached NAV
    // series to every global session on/after its first trade — including ones
    // where it holds nothing new — so we must not hardcode "exactly 2 rows"; we
    // compare against however many distinct sessions actually exist on/after
    // session1, and assert exact values only for session1/session2 specifically.
    const sessionsSinceSession1 = await prisma.stockEodQuote.groupBy({
      by: ["sessionDate"],
      where: { sessionDate: { gte: session1 } }
    });
    const valuesA = await prisma.portfolioDailyValue.findMany({
      where: { portfolioId: portfolioA.id },
      orderBy: { sessionDate: "asc" }
    });
    assertEqual(
      valuesA.length,
      sessionsSinceSession1.length,
      "portfolio A has one cached daily value per global session on/after session1"
    );

    const valueAtSession1 = valuesA.find((v) => v.sessionDate.getTime() === session1.getTime());
    const valueAtSession2 = valuesA.find((v) => v.sessionDate.getTime() === session2.getTime());
    assertTrue(valueAtSession1 !== undefined, "session1 has a cached daily value");
    assertTrue(valueAtSession2 !== undefined, "session2 has a cached daily value");
    if (valueAtSession1) {
      assertEqual(valueAtSession1.cash, 990_000, "session1 cash = 1,000,000 - (100 * 100)");
      assertEqual(valueAtSession1.holdingsValue, 10_000, "session1 holdingsValue = 100 * 100 (same-day close)");
      assertEqual(valueAtSession1.totalValue, 1_000_000, "session1 totalValue = startingCapital (no P&L yet)");
      assertEqual(valueAtSession1.returnPct, 0, "session1 returnPct = 0");
    }
    if (valueAtSession2) {
      assertEqual(valueAtSession2.cash, 990_000, "session2 cash unchanged (no new fills)");
      assertEqual(valueAtSession2.holdingsValue, 11_000, "session2 holdingsValue = 100 * 110");
      assertEqual(valueAtSession2.totalValue, 1_001_000, "session2 totalValue reflects the price move");
      assertEqual(valueAtSession2.returnPct, 0.001, "session2 returnPct = 1,000 / 1,000,000");
    }

    // ── 3. Settlement-time over-cash rejection ──────────────────────────────
    console.log("\n3. Settlement-time over-cash rejection");
    const portfolioB = await prisma.portfolio.create({
      data: { ownerUserId: user.id, kind: "USER", name: "Verify B", slug: `verify-b-${suffix}`, startingCapital: 1_000 }
    });
    const sessionB = day(0);
    const sessionBIngestedAt = new Date(sessionB.getTime() + 19 * 60 * 60 * 1000);
    await prisma.stockEodQuote.create({
      data: {
        sessionDate: sessionB,
        symbol: "ZZTEST2",
        companyName: "Test Co 2",
        prevClose: 45,
        close: 50, // 100 * 50 = 5,000 > the portfolio's 1,000 starting capital
        changePercent: 11.1,
        volume: 5_000,
        createdAt: sessionBIngestedAt
      }
    });
    const overCashOrder = await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolioB.id,
        symbol: "ZZTEST2",
        side: "BUY",
        quantity: 100,
        requestedAt: new Date(sessionB.getTime() + 10 * 60 * 60 * 1000),
        status: "PENDING"
      }
    });

    await settlePendingTransactions();
    const cancelledBuy = await prisma.portfolioTransaction.findUniqueOrThrow({ where: { id: overCashOrder.id } });
    assertEqual(cancelledBuy.status, "CANCELLED", "over-cash BUY is CANCELLED at settlement");
    assertTrue(
      typeof cancelledBuy.note === "string" && cancelledBuy.note.toLowerCase().includes("insufficient cash"),
      "over-cash BUY's note explains the rejection"
    );

    // ── 4. Settlement-time oversell rejection ───────────────────────────────
    console.log("\n4. Settlement-time oversell rejection");
    const portfolioC = await prisma.portfolio.create({
      data: { ownerUserId: user.id, kind: "USER", name: "Verify C", slug: `verify-c-${suffix}`, startingCapital: 1_000_000 }
    });
    const sessionC1 = day(0);
    await prisma.stockEodQuote.create({
      data: {
        sessionDate: sessionC1,
        symbol: "ZZTEST3",
        companyName: "Test Co 3",
        prevClose: 95,
        close: 100,
        changePercent: 5.3,
        volume: 5_000,
        createdAt: new Date(sessionC1.getTime() + 19 * 60 * 60 * 1000)
      }
    });
    // Directly seed an EXECUTED holding of 10 shares (bypasses order placement — we're
    // testing the settlement engine's oversell guard, not the placement-time path).
    await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolioC.id,
        symbol: "ZZTEST3",
        side: "BUY",
        quantity: 10,
        requestedAt: new Date(sessionC1.getTime() + 10 * 60 * 60 * 1000),
        status: "EXECUTED",
        executionSessionDate: sessionC1,
        priceAtTx: 100
      }
    });

    const sessionC2 = day(1);
    await prisma.stockEodQuote.create({
      data: {
        sessionDate: sessionC2,
        symbol: "ZZTEST3",
        companyName: "Test Co 3",
        prevClose: 100,
        close: 120,
        changePercent: 20,
        volume: 6_000,
        createdAt: new Date(sessionC2.getTime() + 19 * 60 * 60 * 1000)
      }
    });
    const oversellOrder = await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolioC.id,
        symbol: "ZZTEST3",
        side: "SELL",
        quantity: 50, // only 10 are held
        requestedAt: new Date(sessionC1.getTime() + 20 * 60 * 60 * 1000), // after session1 ingest, before session2
        status: "PENDING"
      }
    });

    await settlePendingTransactions();
    const cancelledSell = await prisma.portfolioTransaction.findUniqueOrThrow({ where: { id: oversellOrder.id } });
    assertEqual(cancelledSell.status, "CANCELLED", "oversell SELL is CANCELLED at settlement");
    assertTrue(
      typeof cancelledSell.note === "string" && cancelledSell.note.toLowerCase().includes("insufficient holdings"),
      "oversell SELL's note explains the rejection"
    );

    const holdingUnchanged = await prisma.portfolioTransaction.findMany({
      where: { portfolioId: portfolioC.id, status: "EXECUTED" }
    });
    assertEqual(holdingUnchanged.length, 1, "the original 10-share BUY is untouched — a rejected SELL never mutates prior EXECUTED rows");

    // ── 5. Cancel: PENDING -> CANCELLED, never re-picked-up ─────────────────
    console.log("\n5. Cancel");
    const cancelMe = await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolioA.id,
        symbol: "ZZTEST1",
        side: "BUY",
        quantity: 1,
        requestedAt: new Date(session2.getTime() + 10 * 60 * 60 * 1000),
        status: "PENDING"
      }
    });
    const cancelResult = await prisma.portfolioTransaction.updateMany({
      where: { id: cancelMe.id, status: "PENDING" },
      data: { status: "CANCELLED", note: "Cancelled by user." }
    });
    assertEqual(cancelResult.count, 1, "user-cancel updates exactly the one PENDING row");

    await settlePendingTransactions(); // must not resurrect the cancelled order
    const stillCancelled = await prisma.portfolioTransaction.findUniqueOrThrow({ where: { id: cancelMe.id } });
    assertEqual(stillCancelled.status, "CANCELLED", "cancelled order is untouched by a later settlement run");
    assertEqual(stillCancelled.priceAtTx, null, "cancelled order was never given a fill price");

    // ── 6. Idempotent re-runs ────────────────────────────────────────────────
    console.log("\n6. Idempotent re-runs");
    const settleRun2 = await settlePendingTransactions();
    assertEqual(settleRun2.executed, 0, "re-running settlement executes nothing new");
    assertEqual(settleRun2.cancelled, 0, "re-running settlement cancels nothing new");

    // Portfolio C got its first EXECUTED transaction in step 4 but has never been
    // through backfillDailyValues() yet — prime it (and re-touch A, a no-op) before
    // the actual idempotency check, so THAT run is a genuine no-new-work assertion
    // rather than conflating "first valuation of C" with "re-run wrote something".
    await backfillDailyValues();
    const valuesABeforeIdempotencyCheck = await prisma.portfolioDailyValue.findMany({
      where: { portfolioId: portfolioA.id }
    });
    const valuesCBeforeIdempotencyCheck = await prisma.portfolioDailyValue.findMany({
      where: { portfolioId: portfolioC.id }
    });

    const valueRun2 = await backfillDailyValues();
    assertEqual(valueRun2.sessionsWritten, 0, "re-running valuation writes no new sessions once every portfolio is fully cached");

    const valuesAAfter = await prisma.portfolioDailyValue.findMany({ where: { portfolioId: portfolioA.id } });
    const valuesCAfter = await prisma.portfolioDailyValue.findMany({ where: { portfolioId: portfolioC.id } });
    assertEqual(valuesAAfter.length, valuesABeforeIdempotencyCheck.length, "re-running valuation did not duplicate or drop portfolio A's cached rows");
    assertEqual(valuesCAfter.length, valuesCBeforeIdempotencyCheck.length, "re-running valuation did not duplicate or drop portfolio C's cached rows");
  } finally {
    await cleanup();
  }

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
