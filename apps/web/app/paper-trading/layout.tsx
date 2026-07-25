import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Shared chrome for every /paper-trading surface — signed-in-only utility pages
 * (dashboard + "Calls I've traded"), rendered as client components (see
 * app/portfolios/layout.tsx's identical rationale for its own signed-in pages).
 */
export default function PaperTradingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      {/* Trading-terminal surfaces want the full monitor: near-full-width, unlike
          the content pages' max-w-5xl — the chain ladder is the piece that
          starves first when this is too narrow. */}
      <main className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
