"use client";

/**
 * Workbench Symbol Panel (Workstream D3, 2026-08-17) — client-side fetch for
 * `symbol-detail-panel.tsx`, mirroring `terminal/use-eod-series.ts`'s
 * "fetch on symbol change, cancel stale" idiom (a closed-over `cancelled`
 * flag reset per-effect-run via the `[symbol]` dependency array — the same
 * pattern, not a new one). Hits
 * `GET /api/paper-trading/instruments/[symbol]/panel-summary` (D2).
 *
 * No aggressive polling for v1 (fundamentals don't move intraday, per
 * Decision D3 of the brief) — a fetch on mount/symbol change is sufficient.
 * A slow ~60s poll while the panel is visibly open was explicitly flagged
 * as a nice-to-have, not a requirement, and is deliberately NOT built here
 * to keep this hook's scope tight — a fast follow if ever wanted.
 */
import { useEffect, useState } from "react";

import type { PanelSummaryResponse } from "@/lib/paperTrading/panelSummaryTypes";

export type SymbolPanelSummaryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: PanelSummaryResponse };

const LOADING_STATE: SymbolPanelSummaryState = { status: "loading" };
const ERROR_STATE: SymbolPanelSummaryState = { status: "error" };

export function useSymbolPanelSummary(symbol: string | null): SymbolPanelSummaryState {
  const [state, setState] = useState<SymbolPanelSummaryState>(LOADING_STATE);

  useEffect(() => {
    if (!symbol) {
      setState(LOADING_STATE);
      return;
    }
    let cancelled = false;
    setState(LOADING_STATE); // a symbol switch always shows the loading skeleton again, never the PREVIOUS symbol's stale data while the new fetch is in flight.
    fetch(`/api/paper-trading/instruments/${encodeURIComponent(symbol)}/panel-summary`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`panel-summary HTTP ${r.status}`))))
      .then((data: PanelSummaryResponse) => {
        if (cancelled) return;
        setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState(ERROR_STATE);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return state;
}
