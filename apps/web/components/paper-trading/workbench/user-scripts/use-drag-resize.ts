"use client";

/**
 * Founder-feedback pass (2026-08-04) — shared drag mechanics for this
 * drawer's resize handles. `panel-resize-handle.tsx` (the workbench's
 * right-panel width handle, one level up, untouched by this pass) and
 * `drawer-resize-handle.tsx` (this drawer's own pre-existing height handle,
 * SS2) are two independent, near-identical copies of the same
 * pointer-capture + rAF-throttled-flush + commit-on-pointerup machinery —
 * `drawer-resize-handle.tsx`'s own module doc already explains why an axis
 * flip (width vs height) plus a different grow-direction sign made it "not
 * a drop-in reuse" of the panel handle. Adding a THIRD (sidebar width) and
 * FOURTH (console height) near-copy for this pass would triple that
 * duplication for zero benefit — this hook factors out only the genuinely
 * axis-agnostic part (drag-state refs, pointer capture, rAF scheduling) so
 * `sidebar-resize-handle.tsx` and `script-console.tsx`'s own resize handle
 * don't re-implement it a third and fourth time. The axis/sign/clamp
 * semantics that actually DIFFER per handle (which coordinate to read,
 * which direction grows the box, the min/max bounds) stay explicit and
 * local at each call site — matching this codebase's preference for
 * explicit per-site direction comments over a fully parameterized
 * abstraction. `panel-resize-handle.tsx` and `drawer-resize-handle.tsx`
 * themselves are left untouched (already shipped, already tested — no
 * reason to risk a refactor of working drag code for its own sake).
 */
import { useCallback, useRef } from "react";

export interface DragResizeOptions {
  /** Read fresh at drag-START (a getter, not a captured value) — same reasoning as `panel-resize-handle.tsx`'s own `getCurrentWidth`. */
  getStartValue: () => number;
  /** Reads the relevant coordinate off the pointer event — `e.clientX` for a horizontal (width) drag, `e.clientY` for a vertical (height) drag. */
  readCoord: (e: React.PointerEvent<HTMLDivElement>) => number;
  /** Turns (startValue, coordDelta) into a new, ALREADY-CLAMPED value — the caller owns both the grow-direction sign and the min/max bounds. */
  computeNext: (startValue: number, delta: number) => number;
  /** Fires at most once per animation frame during the drag with the live, already-clamped value — apply it directly to the DOM, never through `setState`. */
  onResize: (value: number) => void;
  /** Fires exactly once, at `pointerup`, with the final value — commit to React state + persist here. */
  onResizeEnd: (value: number) => void;
}

export function useDragResize({ getStartValue, readCoord, computeNext, onResize, onResizeEnd }: DragResizeOptions) {
  const draggingRef = useRef(false);
  const startCoordRef = useRef(0);
  const startValueRef = useRef(0);
  const liveValueRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  function scheduleFlush() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onResize(liveValueRef.current);
    });
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      startCoordRef.current = readCoord(e);
      startValueRef.current = getStartValue();
      liveValueRef.current = startValueRef.current;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [getStartValue, readCoord]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const delta = readCoord(e) - startCoordRef.current;
      liveValueRef.current = computeNext(startValueRef.current, delta);
      scheduleFlush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readCoord, computeNext]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      onResizeEnd(liveValueRef.current);
    },
    [onResizeEnd]
  );

  return { handlePointerDown, handlePointerMove, endDrag };
}
