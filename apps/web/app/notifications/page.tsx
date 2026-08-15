import type { Metadata } from "next";
import Link from "next/link";

import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Notifications — Predict Future",
  robots: { index: false, follow: false },
};

/**
 * Full notification history (Growth Loop Sprint G2, Decision 2) — lifted
 * from the parked app/(app)/_parked/notifications/page.tsx (deleted by this
 * same change; see the commit message) and restyled to PublicHeader's
 * design tokens. requireUser() redirects a signed-out visitor to /sign-in,
 * same auth-gate convention as every other signed-in-only page in apps/web.
 */
export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">Notifications</h1>
          <p className="mt-2 text-sm text-ink-500">
            New calls from analysts you follow, and resolutions on calls you&rsquo;ve engaged with.
          </p>
        </div>
        <MarkAllReadButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All activity</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {notifications.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No notifications yet.</p>
          ) : (
            notifications.map((notification) => {
              const rowClassName = `block rounded-[20px] border px-4 py-3 transition ${
                notification.isRead ? "border-ink-100" : "border-signal-sky/30 bg-signal-sky/5"
              }`;
              const body = (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-2">
                    {!notification.isRead && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-sky" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{notification.title}</p>
                      <p className="mt-0.5 text-sm text-ink-500">{notification.body}</p>
                    </div>
                  </div>
                  <p className="shrink-0 text-xs text-ink-400">{formatRelativeTime(notification.createdAt)}</p>
                </div>
              );

              return notification.href ? (
                <Link
                  key={notification.id}
                  href={notification.href}
                  className={`${rowClassName} hover:border-signal-sky/40 hover:bg-ink-50/60`}
                >
                  {body}
                </Link>
              ) : (
                <div key={notification.id} className={rowClassName}>
                  {body}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
