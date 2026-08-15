import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * All-Indices informational layer — shared chrome for /indices and
 * /indices/[slug]. Widened max-w-5xl → max-w-6xl (2026-08-09 sitewide
 * layout-width pass, founder: pages feel underused at desktop width) —
 * matches the rest of the finance detail-page family (bonds, instruments,
 * analysts); still not the paper-trading terminal's near-full-width shell,
 * since this is a directory/detail pair, not a trading terminal.
 * Widened again 2026-08-15 (founder: side gutters looked bad on large screens while inner content had to scroll — content pages now track closer to the header's own max-w-[1800px]). */
export default function IndicesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
