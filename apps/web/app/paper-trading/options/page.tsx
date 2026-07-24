import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { OptionsPageClient } from "@/components/paper-trading/options-page-client";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Options — Paper Trading — Predict Future",
  robots: { index: false, follow: false }
};

// No useSearchParams here (unlike the main dashboard, which pre-fills from a
// CTA deep-link) — this page has no query-param entry point, so no Suspense
// boundary is required.
export default function PaperTradingOptionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/paper-trading" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" />
          Back to Paper Trading
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink-900">Index Options</h1>
        <p className="mt-1 text-sm text-ink-500">
          NIFTY and BANKNIFTY — buy CE or PE only, fully prepaid, no margin. Writing/selling isn&apos;t offered.
        </p>
      </div>
      <OptionsPageClient />
    </div>
  );
}
