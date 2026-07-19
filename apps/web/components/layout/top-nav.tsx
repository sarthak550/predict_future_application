import Link from "next/link";
import type { Session } from "next-auth";

import { UserMenu } from "@/components/auth/user-menu";
import { Button } from "@/components/ui/button";

/**
 * Minimal top nav for the (admin) shell — the only surviving consumer of
 * AppShell now that every (app) group page (feed/markets/groups/profile/
 * notifications/etc.) has been parked out of routing (app/(app)/_parked/**)
 * as part of the Analyst Scorecard pivot. The notifications bell and profile
 * pill used to link into those pages and were removed rather than left
 * pointing at now-unrouted URLs; UserMenu still covers sign-out.
 */
export function TopNav({ session }: { session: Session | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-[#f5f7fb]/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-end gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {session?.user ? (
          <UserMenu />
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
