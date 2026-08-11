/**
 * Homepage "Indian Economy" section (2026-08-09 founder request, verbatim:
 * "I want few indices, usd/inr, indian 10y yield live data on homepage that
 * is interactive and informative with charts and news... They are necessary
 * to give summary of Indian economy on home page only"). Scoped to India,
 * mirroring TradingView's own Market Summary Dashboard pattern: live
 * value + real sparkline + click-through where a detail page exists.
 *
 * Three sub-parts, each independently degrading (a partial data outage
 * never blanks the whole section):
 *  1. Market Summary tiles — NIFTY 50, SENSEX, BANK NIFTY, USD/INR, via
 *     `lib/finance/marketSummary.ts` (apps/api's new `/api/finance/market-summary`,
 *     reusing `fetchYahooCandles` directly — the same fetcher the Charting
 *     Workbench runs). Sparkline reuses `InstrumentSparkline` verbatim — no
 *     new charting code, same "real data, no heavy library" discipline as
 *     the rest of this homepage.
 *  2. India Macro card — RBI Policy (Repo/CRR/SLR) + IMF Projection (GDP
 *     Growth/Inflation), a direct web port of mobile's `IndiaMacroCard`
 *     (apps/mobile/src/components/finance-mode.tsx), fed by the SAME
 *     `/api/finance/macro` warm-store route via `lib/finance/macro.ts`.
 *  3. A small macro-relevant news strip, reusing `getPublishedNewsItems`
 *     scoped to `category: "FINANCE"` — the only India-market news tag
 *     that exists in `MarketCategory` (no separate "macro" sub-tag), the
 *     honest fallback per the brief. Capped at `MACRO_NEWS_LIMIT` (4,
 *     unchanged — see page.tsx) with a "View all" link to the dedicated
 *     `/economy/news` page for full cursor-paginated history (founder ask
 *     2026-08-12: "no way of seeing more than that"). Kept as a link-out
 *     rather than inline expansion so the homepage's own ISR render stays
 *     exactly as costly as before — no new member in page.tsx's Promise.all.
 *  4. An "Upcoming policy events" card — the RBI MPC meeting calendar
 *     (`lib/finance/rbiMpcCalendar.ts`). Founder ask 2026-08-12: mobile used
 *     to show "next RBI policy change" dates; that module's doc comment has
 *     the full investigation of why this is a fresh hand-maintained
 *     constant (RBI's own Section-45ZI-mandated published schedule) rather
 *     than a port of mobile's admin-poll-driven "Policy calendar" pill. Pure
 *     computation, no I/O — also adds zero cost to the homepage's data
 *     fetching.
 *
 * **Known, disclosed gap — India 10Y G-Sec yield**: investigated and
 * dropped, not fabricated. Yahoo has no resolving ticker for it (every
 * plausible symbol — IN10YB=RR, IN10Y=RR, IN10YT=RR, 10YIGB=RR — 404s,
 * unlike the confirmed-live `^NSEI`/`^BSESN`/`^NSEBANK`/`INR=X`). RBI's own
 * homepage front page has no scrapeable "10-Year" figure (checked via the
 * same `rbiRates.ts` scrape target — no match), and FBIL's site returns a
 * near-empty JS shell (no server-rendered figure to scrape). Computing a
 * real YTM from `BondEodQuote` bond prices would need real coupon/maturity
 * bond-math this pass didn't build. `rbi.repoRate` (from the India Macro
 * card) is the one genuine India-rates anchor available and is shown
 * there — it is NOT presented as a 10Y yield substitute anywhere in this
 * UI. Revisit if a clean live source is found later.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, TrendingUp } from "lucide-react";

import { EconomyTileLive } from "@/components/finance/economy-tile-live";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketSummaryResult } from "@/lib/finance/marketSummary";
import type { MacroSnapshotResult } from "@/lib/finance/macro";
import { countdownLabel, getUpcomingMpcMeetings, MPC_CALENDAR_SOURCE, type MpcMeeting } from "@/lib/finance/rbiMpcCalendar";
import type { PlainNewsItem } from "@/lib/news/queries";
import { formatIstSessionDate, formatRelativeTime } from "@/lib/utils";

/**
 * Tiles with a live per-symbol quote route today — see
 * `/api/instruments/index/[symbol]/quote`'s own "5 registry index
 * underlyings" gate. SENSEX (BSE, no NSE index feed) and USD/INR (no FX
 * quote route in this product) have none; those two tiles still render an
 * honest live/closed badge (EconomyTileLive/LiveStatusBadge) but never
 * claim "Live" — see those components' own doc comments.
 */
const TILE_QUOTE_SYMBOL: Record<string, string> = { NIFTY50: "NIFTY", BANKNIFTY: "BANKNIFTY" };

function MarketSummaryTileCard({ tile, asOfMs }: { tile: MarketSummaryResult["tiles"][number]; asOfMs: number }) {
  const hasData = tile.last != null;
  const isUsdInr = tile.key === "USDINR";
  const quoteSymbol = TILE_QUOTE_SYMBOL[tile.key] ?? null;
  const quoteUrl = quoteSymbol ? `/api/instruments/index/${encodeURIComponent(quoteSymbol)}/quote` : null;

  const body = (
    // hover accent + padding match InstrumentResearchSection's card exactly
    // (founder feedback 2026-08-09: the two sections had drifted) — emerald,
    // not the sky this used before, per this app's own "Markets=emerald"
    // pillar-color convention (tailwind.config.ts's `signal.emerald` doc
    // comment); only applied when the tile is actually a link (SENSEX/
    // USD-INR have no detail page, so a hover affordance there would be a
    // false promise, not a style unification).
    <Card className={`h-full ${tile.indexSlug ? "transition hover:border-signal-emerald/40" : ""}`}>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">{tile.label}</p>
          {tile.indexSlug && <TrendingUp className="h-3 w-3 text-ink-300" aria-hidden />}
        </div>
        {hasData ? (
          <EconomyTileLive
            quoteUrl={quoteUrl}
            isUsdInr={isUsdInr}
            initialLast={tile.last!}
            initialChangeAbs={tile.changeAbs}
            initialChangePercent={tile.changePercent}
            initialAsOfMs={asOfMs}
            spark={tile.spark}
          />
        ) : (
          <p className="py-4 text-xs text-ink-400">Live data unavailable right now.</p>
        )}
      </CardContent>
    </Card>
  );

  if (tile.indexSlug) {
    return (
      <Link href={`/indices/${tile.indexSlug}`} className="block h-full">
        {body}
      </Link>
    );
  }
  return body;
}

/** RBI Policy + IMF Projection tiles — direct port of mobile's `IndiaMacroCard` gracefully-degrade rules: a tile group with zero non-null values is omitted; the whole card is omitted if BOTH groups are empty. */
function IndiaMacroCard({ macro }: { macro: MacroSnapshotResult }) {
  const rbiTiles: { label: string; value: number }[] = [];
  if (macro.rbi.repoRate != null) rbiTiles.push({ label: "Repo Rate", value: macro.rbi.repoRate });
  if (macro.rbi.crr != null) rbiTiles.push({ label: "CRR", value: macro.rbi.crr });
  if (macro.rbi.slr != null) rbiTiles.push({ label: "SLR", value: macro.rbi.slr });

  const imfTiles: { label: string; value: string }[] = [];
  if (macro.imf.gdpGrowth != null) imfTiles.push({ label: "GDP Growth", value: `${macro.imf.gdpGrowth.toFixed(1)}%` });
  if (macro.imf.cpiInflation != null) imfTiles.push({ label: "Inflation (CPI)", value: `${macro.imf.cpiInflation.toFixed(1)}%` });

  if (rbiTiles.length === 0 && imfTiles.length === 0) return null;

  const imfYear = macro.imf.gdpGrowthYear ?? macro.imf.cpiInflationYear ?? new Date().getFullYear();
  const asOfLabel = macro.asOf
    ? new Date(macro.asOf).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : null;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">India Macro</p>
          {asOfLabel && <p className="text-xs text-ink-400">Updated {asOfLabel}</p>}
        </div>

        {rbiTiles.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">RBI Policy</p>
            <div className="grid grid-cols-3 gap-3">
              {rbiTiles.map((t) => (
                <div key={t.label} className="rounded-2xl bg-[#f5f7fb] px-3 py-2 text-center">
                  <p className="text-xs text-ink-400">{t.label}</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-900">{t.value.toFixed(2)}%</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {imfTiles.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">IMF Projection, {imfYear}</p>
            <div className="grid grid-cols-2 gap-3">
              {imfTiles.map((t) => (
                <div key={t.label} className="rounded-2xl bg-[#f5f7fb] px-3 py-2 text-center">
                  <p className="text-xs text-ink-400">{t.label}</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-900">{t.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Upcoming policy events" card — RBI MPC meeting calendar. See
 * lib/finance/rbiMpcCalendar.ts's doc comment for the full sourcing/honesty
 * rationale. Never returns null: an empty upcoming-meetings list (the
 * fiscal year's calendar fully lapsed and next year's isn't announced yet)
 * is itself the intended "graceful when no future dates remain" state, per
 * the brief — shown as a message, not a hidden card.
 */
function PolicyCalendarCard({ meetings }: { meetings: MpcMeeting[] }) {
  const [next, ...rest] = meetings;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Upcoming policy events</p>
          <p className="mt-0.5 text-xs text-ink-400">RBI Monetary Policy Committee</p>
        </div>

        {!next ? (
          <p className="text-xs leading-5 text-ink-400">
            {MPC_CALENDAR_SOURCE.fiscalYear}&apos;s MPC calendar has concluded — next fiscal year&apos;s
            calendar not yet announced. RBI typically publishes it in March.
          </p>
        ) : (
          <>
            <div className="rounded-2xl bg-[#f5f7fb] px-4 py-3">
              <p className="text-xs text-ink-400">Next RBI policy decision</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-900">
                {formatIstSessionDate(next.decisionDate)}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Meeting {formatIstSessionDate(next.startDate)} – {formatIstSessionDate(next.decisionDate)} ·{" "}
                {countdownLabel(next.decisionDate)}
              </p>
            </div>

            {rest.length > 0 && (
              <ul className="space-y-1.5">
                {rest.map((m) => (
                  <li key={m.seq} className="flex items-center justify-between text-xs text-ink-500">
                    <span>Meeting {m.seq}</span>
                    <span className="tabular-nums text-ink-400">{formatIstSessionDate(m.decisionDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <p className="text-[11px] leading-5 text-ink-400">
          Official {MPC_CALENDAR_SOURCE.fiscalYear} calendar, announced{" "}
          {formatIstSessionDate(MPC_CALENDAR_SOURCE.announcedOn)} under {MPC_CALENDAR_SOURCE.legalBasis}.
        </p>
      </CardContent>
    </Card>
  );
}

function MacroNewsStrip({ news }: { news: PlainNewsItem[] }) {
  if (news.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Macro &amp; markets news</p>
          <Link
            href="/economy/news"
            className="inline-flex items-center gap-1 text-xs font-medium text-signal-sky hover:underline"
          >
            View all
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <ul className="space-y-3">
          {news.map((item) => (
            <li key={item.id} className="border-b border-ink-100 pb-3 last:border-0 last:pb-0">
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium leading-6 text-ink-900 hover:text-signal-sky hover:underline"
              >
                {item.title}
              </a>
              <p className="mt-1 text-xs text-ink-400">
                {item.sourceName} · {formatRelativeTime(item.publishedAt)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Section heading, extracted so the all-data-sources-down degraded return (below) doesn't duplicate it. */
function EconomySectionHeader() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-emerald">Indian Economy</p>
      <h2 className="mt-1 text-2xl font-semibold text-ink-900">The macro backdrop, at a glance.</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink-500">
        Headline indices, the rupee, and the policy rates and growth projections shaping every call on this
        page — real data, delayed a few minutes.
      </p>
    </div>
  );
}

export function EconomySection({
  marketSummary,
  macro,
  news,
}: {
  marketSummary: MarketSummaryResult | null;
  macro: MacroSnapshotResult | null;
  news: PlainNewsItem[];
}) {
  const hasTiles = marketSummary != null && marketSummary.tiles.length > 0;
  const hasMacro = macro != null && (macro.rbi.repoRate != null || macro.rbi.crr != null || macro.rbi.slr != null || macro.imf.gdpGrowth != null || macro.imf.cpiInflation != null);
  const hasNews = news.length > 0;
  // Pure/no-I/O — the RBI MPC calendar always has content (either upcoming
  // dates or an honest "not yet announced" message), so unlike hasTiles/
  // hasMacro/hasNews above it never gates this section's visibility.
  const upcomingMpcMeetings = getUpcomingMpcMeetings();

  if (!hasTiles && !hasMacro && !hasNews) {
    // Even with every live data source down, the policy calendar is still
    // real, always-available content — degrade to just the section header
    // + calendar card rather than hiding the whole section.
    return (
      <section className="space-y-5">
        <EconomySectionHeader />
        <PolicyCalendarCard meetings={upcomingMpcMeetings} />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <EconomySectionHeader />

      {hasTiles && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {marketSummary!.tiles.map((tile) => (
            <MarketSummaryTileCard key={tile.key} tile={tile} asOfMs={new Date(marketSummary!.asOf).getTime()} />
          ))}
        </div>
      )}

      {/* Was a hasMacro/hasNews-only two-card layout (0.9fr/1.1fr weighted)
          with a `{hasMacro ? <IndiaMacroCard/> : <div/>}` empty placeholder
          for the "only one side has data" case — that placeholder left a
          bare empty box beside MacroNewsStrip whenever the RBI/IMF fetch
          failed independently of the news query. Generalized to N present
          cards (PolicyCalendarCard added 2026-08-12 and never itself
          returns null, so this row is now 1-3 cards): equal-width columns
          via a literal-class lookup (Tailwind needs literal class names,
          not a computed `grid-cols-${n}`), one weighting simplification
          from the old 0.9/1.1 split — not worth a 3-way weighted grid-
          template for what's a minor visual nicety. Never a bare empty
          cell: absent cards are simply omitted from the array, not
          rendered as blanks. */}
      {(() => {
        const cards: { key: string; node: ReactNode }[] = [];
        if (hasMacro) cards.push({ key: "macro", node: <IndiaMacroCard macro={macro!} /> });
        cards.push({ key: "policy", node: <PolicyCalendarCard meetings={upcomingMpcMeetings} /> });
        if (hasNews) cards.push({ key: "news", node: <MacroNewsStrip news={news} /> });

        const gridClass =
          cards.length === 3
            ? "grid gap-4 lg:grid-cols-3 lg:items-start"
            : cards.length === 2
              ? "grid gap-4 lg:grid-cols-2 lg:items-start"
              : "";

        return (
          <div className={gridClass}>
            {cards.map((c) => (
              <div key={c.key}>{c.node}</div>
            ))}
          </div>
        );
      })()}
    </section>
  );
}
