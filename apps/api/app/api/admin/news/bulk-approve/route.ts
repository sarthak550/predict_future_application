import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { bulkApproveEligibleStories } from "@/lib/news/bulk-approval";
import { prisma } from "@/lib/prisma";
import { adminBulkStoryApproveSchema } from "@/lib/validations/news";

export async function POST(request: Request) {
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

  try {
    const rawPayload = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : {};
    const payload = adminBulkStoryApproveSchema.parse(rawPayload);
    const result = await bulkApproveEligibleStories({
      actorId: actor.id,
      limit: payload.limit,
      trustedOnly: payload.trustedOnly
    });

    return NextResponse.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to bulk approve stories." },
      { status: 400 }
    );
  }
}
