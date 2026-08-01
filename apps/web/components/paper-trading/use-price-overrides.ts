"use client";

/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint C, C1) — shared optimistic-
 * price-override state for drag-to-reprice, used identically by all three
 * terminals (equity dashboard, options premium chart, futures underlying
 * chart) so this self-healing anti-snap-back logic is written once rather
 * than forked three times.
 *
 * The problem it solves (Sprint C brief, C1's acceptance criteria + QA
 * requirement 3): a drag's optimistic UI shows the new price immediately,
 * before the PATCH resolves. Meanwhile the page's own routine account poll
 * (`pollIntervalMs`-driven, or the terminal's own `useVisiblePolling`) can
 * have a fetch ALREADY in flight when the drag starts — one that reads the
 * account from the DB BEFORE the PATCH commits, and therefore still carries
 * the PRE-reprice price. If that stale response's promise happens to
 * resolve AFTER the drag's own PATCH+refresh, a naive "clear the override
 * once our own refresh finishes" approach would already have cleared the
 * override, and the stale response would visibly snap the line back to its
 * old price — exactly the "silent snap-back" the brief calls out as
 * unacceptable (a reverted/repriced order must be visually unambiguous, not
 * something the user has to notice on their own).
 *
 * The fix: don't clear an override because "enough time has passed" or
 * "our own request finished" — clear it only once the account data we are
 * GIVEN actually reports the same price as the override. A stale response
 * that disagrees simply never clears its override (it keeps masking the
 * stale value); only a response from strictly after the PATCH committed can
 * agree, so this self-heals regardless of promise-resolution order.
 */
import { useEffect, useState } from "react";

export function usePriceOverrides(currentOrders: { id: string; price: number }[]): {
  overrides: Record<string, number>;
  setOverride: (id: string, price: number) => void;
  clearOverride: (id: string) => void;
} {
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev; // common case: no active/recent drag — no-op, cheap.
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        const current = currentOrders.find((o) => o.id === id);
        // Cleared once the account data agrees with the override, OR once
        // the order no longer exists at all (filled/cancelled/expired
        // elsewhere while an override was active) — the latter guards
        // against a permanently-stuck override for a row that will never
        // report a matching price again.
        if (current == null || current.price === prev[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrders]);

  function setOverride(id: string, price: number) {
    setOverrides((prev) => ({ ...prev, [id]: price }));
  }
  function clearOverride(id: string) {
    setOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return { overrides, setOverride, clearOverride };
}
