/**
 * Standalone backfill — run with: npx tsx scripts/backfill-wallets.ts
 * from apps/api directory.
 *
 * Creates a starting-balance wallet for any user that doesn't have one
 * (mobile registrations before the wallet-creation fix were missing it).
 */
import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "../lib/prisma";

async function main() {
  const usersWithoutWallets = await prisma.user.findMany({
    where: { wallet: null },
    select: { id: true, username: true, email: true },
  });

  console.log(`Found ${usersWithoutWallets.length} users without a wallet.`);

  if (usersWithoutWallets.length === 0) {
    return;
  }

  for (const user of usersWithoutWallets) {
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: STARTING_BALANCE,
        startingBalance: STARTING_BALANCE,
      },
    });
    console.log(`  ✓ created wallet for @${user.username} (${user.email})`);
  }

  console.log(`\nDone. Backfilled ${usersWithoutWallets.length} wallets at ${STARTING_BALANCE.toLocaleString("en-IN")} pts each.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
