import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReferralCode } from "@/lib/referrals/code";

/**
 * GET /api/users/me/referral-code
 *
 * Returns the authenticated user's referral info.
 * Lazily generates and persists a referralCode if one does not yet exist.
 *
 * Response:
 *   {
 *     referralCode: string,
 *     referralCount: number,   // how many users signed up with this code
 *     totalEarned: number      // sum of REFERRAL_BONUS_REFERRER wallet transactions
 *   }
 */
export async function GET(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        referralCode: true,
        _count: {
          select: { referrals: true },
        },
        wallet: {
          select: {
            transactions: {
              where: { type: "REFERRAL_BONUS_REFERRER" },
              select: { amount: true },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Lazy generation: assign a code if this user doesn't have one yet
    let referralCode = user.referralCode;
    if (!referralCode) {
      referralCode = await generateReferralCode(user.username);
      await prisma.user.update({
        where: { id: userId },
        data: { referralCode },
      });
    }

    const referralCount = user._count.referrals;
    const totalEarned =
      user.wallet?.transactions.reduce((sum, tx) => sum + tx.amount, 0) ?? 0;

    return NextResponse.json({ referralCode, referralCount, totalEarned });
  } catch (error) {
    console.error("[referral-code GET]", error);
    return NextResponse.json(
      { error: "Unable to retrieve referral code." },
      { status: 500 }
    );
  }
}
