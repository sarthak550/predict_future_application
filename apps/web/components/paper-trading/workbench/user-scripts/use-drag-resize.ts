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
 *
 * **Cross-engine hardening (2026-08-07)** — a founder report that
 * `drawer-resize-handle.tsx`'s own height handle didn't drag AT ALL in
 * their browser (both directions dead), while every Playwright Chromium
 * check showed it working, root-caused to the drag logic relying on
 * `setPointerCapture` to guarantee `pointermove`/`pointerup` keep firing on
 * the handle element even once the pointer leaves it — a guarantee that
 * doesn't hold uniformly across engines (a capture call that silently no-ops
 * or a gesture the engine reclaims for its own scroll/selection handling
 * mid-drag both produce the exact "nothing happens" signature reported).
 * Fixed here (covering `sidebar-resize-handle.tsx` and `script-console.tsx`'s
 * own handle automatically, both already built on this hook) by making
 * `window`-level `pointermove`/`pointerup`/`pointercancel` listeners the
 * PRIMARY drag mechanism — attached at `pointerdown`, removed at drag-end —
 * with `setPointerCapture` kept only as a best-effort enhancement (wrapped
 * in try/catch, its failure changes nothing). `document.body.style.userSelect`
 * is also suppressed for the drag's duration, belt-and-suspenders against an
 * engine initiating a page-wide text-selection drag from the handle's own
 * pointerdown despite `select-none`/`touch-none` already being set on every
 * caller's handle element. The two standalone handles that predate this hook
 * (`panel-resize-handle.tsx`, `drawer-resize-handle.tsx`) get the identical
 * pattern applied directly in their own files — not migrated onto this hook,
 * per this file's own established "don't refactor working, already-shipped
 * drag code" posture above.
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
  // Cross-engine hardening (2026-08-07) — see this file's own module doc.
  // `readCoordFromNative` mirrors `readCoord`'s own `e.clientX`/`e.clientY`
  // read but against a native `PointerEvent` (window listeners receive the
  // native event, not a React `PointerEvent`) — both event types carry the
  // same `clientX`/`clientY` fields, so this is a structural, not a
  // behavioral, difference.
  const windowListenersRef = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);
  const prevBodyUserSelectRef = useRef<string | null>(null);

  function scheduleFlush() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onResize(liveValueRef.current);
    });
  }

  function applyMove(coord: number) {
    const delta = coord - startCoordRef.current;
    liveValueRef.current = computeNext(startValueRef.current, delta);
    scheduleFlush();
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
    onResizeEnd(liveValueRef.current);
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Defensive cleanup (2026-08-07) — see `drawer-resize-handle.tsx`'s
      // identical guard for the full reasoning: force-end any still-active
      // previous drag first, so its window listeners can never be silently
      // orphaned by this drag overwriting `windowListenersRef`.
      if (draggingRef.current) endDragInternal();
      draggingRef.current = true;
      startCoordRef.current = readCoord(e);
      startValueRef.current = getStartValue();
      liveValueRef.current = startValueRef.current;
      // Enhancement, not a dependency — see this file's own module doc.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignored — window listeners below don't need capture to work.
      }
      prevBodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const onWindowMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        // `readCoord` only ever reads `clientX`/`clientY` off whatever it's
        // given — both React's `PointerEvent` and the native window
        // `PointerEvent` this listener actually receives expose the same
        // fields, so re-using the caller's own `readCoord` here (rather than
        // hand-picking an axis) stays correct even if a future caller's
        // `readCoord` becomes more elaborate than a single-field read.
        applyMove(readCoord(ev as unknown as React.PointerEvent<HTMLDivElement>));
      };
      const onWindowUp = () => endDragInternal();
      windowListenersRef.current = { move: onWindowMove, up: onWindowUp };
      window.addEventListener("pointermove", onWindowMove);
      window.addEventListener("pointerup", onWindowUp);
      window.addEventListener("pointercancel", onWindowUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getStartValue, readCoord]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      applyMove(readCoord(e));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readCoord, computeNext]
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endDragInternal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { handlePointerDown, handlePointerMove, endDrag };
}
