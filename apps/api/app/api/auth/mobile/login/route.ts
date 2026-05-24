import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET env var is required");
const JWT_SECRET: string = process.env.NEXTAUTH_SECRET;

/**
 * Mobile login endpoint. Validates email + password and returns a signed JWT
 * that mobile clients send as `Authorization: Bearer <token>`.
 *
 * This exists because NextAuth's credential flow relies on HTTP-only cookies
 * which don't work from a native app. The JWT uses the same NEXTAUTH_SECRET
 * so `getSession()` can verify it.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    // Brute-force protection. IP gate is wide (10 attempts / 15 min) to allow shared
    // networks; per-email gate is tight (5 failed attempts / 15 min) since real users
    // succeed before exhausting it. Successful login resets the email counter.
    const ip = request.headers.get("x-forwarded-for") ?? "unknown";
    const ipRl = await checkRateLimit(`login:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts from this network. Please wait." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((ipRl.resetAt - Date.now()) / 1000)) } }
      );
    }
    const emailRl = await checkRateLimit(`login:email:${email}`, 5, 15 * 60 * 1000);
    if (!emailRl.allowed) {
      return NextResponse.json(
        { error: "Too many failed attempts for this account. Please wait." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((emailRl.resetAt - Date.now()) / 1000)) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isSuspended: true,
        passwordHash: true,
      },
    });

    if (!user?.passwordHash) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    if (user.isSuspended) {
      return NextResponse.json({ error: "This account is suspended." }, { status: 403 });
    }

    // Successful login — clear the email-specific failed-attempt counter so a
    // legitimate user who mistyped a few times before getting it right isn't locked out.
    await resetRateLimit(`login:email:${email}`);

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return NextResponse.json({
      user: { id: user.id, username: user.username },
      token,
    });
  } catch {
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
