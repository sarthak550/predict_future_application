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
  return (
    <Suspense>
      <PaperTradingDashboard optionsTradingEnabled={optionsTradingEnabled} futuresTradingEnabled={futuresTradingEnabled} />
    </Suspense>
  );
}
