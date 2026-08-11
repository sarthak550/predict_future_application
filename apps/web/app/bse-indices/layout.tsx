import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * BSE Expansion Phase 1 (2026-08-12) — shared chrome for the standalone
 * /bse-indices browse page. Same shell as /indices' own layout.tsx
 * (max-w-6xl, PublicHeader) — deliberately not reusing the /indices route
 * tree itself, since /indices/[slug] is now an NSE-only redirect (Indices
 * Consolidation, 2026-08-12) that resolves slugs through NSE-specific
 * matchers this phase must not touch.
 */
export default function BseIndicesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
