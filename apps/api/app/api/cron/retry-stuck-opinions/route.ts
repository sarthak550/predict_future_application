/**
 * POST /api/cron/retry-stuck-opinions
 *
 * Daily resilience pass for opinions that the normal extraction pipeline left
 * with no instrument/ticker. Reasons they get stuck:
 *
 *   • Inline extraction at create time was rate-limited (Groq 429)
 *   • Older prompts didn't recognize the instrument; newer prompts might
 *   • cleanup-invalid-tickers nulled the ticker because it was a known-bad
 *     Yahoo symbol; we now want to try extraction again to find a working one
 *
 * Without this retry, those opinions sit PENDING forever, never get graded,
 * and never surface in the "Resolved only" feed or count toward user accuracy.
 *
 * Strategy: PENDING opinions older than MIN_AGE_DAYS (so we don't double-retry
 * fresh ones) with null instrumentTicker. Cap at BATCH_SIZE per run to respect
 * Groq rate limits.
 */

import { NextResponse } from "next/server";

import { extractInstrumentFromQuote } from "@/lib/ai/extractInstrument";
import { prisma } from "@/lib/prisma";

const MIN_AGE_DAYS = 1; // skip opinions created in the last 24h (fresh extraction already tried)
const BATCH_SIZE = 50;
const DELAY_MS = 400; // between Groq calls to respect rate limits

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const minAge = new Date(Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const stuck = await prisma.expertOpinion.findMany({
      where: {
        resolutionStatus: "PENDING",
        instrumentTicker: null,
        suppressedAt: null,
        createdAt: { lte: minAge },
      },
      select: {
        id: true,
        quote: true,
        story: { select: { headline: true } },
      },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });

    if (stuck.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, matched: 0 });
    }

    let matched = 0;
    let unknown = 0;
    let errored = 0;
    const errors: string[] = [];

    for (const op of stuck) {
      try {
        const extracted = await extractInstrumentFromQuote(op.quote, op.story?.headline ?? "");
        if (extracted) {
          await prisma.expertOpinion.update({
            where: { id: op.id },
            data: { instrument: extracted.instrument, instrumentTicker: extracted.ticker },
          });
          matched++;
        } else {
          unknown++;
        }
      } catch (err) {
        errored++;
        errors.push(`${op.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(DELAY_MS);
    }

    console.info(
      `[retry-stuck-opinions] scanned=${stuck.length} matched=${matched} unknown=${unknown} errored=${errored}`
    );

    return NextResponse.json({
      ok: true,
      scanned: stuck.length,
      matched,
      unknown,
      errored,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    console.error("[retry-stuck-opinions] job failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retry job failed." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
