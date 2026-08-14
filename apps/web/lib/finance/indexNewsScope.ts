import { getBseIndexUniverseEntry } from "@predict-future/business-rules/finance/bseIndexUniverse";

import { hasIndexConstituentList, fetchIndexConstituents } from "@/lib/finance/indexConstituents";
import { hasBseIndexConstituents, fetchBseIndexConstituents } from "@/lib/finance/bseIndexConstituents";
import { getBseLongTailIndexBySymbol } from "@/lib/finance/bseIndexLongTail";

/**
 * Index Constituent News (2026-08-15, founder: "the Stock News in Indices
 * instrument page … have stock news related to all the stocks part of that
 * index") — resolves an index page symbol to the list of constituent ticker
 * symbols its Stock News tab should aggregate over.
 *
 * Returns null for anything that ISN'T an index with a known constituent
 * list (plain equities, funds, bonds, indices without composition data) —
 * callers fall back to the plain single-ticker scope. Both underlying
 * fetchers keep their own membership caches (24h), so this adds no
 * per-request upstream fetch in steady state.
 *
 * Member symbols come back in each source's page-symbol convention (bare
 * NSE symbol, or `.BO`-suffixed for a BSE-only member) — exactly the
 * namespace MarketMoveNews rows are stored under, so the result is directly
 * usable as a `tickerSymbol IN (...)` news filter.
 */
export async function resolveIndexNewsScope(rawSymbol: string): Promise<string[] | null> {
  const symbol = rawSymbol.trim().toUpperCase();

  if (hasIndexConstituentList(symbol)) {
    const rows = await fetchIndexConstituents(symbol).catch(() => null);
    const members = (rows ?? []).map((r) => r.symbol).filter(Boolean);
    if (members.length > 0) return members;
  }

  // BSE index: resolve the page symbol back to BSE's own display name — the
  // key bseIndexConstituents.ts's dictionary uses — via the same two-step
  // (universe entry, then long tail) fetchInstrumentDetail itself performs.
  const bseName =
    getBseIndexUniverseEntry(symbol)?.name ?? (await getBseLongTailIndexBySymbol(symbol))?.name ?? null;
  if (bseName && hasBseIndexConstituents(bseName)) {
    const rows = await fetchBseIndexConstituents(bseName).catch(() => null);
    const members = (rows ?? []).map((r) => r.symbol).filter((s): s is string => Boolean(s));
    if (members.length > 0) return members;
  }

  return null;
}
