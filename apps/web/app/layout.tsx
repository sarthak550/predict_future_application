import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { AuthSessionProvider } from "@/components/providers/session-provider";

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
