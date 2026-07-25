import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { warmEnrichmentBatch } from "@/lib/finance/enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/cron/warm-enrichment — rolling fundamentals warm-up (founder
 * 2026-07-26: "we just filled data for Reliance only, we need that for all
 * stocks"). The enrichment cache is read-through (first visitor seeds a
 * symbol), which left every unvisited stock empty. This cron processes the
 * BATCH_SIZE stalest symbols per call — never-fetched first, then oldest —
 * so with a 10-minute crontab the whole ~2,100-symbol universe fills within
 * a day and stays perpetually inside the 7-day fundamentals TTL afterwards
 * (steady state needs ~13 symbols/hour; this provides ~150/hour).
 *
 * Auth: CRON_SECRET Bearer, same convention as every other cron.
 * Batch is processed SEQUENTIALLY with a small delay — ~4 Yahoo requests per
 * symbol; politeness beats speed for a background filler.
 */

const BATCH_SIZE = 25;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Universe = latest session's bhavcopy symbols (the same set instrument
  // pages are indexable for). Never-enriched symbols first, then stalest.
  const latest = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  if (!latest) return NextResponse.json({ ok: true, processed: 0, reason: "no_eod_universe" });

  const universe = await prisma.stockEodQuote.findMany({
    where: { sessionDate: latest.sessionDate },
    select: { symbol: true, companyName: true },
  });
  const enriched = await prisma.instrumentEnrichment.findMany({
    select: { symbol: true, fundamentalsFetchedAt: true },
  });
  const fetchedAtBySymbol = new Map(enriched.map((e) => [e.symbol, e.fundamentalsFetchedAt?.getTime() ?? 0]));

  const batch = universe
    .sort((a, b) => (fetchedAtBySymbol.get(a.symbol) ?? 0) - (fetchedAtBySymbol.get(b.symbol) ?? 0))
    .slice(0, BATCH_SIZE);

  const result = await warmEnrichmentBatch(batch);
  return NextResponse.json({ ok: true, ...result });
}
