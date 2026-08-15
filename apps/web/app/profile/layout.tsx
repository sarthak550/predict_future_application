import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Shared chrome for /profile — a card/list page per the layout width law
 * (app/layout.tsx), same tier as /analysts and /notifications. User Profile
 * Page brief (2026-08-15): exact sibling of app/notifications/layout.tsx —
 * the page itself gates on requireUser(), redirecting a signed-out visitor
 * to /sign-in.
 */
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
