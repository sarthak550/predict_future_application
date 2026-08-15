import type { ReactNode } from "react";

import { PublicHeader } from "@/components/finance/public-header";

/**
 * Shared chrome for /notifications — a card/list page per the layout width
 * law (app/layout.tsx), same tier as /analysts. Growth Loop Sprint G2: a
 * fresh route under the public-page pattern (NOT the old (app)/AppShell
 * group, which now only backs the admin console) — the page itself gates
 * on requireUser(), redirecting a signed-out visitor to /sign-in.
 */
export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
