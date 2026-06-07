import { NextResponse } from "next/server";

/**
 * POST /api/analytics/events
 *
 * Lightweight fire-and-forget analytics event ingestion.
 * Accepts any named event with an optional payload and logs it to console.
 *
 * Design notes:
 * - No auth required — same pattern as big-call-tap.
 * - No schema migration needed — logs to console (structured JSON for log aggregator pickup).
 *   If an AnalyticsEvent model is added in a future sprint, swap the console.log for a
 *   prisma.analyticsEvent.create() call here without touching callers.
 * - Always returns 200 so mobile fire-and-forget callers never see errors.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).event !== "string"
    ) {
      return NextResponse.json({ ok: false, error: "Missing event name." }, { status: 400 });
    }

    const { event, payload } = body as { event: string; payload?: unknown };

    // Structured log — picked up by log aggregators (Vercel, Datadog, etc.)
    console.log(
      JSON.stringify({
        level: "info",
        source: "analytics",
        event,
        payload: payload ?? {},
        ts: new Date().toISOString(),
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Never propagate analytics errors to the client
    console.error("[analytics/events] parse error", err);
    return NextResponse.json({ ok: true });
  }
}
