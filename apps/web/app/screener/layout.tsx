import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Shared chrome for /screener — a data-dense page per the layout width law
 * (app/layout.tsx): max-w-[1600px], same tier as /instruments and /opinions,
 * NOT the narrower max-w-7xl card/list tier — a multi-column ranked table
 * with 7 columns starves below this width the same way the chain ladder
 * does on /paper-trading.
 */
export default function ScreenerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
