import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: { username: string } }
) {
  const user = await prisma.user.findUnique({
    where: { username: params.username },
    include: {
      stats: true,
      badges: {
        include: {
          badge: true
        }
      },
      categoryStats: true
    }
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ user });
}
