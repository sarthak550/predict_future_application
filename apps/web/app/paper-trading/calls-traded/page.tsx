import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { CallsTradedList } from "@/components/paper-trading/calls-traded-list";

// Signed-in personal utility page — never indexed.
export const metadata: Metadata = {
  title: "Calls I've traded — Predict Future",
  robots: { index: false, follow: false }
};

export default function CallsTradedPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/paper-trading" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" />
          Back to Paper Trading
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink-900">Calls I&apos;ve traded</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every analyst call you&apos;ve paper-traded, with your own net P&L against how the call itself graded.
        </p>
      </div>
      <CallsTradedList />
    </div>
  );
}
