import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { formatIstSessionDate } from "@/lib/utils";

/**
 * ETF Details panel (ETF Layer, 2026-08-12 — founder ask: "what about the
 * ETFs"). Replaces `FundamentalsPanel` on a registry-confirmed ETF's
 * instrument page (never both — same "never both" branching
 * `IndexMetricsPanel`/`IndexCompositionPanel` already use for indices).
 *
 * FIELD AVAILABILITY, verified live 2026-08-12 against Yahoo's
 * crumb-authenticated quoteSummary for NIFTYBEES.NS/GOLDBEES.NS/
 * BANKBEES.NS/ICICIB22.NS: Yahoo classifies every NSE ETF tested as
 * `quoteType: "EQUITY"`, and `fundProfile`/`topHoldings`/`assetProfile` all
 * return null — there is NO expense ratio, AUM/totalAssets, fund category,
 * or holdings breakdown available from this source for an Indian ETF (those
 * fields exist on US-listed funds' quoteSummary, not NSE-listed ones). Only
 * `price.longName` (the fund's real name — see fundamentals.ts's
 * `KeyStats.yahooLongName`) and, inconsistently, `summaryDetail.trailingPE`
 * (a basket P/E Yahoo computes from constituents) resolve. Rather than
 * render a details panel with mostly-empty tiles, this panel is built
 * entirely from what NSE's OWN eq_etfseclist.csv registry proves per fund
 * (lib/finance/etfRegistry.ts) plus that one Yahoo field when present —
 * never a fabricated expense ratio or AUM figure.
 *
 * BSE Phase 3B (2026-08-14) — generalized to also render a
 * `BseFundRegistryEntry` (lib/finance/bseFundRegistry.ts): the `etf` prop is
 * now the minimal shared shape both registries provide, `exchange` swaps the
 * "View on NSE/BSE" outbound link and the footer's "unavailable for
 * NSE-listed/BSE-listed ETFs" wording so a BSE-only fund's page never claims
 * to be NSE data. Nothing about the NSE branch's rendering changed — default
 * `exchange="NSE"` keeps every existing caller byte-identical.
 */
export interface EtfDetailsPanelEntry {
  trackedIndexName: string | null;
  trackedIndexSymbol: string | null;
  /** As-published raw text shown when `trackedIndexName` is null — NSE's Underlying column verbatim, or (BSE) empty (BSE's bhavcopy has no such field — see bseFundRegistry.ts's module doc). */
  underlyingRaw?: string;
  dateOfListing?: Date | null;
  isin: string;
  faceValue?: number | null;
}

export function EtfDetailsPanel({
  symbol,
  fundName,
  etf,
  trailingPE,
  exchange = "NSE",
  bseScripCode,
}: {
  symbol: string;
  /** Best-available fund identity — instrument.ts's companyName resolution: registry `displayName` (AMFI's real scheme-master name, exact-ISIN-joined) first, Yahoo's `price.longName` only for the rare ETF AMFI didn't resolve, else the bare symbol; passed through as `companyName` elsewhere on the page, repeated here for the panel's own heading. */
  fundName: string;
  etf: EtfDetailsPanelEntry;
  /** Yahoo's basket P/E (`summaryDetail.trailingPE`), when cached — honestly labeled below as index-basket P/E, never presented as the fund's own earnings ratio (a fund has none). */
  trailingPE?: number;
  /** BSE Phase 3B (2026-08-14) — which exchange this fund is listed on. Defaults to "NSE" (byte-identical rendering for every pre-existing caller). */
  exchange?: "NSE" | "BSE";
  /** Required when `exchange === "BSE"` — BSE's own numeric scrip code (BseEodQuote.scripCode). BSE's stock-share-price URL routes primarily off this code; the two path segments before it are cosmetic slugs BSE's own routing accepts as literal placeholders (verified live 2026-08-14: `/stock-share-price/x/x/{scripCode}/` returns 200 for a real scrip code). */
  bseScripCode?: string;
}) {
  const exchangeQuoteUrl =
    exchange === "BSE" && bseScripCode
      ? `https://www.bseindia.com/stock-share-price/x/x/${encodeURIComponent(bseScripCode)}/`
      : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-ink-900">{exchange === "BSE" ? "Fund details" : "ETF details"}</h2>
      <Card>
        <CardContent className="space-y-5 p-5">
          <div>
            <p className="text-xs text-ink-400">Fund name</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-900">{fundName}</p>
          </div>

          <div>
            <p className="text-xs text-ink-400">Tracks</p>
            {etf.trackedIndexName && etf.trackedIndexSymbol ? (
              <Link
                href={`/instruments/${etf.trackedIndexSymbol}`}
                className="mt-0.5 inline-block text-sm font-semibold text-signal-sky hover:underline"
              >
                {etf.trackedIndexName} →
              </Link>
            ) : (
              <p className="mt-0.5 text-sm font-semibold text-ink-900">
                {etf.underlyingRaw || "—"}
                <span className="ml-1.5 font-normal text-ink-400">
                  {exchange === "BSE"
                    ? "(not resolved — BSE's data carries no separate tracked-index field)"
                    : "(as published by NSE — not yet linked)"}
                </span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {etf.dateOfListing && <Fact label="Listed since" value={formatIstSessionDate(etf.dateOfListing)} />}
            {etf.isin && <Fact label="ISIN" value={etf.isin} />}
            {etf.faceValue != null && <Fact label="Face value" value={`₹${etf.faceValue}`} />}
            {trailingPE != null && <Fact label="P/E (index basket, TTM)" value={trailingPE.toFixed(1)} />}
            <div>
              <p className="text-xs text-ink-400">Exchange</p>
              <a
                href={exchangeQuoteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-signal-sky hover:underline"
              >
                View on {exchange} ↗
              </a>
            </div>
          </div>

          <p className="border-t border-ink-100 pt-3 text-[11px] leading-5 text-ink-400">
            Exchange-traded fund — priced and traded like a stock. Expense ratio, fund manager, and assets under
            management aren&apos;t available from our data sources for {exchange}-listed funds and are never
            estimated.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-ink-900">{value}</p>
    </div>
  );
}
