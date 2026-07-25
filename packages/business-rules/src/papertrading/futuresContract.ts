/**
 * Paper Trading Phase 4 — shared index-futures contract identity helpers.
 *
 * Close sibling of optionContract.ts, deliberately reusing its date
 * parsing/formatting (parseNseExpiryDate/formatNseExpiryDate) rather than
 * duplicating it — only the label/symbol formatters differ, since a futures
 * contract has no strike/optionType dimension.
 *
 * Pure module: zero I/O. Used by apps/web's order-placement route (building
 * the PaperOrder.symbol value) and by any UI surface that needs the same
 * canonical contract label — one implementation, so a display string and a
 * DB-stored symbol can never drift apart from how a contract's identity is
 * actually computed for grouping in replay.ts's deriveFuturesPositions.
 */

import { formatNseExpiryDate } from "./optionContract";

/**
 * Canonical PaperOrder.symbol value for a futures contract — compact, no
 * separators, matches this codebase's option-contract-symbol convention
 * closely enough to be recognizable: e.g. "NIFTYFUT28AUG2026".
 */
export function formatFuturesContractSymbol(underlyingSymbol: string, expiryDate: Date): string {
  const dd = String(expiryDate.getUTCDate()).padStart(2, "0");
  const mon = formatNseExpiryDate(expiryDate).split("-")[1].toUpperCase();
  const yyyy = expiryDate.getUTCFullYear();
  return `${underlyingSymbol}FUT${dd}${mon}${yyyy}`;
}

/**
 * Human-readable contract label for UI surfaces — e.g. "NIFTY FUT, 28-Aug-26",
 * exactly the format the Phase 4 brief's contract-table spec uses.
 */
export function formatFuturesContractLabel(underlyingSymbol: string, expiryDate: Date): string {
  const label = formatNseExpiryDate(expiryDate); // "28-Aug-2026"
  const [dd, mon, yyyy] = label.split("-");
  return `${underlyingSymbol} FUT, ${dd}-${mon}-${yyyy.slice(-2)}`;
}
