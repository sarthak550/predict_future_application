import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";

import { formatIndexLevel, formatSignedPoints } from "@/components/finance/index-change-badge";
import { PriceChart } from "@/components/finance/price-chart";
import { Card, CardContent } from "@/components/ui/card";
import { fetchIndexBySlug } from "@/lib/finance/indices";
import { tradableUnderlyingForIndexSlug } from "@/lib/finance/indexTradableAlias";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const index = await fetchIndexBySlug(params.slug);
  if (!index) {
    return { title: "Index — Predict Future", robots: { index: false, follow: true } };
  }

  const title = `${index.name} — live index level & chart — Predict Future`;
  const description =
    index.last != null && index.changePercent != null
      ? `${index.name} is at ${formatIndexLevel(index.last)} (${index.changePercent >= 0 ? "+" : ""}${index.changePercent.toFixed(2)}%). Live level, day range and 52-week high/low, sourced from NSE.`
      : `${index.name} — live level, day range and 52-week high/low, sourced from NSE.`;
  const url = `https://predictfuture.app/indices/${index.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title, description, type: "website", url },
    twitter: { card: "summary", title, description }
  };
}

function formatIstAsOf(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(new Date(iso));
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-white/50">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

export default async function IndexDetailPage({ params }: { params: { slug: string } }) {
  const index = await fetchIndexBySlug(params.slug);
  if (!index) {
    notFound();
  }

  const tradableUnderlying = tradableUnderlyingForIndexSlug(index.slug);
  const indexIntradayUrl = tradableUnderlying
    ? `/api/instruments/index/${encodeURIComponent(tradableUnderlying)}/intraday`
    : null;
  // Index History Stage 2 (2026-08-11) — every index now has (or will have,
  // once the backfill/cron ingest its history — see IndexEodQuote) a full
  // `/instruments/[symbol]` page: real daily OHLC, opinions, sentiment. The
  // 5 tradable underlyings use their short mnemonic code (already resolved
  // above); every other index's code is `deriveIndexSymbol(name)` — the SAME
  // pure function business-rules' INDEX_UNIVERSE and the long-tail resolver
  // (apps/web/lib/finance/indexLongTail.ts) both use, so this link always
  // agrees with whatever code that page itself resolves under.
  const fullInstrumentSymbol = tradableUnderlying ?? deriveIndexSymbol(index.name);

  const isUp = (index.changePercent ?? 0) >= 0;

  return (
    <div className="space-y-8">
      <Link href="/indices" className="text-sm font-medium text-ink-500 hover:text-ink-900">
        ← All indices
      </Link>

      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">NSE index</p>
              <h1 className="mt-1 text-2xl font-semibold">{index.name}</h1>
              {tradableUnderlying ? (
                <p className="mt-1 text-xs font-medium text-emerald-400">Tradable in the F&amp;O options terminal</p>
              ) : null}
              <Link
                href={`/instruments/${fullInstrumentSymbol}`}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-signal-sky hover:underline"
              >
                Open full instrument page →
              </Link>
            </div>

            {index.last != null ? (
              <div className="text-right">
                <p className="text-3xl font-semibold tabular-nums">{formatIndexLevel(index.last)}</p>
                <p className={`mt-1 flex items-center justify-end gap-1 text-sm font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {index.changePercent != null && (
                    <>
                      {index.changePercent >= 0 ? "+" : ""}
                      {index.changePercent.toFixed(2)}%
                    </>
                  )}
                  {index.changeAbs != null && <> ({formatSignedPoints(index.changeAbs)})</>}
                </p>
              </div>
            ) : (
              <div className="rounded-[16px] bg-white/10 px-4 py-2 text-sm text-white/70">Level data pending</div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm sm:grid-cols-4">
            {index.open != null && <StatCell label="Open" value={formatIndexLevel(index.open)} />}
            {index.high != null && <StatCell label="Day High" value={formatIndexLevel(index.high)} />}
            {index.low != null && <StatCell label="Day Low" value={formatIndexLevel(index.low)} />}
            {index.previousClose != null && <StatCell label="Prev. Close" value={formatIndexLevel(index.previousClose)} />}
            {index.yearHigh != null && <StatCell label="52W High" value={formatIndexLevel(index.yearHigh)} />}
            {index.yearLow != null && <StatCell label="52W Low" value={formatIndexLevel(index.yearLow)} />}
            {index.peRatio != null && <StatCell label="P/E" value={index.peRatio.toFixed(2)} />}
            {index.dividendYield != null && <StatCell label="Div. Yield" value={`${index.dividendYield.toFixed(2)}%`} />}
            <StatCell label="As of" value={`${formatIstAsOf(index.asOf)} IST`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Price history</p>
          {tradableUnderlying && indexIntradayUrl ? (
            <PriceChart
              symbol={tradableUnderlying}
              series={[]}
              intradaySource={{ url: indexIntradayUrl }}
              defaultTimeframe="1D"
            />
          ) : (
            <p className="py-8 text-center text-sm text-ink-400">
              Chart coming soon — {index.name} isn&apos;t part of the live 1D feed yet.
            </p>
          )}
        </CardContent>
      </Card>

      {(index.advances != null || index.declines != null || index.unchanged != null) && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Member stocks today</p>
            <p className="mb-3 text-xs text-ink-400">
              How many of this index&apos;s member stocks rose or fell today — a broad move and a few-heavyweights move look very
              different here.
            </p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-semibold text-emerald-600">{index.advances ?? "—"}</p>
                <p className="text-xs text-ink-400">Rose</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-rose-600">{index.declines ?? "—"}</p>
                <p className="text-xs text-ink-400">Fell</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-ink-600">{index.unchanged ?? "—"}</p>
                <p className="text-xs text-ink-400">Flat</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tradableUnderlying ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="text-sm font-semibold text-ink-900">Trade {tradableUnderlying} options</p>
              <p className="text-xs text-ink-500">Paper trading — practice with a simulated account, real market prices.</p>
            </div>
            <Link
              href={`/paper-trading/options?underlying=${encodeURIComponent(tradableUnderlying)}`}
              className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700"
            >
              Open options terminal →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-center text-xs text-ink-400">Index levels are informational only, not investment advice.</p>
    </div>
  );
}
