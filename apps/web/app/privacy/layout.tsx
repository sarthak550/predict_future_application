import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * S74-T4 — /privacy is pure reading content (no data tables/cards), so this
 * picks the "reading width" tier from app/layout.tsx's documented width
 * system (max-w-2xl: "in-page intro blurbs — paragraph legibility, not a
 * container"), not methodology's max-w-7xl (that page is Card-based with
 * live query data, this one isn't).
 */
export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
