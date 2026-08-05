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
 *
 * Founder bug fix (2026-08-04b) — "whenever I refresh, [a different holding]
 * is shown instead of what I was looking at": the futures/options terminals'
 * FOCUSED underlying had the exact same "component state only" problem
 * `?workbench=` was built to fix. `useFocusUrlParam` below reuses the
 * identical replace-only mechanics for that — see futures-page-client.tsx's/
 * options-page-client.tsx's own docs on how each wires it up.
 * `useFrozenSearchParams`/`useStripOneShotParams` are the companion half:
 * a Sell-button/opinion-CTA deep-link (side/productType/quantity) must seed
 * its ticket exactly once and never again on a later refresh of the
 * resulting URL — see those hooks' own docs for the exact race they close.
 *
 * Round 3 (2026-08-05) — paper-trading-dashboard.tsx (the equity terminal)
 * dropped its own equivalent `useSymbolUrlParam` entirely: `?symbol=` was a
 * dual-purpose one-shot-input/live-persistence channel that raced its own
 * `useWorkbenchAutoRestore` write (see that file's own module doc, "B1").
 * The equity terminal now persists its focused symbol to localStorage only
 * and consumes `?symbol=` as a plain one-shot deep-link field alongside
 * side/productType/quantity/linkedOpinionId — it no longer needs a
 * continuously-written URL param at all, so that export was deleted here
 * rather than left dead. Futures/options are UNCHANGED — `?focus=` remains
 * their own separate, continuously-written persistence channel (`?underlying=`
 * stays purely a one-shot deep-link field for them, per this hook's own doc
 * below), since they were never part of this race.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * The query string to build a `router.replace` write FROM. Deliberately
 * `window.location.search` (the actual, current browser URL) rather than
 * the React-tracked `useSearchParams()` snapshot passed as `fallback`: this
 * fix introduces MULTIPLE independent post-mount effects that each want to
 * write a different param (e.g. `useStripOneShotParams` removing `side`
 * alongside a focus/symbol-sync effect adding `focus`/`symbol`) — when two
 * such effects fire in the SAME commit, both close over the exact same
 * `searchParams` snapshot from that render, so whichever's `router.replace`
 * lands second would silently clobber the first's write if it built its
 * params from that shared stale snapshot. `history.replaceState` (which
 * `router.replace` uses under the hood) updates `window.location`
 * synchronously, so reading it fresh at WRITE time — not render time —
 * means the second effect always sees the first effect's change, no matter
 * how Next's own React-context propagation is scheduled. `fallback` only
 * matters for the (SSR-impossible, since this whole module is "use client"
 * and every caller is an effect/event handler) case of `window` being
 * unavailable.
 */
function currentSearchParamsString(fallback: string): string {
  return typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : fallback;
}

/**
 * Generic single-query-param read/replace — the mechanics `useWorkbenchUrlParam`
 * originally hand-rolled just for `?workbench=`, factored out so the
 * focused-symbol persistence fix below reuses the exact same
 * replace-not-push, preserve-every-other-param, never-scroll behavior
 * instead of a second hand-synced copy. Not exported — every real caller
 * goes through one of the named wrappers below, which is what documents
 * WHICH param (and why) at every call site.
 */
function useQueryParam(key: string): readonly [string | null, (next: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key);

  const setValue = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(currentSearchParamsString(searchParams.toString()));
      if (next) {
        params.set(key, next);
      } else {
        params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, key]
  );

  return [value, setValue] as const;
}

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
  return useQueryParam("workbench");
}

/**
 * Futures/options terminals' OWN focus-persistence channel — deliberately a
 * SEPARATE param from `?underlying=`, not a reuse of it. `?underlying=`
 * (plus `?expiry=`/`?strike=`/`?optionType=`/`?side=`) is what those pages'
 * own `remountKey` wrapper (see futures-page-client.tsx's/
 * options-page-client.tsx's own doc) treats as "a genuinely NEW deep link
 * arrived, give this page a fresh instance" — continuously writing the
 * user's in-page underlying browsing back into THAT same param would make
 * every ordinary switch look like a fresh incoming deep link and force an
 * unwanted remount, discarding the selected contract / loaded account state
 * that switch is supposed to preserve. `?focus=` is excluded from both
 * wrappers' `remountKey` (the exact same treatment `workbench` already
 * gets, and for the same reason) so it can update freely without ever
 * triggering that remount — it exists purely to survive a hard refresh,
 * read once as a fallback default when no real `?underlying=` deep link is
 * present on the incoming URL.
 */
export function useFocusUrlParam(): readonly [string | null, (next: string | null) => void] {
  return useQueryParam("focus");
}

/**
 * Freezes the query string exactly as it was on THIS component instance's
 * very first render. One-shot deep-link params (Sell-button
 * side/quantity/productType) must seed their ticket/preset exactly once —
 * but they live alongside `?symbol=`/`?underlying=`/`?focus=`, which this
 * same fix now keeps live and continuously rewritten via `router.replace`.
 * Reading the one-shot fields from the live, reactive `useSearchParams()`
 * would race `useStripOneShotParams` below: whichever async event (a quote
 * poll landing, a chain snapshot arriving, or even just the strip's own
 * replaceState triggering a re-render) happens to read `searchParams`
 * AFTER the strip has already fired would silently see the one-shot value
 * as gone — e.g. re-arming a Sell ticket as a BUY instead. Freezing once,
 * before any strip can possibly run, removes the race entirely — every
 * one-shot deep-link field is read from THIS snapshot, never from
 * `useSearchParams()` directly, for the lifetime of the component.
 */
export function useFrozenSearchParams(): URLSearchParams {
  const searchParams = useSearchParams();
  const frozenRef = useRef<URLSearchParams | null>(null);
  if (frozenRef.current === null) {
    frozenRef.current = new URLSearchParams(searchParams.toString());
  }
  return frozenRef.current;
}

/**
 * Strips the given one-shot query-param keys from the URL once, shortly
 * after mount (inside an effect, so it runs after the first commit has
 * already used `useFrozenSearchParams`' captured values) — every OTHER
 * param (`?symbol=`/`?underlying=`/`?focus=`/`?workbench=`/`?linkedOpinionId=`)
 * is preserved untouched. This is the second half of the "refreshing after
 * a Sell/opinion deep-link must not re-arm the ticket" fix: the first
 * render already consumed the one-shot values (from the frozen snapshot
 * above), so removing them from the URL only changes what a LATER hard
 * refresh of this exact address-bar entry would see. A true no-op (no
 * `replaceState` call at all) when none of the keys are actually present —
 * a plain `?symbol=X` visit, the common case, never gets a pointless extra
 * history write.
 */
export function useStripOneShotParams(keys: readonly string[]): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    // Reads the LIVE URL, not the closure's `searchParams` snapshot — same
    // same-commit-clobber reasoning as `useQueryParam`'s setter above (a
    // page that ALSO syncs a focus param in its own mount effect, e.g.
    // futures-page-client.tsx/options-page-client.tsx, can fire both in the
    // same commit; this guarantees whichever runs second still sees the
    // first one's write).
    const params = new URLSearchParams(currentSearchParamsString(searchParams.toString()));
    if (!keys.some((k) => params.has(k))) return;
    for (const k of keys) params.delete(k);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // One-shot by design (see doneRef above) — deliberately empty deps, same
    // "run once on mount" idiom as this file's own useFrozenSearchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
