/**
 * Market Pulse "analyst said" badge — maps an NSE mover ticker (e.g.
 * "HDFCBANK") to ExpertOpinion.instrumentTicker's Yahoo-Finance-style symbol
 * (e.g. "HDFCBANK.NS" / "HDFCBANK.BO") by stripping the trailing exchange
 * suffix, so the badge can be attached to Top Movers rows on both apps/api's
 * `/api/finance/market-moves/movers` route (mobile) and apps/web's
 * `fetchTopMovers` (web) without duplicating the mapping logic.
 *
 * Pure — no I/O, no Prisma import — mirrors newsQuality.ts/topHeadline.ts's
 * structural-type pattern. Callers fetch a single bounded set (e.g. the last
 * 14 days of non-suppressed ExpertOpinion rows with instrumentTicker set)
 * and match in memory here rather than querying per-ticker.
 */

/** Minimal structural shape an ExpertOpinion-derived row must satisfy. */
export type AnalystCallRow = {
  instrumentTicker: string | null;
  publishedAt: Date;
};

/**
 * Strips a trailing exchange suffix (".NS", ".BO"), uppercased.
 *
 * EQUITY-ONLY, despite this file's original doc comment claiming "^..."
 * handling too — it never did. A caret-prefixed Yahoo index ticker
 * (`^NSEI`, `^NSEBANK`, `^BSESN`, ...) passes through with the caret intact
 * and, even if stripped, Yahoo's internal index codes (NSEI, NSEBANK, BSESN)
 * don't textually match NSE's own index names (NIFTY, BANKNIFTY, SENSEX) —
 * unlike equities, where "RELIANCE.NS" cleanly strips to the real NSE
 * symbol "RELIANCE". A real index↔ticker alias map (the kind
 * `lib/finance/economy-section.tsx`/`indices.ts` already carry) would be
 * needed to extend this to indices correctly; nothing here attempts that.
 *
 * Real bug found 2026-08-09: `apps/web/lib/finance/instrument.ts` used to
 * run every opinion candidate through `nseSymbolMatchesInstrumentTicker` as
 * a redundant validation recheck — including for NIFTY 50, whose opinions
 * are correctly resolved elsewhere via an exact `INDEX_OPINION_TICKER`
 * match — and this equity-only matcher silently rejected all 319 of them.
 * Fixed at that call site (skip the recheck for index-resolved opinions,
 * since the exact-ticker match that found them is already correct) rather
 * than here, since this function's actual contract (equity-only) was never
 * broken — its doc comment was just wrong. Do not call this for index
 * tickers expecting it to work; it won't.
 */
function bareInstrumentSymbol(instrumentTicker: string): string {
  return instrumentTicker.replace(/\.[A-Za-z]+$/, "").toUpperCase();
}

/**
 * True if an NSE mover symbol (e.g. "HDFCBANK") matches a Yahoo-Finance-style
 * ExpertOpinion.instrumentTicker (e.g. "HDFCBANK.NS" or "HDFCBANK.BO") once
 * the exchange suffix is stripped.
 */
export function nseSymbolMatchesInstrumentTicker(nseSymbol: string, instrumentTicker: string): boolean {
  return bareInstrumentSymbol(instrumentTicker) === nseSymbol.toUpperCase();
}

/**
 * Reduces a bounded batch of recent ExpertOpinion-shaped rows (any order) to
 * a map of bare-symbol (uppercased, suffix-stripped) -> the single latest
 * matching row. Callers look up a mover by `map.get(mover.tickerSymbol.toUpperCase())`.
 * Rows with a null instrumentTicker are skipped.
 */
export function pickLatestAnalystCallPerTicker<T extends AnalystCallRow>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();

  for (const row of rows) {
    if (!row.instrumentTicker) continue;
    const bareSymbol = bareInstrumentSymbol(row.instrumentTicker);
    const existing = latest.get(bareSymbol);
    if (!existing || row.publishedAt.getTime() > existing.publishedAt.getTime()) {
      latest.set(bareSymbol, row);
    }
  }

  return latest;
}
