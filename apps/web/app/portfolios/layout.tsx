import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Shared chrome for every /portfolios surface — the public directory, public
 * detail pages, AND the signed-in create/manage pages (T3 renders them as
 * client components, but they still live under this same layout for
 * consistent header/nav; only app/portfolios/page.tsx and
 * app/portfolios/[slug]/page.tsx opt into ISR via `export const revalidate`).
 */
export default function PortfoliosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
