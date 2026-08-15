import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/** Shared chrome for /economy/**, mirroring app/pulse/layout.tsx and app/bonds/layout.tsx (same max-w-6xl, header-only shell). */
export default function EconomyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
