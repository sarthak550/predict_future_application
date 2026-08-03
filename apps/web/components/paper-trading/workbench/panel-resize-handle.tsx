"use client";

/**
 * Founder-feedback pass (2026-08-04) — a drag handle on the right panel's
 * left edge. Render-loop law applies here exactly like it does in
 * `kline-chart.tsx`'s own high-frequency chart events (crosshair-follow,
 * order-line drag): the drag itself is refs + `requestAnimationFrame`,
 * NEVER React state on every `pointermove` — `onResize` below is called at
 * most once per animation frame with the live width so the caller can write
 * it straight to the panel's `style.width` (imperative DOM mutation, no
 * re-render), and `onResizeEnd` fires exactly once, at `pointerup`, with the
 * final width for the caller to commit to React state + localStorage.
 *
 * **klinecharts resizes itself — verified, no manual `chart.resize()` call
 * needed anywhere in this drag path.** `ChartImp`'s constructor
 * (`dist/index.esm.js:14497`) calls `_initResizeListener()`, which installs
 * a native `ResizeObserver` directly on klinecharts' OWN internal container
 * div (`this._chartContainer`, a child it creates inside whatever element
 * `init(el, {})` was given — `dist/index.esm.js:14529-14533`). Any width
 * change to that div — including one caused by THIS handle shrinking/
 * growing the flex sibling next to the chart's `relative min-w-0 flex-1`
 * wrapper — fires `_scheduleResize()`, which is already its own
 * `requestAnimationFrame`-throttled, compares the new `clientWidth`/
 * `clientHeight` against a cached bounding, and calls the real `resize()`
 * (`dist/index.esm.js:14477-14486`, `15626`) only if it actually changed.
 * The chart therefore tracks this drag live, every frame, with ZERO code
 * added to `kline-chart.tsx` — confirmed by reading the installed package's
 * own constructor and resize-scheduling source directly, not assumed from
 * the plan's prose.
 *
 * Pointer-capture drag (works for mouse AND touch/pen in one code path,
 * `touch-none` on the handle disables the browser's own touch-scroll/
 * pinch-zoom gestures while dragging it) — same idiom this program already
 * uses for outside-dismiss listeners (`document.addEventListener(...,
 * true)`), just applied to `setPointerCapture` instead.
 */
import { useRef } from "react";

export const PANEL_MIN_WIDTH = 300;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 360;

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width));
}

export function PanelResizeHandle({
  getCurrentWidth,
  onResize,
  onResizeEnd,
  onDoubleClickReset
}: {
  /** A GETTER, not a captured prop value — read fresh at drag-START so a reset (or any other width change) that happened moments before a new drag is always the correct starting point, never a stale closure. */
  getCurrentWidth: () => number;
  /** Fires at most once per animation frame during the drag with the live, already-clamped width — apply it directly to the DOM (`style.width`), never through `setState`. */
  onResize: (width: number) => void;
  /** Fires exactly once, at `pointerup`, with the final width — commit to React state + persist here. */
  onResizeEnd: (width: number) => void;
  onDoubleClickReset: () => void;
}) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const liveWidthRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  function scheduleFlush() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onResize(liveWidthRef.current);
    });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = getCurrentWidth();
    liveWidthRef.current = startWidthRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    // The handle sits on the panel's LEFT edge (panel is to its right) —
    // dragging left (negative dx) WIDENS the panel, dragging right narrows it.
    const dx = e.clientX - startXRef.current;
    liveWidthRef.current = clampPanelWidth(startWidthRef.current - dx);
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
    onResizeEnd(liveWidthRef.current);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClickReset}
      className="group relative w-2.5 shrink-0 touch-none select-none border-l border-ink-100 hover:cursor-col-resize"
      style={{ cursor: "col-resize" }}
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent group-hover:bg-sky-300" />
    </div>
  );
}
