import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
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
  request: Request,
  { params }: { params: { userId: string } }
) {
  const requestUserId = await getUserIdFromRequest(request);
  if (!requestUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: requestUserId },
    select: { id: true, role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN") {
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

    const nextVerified = !target.isVerifiedAnalyst;

    // S42-T13(c): Idempotency — use updateMany with the current state in the
    // WHERE clause so concurrent requests can't double-toggle. If count === 0,
    // the state was already at the target; return a no-op 200.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: params.userId, isVerifiedAnalyst: !nextVerified },
        data: { isVerifiedAnalyst: nextVerified },
      });

      if (result.count === 0) {
        // Already at the target state — skip AdminAction write and signal no-op.
        return null;
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: params.userId },
        select: { id: true, username: true, isVerifiedAnalyst: true },
      });

      // S42-T13(b): Use semantically correct enum values instead of ADJUST_BALANCE.
      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          targetUserId: params.userId,
          type: nextVerified ? "GRANT_VERIFIED_ANALYST" : "REVOKE_VERIFIED_ANALYST",
          notes: nextVerified
            ? `Granted Verified Analyst badge to @${target.username}.`
            : `Revoked Verified Analyst badge from @${target.username}.`,
          metadata: { isVerifiedAnalyst: nextVerified },
        },
      });

      return updatedUser;
    });

    if (updated === null) {
      return NextResponse.json({
        userId: target.id,
        username: target.username,
        isVerifiedAnalyst: target.isVerifiedAnalyst,
        noOp: true,
      });
    }

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
