"use client";

/**
 * Charting Workbench (W3, T4) — `ChartDrawing` persistence against W1's CRUD
 * endpoints (`/api/chart-drawings`, `/api/chart-drawings/[id]` — see
 * project_workbench_w1 memory for the exact route contracts).
 *
 * This hook owns the SERVER round-trips and the debounce/error-toast
 * plumbing; it does NOT touch the KLineCharts instance directly (no chart
 * ref here) — `kline-chart.tsx` owns all `createOverlay`/`removeOverlay`
 * calls and calls into this hook's `create`/`update`/`remove`/`clearAll`
 * functions via props (`onDrawingCreate`/`onDrawingMoveEnd`/
 * `onDrawingRemoved`/`onAllDrawingsCleared` on `<KlineChart>`), mirroring
 * the same props-down/callbacks-up shape `orderLines` already uses. See
 * `chart-workbench.tsx` for the wiring and `kline-chart.tsx`'s module doc
 * for exactly which side (hook vs. chart wrapper) owns which half of each
 * of the plan's 6 persistence steps.
 *
 * Failure posture (brief, non-negotiable): a failed POST/PATCH/DELETE never
 * reverts what already happened on-screen — the drawing/edit/removal stays
 * exactly as the user left it locally, and an inline banner (rendered by
 * `chart-workbench.tsx`, same dismissible style as
 * `paper-trading-dashboard.tsx`'s `repriceError` banner — this codebase has
 * no toast library) explains the drawing may not have actually persisted.
 */
import { useCallback, useRef, useState } from "react";

export interface ChartDrawingPoint {
  timestamp: number;
  value: number;
}

export interface ChartDrawingRow {
  id: string;
  chartKey: string;
  overlayName: string;
  points: ChartDrawingPoint[];
  styles: Record<string, unknown> | null;
  visible: boolean;
}

/** S1, T5/T7 — a PATCH patch: `points` (drag), `styles` (style editor / D10 text popover), or both. `update()` merges repeated calls for the SAME id behind ONE debounce timer — see that function's own doc. */
export interface ChartDrawingUpdatePatch {
  points?: ChartDrawingPoint[];
  styles?: Record<string, unknown>;
}

const PATCH_DEBOUNCE_MS = 500;

export function useChartDrawings(chartKey: string): {
  drawings: ChartDrawingRow[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  dismissError: () => void;
  load: () => Promise<void>;
  /** S1, T5 widens `create` with an optional `styles` (the emoji flyout's chosen `pfContent.emoji`, or `highlighter`'s preset — applied at CREATION so the very first render already carries it, not a follow-up PATCH). */
  create: (overlayName: string, points: ChartDrawingPoint[], styles?: Record<string, unknown>) => Promise<ChartDrawingRow | null>;
  /**
   * Debounced 500ms latest-wins PER DRAWING id — see module doc. S1, T7
   * widens the payload to a `{points?, styles?}` patch and MERGES repeated
   * calls within the debounce window instead of replacing wholesale: a drag
   * (`points`) followed immediately by a style-editor color pick
   * (`styles`) on the same drawing collapses into ONE PATCH carrying both,
   * and 5 rapid color swatch clicks in under 1s collapse into exactly ONE
   * PATCH carrying only the LAST style choice (the ticket's own explicit
   * "5 clicks → 1 PATCH" acceptance test). Fire-and-forget; callers never
   * await a specific PATCH landing.
   */
  update: (id: string, patch: ChartDrawingUpdatePatch) => void;
  /** Fire-and-forget DELETE — the caller (kline-chart.tsx) has already removed the overlay from the canvas by the time this fires (a real user delete, guarded upstream by `suspendSyncRef` for every programmatic removal — see kline-chart.tsx). */
  remove: (id: string) => void;
  clearAll: () => Promise<void>;
} {
  const [drawings, setDrawings] = useState<ChartDrawingRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestPendingPatch = useRef<Map<string, ChartDrawingUpdatePatch>>(new Map());

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/chart-drawings?chartKey=${encodeURIComponent(chartKey)}`);
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json().catch(() => null);
      setDrawings(Array.isArray(data?.drawings) ? data.drawings : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [chartKey]);

  // Called from kline-chart.tsx's onDrawEnd handler once a drawing's points
  // are final — persists `{timestamp,value}` anchor points only, never
  // pixel coordinates (the schema/points contract W1 built specifically so
  // a drawing survives an interval switch).
  const create = useCallback(
    async (overlayName: string, points: ChartDrawingPoint[], styles?: Record<string, unknown>): Promise<ChartDrawingRow | null> => {
      try {
        const res = await fetch("/api/chart-drawings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(styles ? { chartKey, overlayName, points, styles } : { chartKey, overlayName, points })
        });
        if (!res.ok) {
          setError("Drawing not saved — it will disappear on reload.");
          return null;
        }
        const data = await res.json().catch(() => null);
        const row = data?.drawing as ChartDrawingRow | undefined;
        if (!row) {
          setError("Drawing not saved — it will disappear on reload.");
          return null;
        }
        setDrawings((prev) => [...prev, row]);
        return row;
      } catch {
        setError("Drawing not saved — it will disappear on reload.");
        return null;
      }
    },
    [chartKey]
  );

  // Called from kline-chart.tsx's onPressedMoveEnd handler (points) and
  // chart-workbench.tsx's style editor (styles) on an already-persisted
  // drawing. Debounced 500ms latest-wins PER DRAWING id, patches MERGED —
  // see the `update` doc on this hook's return type for the exact "5 rapid
  // color clicks → 1 PATCH" / "drag then recolor → 1 PATCH carrying both"
  // semantics. Adjustments to DIFFERENT drawings debounce independently
  // (separate timers keyed by id).
  const update = useCallback((id: string, patch: ChartDrawingUpdatePatch) => {
    const existingPatch = latestPendingPatch.current.get(id) ?? {};
    latestPendingPatch.current.set(id, {
      points: patch.points ?? existingPatch.points,
      styles: patch.styles ?? existingPatch.styles
    });
    const existingTimer = debounceTimers.current.get(id);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      debounceTimers.current.delete(id);
      const finalPatch = latestPendingPatch.current.get(id);
      latestPendingPatch.current.delete(id);
      if (!finalPatch || (finalPatch.points === undefined && finalPatch.styles === undefined)) return;
      fetch(`/api/chart-drawings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPatch)
      })
        .then((res) => {
          if (res.ok) {
            setDrawings((prev) =>
              prev.map((d) =>
                d.id === id
                  ? { ...d, points: finalPatch.points ?? d.points, styles: finalPatch.styles ?? d.styles }
                  : d
              )
            );
          } else {
            setError("Couldn't save your drawing's changes — it may revert after a reload.");
          }
        })
        .catch(() => setError("Couldn't save your drawing's changes — it may revert after a reload."));
    }, PATCH_DEBOUNCE_MS);
    debounceTimers.current.set(id, timer);
  }, []);

  // Called from kline-chart.tsx's onRemoved handler — already
  // `suspendSyncRef`-guarded upstream so this only ever fires for a REAL
  // user-initiated delete (the delete hotkey / a row that genuinely left
  // the canvas), never a programmatic hydration/clear-all teardown.
  const remove = useCallback((id: string) => {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    const pendingTimer = debounceTimers.current.get(id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      debounceTimers.current.delete(id);
      latestPendingPatch.current.delete(id);
    }
    fetch(`/api/chart-drawings/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) setError("Couldn't delete that drawing on the server — it may reappear after a reload.");
    }).catch(() => setError("Couldn't delete that drawing on the server — it may reappear after a reload."));
  }, []);

  // Toolbar's "Clear all" — ONE batched DELETE ?chartKey=, never N
  // individual per-drawing deletes (kline-chart.tsx has already removed
  // every overlay from the canvas, through its own suspendSyncRef guard, by
  // the time this is called).
  const clearAll = useCallback(async () => {
    setDrawings([]);
    for (const timer of debounceTimers.current.values()) clearTimeout(timer);
    debounceTimers.current.clear();
    latestPendingPatch.current.clear();
    try {
      const res = await fetch(`/api/chart-drawings?chartKey=${encodeURIComponent(chartKey)}`, { method: "DELETE" });
      if (!res.ok) setError("Couldn't clear all drawings on the server — reload to check what's left.");
    } catch {
      setError("Couldn't clear all drawings on the server — reload to check what's left.");
    }
  }, [chartKey]);

  const dismissError = useCallback(() => setError(null), []);

  return { drawings, status, error, dismissError, load, create, update, remove, clearAll };
}
