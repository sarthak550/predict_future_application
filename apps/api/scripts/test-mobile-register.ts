/**
 * Regression test for the mobile registration wallet-creation fix.
 *
 * Run with:
 *   npx tsx scripts/test-mobile-register.ts
 * from the apps/api directory (requires API server running on localhost:3000).
 *
 * What it checks:
 *   1. POST /api/auth/mobile/register returns HTTP 201 with { user: { id }, token }.
 *   2. A Wallet record exists for the new user with balance === STARTING_BALANCE.
 *   3. A UserStat record exists for the new user.
 *   4. A welcome Notification record exists for the new user.
 *
 * The test user is cleaned up (hard-deleted) after the assertions.
 */

import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "../lib/prisma";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3000";

interface RegisterResponse {
  user?: { id: string; username: string };
  token?: string;
  error?: string;
}

async function main() {
  const suffix = Date.now();
  const testEmail = `regression-test-${suffix}@test.internal`;
  const testUsername = `regtest${suffix}`;
  const testPassword = "TestPass1234!";

  console.log(`\n=== Mobile Register Regression Test ===`);
  console.log(`  Email:    ${testEmail}`);
  console.log(`  Username: ${testUsername}`);
  console.log(`  Endpoint: ${API_BASE}/api/auth/mobile/register\n`);

  let userId: string | null = null;

  try {
    // ------------------------------------------------------------------ //
    // 1. Call the registration endpoint
    // ------------------------------------------------------------------ //
    const response = await fetch(`${API_BASE}/api/auth/mobile/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        username: testUsername,
        password: testPassword,
      }),
    });

    const body: RegisterResponse = await response.json();

    if (response.status !== 201) {
      throw new Error(
        `Expected HTTP 201, got ${response.status}. Body: ${JSON.stringify(body)}`
      );
    }

    if (!body.user?.id) {
      throw new Error(`Response missing user.id. Body: ${JSON.stringify(body)}`);
    }

    if (!body.token) {
      throw new Error(`Response missing token (mobile route must return a JWT). Body: ${JSON.stringify(body)}`);
    }

    userId = body.user.id;
    console.log(`  [PASS] POST /api/auth/mobile/register → 201, token present, userId=${userId}`);

    // ------------------------------------------------------------------ //
    // 2. Wallet assertion
    // ------------------------------------------------------------------ //
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      throw new Error(`Wallet record is NULL for userId=${userId}. The wallet-creation bug has regressed.`);
    }

    if (wallet.balance !== STARTING_BALANCE) {
      throw new Error(
        `Wallet balance is ${wallet.balance}, expected ${STARTING_BALANCE}.`
      );
    }

    if (wallet.startingBalance !== STARTING_BALANCE) {
      throw new Error(
        `Wallet startingBalance is ${wallet.startingBalance}, expected ${STARTING_BALANCE}.`
      );
    }

    console.log(
      `  [PASS] Wallet exists — balance=${wallet.balance}, startingBalance=${wallet.startingBalance}`
    );

    // ------------------------------------------------------------------ //
    // 3. UserStat assertion
    // ------------------------------------------------------------------ //
    const stats = await prisma.userStat.findUnique({ where: { userId } });

    if (!stats) {
      throw new Error(`UserStat record is NULL for userId=${userId}.`);
    }

    console.log(`  [PASS] UserStat exists`);

    // ------------------------------------------------------------------ //
    // 4. Welcome notification assertion
    // ------------------------------------------------------------------ //
    const notification = await prisma.notification.findFirst({ where: { userId } });

    if (!notification) {
      throw new Error(`No Notification record found for userId=${userId}. Welcome notification was not created.`);
    }

    if (notification.title !== "Welcome to the news feed") {
      throw new Error(
        `Welcome notification title is "${notification.title}", expected "Welcome to the news feed".`
      );
    }

    console.log(`  [PASS] Welcome notification exists — title="${notification.title}"`);

    // ------------------------------------------------------------------ //
    // Summary
    // ------------------------------------------------------------------ //
    console.log(`\n  RESULT: PASS — all 4 assertions cleared.\n`);
  } catch (err) {
    console.error(`\n  RESULT: FAIL — ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    // ------------------------------------------------------------------ //
    // Cleanup — delete test user (cascades to wallet, stats, notifications)
    // ------------------------------------------------------------------ //
    if (userId) {
      try {
        await prisma.user.delete({ where: { id: userId } });
        console.log(`  Cleanup: test user ${userId} deleted.\n`);
      } catch (cleanupErr) {
        console.warn(`  Cleanup warning: could not delete test user — ${cleanupErr}`);
      }
    }

    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
