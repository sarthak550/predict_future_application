import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/users/[userId]/verify-analyst
 *
 * Admin-only toggle for the Verified Analyst credential.
 * Toggles User.isVerifiedAnalyst (true->false, false->true).
 *
 * ─── Verification criteria (for admin reference) ─────────────────────────────
 * A user is eligible for Verified Analyst when:
 *   totalPredictions >= 50  AND  accuracyScore >= 0.60
 *
 * Helper query to find eligible users:
 *   SELECT u.username, us."totalPredictions", us."accuracyScore"
 *   FROM "User" u
 *   JOIN "UserStat" us ON us."userId" = u.id
 *   WHERE us."totalPredictions" >= 50
 *     AND us."accuracyScore" >= 0.60
 *   ORDER BY us."accuracyScore" DESC;
 *
 * Admins may override these thresholds at their discretion.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(
  _request: Request,
  { params }: { params: { userId: string } }
) {
  // Auth: ADMIN only.
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (!actor || actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    // Fetch target and toggle
    const target = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, username: true, isVerifiedAnalyst: true },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const updated = await prisma.user.update({
      where: { id: params.userId },
      data: { isVerifiedAnalyst: !target.isVerifiedAnalyst },
      select: { id: true, username: true, isVerifiedAnalyst: true },
    });

    return NextResponse.json({
      userId: updated.id,
      username: updated.username,
      isVerifiedAnalyst: updated.isVerifiedAnalyst,
    });
  } catch (error) {
    console.error("[verify-analyst]", error);
    return NextResponse.json({ error: "Unable to update analyst status." }, { status: 500 });
  }
}
