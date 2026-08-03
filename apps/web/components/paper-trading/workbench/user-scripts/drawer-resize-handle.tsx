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
 */
import { useRef } from "react";

export const DRAWER_MIN_HEIGHT = 220;
export const DRAWER_MAX_HEIGHT = 640;
export const DRAWER_DEFAULT_HEIGHT = 360;

export function clampDrawerHeight(height: number): number {
  if (!Number.isFinite(height)) return DRAWER_DEFAULT_HEIGHT;
  return Math.min(DRAWER_MAX_HEIGHT, Math.max(DRAWER_MIN_HEIGHT, height));
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
