import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { evaluateTrustedHostEligibility } from "@/lib/markets/policies";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
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
