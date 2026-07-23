/**
 * Paper Trading Phase 1 — T4 acceptance dry-run for the intraday auto square-off
 * cron (apps/api/lib/paperTrading/squareoff.ts).
 *
 * Exercises against a REAL local database (creates its own throwaway
 * User/PaperTradingAccount/PaperOrder rows under an email under
 * @papertrading-verify.test, deletes everything it created in a `finally` block
 * regardless of pass/fail) AND a REAL live fetch of RELIANCE's delayed intraday
 * tick (fetchIntradaySeries hits Yahoo Finance directly — there is no dependency
 * injection seam to mock it without complicating the production module for a
 * test-only concern, and a live fetch is arguably a MORE meaningful acceptance
 * check than a mocked one for a cron whose entire job is "price a real fill").
 * Requires outbound network access; if Yahoo is unreachable from this
 * environment the script reports that clearly and exits non-zero rather than
 * silently passing.
 *
 * Covers:
 *   1. An open intraday LONG gets force-closed with a SELL, autoSquaredOff: true.
 *   2. An open intraday SHORT gets force-closed with a BUY, autoSquaredOff: true.
 *   3. An already-flat account (fully closed intraday position) is a no-op.
 *   4. The forced closing leg's cost breakdown exactly matches computeOrderCosts()
 *      called directly with the same inputs — i.e. the cron uses no separate
 *      "cron pricing" path.
 *
 * Run: npx tsx scripts/verify-papertrading-squareoff.ts   (from apps/api)
 */

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";

import { prisma } from "../lib/prisma";
import { fetchIntradaySeries } from "../lib/marketMoves/intraday";
import { runIntradaySquareOff } from "../lib/paperTrading/squareoff";

const TEST_EMAIL_DOMAIN = "@papertrading-verify.test";
const SYMBOL = "RELIANCE";

let passCount = 0;
let failCount = 0;

function assertTrue(actual: boolean, message: string) {
  if (actual) {
    passCount += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message}`);
  }
}

function assertClose(actual: number, expected: number, message: string, epsilon = 1e-6) {
  const ok = Math.abs(actual - expected) < epsilon;
  if (ok) {
    passCount += 1;
    console.log(`  PASS: ${message} (${actual.toFixed(4)})`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message}\n        expected=${expected} actual=${actual}`);
  }
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } }, select: { id: true } });
  const accountIds = (
    await prisma.paperTradingAccount.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } })
  ).map((a) => a.id);
  await prisma.paperOrder.deleteMany({ where: { accountId: { in: accountIds } } });
  await prisma.paperTradingAccount.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function main() {
  console.log("Paper Trading Phase 1 — T4 auto square-off cron acceptance dry-run\n");
  await cleanup();

  console.log(`Checking live intraday data availability for ${SYMBOL}...`);
  const series = await fetchIntradaySeries(SYMBOL);
  if (!series || series.points.length === 0) {
    console.error(
      `No live intraday data available for ${SYMBOL} from this environment (network blocked, or Yahoo returned nothing). ` +
        `This script needs outbound network access to exercise the real fill path — re-run from an environment with internet access ` +
        `(e.g. the EC2 host) to complete this check. The pure position-selection logic this cron depends on ` +
        "(openIntradayPositions) is already covered by scripts/verify-papertrading-engine.ts, which requires no network."
    );
    process.exit(1);
  }
  console.log(`  Got ${series.points.length} ticks, last price ₹${series.points.at(-1)!.price}\n`);

  const suffix = Math.random().toString(36).slice(2, 8);
  const user = await prisma.user.create({
    data: { username: `papertrading_verify_${suffix}`, email: `papertrading_verify_${suffix}${TEST_EMAIL_DOMAIN}` }
  });

  try {
    const longAccount = await prisma.paperTradingAccount.create({ data: { userId: user.id, startingCapital: 100000 } });
    const openLongCosts = computeOrderCosts({ side: "BUY", productType: "INTRADAY", quantity: 10, price: 2000 });
    await prisma.paperOrder.create({
      data: {
        accountId: longAccount.id,
        symbol: SYMBOL,
        side: "BUY",
        productType: "INTRADAY",
        quantity: 10,
        fillPrice: 2000,
        fillTickAt: new Date(),
        grossAmount: openLongCosts.grossAmount,
        brokerage: openLongCosts.brokerage,
        sttAmount: openLongCosts.stt,
        exchangeCharge: openLongCosts.exchangeCharge,
        sebiFee: openLongCosts.sebiFee,
        stampDuty: openLongCosts.stampDuty,
        gstAmount: openLongCosts.gst,
        dpCharge: openLongCosts.dpCharge,
        totalCosts: openLongCosts.totalCosts,
        netAmount: openLongCosts.netAmount
      }
    });

    const shortAccount = await prisma.paperTradingAccount.create({ data: { userId: user.id, startingCapital: 100000 } });
    // A second ACTIVE account for the same user violates the "one ACTIVE per user"
    // app-layer rule in real traffic (only lib/paperTrading/account.ts's
    // getOrCreateActiveAccount enforces it) — fine for this direct-DB test, which
    // never goes through that function.
    const openShortCosts = computeOrderCosts({ side: "SELL", productType: "INTRADAY", quantity: 5, price: 2000 });
    await prisma.paperOrder.create({
      data: {
        accountId: shortAccount.id,
        symbol: SYMBOL,
        side: "SELL",
        productType: "INTRADAY",
        quantity: 5,
        fillPrice: 2000,
        fillTickAt: new Date(),
        grossAmount: openShortCosts.grossAmount,
        brokerage: openShortCosts.brokerage,
        sttAmount: openShortCosts.stt,
        exchangeCharge: openShortCosts.exchangeCharge,
        sebiFee: openShortCosts.sebiFee,
        stampDuty: openShortCosts.stampDuty,
        gstAmount: openShortCosts.gst,
        dpCharge: openShortCosts.dpCharge,
        totalCosts: openShortCosts.totalCosts,
        netAmount: openShortCosts.netAmount
      }
    });

    const flatAccount = await prisma.paperTradingAccount.create({ data: { userId: user.id, startingCapital: 100000 } });
    const flatBuyCosts = computeOrderCosts({ side: "BUY", productType: "INTRADAY", quantity: 3, price: 500 });
    const flatSellCosts = computeOrderCosts({ side: "SELL", productType: "INTRADAY", quantity: 3, price: 505 });
    await prisma.paperOrder.createMany({
      data: [
        {
          accountId: flatAccount.id,
          symbol: "TCS",
          side: "BUY",
          productType: "INTRADAY",
          quantity: 3,
          fillPrice: 500,
          fillTickAt: new Date(),
          grossAmount: flatBuyCosts.grossAmount,
          brokerage: flatBuyCosts.brokerage,
          sttAmount: flatBuyCosts.stt,
          exchangeCharge: flatBuyCosts.exchangeCharge,
          sebiFee: flatBuyCosts.sebiFee,
          stampDuty: flatBuyCosts.stampDuty,
          gstAmount: flatBuyCosts.gst,
          dpCharge: flatBuyCosts.dpCharge,
          totalCosts: flatBuyCosts.totalCosts,
          netAmount: flatBuyCosts.netAmount
        },
        {
          accountId: flatAccount.id,
          symbol: "TCS",
          side: "SELL",
          productType: "INTRADAY",
          quantity: 3,
          fillPrice: 505,
          fillTickAt: new Date(),
          grossAmount: flatSellCosts.grossAmount,
          brokerage: flatSellCosts.brokerage,
          sttAmount: flatSellCosts.stt,
          exchangeCharge: flatSellCosts.exchangeCharge,
          sebiFee: flatSellCosts.sebiFee,
          stampDuty: flatSellCosts.stampDuty,
          gstAmount: flatSellCosts.gst,
          dpCharge: flatSellCosts.dpCharge,
          totalCosts: flatSellCosts.totalCosts,
          netAmount: flatSellCosts.netAmount
        }
      ]
    });

    console.log("Running the cron...\n");
    const result = await runIntradaySquareOff();
    console.log(`  Result: ${JSON.stringify(result)}\n`);

    const longClosingOrder = await prisma.paperOrder.findFirst({
      where: { accountId: longAccount.id, autoSquaredOff: true },
      orderBy: { createdAt: "desc" }
    });
    assertTrue(longClosingOrder !== null, "Open LONG got an auto-squared-off closing order");
    if (longClosingOrder) {
      assertTrue(longClosingOrder.side === "SELL", "Closing a LONG uses a SELL");
      assertTrue(longClosingOrder.quantity === 10, "Closing quantity matches the open quantity");
      assertTrue(longClosingOrder.isSquareOff === true, "isSquareOff is set on the forced leg");

      const expectedCosts = computeOrderCosts({ side: "SELL", productType: "INTRADAY", quantity: 10, price: longClosingOrder.fillPrice });
      assertClose(longClosingOrder.totalCosts, expectedCosts.totalCosts, "Forced-close totalCosts exactly matches computeOrderCosts() called directly with the same fill price — no separate cron pricing path");
      assertClose(longClosingOrder.netAmount, expectedCosts.netAmount, "Forced-close netAmount matches too");
    }

    const shortClosingOrder = await prisma.paperOrder.findFirst({
      where: { accountId: shortAccount.id, autoSquaredOff: true },
      orderBy: { createdAt: "desc" }
    });
    assertTrue(shortClosingOrder !== null, "Open SHORT got an auto-squared-off closing order");
    if (shortClosingOrder) {
      assertTrue(shortClosingOrder.side === "BUY", "Closing a SHORT uses a BUY");
      assertTrue(shortClosingOrder.quantity === 5, "Closing quantity matches the open (short) quantity");
    }

    const flatAccountOrders = await prisma.paperOrder.count({ where: { accountId: flatAccount.id } });
    assertTrue(flatAccountOrders === 2, "Already-flat account got no extra order written (still exactly its original 2 legs)");

    const rerun = await runIntradaySquareOff();
    assertTrue(rerun.positionsClosed === 0, "Re-running the cron after everything is closed is a pure no-op (idempotent)");
  } finally {
    await cleanup();
  }

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("Unexpected failure:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
