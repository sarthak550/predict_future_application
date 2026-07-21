import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

export default function InstrumentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
