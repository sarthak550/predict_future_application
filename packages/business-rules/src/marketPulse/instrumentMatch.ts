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

/** Strips a trailing exchange suffix (".NS", ".BO", "^...", etc.), uppercased. */
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
