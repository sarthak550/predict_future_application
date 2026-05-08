import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { generateReferralCode } from "@/lib/referrals/code";
import { registerSchema } from "@/lib/validations/auth";

/**
 * Web registration endpoint.
 *
 * Accepts an optional `referralCode` body field. If provided and it matches
 * an existing user's referralCode, sets referredById on the new user.
 * Invalid codes are silently ignored — registration never fails because of them.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = registerSchema.parse(body);

    // Optional referral code — validated separately, never blocks registration
    const incomingReferralCode =
      typeof body.referralCode === "string" && body.referralCode.trim().length > 0
        ? (body.referralCode.trim() as string)
        : null;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: payload.email.toLowerCase() }, { username: payload.username }]
      }
    });

    if (existingUser) {
      return NextResponse.json(
        {
          error: "Email or username is already in use."
        },
        { status: 409 }
      );
    }

    // Resolve referrer if a code was supplied
    let referredById: string | null = null;
    if (incomingReferralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: incomingReferralCode },
        select: { id: true },
      });
      if (referrer) {
        referredById = referrer.id;
      }
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const referralCode = await generateReferralCode(payload.username);

    const user = await prisma.user.create({
      data: {
        username: payload.username,
        email: payload.email.toLowerCase(),
        passwordHash,
        referralCode,
        referredById,
        wallet: {
          create: {
            balance: STARTING_BALANCE,
            startingBalance: STARTING_BALANCE
          }
        },
        stats: {
          create: {}
        },
        notifications: {
          create: {
            type: "SYSTEM",
            title: "Welcome to the news feed",
            body: `Your account is ready and ${STARTING_BALANCE.toLocaleString("en-IN")} virtual points have been added for your first predictions.`,
            href: "/feed"
          }
        }
      }
    });

    return NextResponse.json({ user: { id: user.id, username: user.username } }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to register account." }, { status: 400 });
  }
}
