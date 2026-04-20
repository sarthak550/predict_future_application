import { type ReactNode } from "react";
import { getServerSession } from "next-auth";

import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { getAccountSummary } from "@/lib/account";
import { authOptions } from "@/lib/auth";

export async function AppShell({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  const account = await getAccountSummary(session?.user?.id);

  return (
    <div className="min-h-screen bg-[#f5f7fb] bg-grid bg-[size:40px_40px]">
      <div className="mx-auto flex max-w-[1600px]">
        <Sidebar session={session} />
        <div className="min-h-screen flex-1">
          <TopNav
            session={session}
            unreadCount={account.unreadNotifications}
            balance={account.balance}
          />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
