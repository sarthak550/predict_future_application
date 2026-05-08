/**
 * One-shot backfill: assigns a unique referral code to every User
 * that currently has referralCode = NULL.
 *
 * Safe to run multiple times — only touches rows where referralCode IS NULL.
 * Called during seed or as a standalone script.
 */
import { prisma } from "@/lib/prisma";

import { generateReferralCode } from "./code";

export async function backfillReferralCodes(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { referralCode: null },
    select: { id: true, username: true },
  });

  if (users.length === 0) {
    console.log("[referral backfill] All users already have referral codes.");
    return;
  }

  console.log(`[referral backfill] Backfilling ${users.length} users...`);

  let success = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const code = await generateReferralCode(user.username);
      await prisma.user.update({
        where: { id: user.id },
        data: { referralCode: code },
      });
      success++;
    } catch (err) {
      console.error(`[referral backfill] Failed for user ${user.id}:`, err);
      failed++;
    }
  }

  console.log(
    `[referral backfill] Done. Success: ${success}, Failed: ${failed}`
  );
}
