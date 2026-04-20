import Link from "next/link";
import type { Session } from "next-auth";
import { Bell } from "lucide-react";

import { UserMenu } from "@/components/auth/user-menu";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/lib/utils";

/**
 * Minimal top nav. Page-level titles belong inside the page, not the chrome,
 * so the header stays quiet and predictable on every route.
 */
export function TopNav({
  session,
  unreadCount,
  balance
}: {
  session: Session | null;
  unreadCount: number;
  balance?: number;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-[#f5f7fb]/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-end gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {session?.user ? (
          <>
            <PointsPill balance={balance ?? 0} />
            <NotificationsButton unreadCount={unreadCount} />
            <ProfilePill username={session.user.username} />
            <UserMenu />
          </>
        ) : (
          <>
            <Link href="/sign-in">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button size="sm">Get started</Button>
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

function PointsPill({ balance }: { balance: number }) {
  return (
    <span
      className="rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white"
      title="Virtual points balance"
    >
      {formatPoints(balance)} pts
    </span>
  );
}

function NotificationsButton({ unreadCount }: { unreadCount: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      className="relative rounded-xl border border-ink-200 bg-white p-2.5 text-ink-600 transition hover:border-signal-sky hover:text-signal-sky"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-signal-coral px-1 py-0.5 text-center text-[10px] font-semibold leading-none text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

function ProfilePill({ username }: { username: string }) {
  return (
    <Link
      href={`/profile/${username}`}
      className="hidden items-center gap-2 rounded-xl border border-ink-200 bg-white px-2.5 py-1.5 transition hover:border-signal-sky sm:flex"
    >
      <Avatar name={username} className="h-7 w-7 rounded-lg text-[11px]" />
      <span className="text-sm font-medium text-ink-900">{username}</span>
    </Link>
  );
}
