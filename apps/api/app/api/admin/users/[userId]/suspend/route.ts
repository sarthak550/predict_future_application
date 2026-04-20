import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const suspendSchema = z.object({
  reason: z.string().max(500).optional().or(z.literal(""))
});

export async function POST(
  request: Request,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: session.user.id }
    });
    if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const payload = suspendSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: params.userId }
      });
      if (!target) {
        throw new Error("User not found.");
      }

      const nextSuspended = !target.isSuspended;
      await tx.user.update({
        where: { id: target.id },
        data: {
          isSuspended: nextSuspended,
          suspendedReason: nextSuspended ? payload.reason || "Suspended by staff." : null
        }
      });

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          targetUserId: target.id,
          type: nextSuspended ? "SUSPEND_USER" : "UNSUSPEND_USER",
          notes: payload.reason || null
        }
      });

      await createNotification(tx, {
        userId: target.id,
        type: "SYSTEM",
        title: nextSuspended ? "Account suspended" : "Account restored",
        body: nextSuspended
          ? payload.reason || "Your account has been suspended by staff."
          : "Your account has been restored by staff.",
        href: "/feed"
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to update user status." }, { status: 400 });
  }
}
