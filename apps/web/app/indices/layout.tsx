import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * All-Indices informational layer — shared chrome for /indices and
 * /indices/[slug], mirroring app/instruments/layout.tsx exactly (same
 * max-w-5xl content width; a directory/detail pair, not a trading
 * terminal, so no need for the wider paper-trading shell).
 */
export default function IndicesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
