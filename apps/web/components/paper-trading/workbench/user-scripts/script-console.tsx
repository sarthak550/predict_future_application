"use client";

/**
 * User Strategy Scripting (SS2), §3 — the console strip. Renders the last
 * run's `console.log` output (newest last, scrollable) and, on failure, the
 * LINE-CORRECTED error (SS1's `WRAP_LINE_OFFSET` machinery already did the
 * correction — this component just renders whatever `line`/`message` it's
 * handed, verbatim, no re-deriving). The timeout case's exact copy
 * (`script-runner.ts`'s `SCRIPT_TIMEOUT_MESSAGE`) arrives here as a plain
 * `error.message` with no `line` — rendered as-is, no additional
 * editorializing added at this layer, per this codebase's honesty-copy law
 * (see `strategy-panel.tsx`'s own disclaimer doc for the same law applied
 * elsewhere).
 *
 * Collapsible (drawer real-estate is scarce with editor+list+toolbar all
 * competing for it), but `script-editor-drawer.tsx` is responsible for
 * force-expanding this on every FRESH result that carries an error or a
 * non-empty `logs` array — this component itself is purely presentational,
 * it never decides to auto-expand on its own.
 *
 * **Founder-feedback pass (2026-08-04) — draggable height, not a fixed
 * `max-h-32`.** Live-browser diagnosis found the old hard-coded 128px cap
 * (with zero user control) meant an expanded console with real output could
 * be clipped by the drawer's own fixed total height with no visual hint
 * more content existed — worst on a short drawer/short viewport, but always
 * cramped for anything past a couple of lines. `height` is now owned by the
 * PARENT (persisted, so it survives collapsing/reopening and page reloads)
 * — this component applies it imperatively to its own `contentRef` during
 * a drag (same "never `setState` mid-drag" law every other handle in this
 * drawer follows) and reports only the FINAL height on pointer-up via
 * `onHeightChange`, exactly like `drawer-resize-handle.tsx`'s own
 * `onResizeEnd` contract. The resize handle only renders while expanded —
 * dragging a hidden panel's height makes no sense.
 */
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useRef } from "react";

import { useDragResize } from "./use-drag-resize";

export const CONSOLE_MIN_HEIGHT = 80;
export const CONSOLE_MAX_HEIGHT = 360;
export const CONSOLE_DEFAULT_HEIGHT = 128;

/**
 * `maxOverride` — see `script-editor-drawer.tsx`'s own `getConsoleMaxHeight`.
 * A first cut of this pass gave the console a STATIC max only, independent
 * of the drawer's own (now much smaller) total height and the editor's new
 * `EDITOR_MIN_HEIGHT_PX` floor — live-browser testing caught the result
 * immediately: dragging the console taller at the drawer's default height
 * forced the editor below its own CSS `min-height` (which, being a hard
 * floor, does NOT cooperate with a too-small flex parent — it just
 * overflows instead), producing visibly garbled, overlapping
 * editor/console text. `maxOverride`, when provided, tightens the ceiling
 * to whatever budget is actually safe for the CURRENT drawer height.
 */
export function clampConsoleHeight(height: number, maxOverride?: number): number {
  if (!Number.isFinite(height)) return CONSOLE_DEFAULT_HEIGHT;
  const effectiveMax = maxOverride !== undefined ? Math.max(CONSOLE_MIN_HEIGHT, Math.min(CONSOLE_MAX_HEIGHT, maxOverride)) : CONSOLE_MAX_HEIGHT;
  return Math.min(effectiveMax, Math.max(CONSOLE_MIN_HEIGHT, height));
}

export interface ScriptConsoleProps {
  logs: string[];
  error: { message: string; line?: number } | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Persisted, already-clamped height for the expanded content panel. */
  height: number;
  /** Fires once, at drag release, with the final clamped height — the parent commits it to state + localStorage. */
  onHeightChange: (height: number) => void;
  /** The real, current safe ceiling given the drawer's own (adjustable) total height and the editor's guaranteed minimum — see `script-editor-drawer.tsx`'s `getConsoleMaxHeight`. Read fresh at drag-start via a getter, same "never a stale closure" law every other handle in this drawer follows. */
  getMaxHeight: () => number;
}

export function ScriptConsole({ logs, error, collapsed, onToggleCollapsed, height, onHeightChange, getMaxHeight }: ScriptConsoleProps) {
  const hasContent = logs.length > 0 || error !== null;
  const contentRef = useRef<HTMLDivElement | null>(null);

  const { handlePointerDown, handlePointerMove, endDrag } = useDragResize({
    getStartValue: () => height,
    readCoord: (e) => e.clientY,
    // The handle sits on the console content panel's TOP edge (panel below
    // it, drawer chrome above) — dragging UP (negative dy) GROWS the
    // panel, same sign convention as `drawer-resize-handle.tsx`'s own
    // top-edge handle.
    computeNext: (startHeight, dy) => clampConsoleHeight(startHeight - dy, getMaxHeight()),
    onResize: (next) => {
      if (contentRef.current) contentRef.current.style.height = `${next}px`;
    },
    onResizeEnd: (next) => onHeightChange(clampConsoleHeight(next, getMaxHeight()))
  });

  return (
    <div className="flex shrink-0 flex-col border-t border-ink-100">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500 hover:bg-ink-50"
      >
        <span className="flex items-center gap-1.5">
          Console
          {error && <TriangleAlert className="h-3 w-3 text-rose-600" aria-hidden="true" />}
          {hasContent && (
            <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium normal-case text-ink-500">
              {error ? "error" : `${logs.length} log${logs.length === 1 ? "" : "s"}`}
            </span>
          )}
        </span>
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {!collapsed && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize console"
            title="Drag to resize"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="group relative h-1.5 shrink-0 touch-none select-none border-t border-ink-100 hover:cursor-row-resize"
          >
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-transparent group-hover:bg-sky-300" />
          </div>
          <div
            ref={contentRef}
            style={{ height }}
            className="overflow-y-auto bg-ink-50 px-3 py-2 font-mono text-[11px] leading-5"
          >
            {!hasContent && <p className="text-ink-400">No output yet — click Run to see logs and errors here.</p>}
            {logs.map((line, i) => (
              <p key={i} className="whitespace-pre-wrap break-words text-ink-700">
                {line}
              </p>
            ))}
            {error && (
              <p className="whitespace-pre-wrap break-words font-semibold text-rose-700">
                {error.line !== undefined ? `Line ${error.line}: ${error.message}` : error.message}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
