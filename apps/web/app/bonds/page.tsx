import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { fetchBondsListing, type BondListingRow } from "@/lib/finance/bonds";
import { formatIstSessionDate } from "@/lib/utils";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "Bonds — Government Securities & Sovereign Gold Bonds — Predict Future",
  description:
    "NSE-listed Government Securities (GOI bonds) and Sovereign Gold Bonds — end-of-day prices, informational only.",
  robots: { index: true, follow: true },
};

/**
 * Bonds informational-layer listing (T5, brief §T5) — reachable ONLY via the
 * search modal's Bonds tab ("View all bonds" link), deliberately NOT a
 * top-level nav item. Founder already removed the /indices directory from
 * nav for the same reason (see app/indices/page.tsx's redirect) — bonds are
 * an even narrower asset class, so this stays search-discoverable only.
 */
function BondRow({ row }: { row: BondListingRow }) {
  const isUp = row.changePercent >= 0;
  return (
    <Link
      href={`/bonds/${row.symbol}`}
      className="flex items-center justify-between gap-4 rounded-2xl px-4 py-3 transition hover:bg-ink-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-900">{row.displayName}</span>
        <span className="block truncate text-xs text-ink-400">{row.symbol}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-medium tabular-nums text-ink-900">
          ₹{row.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
        <span className={`block text-xs font-medium tabular-nums ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
          {isUp ? "+" : ""}
          {row.changePercent.toFixed(2)}%
        </span>
      </span>
    </Link>
  );
}

export default async function BondsDirectoryPage() {
  const listing = await fetchBondsListing();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Bonds</h1>
        <p className="mt-1 text-sm text-ink-500">
          NSE-listed Government Securities and Sovereign Gold Bonds — end-of-day closes, informational only.
        </p>
      </div>

      {!listing ? (
        <Card>
          <CardContent className="p-6 text-sm text-ink-500">
            No bond prices tracked yet — this page fills in after the next end-of-day NSE data pass.
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-400">
              Government Securities ({listing.governmentSecurities.length})
            </h2>
            <Card>
              <CardContent className="divide-y divide-ink-100 p-2">
                {listing.governmentSecurities.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-ink-400">No Government Securities tracked yet.</p>
                ) : (
                  listing.governmentSecurities.map((row) => <BondRow key={row.symbol} row={row} />)
                )}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-400">
              Sovereign Gold Bonds ({listing.sovereignGoldBonds.length})
            </h2>
            <Card>
              <CardContent className="divide-y divide-ink-100 p-2">
                {listing.sovereignGoldBonds.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-ink-400">No Sovereign Gold Bonds tracked yet.</p>
                ) : (
                  listing.sovereignGoldBonds.map((row) => <BondRow key={row.symbol} row={row} />)
                )}
              </CardContent>
            </Card>
          </section>

          <p className="text-center text-xs text-ink-400">
            Prices as of {formatIstSessionDate(listing.sessionDate)} (EOD). Informational only — not tradable on
            Predict Future.
          </p>
        </>
      )}
    </div>
  );
}
