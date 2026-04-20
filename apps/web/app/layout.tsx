import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { AuthSessionProvider } from "@/components/providers/session-provider";

export const metadata: Metadata = {
  title: "Predict Future",
  description:
    "Short-form news feed with attached play-money predictions, crowd probabilities, and reputation-driven leaderboards."
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
