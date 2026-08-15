import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { AuthSessionProvider } from "@/components/providers/session-provider";

// LAYOUT WIDTH SYSTEM (founder directive 2026-08-15: "make this the last fix
// for the empty-space problem" — every section layout MUST pick from these
// tiers; do not invent new widths per page):
//   max-w-[1800px] — chrome + terminals: PublicHeader, SiteFooter,
//                    /paper-trading (chain ladders starve below this).
//   max-w-[1600px] — data-dense content: /instruments (compositions,
//                    workbench), /opinions (the browse-every-call table),
//                    /pulse (movers tables).
//   max-w-7xl      — card/list pages: /analysts, /bonds, /indices,
//                    /economy, /bse-indices, /portfolios, admin (inside
//                    AppShell's own 1600px sidebar frame).
//   Deliberately narrow, do NOT widen: /calls/[id] share artifacts (2xl),
//   auth/join form cards, in-page intro blurbs (max-w-2xl reading width —
//   paragraph legibility, not a container).
//   The homepage manages its own founder-locked hero widths — leave it.
//
// No title `template` here deliberately: every child page under app/** already
// sets its own full title string ending in "| Predict Future" (see
// app/analysts/page.tsx, app/analysts/[slug]/page.tsx, app/calls/[id]/page.tsx)
// — a template would double-append the suffix on every one of them.
export const metadata: Metadata = {
  title: "Predict Future — India's Analyst Scorecard — track which market analysts are actually right",
  description:
    "India's Analyst Scorecard — we track what Indian market analysts say in the press and grade every call HIT or MISS against what actually happened, sourced back to the original article.",
  metadataBase: new URL("https://predictfuture.app"),
  openGraph: {
    siteName: "Predict Future — Analyst Scorecard",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#f5f7fb] text-ink-900">
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
