import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { bulkApproveEligibleStories } from "@/lib/news/bulk-approval";
import { adminBulkStoryApproveSchema } from "@/lib/validations/news";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  if (session.user.isSuspended) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
  }

  try {
    const rawPayload = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : {};
    const payload = adminBulkStoryApproveSchema.parse(rawPayload);
    const result = await bulkApproveEligibleStories({
      actorId: session.user.id,
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
