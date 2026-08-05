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
 */
import { useRef } from "react";

/**
 * 320, not a rounder-looking 240/300 — this is the point below which
 * `script-editor-drawer.tsx`'s `computeConsoleMaxHeight` can no longer fit
 * even the console's own `CONSOLE_MIN_HEIGHT` (80px) alongside the editor's
 * preferred `EDITOR_MIN_HEIGHT_PX` (100px) and the drawer's other fixed
 * chrome (90 + 40px, see that file's own constants). Caught live: a first
 * cut of 240 let the drawer shrink small enough that expanding the console
 * to ITS OWN minimum still overlapped the editor by ~70px — this number is
 * the precise point where that stops being possible, not an arbitrary
 * round figure.
 *
 * **QA-fix pass (2026-08-05)**: this is a COMFORT target, not a hard floor.
 * It's what `clampDrawerHeight` tries to give the drawer when the viewport
 * has room, and what `computeEditorMinHeight`/`computeConsoleMaxHeight`
 * (`script-editor-drawer.tsx`) treat as the point below which their own
 * internal budgets start shrinking gracefully. It is NOT guaranteed to be
 * the drawer's actual minimum height anymore — see
 * `getEffectiveMaxDrawerHeight` below for why that guarantee was the bug.
 */
export const DRAWER_MIN_HEIGHT = 320;
/** Absolute ceiling regardless of viewport — only reachable on genuinely tall screens, see `getEffectiveMaxDrawerHeight`. */
export const DRAWER_MAX_HEIGHT = 640;
export const DRAWER_DEFAULT_HEIGHT = 360;

/** See this file's module doc — the "chart's own protected minimum" reserve, deliberately conservative. */
const CHART_AREA_RESERVED_PX = 520;

/**
 * QA-fix pass (2026-08-05) — a sanity-only floor, NOT a "drawer stays
 * comfortable" guarantee like `DRAWER_MIN_HEIGHT` used to (wrongly) provide
 * inside `getEffectiveMaxDrawerHeight`. Only reachable when
 * `viewportHeight < CHART_AREA_RESERVED_PX + DRAWER_ABSOLUTE_MIN_HEIGHT`
 * (~560px) — shorter than any realistic laptop browser window — so it can
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

  function scheduleFlush() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onResize(liveHeightRef.current);
    });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = getCurrentHeight();
    liveHeightRef.current = startHeightRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    // The handle sits on the drawer's TOP edge (drawer is below it) —
    // dragging UP (negative dy) GROWS the drawer, dragging down shrinks it.
    const dy = e.clientY - startYRef.current;
    liveHeightRef.current = clampDrawerHeight(startHeightRef.current - dy);
    scheduleFlush();
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    onResizeEnd(liveHeightRef.current);
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
      style={{ cursor: "row-resize" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-transparent group-hover:bg-sky-300" />
    </div>
  );
}
