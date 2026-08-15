import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/** Widened max-w-6xl → max-w-7xl (2026-08-09 sitewide layout-width pass) — this is the "browse every call" table page, the single biggest beneficiary of extra width in the product. * Widened again 2026-08-15 (founder: side gutters looked bad on large screens while inner content had to scroll — content pages now track closer to the header's own max-w-[1800px]). */
export default function OpinionsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
