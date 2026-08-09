import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Bonds informational layer — shared chrome for /bonds and /bonds/[symbol].
 * Widened max-w-5xl → max-w-6xl (2026-08-09 sitewide layout-width pass) —
 * mirrors app/indices/layout.tsx; still a directory/detail pair, not a
 * trading terminal — bonds are NOT paper-tradable, see the Bonds
 * informational-layer brief.
 */
export default function BondsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
