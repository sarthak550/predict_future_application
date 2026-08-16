import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

// See app/privacy/layout.tsx — same reading-width rationale applies here.
export default function TermsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
