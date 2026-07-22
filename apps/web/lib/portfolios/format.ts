/**
 * Portfolios (P3.2) — shared rupee/percent formatting for the directory,
 * detail, and manage surfaces. Mirrors the local formatRupees/formatSignedRupees
 * helpers in app/instruments/[symbol]/page.tsx (Indian digit grouping, en-IN),
 * lifted to a shared module since portfolios spreads the same formatting across
 * several server and client components (a single local helper wouldn't be
 * reusable across both).
 */

/** "₹10,00,000" — Indian digit grouping, at most 2 decimal places. */
export function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "+₹52.00" / "-₹12.30" — signed rupee change. */
export function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "+12.4%" / "-3.1%" — signed percent, one decimal place, from a returnPct fraction. */
export function formatSignedPercent(returnPct: number): string {
  const sign = returnPct > 0 ? "+" : returnPct < 0 ? "-" : "";
  return `${sign}${Math.abs(returnPct * 100).toFixed(1)}%`;
}
