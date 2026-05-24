import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { processLeagueMonthEnd } from "@/lib/leagues/monthEnd";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/leagues/process-month-end
 *
 * Runs month-end promotion/relegation for the given month (defaults to the
 * previous IST calendar month). Admin-only.
 *
 * Body: { month?: string }  — YYYY-MM format. Omit to default to last month.
 *
 * Response (new run):
 *   { month, processed, promoted, relegated }
 *
 * Response (already processed):
 *   { alreadyProcessed: true }
 */

/** Returns the previous IST month as a 'YYYY-MM' string. */
function previousIstMonth(): string {
  const now = new Date();
  // Shift to IST
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  // Go back one month
  const prevDate = new Date(
    Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth() - 1, 1)
  );
  const yyyy = prevDate.getUTCFullYear();
  const mm = String(prevDate.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: { month?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty or malformed body — treat as no month override
  }

  const month = body.month ?? previousIstMonth();

  if (!isValidMonth(month)) {
    return NextResponse.json(
      { error: "Invalid month format. Expected YYYY-MM." },
      { status: 400 }
    );
  }

  try {
    const result = await processLeagueMonthEnd(month);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[admin/leagues/process-month-end] Error:", error);
    return NextResponse.json(
      { error: "Failed to process month-end leagues." },
      { status: 500 }
    );
  }
}
