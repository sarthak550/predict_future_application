import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BarChart3, FileSearch, Gauge, ScrollText, Wallet } from "lucide-react";

import { BigCallCard } from "@/components/finance/big-call-card";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { EconomySection } from "@/components/finance/economy-section";
import { FirmLink } from "@/components/finance/firm-link";
import { InstrumentResearchTileLive } from "@/components/finance/instrument-research-tile-live";
import { PublicHeader } from "@/components/finance/public-header";
import { SentimentGauge } from "@/components/finance/sentiment-gauge";
import { SiteFooter } from "@/components/finance/site-footer";
import { TopMoversCard } from "@/components/finance/top-movers-card";
import { CostBreakdownTable } from "@/components/paper-trading/cost-breakdown-table";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchIndexableAnalysts, sortAnalysts } from "@/lib/finance/analysts";
import { getTodaysBigCall } from "@/lib/finance/bigCall";
import { fetchInstrumentDetail, type InstrumentDetail } from "@/lib/finance/instrument";
import { fetchMacroSnapshot } from "@/lib/finance/macro";
import { fetchMarketSummary } from "@/lib/finance/marketSummary";
import { fetchTopMovers } from "@/lib/finance/marketPulse";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";
import { getSentimentSplit } from "@/lib/finance/sentiment";
import { getPublishedNewsItems } from "@/lib/news/queries";
import { prisma } from "@/lib/prisma";
import { formatDateOnly, formatPercent } from "@/lib/utils";

/** Indian Economy section (T-Economy) — the macro news strip's item count, kept small and skimmable, matching the homepage's other "latest N" sections. */
const MACRO_NEWS_LIMIT = 4;

export const revalidate = 900;

/**
 * Instrument Research (T3) — a fixed, honest set of large-cap NSE names for
 * the homepage snapshot row. Indices (NIFTY/BANKNIFTY) were considered per
 * the CEO brief but deliberately dropped: fetchInstrumentDetail() has no
 * StockEodQuote series for them (the index price is client-fetched live on
 * their own detail pages only — see quote-header.tsx), so a server-rendered
 * snapshot would show "price data pending" and no sparkline for both,
 * undermining the "prove it works by showing it working" point of this
 * section. These four are real NSE large-caps confirmed (2026-08-09) to
 * carry both a live EOD quote AND real analyst-opinion coverage.
 */
const HOMEPAGE_INSTRUMENT_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "SBIN"] as const;

/** Paper Trading (T4) — the sample trade the cost breakdown renders. Quantity is fixed and honest, not tuned for a "nice" total. */
const SAMPLE_TRADE_SYMBOL = "RELIANCE";
const SAMPLE_TRADE_QUANTITY = 10;

// Title/description are inherited from the root layout (app/layout.tsx) — that
// copy already IS the homepage's Analyst Scorecard positioning, so this only
// adds the canonical/OG url rather than duplicating the title string.
export const metadata: Metadata = {
  alternates: { canonical: "https://predictfuture.app" },
  openGraph: { url: "https://predictfuture.app" },
};

// 6, not 5: a multiple of the lg:grid-cols-3 card grid below (see
// LatestGradedCalls/TopAnalysts) so a full house of results fills evenly
// (2 rows of 3) instead of leaving one gap cell in a half-empty last row.
const LATEST_GRADED_LIMIT = 6;
const TOP_ANALYSTS_LIMIT = 6;

async function fetchLatestGradedCalls() {
  return prisma.expertOpinion.findMany({
    where: {
      suppressedAt: null,
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
    },
    orderBy: { resolvedAt: "desc" },
    take: LATEST_GRADED_LIMIT,
    select: {
      id: true,
      quote: true,
      instrument: true,
      direction: true,
      sourceUrl: true,
      resolutionStatus: true,
      resolvedAt: true,
      expert: { select: { name: true, slug: true, avatarUrl: true, organization: true } },
    },
  });
}

/**
 * Hero scale-stat strip (T1). Deliberately scale counts only — NOT an
 * aggregate hit-rate — per the CEO brief: prod-wide accuracy (~40% as of
 * 2026-08-08) would undersell what the leaderboard already shows correctly,
 * per-analyst. Mirrors getSentimentSplit()/getTodaysBigCall()'s existing
 * live-query-at-render-time pattern, same revalidate window.
 */
async function fetchScaleStats() {
  const [analystsTracked, callsLogged, callsGraded] = await Promise.all([
    prisma.expert.count(),
    prisma.expertOpinion.count({ where: { suppressedAt: null } }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
    }),
  ]);
  return { analystsTracked, callsLogged, callsGraded };
}

/** Instrument Research (T3) — the fixed symbol set's live snapshots, fetched in parallel. Nulls (unknown symbol) are filtered at render time. */
async function fetchHomepageInstruments(): Promise<InstrumentDetail[]> {
  const details = await Promise.all(HOMEPAGE_INSTRUMENT_SYMBOLS.map((symbol) => fetchInstrumentDetail(symbol)));
  return details.filter((d): d is InstrumentDetail => d != null);
}

/**
 * Card-grid column classes that stop short of `maxCols` when there aren't
 * enough items to fill that many — a grid configured for more columns than
 * it has items leaves a bare region on the right at wide viewports (proven
 * live on this pass: TopAnalysts currently renders a single qualifying
 * analyst, and a lone card in a 3-col grid left ~2/3 of the row empty next
 * to it). Same "empty rectangle" failure mode the rest of this pass fixes,
 * just triggered by data availability instead of a fixed layout, so it gets
 * the same fix: never configure more columns than there is content.
 * Literal, Tailwind-scannable class strings only (no dynamic `grid-cols-${n}`
 * interpolation — that wouldn't survive the production build's CSS purge).
 */
function cardGridClass(count: number, maxCols: 3 | 4): string {
  if (count <= 1) return "grid gap-4";
  if (count === 2) return "grid gap-4 sm:grid-cols-2";
  if (count === 3 || maxCols === 3) return "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";
  return "grid gap-4 sm:grid-cols-2 lg:grid-cols-4";
}

export default async function HomePage() {
  const [
    sentiment,
    bigCall,
    latestGraded,
    analysts,
    scaleStats,
    popularMovers,
    allMovers,
    instruments,
    marketSummary,
    macro,
    macroNews,
  ] = await Promise.all([
    getSentimentSplit(),
    getTodaysBigCall(),
    fetchLatestGradedCalls(),
    fetchIndexableAnalysts(),
    fetchScaleStats(),
    fetchTopMovers("popular"),
    fetchTopMovers("all"),
    fetchHomepageInstruments(),
    fetchMarketSummary(),
    fetchMacroSnapshot(),
    getPublishedNewsItems({ limit: MACRO_NEWS_LIMIT, category: "FINANCE" }),
  ]);

  const topAnalysts = sortAnalysts(analysts, "accuracy").slice(0, TOP_ANALYSTS_LIMIT);

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />

      {/* Founder pushed back twice on residual side margins after 6xl→1440px —
          1440px still leaves a visible ~240px empty band per side on a
          1920px screen. Widened again; 1760px keeps a real (if generous)
          cap rather than going edge-to-edge, since several sections still
          rely on multi-column CSS grids (4-across tiles, etc.) that need a
          bounded width to lay out sensibly — but the gap should now read as
          intentional breathing room, not obviously wasted space. */}
      <main className="mx-auto max-w-[1760px] space-y-16 px-4 py-10 sm:px-6">
        <Hero sentiment={sentiment} bigCall={bigCall} scaleStats={scaleStats} />

        <LatestGradedCalls calls={latestGraded} />

        <MarketPulseSection popular={popularMovers} all={allMovers} />

        <EconomySection marketSummary={marketSummary} macro={macro} news={macroNews} />

        <InstrumentResearchSection instruments={instruments} />

        <PaperTradingSection instruments={instruments} />

        <WorkbenchSection />

        <TopAnalysts analysts={topAnalysts} />

        <HowItWorks />
      </main>

      {/* Founder 2026-08-09: the homepage previously rendered the
          disclaimer twice — AnalystDisclaimerFooter here, then SiteFooter's
          own (near-identical) legal paragraph right after. Removed the
          first; SiteFooter's copy is now the only one. Every OTHER page
          (analysts/opinions/pulse/instruments/calls) still uses
          AnalystDisclaimerFooter on its own — this removal is homepage-only,
          do not remove the import/component itself. */}
      <SiteFooter />
    </div>
  );
}

function Hero({
  sentiment,
  bigCall,
  scaleStats,
}: {
  sentiment: Awaited<ReturnType<typeof getSentimentSplit>>;
  bigCall: Awaited<ReturnType<typeof getTodaysBigCall>>;
  scaleStats: Awaited<ReturnType<typeof fetchScaleStats>>;
}) {
  // BigCallCard renders nothing when there's no candidate opinion (see its
  // own doc comment). Placement (founder, 2026-08-09 round 2 on the hero):
  // Market-wide sentiment belongs in the LEFT column, directly below the
  // analyst-tracked stat strip — beside Call of the Week, not stacked above
  // it. When there's no big call, sentiment takes the right column instead:
  // with it in the left column the xl 2-col split would leave the whole
  // right track empty — the exact "empty side space" failure the round-3/4
  // restructure exists to prevent, just data-triggered.
  const hasBigCall = bigCall.opinion != null;

  return (
    /* Founder correction 2026-08-09 (round 3 on "empty side space"): the
       text block and the SentimentGauge/BigCallCard row used to stack full
       width, top-to-bottom — on a wide viewport that left the entire area
       right of the (deliberately max-w-2xl-capped) headline empty, all the
       way down to where the row started. Above `xl` there's enough room for
       both side by side (text column capped at the same 42rem/max-w-2xl as
       before, row column filling the remainder); below `xl` it collapses
       back to the original stacked order. `gap-6`/`xl:gap-10` replace the
       old `space-y-6` — a margin-based stack breaks once the second child
       sits beside the first instead of below it. */
    <section className="grid gap-6 pt-4 xl:grid-cols-[minmax(0,42rem)_1fr] xl:items-start xl:gap-10">
      <div className="max-w-2xl space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600">
          <Gauge className="h-3.5 w-3.5 text-signal-sky" />
          India&rsquo;s Analyst Scorecard
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
          Track which market analysts are actually right.
        </h1>
        <p className="text-lg leading-8 text-ink-600">
          We track public calls from Indian market analysts — TV, print, and online — and grade every
          one HIT or MISS against what actually happened, sourced back to the original article. No
          spin, no cherry-picking, just the record.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/analysts"
            className="inline-flex items-center gap-2 rounded-2xl bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
          >
            See the Scorecard
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link
            href="/opinions"
            className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-5 py-3 text-sm font-semibold text-ink-900 transition hover:border-signal-sky hover:text-signal-sky"
          >
            Browse every call
          </Link>
        </div>

        <ScaleStatStrip stats={scaleStats} />

        {hasBigCall && <SentimentGauge split={sentiment} title="Market-wide sentiment" />}
      </div>

      {hasBigCall ? (
        <BigCallCard result={bigCall} />
      ) : (
        <SentimentGauge split={sentiment} title="Market-wide sentiment" />
      )}
    </section>
  );
}

/**
 * Hero scale-stat strip (T1) — three compact inline stat blocks, text-dense
 * (no icons) like TradingView's own scale-stat row. Any block whose count is
 * 0 is omitted entirely (never renders "0 analysts tracked") — a real
 * degrade-gracefully state, not a hidden bug. Renders nothing at all if
 * every count is 0 (a genuinely empty DB), rather than an empty strip.
 */
function ScaleStatStrip({ stats }: { stats: Awaited<ReturnType<typeof fetchScaleStats>> }) {
  const blocks = [
    { value: stats.analystsTracked, label: "analysts tracked" },
    { value: stats.callsLogged, label: "calls logged" },
    { value: stats.callsGraded, label: "graded HIT or MISS" },
  ].filter((b) => b.value > 0);

  if (blocks.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-2">
      {blocks.map((block) => (
        <div key={block.label}>
          <dt className="text-2xl font-semibold tabular-nums text-ink-900">
            {block.value.toLocaleString("en-IN")}
          </dt>
          <dd className="text-xs font-medium uppercase tracking-[0.14em] text-ink-400">{block.label}</dd>
        </div>
      ))}
    </dl>
  );
}

function LatestGradedCalls({ calls }: { calls: Awaited<ReturnType<typeof fetchLatestGradedCalls>> }) {
  if (calls.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-sky">Latest verdicts</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink-900">Recently graded calls</h2>
        </div>
        <Link href="/opinions?status=graded" className="text-sm font-medium text-ink-500 hover:text-ink-900">
          See all
        </Link>
      </div>

      {/* sm:2 then lg:3 (matching the breakpoint InstrumentResearchSection/
          HowItWorks already use for their own column jumps) — a fixed
          2-across left a full empty column at wide viewports since the
          outer container no longer caps out at 2-card width. LATEST_GRADED_LIMIT
          is 6 (a multiple of 3) so a full result set fills evenly; cardGridClass
          keeps it from over-columning if fewer than 6 graded calls exist. */}
      <div className={cardGridClass(calls.length, 3)}>
        {calls.map((call) => (
          <Card key={call.id} className="h-full">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={call.expert.name} src={call.expert.avatarUrl} className="h-8 w-8 text-xs" />
                  <div className="min-w-0">
                    {call.expert.slug ? (
                      <Link
                        href={`/analysts/${call.expert.slug}`}
                        className="block truncate text-sm font-semibold text-ink-900 hover:underline"
                      >
                        {call.expert.name}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-semibold text-ink-900">{call.expert.name}</p>
                    )}
                    <p className="truncate text-xs text-ink-400">
                      <FirmLink
                        organization={canonicalizeOrgDisplay(call.expert.organization)}
                        className="hover:underline"
                      />
                    </p>
                  </div>
                </div>
                <VerdictBadge status={call.resolutionStatus} />
              </div>
              <p className="line-clamp-2 text-sm leading-6 text-ink-600">&ldquo;{call.quote}&rdquo;</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                {call.instrument && <Badge>{call.instrument}</Badge>}
                <DirectionChip direction={call.direction} />
                {call.resolvedAt && <span>Graded {formatDateOnly(call.resolvedAt)}</span>}
              </div>
              <a
                href={call.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-signal-sky hover:underline"
              >
                Source
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * Market Pulse (T2) — pure reuse: TopMoversCard already renders live
 * gainers/losers with its own Popular/All toggle and COLLAPSED_COUNT=5 cap,
 * exactly as /pulse's own page.tsx wires it. Zero new data-fetching or
 * layout logic beyond the section chrome.
 */
function MarketPulseSection({
  popular,
  all,
}: {
  popular: Awaited<ReturnType<typeof fetchTopMovers>>;
  all: Awaited<ReturnType<typeof fetchTopMovers>>;
}) {
  if (popular.gainers.length === 0 && popular.losers.length === 0 && all.gainers.length === 0 && all.losers.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-emerald">Market Pulse</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink-900">Live markets, not just predictions.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-500">
            Real-time NSE/BSE gainers and losers, material stock news, and exchange filings — refreshed every
            few minutes during market hours.
          </p>
        </div>
        <Link
          href="/pulse"
          className="hidden shrink-0 items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900 sm:flex"
        >
          Open Market Pulse
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <TopMoversCard popular={popular} all={all} />

      <Link
        href="/pulse"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900 sm:hidden"
      >
        Open Market Pulse
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/**
 * Instrument Research (T3) — a fixed set of real large-cap snapshots (see
 * HOMEPAGE_INSTRUMENT_SYMBOLS's own doc for why indices were dropped from
 * this set). Each card shows a live quote + InstrumentSparkline built from
 * real EOD closes, linking straight into that symbol's full research page.
 */
function InstrumentResearchSection({ instruments }: { instruments: InstrumentDetail[] }) {
  if (instruments.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-emerald">
            Instrument research
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-ink-900">Every stock, with the calls on it.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-500">
            Live price, fundamentals, and every analyst opinion on record — for any NSE-listed stock or
            index.
          </p>
        </div>
        <Link
          href={`/instruments/${instruments[0].symbol}`}
          className="hidden shrink-0 items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900 sm:flex"
        >
          Explore instruments
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* HOMEPAGE_INSTRUMENT_SYMBOLS is a fixed 4-symbol set, but
          fetchHomepageInstruments filters out any that fail to resolve —
          cardGridClass avoids the same over-columning risk as the two
          grids above if that ever drops below 4. */}
      <div className={cardGridClass(instruments.length, 4)}>
        {instruments.map((instrument) => {
          const quote = instrument.quote;
          return (
            <Link key={instrument.symbol} href={`/instruments/${instrument.symbol}`} className="block h-full">
              <Card className="h-full transition hover:border-signal-emerald/40">
                <CardContent className="space-y-3 p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">
                      {instrument.symbol}
                    </p>
                    <p className="truncate text-sm font-semibold text-ink-900">{instrument.companyName}</p>
                  </div>
                  {quote ? (
                    <InstrumentResearchTileLive
                      symbol={instrument.symbol}
                      initialClose={quote.close}
                      initialPrevClose={quote.prevClose}
                      initialChangePercent={quote.changePercent}
                      initialAsOfMs={quote.sessionDate.getTime()}
                      spark={instrument.spark}
                    />
                  ) : (
                    <p className="text-sm text-ink-400">Price data pending</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Link
        href={`/instruments/${instruments[0].symbol}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900 sm:hidden"
      >
        Explore instruments
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

/**
 * Paper Trading (T4) — the real India-cost honesty angle. Renders a
 * server-side cost breakdown for one representative sample trade
 * (SAMPLE_TRADE_SYMBOL/SAMPLE_TRADE_QUANTITY, both above) using
 * computeOrderCosts() — the SAME pure function the live paper-trading order
 * engine calls (packages/business-rules/src/papertrading/costs.ts) — against
 * that instrument's real live close price, already fetched for the
 * Instrument Research section above (no extra query). If the engine's rates
 * ever change, this section changes with it; nothing here is hand-copied.
 */
function PaperTradingSection({ instruments }: { instruments: InstrumentDetail[] }) {
  const sample = instruments.find((i) => i.symbol === SAMPLE_TRADE_SYMBOL);
  const price = sample?.quote?.close ?? null;
  const breakdown = price != null
    ? computeOrderCosts({ side: "BUY", productType: "DELIVERY", quantity: SAMPLE_TRADE_QUANTITY, price })
    : null;

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Paper Trading</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink-900">Trade the call — with real Indian costs.</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink-500">
          Cash equities, index and stock options, and index futures — paper trading that models actual
          Indian brokerage, STT, and exchange charges per fill, not a simplified sandbox.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <Card>
          <CardContent className="space-y-2 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-white">
              <Wallet className="h-4 w-4" />
            </div>
            <p className="text-sm leading-6 text-ink-600">
              Most paper-trading tools ignore local cost structure entirely. Ours doesn&rsquo;t — every fill
              is charged brokerage, STT, exchange transaction charges, SEBI turnover fee, stamp duty, GST,
              and DP charges, using the same rate table the live order engine runs.
            </p>
            <Link
              href="/paper-trading"
              className="inline-flex items-center gap-2 pt-2 text-sm font-semibold text-ink-900 hover:underline"
            >
              Open Paper Trading
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        {breakdown && sample ? (
          <div>
            <p className="mb-2 text-xs text-ink-400">
              Sample: buying {SAMPLE_TRADE_QUANTITY} shares of {sample.symbol} (delivery) at {formatRupees(price!)}
              , today&rsquo;s live close.
            </p>
            <CostBreakdownTable breakdown={breakdown} side="BUY" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Charting Workbench + Strategy Scripting (T5). The static screenshot
 * capture (`public/homepage/workbench-screenshot.png`) is deliberate, per
 * founder correction 2026-08-09: an earlier pass swapped it for a live
 * chart based on a misreading of "make the charts feel dynamic, not a
 * static image" — that feedback was about the Indian Economy / Instrument
 * Research sparklines' PRESENTATION, not this section, and the founder
 * confirmed this screenshot itself was correct as originally shipped
 * ("it was perfect, I just wanted to remove the trading-view name from
 * there"). Do not swap this back to a live embed without an explicit
 * founder ask — this is now a settled decision, not an open question.
 *
 * The only real change from the original: the headline no longer names a
 * competitor ("A TradingView-grade workbench" → "A professional-grade
 * workbench") — user-facing copy never names a competitor by brand,
 * anywhere in this product, a standing law as of the same day.
 */
function WorkbenchSection() {
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Charting Workbench</p>
        <h2 className="mt-1 text-2xl font-semibold text-ink-900">
          A professional-grade workbench — with your own strategies.
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink-500">
          88 drawing tools, 41 indicators, and a Technicals Rating dial. Write your own strategy in
          JavaScript and backtest it gross AND net of real trading costs.
        </p>
      </div>

      <Card className="overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- static local asset, not an optimizable next/image domain (matches components/ui/avatar.tsx's own convention). */}
        <img
          src="/homepage/workbench-screenshot.png"
          alt="The Predict Future charting workbench showing a live NSE candlestick chart with indicators and drawing tools"
          // The source capture is a wide 1600x960 landscape (the workbench's own
          // native layout) — at full mobile width that shrinks small enough that
          // the on-chart price/indicator text stops being legible. A fixed,
          // breakpoint-scaled height + object-cover (anchored top-left, where the
          // candles/moving-average lines/trendline live) crops in on the most
          // visually compelling part instead of shrinking the whole frame.
          className="h-56 w-full border-b border-ink-100 object-cover object-left-top sm:h-72 lg:h-[420px]"
        />
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-white">
              <BarChart3 className="h-4 w-4" />
            </div>
            <p className="text-sm text-ink-500">
              The actual workbench — RELIANCE, live candles with indicators and drawing tools active.
            </p>
          </div>
          <Link
            href="/paper-trading"
            className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-ink-900 hover:underline"
          >
            Open the Workbench
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

function TopAnalysts({ analysts }: { analysts: Awaited<ReturnType<typeof fetchIndexableAnalysts>> }) {
  if (analysts.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-sky">Leaderboard</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink-900">Top analysts by hit rate</h2>
        </div>
        <Link href="/analysts" className="text-sm font-medium text-ink-500 hover:text-ink-900">
          Full scorecard
        </Link>
      </div>

      {/* Same sm:2→lg:3 + cardGridClass reasoning as LatestGradedCalls above
          (TOP_ANALYSTS_LIMIT is also 6, for the same even-fill reason). This
          is the section that actually motivated cardGridClass: with today's
          real data there's only 1 qualifying analyst, and a lone card in a
          fixed 3-col grid was leaving a large empty region beside it. */}
      <div className={cardGridClass(analysts.length, 3)}>
        {analysts.map((analyst) => (
          // Stretched-link pattern (see app/analysts/page.tsx for the full
          // rationale) — the firm name stays independently clickable rather
          // than being nested inside the whole-card profile link.
          <Card key={analyst.id} className="relative h-full transition hover:border-signal-sky/40">
            <Link
              href={`/analysts/${analyst.slug}`}
              className="absolute inset-0 z-0"
              aria-label={analyst.name}
            />
            <CardContent className="pointer-events-none relative z-10 flex items-center gap-4 p-5">
              <Avatar name={analyst.name} src={analyst.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-semibold text-ink-900">{analyst.name}</p>
                  {analyst.verified && <Badge variant="accent">Verified</Badge>}
                </div>
                <p className="truncate text-sm text-ink-500">
                  <FirmLink
                    organization={analyst.organization}
                    className="pointer-events-auto relative z-20 hover:underline"
                  />
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-semibold text-ink-900">{formatPercent(analyst.stats.hitRate ?? 0)}</p>
                <p className="text-xs text-ink-400">{analyst.stats.resolvedCount} graded calls</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: FileSearch,
      title: "We track the calls",
      body: "Every public prediction an Indian market analyst makes on TV, in print, or online — captured with a link back to the original source.",
    },
    {
      icon: Gauge,
      title: "We grade them",
      body: "Once a call's timeframe passes, we check it against real market data and mark it HIT or MISS. No editorializing, no judgment calls.",
    },
    {
      icon: ScrollText,
      title: "You see the record",
      body: "Every analyst's track record is public — hits and misses both — so you can judge who's actually worth listening to.",
    },
  ];

  return (
    <section>
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal-sky">How it works</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
          Accountability for market punditry.
        </h2>
      </div>
      <ol className="grid gap-5 lg:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="rounded-3xl border border-white/70 bg-white/80 p-6 backdrop-blur">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
              {i + 1}
            </div>
            <h3 className="mt-5 flex items-center gap-2 text-lg font-semibold text-ink-900">
              <step.icon className="h-4 w-4 text-signal-sky" />
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-7 text-ink-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
