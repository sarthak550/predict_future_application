import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Trust Layer Sprint T3 (2026-08-15) — new page, so this picks a tier straight from the
 * founder's LAYOUT WIDTH SYSTEM documented in app/layout.tsx rather than inventing one:
 * max-w-7xl is the "card/list pages" tier (/analysts, /bonds, /indices, /economy), which
 * /methodology matches in spirit — a Card-based content page in the same analyst-scorecard
 * family, not a dense data table like /opinions or /pulse (max-w-[1600px]).
 */
export default function MethodologyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
