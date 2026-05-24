import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

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
