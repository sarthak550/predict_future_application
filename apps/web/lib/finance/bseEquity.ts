import { prisma } from "@/lib/prisma";

/**
 * BSE Expansion Phase 3A (2026-08-12) — BSE-EXCLUSIVE equities. Presentation-
 * layer helpers over `BseEodQuote` (apps/api/lib/marketMoves/bseBhavcopy.ts's
 * ingestion — see that module's doc for the source and the dual-listing
 * dedup law).
 *
 * NAMESPACE: a BSE-only stock's `/instruments/[symbol]` URL is
 * `${BseEodQuote.tickerSymbol}.BO` — reuses the existing `.BO` suffix
 * convention `instrumentMatch.ts`/`shadow.ts` already parse for dual-listed
 * opinion tickers, rather than a new sub-route. Verified collision-free
 * against every NSE symbol/BSE-index-symbol/bond-symbol namespace (none of
 * those ever contain a literal ".") — see the shipping ticket's report.
 *
 * FLOOR REWORK (2026-08-14) — founder report: "The Yamuna Syndicate Ltd"
 * (BSE: YSL) was unsearchable despite real, valuable daily trading. Root
 * cause was TWO compounding design flaws in the original share-count floor,
 * both fixed here:
 *
 * 1. WRONG BASIS. The original `MIN_BSE_EQUITY_LIQUIDITY_QTY=500` counted
 *    raw SHARE COUNT, which structurally buries high-price/low-count names.
 *    Live prod evidence (2026-08-14): YSL trades ~28-81 shares/day at
 *    ~₹29,800-31,400/share — genuine daily turnover of ₹8.3L-₹25.4L — but
 *    500 raw shares would take a ₹10 penny stock trading ₹5,000/day to
 *    clear. The floor now gates on TURNOVER (₹ value = close × volume),
 *    which BseEodQuote doesn't store as a column (schema has only
 *    `close`/`volume`, no ingested turnover field — verified against
 *    apps/api's schema), so it's computed here from the two.
 *
 *    Threshold empirically set from prod (2026-08-14, 30-session window,
 *    2,434 BSE-only symbols, MAX turnover per symbol — see rationale #2
 *    below): p10≈₹50.4K, p25≈₹175K, p50≈₹833K, p75≈₹4.5M, p90≈₹16.8M.
 *    `MIN_BSE_EQUITY_TURNOVER_RS = 100,000` (₹1L) clears 2,030/2,434 (83.4%)
 *    and cleanly separates real-but-thin companies from dead shells — e.g.
 *    borderline ADMITS at ~₹100-135K (Winsome Yarns, Muller & Phipps (India),
 *    Sangal Papers, Prima Agro — all real, still-listed operating
 *    companies trading most sessions) vs. borderline REJECTS just under it
 *    (Modern Shares & Stockbrokers, Patspin India, Soni Medicare, Indergiri
 *    Finance — same profile, just under the line; a threshold has to draw
 *    somewhere). True dead shells sit 3-4 orders of magnitude below the
 *    line regardless (Mudra Financial Services: ₹5 best day in 30 sessions;
 *    Jain Marmo Industries: ₹22; Santosh Fine-Fab: ₹36) — never a close call.
 *    YSL's worst day in the window (₹26,100) is itself below ₹1L, which is
 *    exactly why rationale #2 evaluates the floor over a WINDOW, not a
 *    single day.
 *
 * 2. SINGLE-SESSION MATCHING. Search/sitemap only ever looked at the single
 *    globally-latest BseEodQuote session — a thin name that simply didn't
 *    trade on that exact calendar day vanished from every surface
 *    regardless of the floor. Verified live in prod: 140 symbols present on
 *    2026-08-09 were absent from the very next available session. Every
 *    floor-gated call site now works over the trailing
 *    `BSE_EQUITY_FLOOR_WINDOW_SESSIONS` sessions and evaluates the floor
 *    against the MAX turnover seen anywhere in that window (not median/
 *    latest-only) — deliberate: a genuinely thin name can print a real,
 *    large trade only occasionally with zero volume most days, and a
 *    max-based floor is the only shape that admits it without also being
 *    fooled by one-off wash-trade spikes on an otherwise-dead shell (a
 *    single spike day doesn't manufacture 29 more days of `sessions_traded`
 *    — see `summarizeBseEquityWindow`'s trading-frequency signal for a
 *    dead-shell backstop if one is ever needed).
 *
 * A below-floor row is NEVER dropped from the DB (ingestion stores every
 * post-dedup row unconditionally) — this floor gates ONLY presentation:
 * page `noindex`, inclusion in browse/search, and the sitemap. ONE function
 * (`clearsBseEquityFloor`) makes the admit/reject call; every call site
 * (search route, sitemap, instrument page robots) computes its own
 * MAX-turnover-in-window number (shape differs per site — global sweep vs.
 * single-symbol vs. bounded fuzzy-match candidates) and passes it through
 * that one function, so the threshold and its semantics live in exactly one
 * place. Grep `clearsBseEquityFloor` for every call site.
 */

/** Minimum turnover (₹, close × volume) seen on the BEST day within the trailing window for a BseEodQuote symbol to be indexable/browsable/searchable. See module doc for the empirical basis. */
export const MIN_BSE_EQUITY_TURNOVER_RS = 100_000;

/** Trailing session-count window every floor-gated call site evaluates turnover over — NOT a single day (see module doc, flaw #2). ~6 trading weeks; large enough that a name trading a couple of times a month still gets a fair look, small enough to stay a bounded, take()-able query everywhere it's used. */
export const BSE_EQUITY_FLOOR_WINDOW_SESSIONS = 30;

/** Turnover (₹) for a single BseEodQuote-shaped row. */
export function bseEquityTurnover(row: { close: number; volume: number }): number {
  return row.close * row.volume;
}

/** True when a BSE-only equity's MAX turnover across its trailing trading window clears the indexability floor. Null/undefined (no rows in the window — e.g. a symbol that hasn't traded at all recently) never clears it. */
export function clearsBseEquityFloor(maxTurnoverInWindow: number | null | undefined): boolean {
  return maxTurnoverInWindow != null && maxTurnoverInWindow > MIN_BSE_EQUITY_TURNOVER_RS;
}

/** Per-symbol floor-evaluation summary: `summarizeBseEquityWindow`'s output shape. */
export interface BseEquityWindowSummary {
  tickerSymbol: string;
  /** Most recent `companyName` seen for this symbol within the window (companyName is effectively static, but a rename mid-window should win). */
  companyName: string;
  /** MAX(close × volume) across every row for this symbol within the window — the number `clearsBseEquityFloor` is evaluated against. */
  maxTurnoverInWindow: number;
  /** Most recent sessionDate seen for this symbol within the window. */
  latestSessionDate: Date;
  /** How many of the window's sessions this symbol actually traded on — a dead one-off spike (sessionsTraded=1, e.g. a wash trade) reads very differently from a name that trades most sessions. Not currently used to gate anything (MAX alone already separates shells by 3-4 orders of magnitude — see module doc) but kept on the summary for any caller that wants the signal. */
  sessionsTraded: number;
}

/**
 * Collapses raw BseEodQuote rows (caller has already scoped them to the
 * relevant recent-session window — this function does no date filtering
 * itself) into one `BseEquityWindowSummary` per distinct tickerSymbol. The
 * shared aggregation step behind every floor-gated call site: search's
 * bounded fuzzy-match candidate set, the sitemap's global sweep, and (in
 * spirit — the instrument page inlines the equivalent single-symbol
 * reduction over its own already-fetched spark rows rather than paying a
 * second query) the per-symbol page-robots check.
 */
export function summarizeBseEquityWindow(
  rows: Array<{ tickerSymbol: string; companyName: string; sessionDate: Date; close: number; volume: number }>
): BseEquityWindowSummary[] {
  const bySymbol = new Map<string, BseEquityWindowSummary>();
  for (const row of rows) {
    const key = row.tickerSymbol.toUpperCase();
    const turnover = bseEquityTurnover(row);
    const existing = bySymbol.get(key);
    if (!existing) {
      bySymbol.set(key, {
        tickerSymbol: row.tickerSymbol,
        companyName: row.companyName,
        maxTurnoverInWindow: turnover,
        latestSessionDate: row.sessionDate,
        sessionsTraded: 1,
      });
      continue;
    }
    existing.maxTurnoverInWindow = Math.max(existing.maxTurnoverInWindow, turnover);
    existing.sessionsTraded += 1;
    if (row.sessionDate > existing.latestSessionDate) {
      existing.companyName = row.companyName;
      existing.latestSessionDate = row.sessionDate;
    }
  }
  return [...bySymbol.values()];
}

/** Distinct BseEodQuote trading-session dates, most recent first, bounded to `BSE_EQUITY_FLOOR_WINDOW_SESSIONS` — the shared "what is THE window" query so search/sitemap/instrument-page all mean the same 30 sessions. Returns `[]` before the BSE cron has ever run (never throws). */
export async function getRecentBseEquitySessionDates(): Promise<Date[]> {
  const rows = await prisma.bseEodQuote.findMany({
    distinct: ["sessionDate"],
    orderBy: { sessionDate: "desc" },
    take: BSE_EQUITY_FLOOR_WINDOW_SESSIONS,
    select: { sessionDate: true },
  });
  return rows.map((r) => r.sessionDate);
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
