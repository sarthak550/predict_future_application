/**
 * BSE Expansion Phase 3A (2026-08-12) — BSE-EXCLUSIVE equities. Presentation-
 * layer helpers over `BseEodQuote` (apps/api/lib/marketMoves/bseBhavcopy.ts's
 * ingestion — see that module's doc for the source, the dual-listing dedup
 * law, and the empirical basis for the volume floor below).
 *
 * NAMESPACE: a BSE-only stock's `/instruments/[symbol]` URL is
 * `${BseEodQuote.tickerSymbol}.BO` — reuses the existing `.BO` suffix
 * convention `instrumentMatch.ts`/`shadow.ts` already parse for dual-listed
 * opinion tickers, rather than a new sub-route. Verified collision-free
 * against every NSE symbol/BSE-index-symbol/bond-symbol namespace (none of
 * those ever contain a literal ".") — see the shipping ticket's report.
 *
 * VOLUME FLOOR: NOT NSE's MIN_LIQUIDITY_QTY=10,000 (bhavcopy.ts) — BSE-
 * exclusive names trade far thinner. Set empirically from the live volume
 * distribution of the 2,034-name BSE-only universe (2026-08-12 verification
 * run): p10≈15, p25≈180, p50≈2,300, p75≈15,800, p90≈78,000.
 * `MIN_BSE_EQUITY_LIQUIDITY_QTY = 500` clears 1,608/2,034 (79.1%) — filters
 * the thinnest, essentially-untraded tail while keeping the large majority
 * indexable. A below-floor row is NEVER dropped from the DB (ingestion
 * stores every post-dedup row unconditionally) — this floor gates ONLY
 * presentation: page `noindex`, inclusion in browse/search, and the sitemap.
 */

/** Minimum today's traded quantity for a BseEodQuote row to be indexable/browsable/searchable. */
export const MIN_BSE_EQUITY_LIQUIDITY_QTY = 500;

/** True when a BSE-only equity's latest volume clears the indexability floor. Null/undefined volume (shouldn't happen — BseEodQuote.volume is non-nullable — but a defensive false rather than a throw) never clears it. */
export function clearsBseEquityFloor(volume: number | null | undefined): boolean {
  return volume != null && volume > MIN_BSE_EQUITY_LIQUIDITY_QTY;
}

/** Builds a BSE-only equity's `/instruments/[symbol]` page symbol from its BseEodQuote.tickerSymbol. */
export function bseEquityPageSymbol(tickerSymbol: string): string {
  return `${tickerSymbol.trim().toUpperCase()}.BO`;
}

/** True when a raw /instruments/[symbol] route param has the BSE-only-equity shape (the literal ".BO" suffix) — the single, collision-free signal this app uses to route a symbol into the BSE-equity branch instead of a plain NSE lookup. Never true for an NSE symbol, a BSE INDEX symbol (deriveIndexSymbol strips all non-alnum, never producing a "."), or a bond/ETF symbol — all verified dot-free by construction. */
export function isBseEquitySymbolShape(symbol: string): boolean {
  return /\.BO$/i.test(symbol.trim());
}

/** Strips the trailing ".BO" to recover the bare BseEodQuote.tickerSymbol lookup key. Returns null if `symbol` doesn't have the shape (defensive — callers should already have checked `isBseEquitySymbolShape`). */
export function bareBseEquityTicker(symbol: string): string | null {
  const trimmed = symbol.trim();
  if (!isBseEquitySymbolShape(trimmed)) return null;
  return trimmed.slice(0, -3).toUpperCase();
}
