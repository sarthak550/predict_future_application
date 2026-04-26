import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/auth";

const JWT_SECRET = process.env.NEXTAUTH_SECRET ?? "fallback-dev-secret";

/**
 * Mobile registration. Creates the account and immediately returns a JWT
 * so the user doesn't need a separate login step.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = registerSchema.parse(body);

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: payload.email.toLowerCase() }, { username: payload.username }],
      },
    });

    if (existing) {
      return NextResponse.json({ error: "Email or username is already in use." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const user = await prisma.user.create({
      data: {
        username: payload.username,
        email: payload.email.toLowerCase(),
        passwordHash,
        stats: { create: {} },
        notifications: {
          create: {
            type: "SYSTEM",
            title: "Welcome!",
            body: "Your account is ready. Start sharing your opinions on the latest news!",
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
