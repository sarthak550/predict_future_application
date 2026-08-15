import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/** Widened max-w-5xl → max-w-6xl (2026-08-09 sitewide layout-width pass) — Top Movers/news/filings read better with the extra room, consistent with the rest of the finance page family. * Widened again 2026-08-15 (founder: side gutters looked bad on large screens while inner content had to scroll — content pages now track closer to the header's own max-w-[1800px]). */
export default function PulseLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
