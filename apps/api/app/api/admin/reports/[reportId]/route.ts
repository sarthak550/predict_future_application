import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const reportReviewSchema = z.object({
  status: z.enum(["REVIEWING", "RESOLVED", "DISMISSED"]),
  explanation: z.string().min(2).max(1000)
});

export async function PATCH(
  request: Request,
  { params }: { params: { reportId: string } }
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isSuspended: true },
    });
    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
    }
    if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = reportReviewSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      const report = await tx.marketReport.update({
        where: { id: params.reportId },
        data: {
          status: payload.status,
          explanation: payload.explanation,
          reviewedAt: new Date(),
          reviewerId: actor.id
        }
      });

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          marketId: report.marketId,
          reportId: report.id,
          type: "DISMISS_REPORT",
          notes: payload.explanation
        }
      });

      const openReports = await tx.marketReport.count({
        where: {
          marketId: report.marketId,
          status: {
            in: ["OPEN", "REVIEWING"]
          }
        }
      });

      if (openReports === 0) {
        await tx.market.update({
          where: { id: report.marketId },
          data: {
            isFlagged: false
          }
        });
      }

      await createNotification(tx, {
        userId: report.reporterId,
        marketId: report.marketId,
        type: "REPORT_UPDATE",
        title: "Report updated",
        body: payload.explanation,
        href: `/markets/${report.marketId}`
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to update report." }, { status: 400 });
  }
}
