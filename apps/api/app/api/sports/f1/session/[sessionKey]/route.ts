import { NextRequest, NextResponse } from "next/server";

import { fetchF1SessionDetail } from "@/lib/sports/f1";

/**
 * GET /api/sports/f1/session/:sessionKey
 *
 * Returns full F1 session detail: position, lap times, gaps, tire stints.
 * Public — no authentication required.
 *
 * Responses:
 *   200  — session detail JSON (see ApiF1SessionDetail in @predict-future/types)
 *   400  — sessionKey is not a valid integer
 *   404  — session not found on OpenF1 (unknown sessionKey)
 *   503  — downstream OpenF1 fetch failed
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { sessionKey: string } }
) {
  const sessionKey = parseInt(params.sessionKey, 10);

  if (isNaN(sessionKey) || sessionKey <= 0) {
    return NextResponse.json(
      { error: "Invalid session key — must be a positive integer." },
      { status: 400 }
    );
  }

  try {
    const detail = await fetchF1SessionDetail(sessionKey);

    if (!detail) {
      return NextResponse.json(
        { error: "Session not found." },
        { status: 404 }
      );
    }

    // Downgrade cache duration when all drivers lack timing data (poisoned empty
    // response from OpenF1). A 15-second max-age lets CDNs revalidate quickly
    // rather than serving stale null-timing data for 5 minutes.
    const allTimingNull = detail.drivers.every(
      (d) => d.fastestLap == null && d.lastLap == null
    );
    const cacheHeader = allTimingNull
      ? "public, max-age=15, s-maxage=15, stale-while-revalidate=5"
      : "public, max-age=300, s-maxage=300, stale-while-revalidate=60";

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": cacheHeader,
      },
    });
  } catch (err) {
    console.error("[f1:session] upstream error for sessionKey", sessionKey, ":", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "F1 data temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }
}
