/**
 * One-off verification script — run with:
 *   npx tsx scripts/verify-backfill.ts
 * from the apps/api directory.
 *
 * Confirms that all 7 production users affected by the missing-wallet bug
 * have wallets, and that no other walletless users remain.
 */
import { prisma } from "../lib/prisma";

const AFFECTED_USERNAMES = ["kiran", "kiran1", "kiran2", "kiran3", "kiran4", "sar1", "sar2"];

async function main() {
  // 1. Check the 7 known affected users
  const users = await prisma.user.findMany({
    where: { username: { in: AFFECTED_USERNAMES } },
    select: {
      username: true,
      wallet: { select: { balance: true, startingBalance: true } },
    },
  });

  console.log("\n=== Affected-user wallet status ===");
  let missingCount = 0;
  for (const username of AFFECTED_USERNAMES) {
    const user = users.find((u) => u.username === username);
    if (!user) {
      console.log(`  SKIP  @${username} — not found in database (may be a typo in the report)`);
      continue;
    }
    if (!user.wallet) {
      console.log(`  FAIL  @${username} — wallet IS NULL`);
      missingCount++;
    } else {
      console.log(
        `  OK    @${username} — balance=${user.wallet.balance}, startingBalance=${user.wallet.startingBalance}`
      );
    }
  }

  // 2. Broad check: any user without a wallet?
  const walletlessCount = await prisma.user.count({ where: { wallet: null } });
  console.log(`\n=== Global walletless user count ===`);
  console.log(`  Users with wallet=null: ${walletlessCount}`);

  // Summary
  console.log("\n=== Result ===");
  if (missingCount === 0 && walletlessCount === 0) {
    console.log("  PASS — all affected users have wallets; no walletless users in the database.");
  } else {
    if (missingCount > 0) {
      console.log(`  FAIL — ${missingCount} affected user(s) are still missing wallets. Re-run backfill-wallets.ts.`);
    }
    if (walletlessCount > 0) {
      console.log(`  FAIL — ${walletlessCount} user(s) in the database have no wallet. Re-run backfill-wallets.ts.`);
    }
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
