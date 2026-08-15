import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Shared chrome for every /portfolios surface — the public directory, public
 * detail pages, AND the signed-in create/manage pages (T3 renders them as
 * client components, but they still live under this same layout for
 * consistent header/nav; only app/portfolios/page.tsx and
 * app/portfolios/[slug]/page.tsx opt into ISR via `export const revalidate`).
 */
export default function PortfoliosLayout({ children }: { children: ReactNode }) {
  // Portfolios PARKED 2026-07-25 (founder: "we can launch this later and not
  // required right now"). Whole surface redirects home; nothing is deleted —
  // engine, crons (settle/value/shadow), API routes and these pages stay
  // intact so un-parking is a one-line revert of this redirect + restoring
  // the nav link in public-header.tsx. Shadow portfolios keep accruing
  // history in the background for a richer relaunch.
  redirect("/");

  // eslint-disable-next-line no-unreachable
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
