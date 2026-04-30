import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { evaluateTrustedHostEligibility } from "@/lib/markets/policies";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      stats: true
    }
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const eligibility = evaluateTrustedHostEligibility({
    user,
    stats: user.stats
  });

  return NextResponse.json({ eligibility });
}
