import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { isCredentialsLoginAllowed } from "@/lib/credentialsGate";

import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
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
  // Sprint 74 residual (QA finding, 2026-08-16): this pre-pivot "web
  // registration endpoint" has had ZERO callers since apps/web grew its own
  // register route (web calls its own origin; mobile registers via
  // /api/auth/mobile/register — verified in packages/api-client). Left open
  // it was the last remaining "any random string as email" surface — same
  // flag, same 403 contract as apps/web's route.
  if (!isCredentialsLoginAllowed()) {
    console.warn(
      "[auth/register] Rejected: ALLOW_CREDENTIALS_LOGIN is not enabled. " +
        "Credentials sign-up is dev-only in production; direct users to Google sign-in."
    );
    return NextResponse.json(
      { error: "Email/password sign-up is not available. Please sign in with Google." },
      { status: 403 }
    );
  }

  try {
    // IP-based rate limit: 5 registrations per IP per hour.
    // NOTE: in-memory — resets on cold start. Sprint N should migrate to Redis.
    const ip = request.headers.get("x-forwarded-for") ?? "unknown";
    const rl = await checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
        }
      );
    }

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
