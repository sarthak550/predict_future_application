"use client";

/**
 * Founder-feedback pass (2026-08-06) — "if user hovers over that they
 * should get a message that tells the reason for that signal, as the
 * purpose of paper trading is learning as well." One shared trigger,
 * reused by BOTH `signals-table.tsx`'s per-row badges AND
 * `indicator-active-strip.tsx`'s state chips — a single hover/tap/dismiss
 * implementation, not two independently-maintained copies.
 *
 * Desktop: mouse-enter/leave shows/hides the card (no click needed).
 * Touch has no hover event at all, so the SAME trigger element also toggles
 * on tap — dismissed via the identical outside-pointerdown/Escape idiom
 * `chart-order-intent-popover.tsx` already established for this workbench
 * (styling precedent reused directly: white card, rounded-2xl border,
 * shadow-lg, `border-ink-200`).
 *
 * Rendered as a `<span>` wrapping a `<button>` — a SIBLING of any other
 * interactive controls in the parent row/chip (never a child of one), per
 * this program's own documented nested-button-bubbling lesson
 * (`project_ta_suite_founder_feedback_2026_08_03.md`) — `indicator-active-
 * strip.tsx`'s chip `<div>` already places this trigger next to (not
 * inside) its Settings/Remove `<button>`s.
 */
import { useEffect, useRef, useState } from "react";

import type { DetailReason } from "@/lib/ta/technicals";

export function SignalReasonTrigger({ reason, children }: { reason: DetailReason; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`Why: ${reason.rule}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="cursor-help"
      >
        {children}
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-2xl border border-ink-200 bg-white p-2.5 text-left shadow-lg"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-700">{reason.rule}</p>
          <p className="mt-1.5 text-[11px] leading-4 text-ink-600">{reason.reading}</p>
          <p className="mt-1 text-[11px] leading-4 text-ink-400">{reason.meaning}</p>
        </div>
      )}
    </span>
  );
}
