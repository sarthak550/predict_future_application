import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Server-side account summary used by the chrome (top nav + sidebar).
 *
 * Why this lives in lib/account.ts and not inlined in <AppShell>:
 * - keeps DB access out of the UI component so it can be moved behind an
 *   `apps/api` endpoint later without touching component code
 * - gives one stable shape for anything in the chrome that needs the
 *   "who am I + how many unread + how many points" triple
 *
 * Kept as a Prisma call for now because it renders on every authenticated
 * request and adding an HTTP hop would hurt TTFB. Move behind the API when
 * web/mobile converge on the same session protocol.
 */
export type AccountSummary = {
  unreadNotifications: number;
  balance: number;
};

export async function getAccountSummary(userId: string | null | undefined): Promise<AccountSummary> {
  if (!userId) {
    return { unreadNotifications: 0, balance: 0 };
  }

  const [unreadNotifications, wallet] = await Promise.all([
    prisma.notification.count({
      where: { userId, isRead: false }
    }),
    prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true }
    })
  ]);

  return {
    unreadNotifications,
    balance: wallet?.balance ?? 0
  };
}
