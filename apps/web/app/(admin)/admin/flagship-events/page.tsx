/**
 * Admin — Flagship Events Dashboard (S32-T6)
 *
 * Server component. Lists ALL markets with flagshipEventAt set, sorted by
 * flagshipEventAt DESC. Provides inline Edit Flagship form and links to the
 * market resolve queue.
 *
 * Auth: inherited from the (admin) layout — requireAdmin() runs there.
 *
 * Route: /admin/flagship-events
 */

import type { Metadata } from "next";
import Link from "next/link";

import { MarkFlagshipForm } from "@/components/admin/mark-flagship-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Flagship Events — Predict Future Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchFlagshipMarkets() {
  return prisma.market.findMany({
    where: { flagshipEventAt: { not: null } },
    orderBy: { flagshipEventAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      flagshipEventAt: true,
      flagshipEventType: true,
      totalParticipants: true,
      totalVotes: true,
      marketType: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Status badge variant helper
// ---------------------------------------------------------------------------

function statusVariant(status: string): "default" | "warning" | "accent" | "success" {
  switch (status) {
    case "OPEN":
      return "accent";
    case "PENDING_REVIEW":
    case "DRAFT":
      return "warning";
    case "RESOLVED":
    case "FINALIZED":
      return "success";
    default:
      return "default";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function FlagshipEventsPage() {
  const markets = await fetchFlagshipMarkets();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">Flagship Events</h1>
          <p className="mt-2 text-sm text-ink-500">
            All markets tagged as Policy &amp; Big Events, sorted by event date descending. Use &quot;Edit Flagship&quot; to update or clear the designation.
          </p>
        </div>
        <Link
          href="/admin/flagship-events/new"
          className="shrink-0 inline-flex items-center rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
        >
          + Create flagship poll
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All flagship markets ({markets.length})</CardTitle>
          <CardDescription>
            Markets with <code className="text-xs">flagshipEventAt</code> set. Includes all statuses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {markets.length === 0 && (
            <p className="text-sm text-ink-500">No flagship events yet. Mark a market from the moderation queue or resolution queue.</p>
          )}
          <div className="space-y-4">
            {markets.map((market) => (
              <div key={market.id} className="rounded-[20px] border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(market.status)}>
                        {market.status.toLowerCase().replaceAll("_", " ")}
                      </Badge>
                      {market.flagshipEventType && (
                        <Badge variant="accent">{market.flagshipEventType}</Badge>
                      )}
                      <Badge variant="default">{market.marketType}</Badge>
                    </div>

                    {/* Title */}
                    <p className="font-medium text-ink-900 break-words">{market.title}</p>

                    {/* Event date + crowd count */}
                    <div className="flex flex-wrap items-center gap-4 text-sm text-ink-500">
                      {market.flagshipEventAt && (
                        <span>
                          Event: {market.flagshipEventAt.toLocaleDateString("en-IN", {
                            weekday: "short",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })} {market.flagshipEventAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                        </span>
                      )}
                      <span>{market.totalParticipants.toLocaleString()} participants</span>
                      {market.totalVotes > 0 && (
                        <span>{market.totalVotes.toLocaleString()} votes</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 min-w-[200px]">
                    <MarkFlagshipForm
                      marketId={market.id}
                      currentFlagshipEventAt={market.flagshipEventAt}
                      currentFlagshipEventType={market.flagshipEventType}
                    />
                    <Link
                      href={`/admin/resolutions?marketId=${market.id}`}
                      className="text-xs font-semibold text-signal-sky hover:underline"
                    >
                      Resolve this market
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
