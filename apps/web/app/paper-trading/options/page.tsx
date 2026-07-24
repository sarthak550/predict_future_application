import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";

import { OptionsPageClient } from "@/components/paper-trading/options-page-client";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Options — Paper Trading — Predict Future",
  robots: { index: false, follow: false }
};

// Phase 3 (T7) added a query-param deep-link entry point (?underlying=&optionType=,
// e.g. from PaperTradeCta's "Trade options on this call" link) — OptionsPageClient
// reads it via useSearchParams(), which bails out of static prerender without a
// Suspense boundary. Same pattern as the main dashboard page.tsx.
export default function PaperTradingOptionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/paper-trading" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" />
          Back to Paper Trading
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink-900">Options</h1>
        <p className="mt-1 text-sm text-ink-500">
          NIFTY/BANKNIFTY index options (cash-settled at expiry) or F&amp;O-eligible single-stock options (squared off
          before expiry close). Buy CE or PE only, fully prepaid, no margin. Writing/selling isn&apos;t offered.
        </p>
      </div>
      <Suspense>
        <OptionsPageClient />
      </Suspense>
    </div>
  );
}
