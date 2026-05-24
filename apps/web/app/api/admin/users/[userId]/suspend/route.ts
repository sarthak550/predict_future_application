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
    // Defense in depth (matches the H11 sweep): refuse if the actor is
    // suspended. Note that mobile callers of admin paths see the suspension
    // within ~5 minutes due to the process-local cache in lib/auth.ts
    // (_suspendCache, TTL 5m) — intentional SLA, not a bug.
    if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR") || actor.isSuspended) {
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

      // Role hierarchy: a MODERATOR cannot suspend an ADMIN or another MODERATOR.
      // Only ADMINs can take actions against admin/mod accounts. This prevents
      // a compromised mod from taking down the platform admin.
      if (
        actor.role === "MODERATOR" &&
        (target.role === "ADMIN" || target.role === "MODERATOR")
      ) {
        throw new Error("Moderators cannot suspend admin or moderator accounts.");
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
