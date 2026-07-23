import type { Metadata } from "next";
import { Suspense } from "react";

import { PaperTradingDashboard } from "@/components/paper-trading/paper-trading-dashboard";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Paper Trading — Predict Future",
  robots: { index: false, follow: false }
};

export default function PaperTradingPage() {
  // Suspense boundary: the dashboard reads useSearchParams() (CTA deep-links
  // pass ?symbol=/&opinion=), which bails out of static prerender without one.
  return (
    <Suspense>
      <PaperTradingDashboard />
    </Suspense>
  );
}
