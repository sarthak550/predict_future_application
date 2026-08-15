import type { Metadata } from "next";
import { Suspense } from "react";

import { PaperTradingDashboard } from "@/components/paper-trading/paper-trading-dashboard";
import { isFuturesTradingEnabled, isOptionsTradingEnabled } from "@/lib/paperTrading/featureFlags";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Paper Trading — Predict Future",
  robots: { index: false, follow: false }
};

export default function PaperTradingPage() {
  // Derivatives gate follow-up (2026-08-12c), founder: "the charts for
  // tradable indices are not accessible — they are blocked since options and
  // futures are disabled for now." The equity terminal's own search surfaces
  // (docked search + the maximized workbench's popover) need BOTH flags —
  // see featureFlags.ts's own doc for why these are read server-side and
  // threaded down as props rather than imported into the client dashboard
  // directly (same pattern app/paper-trading/futures/page.tsx and
  // app/paper-trading/options/page.tsx already use for their own gate).
  const optionsTradingEnabled = isOptionsTradingEnabled();
  const futuresTradingEnabled = isFuturesTradingEnabled();

  // Suspense boundary: the dashboard reads useSearchParams() (CTA deep-links
  // pass ?symbol=/&opinion=), which bails out of static prerender without one.
  // The fallback is a REAL server-rendered frame (2026-08-15 audit item: the
  // first byte previously shipped a blank 12KB client-side-bailout shell —
  // bad on slow connections and for anyone view-sourcing the page) — title,
  // context copy, and a skeleton in the dashboard's shape, replaced in place
  // once the client bundle hydrates.
  return (
    <Suspense fallback={<PaperTradingSkeleton />}>
      <PaperTradingDashboard optionsTradingEnabled={optionsTradingEnabled} futuresTradingEnabled={futuresTradingEnabled} />
    </Suspense>
  );
}

/** Server-rendered first-byte frame — mirrors the dashboard's header + panel layout so hydration swaps content in place without a layout jump. */
function PaperTradingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Paper Trading</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          Practice trading NSE equities with virtual capital — real end-of-day and live prices, honest
          delayed-feed disclosure, zero real money. Loading your terminal…
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3" aria-hidden>
        <div className="h-40 animate-pulse rounded-2xl border border-ink-100 bg-white/80" />
        <div className="h-40 animate-pulse rounded-2xl border border-ink-100 bg-white/80" />
        <div className="h-40 animate-pulse rounded-2xl border border-ink-100 bg-white/80" />
      </div>
      <div className="h-96 animate-pulse rounded-2xl border border-ink-100 bg-white/80" aria-hidden />
    </div>
  );
}
