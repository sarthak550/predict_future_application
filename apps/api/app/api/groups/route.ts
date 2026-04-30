import { NextResponse } from "next/server";

import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { getUserGroups } from "@/lib/groups/service";

/**
 * GET /api/groups — returns the authenticated user's groups (owned + joined).
 * Accepts ?userId= query param as fallback for mobile dev/demo mode.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const groups = await getUserGroups(userId);
  return NextResponse.json({ groups });
}
