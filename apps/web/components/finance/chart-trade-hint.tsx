"use client";

/**
 * Chart Trading interaction-model rework (2026-08-04) — a one-time,
 * dismissible hint telling returning users where trading moved. Founder
 * complaint, verbatim: "I cant have buy/sell popup on every click, thats
 * irritating" — plain clicks no longer open the order-intent popover on ANY
 * chart surface (see chart-axis-plus-button.tsx's own doc for the full
 * rework). Users who already learned click-to-trade must be told where it
 * went, once — not stranded silently (the sprint brief's own explicit
 * requirement).
 *
 * Device-wide, ONE shared localStorage key across every chart surface (not
 * per-chart/per-page): dismissing the hint on any one of price-chart.tsx /
 * terminal/premium-chart.tsx / the maximized workbench dismisses it
 * everywhere, since the new interaction model is identical on all four
 * surfaces. The small terminal chart and the maximized workbench are mounted
 * SIMULTANEOUSLY (TerminalShell keeps its chart slot rendered under the
 * portal), and `storage` events don't fire in the tab that wrote the value —
 * so dismissal is also broadcast via a same-tab window event that every
 * mounted hook instance listens for. Same restore-after-hydration posture
 * price-chart.tsx's own
 * `TIMEFRAME_STORAGE_KEY` already uses (default to "dismissed" so the first
 * paint never flashes it, then resolve the real value on mount).
 *
 * Visual convention mirrors this codebase's existing dismissible-banner
 * idiom (paper-trading-dashboard.tsx's/futures-page-client.tsx's/options-
 * page-client.tsx's `pendingOrderNotice` sky banner — same border/bg/text
 * tones, underlined dismiss action), sized down for a chart widget's own
 * tight vertical budget. Deliberately NOT the mobile app's spotlight-tour
 * idiom (see feedback_guided_tours_not_explainers memory) — that system is
 * RN-only and this is a small, permanently-dismissible text banner, not a
 * multi-step tour.
 */
import { useEffect, useState } from "react";

const HINT_STORAGE_KEY = "pf.chart.tradeHintDismissed";
const HINT_DISMISS_EVENT = "pf:chart-trade-hint-dismissed";

export function useTradeHintDismissed(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(HINT_STORAGE_KEY) === "1");
    } catch {
      setDismissed(true); // Private mode / storage disabled — never re-nag on every load if the dismissal can't be remembered.
    }
    const onDismissedElsewhere = () => setDismissed(true);
    window.addEventListener(HINT_DISMISS_EVENT, onDismissedElsewhere);
    return () => window.removeEventListener(HINT_DISMISS_EVENT, onDismissedElsewhere);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      // Won't survive a refresh — acceptable, matches every other localStorage preference in this codebase.
    }
    window.dispatchEvent(new Event(HINT_DISMISS_EVENT));
  }

  return [dismissed, dismiss];
}

export function ChartTradeHint({ dismissed, onDismiss }: { dismissed: boolean; onDismiss: () => void }) {
  if (dismissed) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-800 shadow-sm">
      <span>
        Trading moved off the chart — hover the price axis for <strong>+</strong>, or right-click anywhere.
      </span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}
