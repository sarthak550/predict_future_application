import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";

import { FuturesPageClient } from "@/components/paper-trading/futures-page-client";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Futures — Paper Trading — Predict Future",
  robots: { index: false, follow: false }
};

// Reads ?underlying=&expiry=&side= (deep-links from the positions strip / the
// dashboard's futures positions table Close action) via useSearchParams(),
// which bails out of static prerender without a Suspense boundary — same
// pattern as the options page.
export default function PaperTradingFuturesPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/paper-trading" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" />
          Back to Paper Trading
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink-900">Futures</h1>
        <p className="mt-1 text-sm text-ink-500">
          Index futures (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50) — long or short, margin-backed, marked to
          market daily against the real NSE settlement price. Stock futures aren&apos;t offered yet — see the note
          below.
        </p>
      </div>
      <Suspense>
        <FuturesPageClient />
      </Suspense>
    </div>
  );
}
