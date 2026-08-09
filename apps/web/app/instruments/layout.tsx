import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/** Widened max-w-5xl → max-w-6xl (2026-08-09 sitewide layout-width pass) — the detail page now splits Analyst opinions + sentiment into a 2-column layout that wants the extra room. */
export default function InstrumentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
