import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

/**
 * "ETFs tracking this index" (ETF Layer, 2026-08-12 Ask 3 — the product-glue
 * cross-link, symmetric with `EtfDetailsPanel`'s "Tracks: <index> →" link on
 * the ETF side). Renders only registry-confirmed funds whose Underlying/own
 * name was hand-verified (NSE) or embedding-matched (BSE — see
 * bseFundRegistry.ts's own doc on the weaker-but-verified guarantee) to
 * resolve to THIS exact index — never a guess; an index with zero
 * verified-tracking funds simply doesn't render this section (same
 * graceful-degrade discipline as `IndexCompositionPanel`).
 *
 * BSE Phase 3B (2026-08-14) — widened from `EtfRegistryEntry[]` (NSE-only)
 * to this minimal structural shape so the SAME component renders a mixed
 * NSE-ETF-registry + BSE-fund-registry list (instrument.ts merges both
 * before this component ever sees the array) without either registry
 * depending on the other's full type.
 */
type TrackingFundEntry = { symbol: string; displayName: string };

export function EtfTrackingList({ etfs }: { etfs: TrackingFundEntry[] }) {
  if (etfs.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">ETFs tracking this index</p>
          <p className="text-[11px] text-ink-400">
            {etfs.length} {etfs.length === 1 ? "fund" : "funds"}
          </p>
        </div>
        <ul className="divide-y divide-ink-100">
          {etfs.map((etf) => (
            <li key={etf.symbol}>
              <Link
                href={`/instruments/${etf.symbol}`}
                className="flex items-center justify-between gap-3 rounded-md py-2.5 transition-colors hover:bg-ink-50/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{etf.symbol}</p>
                  <p className="truncate text-xs text-ink-400">{etf.displayName}</p>
                </div>
                <span className="shrink-0 rounded-full border border-ink-200 px-2 py-0.5 text-[11px] font-medium text-ink-500">
                  ETF
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
