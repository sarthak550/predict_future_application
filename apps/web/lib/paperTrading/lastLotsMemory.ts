/**
 * Trading Terminal UI Overhaul (Sprint A, T6) — remembers the last lot count
 * used for each specific option contract, so a ladder [B]/[S] tap (Express
 * OFF) can default to "the last-used lot count for that contract, or 1" per
 * the brief's exact spec. Device-wide, localStorage-backed, bounded to a
 * small most-recently-used set (a Paper Trading account only ever touches a
 * handful of distinct contracts in practice — no need for a real LRU).
 */
const STORAGE_KEY = "pf.papertrading.lastLotsByContract";
const MAX_ENTRIES = 50;

function contractKey(underlying: string, strikePrice: number, optionType: "CE" | "PE", expiry: string): string {
  return `${underlying}::${strikePrice}::${optionType}::${expiry}`;
}

function readMap(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getLastLotsForContract(underlying: string, strikePrice: number, optionType: "CE" | "PE", expiry: string): number | null {
  if (typeof window === "undefined") return null;
  const map = readMap();
  const value = map[contractKey(underlying, strikePrice, optionType, expiry)];
  return typeof value === "number" && value > 0 ? value : null;
}

export function rememberLotsForContract(underlying: string, strikePrice: number, optionType: "CE" | "PE", expiry: string, lots: number): void {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    map[contractKey(underlying, strikePrice, optionType, expiry)] = lots;
    const entries = Object.entries(map);
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Private mode / storage disabled — the preset default just won't persist.
  }
}
