"use client";

/**
 * Founder-feedback pass (2026-08-04) — a drag handle on the script list
 * sidebar's right edge, widening/narrowing it against the editor column
 * next to it. Uses the shared `useDragResize` mechanics (see that file's
 * doc for why this isn't a fourth hand-rolled copy of the same pointer-drag
 * plumbing). Desktop-only (`sm:` and up) — below `sm` the sidebar stacks
 * full-width above the editor (`script-list-sidebar.tsx`'s own T5 layout),
 * where a width drag is meaningless; the caller is responsible for not
 * rendering this at all below that breakpoint (matches the sidebar's own
 * `hidden`/`block` responsive convention rather than this component
 * guessing at viewport width itself).
 *
 * No explicit "collapse to icon rail" affordance — `SIDEBAR_MIN_WIDTH`
 * (140px) still shows a readable (truncated) script name and the "+" new
 * button, and double-click-to-reset is the same escape hatch every other
 * handle in this drawer already has. An icon-only collapsed mode would be
 * a materially different rendering path this sidebar doesn't have any
 * other reason to grow today — not built speculatively.
 */
import { useDragResize } from "./use-drag-resize";

export const SIDEBAR_MIN_WIDTH = 140;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 200;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function SidebarResizeHandle({
  getCurrentWidth,
  onResize,
  onResizeEnd,
  onDoubleClickReset
}: {
  getCurrentWidth: () => number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onDoubleClickReset: () => void;
}) {
  const { handlePointerDown, handlePointerMove, endDrag } = useDragResize({
    getStartValue: getCurrentWidth,
    readCoord: (e) => e.clientX,
    // The handle sits on the sidebar's RIGHT edge (sidebar to its LEFT,
    // editor to its right) — dragging RIGHT (positive dx) WIDENS the
    // sidebar. Opposite sign from `panel-resize-handle.tsx`'s own handle,
    // which sits on a panel's LEFT edge with the panel's content to ITS
    // right, so that one widens on NEGATIVE dx — see that file's doc.
    computeNext: (startWidth, dx) => clampSidebarWidth(startWidth + dx),
    onResize,
    onResizeEnd
  });

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize script list"
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClickReset}
      className="group relative hidden w-2.5 shrink-0 touch-none select-none border-r border-ink-100 hover:cursor-col-resize sm:block"
      style={{ cursor: "col-resize", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent group-hover:bg-sky-300" />
    </div>
  );
}
