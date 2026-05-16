/**
 * Admin — Big Call Performance Dashboard (S30-T6)
 *
 * Server component. Queries all markets designated as "Big Call"
 * (isBigCallDate IS NOT NULL), ordered by date descending. Displays a
 * summary table with opens, participants, and outcome.
 *
 * Auth: inherited from the (admin) layout — requireAdmin() runs there.
 *
 * Route: /admin/big-call
 */

import type { Metadata } from "next";
import Link from "next/link";

import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Big Call Dashboard — Predict Future Admin",
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BigCallRow {
  id: string;
  title: string;
  isBigCallDate: Date;
  bigCallNotificationOpenedCount: number;
  totalParticipants: number;
  outcome: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchBigCallData(): Promise<BigCallRow[]> {
  const markets = await prisma.market.findMany({
    where: { isBigCallDate: { not: null } },
    orderBy: { isBigCallDate: "desc" },
    select: {
      id: true,
      title: true,
      isBigCallDate: true,
      bigCallNotificationOpenedCount: true,
      totalParticipants: true,
      outcome: true,
      status: true,
    },
  });

  return markets as BigCallRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function outcomeLabel(outcome: string, status: string): string {
  if (status !== "RESOLVED") return outcome === "UNRESOLVED" ? "Pending" : status;
  switch (outcome) {
    case "YES":
      return "YES";
    case "NO":
      return "NO";
    case "CANCELLED":
      return "Cancelled";
    default:
      return outcome || "Pending";
  }
}

function outcomeColorClass(outcome: string, status: string): string {
  if (status !== "RESOLVED") return "text-ink-400";
  if (outcome === "YES") return "text-signal-teal font-semibold";
  if (outcome === "NO") return "text-signal-coral font-semibold";
  return "text-ink-400";
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function BigCallDashboardPage() {
  const markets = await fetchBigCallData();

  // Aggregate stats
  const last7DaysCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const last7Days = markets.filter(
    (m) => m.isBigCallDate != null && m.isBigCallDate >= last7DaysCutoff
  );
  const last7DaysAvgOpens =
    last7Days.length > 0
      ? Math.round(
          last7Days.reduce((sum, m) => sum + m.bigCallNotificationOpenedCount, 0) /
            last7Days.length
        )
      : 0;

  let highestOpens = 0;
  let highestOpensDate: Date | null = null;
  for (const m of markets) {
    if (m.bigCallNotificationOpenedCount > highestOpens) {
      highestOpens = m.bigCallNotificationOpenedCount;
      highestOpensDate = m.isBigCallDate!;
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Big Call Dashboard</h1>
        <p className="mt-2 text-sm text-ink-500">
          All markets designated as Today&apos;s Big Call, ordered by date descending.
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid gap-5 md:grid-cols-3">
        <div className="rounded-[20px] border border-white/70 bg-white/80 p-6">
          <p className="text-3xl font-semibold text-ink-900">{last7DaysAvgOpens.toLocaleString()}</p>
          <p className="mt-1 text-sm text-ink-500">Last 7 days avg opens</p>
        </div>
        <div className="rounded-[20px] border border-white/70 bg-white/80 p-6">
          <p className="text-3xl font-semibold text-ink-900">{highestOpens.toLocaleString()}</p>
          <p className="mt-1 text-sm text-ink-500">
            Highest ever{highestOpensDate ? ` (${formatDate(highestOpensDate)})` : ""}
          </p>
        </div>
        <div className="rounded-[20px] border border-white/70 bg-white/80 p-6">
          <p className="text-3xl font-semibold text-ink-900">{markets.length}</p>
          <p className="mt-1 text-sm text-ink-500">Total Big Call days</p>
        </div>
      </div>

      {/* Table */}
      {markets.length === 0 ? (
        <p className="text-sm text-ink-500">No Big Call markets found.</p>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-white/70 bg-white/80">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60">
                <tr>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Date
                  </th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Market
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Opens
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Participants
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {markets.map((m) => (
                  <tr key={m.id} className="hover:bg-ink-50/40">
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-600">
                      {formatDate(m.isBigCallDate!)}
                    </td>
                    <td className="px-5 py-3.5 text-ink-900">
                      <Link
                        href={`/markets/${m.id}`}
                        className="text-signal-sky hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {m.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-ink-900">
                      {m.bigCallNotificationOpenedCount.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-ink-900">
                      {m.totalParticipants.toLocaleString()}
                    </td>
                    <td
                      className={`whitespace-nowrap px-5 py-3.5 text-right ${outcomeColorClass(m.outcome, m.status)}`}
                    >
                      {outcomeLabel(m.outcome, m.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="pt-2">
        <Link href="/admin" className="text-sm text-signal-sky hover:underline">
          &larr; Admin Home
        </Link>
      </div>
    </div>
  );
}
