"use client";

/**
 * Founder bug fix (2026-08-06) — "when we refresh, the chart view goes
 * away": the maximized charting workbench was component state only
 * (`workbenchOpen` in paper-trading-dashboard.tsx / futures-page-client.tsx
 * / options-page-client.tsx), so a page refresh silently dropped the user
 * back to the plain terminal. Shared by all 3 terminal pages so the URL
 * merge-and-replace mechanics — and the restore-on-first-resolve /
 * close-on-real-change ordering every call site needs to get right — live
 * in exactly one place instead of being hand-rolled 3 times.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * Reads/writes the single `?workbench=` query param, preserving every OTHER
 * param already on the URL — same merge-into-existing-searchParams
 * convention as `opinions-filter-bar.tsx`'s `setParam`. `router.replace`
 * (never `push`): opening/closing the workbench must never spam browser
 * history with its own entries, but the CURRENT value still lands in
 * whatever history entry is active when the user navigates away — so a
 * browser back/forward that returns to this exact URL still restores
 * whichever workbench state was showing when they left.
 *
 * The value is a bare string (`"1"` for the single-workbench pages, `
 * "underlying" | "premium"` for the options page's two workbenches) —
 * callers own what the value means, this hook only owns the URL mechanics.
 */
export function useWorkbenchUrlParam(): readonly [string | null, (next: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get("workbench");

  const setValue = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) {
        params.set("workbench", next);
      } else {
        params.delete("workbench");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return [value, setValue] as const;
}

/**
 * Shared "restore an open workbench once its required data resolves, then
 * close it again on any REAL later change" pattern — used for the equity
 * terminal's focused symbol and the futures/options terminals' underlying.
 * (The options page's PREMIUM chart has extra fallback logic of its own —
 * no deep-linked contract can ever leave it stranded waiting forever — and
 * is hand-rolled directly in options-page-client.tsx instead of using this
 * hook; see that file's own doc.)
 *
 * `resolvedValue` starts `null` while the required piece of state hasn't
 * resolved yet — a deep-link symbol/underlying can resolve synchronously on
 * the very first render, a localStorage-restored "last focused symbol"
 * resolves one tick later (see paper-trading-dashboard.tsx's own doc on
 * that priority chain). Either way, the FIRST time it becomes non-null is
 * treated as "the page just finished figuring out what to show" — a
 * candidate for restoring an open workbench from the URL, never a
 * user-driven change. Every value AFTER that first resolution is a real
 * change, and force-closes a workbench left open for whatever the PREVIOUS
 * value was (the pre-existing "close the workbench when the focused
 * symbol/underlying changes" behavior this hook replaces, unchanged).
 *
 * Critically, `onRealChangeClose` only ever fires AFTER the first
 * resolution has already happened — never on mount — so it can't race the
 * restore itself by clearing the just-read `?workbench=` URL param before
 * `onFirstResolveOpen` gets a chance to act on it. (An earlier draft used
 * two separate effects for "restore" and "close on change"; on the very
 * first mount both fired in the same commit, and the close-on-change effect
 * — seeing state go from its own initial `null` to a real value — ran
 * second and immediately wiped the just-restored URL param. Merging both
 * concerns into one effect, gated by a single "have we seen a value before"
 * ref, is what actually fixes that race, not just definition order.)
 */
export function useWorkbenchAutoRestore(
  resolvedValue: string | null,
  shouldOpenOnFirstResolve: boolean,
  onFirstResolveOpen: () => void,
  onRealChangeClose: () => void
) {
  const previousRef = useRef<string | null>(null);
  useEffect(() => {
    const isFirstResolution = previousRef.current === null && resolvedValue !== null;
    const isRealChange = previousRef.current !== null && previousRef.current !== resolvedValue;
    previousRef.current = resolvedValue;
    if (isFirstResolution) {
      if (shouldOpenOnFirstResolve) onFirstResolveOpen();
      return;
    }
    if (isRealChange) onRealChangeClose();
    // shouldOpenOnFirstResolve/onFirstResolveOpen/onRealChangeClose are read
    // fresh from the latest render inside this closure on purpose — only
    // `resolvedValue` should ever re-run this effect (matches the
    // pre-existing `[focusedSymbol]`/`[underlying]`-only dependency arrays
    // this hook replaces).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedValue]);
}
