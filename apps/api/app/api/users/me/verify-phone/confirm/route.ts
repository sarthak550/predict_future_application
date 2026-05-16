/**
 * POST /api/users/me/verify-phone/confirm
 *
 * Confirms a pending phone verification OTP for the authenticated user.
 *
 * Body: { otp: string }
 *
 * On success:
 *   - Sets User.phoneVerified = true.
 *   - Creates a DAILY_BONUS WalletTransaction for +100 pts.
 *   - Increments Wallet.balance by 100.
 *   - Creates a SYSTEM Notification to confirm the bonus.
 *   - All four writes happen in a single Prisma transaction.
 *   - Clears the OTP from the in-memory store to prevent reuse.
 *
 * Idempotent: if the user is already verified, returns 200 { alreadyVerified: true }
 * without re-crediting.
 *
 * Returns 400 on OTP mismatch or expiry.
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clearOtp, verifyOtp } from "@/lib/phone-verification";

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("otp" in body) ||
      typeof (body as Record<string, unknown>).otp !== "string"
    ) {
      return NextResponse.json({ error: "otp is required and must be a string." }, { status: 400 });
    }

    const submittedOtp = (body as { otp: string }).otp.trim();

    // Idempotency check: if already verified, do nothing.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phoneVerified: true, phone: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (user.phoneVerified) {
      return NextResponse.json({ ok: true, phoneVerified: true, bonusCredited: 100, alreadyVerified: true });
    }

    // Validate OTP against the DB-backed store.
    const { valid, phone } = await verifyOtp(userId, submittedOtp);

    if (!valid || !phone) {
      return NextResponse.json(
        { error: "Invalid or expired OTP. Please request a new code." },
        { status: 400 }
      );
    }

    // Commit verification in a single transaction.
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Mark user as verified.
        await tx.user.update({
          where: { id: userId },
          data: { phoneVerified: true, phone },
        });

        // 2. Look up wallet.
        const wallet = await tx.wallet.findUnique({
          where: { userId },
          select: { id: true },
        });

        if (!wallet) {
          throw new Error(`Wallet not found for user ${userId}`);
        }

        // 3. Create DAILY_BONUS transaction (+100 pts).
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "DAILY_BONUS",
            amount: 100,
            description: "Phone verification bonus",
          },
        });

        // 4. Increment wallet balance.
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: 100 } },
        });

        // 5. Create in-app notification.
        await tx.notification.create({
          data: {
            userId,
            type: "SYSTEM",
            title: "Phone verified!",
            body: "You earned 100 pts for verifying your phone number.",
          },
        });
      });
    } catch (txError) {
      console.error("[verify-phone/confirm] Transaction failed:", txError);
      return NextResponse.json(
        { error: "Failed to complete phone verification. Please try again." },
        { status: 500 }
      );
    }

    // Clear OTP only after successful commit.
    await clearOtp(userId);

    return NextResponse.json({ ok: true, phoneVerified: true, bonusCredited: 100 });
  } catch (error) {
    console.error("[verify-phone/confirm POST]", error);
    return NextResponse.json(
      { error: "Unable to confirm phone verification." },
      { status: 500 }
    );
  }
}
