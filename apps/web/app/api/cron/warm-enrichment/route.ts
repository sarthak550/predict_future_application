import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { warmEnrichmentBatch, computeEnrichmentStaleness } from "@/lib/finance/enrichment";
import {
  bseEquityPageSymbol,
  clearsBseEquityFloor,
  getRecentBseEquitySessionDates,
  summarizeBseEquityWindow,
  type BseEquityWindowSummary,
} from "@/lib/finance/bseEquity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/cron/warm-enrichment — rolling fundamentals warm-up (founder
 * 2026-07-26: "we just filled data for Reliance only, we need that for all
 * stocks"). The enrichment cache is read-through (first visitor seeds a
 * symbol), which left every unvisited stock empty. This cron processes the
 * BATCH_SIZE stalest-and-due symbols per call — never-fetched first, then
 * oldest, skipping anything that's still fresh (including confirmed-empty
 * rows inside their negative-cache window, see `computeEnrichmentStaleness`)
 * — so with a 10-minute crontab the whole universe fills within roughly a
 * day and stays perpetually inside its TTL afterwards.
 *
 * BSE Rotation (2026-08-14) — founder report: the 2,554 BSE-only `.BO` pages
 * (commit 51f904d) showed no company details. Root cause: this cron's
 * universe was built purely off `StockEodQuote` (NSE bhavcopy), so a
 * BSE-only symbol could never win a warm-cron slot — only ever get enriched
 * by a visitor's own on-demand fire-and-forget fetch (verified live to work
 * correctly; see enrichment.ts's file doc for the live-verification detail
 * and the Yahoo-coverage sample). Universe now ALSO includes the BSE-only
 * equity window (`getRecentBseEquitySessionDates` + `summarizeBseEquityWindow`,
 * bseEquity.ts — the SAME turnover-over-a-30-session-window floor contract
 * `search`/`sitemap`/the instrument page itself already share, landed the
 * same day by the "BSE floor: turnover-based" fix; this cron was written
 * against that contract from the start rather than the older single-session
 * share-count floor it superseded), added as two more priority tiers behind
 * NSE:
 *   Tier 0 — NSE F&O names (unchanged, people actually trade these)
 *   Tier 1 — NSE long tail (unchanged)
 *   Tier 2 — BSE-only equities that clear the indexability turnover floor
 *            (`clearsBseEquityFloor`, bseEquity.ts) — these have real
 *            indexed/searchable pages, so they get warmed before...
 *   Tier 3 — BSE-only equities BELOW the floor. Never dropped from the
 *            rotation entirely (founder brief asked "last or never" — CTO
 *            call: last, not never) — a below-floor page is still directly
 *            reachable by URL even though it's not indexed/browsed/searched,
 *            Yahoo coverage on this tail tested ~100% live (see enrichment.ts),
 *            and the marginal crawl cost of the remaining names is small. A
 *            direct visitor to one of these should eventually stop hitting a
 *            cold on-demand fetch too.
 * See this route's own rotation-time math in the shipping report — adding
 * the BSE universe roughly doubles one full rotation's wall time versus
 * NSE alone, still comfortably inside the 7-day fundamentals TTL.
 *
 * Auth: CRON_SECRET Bearer, same convention as every other cron.
 * Batch is processed SEQUENTIALLY with a small delay — ~4-7 Yahoo requests
 * per symbol; politeness beats speed for a background filler.
 */

const BATCH_SIZE = 40;
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

type Exchange = "NSE" | "BSE";
type CandidateItem = { symbol: string; companyName: string; exchange: Exchange; tier: number };
type StalenessRow = Parameters<typeof computeEnrichmentStaleness>[0];

const ENRICHMENT_STALENESS_SELECT = {
  symbol: true,
  fundamentalsFetchedAt: true,
  keyStatsFetchedAt: true,
  annualRevenue: true,
  annualNetIncome: true,
  annualDilutedEps: true,
  quarterlyRevenue: true,
  quarterlyNetIncome: true,
  quarterlyDilutedEps: true,
  dividends: true,
  debtCoverage: true,
  keyStats: true,
} as const;

/** F&O membership set (server-to-server; the ~210 names people actually open get warmed before the ~1,900-name NSE long tail). Empty set on any failure — priority degrades to plain staleness order, never blocks the batch. */
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
  // A ".BO"-suffixed entry (e.g. "NSDL.BO") targets the BSE-only universe.
  const body = (await request.json().catch(() => null)) as { symbols?: string[] } | null;
  const targeted = (body?.symbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);

  // NSE universe = latest session's bhavcopy symbols (the same set instrument
  // pages are indexable for).
  const latestNse = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  const nseUniverse = latestNse
    ? await prisma.stockEodQuote.findMany({
        where: { sessionDate: latestNse.sessionDate },
        select: { symbol: true, companyName: true },
      })
    : [];

  // BSE-only universe (BSE Rotation, 2026-08-14) — the SAME trailing-window
  // aggregation search/sitemap use (see this route's top doc comment): a
  // single-latest-session query would silently drop any symbol that simply
  // didn't trade on that exact calendar day (140-symbol live-verified gap
  // per the turnover-floor fix's own commit message), which would have
  // undermined this cron's whole "warm the long tail" purpose the same way
  // it undermined search/sitemap before that fix.
  const recentBseSessionDates = await getRecentBseEquitySessionDates();
  const bseWindowRows =
    recentBseSessionDates.length > 0
      ? await prisma.bseEodQuote.findMany({
          where: { sessionDate: { in: recentBseSessionDates } },
          select: { tickerSymbol: true, companyName: true, sessionDate: true, close: true, volume: true },
        })
      : [];
  const bseSummaries: BseEquityWindowSummary[] = summarizeBseEquityWindow(bseWindowRows);

  if (!latestNse && bseSummaries.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reason: "no_eod_universe" });
  }

  if (targeted.length > 0) {
    const targetSet = new Set(targeted);
    const nseMatches = nseUniverse
      .filter((u) => targetSet.has(u.symbol))
      .map((u) => ({ symbol: u.symbol, companyName: u.companyName, exchange: "NSE" as const }));
    const bseMatches = bseSummaries
      .filter((s) => targetSet.has(bseEquityPageSymbol(s.tickerSymbol)))
      .map((s) => ({ symbol: bseEquityPageSymbol(s.tickerSymbol), companyName: s.companyName, exchange: "BSE" as const }));
    const batch = [...nseMatches, ...bseMatches].slice(0, BATCH_SIZE);
    const result = await warmEnrichmentBatch(batch);
    return NextResponse.json({ ok: true, mode: "targeted", ...result });
  }

  const [enrichedRows, fnoSet] = await Promise.all([
    prisma.instrumentEnrichment.findMany({ select: ENRICHMENT_STALENESS_SELECT }),
    fetchFnoSymbolSet(),
  ]);
  const rowBySymbol = new Map<string, StalenessRow>(enrichedRows.map((r) => [r.symbol, r]));

  // Priority: F&O names, then NSE long tail, then BSE-only above the
  // liquidity floor, then BSE-only below it — see this route's top doc
  // comment for the full tier rationale. Within each tier, stalest-first
  // (never-fetched = 0) — RELIANCE ties with thousands of never-fetched
  // symbols on staleness alone and loses the alphabetical race without the
  // tier.
  const nseItems: CandidateItem[] = nseUniverse.map((u) => ({
    symbol: u.symbol,
    companyName: u.companyName,
    exchange: "NSE",
    tier: fnoSet.has(u.symbol) ? 0 : 1,
  }));
  const bseItems: CandidateItem[] = bseSummaries.map((s) => ({
    symbol: bseEquityPageSymbol(s.tickerSymbol),
    companyName: s.companyName,
    exchange: "BSE",
    tier: clearsBseEquityFloor(s.maxTurnoverInWindow) ? 2 : 3,
  }));

  // Negative-cache-aware filter (2026-08-14) — a symbol whose last attempt
  // came back confirmed-empty gets a long TTL before it's eligible again
  // (see computeEnrichmentStaleness); a symbol with real, still-fresh data
  // needs no touch at all. Either way, skipping ineligible symbols here
  // (rather than just sorting them to the back) lets every batch slot go to
  // genuinely due work instead of being wasted re-confirming an absence we
  // already know about.
  const due = [...nseItems, ...bseItems].filter((c) => {
    const { fundamentalsStale, keyStatsStale } = computeEnrichmentStaleness(rowBySymbol.get(c.symbol) ?? null);
    return fundamentalsStale || keyStatsStale;
  });

  const batch = due
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const at = rowBySymbol.get(a.symbol)?.fundamentalsFetchedAt?.getTime() ?? 0;
      const bt = rowBySymbol.get(b.symbol)?.fundamentalsFetchedAt?.getTime() ?? 0;
      return at - bt;
    })
    .slice(0, BATCH_SIZE)
    .map(({ symbol, companyName, exchange }) => ({ symbol, companyName, exchange }));

  const result = await warmEnrichmentBatch(batch);
  return NextResponse.json({ ok: true, mode: "priority", dueCount: due.length, ...result });
}
