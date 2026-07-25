import type { Metadata } from "next";
import Link from "next/link";

import { IndexChangeBadge, formatIndexLevel } from "@/components/finance/index-change-badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchAllIndices, type IndexRow } from "@/lib/finance/indices";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "All NSE Indices — live levels & charts — Predict Future",
  description:
    "Every NSE index in one place — broad market, sectoral, thematic, strategy and fixed income — live levels, day change and 52-week range, sourced straight from NSE.",
  alternates: { canonical: "https://predictfuture.app/indices" },
  robots: { index: true, follow: true }
};

/**
 * All-Indices informational layer — founder brief 2026-07-25: "I can see
 * multiple indices like Nifty Auto, Metal or MidCap... we cant be limited to
 * few." Pure browsing surface — the 5 F&O-tradable underlyings remain the
 * only ones the Paper Trading options terminal accepts (see
 * lib/finance/indexTradableAlias.ts); this page just makes every NSE-
 * published index level viewable.
 *
 * Grouped by NSE's OWN `key` classification field (returned live in every
 * /api/allIndices row, e.g. "SECTORAL INDICES") — GROUP_ORDER below is a
 * display-order preference over those live group labels, never a hardcoded
 * list of index names. Any group NSE adds in the future that isn't in
 * GROUP_ORDER still renders, just appended after the known ones.
 */
const GROUP_ORDER = [
  "INDICES ELIGIBLE IN DERIVATIVES",
  "BROAD MARKET INDICES",
  "SECTORAL INDICES",
  "THEMATIC INDICES",
  "STRATEGY INDICES",
  "FIXED INCOME INDICES"
];

const GROUP_LABEL: Record<string, string> = {
  "INDICES ELIGIBLE IN DERIVATIVES": "Tradable in F&O",
  "BROAD MARKET INDICES": "Broad Market",
  "SECTORAL INDICES": "Sectoral",
  "THEMATIC INDICES": "Thematic",
  "STRATEGY INDICES": "Strategy",
  "FIXED INCOME INDICES": "Fixed Income"
};

function groupLabel(key: string): string {
  return GROUP_LABEL[key] ?? key;
}

function groupIndices(rows: IndexRow[]): { key: string; rows: IndexRow[] }[] {
  const byGroup = new Map<string, IndexRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group);
    if (list) list.push(row);
    else byGroup.set(row.group, [row]);
  }

  const knownKeys = GROUP_ORDER.filter((key) => byGroup.has(key));
  const unknownKeys = [...byGroup.keys()].filter((key) => !GROUP_ORDER.includes(key)).sort();

  return [...knownKeys, ...unknownKeys].map((key) => ({
    key,
    rows: (byGroup.get(key) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  }));
}

function formatIstNow(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(new Date(iso));
}

export default async function IndicesDirectoryPage() {
  const snapshot = await fetchAllIndices();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">All NSE Indices</h1>
        <p className="mt-1 text-sm text-ink-500">
          {snapshot
            ? `${snapshot.indices.length} indices, live from NSE · as of ${formatIstNow(snapshot.asOf)} IST`
            : "Live index data is temporarily unavailable — check back shortly."}
        </p>
      </div>

      {!snapshot ? (
        <Card>
          <CardContent className="p-6 text-sm text-ink-500">
            We couldn&apos;t reach NSE&apos;s live index feed just now. This page refreshes automatically — please try
            again in a minute.
          </CardContent>
        </Card>
      ) : (
        groupIndices(snapshot.indices).map((group) => (
          <Card key={group.key}>
            <CardContent className="p-5">
              <p className="mb-3 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
                {groupLabel(group.key)}
                <span className="font-normal normal-case tracking-normal text-ink-300">{group.rows.length}</span>
              </p>
              <ul className="divide-y divide-ink-100">
                {group.rows.map((row) => (
                  <li key={row.slug}>
                    <Link
                      href={`/indices/${row.slug}`}
                      className="flex items-center justify-between gap-3 rounded-md py-2.5 transition-colors hover:bg-ink-50/60"
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-ink-900">{row.name}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-sm tabular-nums text-ink-600">
                          {row.last != null ? formatIndexLevel(row.last) : "—"}
                        </span>
                        <span className="w-20 text-right tabular-nums">
                          <IndexChangeBadge changePercent={row.changePercent} />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
