import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateReferralCode } from "@/lib/referrals/code";
import { registerSchema } from "@/lib/validations/auth";

if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET env var is required");
const JWT_SECRET: string = process.env.NEXTAUTH_SECRET;

/**
 * Mobile registration. Creates the account and immediately returns a JWT
 * so the user doesn't need a separate login step.
 *
 * Accepts an optional `referralCode` body field. If provided and it matches
 * an existing user's referralCode, sets referredById on the new user.
 * Invalid codes are silently ignored — registration never fails because of them.
 */
export async function POST(request: Request) {
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

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: payload.email.toLowerCase() }, { username: payload.username }],
      },
    });

    if (existing) {
      return NextResponse.json({ error: "Email or username is already in use." }, { status: 409 });
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
            startingBalance: STARTING_BALANCE,
          },
        },
        stats: { create: {} },
        notifications: {
          create: {
            type: "SYSTEM",
            title: "Welcome to the news feed",
            body: `Your account is ready and ${STARTING_BALANCE.toLocaleString("en-IN")} virtual points have been added for your first predictions.`,
            href: "/feed",
          },
        },
      },
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email, username: user.username, role: "USER" },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return NextResponse.json(
      { user: { id: user.id, username: user.username }, token },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to register account." }, { status: 400 });
  }
}
