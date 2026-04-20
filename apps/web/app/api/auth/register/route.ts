import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { STARTING_BALANCE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = registerSchema.parse(body);

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

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const user = await prisma.user.create({
      data: {
        username: payload.username,
        email: payload.email.toLowerCase(),
        passwordHash,
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
