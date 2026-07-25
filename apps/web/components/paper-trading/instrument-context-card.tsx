"use client";

/**
 * "N analyst opinions · M news items → view" strip for the trading terminals —
 * the Paper-Trading-to-Analyst-Scorecard bridge. Sits under the terminal
 * chart for whatever symbol is focused (equity terminal) or selected as the
 * chain underlying (options terminal), and deep-links to the full
 * /instruments/[symbol] page (the same page Market Pulse opens), where the
 * actual opinions, news and filings live.
 *
 * Counts come from /api/paper-trading/instruments/[symbol]/context, which
 * uses the SAME matching windows as the instrument page so the numbers never
 * disagree with what the user finds after clicking through.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type ContextState =
  | { status: "idle" | "loading" }
  | { status: "ready"; opinionsCount: number; newsCount: number };

export function InstrumentContextCard({ symbol }: { symbol: string | null }) {
  const [state, setState] = useState<ContextState>({ status: "idle" });
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!symbol || fetchedFor.current === symbol) return;
    fetchedFor.current = symbol;
    setState({ status: "loading" });
    fetch(`/api/paper-trading/instruments/${encodeURIComponent(symbol)}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.opinionsCount === "number" && typeof data.newsCount === "number") {
          setState({ status: "ready", opinionsCount: data.opinionsCount, newsCount: data.newsCount });
        } else {
          setState({ status: "idle" });
        }
      })
      .catch(() => setState({ status: "idle" }));
  }, [symbol]);

  if (!symbol || state.status !== "ready") return null;

  const { opinionsCount, newsCount } = state;
  const summary =
    opinionsCount === 0 && newsCount === 0
      ? "No analyst opinions or news tracked yet"
      : [
          opinionsCount > 0 ? `${opinionsCount} analyst opinion${opinionsCount === 1 ? "" : "s"} (90d)` : null,
          newsCount > 0 ? `${newsCount} news item${newsCount === 1 ? "" : "s"} (30d)` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <Link
      href={`/instruments/${encodeURIComponent(symbol)}`}
      className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs transition hover:border-signal-sky/40 hover:bg-signal-sky/5"
    >
      <span className="text-ink-600">
        <span className="font-semibold text-ink-900">{symbol}</span> · {summary}
      </span>
      {(opinionsCount > 0 || newsCount > 0) && (
        <span className="shrink-0 font-semibold text-signal-sky">View →</span>
      )}
    </Link>
  );
}
