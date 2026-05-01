import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { getUserGroups } from "@/lib/groups/service";

/**
 * GET /api/groups — returns the authenticated user's groups (owned + joined).
 * Groups are private; discovery is intentionally not supported. Users join via invite code.
 */
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const groups = await getUserGroups(userId);
  return NextResponse.json({ groups });
}
