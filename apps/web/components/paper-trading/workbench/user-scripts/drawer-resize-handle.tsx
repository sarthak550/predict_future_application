"use client";

/**
 * User Strategy Scripting (SS2), D4 — a vertical-axis sibling of
 * `panel-resize-handle.tsx`. That file's own math is horizontal (`dx`/
 * `clientX`, widening a right-side panel); the script drawer resizes its
 * OWN height from a drag handle on its top edge, which is a different axis
 * and a different "which direction grows the box" sign than the panel
 * handle's — not a drop-in reuse, per D4's own "reuse if the resize math
 * generalizes, otherwise a new small sibling component" framing. Same
 * imperative-drag-then-commit-on-end discipline as that file: `onResize`
 * fires at most once per animation frame with the live, already-clamped
 * height for the caller to write straight to the DOM (never through
 * `setState`); `onResizeEnd` fires exactly once, at pointer-up, with the
 * final height to commit to React state + localStorage.
 *
 * **Founder-feedback pass (2026-08-04) — viewport-aware max, the real bug
 * fix.** Live-browser diagnosis (Playwright, screenshots at 1512/1280/990px
 * and at a shorter 800px-tall viewport — a realistic non-fullscreen browser
 * window) found the static `DRAWER_MAX_HEIGHT` ceiling let a user drag the
 * drawer tall enough to force the chart above it below `kline-chart.tsx`'s
 * own hard floor (`min-h-[420px]` on its mount container, confirmed via
 * live DOM measurement — the canvas simply refuses to shrink past 420px
 * total and instead overflows past its flex container's bottom edge). Past
 * that point the chart visibly PAINTS OVER the drawer's own toolbar/resize
 * handle, and — worse — the handle becomes unclickable a second time
 * (`elementFromPoint` at the handle's own reported coordinates resolves to
 * the overflowing `<canvas>`, not the handle div), silently breaking BOTH
 * further dragging and the double-click reset. On an 800px-tall viewport
 * this collision happens with ZERO user interaction — the DEFAULT 360px
 * height alone already collides once the drawer opens.
 *
 * Fix: `clampDrawerHeight` now also caps against a height DERIVED from the
 * viewport, so the user can never drag (or land at, via the stored/default
 * height) a value that would crush the chart below its protected minimum.
 * `CHART_AREA_RESERVED_PX` intentionally reserves MORE than the measured
 * 473px (53 header + 420 chart floor) — chart-workbench.tsx's own top
 * toolbar row is `flex-wrap` and can grow past one line on narrow widths,
 * and this file deliberately does NOT import a constant from
 * `kline-chart.tsx`/`chart-workbench.tsx` to compute this precisely (both
 * are outside the Scripts-drawer chunk, out of scope for this pass) — a
 * generous, documented, hand-verified reserve here instead of a
 * cross-chunk dependency.
 *
 * **Founder bug fix (2026-08-07) — "I can't adjust the script vertically,"
 * the real root cause.** The 520px reserve above, chosen against the
 * chart's OLD unconditional 420px floor, meant that on a realistic ~860px-
 * tall laptop window `getEffectiveMaxDrawerHeight(860)` = 340 — and
 * `DRAWER_DEFAULT_HEIGHT`/the stored height ALSO clamped to 340 there, so
 * the drawer was already sitting exactly at its ceiling with zero px of
 * legal travel. Live-measured (Playwright, real DOM, dev server, drawer
 * open): dragging the handle up 300px produced a delta of exactly 0 —
 * correctly clamped, but indistinguishable from "broken" to a user. A
 * follow-up founder report ("even shrinking doesn't work") turned out to be
 * the SAME root cause from the other side: `DRAWER_MIN_HEIGHT` (320) sat
 * only 20px below that same 340 ceiling, so the *entire* legal corridor at
 * that viewport height was `[320, 340]` — twenty pixels, imperceptible as a
 * drag.
 *
 * Fix widens BOTH ends of the corridor:
 * 1. **Ceiling** — `kline-chart.tsx` now accepts an optional `minHeightPx`
 *    prop; `chart-workbench.tsx` passes `200` (verified live: klinecharts
 *    renders a fully legible, correctly-interactive candle chart at 200px —
 *    axis labels readable, indicators/drawings paint correctly) ONLY while
 *    the Scripts drawer is open, keeping the original 420px floor whenever
 *    it's closed. `CHART_AREA_RESERVED_PX` is re-derived to match:
 *    `TOPBAR_RESERVE_PX` (96, NOT the common-case 53 — live-measured via
 *    Playwright across viewport widths 700-1512px: the topbar's `flex-wrap`
 *    row stays a single 53px line down to 1000px wide, but wraps to a
 *    measured 93-95px at <=900px wide; 96 is the worst case rounded up, so
 *    the reserve stays collision-safe on a narrow-AND-short window, not
 *    just the common wide case) + `CHART_COMPACT_MIN_PX` (200, matching
 *    `kline-chart.tsx`'s new open-drawer floor exactly) + a 14px
 *    measurement/rounding safety margin = **310** (was 520 — a deliberately
 *    LESS conservative reserve than before, which is the entire point: the
 *    old 520 baked in 47px of pure slack over its own stated 473px
 *    real-need arithmetic; this pass removes that slack now that the chart
 *    itself can genuinely afford to shrink further while the drawer wants
 *    the room).
 * 2. **Floor** — `DRAWER_MIN_HEIGHT` 320 -> 160. 320 was originally derived
 *    (see that constant's own doc, preserved below) as the point below
 *    which the console's own minimum could no longer fit alongside the
 *    editor's PREFERRED floor — a comfort target, not a collision-safety
 *    requirement. `script-editor-drawer.tsx`'s `computeEditorMinHeight`/
 *    `computeConsoleMaxHeight` already degrade gracefully below that comfort
 *    point (documented in that file's own QA-fix-pass doc: the editor's
 *    floor shrinks toward 0, the console self-force-collapses) — nothing
 *    in that machinery assumed 320 was a hard floor. 160px is enough for the
 *    toolbar row plus a handful of visible editor lines; `DRAWER_ABSOLUTE_MIN_HEIGHT`
 *    (40) is UNCHANGED — it remains the true catastrophic-viewport guard,
 *    only reachable when the viewport is shorter than any realistic browser
 *    window (`< CHART_AREA_RESERVED_PX + DRAWER_ABSOLUTE_MIN_HEIGHT` ≈
 *    350px tall), same contract as before.
 *
 * Live-measured outcome at real viewport heights (Chromium, standalone prod
 * bundle, drawer dragged through its FULL range): 750px -> `[160, 440]`
 * (280px of real travel), 860px -> `[160, 550]` (390px), 1000px ->
 * `[160, 640]` (480px, capped by the absolute `DRAWER_MAX_HEIGHT` ceiling,
 * not the viewport) — see the ticket's own final report for the full
 * dev+prod verification matrix.
 */
import { useRef } from "react";

/**
 * Founder bug fix (2026-08-07) — lowered from 320 to 160 (see this file's
 * own module doc for the full "corridor was only 20px wide" root cause).
 * 320 was originally derived (paragraph below, preserved for history) as
 * the point below which the console's own minimum could no longer fit
 * alongside the editor's PREFERRED floor — a comfort target the drawer's
 * internal budget machinery (`script-editor-drawer.tsx`'s
 * `computeEditorMinHeight`/`computeConsoleMaxHeight`) was ALREADY built to
 * degrade gracefully below (the QA-fix pass documented there predates this
 * one) — nothing about lowering this constant required touching that
 * machinery. 160px still fits the drawer's own toolbar row plus a handful
 * of visible editor lines; below it the console self-force-collapses
 * (`consoleExpandable` in that file) rather than overlapping anything.
 *
 * Original 320 derivation, preserved: this was the point below which
 * `computeConsoleMaxHeight` could no longer fit even the console's own
 * `CONSOLE_MIN_HEIGHT` (80px) alongside the editor's preferred
 * `EDITOR_MIN_HEIGHT_PX` (100px) and the drawer's other fixed chrome
 * (90 + 40px). A first cut of 240 let the drawer shrink small enough that
 * expanding the console to ITS OWN minimum still overlapped the editor by
 * ~70px — 320 was the precise point where that stopped being possible.
 *
 * **QA-fix pass (2026-08-05)**: this is a COMFORT target, not a hard floor.
 * It's what `clampDrawerHeight` tries to give the drawer when the viewport
 * has room, and what `computeEditorMinHeight`/`computeConsoleMaxHeight`
 * (`script-editor-drawer.tsx`) treat as the point below which their own
 * internal budgets start shrinking gracefully. It is NOT guaranteed to be
 * the drawer's actual minimum height anymore — see
 * `getEffectiveMaxDrawerHeight` below for why that guarantee was the bug.
 */
export const DRAWER_MIN_HEIGHT = 160;
/** Absolute ceiling regardless of viewport — only reachable on genuinely tall screens, see `getEffectiveMaxDrawerHeight`. */
export const DRAWER_MAX_HEIGHT = 640;
export const DRAWER_DEFAULT_HEIGHT = 360;

/**
 * Founder bug fix (2026-08-07) — see this file's own module doc for the
 * full derivation. Matches `kline-chart.tsx`'s new open-drawer floor
 * (`minHeightPx={200}`, wired from `chart-workbench.tsx`) instead of its
 * OLD unconditional 420px one.
 */
/** Live-measured (Playwright, real DOM, widths 700-1512px): the topbar stays a single 53px line down to 1000px wide, wraps to 93-95px at <=900px wide. Reserves the WORST case (rounded up), not the common one — a narrow-AND-short window is still safe. */
const TOPBAR_RESERVE_PX = 96;
/** Matches `kline-chart.tsx`'s `minHeightPx={200}` passed only while the drawer is open — see that prop's own doc. */
const CHART_COMPACT_MIN_PX = 200;
/** Measurement/rounding safety margin — the topbar and chart sit flush against each other with no other real chrome between them (confirmed live: no additional border/padding row in that column). */
const RESERVE_SAFETY_BUFFER_PX = 14;
/** See this file's own module doc — the "chart's own protected minimum while the drawer is open" reserve. 310, not the old 520: the old constant reserved for the chart's UNCONDITIONAL 420px floor plus 47px of pure slack; this one reserves for the chart's new 200px open-drawer floor plus a real, live-measured worst-case topbar + a small safety margin. */
const CHART_AREA_RESERVED_PX = TOPBAR_RESERVE_PX + CHART_COMPACT_MIN_PX + RESERVE_SAFETY_BUFFER_PX;

/**
 * QA-fix pass (2026-08-05) — a sanity-only floor, NOT a "drawer stays
 * comfortable" guarantee like `DRAWER_MIN_HEIGHT` used to (wrongly) provide
 * inside `getEffectiveMaxDrawerHeight`. Only reachable when
 * `viewportHeight < CHART_AREA_RESERVED_PX + DRAWER_ABSOLUTE_MIN_HEIGHT`
 * (~350px, re-derived 2026-08-07 alongside the new, smaller
 * `CHART_AREA_RESERVED_PX` — was ~560px against the old 520px reserve) —
 * shorter than any realistic laptop browser window — so it can
 * never re-open the collision this pass closes. Exists purely so the
 * computed CSS height can never hit zero/negative on a pathologically
 * short window.
 */
const DRAWER_ABSOLUTE_MIN_HEIGHT = 40;

/**
 * The real, viewport-aware ceiling — the smaller of the absolute
 * `DRAWER_MAX_HEIGHT` and whatever's left after reserving space for the
 * chart above the drawer. Exported so callers (the drawer's own
 * window-resize self-heal effect, `script-editor-drawer.tsx`) can re-derive
 * it without duplicating this math.
 *
 * **QA-fix pass (2026-08-05) — collision safety always wins.** The old
 * body was `Math.max(DRAWER_MIN_HEIGHT, vh - CHART_AREA_RESERVED_PX)`,
 * which let the 320px "comfort" floor OVERRIDE the collision-safety clamp
 * on any viewport shorter than ~840px (`DRAWER_MIN_HEIGHT +
 * CHART_AREA_RESERVED_PX`) — reproducing the exact chart-paints-over-the-
 * drawer defect this file exists to prevent. QA measured it live at
 * 750/720/700/650/600px viewport heights (a real Playwright
 * `locator.dblclick()` on the handle timed out at 700px, unable to hit it
 * through the overlapping `<canvas>`). The fix: never clamp UP against
 * `DRAWER_MIN_HEIGHT` here — only against the much smaller
 * `DRAWER_ABSOLUTE_MIN_HEIGHT` sanity floor above, which never reaches far
 * enough to matter on a real browser window. This means the drawer's
 * actual height (restored from localStorage, reset via double-click, or
 * live-dragged) can now legitimately land below `DRAWER_MIN_HEIGHT` on a
 * short viewport — a small-but-usable drawer beats an unusable, unclickable
 * one. See `script-editor-drawer.tsx`'s `computeEditorMinHeight` /
 * `computeConsoleMaxHeight` for how that file's internal editor/console
 * budget degrades gracefully once the drawer itself gets this small —
 * neither still assumes the drawer is >= `DRAWER_MIN_HEIGHT`.
 */
export function getEffectiveMaxDrawerHeight(viewportHeight?: number): number {
  const vh = viewportHeight ?? (typeof window !== "undefined" ? window.innerHeight : undefined);
  if (vh === undefined) return DRAWER_MAX_HEIGHT;
  const dynamicMax = Math.max(DRAWER_ABSOLUTE_MIN_HEIGHT, vh - CHART_AREA_RESERVED_PX);
  return Math.min(DRAWER_MAX_HEIGHT, dynamicMax);
}

/**
 * `viewportHeight` is only ever passed explicitly by tests — real call sites let this read `window.innerHeight` live, which matters mid-drag on a window that's being resized.
 *
 * The inner `Math.max(DRAWER_MIN_HEIGHT, height)` only ever pulls a height
 * UP toward the 320px comfort target; the outer `Math.min(effectiveMax, ...)`
 * still wins whenever `effectiveMax < DRAWER_MIN_HEIGHT` (a short viewport,
 * see `getEffectiveMaxDrawerHeight`'s own doc) — so this already returns a
 * collision-safe value below `DRAWER_MIN_HEIGHT` when the viewport demands
 * it, with no further change needed here.
 */
export function clampDrawerHeight(height: number, viewportHeight?: number): number {
  if (!Number.isFinite(height)) height = DRAWER_DEFAULT_HEIGHT;
  const effectiveMax = getEffectiveMaxDrawerHeight(viewportHeight);
  return Math.min(effectiveMax, Math.max(DRAWER_MIN_HEIGHT, height));
}

export function DrawerResizeHandle({
  getCurrentHeight,
  onResize,
  onResizeEnd,
  onDoubleClickReset
}: {
  /** A GETTER, not a captured prop value — read fresh at drag-START, same reasoning as `panel-resize-handle.tsx`'s own `getCurrentWidth`. */
  getCurrentHeight: () => number;
  /** Fires at most once per animation frame during the drag with the live, already-clamped height — apply directly to the DOM (`style.height`), never `setState`. */
  onResize: (height: number) => void;
  /** Fires exactly once, at `pointerup`, with the final height — commit to React state + persist here. */
  onResizeEnd: (height: number) => void;
  onDoubleClickReset: () => void;
}) {
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const liveHeightRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Cross-engine hardening (2026-08-07 founder report — see this file's own
  // module doc) — the SAME window-listener-primary pattern documented in
  // `use-drag-resize.ts`'s own module doc. `windowListenersRef` holds the
  // exact function references passed to `addEventListener` so `endDrag` can
  // remove the SAME ones (removing a different closure is a silent no-op).
  const windowListenersRef = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);
  const prevBodyUserSelectRef = useRef<string | null>(null);

  function scheduleFlush() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onResize(liveHeightRef.current);
    });
  }

  function applyMove(clientY: number) {
    // The handle sits on the drawer's TOP edge (drawer is below it) —
    // dragging UP (negative dy) GROWS the drawer, dragging down shrinks it.
    const dy = clientY - startYRef.current;
    liveHeightRef.current = clampDrawerHeight(startHeightRef.current - dy);
    scheduleFlush();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    // Defensive cleanup (2026-08-07) — live-testing this hardening pass
    // found a rare but real case (a synthetic-input engine that can drop a
    // `pointerup`/`pointercancel` before a rapid NEXT `pointerdown` on the
    // same handle) where the PREVIOUS drag's window listeners were still
    // attached when a new one started — `windowListenersRef` got silently
    // overwritten below, orphaning the old listeners attached to `window`
    // forever (never removable again, since removal needs the EXACT
    // function reference). Force-ending any still-active previous drag
    // FIRST guarantees a clean slate: `endDragInternal` is idempotent
    // (guarded by `draggingRef`) and removes exactly the listener pair it
    // itself attached.
    if (draggingRef.current) endDragInternal();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = getCurrentHeight();
    liveHeightRef.current = startHeightRef.current;
    // Enhancement, not a dependency — see `use-drag-resize.ts`'s own doc.
    // Some engines can throw for exotic pointer types; the window listeners
    // below are the real drag mechanism regardless of whether this succeeds.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored — window listeners below don't need capture to work.
    }
    prevBodyUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onWindowMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      applyMove(ev.clientY);
    };
    const onWindowUp = () => endDragInternal();
    windowListenersRef.current = { move: onWindowMove, up: onWindowUp };
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Redundant fast-path when pointer capture DID succeed (harmless
    // double-schedule with the window listener above — `scheduleFlush`'s
    // own `rafRef` guard already collapses same-frame duplicates).
    if (!draggingRef.current) return;
    applyMove(e.clientY);
  }

  function endDragInternal() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const listeners = windowListenersRef.current;
    if (listeners) {
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.up);
      windowListenersRef.current = null;
    }
    document.body.style.userSelect = prevBodyUserSelectRef.current ?? "";
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    onResizeEnd(liveHeightRef.current);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endDragInternal();
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize script drawer"
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClickReset}
      className="group relative h-2.5 shrink-0 touch-none select-none border-t border-ink-100 hover:cursor-row-resize"
      style={{ cursor: "row-resize", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-transparent group-hover:bg-sky-300" />
    </div>
  );
}
