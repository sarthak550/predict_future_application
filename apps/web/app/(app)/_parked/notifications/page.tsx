import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">Notifications</h1>
          <p className="mt-2 text-sm text-ink-500">Market lifecycle updates, reports, and social activity.</p>
        </div>
        <MarkAllReadButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Everything that matters to your forecasting profile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notifications.map((notification) => (
            <div key={notification.id} className="rounded-[24px] border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-ink-900">{notification.title}</p>
                  <p className="text-sm text-ink-500">{notification.body}</p>
                </div>
                <p className="text-xs text-ink-400">{formatDateTime(notification.createdAt)}</p>
              </div>
            </div>
          ))}
          {notifications.length === 0 && <p className="text-sm text-ink-500">No notifications yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
