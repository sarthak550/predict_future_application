"use client";

/**
 * Instrument page header: renders the server-provided EOD snapshot instantly,
 * then fetches the live intraday series client-side and — ONLY when that data
 * is from a NEWER session than the EOD row (i.e. the market has traded since
 * our last bhavcopy ingest) — swaps in the live price, change vs yesterday's
 * close, live volume, and a pulsing "LIVE · HH:mm IST" stamp.
 *
 * WHY client-side: the page is ISR-cached for speed/SEO, so the header the
 * server renders can be a session behind during market hours (the chart below
 * already shows live 1D ticks — the two must not disagree). Session props stay
 * serializable so the page remains a server component.
 *
 * Delivery % has no intraday source (exchanges publish it after close), so in
 * live mode that cell is labeled with the session it belongs to.
 */

import { BarChart3, LineChart, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { formatNumericValue } from "@/lib/utils";

export type QuoteHeaderProps = {
  symbol: string;
  /** Override the live-overlay fetch path — index pages point this at /api/instruments/index/[symbol]/intraday (the default equity path would request a nonexistent NIFTY.NS). */
  intradayEndpoint?: string;
  companyName: string;
  /**
   * Index Universe Expansion (Sprint A, 2026-08-09) — true for a
   * view-only INDEX_UNIVERSE index (i.e. not one of the 5 F&O-tradable
   * underlyings). Renders a small, honest "Index · View only" indicator
   * instead of silently omitting any trade affordance — this page never has
   * one anyway (trading lives on a separate terminal surface), but the
   * badge tells a founder/user WHY, rather than leaving it looking like a
   * gap. Omitted or false: zero visual change, so the 5 existing tradable
   * index pages (and every equity page) render byte-for-byte unchanged.
   */
  viewOnlyIndex?: boolean;
  /** ETF Layer (2026-08-12) — true for a registry-confirmed ETF (lib/finance/etfRegistry.ts). Renders a small "ETF" badge in the same slot `viewOnlyIndex` uses — mutually exclusive with it in practice (an ETF is never an index), but not enforced here since the two props are independent booleans supplied by the same caller. */
  isEtf?: boolean;
  /**
   * BSE Expansion Phase 2 (2026-08-12) — which exchange this instrument's
   * quote is sourced from. Defaults to "NSE" (byte-identical rendering for
   * every existing caller). "BSE" swaps the top-left "SYMBOL · NSE" label to
   * "SYMBOL · BSE" and the view-only badge copy to "BSE Index · View only"
   * so a BSE index page never reads as an NSE one.
   */
  exchange?: "NSE" | "BSE";
  quote: {
    close: number;
    prevClose: number;
    changePercent: number;
    volume: number;
    deliveryPct: number | null;
    /** Raw ISO sessionDate (IST-midnight-as-UTC) — used to decide whether intraday data is newer. */
    sessionDateIso: string;
    /** Pre-formatted "21 Jul 2026" label for display. */
    sessionDateLabel: string;
  } | null;
};

type LiveQuote = {
  price: number;
  prevClose: number;
  volume: number | null;
  /** "14:32" IST of the last tick. */
  timeLabel: string;
};

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "2026-07-22" — the IST calendar date of an instant, for same-session comparison. */
function istDateKey(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(instant);
}

function formatIstTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date(epochMs));
}

export function QuoteHeader({
  symbol,
  companyName,
  quote,
  intradayEndpoint,
  viewOnlyIndex,
  isEtf,
  exchange = "NSE",
}: QuoteHeaderProps) {
  const [live, setLive] = useState<LiveQuote | null>(null);
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (fetchedFor.current === symbol) return;
    fetchedFor.current = symbol;

    fetch(intradayEndpoint ?? `/api/instruments/${encodeURIComponent(symbol)}/intraday`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`intraday fetch ${res.status}`);
        return (await res.json()) as {
          prevClose: number | null;
          points: [number, number][];
          volume?: number | null;
        };
      })
      .then((body) => {
        const points = Array.isArray(body.points)
          ? body.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0)
          : [];
        if (points.length === 0) return;
        const [lastT, lastPrice] = points[points.length - 1];

        // Overlay only when the ticks are from a NEWER session than the EOD
        // row — after the EOD ingest lands, the stored close IS the session
        // close and stays authoritative (no "LIVE" badge at night).
        if (quote && istDateKey(new Date(lastT)) <= istDateKey(new Date(quote.sessionDateIso))) return;

        // Baseline for the day's change: yesterday's close. The upstream
        // prevClose and our stored EOD close should agree — trust upstream,
        // fall back to our own.
        const prevClose =
          typeof body.prevClose === "number" && body.prevClose > 0
            ? body.prevClose
            : quote
              ? quote.close
              : null;
        if (prevClose == null) return;

        setLive({
          price: lastPrice,
          prevClose,
          volume: typeof body.volume === "number" && body.volume > 0 ? body.volume : null,
          timeLabel: formatIstTime(lastT),
        });
      })
      .catch(() => {
        // Live overlay is best-effort — the EOD snapshot stays up.
      });
  }, [symbol, quote]);

  const price = live ? live.price : quote?.close ?? null;
  const prevClose = live ? live.prevClose : quote?.prevClose ?? null;
  const changeAbs = price != null && prevClose != null ? price - prevClose : null;
  const changePercent =
    live && prevClose ? ((live.price - prevClose) / prevClose) * 100 : quote?.changePercent ?? null;
  const isUp = (changePercent ?? 0) >= 0;
  const TrendIcon = isUp ? TrendingUp : TrendingDown;

  return (
    <Card className="overflow-hidden border-0 bg-ink-900 text-white">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {/* Two literal-suffix branches (not `{symbol} · {exchange}`) deliberately —
                two ADJACENT dynamic expression children force React to emit an extra
                hydration boundary comment between them, which would make every existing
                NSE page's SSR HTML byte-diverge from before this prop existed. Each
                branch below keeps the second child a plain string literal, exactly like
                the original single-exchange markup, so the NSE branch's output is
                byte-identical to pre-BSE-Expansion HTML. */}
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
              {exchange === "BSE" ? <>{symbol} · BSE</> : <>{symbol} · NSE</>}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{companyName}</h1>
            {viewOnlyIndex && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70">
                <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                {exchange === "BSE" ? "BSE Index · View only — not on the trading terminal" : "Index · View only — not on the trading terminal"}
              </p>
            )}
            {isEtf && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70">
                <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
                ETF · Exchange-Traded Fund
              </p>
            )}
          </div>

          {price != null ? (
            <div className="text-right">
              <p className="text-3xl font-semibold">{formatRupees(price)}</p>
              <p className={`mt-1 flex items-center justify-end gap-1 text-sm font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                <TrendIcon className="h-4 w-4" />
                {changePercent != null && (
                  <>
                    {changePercent >= 0 ? "+" : ""}
                    {changePercent.toFixed(2)}%
                  </>
                )}
                {changeAbs != null && <> ({formatSignedRupees(changeAbs)})</>}
              </p>
            </div>
          ) : (
            <div className="rounded-[16px] bg-white/10 px-4 py-2 text-sm text-white/70">Price data pending</div>
          )}
        </div>

        {(quote || live) && (
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm sm:grid-cols-4">
            {prevClose != null && (
              <div>
                <p className="text-xs text-white/50">Prev. close</p>
                <p className="mt-0.5 font-medium">{formatRupees(prevClose)}</p>
              </div>
            )}
            {(live?.volume ?? quote?.volume) != null && (
              <div>
                <p className="text-xs text-white/50">Volume</p>
                <p className="mt-0.5 font-medium">
                  {formatNumericValue((live?.volume ?? quote?.volume) as number, { precision: 0 })}
                </p>
              </div>
            )}
            {quote?.deliveryPct != null && (
              <div>
                <p className="text-xs text-white/50">
                  Delivery %{live ? ` · ${quote.sessionDateLabel}` : ""}
                </p>
                <p className="mt-0.5 font-medium">{quote.deliveryPct.toFixed(1)}%</p>
              </div>
            )}
            <div>
              <p className="text-xs text-white/50">As of</p>
              {live ? (
                <p className="mt-0.5 flex items-center gap-1.5 font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${isUp ? "bg-emerald-400" : "bg-rose-400"}`} />
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${isUp ? "bg-emerald-400" : "bg-rose-400"}`} />
                  </span>
                  Live · {live.timeLabel} IST
                </p>
              ) : (
                <p className="mt-0.5 font-medium">{quote?.sessionDateLabel}</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
