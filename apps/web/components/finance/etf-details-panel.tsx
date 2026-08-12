import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { EtfRegistryEntry } from "@/lib/finance/etfRegistry";
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
 */
export function EtfDetailsPanel({
  symbol,
  fundName,
  etf,
  trailingPE,
}: {
  symbol: string;
  /** Best-available fund identity — instrument.ts's companyName resolution: registry `displayName` (AMFI's real scheme-master name, exact-ISIN-joined) first, Yahoo's `price.longName` only for the rare ETF AMFI didn't resolve, else the bare symbol; passed through as `companyName` elsewhere on the page, repeated here for the panel's own heading. */
  fundName: string;
  etf: EtfRegistryEntry;
  /** Yahoo's basket P/E (`summaryDetail.trailingPE`), when cached — honestly labeled below as index-basket P/E, never presented as the fund's own earnings ratio (a fund has none). */
  trailingPE?: number;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-ink-900">ETF details</h2>
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
                <span className="ml-1.5 font-normal text-ink-400">(as published by NSE — not yet linked)</span>
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
                href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-signal-sky hover:underline"
              >
                View on NSE ↗
              </a>
            </div>
          </div>

          <p className="border-t border-ink-100 pt-3 text-[11px] leading-5 text-ink-400">
            Exchange-traded fund — priced and traded like a stock. Expense ratio, fund manager, and assets under
            management aren&apos;t available from our data sources for NSE-listed ETFs and are never estimated.
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
