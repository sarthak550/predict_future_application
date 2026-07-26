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
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

/** F&O membership set (server-to-server; the ~210 names people actually open get warmed before the ~1,900-name long tail). Empty set on any failure — priority degrades to plain staleness order, never blocks the batch. */
async function fetchFnoSymbolSet(): Promise<Set<string>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_INTERNAL_URL}/api/finance/options/fo-universe`, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return new Set();
    const data = (await res.json()) as { universe?: { symbol: string }[] };
    return new Set((data.universe ?? []).map((e) => e.symbol));
  } catch {
    return new Set();
  }
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Targeted mode: {"symbols": ["RELIANCE", ...]} warms exactly those, now —
  // used for manual backfills (e.g. schema-addition resets on marquee names).
  const body = (await request.json().catch(() => null)) as { symbols?: string[] } | null;
  const targeted = (body?.symbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);

  // Universe = latest session's bhavcopy symbols (the same set instrument
  // pages are indexable for).
  const latest = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  if (!latest) return NextResponse.json({ ok: true, processed: 0, reason: "no_eod_universe" });

  const universe = await prisma.stockEodQuote.findMany({
    where: { sessionDate: latest.sessionDate },
    select: { symbol: true, companyName: true },
  });

  if (targeted.length > 0) {
    const targetSet = new Set(targeted);
    const batch = universe.filter((u) => targetSet.has(u.symbol)).slice(0, BATCH_SIZE);
    const result = await warmEnrichmentBatch(batch);
    return NextResponse.json({ ok: true, mode: "targeted", ...result });
  }

  const [enriched, fnoSet] = await Promise.all([
    prisma.instrumentEnrichment.findMany({ select: { symbol: true, fundamentalsFetchedAt: true } }),
    fetchFnoSymbolSet(),
  ]);
  const fetchedAtBySymbol = new Map(enriched.map((e) => [e.symbol, e.fundamentalsFetchedAt?.getTime() ?? 0]));

  // Priority: F&O names before the long tail; within each tier, stalest first
  // (never-fetched = 0). RELIANCE ties with 2,000 never-fetched symbols on
  // staleness alone and loses the alphabetical race without the tier.
  const batch = universe
    .sort((a, b) => {
      const tierA = fnoSet.has(a.symbol) ? 0 : 1;
      const tierB = fnoSet.has(b.symbol) ? 0 : 1;
      if (tierA !== tierB) return tierA - tierB;
      return (fetchedAtBySymbol.get(a.symbol) ?? 0) - (fetchedAtBySymbol.get(b.symbol) ?? 0);
    })
    .slice(0, BATCH_SIZE);

  const result = await warmEnrichmentBatch(batch);
  return NextResponse.json({ ok: true, mode: "priority", ...result });
}
